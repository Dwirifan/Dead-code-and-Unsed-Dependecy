import fs from 'fs-extra';
import path from 'path';
import glob from 'fast-glob';
import { parseCode } from '../parser/astParser.js';
import estraverse from 'estraverse';

/**
 * Mencoba mensimulasikan resolusi path Node.js secara akurat (Memperkirakan .js, .json, hingga /index.js)
 */
async function resolvePath(baseDir, relativeImport) {
    // 1. Exact path
    let candidate = path.resolve(baseDir, relativeImport);
    
    const tryExtensions = async (p) => {
        const extensions = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.json'];
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
export async function buildProjectGraph(projectRoot, ruleEngine = null) {
    const pkgPath = path.join(projectRoot, 'package.json');
    let pkg = {};
    if (await fs.pathExists(pkgPath)) {
        pkg = await fs.readJson(pkgPath);
    }
    
    // A. Identifikasi SEMUA Titik Masuk Sistem (Entry Points)
    // Mengumpulkan dari berbagai field package.json agar tidak ada file live yang terlewat
    const entrySet = new Set();

    // 1. Tambahkan Custom Entry Points dari RuleEngine
    if (ruleEngine && ruleEngine.rules && ruleEngine.rules.entryPoints) {
        for (const ep of ruleEngine.rules.entryPoints) {
            // Gunakan glob untuk mendukung pattern seperti 'pages/**/*.jsx' atau 'src/'
            const matches = glob.sync(ep, { cwd: projectRoot, absolute: true });
            if (matches.length > 0) {
                matches.forEach(m => entrySet.add(m));
            } else {
                // Jika glob tidak menemukan, coba resolve langsung (mungkin file murni)
                entrySet.add(path.resolve(projectRoot, ep));
            }
        }
    }

    // 2. Baca dari package.json (jika ada)
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

    // 3. Framework Auto-Detection Heuristics (Smart Detection)
    // Membaca jenis framework dari dependensi untuk menebak arsitektur
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const frameworkGlobs = [];
    
    if (allDeps['next']) {
        // Next.js routing conventions
        frameworkGlobs.push('pages/**/*.{js,jsx,ts,tsx}', 'app/**/*.{js,jsx,ts,tsx}', 'src/pages/**/*.{js,jsx,ts,tsx}', 'src/app/**/*.{js,jsx,ts,tsx}');
    } else if (allDeps['nuxt'] || allDeps['nuxt3']) {
        // Nuxt.js conventions
        frameworkGlobs.push('pages/**/*.vue', 'app.vue', 'layouts/**/*.vue');
    } else if (allDeps['@remix-run/react'] || allDeps['@remix-run/node']) {
        // Remix conventions
        frameworkGlobs.push('app/root.{js,jsx,ts,tsx}', 'app/routes/**/*.{js,jsx,ts,tsx}');
    } else if (allDeps['@angular/core']) {
        // Angular conventions
        frameworkGlobs.push('src/main.ts', 'src/app/**/*.ts');
    } else if (allDeps['svelte'] || allDeps['@sveltejs/kit']) {
        // Svelte/SvelteKit conventions
        frameworkGlobs.push('src/main.{js,ts}', 'src/routes/**/*.svelte', 'src/App.svelte');
    } else if (allDeps['vite']) {
        // Vite conventions
        frameworkGlobs.push('src/main.{js,jsx,ts,tsx}', 'src/index.{js,jsx,ts,tsx}');
    } else if (allDeps['react-scripts']) {
        // Create React App conventions
        frameworkGlobs.push('src/index.{js,jsx,ts,tsx}');
    } else if (allDeps['expo'] || allDeps['react-native']) {
        // React Native / Expo conventions
        frameworkGlobs.push('App.{js,jsx,ts,tsx}', 'index.js', 'src/App.{js,jsx,ts,tsx}');
    } else if (allDeps['gatsby']) {
        // Gatsby conventions
        frameworkGlobs.push('src/pages/**/*.{js,jsx,ts,tsx}', 'gatsby-node.js', 'gatsby-browser.js');
    } else if (allDeps['electron']) {
        // Electron conventions
        frameworkGlobs.push('src/main.{js,ts}', 'src/renderer.{js,ts}', 'main.js');
    }

    // Webpack: baca entry dari config file (deteksi proyek Webpack)
    if (allDeps['webpack'] || allDeps['webpack-cli']) {
        const webpackConfigs = ['webpack.config.js', 'webpack.common.js'];
        for (const wc of webpackConfigs) {
            const wcPath = path.resolve(projectRoot, wc);
            if (await fs.pathExists(wcPath)) {
                try {
                    const wcCode = await fs.readFile(wcPath, 'utf-8');
                    // Cari pattern entry: './src/...' di dalam config
                    const entryMatches = wcCode.matchAll(/entry\s*:\s*['"`]([^'"`]+)['"`]/g);
                    for (const m of entryMatches) {
                        const resolved = path.resolve(projectRoot, m[1]);
                        if (await fs.pathExists(resolved)) entrySet.add(resolved);
                    }
                    // Cari pattern entry: { key: './src/...' }
                    const entryObjMatches = wcCode.matchAll(/['"`](\.\/[^'"`]+)['"`]/g);
                    for (const m of entryObjMatches) {
                        if (m[1].includes('src/') || m[1].includes('index')) {
                            const resolved = path.resolve(projectRoot, m[1]);
                            if (await fs.pathExists(resolved)) entrySet.add(resolved);
                        }
                    }
                } catch { /* Gagal baca webpack config, skip */ }
            }
        }
    }

    if (frameworkGlobs.length > 0) {
        for (const pattern of frameworkGlobs) {
            const matches = glob.sync(pattern, { cwd: projectRoot, absolute: true });
            matches.forEach(m => entrySet.add(m));
        }
    }

    // Fallback: kandidat file umum jika tidak ada field di atas dan bukan framework yang dikenali
    if (entrySet.size === 0) {
        const candidates = [
            'index.js', 'index.ts', 
            'main.js', 'main.ts', 
            'src/index.js', 'src/index.ts', 
            'app.js', 'app.ts', 
            'server.js', 'server.ts'
        ];
        for (const c of candidates) {
            const full = path.resolve(projectRoot, c);
            if (await fs.pathExists(full)) { entrySet.add(full); break; }
        }
    }

    // HTML Entry Point Detection: Proyek Vanilla JS yang memuat script dari index.html
    if (entrySet.size === 0) {
        const htmlCandidates = ['index.html', 'public/index.html', 'src/index.html'];
        for (const htmlFile of htmlCandidates) {
            const htmlPath = path.resolve(projectRoot, htmlFile);
            if (await fs.pathExists(htmlPath)) {
                try {
                    const htmlCode = await fs.readFile(htmlPath, 'utf-8');
                    // Cari semua <script src="..."> tags (type="module" atau tanpa type)
                    const scriptMatches = htmlCode.matchAll(/<script[^>]*\bsrc\s*=\s*["']([^"']+\.(?:js|mjs|ts))["'][^>]*>/gi);
                    for (const m of scriptMatches) {
                        const scriptSrc = m[1];
                        // Skip CDN / external URLs
                        if (scriptSrc.startsWith('http://') || scriptSrc.startsWith('https://') || scriptSrc.startsWith('//')) continue;
                        const resolved = path.resolve(path.dirname(htmlPath), scriptSrc);
                        if (await fs.pathExists(resolved)) {
                            entrySet.add(resolved);
                        }
                    }
                } catch { /* Gagal baca HTML, skip */ }
                break;
            }
        }
    }

    // Ultimate Fallback: cari semua index.js di dalam src/ secara rekursif
    if (entrySet.size === 0) {
        const deepSearch = glob.sync('src/**/index.{js,ts,jsx,tsx}', { cwd: projectRoot, absolute: true });
        if (deepSearch.length > 0) {
            deepSearch.forEach(f => entrySet.add(f));
        }
    }

    // Validasi: Periksa apakah entry point yang dikonfigurasi benar-benar ada di disk
    const validatedEntries = [];
    const invalidEntries = [];
    for (const entry of entrySet) {
        if (await fs.pathExists(entry)) {
            validatedEntries.push(entry);
        } else {
            invalidEntries.push(entry);
        }
    }

    if (invalidEntries.length > 0) {
        console.warn(`[!] Entry point tidak ditemukan (diabaikan):`);
        invalidEntries.forEach(e => console.warn(`    - ${path.relative(projectRoot, e)}`));
    }

    const entryFiles = validatedEntries;

    if (entryFiles.length === 0) {
        throw new Error('Could not auto-detect entry point. Please specify "main" in package.json or define "entryPoints" in .deadkillerrc.json.');
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
                if (absolute && !absolute.includes('node_modules')) {
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
