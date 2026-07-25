import path from 'path';
import fs from 'fs-extra';
import resolvePkg from 'enhanced-resolve';
import { getTsconfig } from 'get-tsconfig';

const { create } = resolvePkg;

// Cache untuk instance resolver agar tidak membuat instance berulang kali
let cachedResolver = null;
let currentProjectRoot = null;

export function clearResolverCache() {
    cachedResolver = null;
    currentProjectRoot = null;
}

function loadAllConfigs(projectRoot) {
    const configs = [];
    const visited = new Set();

    function addConfig(searchDir, configName = 'tsconfig.json') {
        const key = `${searchDir}::${configName}`;
        if (visited.has(key)) return;
        visited.add(key);

        const res = getTsconfig(searchDir, configName);
        if (res && res.config && res.path) {
            configs.push(res);
            if (Array.isArray(res.config.references)) {
                for (const ref of res.config.references) {
                    if (ref && ref.path) {
                        const refPath = path.resolve(path.dirname(res.path), ref.path);
                        let refDir = refPath;
                        let refName = 'tsconfig.json';
                        if (refPath.endsWith('.json')) {
                            refDir = path.dirname(refPath);
                            refName = path.basename(refPath);
                        }
                        addConfig(refDir, refName);
                    }
                }
            }
        }
    }

    addConfig(projectRoot, 'tsconfig.json');
    addConfig(projectRoot, 'jsconfig.json');
    const commonNames = ['tsconfig.app.json', 'tsconfig.base.json', 'tsconfig.node.json', 'tsconfig.web.json', 'tsconfig.build.json', 'jsconfig.app.json'];
    for (const name of commonNames) {
        addConfig(projectRoot, name);
    }

    return configs;
}

function extractSubpathTargets(val) {
    if (typeof val === 'string') return [val];
    if (Array.isArray(val)) return val.flatMap(extractSubpathTargets);
    if (val && typeof val === 'object') {
        const targets = [];
        for (const v of Object.values(val)) {
            targets.push(...extractSubpathTargets(v));
        }
        return targets;
    }
    return [];
}

function initializeResolver(projectRoot) {
    if (cachedResolver && currentProjectRoot === projectRoot) {
        return cachedResolver;
    }

    const configs = loadAllConfigs(projectRoot);
    const alias = {};
    let absoluteBaseUrl = projectRoot;

    // 1. Membaca path alias dari semua tsconfig.json atau jsconfig.json yang ditemukan
    for (const tsconfig of configs) {
        if (tsconfig?.config?.compilerOptions?.baseUrl) {
            const baseUrl = tsconfig.config.compilerOptions.baseUrl;
            absoluteBaseUrl = path.resolve(path.dirname(tsconfig.path), baseUrl);
        }
        if (tsconfig?.config?.compilerOptions?.paths) {
            const paths = tsconfig.config.compilerOptions.paths;
            const cfgBaseUrl = tsconfig.config.compilerOptions.baseUrl || '.';
            const cfgAbsoluteBaseUrl = path.resolve(path.dirname(tsconfig.path), cfgBaseUrl);

            for (const [key, values] of Object.entries(paths)) {
                if (!Array.isArray(values) || values.length === 0) continue;
                const aliasKey = key.replace(/\/\*$/, '');
                const targetPaths = values.map(v => path.resolve(cfgAbsoluteBaseUrl, v.replace(/\/\*$/, '')));
                
                if (!alias[aliasKey]) {
                    alias[aliasKey] = targetPaths.length === 1 ? targetPaths[0] : targetPaths;
                }
            }
        }
    }

    // 2. Membaca subpath imports (#*) dari package.json (mendukung objek kondisional & array)
    const pkgPath = path.join(projectRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
        try {
            const pkg = fs.readJsonSync(pkgPath);
            if (pkg.imports && typeof pkg.imports === 'object') {
                for (const [key, val] of Object.entries(pkg.imports)) {
                    const aliasKey = key.replace(/\/\*$/, '');
                    const rawTargets = extractSubpathTargets(val);
                    const targetPaths = rawTargets
                        .filter(t => typeof t === 'string')
                        .map(t => path.resolve(projectRoot, t.replace(/\/\*$/, '')));
                    if (targetPaths.length > 0 && !alias[aliasKey]) {
                        alias[aliasKey] = targetPaths.length === 1 ? targetPaths[0] : targetPaths;
                    }
                }
            }
        } catch (_err) {
            // Abaikan kesalahan pembacaan package.json
        }
    }

    // 3. Fallback otomatis untuk framework umum (Next.js, Vite, SvelteKit, dll.)
    const srcPath = path.resolve(projectRoot, 'src');
    if (fs.existsSync(srcPath)) {
        if (!alias['@']) alias['@'] = srcPath;
        if (!alias['~']) alias['~'] = srcPath;
        const libPath = path.join(srcPath, 'lib');
        if (!alias['$lib'] && fs.existsSync(libPath)) {
            alias['$lib'] = libPath;
        }
    }

    cachedResolver = create({
        extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.cts', '.json', '.node', '.vue', '.svelte', '.astro', '.css', '.scss', '.less', '.svg', '.html', '.md'],
        alias: alias,
        modules: ['node_modules', absoluteBaseUrl],
        // Prioritaskan file source asli daripada build browser (berguna untuk static analysis)
        conditionNames: ['import', 'require', 'node', 'default'],
        mainFields: ['module', 'main'],
        exportsFields: ['exports'],
        importsFields: ['imports'],
    });

    currentProjectRoot = projectRoot;
    return cachedResolver;
}

/**
 * Mensimulasikan resolusi path Node.js/Webpack secara presisi menggunakan `enhanced-resolve`.
 * Mampu membaca alias (dari tsconfig.json) serta ekstensi implisit secara akurat.
 * 
 * @param {string} projectRoot - Direktori root proyek (untuk membaca konfigurasi)
 * @param {string} baseDir - Direktori tempat file yang memanggil berada
 * @param {string} importPath - Path import yang tertera di kode (contoh: '@/utils/math')
 * @returns {Promise<string|null>} Path absolut file yang dituju, atau null jika gagal
 */
export async function resolvePath(projectRoot, baseDir, importPath) {
    const resolver = initializeResolver(projectRoot);

    return new Promise((resolve) => {
        // Pemanggilan signature lengkap: resolver(context, path, request, resolveContext, callback)
        resolver({}, baseDir, importPath, {}, (err, result) => {
            if (err || !result) {
                resolve(null);
            } else {
                resolve(result);
            }
        });
    });
}
