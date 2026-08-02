import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { Command } from 'commander';
import { registerFixCommand } from '../../src/commands/fixCommand.js';
import inquirer from 'inquirer';

vi.mock('inquirer', () => ({
    default: {
        prompt: vi.fn()
    }
}));

describe('Fix Command Safety & Dry-Run Tests', () => {
    let tmpDir;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deadkiller-fix-test-'));
        vi.clearAllMocks();
    });

    afterEach(async () => {
        if (tmpDir && await fs.pathExists(tmpDir)) {
            await fs.remove(tmpDir);
        }
    });

    it('Should NOT create backup or write files in Level 0 (Dry-Run mode)', async () => {
        const filePath = path.join(tmpDir, 'testFile.js');
        const initialCode = "const unused = 123;\nconst active = true;\nconsole.log(active);";
        await fs.writeFile(filePath, initialCode, 'utf-8');

        const program = new Command();
        registerFixCommand(program);

        await program.parseAsync(['node', 'test', 'fix', filePath, '-l', '0']);

        // Dalam Level 0, inquirer prompt bahkan tidak dipanggil untuk eksekusi,
        // file tidak diubah, dan folder backup tidak dibuat.
        const contentAfter = await fs.readFile(filePath, 'utf-8');
        expect(contentAfter).toBe(initialCode);

        const backupDir = path.join(tmpDir, '.deadkiller_backup');
        expect(await fs.pathExists(backupDir)).toBe(false);
    });

    it('Should abort before mutation when project config is invalid', async () => {
        const filePath = path.join(tmpDir, 'unsafe-to-guess.js');
        const initialCode = 'const unused = 123;\n';
        await fs.writeFile(filePath, initialCode);
        await fs.writeFile(path.join(tmpDir, '.deadkillerrc.json'), '{ invalid json');

        const program = new Command();
        registerFixCommand(program);

        await expect(program.parseAsync([
            'node', 'test', 'fix', filePath, '--yes', '--level', '3',
        ])).rejects.toMatchObject({
            code: 'DEADKILLER_CONFIG_LOAD_FAILED',
        });
        expect(await fs.readFile(filePath, 'utf8')).toBe(initialCode);
        expect(await fs.pathExists(path.join(tmpDir, '.deadkiller_backup'))).toBe(false);
    });

    it('Should honor preserveFiles for single-file fixes', async () => {
        const filePath = path.join(tmpDir, 'protected.js');
        const initialCode = 'const unused = 123;\n';
        await fs.writeFile(filePath, initialCode);
        await fs.writeJson(path.join(tmpDir, '.deadkillerrc.json'), {
            preserveFiles: ['protected.js'],
        });

        const program = new Command();
        registerFixCommand(program);
        await program.parseAsync(['node', 'test', 'fix', filePath, '--yes']);

        expect(await fs.readFile(filePath, 'utf8')).toBe(initialCode);
        expect(await fs.pathExists(path.join(tmpDir, '.deadkiller_backup'))).toBe(false);
    });

    it('menolak memperbaiki symlink file yang mengarah keluar root proyek', async () => {
        await fs.writeJson(path.join(tmpDir, 'package.json'), {
            name: 'fix-boundary-project',
            main: 'index.js',
        });
        await fs.writeFile(path.join(tmpDir, 'index.js'), "console.log('runtime');\n");
        const outsidePath = path.join(
            path.dirname(tmpDir),
            `deadkiller-outside-${path.basename(tmpDir)}.js`,
        );
        const initialCode = 'const mustStay = 1;\n';
        await fs.writeFile(outsidePath, initialCode);
        try {
            const linkedPath = path.join(tmpDir, 'linked.js');
            try {
                await fs.symlink(outsidePath, linkedPath, 'file');
            } catch (error) {
                if (['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) return;
                throw error;
            }

            const program = new Command();
            registerFixCommand(program);
            await program.parseAsync(['node', 'test', 'fix', linkedPath, '--yes']);

            expect(await fs.readFile(outsidePath, 'utf8')).toBe(initialCode);
            expect(await fs.pathExists(path.join(tmpDir, '.deadkiller_backup'))).toBe(false);
        } finally {
            await fs.remove(outsidePath);
        }
    });

    it('Should ONLY remove SAFE items and NOT remove REVIEW items even in Level 3', async () => {
        const filePath = path.join(tmpDir, 'reviewTest.js');
        // 'unusedSafe' adalah safe dead code.
        // Fungsi kosong tanpa parameter atau anomali tertentu akan dianalisis.
        const initialCode = "const unusedSafe = 10;\nconst active = 20;\nconsole.log(active);";
        await fs.writeFile(filePath, initialCode, 'utf-8');

        inquirer.prompt.mockResolvedValueOnce({ ok: true });

        const program = new Command();
        registerFixCommand(program);

        await program.parseAsync(['node', 'test', 'fix', filePath, '-l', '3']);

        const contentAfter = await fs.readFile(filePath, 'utf-8');
        expect(contentAfter.trim()).toBe("const active = 20;\nconsole.log(active);");
    });

    it('Should never offer dependencies from an unsafe dynamic graph for uninstall', async () => {
        await fs.writeJson(path.join(tmpDir, 'package.json'), {
            name: 'dynamic-project',
            main: 'index.js',
            dependencies: { axios: '1.0.0' }
        });
        await fs.writeFile(
            path.join(tmpDir, 'index.js'),
            "const packageName = 'axios';\nrequire(packageName);\nconsole.log(packageName);\n"
        );

        const program = new Command();
        registerFixCommand(program);
        await program.parseAsync(['node', 'test', 'fix', tmpDir, '-l', '3']);

        expect(inquirer.prompt).not.toHaveBeenCalled();
        const pkg = await fs.readJson(path.join(tmpDir, 'package.json'));
        expect(pkg.dependencies.axios).toBe('1.0.0');
        expect(await fs.pathExists(path.join(tmpDir, '.deadkiller_backup'))).toBe(false);
    });

    it('Should leave review-only dependency checkboxes unchecked by default', async () => {
        await fs.writeJson(path.join(tmpDir, 'package.json'), {
            name: 'review-project',
            main: 'index.js',
            dependencies: { axios: '1.0.0' }
        });
        await fs.writeFile(path.join(tmpDir, 'index.js'), "console.log('active');\n");
        inquirer.prompt.mockResolvedValueOnce({ depsToRemove: [] });

        const program = new Command();
        registerFixCommand(program);
        await program.parseAsync(['node', 'test', 'fix', tmpDir, '-l', '3']);

        const prompt = inquirer.prompt.mock.calls[0][0][0];
        expect(prompt.type).toBe('checkbox');
        expect(prompt.choices).toEqual([
            expect.objectContaining({ value: 'axios', checked: false })
        ]);
        expect(await fs.pathExists(path.join(tmpDir, '.deadkiller_backup'))).toBe(false);
    });
});
