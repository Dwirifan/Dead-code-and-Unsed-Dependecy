import fs from 'fs-extra';
import path from 'path';
import { parseCode } from '../parser/astParser.js';
import estraverse from 'estraverse';

/**
 * Mencoba mensimulasikan resolusi path Node.js secara akurat (Memperkirakan .js, .json, hingga /index.js)
 */
async function resolvePath(baseDir, relativeImport) {
    // 1. Exact path
    let candidate = path.resolve(baseDir, relativeImport);
    
    const tryExtensions = async (p) => {
        const extensions = ['.js', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.json'];
        for (const ext of extensions) {
            if (await fs.pathExists(p + ext)) return p + ext;
        }
        return null;
    };

    // Mengecek apakah target mengarah langsung ke sebuah file spesifik
    if (await fs.pathExists(candidate) && (await fs.stat(candidate)).isFile()) return candidate;
    
    // Menebak ekstensi bila resolusi spesifik gagal
    let found = await tryExtensions(candidate);
    if (found) return found;

    // Jika target terdeteksi sebagai folder, asumsikan memanggil file `index` di dalamnya
    if (await fs.pathExists(candidate) && (await fs.stat(candidate)).isDirectory()) {
         // try candidate/index.js
         found = await tryExtensions(path.join(candidate, 'index'));
         if (found) return found;
    }

    return null; // Gagal diresolusi secara lokal (Bisa jadi impor dinamis paksa atau path rusak)
}

/**
 * Membangun sebuah graf struktural yang komprehensif merayapi titik masuk (entry point) menggunakan BFS.
 * @param {string} projectRoot - Direktori proyek
 * @returns {Promise<{ liveFiles: Set<string>, usedPackages: Set<string>, edges: Array, unsafeFiles: Set<string>, globalRegistry: Object }>}
 */
export async function buildProjectGraph(projectRoot) {
    const pkgPath = path.join(projectRoot, 'package.json');
    if (!await fs.pathExists(pkgPath)) {
        throw new Error('No package.json found. Cannot determine entry point.');
    }
    const pkg = await fs.readJson(pkgPath);
    
    // A. Identifikasi SEMUA Titik Masuk Sistem (Entry Points)
    // Mengumpulkan dari berbagai field package.json agar tidak ada file live yang terlewat
    const entrySet = new Set();

    // main field
    if (pkg.main) entrySet.add(path.resolve(projectRoot, pkg.main));

    // module field (ESM builds)
    if (pkg.module) entrySet.add(path.resolve(projectRoot, pkg.module));

    // bin field — CLI entry points (sangat penting untuk CLI tools)
    if (pkg.bin) {
        if (typeof pkg.bin === 'string') {
            entrySet.add(path.resolve(projectRoot, pkg.bin));
        } else {
            Object.values(pkg.bin).forEach(b => entrySet.add(path.resolve(projectRoot, b)));
        }
    }

    // exports field (modern package exports map)
    if (pkg.exports) {
        const collectExports = (val) => {
            if (typeof val === 'string') {
                entrySet.add(path.resolve(projectRoot, val));
            } else if (typeof val === 'object' && val !== null) {
                Object.values(val).forEach(collectExports);
            }
        };
        collectExports(pkg.exports);
    }

    // Fallback: kandidat file umum jika tidak ada field di atas
    if (entrySet.size === 0) {
        const candidates = ['index.js', 'main.js', 'src/index.js', 'app.js', 'server.js'];
        for (const c of candidates) {
            const full = path.resolve(projectRoot, c);
            if (await fs.pathExists(full)) { entrySet.add(full); break; }
        }
    }

    const entryFiles = [...entrySet];

    if (entryFiles.length === 0) {
        throw new Error('Could not auto-detect entry point. Please specify "main" in package.json.');
    }

    // B. Pembangunan Graf Keterhubungan dengan Metode Breadth-First Search (BFS)
    const liveFiles = new Set();
    const visitedFiles = new Set();
    const usedPackages = new Set();
    const edges = []; // { from, to }
    const queue = [...entryFiles];

    // C. Status Pencatatan Keamanan (Bailout Heuristics) & Memori Analisis
    const unsafeFiles = new Set();
    const globalRegistry = {
        usedExports: new Map(), // file -> Set of used exported names
        exports: new Map(), // Exported/Declared Names -> { isUnused, file } (legacy)
        usages: new Set()   // Used/Called Names (legacy)
    };

    // Mark entries as live potentially (need verify existence)
    // We filter queue initially
    const validQueue = [];
    for (const f of queue) {
        if (await fs.pathExists(f)) {
            validQueue.push(f);
            visitedFiles.add(f);
            liveFiles.add(f);
        }
    }
    
    while (validQueue.length > 0) {
        const currentFile = validQueue.shift();
        const fileDir = path.dirname(currentFile);
        
        try {
            const code = await fs.readFile(currentFile, 'utf-8');
            // Skip binary or non-js
            if (path.extname(currentFile) === '.json') continue; // Don't parse JSON as JS

            const ast = parseCode(code);
            const importsToResolve = [];

            // Sapuan Tunggal Melintasi AST (Satu pass agar efisien O(N)) untuk Graf dan Pendeteksian Kerentanan
            estraverse.traverse(ast, {
                fallback: 'iteration', // Handle unknown node types (e.g. TypeScript AST nodes)
                enter: function (node, parent) {
                    // --- 1. Bailout Heuristics (Dynamic Code Detection) ---
                    if (node.type === 'CallExpression' && node.callee.name === 'eval') {
                        unsafeFiles.add(currentFile);
                    }
                    if (node.type === 'WithStatement') {
                        unsafeFiles.add(currentFile);
                    }
                    if (node.type === 'MemberExpression' && node.computed === true) {
                        // Only mark unsafe if property is truly dynamic (not a literal like obj[0] or obj['key'])
                        if (node.property.type !== 'Literal') {
                            unsafeFiles.add(currentFile);
                        }
                    }

                    // --- 2. Call Graph ---
                    // Explicit usages inside CallExpression and MemberExpression 
                    // are now handled locally by actual scope analysis inside deadCodeAnalyzer.
                    
                    // Mendata Pendeklarasian Ekspor untuk dilacak (Legacy/Penyokong)
                    if (node.type === 'FunctionDeclaration' && node.id) {
                        if (!globalRegistry.exports.has(node.id.name)) {
                            globalRegistry.exports.set(node.id.name, { isUnused: true, file: currentFile }); // Mark
                        }
                    }
                    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
                        if (!globalRegistry.exports.has(node.id.name)) {
                            globalRegistry.exports.set(node.id.name, { isUnused: true, file: currentFile }); // Mark
                        }
                    }

                    // --- 3. Pelacakan Instruksi Impor (Sistem Rekat Graf) ---
                    let importPath = null;
                    let importedNames = [];

                    if (node.type === 'CallExpression' && node.callee.name === 'require' && node.arguments[0]?.value) {
                         importPath = node.arguments[0].value;
                         importedNames = ['*']; // Conservative fallback
                         if (parent && parent.type === 'VariableDeclarator' && parent.id.type === 'ObjectPattern') {
                             importedNames = parent.id.properties.map(p => p.type === 'Property' && p.key.type === 'Identifier' ? p.key.name : '*');
                         } else if (parent && parent.type === 'MemberExpression' && parent.property.type === 'Identifier' && !parent.computed) {
                             importedNames = [parent.property.name];
                         }
                    } else if (node.type === 'ImportDeclaration' && node.source?.value) {
                         importPath = node.source.value;
                         if (node.specifiers) {
                             node.specifiers.forEach(spec => {
                                 if (spec.type === 'ImportSpecifier') importedNames.push(spec.imported.name);
                                 else if (spec.type === 'ImportDefaultSpecifier') importedNames.push('default');
                                 else if (spec.type === 'ImportNamespaceSpecifier') importedNames.push('*');
                             });
                         }
                         if (importedNames.length === 0) importedNames.push('*'); // side-effect import
                    } else if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source?.value) {
                         importPath = node.source.value;
                         if (node.type === 'ExportAllDeclaration') {
                             importedNames.push('*');
                         } else if (node.specifiers) {
                             node.specifiers.forEach(spec => {
                                 if (spec.type === 'ExportSpecifier') importedNames.push(spec.local.name);
                             });
                         }
                    } else if (node.type === 'ImportExpression' && node.source) {
                         if (node.source.type === 'Literal') {
                             importPath = node.source.value;
                             importedNames.push('*');
                         } else if (node.source.type === 'TemplateLiteral' && node.source.expressions.length === 0) {
                             importPath = node.source.quasis[0].value.raw;
                             importedNames.push('*');
                         } else {
                             unsafeFiles.add(currentFile);
                         }
                    }

                    if (importPath) {
                        if (importPath.startsWith('.') || importPath.startsWith('/') || path.isAbsolute(importPath)) {
                            importsToResolve.push({ path: importPath, names: importedNames });
                        } else {
                            const parts = importPath.split('/');
                            const pkgName = importPath.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
                            usedPackages.add(pkgName);
                        }
                    }
                }
            });

            // Eksekusi Pembangunan Edge (Garis Silsilah) untuk Impor Lokal
            for (const imp of importsToResolve) {
                const absolute = await resolvePath(fileDir, imp.path);
                if (absolute) {
                    // Record Edge: currentFile -> absolute (berserta label trace impor)
                    edges.push({ from: currentFile, to: absolute, names: imp.names });

                    if (!globalRegistry.usedExports.has(absolute)) {
                        globalRegistry.usedExports.set(absolute, new Set());
                    }
                    imp.names.forEach(name => globalRegistry.usedExports.get(absolute).add(name));

                    if (!visitedFiles.has(absolute)) {
                        visitedFiles.add(absolute);
                        liveFiles.add(absolute);
                        validQueue.push(absolute);
                    }
                }
            }

        } catch (err) {
            // Ignore parse errors
        }
    }

    // Sapuan Konsiliasi Akhir: Cocokkan referensi global terhadap ekspor yang digunakan
    for (const [name, info] of globalRegistry.exports.entries()) {
        if (globalRegistry.usages.has(name)) {
            info.isUnused = false; // It is used somewhere in the Call Graph
        }
    }

    return { liveFiles, usedPackages, edges, unsafeFiles, globalRegistry };
}
