import fs from 'fs-extra';
import path from 'path';
import { parseCode } from '../../parser/astParser.js';
import estraverse from 'estraverse';
import glob from 'fast-glob';
import { isReference } from '../deadcode/core/isReference.js';
import { visitorKeys as tsVisitorKeys } from '@typescript-eslint/visitor-keys';
import { resolveBarrelExports } from '../deadcode/core/barrelResolver.js';
import { resolvePath } from './pathResolver.js';
import { findEntryPoints } from './entryPointFinder.js';
import micromatch from 'micromatch';
import { SCRIPT_EXTENSION_SET } from '../../parser/supportedExtensions.js';

// Gabungkan Visitor Keys ESTree standar dengan ekstrasi TypeScript/JSX
const visitorKeys = { ...estraverse.VisitorKeys, ...tsVisitorKeys };
const NON_PACKAGE_SCHEMES = /^(?:https?|jsr|deno|bun|data):/i;

/**
 * Membangun sebuah graf struktural yang komprehensif merayapi titik masuk (entry point) menggunakan BFS.
 * @param {string} projectRoot - Direktori proyek
 * @returns {Promise<{ liveFiles: Set<string>, usedPackages: Set<string>, edges: Array, unsafeFiles: Set<string>, globalRegistry: Object }>}
 */
