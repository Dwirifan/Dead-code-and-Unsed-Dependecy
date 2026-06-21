import fs from 'fs-extra';
import path from 'path';

/**
 * ESLint Config Parser
 *
 * Terinspirasi dari depcheck/src/special/eslint.js
 *
 * Membaca file konfigurasi ESLint dan mengekstrak nama paket NPM yang
 * benar-benar digunakan di dalamnya (plugins, parsers, dan extends/configs).
 *
 * File konfigurasi yang didukung:
 *   - .eslintrc.json
 *   - .eslintrc.js / .eslintrc.cjs
 *   - eslint.config.js / eslint.config.mjs (format flat config ESLint v9+)
 *   - Field "eslintConfig" di dalam package.json
 */

/**
 * Menormalkan nama plugin ESLint ke nama paket NPM lengkap.
 * Contoh: "react" → "eslint-plugin-react"
 *         "@typescript-eslint/typescript" → "@typescript-eslint/eslint-plugin-typescript"
 *
 * @param {string} name
 * @returns {string}
 */
function normalizePluginName(name) {
    if (!name) return null;
    if (name.startsWith('@')) {
        // Scoped package: @scope/name → @scope/eslint-plugin-name (jika belum ada prefix)
        const [scope, rest] = name.split('/');
        if (!rest) return `${scope}/eslint-plugin`;
        if (rest.startsWith('eslint-plugin')) return name;
        return `${scope}/eslint-plugin-${rest}`;
    }
    if (name.startsWith('eslint-plugin-')) return name;
    return `eslint-plugin-${name}`;
}

/**
 * Menormalkan nama config/extends ESLint ke nama paket NPM lengkap.
 * Contoh: "airbnb" → "eslint-config-airbnb"
 *         "plugin:react/recommended" → "eslint-plugin-react"
 *
 * @param {string} name
 * @returns {string|null}
 */
function normalizeConfigName(name) {
    if (!name) return null;
    // Built-in configs — bukan paket eksternal
    if (name === 'eslint:recommended' || name === 'eslint:all') return null;
    // Format flat config path lokal
    if (name.startsWith('./') || name.startsWith('../') || path.isAbsolute(name)) return null;

    // "plugin:react/recommended" → ambil nama plugin
    if (name.startsWith('plugin:')) {
        const pluginPart = name.slice(7); // "react/recommended"
        const pluginName = pluginPart.split('/')[0]; // "react"
        return normalizePluginName(pluginName);
    }

    // Scoped config: "@scope/name" → "@scope/eslint-config-name"
    if (name.startsWith('@')) {
        const [scope, rest] = name.split('/');
        if (!rest) return `${scope}/eslint-config`;
        if (rest.startsWith('eslint-config')) return name;
        return `${scope}/eslint-config-${rest}`;
    }

    if (name.startsWith('eslint-config-')) return name;
    return `eslint-config-${name}`;
}

/**
 * Mengekstrak daftar paket yang digunakan dari satu objek config ESLint.
 *
 * @param {object} config - Objek konfigurasi ESLint yang sudah diparsing
 * @returns {string[]} - Daftar nama paket NPM yang ditemukan
 */
function extractPackagesFromConfig(config) {
    if (!config || typeof config !== 'object') return [];

    const packages = new Set();

    // Ekstrak plugins
    const plugins = config.plugins || [];
    const pluginList = Array.isArray(plugins) ? plugins : Object.keys(plugins);
    for (const plugin of pluginList) {
        const normalized = normalizePluginName(plugin);
        if (normalized) packages.add(normalized);
    }

    // Ekstrak parser (mis. @typescript-eslint/parser)
    if (config.parser && typeof config.parser === 'string') {
        packages.add(config.parser);
    }

    // Ekstrak extends / configs
    const extendsArray = config.extends
        ? (Array.isArray(config.extends) ? config.extends : [config.extends])
        : [];
    for (const ext of extendsArray) {
        const normalized = normalizeConfigName(ext);
        if (normalized) packages.add(normalized);
    }

    // Rekursif ke overrides (untuk format ESLint lama)
    if (Array.isArray(config.overrides)) {
        for (const override of config.overrides) {
            for (const pkg of extractPackagesFromConfig(override)) {
                packages.add(pkg);
            }
        }
    }

    return [...packages];
}

/**
 * Membaca dan mengurai file konfigurasi ESLint dari direktori proyek.
 *
 * @param {string} projectRoot - Path direktori akar proyek
 * @returns {Promise<string[]>} - Daftar paket NPM yang digunakan oleh ESLint
 */
export async function parseEslintConfig(projectRoot) {
    const usedPackages = new Set();

    // --- Prioritas 1: File konfigurasi ESLint tersendiri ---
    const configFiles = [
        '.eslintrc.json',
        '.eslintrc.js',
        '.eslintrc.cjs',
        '.eslintrc.yaml',
        '.eslintrc.yml',
        'eslint.config.js',
        'eslint.config.mjs',
        'eslint.config.cjs',
    ];

    for (const configFile of configFiles) {
        const configPath = path.join(projectRoot, configFile);
        if (!await fs.pathExists(configPath)) continue;

        try {
            let config;
            if (configFile.endsWith('.json') || configFile.endsWith('.yaml') || configFile.endsWith('.yml')) {
                // JSON / YAML — baca sebagai teks lalu parse
                const raw = await fs.readFile(configPath, 'utf-8');
                config = JSON.parse(raw);
            } else {
                // JS config — gunakan dynamic import
                // CATATAN: Untuk .eslintrc.js yang menggunakan CJS (module.exports), gunakan createRequire
                const { createRequire } = await import('module');
                const require = createRequire(import.meta.url);
                try {
                    config = require(configPath);
                } catch {
                    // Coba dynamic import sebagai fallback (ESM)
                    const mod = await import(configPath);
                    config = mod.default || mod;
                }
            }

            // Flat config (Array) — ESLint v9+
            if (Array.isArray(config)) {
                for (const entry of config) {
                    for (const pkg of extractPackagesFromConfig(entry)) {
                        usedPackages.add(pkg);
                    }
                }
            } else {
                for (const pkg of extractPackagesFromConfig(config)) {
                    usedPackages.add(pkg);
                }
            }
            break; // Cukup baca satu file config ESLint
        } catch (err) {
            // Abaikan error parsing — file mungkin menggunakan syntax yang tidak didukung
            if (process.env.DEBUG) console.warn(err);
        }
    }

    // --- Prioritas 2: Field "eslintConfig" di dalam package.json ---
    const pkgPath = path.join(projectRoot, 'package.json');
    if (await fs.pathExists(pkgPath)) {
        try {
            const pkg = await fs.readJson(pkgPath);
            if (pkg.eslintConfig) {
                for (const pkgName of extractPackagesFromConfig(pkg.eslintConfig)) {
                    usedPackages.add(pkgName);
                }
            }
        } catch (err) {
            // Abaikan error baca package.json
            if (process.env.DEBUG) console.warn(err);
        }
    }

    return [...usedPackages];
}
