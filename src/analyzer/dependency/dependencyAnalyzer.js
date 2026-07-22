import fs from 'fs-extra';
import path from 'path';
import { builtinModules } from 'module';
import { runConfigParsers } from './configParsers/configParserRunner.js';

// Set modul bawaan Node.js untuk filter Missing Dependencies
// Contoh: 'path', 'fs', 'url', 'child_process', 'perf_hooks', dll
const NODE_BUILTINS = new Set([
    ...builtinModules,
    ...builtinModules.map(m => `node:${m}`), // format "node:fs", "node:path"
]);


/**
 * Modul Analisis Dependensi (Unused Dependency Analyzer)
 *
 * Bertanggung jawab atas seluruh siklus deteksi anomali dependensi NPM:
 *
 *   1. UNUSED RUNTIME DEPS   — Ada di `dependencies`, tapi tidak pernah di-import di kode.
 *   2. MISSING DEPENDENCIES  — Di-import di kode, tapi lupa didaftarkan ke `package.json`.
 *      (Paket tersebut mungkin tersedia sebagai transitive dependency paket lain,
 *       yang berarti berpotensi hilang jika paket induknya diperbarui.)
 *   3. DEAD DEV DEPENDENCIES — Ada di `devDependencies`, tidak dipakai di kode
 *      maupun di file konfigurasi (ESLint, Babel, dll.) proyek.
 *
 * Arsitektur Pipeline:
 *   (A) extractBinFromScripts()  → membaca npm scripts di package.json untuk menemukan
 *       CLI tools yang benar-benar dipakai → hasilnya dimasukkan ke `usedPackages`.
 *   (B) runConfigParsers()       → membaca file config (ESLint, Babel) untuk menemukan
 *       devDependencies yang dipakai di sana.
 *   (C) Set Difference Forward   → runtimeDeps - usedPackages = unusedRuntimeDeps
 *   (D) Set Difference Reverse   → usedPackages - allDeclared = missingDeps
 *   (E) Set Difference DevDeps   → devDeps - (usedPackages ∪ configUsedPackages) = deadDevDeps
 *
 * Modul ini menerima data `usedPackages` dari Project Graph (BFS) agar
 * tidak perlu melakukan traversal ulang — cukup sekali scan, data dipakai bersama.
 */

// ─────────────────────────────────────────────────────────────────────────────
// KONSTANTA: Paket yang SELALU dikecualikan dari laporan "dead devDependency"
// karena mereka beroperasi secara implisit (tanpa konfigurasi eksplisit).
// ─────────────────────────────────────────────────────────────────────────────
const ALWAYS_EXCLUDED_DEV_PATTERNS = [
    // 1. TypeScript & Typing
    /^@types\//,                        // Semua file definisi tipe (sangat umum)
    
    // 2. Testing Frameworks (Implicit Plugins, Reporters, Coverage)
    /^@vitest\//,                       // Vitest plugins (@vitest/coverage-v8, @vitest/ui)
    /^jest-/,                           // Jest plugins (jest-environment-jsdom, dll)
    /^@testing-library\//,              // Testing library ekosistem (bereaksi implisit di test)
    /^cypress-/,                        // Cypress plugins
    
    // 3. Linters & Formatters (Plugins dan Configs)
    /^eslint-(plugin|config)-/,         // ESLint standar plugins & configs
    /^@typescript-eslint\//,            // ESLint untuk TypeScript
    /^prettier-plugin-/,                // Prettier plugins (seperti tailwindcss-plugin)
    /^stylelint-(config|plugin)-/,      // Stylelint ekosistem
    
    // 4. Bundlers & Compilers (Loaders & Plugins)
    /^@babel\/(plugin|preset)-/,        // Babel resmi
    /^babel-(plugin|preset)-/,          // Babel komunitas
    /^@rollup\/plugin-/,                // Rollup plugins resmi
    /^rollup-plugin-/,                  // Rollup plugins komunitas
    /^vite-plugin-/,                    // Vite plugins
    /^@vitejs\/plugin-/,                // Vite plugins resmi
    /-loader$/,                         // Webpack loaders (css-loader, ts-loader)
    /-webpack-plugin$/,                 // Webpack plugins
    
    // 5. CSS & Styling Preprocessors
    /^postcss-/,                        // PostCSS plugins (autoprefixer, dll)
    /^tailwindcss/,                     // Tailwind dan ekosistemnya
    
    // 6. Meta-Frameworks Plugins
    /^gatsby-(plugin|source|transformer)-/,
    /^@nuxtjs\//,
];