export async function buildProjectGraph(projectRoot, ruleEngine = null) {
    // 1. Dapatkan file entry points yang tervalidasi menggunakan finder module
    const entryFiles = await findEntryPoints(projectRoot, ruleEngine);

    // 2. Inisialisasi struktur data Pembangunan Graf dengan Metode Breadth-First Search (BFS)
    const liveFiles = new Set();
    const visitedFiles = new Set();
    const usedPackages = new Set();
    const edges = []; // { from, to }
    const queue = [...entryFiles];

    // Status Pencatatan Keamanan (Bailout Heuristics) & Memori Analisis
    const unsafeFiles = new Set();
    const dynamicDependencyFiles = new Set();
    const globalRegistry = {
        usedExports: new Map(), // file -> Set of used exported names
        exports: new Map(), // Exported/Declared Names -> { isUnused, file } (legacy)
        usages: new Set(),   // Used/Called Names (legacy)
        classMethodCalls: new Map(), // className -> Set<methodName> (cross-file tracking)
        calledMethods: new Set(), // methodName (all called method names across project)
        unresolvedImports: [], // { file, importPath } (Fitur 5: Broken Links)
        projectExports: new Map(), // exportName -> Set<filePath> (Fitur 8: Duplicate Exports)
        reExportLinks: [] // { fromFile, fromExport, toFile, toExport }
    };

    // Filter antrian awal
    const validQueue = [];
    for (const f of queue) {
        if (await fs.pathExists(f)) {
            validQueue.push(f);
            visitedFiles.add(f);
            liveFiles.add(f);
        }
    }

    // 3. BFS Traversal melintasi semua file
    while (validQueue.length > 0) {
        const currentFile = validQueue.shift();
        const fileDir = path.dirname(currentFile);

        try {
            // Skip file yang bukan JavaScript/TypeScript — CSS, JSON, gambar, font, dll
            // yang di-import oleh framework (Next.js: import styles from './x.module.css')
            // tetap dianggap "live file" tapi tidak di-parse sebagai kode JS.
            const ext = path.extname(currentFile).toLowerCase();
            if (!SCRIPT_EXTENSION_SET.has(ext)) continue;

            const code = await fs.readFile(currentFile, 'utf-8');

            const ast = await parseCode(code, currentFile);
            const importsToResolve = [];
            const namespaceMap = new Map(); // FITUR 6: Melacak properti namespace import

            // Sapuan Tunggal Melintasi AST (Satu pass agar efisien O(N))
            // Menyimpan nama-nama Identifier yang BENAR-BENAR TERPAKAI di file ini
            const usedIdentifiersInFile = new Set();
            const parentStack = [];

            estraverse.traverse(ast, {
                fallback: 'iteration',
                keys: visitorKeys,
                enter: function (node, parent) {
                    parentStack.push(node);

                    // Lacak penggunaan identifier murni (sama seperti ESLint)
                    if (node.type === 'Identifier') {
                        const grandParent = parentStack.length >= 3 ? parentStack[parentStack.length - 3] : null;
                        if (isReference(node, parent, grandParent)) {
                            usedIdentifiersInFile.add(node.name);
                        }
                    }

                    // --- 1. Bailout Heuristics (Dynamic Code Detection) ---
                    if (node.type === 'CallExpression' && node.callee.name === 'eval') {
                        unsafeFiles.add(currentFile);
                    }
                    if (node.type === 'WithStatement') {
                        unsafeFiles.add(currentFile);
                    }
                    if (node.type === 'MemberExpression' && node.computed === true) {
                        const isDynamicNamespaceAccess =
                            node.property.type !== 'Literal' &&
                            node.object.type === 'Identifier' &&
                            namespaceMap.has(node.object.name);
                        const isDynamicThisAccess =
                            node.property.type !== 'Literal' &&
                            node.object.type === 'ThisExpression';
                        if (isDynamicNamespaceAccess || isDynamicThisAccess) {
                            unsafeFiles.add(currentFile);
                        }
                    }

                    // --- 2. Call Graph ---
                    // Mengumpulkan SEMUA nama method yang pernah dipanggil di seluruh proyek
                    if (node.type === 'MemberExpression' && !node.computed && node.property && node.property.type === 'Identifier') {
                        globalRegistry.calledMethods.add(node.property.name);
                    }

                    // Mendata Pendeklarasian Ekspor untuk dilacak (Legacy/Penyokong)
                    if (node.type === 'FunctionDeclaration' && node.id) {
                        if (!globalRegistry.exports.has(node.id.name)) {
                            globalRegistry.exports.set(node.id.name, { isUnused: true, file: currentFile });
                        }
                    }
                    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
                        if (!globalRegistry.exports.has(node.id.name)) {
                            globalRegistry.exports.set(node.id.name, { isUnused: true, file: currentFile });
                        }
                    }

                    // --- FITUR 6: Namespace Tracking ---
                    if (node.type === 'Identifier' && namespaceMap.has(node.name)) {
                        const nsMeta = namespaceMap.get(node.name);
                        // Jika digunakan sebagai object dari MemberExpression (Utils.format)
                        if (parent && parent.type === 'MemberExpression' && parent.object === node && !parent.computed && parent.property.type === 'Identifier') {
                            nsMeta.names.push(parent.property.name);
                            if (nsMeta.details) nsMeta.details.push({ imported: parent.property.name, local: parent.property.name, isNamespaceMember: true });
                        } else if (parent && parent.type !== 'ImportNamespaceSpecifier') {
                            // Jika di-pass ke fungsi lain atau di-assign, fallback ke '*'
                            nsMeta.fallbackToStar = true;
                        }
                    }

                    // --- 3. Pelacakan Instruksi Impor (Sistem Rekat Graf) ---
                    let importPath = null;
                    let importedNames = [];
                    let importDetails = [];
                    let isTypeOnly = false;

                    const isRequireCall = node.type === 'CallExpression' && node.callee.name === 'require';
                    const isRequireResolveCall = node.type === 'CallExpression' && node.callee.type === 'MemberExpression' &&
                        node.callee.object && node.callee.object.name === 'require' &&
                        node.callee.property && node.callee.property.name === 'resolve';

                    if (isRequireCall || isRequireResolveCall) {
                        if (node.arguments.length > 0 && node.arguments[0].type === 'Literal') {
                            importPath = node.arguments[0].value;
                            importedNames = ['*']; // Conservative fallback
                            importDetails = [{ imported: '*', local: '*' }];
                            if (parent && parent.type === 'VariableDeclarator' && parent.id.type === 'ObjectPattern') {
                                importedNames = parent.id.properties.map(p => p.type === 'Property' && p.key.type === 'Identifier' ? p.key.name : '*');
                                importDetails = parent.id.properties.map(p => {
                                    if (p.type === 'Property' && p.key.type === 'Identifier') {
                                        const loc = p.value && p.value.type === 'Identifier' ? p.value.name : p.key.name;
                                        return { imported: p.key.name, local: loc };
                                    }
                                    return { imported: '*', local: '*' };
                                });
                            } else if (parent && parent.type === 'MemberExpression' && parent.property.type === 'Identifier' && !parent.computed) {
                                importedNames = [parent.property.name];
                                importDetails = [{ imported: parent.property.name, local: parent.property.name }];
                            }
                        } else if (node.arguments.length > 0 && node.arguments[0].type === 'TemplateLiteral') {
                            const globPattern = node.arguments[0].quasis.map(q => q.value.raw).join('*');
                            if (globPattern.startsWith('.') || globPattern.startsWith('/')) {
                                try {
                                    const matchedFiles = glob.sync(globPattern, { cwd: fileDir, absolute: false });
                                    for (const relMatch of matchedFiles) {
                                        const globPath = relMatch.startsWith('.') || relMatch.startsWith('/') ? relMatch : './' + relMatch;
                                        importsToResolve.push({ path: globPath, names: ['*'], details: [{ imported: '*', local: '*' }], isGlob: true });
                                    }
                                } catch (_e) { }
                            } else {
                                unsafeFiles.add(currentFile);
                                dynamicDependencyFiles.add(currentFile);
                            }
                        } else {
                            unsafeFiles.add(currentFile);
                            dynamicDependencyFiles.add(currentFile);
                        }
                    } else if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' &&
                        node.callee.object.type === 'MetaProperty' && node.callee.object.meta.name === 'import' &&
                        node.callee.object.property.name === 'meta' &&
                        (node.callee.property.name === 'glob' || node.callee.property.name === 'globEager')) {
                        if (node.arguments.length > 0 && (node.arguments[0].type === 'Literal' || node.arguments[0].type === 'TemplateLiteral')) {
                            const pattern = node.arguments[0].type === 'Literal' ? node.arguments[0].value : node.arguments[0].quasis.map(q => q.value.raw).join('*');
                            if (typeof pattern === 'string') {
                                try {
                                    const matchedFiles = glob.sync(pattern, { cwd: fileDir, absolute: false });
                                    for (const relMatch of matchedFiles) {
                                        const globPath = relMatch.startsWith('.') || relMatch.startsWith('/') ? relMatch : './' + relMatch;
                                        importsToResolve.push({ path: globPath, names: ['*'], details: [{ imported: '*', local: '*' }], isGlob: true });
                                    }
                                } catch (_e) { }
                            }
                        }
                    } else if (node.type === 'ImportDeclaration' && node.source?.value) {
                        importPath = node.source.value;
                        isTypeOnly = node.importKind === 'type' || (node.specifiers && node.specifiers.length > 0 && node.specifiers.every(s => s.importKind === 'type'));
                        if (node.specifiers) {
                            node.specifiers.forEach(spec => {
                                if (spec.type === 'ImportSpecifier') {
                                    importedNames.push(spec.imported.name);
                                    importDetails.push({ imported: spec.imported.name, local: spec.local.name });
                                } else if (spec.type === 'ImportDefaultSpecifier') {
                                    importedNames.push('default');
                                    importDetails.push({ imported: 'default', local: spec.local.name });
                                } else if (spec.type === 'ImportNamespaceSpecifier') {
                                    namespaceMap.set(spec.local.name, { names: importedNames, details: importDetails, fallbackToStar: false });
                                }
                            });
                        }
                        if (importedNames.length === 0 && !namespaceMap.has(node.specifiers?.[0]?.local?.name)) {
                            importedNames.push('*'); // side-effect import
                            importDetails.push({ imported: '*', local: '*' });
                        }
                    } else if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source?.value) {
                        importPath = node.source.value;
                        isTypeOnly = node.exportKind === 'type' || (node.specifiers && node.specifiers.length > 0 && node.specifiers.every(s => s.exportKind === 'type'));
                        if (node.type === 'ExportAllDeclaration') {
                            importedNames.push('*');
                            importDetails.push({ imported: '*', local: '*', isReExport: true });
                        } else if (node.specifiers) {
                            node.specifiers.forEach(spec => {
                                if (spec.type === 'ExportSpecifier') {
                                    importedNames.push(spec.local.name);
                                    importDetails.push({ imported: spec.local.name, local: spec.exported.name, isReExport: true });
                                }
                            });
                        }
                    } else if (node.type === 'ImportExpression' && node.source) {
                        if (node.source.type === 'Literal') {
                            importPath = node.source.value;
                            importedNames.push('*');
                            importDetails.push({ imported: '*', local: '*' });
                        } else if (node.source.type === 'TemplateLiteral' && node.source.expressions.length === 0) {
                            importPath = node.source.quasis[0].value.raw;
                            importedNames.push('*');
                            importDetails.push({ imported: '*', local: '*' });
                        } else if (node.source.type === 'TemplateLiteral' && node.source.expressions.length > 0) {
                            const globPattern = node.source.quasis.map(q => q.value.raw).join('*');
                            if (globPattern.startsWith('.') || globPattern.startsWith('/')) {
                                try {
                                    const matchedFiles = glob.sync(globPattern, { cwd: fileDir, absolute: false });
                                    for (const relMatch of matchedFiles) {
                                        const globPath = relMatch.startsWith('.') || relMatch.startsWith('/') ? relMatch : './' + relMatch;
                                        importsToResolve.push({ path: globPath, names: ['*'], details: [{ imported: '*', local: '*' }], isGlob: true });
                                    }
                                } catch (_e) { }
                            } else {
                                unsafeFiles.add(currentFile);
                                dynamicDependencyFiles.add(currentFile);
                            }
                        } else {
                            unsafeFiles.add(currentFile);
                            dynamicDependencyFiles.add(currentFile);
                        }
                    }

                    if (importPath) {
                        if (NON_PACKAGE_SCHEMES.test(importPath)) {
                            importPath = null;
                        }
                    }

                    if (importPath) {
                        const isLocalOrAliasPrefix = importPath.startsWith('.') || 
                                                     importPath.startsWith('/') || 
                                                     path.isAbsolute(importPath) || 
                                                     importPath.startsWith('#') || 
                                                     importPath.startsWith('$') || 
                                                     importPath.startsWith('~/') || 
                                                     importPath.startsWith('@/') ||
                                                     importPath.startsWith('@workspace/') ||
                                                     importPath.startsWith('workspace:');
                        if (isLocalOrAliasPrefix) {
                            importsToResolve.push({ path: importPath, names: importedNames, details: importDetails, isTypeOnly });
                        } else {
                            const parts = importPath.split('/');
                            const pkgName = importPath.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
                            importsToResolve.push({ path: importPath, names: importedNames, details: importDetails, pkgName, isTypeOnly });
                        }
                    }
                },
                leave: function () {
                    parentStack.pop();
                }
            });

            // FITUR 6: Evaluasi Namespace Fallback
            for (const nsMeta of namespaceMap.values()) {
                if (nsMeta.fallbackToStar || nsMeta.names.length === 0) {
                    nsMeta.names.push('*');
                    if (nsMeta.details) nsMeta.details.push({ imported: '*', local: '*', isNamespaceMember: true });
                }
            }

            // Eksekusi Pembangunan Edge (Garis Silsilah) untuk Impor Lokal
            for (const imp of importsToResolve) {
                // enhanced-resolve menangani semua (relatif, absolut, maupun alias)
                const absolute = await resolvePath(projectRoot, fileDir, imp.path);

                if (absolute) {
                    if (absolute.includes('node_modules')) {
                        // Jika ternyata mengarah ke node_modules (misal alias yang salah, atau explicit), 
                        // kita catat saja sebagai package jika belum
                        if (imp.pkgName) usedPackages.add(imp.pkgName);
                    } else {
                        edges.push({ from: currentFile, to: absolute, names: imp.names, isTypeOnly: Boolean(imp.isTypeOnly) });

                        if (!globalRegistry.usedExports.has(absolute)) {
                            globalRegistry.usedExports.set(absolute, new Set());
                        }

                        // FITUR KNIP: Hanya tambahkan ke usedExports jika identifier import TERBUKTI digunakan di file ini atau merupakan re-export!
                        const detailsToProcess = imp.details && imp.details.length > 0 ? imp.details : imp.names.map(n => ({ imported: n, local: n }));
                        detailsToProcess.forEach(item => {
                            const imported = typeof item === 'string' ? item : item.imported;
                            const local = typeof item === 'string' ? item : item.local;
                            const isReExport = typeof item === 'object' && item.isReExport;
                            const isNamespaceMember = typeof item === 'object' && item.isNamespaceMember;

                            if (imported === '*' || imported === 'default' || (isReExport && imported === '*') || isNamespaceMember || usedIdentifiersInFile.has(local)) {
                                globalRegistry.usedExports.get(absolute).add(imported);
                            } else if (isReExport) {
                                globalRegistry.reExportLinks.push({ fromFile: currentFile, fromExport: local, toFile: absolute, toExport: imported });
                            }
                        });

                        if (!visitedFiles.has(absolute)) {
                            let isIgnored = false;
                            if (ruleEngine && ruleEngine.rules.ignoreFiles && ruleEngine.rules.ignoreFiles.length > 0) {
                                const relativePath = path.relative(projectRoot, absolute).replace(/\\/g, '/');
                                isIgnored = micromatch.isMatch(relativePath, ruleEngine.rules.ignoreFiles, { dot: true });
                            }

                            if (!isIgnored) {
                                visitedFiles.add(absolute);
                                liveFiles.add(absolute);
                                validQueue.push(absolute);
                            }
                        }
                    }
                } else {
                    // Jika gagal diselesaikan secara lokal, dan awalnya dicurigai NPM package, pastikan dicatat
                    if (imp.pkgName) {
                        usedPackages.add(imp.pkgName);
                    } else {
                        // FITUR 5: Broken Links (Unresolved Imports)
                        globalRegistry.unresolvedImports.push({
                            file: currentFile,
                            importPath: imp.path
                        });
                    }
                }
            }

        } catch (err) {
            // File gagal di-parse (syntax error, encoding, dll) → skip tapi beri warning
            const relPath = path.relative(projectRoot, currentFile);
            if (err.name === 'ParseError' && process.env.DEBUG) {
                console.warn(`[!] Skip parse error: ${relPath} (line ${err.line || '?'}): ${err.message.split('\n')[0]}`);
            }
            // File tetap dianggap live (sudah masuk liveFiles) tapi tidak dianalisis lebih lanjut
        }
    }

    // 4. Sapuan Konsiliasi Akhir & Resolusi Barrel
    for (const [name, info] of globalRegistry.exports.entries()) {
        if (globalRegistry.usages.has(name)) {
            info.isUnused = false;
        }
    }

    // Barrel Export Resolution (Level 3)
    for (const [file, usedNames] of globalRegistry.usedExports.entries()) {
        if (usedNames.has('*')) {
            try {
                const allExportNames = await resolveBarrelExports(file, projectRoot);
                if (allExportNames.size > 0) {
                    usedNames.delete('*');
                    allExportNames.forEach(n => usedNames.add(n));
                }
            } catch (err) {
                // Ignore barrel resolution failure
                if (process.env.DEBUG) console.warn(err);
            }
        }
    }

    // End-Consumer Tracing: Propagasi re-export backwards dari konsumen akhir (Level 3)
    let reExportChanged = true;
    while (reExportChanged) {
        reExportChanged = false;
        for (const link of globalRegistry.reExportLinks) {
            const fromUsed = globalRegistry.usedExports.get(link.fromFile);
            if (fromUsed && (fromUsed.has(link.fromExport) || fromUsed.has('*'))) {
                let toUsed = globalRegistry.usedExports.get(link.toFile);
                if (!toUsed) {
                    toUsed = new Set();
                    globalRegistry.usedExports.set(link.toFile, toUsed);
                }
                if (!toUsed.has(link.toExport)) {
                    toUsed.add(link.toExport);
                    reExportChanged = true;
                }
            }
        }
    }

    // 5. Pencarian Siklus Maut (Circular Dependencies)
    globalRegistry.circularDependencies = findCircularDependencies(edges);
    // Analyzer intra-file dapat menemukan pola dinamis tambahan yang tidak
    // mengubah reachability graph. Gunakan Set terpisah agar mutasi registry
    // tersebut tidak mengubah daftar unsafe yang sudah dipublikasikan graph.
    const graphUnsafeFiles = new Set(unsafeFiles);
    globalRegistry.unsafeFiles = new Set(graphUnsafeFiles);
    globalRegistry.dynamicDependencyFiles = dynamicDependencyFiles;

    return {
        liveFiles,
        usedPackages,
        edges,
        unsafeFiles: graphUnsafeFiles,
        dynamicDependencyFiles,
        globalRegistry,
    };
}

