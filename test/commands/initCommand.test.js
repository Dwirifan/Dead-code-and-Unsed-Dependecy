import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

vi.mock('inquirer', () => ({
    default: {
        prompt: vi.fn(),
    },
}));

import inquirer from 'inquirer';
import { initCommand } from '../../src/commands/initCommand.js';
import { inspectProject } from '../../src/commands/initProjectProfiler.js';
import { RuleEngine } from '../../src/analyzer/ruleEngine.js';

describe('init command project-aware UX', () => {
    let tempDir;

    afterEach(async () => {
        vi.restoreAllMocks();
        inquirer.prompt.mockReset();
        if (tempDir) await fs.remove(tempDir);
        tempDir = undefined;
    });

    async function createProject(packageJson, files = {}) {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deadkiller-init-'));
        await fs.writeJson(path.join(tempDir, 'package.json'), packageJson);
        for (const [relativePath, content] of Object.entries(files)) {
            await fs.outputFile(path.join(tempDir, relativePath), content);
        }
        return tempDir;
    }

    it('membuat konfigurasi CJS tanpa prompt melalui --yes', async () => {
        await createProject({
            name: 'cjs-service',
            type: 'commonjs',
            main: 'server.cjs',
        }, {
            'server.cjs': `module.exports = {};\n`,
        });

        const result = await initCommand(tempDir, { yes: true });
        const ruleEngine = new RuleEngine();
        await ruleEngine.loadConfig(tempDir);

        expect(inquirer.prompt).not.toHaveBeenCalled();
        expect(result.profile.moduleSystem).toBe('commonjs');
        expect(result.profile.language).toBe('javascript');
        expect(result.config.entryPoints).toEqual([]);
        expect(result.detectedEntries).toEqual([
            expect.objectContaining({ kind: 'runtime', relativePath: 'server.cjs' }),
        ]);
        expect(ruleEngine.rules.mode).toBe('vanilla');
        expect(await fs.pathExists(path.join(tempDir, 'deadkiller.config.mjs'))).toBe(true);
    });

    it('cukup satu konfirmasi untuk setup rekomendasi TypeScript/ESM/Next.js', async () => {
        await createProject({
            name: 'next-app',
            type: 'module',
            private: true,
            scripts: { dev: 'next dev' },
            dependencies: { next: '^15.0.0', react: '^19.0.0' },
            devDependencies: { typescript: '^5.0.0' },
        }, {
            'tsconfig.json': '{}',
            'app/page.tsx': `export default function Page() { return null; }\n`,
        });
        inquirer.prompt.mockResolvedValueOnce({ useRecommended: true });

        const result = await initCommand(tempDir, {});

        expect(inquirer.prompt).toHaveBeenCalledTimes(1);
        expect(result.profile).toMatchObject({
            language: 'typescript',
            moduleSystem: 'esm',
            mode: 'next',
            framework: 'next',
        });
        expect(result.config.reactRuntime).toBe('automatic');
        expect(result.config.entryPoints).toEqual([]);
        expect(result.detectedEntries).toEqual(expect.arrayContaining([
            expect.objectContaining({ kind: 'runtime', relativePath: 'app/page.tsx' }),
        ]));
        expect(await fs.pathExists(path.join(tempDir, 'deadkiller.config.mjs'))).toBe(true);
    });

    it('mode kustom menyediakan checklist runtime dan test yang terdeteksi', async () => {
        await createProject({
            name: 'mocha-library',
            main: 'server.js',
            scripts: { test: 'mocha' },
            devDependencies: { mocha: '*', 'chai-http': '*' },
        }, {
            'server.js': `module.exports = {};\n`,
            'test/products.js': `require('chai-http');\n`,
        });

        inquirer.prompt
            .mockResolvedValueOnce({ useRecommended: false })
            .mockResolvedValueOnce({
                mode: 'vanilla',
                projectType: 'library',
                additionalEntries: '',
                format: 'json',
            })
            .mockImplementationOnce(async questions => {
                expect(questions[0].type).toBe('checkbox');
                expect(questions[0].choices).toEqual(expect.arrayContaining([
                    expect.objectContaining({ name: '[runtime] server.js', checked: true }),
                    expect.objectContaining({ name: '[test] test/products.js', checked: true }),
                ]));
                return { entryPoints: questions[0].choices.map(choice => choice.value) };
            });

        const result = await initCommand(tempDir, {});

        expect(inquirer.prompt).toHaveBeenCalledTimes(3);
        expect(result.config.preserveExports).toBe(true);
        expect(result.config.entryPoints).toEqual(['server.js', 'test/products.js']);
        expect(result.config.overrides[0]).not.toHaveProperty('ignorePrefixedVariables');
    });

    it('--force membackup konfigurasi lama dan mencegah config precedence ganda', async () => {
        await createProject({ name: 'force-project', main: 'index.js' }, {
            'index.js': `console.log('ok');\n`,
            'deadkiller.config.mjs': `export default { mode: 'react' };\n`,
        });

        const result = await initCommand(tempDir, { yes: true, force: true, format: 'json' });

        expect(result.profile.moduleSystem).toBe('commonjs');
        expect(result.backupDirectory).toBeTruthy();
        expect(await fs.pathExists(path.join(result.backupDirectory, 'deadkiller.config.mjs'))).toBe(true);
        expect(await fs.pathExists(path.join(tempDir, 'deadkiller.config.mjs'))).toBe(false);
        expect(await fs.pathExists(path.join(tempDir, '.deadkillerrc.json'))).toBe(true);
    });

    it('--dry-run mengembalikan preview tanpa menulis konfigurasi', async () => {
        await createProject({ name: 'preview-project', main: 'index.js' }, {
            'index.js': `console.log('preview');\n`,
        });

        const result = await initCommand(tempDir, { yes: true, dryRun: true });

        expect(result.dryRun).toBe(true);
        expect(await fs.pathExists(path.join(tempDir, 'deadkiller.config.mjs'))).toBe(false);
        expect(await fs.pathExists(path.join(tempDir, '.deadkillerrc.json'))).toBe(false);
    });

    it('mendeteksi pnpm monorepo dan source campuran', async () => {
        await createProject({ name: 'workspace-root', private: true }, {
            'pnpm-workspace.yaml': `packages:\n  - 'packages/*'\n`,
            'pnpm-lock.yaml': 'lockfileVersion: 9\n',
            'packages/api/index.cjs': `module.exports = {};\n`,
            'packages/web/index.mts': `export {};\n`,
        });

        const profile = await inspectProject(tempDir);

        expect(profile.monorepo).toBe(true);
        expect(profile.projectType).toBe('monorepo');
        expect(profile.packageManager).toBe('pnpm');
        expect(profile.language).toBe('mixed');
        expect(profile.moduleSystem).toBe('mixed');
    });

    it('mendeteksi ESM TypeScript dari compilerOptions.module ESNext', async () => {
        await createProject({
            name: 'ts-node-next',
            devDependencies: { typescript: '^5.0.0' },
        }, {
            'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'ESNext' } }),
            'src/index.ts': `export const value = 1;\n`,
        });

        const profile = await inspectProject(tempDir);

        expect(profile.language).toBe('typescript');
        expect(profile.moduleSystem).toBe('esm');
    });

    it('tidak menganggap NodeNext sebagai ESM tanpa package type atau ekstensi .mts', async () => {
        await createProject({
            name: 'ts-node-next-default-cjs',
            devDependencies: { typescript: '^5.0.0' },
        }, {
            'tsconfig.json': JSON.stringify({ compilerOptions: { module: 'NodeNext' } }),
            'src/index.ts': `export const value = 1;\n`,
        });

        const profile = await inspectProject(tempDir);

        expect(profile.moduleSystem).toBe('commonjs');
    });
});
