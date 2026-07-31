import fs from 'fs-extra';
import path from 'node:path';
import glob from 'fast-glob';
import { getTsconfig } from 'get-tsconfig';

const SOURCE_PATTERNS = [
    '*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
    '{src,app,server,lib,bin,apps,packages,services,workers,scripts,functions,api,test,tests,__tests__,examples}/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
];

const SOURCE_IGNORE = [
    '**/node_modules/**',
    '**/dist/**',
    '**/build/**',
    '**/coverage/**',
    '**/.next/**',
    '**/.nuxt/**',
    '**/.git/**',
    '**/.deadkiller_backup/**',
];

const FRAMEWORKS = [
    { id: 'next', mode: 'next', label: 'Next.js', packages: ['next'] },
    { id: 'nuxt', mode: 'vue', label: 'Nuxt', packages: ['nuxt', 'nuxt3'] },
    { id: 'vue', mode: 'vue', label: 'Vue', packages: ['vue'] },
    { id: 'remix', mode: 'react', label: 'Remix', packages: ['@remix-run/react', '@remix-run/node'] },
    { id: 'react-native', mode: 'react', label: 'React Native / Expo', packages: ['react-native', 'expo'] },
    { id: 'react', mode: 'react', label: 'React', packages: ['react', 'react-dom', 'react-scripts'] },
    { id: 'preact', mode: 'react', label: 'Preact', packages: ['preact'] },
    { id: 'angular', mode: 'vanilla', label: 'Angular', packages: ['@angular/core'] },
    { id: 'svelte', mode: 'vanilla', label: 'Svelte / SvelteKit', packages: ['svelte', '@sveltejs/kit'] },
    { id: 'solid', mode: 'vanilla', label: 'SolidJS', packages: ['solid-js'] },
    { id: 'astro', mode: 'vanilla', label: 'Astro', packages: ['astro'] },
    { id: 'nestjs', mode: 'vanilla', label: 'NestJS', packages: ['@nestjs/core'] },
    { id: 'express', mode: 'vanilla', label: 'Node.js / Express', packages: ['express', 'fastify', 'koa', 'hapi'] },
];

function normalizePackageManager(value) {
    if (!value) return null;
    return String(value).split('@')[0];
}

async function detectPackageManager(projectRoot, pkg) {
    const declared = normalizePackageManager(pkg.packageManager);
    if (declared) return declared;

    const lockfiles = [
        ['pnpm-lock.yaml', 'pnpm'],
        ['yarn.lock', 'yarn'],
        ['bun.lock', 'bun'],
        ['bun.lockb', 'bun'],
        ['package-lock.json', 'npm'],
    ];
    for (const [file, manager] of lockfiles) {
        if (await fs.pathExists(path.join(projectRoot, file))) return manager;
    }
    return 'npm';
}

async function detectMonorepo(projectRoot, pkg) {
    return Boolean(
        pkg.workspaces ||
        await fs.pathExists(path.join(projectRoot, 'pnpm-workspace.yaml')) ||
        await fs.pathExists(path.join(projectRoot, 'lerna.json')) ||
        await fs.pathExists(path.join(projectRoot, 'turbo.json')) ||
        await fs.pathExists(path.join(projectRoot, 'nx.json'))
    );
}

function detectFramework(dependencies) {
    return FRAMEWORKS.find(framework => (
        framework.packages.some(packageName => dependencies.has(packageName))
    )) || { id: 'vanilla', mode: 'vanilla', label: 'Vanilla JavaScript/TypeScript' };
}

function detectProjectType(pkg, framework, monorepo) {
    if (monorepo) return 'monorepo';
    if (pkg.bin) return 'cli';

    const scripts = pkg.scripts || {};
    const hasApplicationScript = ['start', 'dev', 'serve'].some(name => scripts[name]);
    const hasLibraryManifest = Boolean(pkg.exports || pkg.types || pkg.typings || pkg.module);
    const applicationFramework = !['vanilla'].includes(framework.id);

    if (hasLibraryManifest && !hasApplicationScript && !applicationFramework) return 'library';
    return 'application';
}

function detectModuleSystem(pkg, sourceFiles, tsconfig) {
    const hasEsmExtension = sourceFiles.some(file => /\.(?:mjs|mts)$/i.test(file));
    const hasCjsExtension = sourceFiles.some(file => /\.(?:cjs|cts)$/i.test(file));
    const tsModule = String(tsconfig?.config?.compilerOptions?.module || '').toLowerCase();
    // Node16/NodeNext mengikuti package.json dan ekstensi per file; keduanya
    // tidak otomatis berarti ESM ketika package `type` tidak ditentukan.
    const tsConfigUsesEsm = /^(?:es6|es2015|es2020|es2022|esnext|preserve|system)$/.test(tsModule);

    if (hasEsmExtension && hasCjsExtension) return 'mixed';
    if (pkg.type === 'module' || hasEsmExtension) return hasCjsExtension ? 'mixed' : 'esm';
    if (pkg.type === 'commonjs' || hasCjsExtension) return hasEsmExtension ? 'mixed' : 'commonjs';
    if (tsConfigUsesEsm) return 'esm';
    return 'commonjs';
}

