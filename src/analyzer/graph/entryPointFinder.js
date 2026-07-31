import fs from 'fs-extra';
import path from 'path';
import glob from 'fast-glob';
import micromatch from 'micromatch';

const ENTRY_GLOB_IGNORE = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    '**/.deadkiller_backup/**',
    '**/.git/**',
];

const TEST_FILE_GLOBS = [
    'test/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
    'tests/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
    '__tests__/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
    '**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
];

const TEST_RUNNERS = new Set([
    'ava',
    'bun',
    'cypress',
    'jest',
    'jasmine',
    'mocha',
    'node:test',
    'playwright',
    '@playwright/test',
    'tap',
    'tape',
    'vitest',
]);

function expandEntryGlob(pattern, projectRoot, extraOptions = {}) {
    return glob.sync(pattern, {
        cwd: projectRoot,
        absolute: true,
        onlyFiles: true,
        followSymbolicLinks: false,
        ignore: ENTRY_GLOB_IGNORE,
        ...extraOptions,
    });
}

function hasTestRunner(pkg) {
    const declaredPackages = new Set([
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.devDependencies || {}),
        ...Object.keys(pkg.peerDependencies || {}),
        ...Object.keys(pkg.optionalDependencies || {}),
    ]);

    if ([...TEST_RUNNERS].some(runner => declaredPackages.has(runner))) {
        return true;
    }

    const scripts = Object.entries(pkg.scripts || {})
        .filter(([name]) => /(?:^|:)(?:test|spec)(?::|$)/i.test(name))
        .map(([, command]) => String(command))
        .join(' ');

    return /(?:^|[\s;&|])(?:npx\s+|pnpm\s+(?:exec\s+)?|yarn\s+|bunx\s+)?(?:ava|cypress|jest|jasmine|mocha|node\s+--test|playwright|tap|tape|vitest)(?=$|[\s;&|])/i.test(scripts);
}

function addMatchedEntries(entrySet, patterns, projectRoot) {
    for (const pattern of patterns) {
        for (const match of expandEntryGlob(pattern, projectRoot)) {
            entrySet.add(path.normalize(match));
        }
    }
}

function addRuntimeEntriesFromScripts(entrySet, pkg, projectRoot) {
    const runtimeScriptNames = /^(?:start|dev|serve|preview)(?::|$)/i;
    const scriptCommands = Object.entries(pkg.scripts || {})
        .filter(([name]) => runtimeScriptNames.test(name))
        .map(([, command]) => String(command));
    const launchPattern =
        /(?:^|[\s;&|])(?:node|nodemon|tsx|ts-node|ts-node-esm|bun(?:\s+run)?|deno\s+run)\s+(?:--[\w-]+(?:=\S+)?\s+)*["']?([^"'`\s;&|]+\.[cm]?[jt]sx?)["']?/gi;

    for (const command of scriptCommands) {
        for (const match of command.matchAll(launchPattern)) {
            const candidate = path.resolve(projectRoot, match[1]);
            if (fs.existsSync(candidate)) {
                entrySet.add(candidate);
            }
        }
    }
}

function collectPackageManifestEntries(entrySet, pkg, packageRoot) {
    if (pkg.main) entrySet.add(path.resolve(packageRoot, pkg.main));
    if (pkg.module) entrySet.add(path.resolve(packageRoot, pkg.module));

    if (pkg.bin) {
        const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin);
        bins.forEach(binPath => entrySet.add(path.resolve(packageRoot, binPath)));
    }

    const collectExports = value => {
        if (typeof value === 'string') {
            entrySet.add(path.resolve(packageRoot, value));
        } else if (value && typeof value === 'object') {
            Object.values(value).forEach(collectExports);
        }
    };
    if (pkg.exports) collectExports(pkg.exports);
    addRuntimeEntriesFromScripts(entrySet, pkg, packageRoot);
}

