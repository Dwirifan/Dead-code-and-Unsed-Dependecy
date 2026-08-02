import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';

import {
    findUnusedDependencies,
    getDeclaredDependencies,
} from '../../../src/analyzer/dependency/dependencyAnalyzer.js';
import {
    runConfigParsers,
    runConfigParsersDetailed,
} from '../../../src/analyzer/dependency/configParsers/configParserRunner.js';

describe('Dependency Analyzer - conservative and pure pipeline', () => {
    let projectRoot;

    beforeEach(async () => {
        projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'deadkiller-dependency-'));
    });

    afterEach(async () => {
        if (projectRoot) await fs.remove(projectRoot);
    });

    async function writePackage(pkg) {
        await fs.writeJson(path.join(projectRoot, 'package.json'), pkg);
    }

    it('does not mutate the caller usedPackages Set', async () => {
        await writePackage({
            dependencies: {
                next: '^15.0.0',
                react: '^19.0.0',
                'react-dom': '^19.0.0',
            },
        });
        const input = new Set(['next']);
        const report = await findUnusedDependencies(projectRoot, input);

        expect([...input]).toEqual(['next']);
        expect(report.used).not.toBe(input);
        expect(report.used.has('next')).toBe(true);
        expect(report.used.has('react')).toBe(false);
        expect(report.used.has('react-dom')).toBe(false);
        expect(report.uncertain).toEqual(expect.arrayContaining(['react', 'react-dom']));
    });

    it('does not treat declared framework relationships as usage or manufactured missing dependencies', async () => {
        await writePackage({
            dependencies: {
                next: '^15.0.0',
                react: '^19.0.0',
            },
        });

        const declaredOnly = await findUnusedDependencies(projectRoot, new Set());
        const usedFramework = await findUnusedDependencies(projectRoot, new Set(['next']));

        expect(declaredOnly.used.has('next')).toBe(false);
        expect(declaredOnly.used.has('react')).toBe(false);
        expect(declaredOnly.uncertain).toEqual(expect.arrayContaining(['next', 'react']));
        expect(declaredOnly.missing).not.toEqual(expect.arrayContaining(['react-dom', 'eslint-config-next']));

        expect(usedFramework.used.has('next')).toBe(true);
        expect(usedFramework.used.has('react')).toBe(false);
        expect(usedFramework.uncertain).toContain('react');
        expect(usedFramework.missing).not.toEqual(expect.arrayContaining(['react-dom', 'eslint-config-next']));
    });

    it('recognizes script binaries from runtime and dev dependencies and reports undeclared binaries', async () => {
        await writePackage({
            dependencies: {
                'runtime-cli': '1.0.0',
                'runtime-unused': '1.0.0',
            },
            devDependencies: {
                'dev-cli': '1.0.0',
            },
            scripts: {
                build: 'echo "runtime-cli | quoted" && runtime-cli build && dev-cli check && ghost-cli run',
            },
        });

        const report = await findUnusedDependencies(projectRoot, new Set());

        expect(report.unused).toEqual(['runtime-unused']);
        expect(report.deadDevDeps).not.toContain('dev-cli');
        expect([...report.usedViaCli]).toEqual(expect.arrayContaining(['runtime-cli', 'dev-cli']));
        expect(report.missingBinaries).toContain('ghost-cli');
        expect(report.missingBinaries).not.toContain('quoted');
    });

    it('treats peer and optional dependencies as declared and uses exact scoped names', async () => {
        await writePackage({
            dependencies: {
                '@scope/a': '1.0.0',
            },
            peerDependencies: {
                react: '^19.0.0',
            },
            optionalDependencies: {
                fsevents: '^2.0.0',
            },
        });

        const report = await findUnusedDependencies(
            projectRoot,
            new Set(['@scope/b', 'react', 'fsevents']),
        );
        const declared = await getDeclaredDependencies(projectRoot);

        expect(report.missing).toEqual(['@scope/b']);
        expect([...declared.peerDeps]).toEqual(['react']);
        expect([...declared.optionalDeps]).toEqual(['fsevents']);
        expect(report.peerDeclared).toBeInstanceOf(Set);
        expect(report.optionalDeclared).toBeInstanceOf(Set);
    });

    it('does not report package self-references as missing dependencies', async () => {
        await writePackage({
            name: '@scope/cac',
            version: '1.0.0',
        });

        const report = await findUnusedDependencies(
            projectRoot,
            new Set(['@scope/cac', '@scope/cac/testing', 'external-package']),
        );

        expect(report.missing).toEqual(['external-package']);
        expect([...report.selfReferences]).toEqual(['@scope/cac']);
    });

    it('does not execute JavaScript configs and still extracts static config dependencies', async () => {
        const markerPath = path.join(projectRoot, 'executed.marker');
        await writePackage({
            dependencies: {
                'custom-parser': '1.0.0',
            },
        });
        await fs.writeFile(
            path.join(projectRoot, 'eslint.config.cjs'),
            [
                `require('fs').writeFileSync(${JSON.stringify(markerPath)}, 'executed');`,
                `module.exports = { parser: 'custom-parser' };`,
            ].join('\n'),
        );

        const configSet = await runConfigParsers(projectRoot);
        const detailed = await runConfigParsersDetailed(projectRoot);
        const report = await findUnusedDependencies(projectRoot, new Set());

        expect(await fs.pathExists(markerPath)).toBe(false);
        expect(configSet).toBeInstanceOf(Set);
        expect(configSet.has('custom-parser')).toBe(true);
        expect(detailed.usedPackages.has('custom-parser')).toBe(true);
        expect(report.configUsed.has('custom-parser')).toBe(true);
        expect(report.unused).not.toContain('custom-parser');
    });

    it('classifies dependencies as unknown when config usage cannot be resolved statically', async () => {
        await writePackage({
            dependencies: {
                'possibly-configured': '1.0.0',
            },
        });
        await fs.writeFile(
            path.join(projectRoot, 'eslint.config.cjs'),
            'module.exports = require(process.env.ESLINT_CONFIG);',
        );

        const report = await findUnusedDependencies(projectRoot, new Set());
        const item = report.findings.find(entry => entry.dependency === 'possibly-configured');

        expect(report.unused).not.toContain('possibly-configured');
        expect(report.uncertain).toContain('possibly-configured');
        expect(report.diagnostics.some(entry => entry.code === 'CONFIG_DYNAMIC_MODULE_REFERENCE')).toBe(true);
        expect(item).toMatchObject({
            section: 'dependencies',
            status: 'unknown',
        });
    });

    it('keeps the legacy return fields while exposing additive diagnostics fields', async () => {
        await writePackage({
            dependencies: {
                unused: '1.0.0',
            },
        });

        const report = await findUnusedDependencies(projectRoot, new Set());

        expect(report.unused).toEqual(['unused']);
        expect(report.missing).toBeInstanceOf(Array);
        expect(report.missingBinaries).toBeInstanceOf(Array);
        expect(report.deadDevDeps).toBeInstanceOf(Array);
        expect(report.declared).toBeInstanceOf(Set);
        expect(report.devDeclared).toBeInstanceOf(Set);
        expect(report.used).toBeInstanceOf(Set);
        expect(report.configUsed).toBeInstanceOf(Set);
        expect(report.usedViaCli).toBeInstanceOf(Set);
        expect(report.uncertain).toBeInstanceOf(Array);
        expect(report.uncertainDevDeps).toBeInstanceOf(Array);
        expect(report.findings).toBeInstanceOf(Array);
        expect(report.diagnostics).toBeInstanceOf(Array);
    });

    it('fails conservatively when workspace manifests are not analyzed per-package', async () => {
        await writePackage({
            private: true,
            workspaces: ['packages/*'],
            dependencies: {
                'root-candidate': '1.0.0',
            },
        });

        const report = await findUnusedDependencies(
            projectRoot,
            new Set(['workspace-only-import']),
        );

        expect(report.workspaceAnalysisComplete).toBe(false);
        expect(report.unused).not.toContain('root-candidate');
        expect(report.uncertain).toContain('root-candidate');
        expect(report.missing).toEqual([]);
        expect(report.diagnostics.some(item => item.code === 'WORKSPACE_MANIFEST_SCOPE_UNSUPPORTED')).toBe(true);
    });

    it('resolves script binary names dynamically from node_modules package.json bin field mapping', async () => {
        await writePackage({
            devDependencies: {
                '@typescript/native-preview': '1.0.0',
            },
            scripts: {
                typecheck: 'tsgo --noEmit',
            },
        });

        const depDir = path.join(projectRoot, 'node_modules', '@typescript', 'native-preview');
        await fs.ensureDir(depDir);
        await fs.writeJson(path.join(depDir, 'package.json'), {
            name: '@typescript/native-preview',
            version: '1.0.0',
            bin: {
                tsgo: './bin/tsgo.js',
            },
        });

        const report = await findUnusedDependencies(projectRoot, new Set());

        expect(report.missingBinaries).not.toContain('tsgo');
        expect(report.used.has('@typescript/native-preview')).toBe(true);
        expect(report.deadDevDeps).not.toContain('@typescript/native-preview');
    });
});
