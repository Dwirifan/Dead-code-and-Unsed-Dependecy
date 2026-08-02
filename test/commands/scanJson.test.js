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
    it('mengabaikan konfigurasi target ketika --no-config digunakan', async () => {
        const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'deadkiller-no-config-'));
        temporaryProjects.push(projectRoot);
        await fs.writeJson(path.join(projectRoot, 'package.json'), {
            name: 'no-config-fixture',
            version: '1.0.0',
            main: 'index.js',
        });
        const configPath = path.join(projectRoot, '.deadkillerrc.json');
        const config = {
            entryPoints: ['index.js'],
            ignoreFiles: ['index.js'],
        };
        await fs.writeJson(configPath, config);
        await fs.writeFile(path.join(projectRoot, 'index.js'), 'const unused = 1;\n');

        const result = spawnSync(
            process.execPath,
            [cliPath, 'scan', projectRoot, '--json', '--no-config'],
            { encoding: 'utf8', shell: false, windowsHide: true },
        );

        expect(result.status, result.stderr).toBe(0);
        const report = JSON.parse(result.stdout);
        expect(report.config).toEqual(expect.objectContaining({
            loaded: false,
            path: null,
            source: 'auto',
            policy: 'none',
            ignoredPaths: [configPath],
        }));
        expect(report.deadCode).toContainEqual(expect.objectContaining({
            file: 'index.js',
            name: 'unused',
        }));
        expect(await fs.readJson(configPath)).toEqual(config);
    }, 20_000);

    it('tidak memakai import dari config target sebagai bukti dependency zero-config', async () => {
        const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'deadkiller-no-config-dep-'));
        temporaryProjects.push(projectRoot);
        await fs.writeJson(path.join(projectRoot, 'package.json'), {
            name: 'no-config-dependency-fixture',
            version: '1.0.0',
            main: 'index.js',
            dependencies: { 'config-only-package': '1.0.0' },
        });
        const configPath = path.join(projectRoot, 'deadkiller.config.mjs');
        await fs.writeFile(
            configPath,
            "import 'config-only-package';\nexport default { preserveExports: true };\n",
        );
        await fs.writeFile(path.join(projectRoot, 'index.js'), "console.log('runtime');\n");

        const result = spawnSync(
            process.execPath,
            [cliPath, 'scan', projectRoot, '--json', '--no-config'],
            { encoding: 'utf8', shell: false, windowsHide: true },
        );

        expect(result.status, result.stderr).toBe(0);
        const report = JSON.parse(result.stdout);
        expect(report.config.ignoredPaths).toEqual([configPath]);
        expect(report.summary.liveFiles).toBe(1);
        expect(report.unusedDependencies).toContain('config-only-package');
    }, 20_000);

    it('mendeteksi helper Next App yang tidak terhubung tanpa menandai file convention', async () => {
        const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'deadkiller-next-conventions-'));
        temporaryProjects.push(projectRoot);
        await fs.writeJson(path.join(projectRoot, 'package.json'), {
            name: 'next-convention-fixture',
            version: '1.0.0',
            private: true,
            dependencies: { next: '^16.0.0', react: '^19.0.0' },
        });
        await fs.outputFile(
            path.join(projectRoot, 'app', 'page.tsx'),
            'export default function Page() { return null; }\n',
        );
        await fs.outputFile(
            path.join(projectRoot, 'app', 'lib', 'dead.ts'),
            'export const dead = 1;\n',
        );
        await fs.writeFile(
            path.join(projectRoot, 'instrumentation.ts'),
            'export function register() {}\n',
        );

        const result = spawnSync(
            process.execPath,
            [cliPath, 'scan', projectRoot, '--json', '--no-config'],
            { encoding: 'utf8', shell: false, windowsHide: true },
        );

        expect(result.status, result.stderr).toBe(0);
        const report = JSON.parse(result.stdout);
        expect(report.deadFiles).toContain('app/lib/dead.ts');
        expect(report.deadFiles).not.toContain('app/page.tsx');
        expect(report.deadFiles).not.toContain('instrumentation.ts');
        expect(report.deadCode).not.toContainEqual(expect.objectContaining({ name: 'Page' }));
        expect(report.deadCode).not.toContainEqual(expect.objectContaining({ name: 'register' }));
    }, 20_000);

    it('mengabaikan marker konfigurasi terdekat pada scan file tunggal dengan --no-config', async () => {
        const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'deadkiller-single-no-config-'));
        temporaryProjects.push(projectRoot);
        await fs.writeJson(path.join(projectRoot, 'package.json'), {
            name: 'single-no-config-fixture',
            version: '1.0.0',
        });
        const sourceDirectory = path.join(projectRoot, 'src');
        await fs.ensureDir(sourceDirectory);
        const nestedConfigPath = path.join(sourceDirectory, '.deadkillerrc.json');
        const nestedConfig = { ignoreFiles: ['index.js'] };
        await fs.writeJson(nestedConfigPath, nestedConfig);
        const sourcePath = path.join(sourceDirectory, 'index.js');
        await fs.writeFile(sourcePath, 'const unusedSingle = 1;\n');

        const result = spawnSync(
            process.execPath,
            [cliPath, 'scan', sourcePath, '--json', '--no-config'],
            { encoding: 'utf8', shell: false, windowsHide: true },
        );

        expect(result.status, result.stderr).toBe(0);
        const report = JSON.parse(result.stdout);
        expect(report.mode).toBe('single-file');
        expect(report.ignored).toBe(false);
        expect(report.config).toEqual(expect.objectContaining({
            loaded: false,
            path: null,
            source: 'auto',
            profile: expect.objectContaining({
                packageName: 'single-no-config-fixture',
            }),
        }));
        expect(report.deadCode).toContainEqual(expect.objectContaining({
            name: 'unusedSingle',
        }));
        expect(await fs.readJson(nestedConfigPath)).toEqual(nestedConfig);
    }, 20_000);

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