const ALWAYS_EXCLUDED_DEV_EXACT = new Set([
    // Compilers & Execution
    'typescript', 'ts-node', 'tsx', 'esbuild', 'swc', '@swc/core',
    
    // Core Bundlers
    'webpack', 'webpack-cli', 'webpack-dev-server', 'vite', 'rollup', 'parcel',
    
    // Core Testing
    'vitest', 'jest', 'mocha', 'chai', 'cypress', 'playwright', '@playwright/test',
    
    // Core Linters & Formatters
    'eslint', 'prettier', 'stylelint',
    
    // Git Hooks & Workflow
    'husky', 'lint-staged', 'commitlint', '@commitlint/cli', '@commitlint/config-conventional',
    
    // CLI Utilities (Umum digunakan di npm scripts)
    'rimraf', 'cross-env', 'concurrently', 'npm-run-all', 'nodemon', 'pm2', 'dotenv', 'shx'
]);

// ─────────────────────────────────────────────────────────────────────────────
// FUNGSI UTILITAS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Membaca package.json dan mengembalikan semua dependensi yang terdaftar.
 * Memisahkan `dependencies` (runtime) dan `devDependencies` (build tools).
 *
 * @param {string} projectRoot - Path direktori akar proyek
 * @returns {Promise<{runtimeDeps: Set<string>, devDeps: Set<string>, pkg: object}>}
 * @throws {Error} Jika file package.json tidak ditemukan
 */
export async function getDeclaredDependencies(projectRoot) {
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (!await fs.pathExists(packageJsonPath)) {
        throw new Error('File package.json tidak ditemukan di: ' + projectRoot);
    }

    const pkg = await fs.readJson(packageJsonPath);
    const runtimeDeps = new Set(Object.keys(pkg.dependencies || {}));
    const devDeps = new Set(Object.keys(pkg.devDependencies || {}));

    return { runtimeDeps, devDeps, pkg };
}

/**
 * NPM Scripts Parser
 *
 * Terinspirasi dari depcheck/src/special/bin.js
 *
 * Mengekstrak nama binary / CLI tool yang benar-benar dipakai dari bagian
 * "scripts" di package.json. Hasilnya digunakan untuk menandai devDependencies
 * yang dipanggil via CLI sebagai "masih terpakai" (bukan dead devDep).
 *
 * Algoritma:
 *   - Baca semua nilai string dari pkg.scripts
 *   - Tokenisasi setiap nilai script dengan split whitespace & &&/||/;
 *   - Token pertama setiap sub-command biasanya nama binary (misal: rimraf, webpack)
 *   - Juga cocokkan token yang ada di dalam semua nilai devDeps
 *
 * @param {object} pkg      - Objek package.json yang sudah diparsing
 * @param {Set<string>} devDeps - Set nama devDependencies yang dideklarasikan
 * @returns {Set<string>} - Set nama paket yang terdeteksi digunakan di scripts
 */
