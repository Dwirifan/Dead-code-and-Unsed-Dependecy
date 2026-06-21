import fs from 'fs-extra';
import path from 'path';

/**
 * Babel Config Parser
 *
 * Terinspirasi dari depcheck/src/special/babel.js
 *
 * Membaca file konfigurasi Babel dan mengekstrak nama paket NPM yang
 * benar-benar digunakan di dalamnya (plugins dan presets).
 *
 * File konfigurasi yang didukung:
 *   - babel.config.json
 *   - babel.config.js / babel.config.cjs / babel.config.mjs
 *   - .babelrc / .babelrc.json / .babelrc.js
 *   - Field "babel" di dalam package.json
 */

/**
 * Menormalkan nama plugin Babel ke nama paket NPM lengkap.
 * Contoh: "transform-runtime" → "babel-plugin-transform-runtime"
 *         "@babel/proposal-class-properties" → "@babel/plugin-proposal-class-properties"
 *
 * @param {string|Array} plugin - Nama plugin (string) atau [name, options]
 * @returns {string|null}
 */
function normalizePluginName(plugin) {
    // Babel mengizinkan format [pluginName, options] — ambil nama saja
    const name = Array.isArray(plugin) ? plugin[0] : plugin;
    if (!name || typeof name !== 'string') return null;
    // Path lokal — bukan paket
    if (name.startsWith('./') || name.startsWith('../') || path.isAbsolute(name)) return null;

    if (name.startsWith('@babel/')) {
        // @babel/syntax-xxx atau @babel/plugin-xxx
        if (name.includes('/plugin-') || name.includes('/syntax-')) return name;
        const rest = name.replace('@babel/', '');
        return `@babel/plugin-${rest}`;
    }
    if (name.startsWith('babel-plugin-')) return name;
    return `babel-plugin-${name}`;
}

/**
 * Menormalkan nama preset Babel ke nama paket NPM lengkap.
 * Contoh: "env" → "babel-preset-env"
 *         "@babel/env" → "@babel/preset-env"
 *
 * @param {string|Array} preset - Nama preset (string) atau [name, options]
 * @returns {string|null}
 */
function normalizePresetName(preset) {
    const name = Array.isArray(preset) ? preset[0] : preset;
    if (!name || typeof name !== 'string') return null;
    if (name.startsWith('./') || name.startsWith('../') || path.isAbsolute(name)) return null;

    if (name.startsWith('@babel/')) {
        if (name.includes('/preset-')) return name;
        const rest = name.replace('@babel/', '');
        return `@babel/preset-${rest}`;
    }
    if (name.startsWith('babel-preset-')) return name;
    return `babel-preset-${name}`;
}

/**
 * Mengekstrak daftar paket yang digunakan dari satu objek config Babel.
 *
 * @param {object} config - Objek konfigurasi Babel yang sudah diparsing
 * @returns {string[]} - Daftar nama paket NPM yang ditemukan
 */
function extractPackagesFromConfig(config) {
    if (!config || typeof config !== 'object') return [];

    const packages = new Set();

    // Ekstrak plugins
    const plugins = config.plugins || [];
    for (const plugin of plugins) {
        const normalized = normalizePluginName(plugin);
        if (normalized) packages.add(normalized);
    }

    // Ekstrak presets
    const presets = config.presets || [];
    for (const preset of presets) {
        const normalized = normalizePresetName(preset);
        if (normalized) packages.add(normalized);
    }

    // Rekursif ke env-specific config (contoh: { env: { test: { plugins: [...] } } })
    if (config.env && typeof config.env === 'object') {
        for (const envConfig of Object.values(config.env)) {
            for (const pkg of extractPackagesFromConfig(envConfig)) {
                packages.add(pkg);
            }
        }
    }

    // Rekursif ke overrides
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
 * Membaca dan mengurai file konfigurasi Babel dari direktori proyek.
 *
 * @param {string} projectRoot - Path direktori akar proyek
 * @returns {Promise<string[]>} - Daftar paket NPM yang digunakan oleh Babel
 */
export async function parseBabelConfig(projectRoot) {
    const usedPackages = new Set();

    // --- Prioritas 1: File konfigurasi Babel tersendiri ---
    const configFiles = [
        'babel.config.json',
        'babel.config.js',
        'babel.config.cjs',
        'babel.config.mjs',
        '.babelrc',
        '.babelrc.json',
        '.babelrc.js',
        '.babelrc.cjs',
    ];

    for (const configFile of configFiles) {
        const configPath = path.join(projectRoot, configFile);
        if (!await fs.pathExists(configPath)) continue;

        try {
            let config;
            if (configFile.endsWith('.json') || configFile === '.babelrc') {
                const raw = await fs.readFile(configPath, 'utf-8');
                config = JSON.parse(raw);
            } else {
                // JS config — gunakan createRequire untuk mendukung CJS
                const { createRequire } = await import('module');
                const require = createRequire(import.meta.url);
                try {
                    config = require(configPath);
                } catch {
                    const mod = await import(configPath);
                    config = mod.default || mod;
                }
                // Jika config adalah fungsi (babel.config.js bisa mengekspor fungsi)
                if (typeof config === 'function') {
                    config = config({ env: () => false, cache: () => undefined });
                }
            }

            for (const pkg of extractPackagesFromConfig(config)) {
                usedPackages.add(pkg);
            }
            break; // Cukup baca satu file config Babel
        } catch (err) {
            // Abaikan error parsing
            if (process.env.DEBUG) console.warn(err);
        }
    }

    // --- Prioritas 2: Field "babel" di dalam package.json ---
    const pkgPath = path.join(projectRoot, 'package.json');
    if (await fs.pathExists(pkgPath)) {
        try {
            const pkg = await fs.readJson(pkgPath);
            if (pkg.babel) {
                for (const pkgName of extractPackagesFromConfig(pkg.babel)) {
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
