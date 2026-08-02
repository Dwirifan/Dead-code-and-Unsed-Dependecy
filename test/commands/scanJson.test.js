import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

const cliPath = fileURLToPath(new URL('../../bin/dce-cli.js', import.meta.url));
const temporaryProjects = [];

afterEach(async () => {
    await Promise.all(temporaryProjects.splice(0).map(project => fs.remove(project)));
});

describe('scan --json', () => {
    it('menulis tepat satu dokumen JSON ke stdout tanpa banner atau spinner', async () => {
        const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'deadkiller-json-'));
        temporaryProjects.push(projectRoot);
        await fs.writeJson(path.join(projectRoot, 'package.json'), {
            name: 'deadkiller-json-fixture',
            version: '1.0.0',
            main: 'index.js',
            scripts: { start: 'node index.js' },
        });
        await fs.writeFile(
            path.join(projectRoot, 'index.js'),
            `eval('console.log(1)');\n`,
        );

        const result = spawnSync(
            process.execPath,
            [cliPath, 'scan', projectRoot, '--json'],
            { encoding: 'utf8', shell: false, windowsHide: true },
        );

        expect(result.status, result.stderr).toBe(0);
        expect(result.stdout).not.toContain('JSON OUTPUT');
        expect(result.stdout).not.toContain('Menganalisis proyek');
        const report = JSON.parse(result.stdout);
        expect(report.schemaVersion).toBe(1);
        expect(report.mode).toBe('directory');
        expect(report.projectRoot).toBe(projectRoot);
        expect(report.config).toEqual(expect.objectContaining({
            loaded: false,
            path: null,
            source: 'auto',
            profile: expect.objectContaining({
                hasPackageJson: true,
                packageName: 'deadkiller-json-fixture',
                projectType: 'application',
            }),
        }));
        expect(report.unsafeFiles).toEqual(['index.js']);
        expect(report.summary.astFindings).toBe(report.deadCode.length);
        expect(report.summary.totalFindings).toBe(
            report.summary.codeFindings + report.summary.dependencyFindings,
        );
        expect(typeof report.summary.analysisTimeMs).toBe('number');
    }, 20_000);

    it('tetap menganalisis preserveFiles dan menandainya sebagai protected', async () => {
        const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'deadkiller-preserve-'));
        temporaryProjects.push(projectRoot);
        await fs.writeJson(path.join(projectRoot, 'package.json'), {
            name: 'preserve-fixture',
            main: 'index.js',
        });
        await fs.writeJson(path.join(projectRoot, '.deadkillerrc.json'), {
            entryPoints: ['index.js'],
            preserveFiles: ['test/**'],
            preserveExports: false,
        });
        await fs.writeFile(path.join(projectRoot, 'index.js'), "console.log('active');\n");
        await fs.ensureDir(path.join(projectRoot, 'test'));
        await fs.writeFile(
            path.join(projectRoot, 'test', 'example.test.js'),
            'const unusedInProtectedTest = 1;\n',
        );

        const result = spawnSync(
            process.execPath,
            [cliPath, 'scan', projectRoot, '--json', '--advanced'],
            { encoding: 'utf8', shell: false, windowsHide: true },
        );

        expect(result.status, result.stderr).toBe(0);
        const report = JSON.parse(result.stdout);
        expect(report.deadCode).toContainEqual(expect.objectContaining({
            file: 'test/example.test.js',
            name: 'unusedInProtectedTest',
            protected: true,
        }));
        expect(report.summary.protected).toBeGreaterThan(0);
        expect(report.summary.actionableCodeFindings).toBe(0);
    }, 20_000);

    it('mengembalikan exit code 2 sesuai kebijakan --fail-on', async () => {
        const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'deadkiller-fail-on-'));
        temporaryProjects.push(projectRoot);
        const filePath = path.join(projectRoot, 'index.js');
        await fs.writeJson(path.join(projectRoot, 'package.json'), {
            name: 'fail-on-fixture',
            main: 'index.js',
        });
        await fs.writeFile(filePath, 'const unused = 1;\n');

        const result = spawnSync(
            process.execPath,
            [cliPath, 'scan', filePath, '--json', '--fail-on', 'safe'],
            { encoding: 'utf8', shell: false, windowsHide: true },
        );

        expect(result.status, result.stderr).toBe(2);
        const report = JSON.parse(result.stdout);
        expect(report.ci).toEqual({
            failOn: ['safe'],
            failed: true,
            matched: ['safe'],
            exitCode: 2,
        });
        expect(report.summary.actionableCodeFindings).toBeGreaterThan(0);
    }, 20_000);
});
