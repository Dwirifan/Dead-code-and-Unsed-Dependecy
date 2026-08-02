import fs from 'fs-extra';
import path from 'node:path';
import {
    getPropertyName,
    getStaticString,
    packageNameFromSpecifier,
    parseStaticJavaScriptConfig,
    visitAst,
} from './staticConfigParser.js';

const CONFIG_FILES = [
    'vitest.config.js',
    'vitest.config.mjs',
    'vitest.config.cjs',
    'vitest.config.ts',
    'vitest.config.mts',
    'vitest.config.cts',
];

const COVERAGE_PROVIDERS = {
    v8: '@vitest/coverage-v8',
    istanbul: '@vitest/coverage-istanbul',
};

const TEST_ENVIRONMENTS = {
    jsdom: 'jsdom',
    'happy-dom': 'happy-dom',
};

function extractVitestConventions(staticResult, packages) {
    if (!staticResult.ast) return;

    visitAst(staticResult.ast, node => {
        if (node.type !== 'Property') return;
        const propertyName = getPropertyName(node);
        const value = getStaticString(node.value);
        if (value === null) return;

        if (propertyName === 'provider' && COVERAGE_PROVIDERS[value]) {
            packages.add(COVERAGE_PROVIDERS[value]);
        } else if (propertyName === 'environment' && TEST_ENVIRONMENTS[value]) {
            packages.add(TEST_ENVIRONMENTS[value]);
        } else if (propertyName === 'customProviderModule') {
            const packageName = packageNameFromSpecifier(value);
            if (packageName) packages.add(packageName);
        }
    });
}

export async function parseVitestConfigDetailed(projectRoot) {
    const packages = new Set();
    const diagnostics = [];
    const files = [];

    for (const configFile of CONFIG_FILES) {
        const configPath = path.join(projectRoot, configFile);
        if (!await fs.pathExists(configPath)) continue;
        files.push(configPath);

        try {
            const source = await fs.readFile(configPath, 'utf8');
            const result = parseStaticJavaScriptConfig(source, configPath);
            result.packages.forEach(packageName => packages.add(packageName));
            diagnostics.push(...result.diagnostics);
            extractVitestConventions(result, packages);
        } catch (error) {
            diagnostics.push({
                source: configPath,
                code: 'CONFIG_READ_FAILED',
                severity: 'warning',
                message: `Gagal membaca Vitest config secara statis: ${error.message}`,
                line: null,
                affectsDependencyClassification: true,
            });
        }
    }

    return {
        packages,
        diagnostics,
        files,
        complete: !diagnostics.some(item => item.affectsDependencyClassification),
    };
}