function detectLanguage(projectRoot, dependencies, sourceFiles) {
    const hasTsConfig = fs.existsSync(path.join(projectRoot, 'tsconfig.json'));
    const hasTypeScript = hasTsConfig || dependencies.has('typescript') || sourceFiles.some(file => /\.(?:ts|tsx|mts|cts)$/i.test(file));
    const hasJavaScript = sourceFiles.some(file => /\.(?:js|jsx|mjs|cjs)$/i.test(file));

    if (hasTypeScript && hasJavaScript) return 'mixed';
    return hasTypeScript ? 'typescript' : 'javascript';
}

function reactMajorVersion(dependenciesByName) {
    const rawVersion = dependenciesByName.react;
    if (!rawVersion) return null;
    const match = String(rawVersion).match(/\d+/);
    return match ? Number(match[0]) : null;
}

function detectJsxRuntime(dependenciesByName, tsconfig) {
    const jsxMode = String(tsconfig?.config?.compilerOptions?.jsx || '').toLowerCase();
    const usesAutomaticJsx = ['react-jsx', 'react-jsxdev'].includes(jsxMode);
    const automaticFramework = ['preact', 'solid-js'].some(name => dependenciesByName[name]);
    const reactMajor = reactMajorVersion(dependenciesByName);
    return usesAutomaticJsx || automaticFramework || (reactMajor !== null && reactMajor >= 17)
        ? 'automatic'
        : 'classic';
}

export async function inspectProject(projectRoot) {
    const packagePath = path.join(projectRoot, 'package.json');
    const pkg = await fs.pathExists(packagePath) ? await fs.readJson(packagePath) : {};
    const dependenciesByName = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
        ...(pkg.peerDependencies || {}),
        ...(pkg.optionalDependencies || {}),
    };
    const dependencies = new Set(Object.keys(dependenciesByName));
    const sourceFiles = await glob(SOURCE_PATTERNS, {
        cwd: projectRoot,
        onlyFiles: true,
        followSymbolicLinks: false,
        suppressErrors: true,
        ignore: SOURCE_IGNORE,
    });
    const projectSourceFiles = sourceFiles.filter(file => (
        !/(?:^|\/)(?:[^/]+\.config|deadkiller\.config)\.[cm]?[jt]s$/i.test(file)
    ));
    let tsconfig = null;
    try {
        tsconfig = getTsconfig(projectRoot);
    } catch (_error) {
        // Config invalid tetap ditampilkan kemudian oleh parser/scan; init harus bisa lanjut.
    }
    const monorepo = await detectMonorepo(projectRoot, pkg);
    const framework = detectFramework(dependencies);
    const projectType = detectProjectType(pkg, framework, monorepo);

    return {
        packageName: pkg.name || path.basename(projectRoot),
        packageManager: await detectPackageManager(projectRoot, pkg),
        language: detectLanguage(projectRoot, dependencies, projectSourceFiles),
        moduleSystem: detectModuleSystem(pkg, projectSourceFiles, tsconfig),
        framework: framework.id,
        frameworkLabel: framework.label,
        mode: framework.mode,
        projectType,
        monorepo,
        sourceFileCount: projectSourceFiles.length,
        preserveExports: ['library', 'cli', 'monorepo'].includes(projectType),
        reactRuntime: detectJsxRuntime(dependenciesByName, tsconfig),
    };
}

export function createRecommendedConfig(profile, entryPoints = []) {
    return {
        mode: profile.mode,
        entryPoints,
        ignorePrefixedVariables: '^_',
        preserveExports: profile.preserveExports,
        preserveUnsafeFiles: true,
        preserveFiles: [
            'test/**',
            'tests/**',
            '__tests__/**',
            '**/test/**',
            '**/tests/**',
            '**/__tests__/**',
            '**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
            'e2e/**',
            '**/e2e/**',
            'examples/**',
            '**/examples/**',
            '**/fixtures/**',
            '**/__fixtures__/**',
        ],
        ignoreFiles: [
            '**/node_modules/**',
            '**/dist/**',
            '**/build/**',
            '**/coverage/**',
            '**/.next/**',
            '**/.nuxt/**',
            '**/.svelte-kit/**',
            '**/.turbo/**',
            '**/.cache/**',
            '**/out/**',
            '**/storybook-static/**',
            '**/.deadkiller_backup/**',
        ],
        ignoreDependencies: [],
        globals: [],
        reactRuntime: profile.reactRuntime,
        overrides: [
            {
                files: [
                    'test/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
                    'tests/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
                    '__tests__/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
                    '**/test/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
                    '**/tests/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
                    '**/__tests__/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
                    '**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
                    'e2e/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
                    '**/e2e/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
                ],
                preserveExports: true,
            },
        ],
    };
}
