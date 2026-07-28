import fs from 'fs-extra';
import path from 'path';
import glob from 'fast-glob';

/**
 * Menganalisis dan menemukan titik masuk (entry points) dari sebuah proyek
 * dengan menggunakan aturan kustom, package.json, atau heuristik framework.
 * 
 * @param {string} projectRoot - Path absolut direktori proyek
 * @param {Object} ruleEngine - Instance rule engine (opsional)
 * @returns {Promise<Array<string>>} Daftar file entry points terverifikasi
 */
export async function findEntryPoints(projectRoot, ruleEngine = null) {
    const pkgPath = path.join(projectRoot, 'package.json');
    let pkg = {};
    if (await fs.pathExists(pkgPath)) {
        pkg = await fs.readJson(pkgPath);
    }

    // A. Identifikasi SEMUA Titik Masuk Sistem (Entry Points)
    const entrySet = new Set();

    // FITUR 1: Workspace / Monorepo Parser
    if (pkg.workspaces) {
        const workspacePatterns = Array.isArray(pkg.workspaces) ? pkg.workspaces : (pkg.workspaces.packages || []);
        for (const pattern of workspacePatterns) {
            const workspaceDirs = glob.sync(pattern, { cwd: projectRoot, onlyDirectories: true, absolute: true });
            for (const wsDir of workspaceDirs) {
                try {
                    const wsPkgPath = path.join(wsDir, 'package.json');
                    if (await fs.pathExists(wsPkgPath)) {
                        const wsPkg = await fs.readJson(wsPkgPath);
                        if (wsPkg.main) entrySet.add(path.resolve(wsDir, wsPkg.main));
                        if (wsPkg.module) entrySet.add(path.resolve(wsDir, wsPkg.module));
                        if (wsPkg.bin) {
                            if (typeof wsPkg.bin === 'string') {
                                entrySet.add(path.resolve(wsDir, wsPkg.bin));
                            } else {
                                Object.values(wsPkg.bin).forEach(b => entrySet.add(path.resolve(wsDir, b)));
                            }
                        }
                    }
                } catch (e) {
                    if (process.env.DEBUG) {
                        console.warn(`[Warning] Gagal membaca package.json di workspace ${wsDir}:`, e.message);
                    }
                }
            }
        }
    }

    // 1. Tambahkan Custom Entry Points dari RuleEngine
    if (ruleEngine && ruleEngine.rules && ruleEngine.rules.entryPoints) {
        for (const ep of ruleEngine.rules.entryPoints) {
            const matches = glob.sync(ep, { cwd: projectRoot, absolute: true });
            if (matches.length > 0) {
                matches.forEach(m => entrySet.add(path.normalize(m)));
            } else {
                entrySet.add(path.resolve(projectRoot, ep));
            }
        }
    }

    // 2. Baca dari package.json (jika ada)
    if (pkg.main) entrySet.add(path.resolve(projectRoot, pkg.main));
    if (pkg.module) entrySet.add(path.resolve(projectRoot, pkg.module));

    if (pkg.bin) {
        if (typeof pkg.bin === 'string') {
            entrySet.add(path.resolve(projectRoot, pkg.bin));
        } else {
            Object.values(pkg.bin).forEach(b => entrySet.add(path.resolve(projectRoot, b)));
        }
    }

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

    // 3. Framework Auto-Detection Heuristics
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const frameworkGlobs = [];

    if (allDeps['next']) {
        frameworkGlobs.push('pages/**/*.{js,jsx,ts,tsx}', 'app/**/*.{js,jsx,ts,tsx}', 'src/pages/**/*.{js,jsx,ts,tsx}', 'src/app/**/*.{js,jsx,ts,tsx}');
    } else if (allDeps['nuxt'] || allDeps['nuxt3']) {
        frameworkGlobs.push('pages/**/*.vue', 'app.vue', 'layouts/**/*.vue');
    } else if (allDeps['@remix-run/react'] || allDeps['@remix-run/node']) {
        frameworkGlobs.push('app/root.{js,jsx,ts,tsx}', 'app/routes/**/*.{js,jsx,ts,tsx}');
    } else if (allDeps['@angular/core']) {
        frameworkGlobs.push('src/main.ts', 'src/app/**/*.ts');
    } else if (allDeps['svelte'] || allDeps['@sveltejs/kit']) {
        frameworkGlobs.push('src/main.{js,ts}', 'src/routes/**/*.svelte', 'src/App.svelte');
    } else if (allDeps['vite']) {
        frameworkGlobs.push('src/main.{js,jsx,ts,tsx}', 'src/index.{js,jsx,ts,tsx}');
    } else if (allDeps['react-scripts']) {
        frameworkGlobs.push('src/index.{js,jsx,ts,tsx}');
    } else if (allDeps['expo'] || allDeps['react-native']) {
        frameworkGlobs.push('App.{js,jsx,ts,tsx}', 'index.js', 'src/App.{js,jsx,ts,tsx}');
    } else if (allDeps['gatsby']) {
        frameworkGlobs.push('src/pages/**/*.{js,jsx,ts,tsx}', 'gatsby-node.js', 'gatsby-browser.js');
    } else if (allDeps['electron']) {
        frameworkGlobs.push('src/main.{js,ts}', 'src/renderer.{js,ts}', 'main.js');
    }

    // Webpack deteksi (Legacy)
    if (allDeps['webpack'] || allDeps['webpack-cli']) {
        const webpackConfigs = ['webpack.config.js', 'webpack.common.js'];
        for (const wc of webpackConfigs) {
            const wcPath = path.resolve(projectRoot, wc);
            if (await fs.pathExists(wcPath)) {
                try {
                    const wcCode = await fs.readFile(wcPath, 'utf-8');
                    const entryMatches = wcCode.matchAll(/entry\s*:\s*['"`]([^'"`]+)['"`]/g);
                    for (const m of entryMatches) {
                        const resolved = path.resolve(projectRoot, m[1]);
                        if (await fs.pathExists(resolved)) entrySet.add(resolved);
                    }
                    const entryObjMatches = wcCode.matchAll(/['"`](\.\/[^'"`]+)['"`]/g);
                    for (const m of entryObjMatches) {
                        if (m[1].includes('src/') || m[1].includes('index')) {
                            const resolved = path.resolve(projectRoot, m[1]);
                            if (await fs.pathExists(resolved)) entrySet.add(resolved);
                        }
                    }
                } catch (err) {
                    if (process.env.DEBUG) {
                        console.warn(`[Warning] Gagal membaca konfigurasi Webpack ${wcPath}:`, err.message);
                    }
                }
            }
        }
    }

    // FITUR 2: Arsitektur Plugin (Config Files sebagai Entry Point Otomatis)
    const configEntrySet = new Set();
    const pluginConfigFiles = [
        'vite.config.js', 'vite.config.ts', 'vite.config.mjs', 'vite.config.cjs',
        'webpack.config.js', 'webpack.config.ts', 'webpack.common.js', 'webpack.dev.js', 'webpack.prod.js',
        'next.config.js', 'next.config.mjs',
        'nuxt.config.js', 'nuxt.config.ts',
        'rollup.config.js', 'rollup.config.ts', 'rollup.config.mjs',
        'jest.config.js', 'jest.config.ts', 'jest.config.mjs', 'jest.config.cjs',
        'vitest.config.js', 'vitest.config.ts', 'vitest.config.mjs', 'vitest.config.cjs',
        'playwright.config.js', 'playwright.config.ts',
        'cypress.config.js', 'cypress.config.ts',
        '.eslintrc.js', '.eslintrc.cjs', 'eslint.config.js', 'eslint.config.mjs', 'eslint.config.cjs',
        'prettier.config.js', 'prettier.config.cjs',
        'tailwind.config.js', 'tailwind.config.ts', 'tailwind.config.cjs',
        'postcss.config.js', 'postcss.config.cjs',
        'svelte.config.js',
        'babel.config.js', 'babel.config.cjs',
        'commitlint.config.js',
        'lint-staged.config.js',
        'tsdown.config.js', 'tsdown.config.ts', 'tsdown.config.mjs', 'tsdown.config.cjs'
    ];
    for (const conf of pluginConfigFiles) {
        const confPath = path.resolve(projectRoot, conf);
        if (await fs.pathExists(confPath)) {
            configEntrySet.add(confPath);
        }
    }

    if (frameworkGlobs.length > 0) {
        for (const pattern of frameworkGlobs) {
            const matches = glob.sync(pattern, { cwd: projectRoot, absolute: true });
            matches.forEach(m => entrySet.add(path.resolve(m)));
        }
    }

    // Fallback: kandidat umum jika source entry points tidak ada atau tidak valid (misal dist belum dibuild)
    let hasValidSource = false;
    for (const entry of entrySet) {
        if (fs.existsSync(entry) && !entry.endsWith('.json')) { hasValidSource = true; break; }
    }
    
    if (!hasValidSource) {
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

    // HTML Fallback
    for (const entry of entrySet) { if (fs.existsSync(entry) && !entry.endsWith('.json')) { hasValidSource = true; break; } }
    
    if (!hasValidSource) {
        const htmlCandidates = ['index.html', 'public/index.html', 'src/index.html'];
        for (const htmlFile of htmlCandidates) {
            const htmlPath = path.resolve(projectRoot, htmlFile);
            if (await fs.pathExists(htmlPath)) {
                try {
                    const htmlCode = await fs.readFile(htmlPath, 'utf-8');
                    const scriptMatches = htmlCode.matchAll(/<script[^>]*\bsrc\s*=\s*["']([^"']+\.(?:js|mjs|ts))["'][^>]*>/gi);
                    for (const m of scriptMatches) {
                        const scriptSrc = m[1];
                        if (scriptSrc.startsWith('http://') || scriptSrc.startsWith('https://') || scriptSrc.startsWith('//')) continue;
                        const resolved = path.resolve(path.dirname(htmlPath), scriptSrc);
                        if (await fs.pathExists(resolved)) {
                            entrySet.add(resolved);
                        }
                    }
                } catch (err) {
                    if (process.env.DEBUG) {
                        console.warn(`[Warning] Gagal memparsing HTML file ${htmlPath}:`, err.message);
                    }
                }
                break;
            }
        }
    }

    // Ultimate Fallback
    for (const entry of entrySet) { if (fs.existsSync(entry) && !entry.endsWith('.json')) { hasValidSource = true; break; } }
    if (!hasValidSource) {
        const deepSearch = glob.sync('src/**/index.{js,ts,jsx,tsx}', { cwd: projectRoot, absolute: true });
        if (deepSearch.length > 0) {
            deepSearch.forEach(f => entrySet.add(path.resolve(f)));
        }
    }

    // Validasi eksistensi file
    const validatedEntries = [];
    const invalidEntries = [];

    // Gabungkan file config yang ditemukan ke dalam entrySet utama
    for (const conf of configEntrySet) {
        entrySet.add(conf);
    }
    
    for (const entry of entrySet) {
        let isIgnored = false;
        if (ruleEngine && ruleEngine.rules.ignoreFiles && ruleEngine.rules.ignoreFiles.length > 0) {
            const relativePath = path.relative(projectRoot, entry).replace(/\\/g, '/');
            isIgnored = ruleEngine.rules.ignoreFiles.some(pattern => relativePath.includes(pattern) || relativePath.startsWith(pattern));
        }

        if (isIgnored) {
            continue;
        }

        if (await fs.pathExists(entry)) {
            validatedEntries.push(entry);
        } else {
            invalidEntries.push(entry);
        }
    }

    if (invalidEntries.length > 0 && process.env.DEBUG) {
        console.warn(`[!] Entry point tidak ditemukan (diabaikan):`);
        invalidEntries.forEach(e => console.warn(`    - ${path.relative(projectRoot, e)}`));
    }

    if (validatedEntries.length === 0) {
        throw new Error('Could not auto-detect entry point. Please specify "main" in package.json or define "entryPoints" in .deadkillerrc.json.');
    }

    return validatedEntries;
}