function extractBinFromScripts(pkg, devDeps) {
    const usedViaCli = new Set();
    if (!pkg.scripts || typeof pkg.scripts !== 'object') return usedViaCli;

    // Ekstrak semua string scripts
    const allScripts = Object.values(pkg.scripts).filter(s => typeof s === 'string');

    for (const script of allScripts) {
        // Pecah berdasarkan operator chain (&&, ||, ;, |) dan whitespace
        const tokens = script
            .split(/&&|\|\||;|\||\s+/)
            .map(t => t.trim())
            .filter(Boolean);

        for (const token of tokens) {
            // Hapus flag (diawali dengan -) dan path (mengandung /)
            if (token.startsWith('-') || token.includes('/') || token.includes('=')) continue;
            // Hapus variabel environment (KEY=VALUE)
            if (/^\w+=/.test(token)) continue;

            // Cek apakah token ini adalah salah satu nama paket devDependency
            // (exact match atau sebagai bagian dari nama binary scoped package)
            for (const dep of devDeps) {
                // Nama paket scoped: @scope/package → binary biasanya "package" atau nama terakhir
                const binName = dep.startsWith('@') ? dep.split('/').pop() : dep;
                if (token === binName || token === dep) {
                    usedViaCli.add(dep);
                    break;
                }
            }
        }
    }

    return usedViaCli;
}

// ─────────────────────────────────────────────────────────────────────────────
// FUNGSI UTAMA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Menganalisis dan mendeteksi seluruh anomali dependensi NPM.
 *
 * @param {string} projectRoot   - Path direktori akar proyek
 * @param {Set<string>} usedPackages - Set berisi nama paket NPM yang benar-benar
 *                                    dipakai oleh kode (dari buildProjectGraph / BFS)
 * @returns {Promise<object>} Objek laporan dependensi lengkap
 */
