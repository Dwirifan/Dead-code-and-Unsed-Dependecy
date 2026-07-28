import fs from 'fs-extra';
import path from 'path';
import {
    collectStaticConfigValues,
    createIncompletePropertyDiagnostic,
    getPropertyName,
    parseStaticJavaScriptConfig,
    visitAst,
} from './staticConfigParser.js';

function normalizePluginName(name) {
    if (!name || typeof name !== 'string') return null;
    if (name.startsWith('@')) {
        const [scope, packageName] = name.split('/');
        if (!packageName) return `${scope}/eslint-plugin`;
        if (packageName.startsWith('eslint-plugin')) return `${scope}/${packageName}`;
        return `${scope}/eslint-plugin-${packageName}`;
    }
    if (name.startsWith('eslint-plugin-')) return name;
    return `eslint-plugin-${name}`;
}

function normalizeConfigName(name) {
    if (!name || typeof name !== 'string') return null;
    if (name === 'eslint:recommended' || name === 'eslint:all') return null;
    if (name.startsWith('./') || name.startsWith('../') || path.isAbsolute(name)) return null;

    if (name.startsWith('plugin:')) {
        const pluginPath = name.slice('plugin:'.length);
        const parts = pluginPath.split('/');
        const pluginName = pluginPath.startsWith('@')
            ? parts.slice(0, 2).join('/')
            : parts[0];
        return normalizePluginName(pluginName);
    }

    if (name.startsWith('@')) {
        const [scope, packageName] = name.split('/');
        if (!packageName) return `${scope}/eslint-config`;
        if (packageName.startsWith('eslint-config')) return `${scope}/${packageName}`;
        return `${scope}/eslint-config-${packageName}`;
    }

    const packageName = name.split('/')[0];
    if (packageName.startsWith('eslint-config-')) return packageName;
    return `eslint-config-${packageName}`;
}

function addEslintObjectPackages(config, packages) {
    if (!config || typeof config !== 'object') return;

    if (Array.isArray(config)) {
        config.forEach(entry => addEslintObjectPackages(entry, packages));
        return;
    }

    const plugins = config.plugins || [];
    if (Array.isArray(plugins)) {
        for (const plugin of plugins) {
            const normalized = normalizePluginName(plugin);
            if (normalized) packages.add(normalized);
        }
    } else if (plugins && typeof plugins === 'object') {
        // Flat config memakai alias sebagai key. Nilai objek tidak dapat dipetakan
        // ke nama paket dari JSON, jadi jangan menebak berdasarkan alias.
    }

    if (typeof config.parser === 'string') packages.add(config.parser);
    if (typeof config.languageOptions?.parser === 'string') packages.add(config.languageOptions.parser);

    const extensions = config.extends
        ? (Array.isArray(config.extends) ? config.extends : [config.extends])
        : [];
    for (const extension of extensions) {
        const normalized = normalizeConfigName(extension);
        if (normalized) packages.add(normalized);
    }

    if (Array.isArray(config.overrides)) {
        config.overrides.forEach(entry => addEslintObjectPackages(entry, packages));
    }
}

function extractPackagesFromStaticAst(staticResult, filePath) {
    const packages = new Set(staticResult.packages);
    const diagnostics = [...staticResult.diagnostics];
    if (!staticResult.ast) return { packages, diagnostics };

    visitAst(staticResult.ast, (node) => {
        if (node.type !== 'Property') return;
        const propertyName = getPropertyName(node);
        if (!['plugins', 'parser', 'extends'].includes(propertyName)) return;

        const isFlatPluginObject = propertyName === 'plugins' && node.value?.type === 'ObjectExpression';
        const extracted = collectStaticConfigValues(
            node.value,
            staticResult.importedBindings,
            { objectValues: isFlatPluginObject },
        );

        for (const value of extracted.values) {
            const normalized = propertyName === 'plugins'
                ? normalizePluginName(value)
                : propertyName === 'extends'
                    ? normalizeConfigName(value)
                    : value;
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
 * Versi detail yang tidak pernah mengeksekusi JavaScript config.
 */
export async function parseEslintConfigDetailed(projectRoot) {
    const packages = new Set();
    const diagnostics = [];
    const files = [];
    const configFiles = [
        '.eslintrc.json',
        '.eslintrc.js',
        '.eslintrc.cjs',
        '.eslintrc.yaml',
        '.eslintrc.yml',
        'eslint.config.js',
        'eslint.config.mjs',
        'eslint.config.cjs',
        'eslint.config.ts',
        'eslint.config.mts',
        'eslint.config.cts',
    ];

    for (const configFile of configFiles) {
        const configPath = path.join(projectRoot, configFile);
        if (!await fs.pathExists(configPath)) continue;
        files.push(configPath);

        try {
            const raw = await fs.readFile(configPath, 'utf-8');
            if (configFile.endsWith('.json')) {
                addEslintObjectPackages(JSON.parse(raw), packages);
            } else if (configFile.endsWith('.yaml') || configFile.endsWith('.yml')) {
                diagnostics.push({
                    source: configPath,
                    code: 'CONFIG_FORMAT_UNSUPPORTED',
                    severity: 'warning',
                    message: 'ESLint YAML config tidak dieksekusi atau ditebak; dependency config diperlakukan sebagai unknown.',
                    line: null,
                    affectsDependencyClassification: true,
                });
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
                message: `Gagal membaca ESLint config secara statis: ${err.message}`,
                line: null,
                affectsDependencyClassification: true,
            });
        }
    }

    const pkgPath = path.join(projectRoot, 'package.json');
    if (await fs.pathExists(pkgPath)) {
        try {
            const pkg = await fs.readJson(pkgPath);
            if (pkg.eslintConfig) addEslintObjectPackages(pkg.eslintConfig, packages);
        } catch (err) {
            diagnostics.push({
                source: pkgPath,
                code: 'PACKAGE_CONFIG_READ_FAILED',
                severity: 'warning',
                message: `Gagal membaca package.json#eslintConfig: ${err.message}`,
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
export async function parseEslintConfig(projectRoot) {
    const result = await parseEslintConfigDetailed(projectRoot);
    return [...result.packages];
}