function frameworkEntryGlobs(pkg) {
    const dependencies = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (dependencies.next) return ['pages/**/*.{js,jsx,ts,tsx}', 'app/**/*.{js,jsx,ts,tsx}', 'src/pages/**/*.{js,jsx,ts,tsx}', 'src/app/**/*.{js,jsx,ts,tsx}'];
    if (dependencies.nuxt || dependencies.nuxt3) return ['pages/**/*.vue', 'app.vue', 'layouts/**/*.vue'];
    if (dependencies['@remix-run/react'] || dependencies['@remix-run/node']) return ['app/root.{js,jsx,ts,tsx}', 'app/routes/**/*.{js,jsx,ts,tsx}'];
    if (dependencies['@angular/core']) return ['src/main.ts', 'src/app/**/*.ts'];
    if (dependencies.svelte || dependencies['@sveltejs/kit']) return ['src/main.{js,ts}', 'src/routes/**/*.svelte', 'src/App.svelte'];
    if (dependencies.vite) return ['src/main.{js,jsx,mjs,ts,tsx,mts}', 'src/index.{js,jsx,mjs,ts,tsx,mts}'];
    if (dependencies['react-scripts']) return ['src/index.{js,jsx,ts,tsx}'];
    if (dependencies.expo || dependencies['react-native']) return ['App.{js,jsx,ts,tsx}', 'index.js', 'src/App.{js,jsx,ts,tsx}'];
    if (dependencies.gatsby) return ['src/pages/**/*.{js,jsx,ts,tsx}', 'gatsby-node.js', 'gatsby-browser.js'];
    if (dependencies.electron) return ['src/main.{js,ts,mts,cts}', 'src/renderer.{js,ts,mts,cts}', 'main.{js,cjs,mjs}'];
    return [];
}

