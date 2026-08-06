import path from 'path';
import fs from 'fs-extra';
import { builtinModules } from 'node:module';
import resolvePkg from 'enhanced-resolve';
import { createPathsMatcher, getTsconfig } from 'get-tsconfig';

const { create } = resolvePkg;

const NODE_EXTENSIONS = Object.freeze([
    '.js', '.jsx', '.mjs', '.cjs', '.json', '.node',
]);

const ALL_ASSETS = Object.freeze([
    '.css', '.scss', '.less', '.svg', '.html', '.md'
]);

function inferFrameworkExtensions(projectRoot, baseDirectory) {
    const extensions = new Set();
    const evidence = [];
    
    let currentDir = baseDirectory;
    let pkg = null;
    while (currentDir !== path.parse(currentDir).root) {
        const pkgPath = path.join(currentDir, 'package.json');
        if (fs.existsSync(pkgPath)) {
            try {
                pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
                break;
            } catch (_e) {}
        }
        currentDir = path.dirname(currentDir);
    }
    
    if (!pkg && fs.existsSync(path.join(projectRoot, 'package.json'))) {
         try { pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')); } catch (_e) {}
    }

    if (pkg) {
        const deps = {
            ...pkg.dependencies,
            ...pkg.devDependencies,
            ...pkg.peerDependencies,
            ...pkg.optionalDependencies,
        };

        if (deps.typescript || deps.tsx || deps['ts-node'] || deps.vite) {
            ['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.d.mts', '.d.cts'].forEach(e => extensions.add(e));
            evidence.push({ source: 'dependencies', value: 'typescript/vite detected' });
        }
        if (deps.vue || deps.nuxt || deps['@vue/core']) {
            extensions.add('.vue');
            evidence.push({ source: 'dependencies', value: 'vue detected' });
        }
        if (deps.svelte || deps['@sveltejs/kit']) {
            extensions.add('.svelte');
            evidence.push({ source: 'dependencies', value: 'svelte detected' });
        }
        if (deps.astro) {
            extensions.add('.astro');
            evidence.push({ source: 'dependencies', value: 'astro detected' });
        }
    }

    return { extensions: Array.from(extensions), evidence };
}

function buildExtensionProfile(projectRoot, baseDirectory, configs, userExtensions = []) {
    const profile = new Set([...NODE_EXTENSIONS, ...ALL_ASSETS]);
    const evidence = [];

    evidence.push({ source: 'default', value: 'Node built-ins & Assets', extensions: [...NODE_EXTENSIONS, ...ALL_ASSETS] });

    if (configs && configs.length > 0) {
        const tsExts = ['.ts', '.tsx', '.mts', '.cts', '.d.ts', '.d.mts', '.d.cts'];
        tsExts.forEach(e => profile.add(e));
        evidence.push({
            source: 'config',
            value: configs.map(c => path.basename(c.path)).join(','),
            extensions: tsExts
        });
    }

    const inferred = inferFrameworkExtensions(projectRoot, baseDirectory);
    if (inferred.extensions.length > 0) {
        inferred.extensions.forEach(e => profile.add(e));
        evidence.push(...inferred.evidence);
    }

    if (userExtensions && userExtensions.length > 0) {
        userExtensions.forEach(e => profile.add(e));
        evidence.push({ source: 'user-config', value: 'deadkiller.config', extensions: userExtensions });
    }

    return {
        extensions: Array.from(profile),
        evidence
    };
}

function probeExactCandidates(targetPath, extensions) {
    const directory = path.dirname(targetPath);
    const basename = path.basename(targetPath);

    if (!fs.existsSync(directory)) {
        return { status: 'not-found', candidates: [] };
    }

    let entries;
    try {
        entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch (_e) {
        return { status: 'not-found', candidates: [] };
    }

    const allowedNames = new Set(extensions.map(ext => `${basename}${ext}`));
    const candidates = entries
        .filter(entry => entry.isFile() && allowedNames.has(entry.name))
        .map(entry => path.join(directory, entry.name));

    if (candidates.length === 1) return { status: 'resolved', path: candidates[0], candidates };
    if (candidates.length > 1) return { status: 'ambiguous', path: null, candidates };
    return { status: 'not-found', path: null, candidates: [] };
}

const TYPESCRIPT_EXTENSION_SUBSTITUTIONS = Object.freeze({
    '.js': ['.ts', '.tsx', '.d.ts'],
    '.jsx': ['.tsx', '.ts', '.d.ts'],
    '.mjs': ['.mts', '.d.mts'],
    '.cjs': ['.cts', '.d.cts'],
});

const COMMON_CONFIG_NAMES = Object.freeze([
    'tsconfig.app.json',
    'tsconfig.base.json',
    'tsconfig.node.json',
    'tsconfig.web.json',
    'tsconfig.build.json',
    'jsconfig.app.json',
]);

const VIRTUAL_MODULE_RE = /^(?:\0|virtual:|vite:|webpack:|astro:|next:)/i;
const FRAMEWORK_VIRTUAL_MODULE_RE = /^(?:\$app\/|\$env\/|\$service-worker$|#app(?:\/|$)|#imports$|#components$|#build\/)/i;
const BUILTIN_MODULES = new Set([
    ...builtinModules,
    ...builtinModules.map(name => `node:${name}`),
]);

export const RESOLUTION_REASON = Object.freeze({
    RESOLVE_NOT_FOUND: 'RESOLVE_NOT_FOUND',
    PATHS_TARGET_NOT_FOUND: 'PATHS_TARGET_NOT_FOUND',
    CONFIG_INVALID: 'CONFIG_INVALID',
    VIRTUAL_MODULE: 'VIRTUAL_MODULE',
    NODE_BUILTIN: 'NODE_BUILTIN',
    EXTERNAL_PACKAGE: 'EXTERNAL_PACKAGE',
    OUTSIDE_PROJECT_ROOT: 'OUTSIDE_PROJECT_ROOT',
    AMBIGUOUS_EXTENSION: 'AMBIGUOUS_EXTENSION',
});

const resolverCache = new Map();
const configLookupCache = new Map();

export function clearResolverCache() {
    resolverCache.clear();
    configLookupCache.clear();
}

function loadResolutionConfigs(projectRoot, importerDirectory) {
    const cacheKey = `${path.resolve(projectRoot)}::${path.resolve(importerDirectory)}`;
    const cached = configLookupCache.get(cacheKey);
    if (cached) {
        return {
            configs: cached.configs,
            errors: cached.errors.map(error => ({ ...error })),
        };
    }

    const configs = [];
    const errors = [];
    const visited = new Set();

    function addConfig(searchDirectory, configName = 'tsconfig.json') {
        const lookupKey = `${path.resolve(searchDirectory)}::${configName}`;
        if (visited.has(lookupKey)) return;
        visited.add(lookupKey);

        let result;
        try {
            result = getTsconfig(searchDirectory, configName);
        } catch (error) {
            const duplicate = errors.some(item => (
                item.configName === configName && item.message === error.message
            ));
            if (!duplicate) {
                errors.push({
                    configName,
                    searchDirectory: path.resolve(searchDirectory),
                    message: error.message,
                });
            }
            return;
        }

        if (!result?.config || !result.path) return;

        const normalizedPath = path.resolve(result.path);
        if (!configs.some(item => path.resolve(item.path) === normalizedPath)) {
            configs.push(result);
        }

        if (!Array.isArray(result.config.references)) return;
        for (const reference of result.config.references) {
            if (!reference?.path) continue;
            const referencedPath = path.resolve(path.dirname(result.path), reference.path);
            const isJsonFile = referencedPath.toLowerCase().endsWith('.json');
            addConfig(
                isJsonFile ? path.dirname(referencedPath) : referencedPath,
                isJsonFile ? path.basename(referencedPath) : 'tsconfig.json',
            );
        }
    }

    // Konfigurasi terdekat dengan importer harus memiliki prioritas tertinggi.
    addConfig(importerDirectory, 'tsconfig.json');
    addConfig(importerDirectory, 'jsconfig.json');

    // Fallback untuk project references dan struktur build framework umum.
    addConfig(projectRoot, 'tsconfig.json');
    addConfig(projectRoot, 'jsconfig.json');
    for (const configName of COMMON_CONFIG_NAMES) {
        addConfig(projectRoot, configName);
    }

    const result = { configs, errors };
    configLookupCache.set(cacheKey, result);
    return {
        configs,
        errors: errors.map(error => ({ ...error })),
    };
}

function defaultAliases(projectRoot) {
    const aliases = {};
    const srcPath = path.resolve(projectRoot, 'src');
    if (!fs.existsSync(srcPath)) return aliases;

    aliases['@'] = srcPath;
    aliases['~'] = srcPath;

    const libPath = path.join(srcPath, 'lib');
    if (fs.existsSync(libPath)) aliases['$lib'] = libPath;
    return aliases;
}

function resolverBundle(projectRoot, configResult = null, extensions = NODE_EXTENSIONS) {
    const configPath = configResult?.path ? path.resolve(configResult.path) : null;
    const cacheKey = `${path.resolve(projectRoot)}::${configPath || '<default>'}::Exts${extensions.length}`;
    if (resolverCache.has(cacheKey)) return resolverCache.get(cacheKey);

    const compilerOptions = configResult?.config?.compilerOptions || {};
    const pathPatterns = Object.keys(compilerOptions.paths || {});
    const configDirectory = configPath ? path.dirname(configPath) : projectRoot;
    const absoluteBaseUrl = compilerOptions.baseUrl
        ? path.resolve(configDirectory, compilerOptions.baseUrl)
        : path.resolve(projectRoot);

    let pathsMatcher = null;
    let matcherError = null;
    if (configResult) {
        try {
            pathsMatcher = createPathsMatcher(configResult);
        } catch (error) {
            matcherError = error;
        }
    }

    const resolver = create({
        extensions: extensions,
        alias: defaultAliases(projectRoot),
        modules: [absoluteBaseUrl, 'node_modules'],
        conditionNames: ['import', 'require', 'node', 'default'],
        mainFields: ['module', 'main'],
        exportsFields: ['exports'],
        importsFields: ['imports'],
    });

    const bundle = {
        cacheKey,
        configPath,
        matcherError,
        pathPatterns,
        pathsMatcher,
        resolver,
    };
    resolverCache.set(cacheKey, bundle);
    return bundle;
}

function expandTypeScriptRequests(request) {
    const requestExtension = path.extname(request).toLowerCase();
    const substitutions = TYPESCRIPT_EXTENSION_SUBSTITUTIONS[requestExtension] || [];
    return [
        { request, substituted: false },
        ...substitutions.map(extension => ({
            request: request.slice(0, -requestExtension.length) + extension,
            substituted: true,
        })),
    ];
}

function tryEnhancedResolve(resolver, baseDirectory, request) {
    return new Promise(resolve => {
        resolver({}, baseDirectory, request, {}, (error, result) => {
            resolve({ error, result: result || null });
        });
    });
}

function isExplicitProjectSpecifier(specifier) {
    return specifier.startsWith('.') ||
        specifier.startsWith('/') ||
        path.isAbsolute(specifier) ||
        specifier.startsWith('#') ||
        specifier.startsWith('$') ||
        specifier.startsWith('~/') ||
        specifier.startsWith('@/') ||
        specifier.startsWith('@workspace/') ||
        specifier.startsWith('workspace:');
}

function matchesPathPattern(pattern, specifier) {
    const wildcardIndex = pattern.indexOf('*');
    if (wildcardIndex === -1) return pattern === specifier;
    const prefix = pattern.slice(0, wildcardIndex);
    const suffix = pattern.slice(wildcardIndex + 1);
    return specifier.startsWith(prefix) &&
        specifier.endsWith(suffix) &&
        specifier.length >= prefix.length + suffix.length;
}

/**
 * Resolve satu module specifier beserta bukti strategi yang digunakan.
 * Konfigurasi dicari dari direktori importer sehingga package monorepo dapat
 * memakai tsconfig yang berbeda tanpa berbagi resolver global yang keliru.
 *
 * @returns {Promise<{
 *   status: 'resolved'|'external'|'virtual'|'unresolved',
 *   path: string|null,
 *   strategy: string|null,
 *   reasonCode: string|null,
 *   configPath: string|null,
 *   attempts: Array<object>
 * }>}
 */
export async function resolvePathDetailed(projectRoot, baseDirectory, importPath) {
    if (BUILTIN_MODULES.has(importPath)) {
        return {
            status: 'external',
            path: null,
            strategy: 'node-builtin',
            reasonCode: RESOLUTION_REASON.NODE_BUILTIN,
            configPath: null,
            attempts: [],
        };
    }

    if (VIRTUAL_MODULE_RE.test(importPath)) {
        return {
            status: 'virtual',
            path: null,
            strategy: 'virtual-module',
            reasonCode: RESOLUTION_REASON.VIRTUAL_MODULE,
            configPath: null,
            attempts: [],
        };
    }

    const { configs, errors: configErrors } = loadResolutionConfigs(
        path.resolve(projectRoot),
        path.resolve(baseDirectory),
    );
    
    const extensionProfile = buildExtensionProfile(projectRoot, baseDirectory, configs, []);

    const bundles = configs.map(config => resolverBundle(projectRoot, config, extensionProfile.extensions));
    const defaultBundle = resolverBundle(projectRoot, null, extensionProfile.extensions);
    if (bundles.length === 0) bundles.push(defaultBundle);

    const candidates = [];
    const candidateKeys = new Set();
    let matchedPaths = false;

    function addCandidate(bundle, request, strategy) {
        for (const expanded of expandTypeScriptRequests(request)) {
            const effectiveStrategy = expanded.substituted
                ? `${strategy}:ts-extension-substitution`
                : strategy;
            const key = `${bundle.cacheKey}::${expanded.request}`;
            if (candidateKeys.has(key)) continue;
            candidateKeys.add(key);
            candidates.push({
                bundle,
                request: expanded.request,
                strategy: effectiveStrategy,
            });
        }
    }

    for (const bundle of bundles) {
        if (bundle.matcherError) {
            configErrors.push({
                configName: path.basename(bundle.configPath || 'tsconfig.json'),
                searchDirectory: path.dirname(bundle.configPath || projectRoot),
                message: bundle.matcherError.message,
            });
        }
        if (!bundle.pathsMatcher) continue;

        let pathCandidates = [];
        try {
            pathCandidates = bundle.pathsMatcher(importPath) || [];
        } catch (error) {
            configErrors.push({
                configName: path.basename(bundle.configPath || 'tsconfig.json'),
                searchDirectory: path.dirname(bundle.configPath || projectRoot),
                message: error.message,
            });
        }

        const matchedConfiguredPath = bundle.pathPatterns.some(pattern => (
            matchesPathPattern(pattern, importPath)
        ));
        if (matchedConfiguredPath) matchedPaths = true;
        for (const pathCandidate of pathCandidates) {
            addCandidate(
                bundle,
                pathCandidate,
                matchedConfiguredPath ? 'tsconfig-paths' : 'tsconfig-baseurl',
            );
        }
    }

    for (const bundle of bundles) {
        addCandidate(bundle, importPath, 'enhanced-resolve');
    }
    if (!bundles.some(bundle => bundle.cacheKey === defaultBundle.cacheKey)) {
        addCandidate(defaultBundle, importPath, 'enhanced-resolve-fallback');
    }

    const attempts = [];
    for (const candidate of candidates) {
        const { error, result } = await tryEnhancedResolve(
            candidate.bundle.resolver,
            baseDirectory,
            candidate.request,
        );
        attempts.push({
            request: candidate.request,
            strategy: candidate.strategy,
            configPath: candidate.bundle.configPath,
            ...(error?.code ? { errorCode: error.code } : {}),
        });

        if (result) {
            return {
                status: 'resolved',
                path: result,
                strategy: candidate.strategy,
                reasonCode: null,
                configPath: candidate.bundle.configPath,
                attempts,
                evidence: extensionProfile.evidence,
                ...(configErrors.length > 0 ? { configErrors } : {}),
            };
        }
    }

    if (FRAMEWORK_VIRTUAL_MODULE_RE.test(importPath)) {
        return {
            status: 'virtual',
            path: null,
            strategy: 'framework-virtual-module',
            reasonCode: RESOLUTION_REASON.VIRTUAL_MODULE,
            configPath: bundles[0]?.configPath || null,
            attempts,
            evidence: extensionProfile.evidence,
            ...(configErrors.length > 0 ? { configErrors } : {}),
        };
    }

    const looksExternal = !isExplicitProjectSpecifier(importPath) && !matchedPaths;
    if (looksExternal) {
        return {
            status: 'external',
            path: null,
            strategy: 'package-boundary',
            reasonCode: RESOLUTION_REASON.EXTERNAL_PACKAGE,
            configPath: bundles[0]?.configPath || null,
            attempts,
            evidence: extensionProfile.evidence,
            ...(configErrors.length > 0 ? { configErrors } : {}),
        };
    }

    if (isExplicitProjectSpecifier(importPath)) {
        const absoluteTarget = path.resolve(baseDirectory, importPath);
        const probingResult = probeExactCandidates(absoluteTarget, extensionProfile.extensions);
        
        attempts.push({
            request: importPath,
            strategy: 'directory-probing',
            candidates: probingResult.candidates
        });

        if (probingResult.status === 'resolved') {
            const ext = path.extname(probingResult.path).toLowerCase();
            let confidence = 'standard';
            let subStrategy = 'probing-fallback';
            
            if (['.d.ts', '.d.mts', '.d.cts'].includes(ext)) {
                confidence = 'type-only';
                subStrategy = 'declaration-fallback';
            } else if (['.vue', '.svelte', '.astro'].includes(ext)) {
                confidence = 'component';
            }
            
            return {
                status: 'resolved',
                path: probingResult.path,
                strategy: subStrategy,
                confidence,
                reasonCode: null,
                configPath: bundles[0]?.configPath || null,
                attempts,
                evidence: extensionProfile.evidence,
            };
        } else if (probingResult.status === 'ambiguous') {
            return {
                status: 'unresolved',
                path: null,
                strategy: 'ambiguous-directory-probing',
                reasonCode: RESOLUTION_REASON.AMBIGUOUS_EXTENSION,
                configPath: bundles[0]?.configPath || null,
                attempts,
                candidates: probingResult.candidates,
                evidence: extensionProfile.evidence,
            };
        }
    }

    const reasonCode = configErrors.length > 0
        ? RESOLUTION_REASON.CONFIG_INVALID
        : matchedPaths
            ? RESOLUTION_REASON.PATHS_TARGET_NOT_FOUND
            : RESOLUTION_REASON.RESOLVE_NOT_FOUND;

    return {
        status: 'unresolved',
        path: null,
        strategy: null,
        reasonCode,
        configPath: bundles[0]?.configPath || null,
        attempts,
        evidence: extensionProfile.evidence,
        ...(configErrors.length > 0 ? { configErrors } : {}),
    };
}

/**
 * Backward-compatible path-only API.
 */
export async function resolvePath(projectRoot, baseDirectory, importPath) {
    const result = await resolvePathDetailed(projectRoot, baseDirectory, importPath);
    return result.status === 'resolved' ? result.path : null;
}
