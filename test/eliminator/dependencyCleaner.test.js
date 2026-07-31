import { describe, it, expect, vi, beforeEach } from 'vitest';
import { removeUnusedDependencies } from '../../src/eliminator/dependencyCleaner.js';
import fs from 'fs-extra';
import child_process from 'child_process';
import path from 'path';

// Mock dependencies
vi.mock('fs-extra');
vi.mock('child_process');

describe('Dependency Cleaner - removeUnusedDependencies', () => {
    const projectRoot = '/fake/project';
    const packageJsonPath = path.join(projectRoot, 'package.json');
    const spawnOptions = {
        cwd: projectRoot,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
        shell: false,
        timeout: 120_000,
        windowsHide: true
    };

    function expectedInvocation(manager, managerArgs) {
        if (process.platform !== 'win32') {
            return { executable: manager, args: managerArgs };
        }

        return {
            executable: process.env.ComSpec || process.env.COMSPEC || 'cmd.exe',
            args: ['/d', '/s', '/c', `${manager}.cmd`, ...managerArgs]
        };
    }

    function expectSpawn(manager, managerArgs) {
        const invocation = expectedInvocation(manager, managerArgs);
        expect(child_process.spawnSync).toHaveBeenCalledWith(
            invocation.executable,
            invocation.args,
            spawnOptions
        );
    }

    beforeEach(() => {
        vi.clearAllMocks();
        fs.readJson.mockResolvedValue({});
    });

    it('TC-E6: Harus menggunakan "npm uninstall" jika tidak ada file lock', async () => {
        const unusedDeps = ['lodash', 'moment'];

        // Mock fs: package.json exists, but NO lockfiles
        fs.pathExists.mockImplementation(async (p) => p === packageJsonPath);

        child_process.spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });

        const result = await removeUnusedDependencies(projectRoot, unusedDeps);

        expect(fs.pathExists).toHaveBeenCalledWith(packageJsonPath);
        expectSpawn('npm', ['uninstall', 'lodash', 'moment']);
        expect(result).toEqual({ removed: ['lodash', 'moment'] });
    });

    it('TC-E7: Harus menggunakan "yarn remove" jika menemukan yarn.lock', async () => {
        const unusedDeps = ['axios'];

        // Mock fs: package.json exists, yarn.lock exists
        fs.pathExists.mockImplementation(async (p) => {
            if (p === packageJsonPath) return true;
            if (p === path.join(projectRoot, 'yarn.lock')) return true;
            return false;
        });

        child_process.spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });

        const result = await removeUnusedDependencies(projectRoot, unusedDeps);

        expectSpawn('yarn', ['remove', 'axios']);
        expect(result).toEqual({ removed: ['axios'] });
    });

    it('TC-E8: Harus menggunakan "pnpm remove" jika menemukan pnpm-lock.yaml', async () => {
        const unusedDeps = ['react'];

        // Mock fs: package.json exists, pnpm-lock.yaml exists
        fs.pathExists.mockImplementation(async (p) => {
            if (p === packageJsonPath) return true;
            if (p === path.join(projectRoot, 'pnpm-lock.yaml')) return true;
            return false;
        });

        child_process.spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });

        const result = await removeUnusedDependencies(projectRoot, unusedDeps);

        expectSpawn('pnpm', ['remove', 'react']);
        expect(result).toEqual({ removed: ['react'] });
    });

    it.each(['bun.lock', 'bun.lockb'])(
        'TC-E9: Harus menggunakan "bun remove" jika menemukan %s',
        async (lockfile) => {
            const unusedDeps = ['express'];

            fs.pathExists.mockImplementation(async (p) => (
                p === packageJsonPath || p === path.join(projectRoot, lockfile)
            ));
            child_process.spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });

            const result = await removeUnusedDependencies(projectRoot, unusedDeps);

            expectSpawn('bun', ['remove', 'express']);
            expect(result).toEqual({ removed: ['express'] });
        }
    );

    it.each([
        ['npm', 'uninstall'],
        ['yarn', 'remove'],
        ['pnpm', 'remove'],
        ['bun', 'remove']
    ])(
        'Harus memprioritaskan packageManager "%s" dari package.json',
        async (manager, command) => {
            fs.readJson.mockResolvedValue({ packageManager: `${manager}@1.2.3` });
            fs.pathExists.mockImplementation(async (p) => (
                p === packageJsonPath || p === path.join(projectRoot, 'yarn.lock')
            ));
            child_process.spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });

            const result = await removeUnusedDependencies(projectRoot, ['axios']);

            expectSpawn(manager, [command, 'axios']);
            expect(result).toEqual({ removed: ['axios'] });
        }
    );

    it('Harus menolak lockfile dari beberapa package manager tanpa packageManager eksplisit', async () => {
        fs.pathExists.mockImplementation(async (p) => (
            p === packageJsonPath ||
            p === path.join(projectRoot, 'yarn.lock') ||
            p === path.join(projectRoot, 'package-lock.json')
        ));

        await expect(removeUnusedDependencies(projectRoot, ['axios']))
            .rejects
            .toThrow(/Beberapa package manager terdeteksi/);

        expect(child_process.spawnSync).not.toHaveBeenCalled();
    });

    it('Harus menghapus nama package duplikat hanya satu kali', async () => {
        const unusedDeps = ['lodash', '@scope/pkg', 'lodash', '@scope/pkg'];

        fs.pathExists.mockImplementation(async (p) => p === packageJsonPath);
        child_process.spawnSync.mockReturnValue({ status: 0, stdout: '', stderr: '' });

        const result = await removeUnusedDependencies(projectRoot, unusedDeps);

        expectSpawn('npm', ['uninstall', 'lodash', '@scope/pkg']);
        expect(result).toEqual({ removed: ['lodash', '@scope/pkg'] });
    });

    it.each([
        '--force',
        '../secret',
        'scope/pkg',
        '@scope/../pkg',
        'PackageName',
        '',
        null
    ])('Harus menolak nama package tidak valid %j sebelum mengeksekusi perintah', async (invalidDep) => {
        const unusedDeps = ['express'];

        fs.pathExists.mockImplementation(async (p) => p === packageJsonPath);

        await expect(
            removeUnusedDependencies(projectRoot, [...unusedDeps, invalidDep])
        ).rejects.toThrow('Nama dependensi tidak valid');

        expect(fs.readJson).not.toHaveBeenCalled();
        expect(child_process.spawnSync).not.toHaveBeenCalled();
    });

    it('TC-E10: Harus melempar error jika package.json tidak ditemukan', async () => {
        const unusedDeps = ['lodash'];

        // Mock fs: package.json does not exist
        fs.pathExists.mockResolvedValue(false);

        await expect(removeUnusedDependencies(projectRoot, unusedDeps)).rejects.toThrow('package.json not found');

        expect(child_process.spawnSync).not.toHaveBeenCalled();
    });

    it('Harus mengembalikan 0 dan tidak melakukan apa-apa jika array unusedDeps kosong', async () => {
        const unusedDeps = [];

        const result = await removeUnusedDependencies(projectRoot, unusedDeps);

        expect(result).toBe(0);
        expect(fs.pathExists).not.toHaveBeenCalled();
        expect(child_process.spawnSync).not.toHaveBeenCalled();
    });

    it('Harus melempar pesan error aman jika eksekusi gagal', async () => {
        const unusedDeps = ['bad-package'];

        fs.pathExists.mockImplementation(async (p) => p === packageJsonPath);

        // Mock child_process.spawnSync to return an error
        child_process.spawnSync.mockReturnValue({
            error: new Error('Command failed'),
            stdout: '',
            stderr: ''
        });

        await expect(removeUnusedDependencies(projectRoot, unusedDeps)).rejects.toThrow(
            "Gagal menghapus dependensi. Perintah 'npm uninstall bad-package' gagal: Command failed"
        );
    });

    it('Harus menyertakan stderr saat package manager keluar dengan status gagal', async () => {
        fs.pathExists.mockImplementation(async (p) => p === packageJsonPath);
        child_process.spawnSync.mockReturnValue({
            status: 1,
            stdout: '',
            stderr: 'registry denied'
        });

        await expect(removeUnusedDependencies(projectRoot, ['lodash'])).rejects.toThrow(
            "Gagal menghapus dependensi. Perintah 'npm uninstall lodash' gagal: " +
            'Exited with code 1: registry denied'
        );
    });

    it('Harus menerapkan timeout dan meneruskan diagnostik timeout', async () => {
        fs.pathExists.mockImplementation(async (p) => p === packageJsonPath);
        child_process.spawnSync.mockReturnValue({
            error: Object.assign(new Error('Command timed out'), { code: 'ETIMEDOUT' }),
            stdout: '',
            stderr: 'operation exceeded time limit'
        });

        await expect(removeUnusedDependencies(projectRoot, ['lodash'])).rejects.toThrow(
            "Gagal menghapus dependensi. Perintah 'npm uninstall lodash' gagal: " +
            'Command timed out: operation exceeded time limit'
        );
        expectSpawn('npm', ['uninstall', 'lodash']);
    });
});
