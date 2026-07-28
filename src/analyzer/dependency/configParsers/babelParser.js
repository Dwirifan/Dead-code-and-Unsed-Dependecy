import fs from 'fs-extra';
import path from 'path';
import {
    collectStaticConfigValues,
    createIncompletePropertyDiagnostic,
    getPropertyName,
    parseStaticJavaScriptConfig,
    visitAst,
} from './staticConfigParser.js';

function unwrapBabelEntry(entry) {
    return Array.isArray(entry) ? entry[0] : entry;
}

function normalizePluginName(plugin) {
    const name = unwrapBabelEntry(plugin);
    if (!name || typeof name !== 'string') return null;
    if (name.startsWith('./') || name.startsWith('../') || path.isAbsolute(name)) return null;

    if (name.startsWith('@babel/')) {
        if (name.includes('/plugin-') || name.includes('/syntax-')) return name.split('/').slice(0, 2).join('/');
        return `@babel/plugin-${name.slice('@babel/'.length).split('/')[0]}`;
    }

    if (name.startsWith('@')) {
        const [scope, packageName] = name.split('/');
        if (!packageName) return `${scope}/babel-plugin`;
        if (packageName.startsWith('babel-plugin')) return `${scope}/${packageName}`;
        return `${scope}/babel-plugin-${packageName}`;
    }

    const packageName = name.split('/')[0];
    if (packageName.startsWith('babel-plugin-')) return packageName;
    return `babel-plugin-${packageName}`;
}

function normalizePresetName(preset) {
    const name = unwrapBabelEntry(preset);
    if (!name || typeof name !== 'string') return null;
    if (name.startsWith('./') || name.startsWith('../') || path.isAbsolute(name)) return null;

    if (name.startsWith('@babel/')) {
        if (name.includes('/preset-')) return name.split('/').slice(0, 2).join('/');
        return `@babel/preset-${name.slice('@babel/'.length).split('/')[0]}`;
    }

    if (name.startsWith('@')) {
        const [scope, packageName] = name.split('/');
        if (!packageName) return `${scope}/babel-preset`;
        if (packageName.startsWith('babel-preset')) return `${scope}/${packageName}`;
        return `${scope}/babel-preset-${packageName}`;
    }

    const packageName = name.split('/')[0];
    if (packageName.startsWith('babel-preset-')) return packageName;
    return `babel-preset-${packageName}`;
}

function addBabelObjectPackages(config, packages) {
    if (!config || typeof config !== 'object') return;

    for (const plugin of config.plugins || []) {
        const normalized = normalizePluginName(plugin);
        if (normalized) packages.add(normalized);
    }

    for (const preset of config.presets || []) {
        const normalized = normalizePresetName(preset);
        if (normalized) packages.add(normalized);
    }

    if (config.env && typeof config.env === 'object') {
        Object.values(config.env).forEach(entry => addBabelObjectPackages(entry, packages));
    }
    if (Array.isArray(config.overrides)) {
        config.overrides.forEach(entry => addBabelObjectPackages(entry, packages));
    }
}

function extractPackagesFromStaticAst(staticResult, filePath) {
    const packages = new Set(staticResult.packages);
    const diagnostics = [...staticResult.diagnostics];
    if (!staticResult.ast) return { packages, diagnostics };

    visitAst(staticResult.ast, (node) => {
        if (node.type !== 'Property') return;
        const propertyName = getPropertyName(node);
        if (propertyName !== 'plugins' && propertyName !== 'presets') return;

        const extracted = collectStaticConfigValues(
            node.value,
            staticResult.importedBindings,
            { tupleFirst: true },
        );
        for (const value of extracted.values) {
            const normalized = propertyName === 'plugins'
                ? normalizePluginName(value)
                : normalizePresetName(value);
            if (normalized) packages.add(normalized);
        }
        if (!extracted.complete) {
            diagnostics.push(createIncompletePropertyDiagnostic(filePath, propertyName, node.value));
        }
    });

    return { packages, diagnostics };
}

function parserResult(packages, diagnostics, files) {
    return {
        packages,
        diagnostics,
        files,
        complete: !diagnostics.some(d => d.affectsDependencyClassification),
    };
}

/**
 * Versi detail yang hanya membaca/parse config, tidak pernah mengeksekusinya.
 */
export async function parseBabelConfigDetailed(projectRoot) {
    const packages = new Set();
    const diagnostics = [];
    const files = [];
    const configFiles = [
        'babel.config.json',
        'babel.config.js',
        'babel.config.cjs',
        'babel.config.mjs',
        'babel.config.ts',
        '.babelrc',
        '.babelrc.json',
        '.babelrc.js',
        '.babelrc.cjs',
    ];

    for (const configFile of configFiles) {
        const configPath = path.join(projectRoot, configFile);
        if (!await fs.pathExists(configPath)) continue;
        files.push(configPath);

        try {
            const raw = await fs.readFile(configPath, 'utf-8');
            if (configFile.endsWith('.json') || configFile === '.babelrc') {
                addBabelObjectPackages(JSON.parse(raw), packages);
            } else {
                const result = extractPackagesFromStaticAst(
                    parseStaticJavaScriptConfig(raw, configPath),
                    configPath,
                );
                result.packages.forEach(pkg => packages.add(pkg));
                diagnostics.push(...result.diagnostics);
            }
        } catch (err) {
            diagnostics.push({
                source: configPath,
                code: 'CONFIG_READ_FAILED',
                severity: 'warning',
                message: `Gagal membaca Babel config secara statis: ${err.message}`,
                line: null,
                affectsDependencyClassification: true,
            });
        }
    }

    const pkgPath = path.join(projectRoot, 'package.json');
    if (await fs.pathExists(pkgPath)) {
        try {
            const pkg = await fs.readJson(pkgPath);
            if (pkg.babel) addBabelObjectPackages(pkg.babel, packages);
        } catch (err) {
            diagnostics.push({
                source: pkgPath,
                code: 'PACKAGE_CONFIG_READ_FAILED',
                severity: 'warning',
                message: `Gagal membaca package.json#babel: ${err.message}`,
                line: null,
                affectsDependencyClassification: true,
            });
        }
    }

    return parserResult(packages, diagnostics, files);
}

/**
 * API lama dipertahankan: Array<string>.
 */
export async function parseBabelConfig(projectRoot) {
    const result = await parseBabelConfigDetailed(projectRoot);
    return [...result.packages];
}