/**
 * Mendeteksi adanya siklus berputar (A -> B -> C -> A) di dalam graf impor.
 * Menggunakan algoritma Pewarnaan Node (White, Gray, Black) via DFS.
 */
export function findCircularDependencies(edges) {
    const adjList = new Map();

    // Bangun Adjacency List
    for (const edge of edges) {
        if (!adjList.has(edge.from)) adjList.set(edge.from, new Set());
        adjList.get(edge.from).add(edge.to);
    }

    const state = new Map(); // file -> 'gray' | 'black'
    const cycles = [];

    function dfs(node, path) {
        state.set(node, 'gray');
        path.push(node);

        const neighbors = adjList.get(node) || new Set();
        for (const neighbor of neighbors) {
            if (state.get(neighbor) === 'gray') {
                // Siklus ditemukan!
                const cycleStartIdx = path.indexOf(neighbor);
                if (cycleStartIdx !== -1) {
                    const cyclePath = path.slice(cycleStartIdx);
                    cyclePath.push(neighbor); // A -> B -> C -> A

                    // Normalisasi agar tidak duplikat (A->B->A sama dengan B->A->B)
                    const uniqueNodes = cyclePath.slice(0, -1);
                    const cycleKey = [...uniqueNodes].sort().join('|');
                    const isDuplicate = cycles.some(c => c.slice(0, -1).sort().join('|') === cycleKey);

                    if (!isDuplicate) {
                        let isTypeOnlyCycle = true;
                        let hasTypeOnlyEdge = false;
                        for (let i = 0; i < cyclePath.length - 1; i++) {
                            const u = cyclePath[i];
                            const v = cyclePath[i + 1];
                            const edgeObj = edges.find(e => e.from === u && e.to === v);
                            if (!edgeObj || !edgeObj.isTypeOnly) {
                                isTypeOnlyCycle = false;
                            } else {
                                hasTypeOnlyEdge = true;
                            }
                        }
                        cyclePath.isTypeOnly = isTypeOnlyCycle;
                        cyclePath.hasTypeOnlyEdge = hasTypeOnlyEdge;
                        cyclePath.isRuntimeCycle = !hasTypeOnlyEdge;
                        cycles.push(cyclePath);
                    }
                }
            } else if (!state.has(neighbor)) {
                dfs(neighbor, path);
            }
        }

        state.set(node, 'black');
        path.pop();
    }

    for (const node of adjList.keys()) {
        if (!state.has(node)) {
            dfs(node, []);
        }
    }

    return cycles;
}
