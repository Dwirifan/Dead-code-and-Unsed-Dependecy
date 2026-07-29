import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import { listCheckpoints, restoreCheckpoint, deleteCheckpoint } from '../../src/eliminator/restoreManager.js';

describe('Eliminator: Restore Manager', () => {
    let tempProjectRoot;
    let backupDir;

    beforeEach(async () => {
        // Setup direktori sementara
        tempProjectRoot = path.join(process.cwd(), 'test', 'temp_restore_test_' + Date.now());
        await fs.ensureDir(tempProjectRoot);
        backupDir = path.join(tempProjectRoot, '.deadkiller_backup');
    });

    afterEach(async () => {
        // Bersihkan setelah testing
        await fs.remove(tempProjectRoot);
    });

    it('harus membuat daftar semua checkpoint terurut dari yang terbaru (descending)', async () => {
        // Timestamp 1000... (lama), 2000... (baru)
        const cp1 = path.join(backupDir, 'backup_1000000000000'); 
        const cp2 = path.join(backupDir, 'backup_2000000000000'); 
        
        await fs.ensureDir(cp1);
        await fs.ensureDir(cp2);

        const checkpoints = await listCheckpoints(tempProjectRoot);
        
        expect(checkpoints.length).toBe(2);
        
        // Yang lebih baru (2000...) harus berada di index 0
        expect(checkpoints[0].name).toBe('backup_2000000000000');
        expect(checkpoints[1].name).toBe('backup_1000000000000');
    });

    it('harus merestorasi file dari checkpoint kembali ke akar proyek', async () => {
        const cp = path.join(backupDir, 'backup_1000');
        const file1Src = path.join(cp, 'src', 'app.js');
        const file2Src = path.join(cp, 'config.json');
        
        // File di dalam brankas (backup)
        await fs.outputFile(file1Src, 'app code');
        await fs.outputFile(file2Src, '{}');

        // File kotor / salah modifikasi di project utama
        const file1Dest = path.join(tempProjectRoot, 'src', 'app.js');
        await fs.outputFile(file1Dest, 'old app code');

        const result = await restoreCheckpoint(cp, tempProjectRoot);

        expect(result.restored).toBe(2);
        expect(result.failed.length).toBe(0);

        // Verifikasi bahwa file utama telah tertimpa/kembali ke posisi awal
        expect(await fs.readFile(file1Dest, 'utf-8')).toBe('app code');
        expect(await fs.pathExists(path.join(tempProjectRoot, 'config.json'))).toBe(true);
    });

    it('harus dapat menghapus checkpoint spesifik', async () => {
        const cp = path.join(backupDir, 'backup_1000');
        await fs.ensureDir(cp);

        expect(await fs.pathExists(cp)).toBe(true);
        
        // Lakukan penghapusan
        await deleteCheckpoint(cp);
        
        expect(await fs.pathExists(cp)).toBe(false);
    });

    it('memakai metadata tanpa menyalinnya ke root dan menghapus lockfile yang sebelumnya tidak ada', async () => {
        const cp = path.join(backupDir, 'backup_2000');
        await fs.outputFile(path.join(cp, 'src', 'app.js'), 'restored app');
        await fs.writeJson(path.join(cp, '.deadkiller-checkpoint.json'), {
            version: 1,
            createdAt: new Date().toISOString(),
            entries: [
                { path: 'src/app.js', existed: true, dependencyState: false },
                { path: 'package-lock.json', existed: false, dependencyState: true },
            ],
        });
        await fs.outputFile(path.join(tempProjectRoot, 'src', 'app.js'), 'modified app');
        await fs.outputFile(path.join(tempProjectRoot, 'package-lock.json'), 'generated lock');

        const listed = await listCheckpoints(tempProjectRoot);
        const result = await restoreCheckpoint(cp, tempProjectRoot);

        expect(listed[0].files).toEqual(['src/app.js']);
        expect(result).toEqual({ restored: 1, failed: [] });
        expect(await fs.readFile(path.join(tempProjectRoot, 'src', 'app.js'), 'utf8')).toBe('restored app');
        expect(await fs.pathExists(path.join(tempProjectRoot, 'package-lock.json'))).toBe(false);
        expect(await fs.pathExists(path.join(tempProjectRoot, '.deadkiller-checkpoint.json'))).toBe(false);
    });
});
