import path from 'path';
import fs from 'fs-extra';
import resolvePkg from 'enhanced-resolve';
import { getTsconfig } from 'get-tsconfig';

const { create } = resolvePkg;

// Cache untuk instance resolver agar tidak membuat instance berulang kali
let cachedResolver = null;
let currentProjectRoot = null;

function initializeResolver(projectRoot) {
    if (cachedResolver && currentProjectRoot === projectRoot) {
        return cachedResolver;
    }

    const tsconfig = getTsconfig(projectRoot);
    const alias = {};

    // Membaca path alias dari tsconfig.json atau jsconfig.json
    if (tsconfig?.config?.compilerOptions?.paths) {
        const paths = tsconfig.config.compilerOptions.paths;
        const baseUrl = tsconfig.config.compilerOptions.baseUrl || '.';
        const absoluteBaseUrl = path.resolve(projectRoot, baseUrl);

        for (const [key, values] of Object.entries(paths)) {
            // Hapus wildcard /* agar dimengerti oleh enhanced-resolve
            const aliasKey = key.replace(/\/\*$/, '');
            const targetPath = values[0].replace(/\/\*$/, '');
            
            alias[aliasKey] = path.resolve(absoluteBaseUrl, targetPath);
        }
    }

    // Fallback otomatis: Jika tidak ada tsconfig.json, anggap @/ atau ~/ mengarah ke folder src/
    if (Object.keys(alias).length === 0) {
        const srcPath = path.resolve(projectRoot, 'src');
        if (fs.existsSync(srcPath)) {
            alias['@'] = srcPath;
            alias['~'] = srcPath;
        }
    }

    cachedResolver = create({
        extensions: ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts', '.json', '.node'],
        alias: alias,
        // Prioritaskan file source asli daripada build browser (berguna untuk static analysis)
        conditionNames: ['import', 'require', 'node', 'default'],
        mainFields: ['module', 'main'],
        exportsFields: ['exports'], // FITUR 3: Export Maps Resolution (Node.js)
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
