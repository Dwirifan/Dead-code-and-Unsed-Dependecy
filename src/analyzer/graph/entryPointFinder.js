import fs from 'fs-extra';
import path from 'path';
import glob from 'fast-glob';
import micromatch from 'micromatch';
import { SCRIPT_GLOB } from '../../parser/supportedExtensions.js';
import { matchesOrderedPatterns } from '../globMatcher.js';
import { isExistingPathInsideRoot, isPathInsideRoot } from '../pathContainment.js';
import { NEXT_ENTRY_GLOBS } from '../frameworkConventions.js';
import { traceBuildSources } from './buildSourceTracer.js';

const ENTRY_GLOB_IGNORE = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/docs/**',
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

const MANIFEST_ENTRY_EXTENSIONS = [
    '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx',
];

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

function isContainedEntry(projectRoot, candidatePath) {
    const absoluteRoot = path.resolve(projectRoot);
    const absoluteCandidate = path.resolve(candidatePath);
    if (!isPathInsideRoot(absoluteRoot, absoluteCandidate)) return false;
    // Path yang belum ada dilaporkan kemudian sebagai entry hilang. Kandidat
    // existing selalu memakai realpath dan fail-closed pada error filesystem.
    if (!fs.existsSync(absoluteCandidate)) return true;
    return isExistingPathInsideRoot(absoluteRoot, absoluteCandidate);
}

function relativeEntryPath(projectRoot, entryPath) {
    return path.relative(projectRoot, entryPath).replace(/\\/g, '/');
}

function isIgnoredEntry(entryPath, projectRoot, ruleEngine) {
    if (typeof ruleEngine?.isIgnoredFile === 'function') {
        return ruleEngine.isIgnoredFile(entryPath, projectRoot);
    }
    const patterns = ruleEngine?.rules?.ignoreFiles || [];
    return patterns.length > 0 && matchesOrderedPatterns(
        relativeEntryPath(projectRoot, entryPath),
        patterns,
        { legacyDirectories: true },
    );
}

function expandExistingEntry(entryPath, projectRoot) {
    const absoluteEntry = path.resolve(entryPath);
    if (!isContainedEntry(projectRoot, absoluteEntry) || !fs.existsSync(absoluteEntry)) {
        return [];
    }

    let stat;
    try {
        stat = fs.statSync(absoluteEntry);
    } catch (_error) {
        return [];
    }

    if (stat.isFile()) return [path.normalize(absoluteEntry)];
    if (!stat.isDirectory()) return [];

    return expandEntryGlob(SCRIPT_GLOB, absoluteEntry)
        .filter(filePath => isContainedEntry(projectRoot, filePath))
        .map(filePath => path.normalize(filePath));
}

function createEntryPointError(code, message, details = {}) {
    const error = new Error(message);
    error.name = 'EntryPointError';
    error.code = code;
    error.diagnostics = [{
        level: 'error',
        code,
        path: 'entryPoints',
        message,
        ...details,
    }];
    return error;
}

function assertPatternInsideProject(pattern, projectRoot) {
    const patternPath = path.resolve(projectRoot, pattern);
    if (!isPathInsideRoot(path.resolve(projectRoot), patternPath)) {
        throw createEntryPointError(
            'DEADKILLER_ENTRY_OUTSIDE_PROJECT',
            `Entry point '${pattern}' berada di luar root proyek dan tidak dapat dianalisis.`,
            { pattern },
        );
    }
}

function removeCustomPatternMatches(entrySet, pattern, projectRoot) {
    const absolutePattern = path.resolve(projectRoot, pattern);
    const exactDirectory = !glob.isDynamicPattern(pattern) &&
        fs.existsSync(absolutePattern) &&
        fs.statSync(absolutePattern).isDirectory();

    for (const entry of entrySet) {
        const matchesExactDirectory = exactDirectory && isPathInsideRoot(absolutePattern, entry);
        const matchesPattern = micromatch.isMatch(
            relativeEntryPath(projectRoot, entry),
            pattern,
            { dot: true },
        );
        if (matchesExactDirectory || matchesPattern) entrySet.delete(entry);
    }
}

function collectCustomEntries(patterns, projectRoot) {
    const customEntries = new Set();

    for (const originalPattern of patterns) {
        if (typeof originalPattern !== 'string') continue;
        const negated = originalPattern.startsWith('!') && !originalPattern.startsWith('!(');
        const pattern = (negated ? originalPattern.slice(1) : originalPattern)
            .trim()
            .replace(/\\/g, '/');
        if (!pattern) continue;

        assertPatternInsideProject(pattern, projectRoot);

        if (negated) {
            removeCustomPatternMatches(customEntries, pattern, projectRoot);
            continue;
        }

        if (glob.isDynamicPattern(pattern)) {
            for (const match of expandEntryGlob(pattern, projectRoot)) {
                if (isContainedEntry(projectRoot, match)) {
                    customEntries.add(path.normalize(match));
                }
            }
            continue;
        }

        const exactEntry = path.resolve(projectRoot, pattern);
        if (!fs.existsSync(exactEntry)) {
            throw createEntryPointError(
                'DEADKILLER_ENTRY_NOT_FOUND',
                `Entry point eksplisit '${pattern}' tidak ditemukan. Periksa path pada konfigurasi entryPoints.`,
                { pattern, resolvedPath: exactEntry },
            );
        }
        if (!isContainedEntry(projectRoot, exactEntry)) {
            throw createEntryPointError(
                'DEADKILLER_ENTRY_OUTSIDE_PROJECT',
                `Entry point '${pattern}' mengarah ke luar root proyek dan tidak dapat dianalisis.`,
                { pattern, resolvedPath: exactEntry },
            );
        }

        const expandedEntries = expandExistingEntry(exactEntry, projectRoot);
        if (expandedEntries.length === 0) {
            throw createEntryPointError(
                'DEADKILLER_ENTRY_DIRECTORY_EMPTY',
                `Direktori entry point '${pattern}' tidak berisi file JavaScript atau TypeScript yang didukung.`,
                { pattern, resolvedPath: exactEntry },
            );
        }
        expandedEntries.forEach(entry => customEntries.add(entry));
    }

    return customEntries;
}

function collectPreservedScriptEntries(patterns, projectRoot) {
    if (!Array.isArray(patterns) || patterns.length === 0) return [];
    return expandEntryGlob(SCRIPT_GLOB, projectRoot)
        .filter(filePath => isContainedEntry(projectRoot, filePath))
        .filter(filePath => matchesOrderedPatterns(
            relativeEntryPath(projectRoot, filePath),
            patterns,
            { legacyDirectories: true },
        ))
        .map(filePath => path.normalize(filePath));
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

function resolveManifestEntry(packageRoot, manifestValue) {
    if (typeof manifestValue !== 'string' || !manifestValue.trim()) return null;
    const candidate = path.resolve(packageRoot, manifestValue);
    const fileCandidates = path.extname(candidate)
        ? [candidate]
        : [candidate, ...MANIFEST_ENTRY_EXTENSIONS.map(extension => `${candidate}${extension}`)];
    for (const fileCandidate of fileCandidates) {
        try {
            if (fs.statSync(fileCandidate).isFile()) return fileCandidate;
        } catch (_error) {
            // Lanjutkan ke kandidat Node-style berikutnya.
        }
    }

    try {
        if (fs.statSync(candidate).isDirectory()) {
            for (const extension of MANIFEST_ENTRY_EXTENSIONS) {
                const indexCandidate = path.join(candidate, `index${extension}`);
                if (fs.existsSync(indexCandidate) && fs.statSync(indexCandidate).isFile()) {
                    return indexCandidate;
                }
            }
            return null;
        }
    } catch (_error) {
        // Path manifest yang hilang tetap dicatat agar fallback source aktif dan
        // diagnostic DEBUG dapat menjelaskan kandidat yang rusak.
    }
    return candidate;
}

function addManifestEntry(entrySet, packageRoot, manifestValue) {
    const resolved = resolveManifestEntry(packageRoot, manifestValue);
    if (resolved) entrySet.add(resolved);
}

function collectPackageManifestEntries(entrySet, pkg, packageRoot) {
    if (pkg.main) addManifestEntry(entrySet, packageRoot, pkg.main);
    if (pkg.module) addManifestEntry(entrySet, packageRoot, pkg.module);

    if (pkg.bin) {
        const bins = typeof pkg.bin === 'string' ? [pkg.bin] : Object.values(pkg.bin);
        bins.forEach(binPath => addManifestEntry(entrySet, packageRoot, binPath));
    }

    const collectExports = value => {
        if (typeof value === 'string') {
            addManifestEntry(entrySet, packageRoot, value);
        } else if (value && typeof value === 'object') {
            Object.values(value).forEach(collectExports);
        }
    };
    if (pkg.exports) collectExports(pkg.exports);
    addRuntimeEntriesFromScripts(entrySet, pkg, packageRoot);
}

function frameworkEntryGlobs(pkg) {
    const dependencies = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
    if (dependencies.next) return [...NEXT_ENTRY_GLOBS];
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

function addConventionalSourceEntry(entrySet, packageRoot, pkg = {}) {
    const sourceExtensions = ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts'];
    const candidates = new Set();
    
    // 1. Dynamic Inference dari manifest (pkg)
    const manifestValues = [];
    if (pkg.main) manifestValues.push(pkg.main);
    if (pkg.module) manifestValues.push(pkg.module);
    if (pkg.bin) {
        if (typeof pkg.bin === 'string') manifestValues.push(pkg.bin);
        else manifestValues.push(...Object.values(pkg.bin));
    }
    
    // Pattern untuk nama direktori kompilasi yang sering dipakai
    const buildDirs = ['dist', 'build', 'out', 'lib-cov'];
    const sourceDirs = ['src', 'lib', 'source', '']; // '' mewakili root direktori
    
    for (const val of manifestValues) {
        if (typeof val !== 'string') continue;
        
        let rawPath = val.replace(/\\/g, '/').replace(/^\.\//, ''); 
        const ext = path.extname(rawPath);
        if (ext) {
            rawPath = rawPath.slice(0, -ext.length);
        }

        const parts = rawPath.split('/');
        if (parts.length > 1 && buildDirs.includes(parts[0])) {
            const restPath = parts.slice(1).join('/');
            for (const sDir of sourceDirs) {
                const inferredPath = sDir ? `${sDir}/${restPath}` : restPath;
                candidates.add(inferredPath);
            }
        } else {
            const baseName = parts[parts.length - 1];
            for (const sDir of sourceDirs) {
                const inferredPath = sDir ? `${sDir}/${baseName}` : baseName;
                candidates.add(inferredPath);
            }
        }
    }
    
    // 2. Static Fallback (klasik)
    const staticBases = ['index', 'main', 'src/index', 'src/main', 'app', 'server'];
    for (const base of staticBases) {
        candidates.add(base);
    }
    
    // 3. Resolusi ke file fisik
    const candidateArray = Array.from(candidates).flatMap(base => 
        sourceExtensions.map(extension => `${base}.${extension}`)
    );
    
    const validCandidate = candidateArray
        .map(relativePath => path.resolve(packageRoot, relativePath))
        .find(filePath => fs.existsSync(filePath));
        
    if (validCandidate) {
        entrySet.add(validCandidate);
        if (process.env.DEBUG) {
            console.log(`[DEBUG] addConventionalSourceEntry menemukan source: ${validCandidate}`);
        }
    }
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
    if (
        /(?:^|\/)(?:[^/]+\.config|webpack\.(?:common|dev|prod)|\.eslintrc)\.[cm]?[jt]s$/i.test(relativePath)
    ) {
        return 'config';
    }
    if (/(?:^|\/)examples?\//i.test(relativePath)) {
        return 'example';
    }
    return 'runtime';
}

function hasValidRuntimeEntry(entrySet, projectRoot, ruleEngine) {
    return [...entrySet].some(entry => expandExistingEntry(entry, projectRoot).some(candidate =>
        !isIgnoredEntry(candidate, projectRoot, ruleEngine) &&
        !candidate.endsWith('.json') &&
        classifyEntryPoint(candidate, projectRoot) === 'runtime'
    ));
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
    projectRoot = path.resolve(projectRoot);
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
            if (!isContainedEntry(projectRoot, wsDir)) continue;
            try {
                const wsPkgPath = path.join(wsDir, 'package.json');
                if (await fs.pathExists(wsPkgPath)) {
                    const wsPkg = await fs.readJson(wsPkgPath);
                    workspaceRoots.push(wsDir);
                    collectPackageManifestEntries(entrySet, wsPkg, wsDir);
                    if (hasTestRunner(wsPkg)) addMatchedEntries(entrySet, TEST_FILE_GLOBS, wsDir);
                    addMatchedEntries(entrySet, frameworkEntryGlobs(wsPkg), wsDir);
                    addConventionalSourceEntry(entrySet, wsDir, wsPkg);
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
        const customEntries = collectCustomEntries(ruleEngine.rules.entryPoints, projectRoot);
        customEntries.forEach(entry => entrySet.add(entry));
    }

    // Preserved files tetap menjadi bukti reachability dan dependency. Mereka
    // hanya kebal dari eliminasi, bukan dikeluarkan dari analisis.
    collectPreservedScriptEntries(
        ruleEngine?.rules?.preserveFiles || [],
        projectRoot,
    ).forEach(entry => entrySet.add(entry));

    // 2. Manifest root: main/module/exports/bin dan runtime scripts.
    collectPackageManifestEntries(entrySet, pkg, projectRoot);

    // 2a. [SAFEGUARD] Build Artifact Source Tracing
    // Jika manifest mengarah ke folder build artifact, selalu lacak file sumber
    // aslinya agar source files tidak dilabeli sebagai Unconnected/Dead.
    const { sources: buildSources, layer: buildLayer } = await traceBuildSources(projectRoot, pkg);
    buildSources.forEach(src => entrySet.add(src));
    if (process.env.DEBUG && buildSources.length > 0) {
        console.log(`[entryPointFinder] Build sources traced via ${buildLayer}: ${buildSources.map(s => path.relative(projectRoot, s)).join(', ')}`);
    }

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
        addMatchedEntries(entrySet, frameworkGlobs, projectRoot);
    }

    // Fallback: kandidat umum jika source entry points tidak ada atau tidak valid (misal dist belum dibuild)
    let hasValidSource = hasValidRuntimeEntry(entrySet, projectRoot, ruleEngine);
    
    if (!hasValidSource) {
        addConventionalSourceEntry(entrySet, projectRoot, pkg);
    }

    // HTML Fallback
    hasValidSource = hasValidRuntimeEntry(entrySet, projectRoot, ruleEngine);
    
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
    hasValidSource = hasValidRuntimeEntry(entrySet, projectRoot, ruleEngine);
    if (!hasValidSource) {
        const deepSearch = expandEntryGlob('src/**/index.{js,jsx,mjs,cjs,ts,tsx,mts,cts}', projectRoot);
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
    
    const seenValidatedEntries = new Set();
    for (const entry of entrySet) {
        const expandedEntries = expandExistingEntry(entry, projectRoot);
        if (expandedEntries.length === 0) {
            invalidEntries.push(entry);
            continue;
        }

        for (const candidate of expandedEntries) {
            if (isIgnoredEntry(candidate, projectRoot, ruleEngine)) continue;
            if (!seenValidatedEntries.has(candidate)) {
                seenValidatedEntries.add(candidate);
                validatedEntries.push(candidate);
            }
        }
    }

    if (invalidEntries.length > 0 && process.env.DEBUG) {
        console.warn(`[!] Entry point tidak ditemukan (diabaikan):`);
        invalidEntries.forEach(e => console.warn(`    - ${path.relative(projectRoot, e)}`));
    }

    const hasRuntimeEntry = validatedEntries.some(entry =>
        !entry.endsWith('.json') && classifyEntryPoint(entry, projectRoot) === 'runtime'
    );
    if (!hasRuntimeEntry) {
        throw createEntryPointError(
            'DEADKILLER_ENTRY_POINT_NOT_FOUND',
            'Could not auto-detect entry point: tidak ditemukan file runtime yang valid di dalam root proyek. File config, test, atau example saja tidak cukup; tentukan "main" di package.json atau "entryPoints" pada konfigurasi DeadKiller.',
        );
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