function addConventionalSourceEntry(entrySet, packageRoot) {
    const candidates = ['index', 'main', 'src/index', 'src/main', 'app', 'server']
        .flatMap(base => ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts'].map(extension => `${base}.${extension}`));
    const candidate = candidates
        .map(relativePath => path.resolve(packageRoot, relativePath))
        .find(filePath => fs.existsSync(filePath));
    if (candidate) entrySet.add(candidate);
}

async function findWorkspacePatterns(projectRoot, pkg) {
    const patterns = new Set(
        Array.isArray(pkg.workspaces)
            ? pkg.workspaces
            : (pkg.workspaces?.packages || []),
    );

    const pnpmWorkspacePath = path.join(projectRoot, 'pnpm-workspace.yaml');
    if (await fs.pathExists(pnpmWorkspacePath)) {
        const source = await fs.readFile(pnpmWorkspacePath, 'utf8');
        const packagesBlock = source.match(/(?:^|\n)packages\s*:\s*\n((?:[ \t]+-[^\n]+\n?)*)/i)?.[1] || '';
        for (const match of packagesBlock.matchAll(/^\s*-\s*['"]?([^'"#\r\n]+?)['"]?\s*$/gm)) {
            patterns.add(match[1].trim());
        }
    }

    const lernaPath = path.join(projectRoot, 'lerna.json');
    if (await fs.pathExists(lernaPath)) {
        try {
            const lerna = await fs.readJson(lernaPath);
            (lerna.packages || []).forEach(pattern => patterns.add(pattern));
        } catch (_error) {
            // Lerna config yang tidak valid tidak boleh menggagalkan root discovery.
        }
    }
    return [...patterns];
}

/**
 * Mengklasifikasikan entry point untuk penjelasan UX. Nilai ini hanya metadata
 * presentasi dan tidak memengaruhi reachability graph.
 */
export function classifyEntryPoint(entryPath, projectRoot) {
    const relativePath = path.relative(projectRoot, entryPath).replace(/\\/g, '/');

    if (
        /(?:^|\/)(?:test|tests|__tests__)\//i.test(relativePath) ||
        /\.(?:test|spec)\.[cm]?[jt]sx?$/i.test(relativePath)
    ) {
        return 'test';
    }
    if (/(?:^|\/)[^/]+\.config\.[cm]?[jt]s$/i.test(relativePath)) {
        return 'config';
    }
    if (/(?:^|\/)examples?\//i.test(relativePath)) {
        return 'example';
    }
    return 'runtime';
}

function hasValidRuntimeEntry(entrySet, projectRoot) {
    return [...entrySet].some(entry =>
        fs.existsSync(entry) &&
        !entry.endsWith('.json') &&
        classifyEntryPoint(entry, projectRoot) === 'runtime'
    );
}

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
    const workspaceRoots = [];
    const workspacePatterns = await findWorkspacePatterns(projectRoot, pkg);
    if (workspacePatterns.length > 0) {
        const workspaceDirs = glob.sync(workspacePatterns, {
            cwd: projectRoot,
            onlyDirectories: true,
            absolute: true,
            followSymbolicLinks: false,
            ignore: ENTRY_GLOB_IGNORE,
        });
        for (const wsDir of workspaceDirs) {
            try {
                const wsPkgPath = path.join(wsDir, 'package.json');
                if (await fs.pathExists(wsPkgPath)) {
                    const wsPkg = await fs.readJson(wsPkgPath);
                    workspaceRoots.push(wsDir);
                    collectPackageManifestEntries(entrySet, wsPkg, wsDir);
                    if (hasTestRunner(wsPkg)) addMatchedEntries(entrySet, TEST_FILE_GLOBS, wsDir);
                    addMatchedEntries(entrySet, frameworkEntryGlobs(wsPkg), wsDir);
                    addConventionalSourceEntry(entrySet, wsDir);
                }
            } catch (e) {
                if (process.env.DEBUG) {
                    console.warn(`[Warning] Gagal membaca package.json di workspace ${wsDir}:`, e.message);
                }
            }
        }
    }

    // 1. Tambahkan Custom Entry Points dari RuleEngine
    if (ruleEngine && ruleEngine.rules && ruleEngine.rules.entryPoints) {
        for (const ep of ruleEngine.rules.entryPoints) {
            const matches = expandEntryGlob(ep, projectRoot);
            if (matches.length > 0) {
                matches.forEach(m => entrySet.add(path.normalize(m)));
            } else {
                entrySet.add(path.resolve(projectRoot, ep));
            }
        }
    }

    // 2. Manifest root: main/module/exports/bin dan runtime scripts.
    collectPackageManifestEntries(entrySet, pkg, projectRoot);

    // 3. Framework Auto-Detection Heuristics
    const allDeps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    const frameworkGlobs = frameworkEntryGlobs(pkg);

    // Test adalah root eksekusi tersendiri. Ia tidak selalu di-import oleh
    // aplikasi, tetapi import package di dalamnya tetap menjadi bukti dependency.
    // Discovery dibatasi pada proyek yang benar-benar mendeklarasikan/menjalankan
    // test runner agar folder bernama "test" biasa tidak otomatis dihidupkan.
    if (hasTestRunner(pkg)) {
        addMatchedEntries(entrySet, TEST_FILE_GLOBS, projectRoot);
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
        for (const workspaceRoot of workspaceRoots) {
            const workspaceConfigPath = path.resolve(workspaceRoot, conf);
            if (await fs.pathExists(workspaceConfigPath)) configEntrySet.add(workspaceConfigPath);
        }
    }
    for (const configRoot of [projectRoot, ...workspaceRoots]) {
        for (const configPath of expandEntryGlob('*.config.{js,mjs,cjs,ts,mts,cts}', configRoot)) {
            configEntrySet.add(configPath);
        }
    }

    if (frameworkGlobs.length > 0) {
        for (const pattern of frameworkGlobs) {
            const matches = glob.sync(pattern, { cwd: projectRoot, absolute: true });
            matches.forEach(m => entrySet.add(path.resolve(m)));
        }
    }

    // Fallback: kandidat umum jika source entry points tidak ada atau tidak valid (misal dist belum dibuild)
    let hasValidSource = hasValidRuntimeEntry(entrySet, projectRoot);
    
    if (!hasValidSource) {
        addConventionalSourceEntry(entrySet, projectRoot);
    }

    // HTML Fallback
    hasValidSource = hasValidRuntimeEntry(entrySet, projectRoot);
    
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
    hasValidSource = hasValidRuntimeEntry(entrySet, projectRoot);
    if (!hasValidSource) {
        const deepSearch = glob.sync('src/**/index.{js,jsx,mjs,cjs,ts,tsx,mts,cts}', { cwd: projectRoot, absolute: true });
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
            isIgnored = micromatch.isMatch(relativePath, ruleEngine.rules.ignoreFiles, { dot: true });
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

    const entryKindOrder = new Map([
        ['runtime', 0],
        ['test', 1],
        ['config', 2],
        ['example', 3],
    ]);
    validatedEntries.sort((left, right) => {
        const kindDifference =
            entryKindOrder.get(classifyEntryPoint(left, projectRoot)) -
            entryKindOrder.get(classifyEntryPoint(right, projectRoot));
        return kindDifference || left.localeCompare(right);
    });

    return validatedEntries;
}