export async function findUnusedDependencies(projectRoot, usedPackages, ruleEngine = null) {
    const { runtimeDeps, devDeps, pkg } = await getDeclaredDependencies(projectRoot);

    // ── FASE A: Inject Implicit Framework Dependencies ────────────────────────
    // Framework modern seperti Next.js, CRA, atau Vite menyertakan dependensi
    // secara implisit tanpa instruksi `import` eksplisit di kode.
    const implicitDependencies = new Map([
        ['next',                     ['react', 'react-dom', 'eslint-config-next']],
        ['react-scripts',            ['react', 'react-dom']],
        ['@vitejs/plugin-react',     ['react', 'react-dom']],
        ['@vitejs/plugin-react-swc', ['react', 'react-dom']],
        ['nuxt',                     ['vue']],
        ['nuxt3',                    ['vue']],
        ['gatsby',                   ['react', 'react-dom']],
    ]);

    const allDeclared = new Set([...runtimeDeps, ...devDeps]);
    for (const [framework, implicitlyUsed] of implicitDependencies.entries()) {
        if (allDeclared.has(framework) || usedPackages.has(framework)) {
            implicitlyUsed.forEach(p => usedPackages.add(p));
        }
    }

    // ── FASE B: NPM Scripts Parser ────────────────────────────────────────────
    // Temukan devDependencies yang dipanggil sebagai CLI binary di npm scripts.
    // Hasilnya langsung masuk ke usedPackages agar tidak dihitung sebagai dead.
    const usedViaCli = extractBinFromScripts(pkg, devDeps);
    for (const dep of usedViaCli) {
        usedPackages.add(dep);
    }

    // ── FASE C: Config File Parsers ───────────────────────────────────────────
    // Temukan devDependencies yang dipakai di dalam file konfigurasi
    // (mis. plugins di .eslintrc.json, presets di babel.config.json).
    const configUsedPackages = await runConfigParsers(projectRoot);

    // ── FASE D: Kalkulasi Unused Runtime Dependencies ─────────────────────────
    // Tetap gunakan filter pattern untuk paket yang tidak bisa dideteksi via AST/scripts/config
    const LEGACY_PATTERNS = ALWAYS_EXCLUDED_DEV_PATTERNS;
    const LEGACY_EXACT = ALWAYS_EXCLUDED_DEV_EXACT;

    const unusedRuntime = [];
    for (const dep of runtimeDeps) {
        if (usedPackages.has(dep)) continue;
        if (LEGACY_EXACT.has(dep)) continue;
        if (LEGACY_PATTERNS.some(p => p.test(dep))) continue;
        if (ruleEngine && ruleEngine.isIgnoredDependency(dep)) continue;
        unusedRuntime.push(dep);
    }

    // ── FASE E: Kalkulasi Missing Dependencies (Set Difference Terbalik) ──────
    // Paket yang dipakai di kode tapi tidak dideklarasikan di package.json sama sekali.
    // Ini berbahaya karena mengandalkan transitive dependency yang bisa hilang kapan saja.
    //
    // Filter yang diterapkan:
    //   1. Modul bawaan Node.js (path, fs, url, perf_hooks, dll.) — bukan paket NPM
    //   2. Path relatif ('./...') atau absolut — bukan paket NPM
    //   3. Sub-package scoped dari paket yang sudah dideklarasikan
    //      (mis. @typescript-eslint/visitor-keys sudah bundled dengan @typescript-eslint/typescript-estree)
    const missing = [];
    for (const dep of usedPackages) {
        // Skip path relatif / absolut
        if (dep.startsWith('.') || dep.startsWith('/')) continue;
        // Skip modul bawaan Node.js
        if (NODE_BUILTINS.has(dep)) continue;
        // Skip paket yang sudah dideklarasikan
        if (allDeclared.has(dep)) continue;
        // Skip sub-package scoped yang scope induknya sudah dideklarasikan
        // Contoh: "@typescript-eslint/visitor-keys" → scope "@typescript-eslint"
        // Jika "@typescript-eslint/typescript-estree" ada di allDeclared, skip.
        if (dep.startsWith('@')) {
            const scope = dep.split('/')[0]; // "@typescript-eslint"
            const isScopePresent = [...allDeclared].some(d => d.startsWith(scope + '/'));
            if (isScopePresent) continue;
        }
        missing.push(dep);
    }

    // ── FITUR 9: Missing Binaries ─────────────────────────────────────────────
    // Binari CLI yang digunakan di package.json "scripts" tapi tidak di-install.
    const missingBinaries = [];
    for (const bin of usedViaCli) {
        if (!allDeclared.has(bin)) {
            missingBinaries.push(bin);
        }
    }

    // ── FASE F: Kalkulasi Dead DevDependencies ────────────────────────────────
    // devDependencies yang tidak ditemukan di:
    //   (1) kode sumber (usedPackages dari BFS)
    //   (2) npm scripts (usedViaCli)
    //   (3) file konfigurasi (configUsedPackages dari config parsers)
    const deadDevDeps = [];
    for (const dep of devDeps) {
        // Skip paket yang selalu dikecualikan
        if (ALWAYS_EXCLUDED_DEV_EXACT.has(dep)) continue;
        if (ALWAYS_EXCLUDED_DEV_PATTERNS.some(p => p.test(dep))) continue;

        const inCode    = usedPackages.has(dep);
        const inScripts = usedViaCli.has(dep);
        const inConfig  = configUsedPackages.has(dep);

        if (!inCode && !inScripts && !inConfig) {
            deadDevDeps.push(dep);
        }
    }

    return {
        // Laporan utama
        unused:          unusedRuntime,     // Runtime deps yang tidak terpakai
        missing,                            // Paket yang dipakai tapi tidak dideklarasikan
        missingBinaries,                    // FITUR 9: Binari scripts yang tidak ter-install
        deadDevDeps,                        // Dev deps yang tidak terpakai sama sekali

        // Metadata dan statistik
        declared:        runtimeDeps,
        devDeclared:     devDeps,
        used:            usedPackages,
        configUsed:      configUsedPackages,
        usedViaCli,

        totalDeclared:   runtimeDeps.size,
        totalUsed:       usedPackages.size,
        totalUnused:     unusedRuntime.length,
        totalMissing:    missing.length,
        totalDeadDev:    deadDevDeps.length,
    };
}
