import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import { createBackup, rollbackBackup } from '../../src/eliminator/backupManager.js';


describe('Eliminator: Backup Manager', () => {
    let tempProjectRoot;

    beforeEach(async () => {
        // Setup direktori sementara untuk testing
        tempProjectRoot = path.join(process.cwd(), 'test', 'temp_backup_test_' + Date.now());
        await fs.ensureDir(tempProjectRoot);
    });

    afterEach(async () => {
        // Bersihkan direktori sementara setelah test
        await fs.remove(tempProjectRoot);
    });

    it('harus membuat folder backup dan menyalin file yang ditentukan', async () => {
        const file1 = path.join(tempProjectRoot, 'file1.js');
        const file2 = path.join(tempProjectRoot, 'src', 'file2.js');
        
        await fs.outputFile(file1, 'console.log("file1");');
        await fs.outputFile(file2, 'console.log("file2");');

        const backupDir = await createBackup(tempProjectRoot, [file1, file2], false, 20);

        // Pastikan folder backup terbuat
        expect(await fs.pathExists(backupDir)).toBe(true);

        // Pastikan file-file tersalin
        expect(await fs.pathExists(path.join(backupDir, 'file1.js'))).toBe(true);
        expect(await fs.pathExists(path.join(backupDir, 'src', 'file2.js'))).toBe(true);
        
        // Verifikasi konten file tidak berubah
        const content1 = await fs.readFile(path.join(backupDir, 'file1.js'), 'utf-8');
        expect(content1).toBe('console.log("file1");');
    });

    it('harus mencadangkan package.json jika flag backupPackageJson bernilai true', async () => {
        const pkgJson = path.join(tempProjectRoot, 'package.json');
        const lockFile = path.join(tempProjectRoot, 'package-lock.json');
        await fs.outputFile(pkgJson, '{"name": "test"}');
        await fs.outputFile(lockFile, '{"lockfileVersion": 3}');

        const backupDir = await createBackup(tempProjectRoot, [], true, 20);

        // Manifest dan lockfile adalah satu state transaksi dependency.
        expect(await fs.pathExists(path.join(backupDir, 'package.json'))).toBe(true);
        expect(await fs.pathExists(path.join(backupDir, 'package-lock.json'))).toBe(true);
    });

    it('harus membatasi jumlah maksimum backup (Rolling Cleanup)', async () => {
        const baseBackupDir = path.join(tempProjectRoot, '.deadkiller_backup');
        
        // Buat 3 backup lama secara manual dengan timestamp 13-digit agar sorting alfabetis berjalan benar
        await fs.ensureDir(path.join(baseBackupDir, 'backup_1600000000000'));
        await fs.ensureDir(path.join(baseBackupDir, 'backup_1600000000001'));
        await fs.ensureDir(path.join(baseBackupDir, 'backup_1600000000002'));

        const file1 = path.join(tempProjectRoot, 'file1.js');
        await fs.outputFile(file1, 'data');

        // Set maxBackups = 2
        await createBackup(tempProjectRoot, [file1], false, 2);

        const items = await fs.readdir(baseBackupDir);
        const backupFolders = items.filter(i => i.startsWith('backup_'));
        
        // Seharusnya hanya tersisa 2 backup (backup_1600000000002 dan backup yang baru dibuat saat createBackup)
        expect(backupFolders.length).toBe(2);
        
        // Backup 1600000000000 dan 1600000000001 harus sudah terhapus
        expect(backupFolders.includes('backup_1600000000000')).toBe(false);
        expect(backupFolders.includes('backup_1600000000001')).toBe(false);
        expect(backupFolders.includes('backup_1600000000002')).toBe(true);
    });

    it('harus menolak backup untuk file di luar project root (pencegahan path traversal)', async () => {
        const outsideFile = path.resolve(tempProjectRoot, '..', 'outside.js');
        await expect(createBackup(tempProjectRoot, [outsideFile])).rejects.toThrow(/berada di luar project root/);
    });

    it('harus dapat melakukan rollback (pemulihan) dari direktori backup dengan benar', async () => {
        const file1 = path.join(tempProjectRoot, 'file1.js');
        await fs.outputFile(file1, 'original content');

        const backupDir = await createBackup(tempProjectRoot, [file1], false, 20);
        
        // Ubah atau hapus file asli (simulasi mutasi yang rusak)
        await fs.outputFile(file1, 'corrupted content');
        expect(await fs.readFile(file1, 'utf-8')).toBe('corrupted content');

        // Lakukan rollback
        await rollbackBackup(tempProjectRoot, backupDir);
        expect(await fs.readFile(file1, 'utf-8')).toBe('original content');
    });

    it('harus memulihkan manifest/lockfile dan menghapus lockfile baru saat rollback', async () => {
        const packageJson = path.join(tempProjectRoot, 'package.json');
        const packageLock = path.join(tempProjectRoot, 'package-lock.json');
        const yarnLock = path.join(tempProjectRoot, 'yarn.lock');
        await fs.outputFile(packageJson, '{"dependencies":{"alpha":"1.0.0"}}');
        await fs.outputFile(packageLock, '{"lockfileVersion":3,"packages":{}}');

        const backupDir = await createBackup(tempProjectRoot, [], true, 20);

        await fs.outputFile(packageJson, '{"dependencies":{}}');
        await fs.outputFile(packageLock, '{"lockfileVersion":3,"changed":true}');
        await fs.outputFile(yarnLock, '# generated after checkpoint');

        await rollbackBackup(tempProjectRoot, backupDir);

        expect(await fs.readFile(packageJson, 'utf-8')).toContain('"alpha"');
        expect(await fs.readFile(packageLock, 'utf-8')).not.toContain('"changed"');
        expect(await fs.pathExists(yarnLock)).toBe(false);
        expect(await fs.pathExists(path.join(tempProjectRoot, '.deadkiller-checkpoint.json'))).toBe(false);
    });

    it('harus menolak rollback dari direktori di luar brankas proyek', async () => {
        const outsideBackup = path.join(
            path.dirname(tempProjectRoot),
            '.deadkiller_backup-malicious',
            'backup_1'
        );
        await fs.ensureDir(outsideBackup);

        await expect(rollbackBackup(tempProjectRoot, outsideBackup))
            .rejects
            .toThrow(/Direktori backup.*tidak valid/);

        await fs.remove(path.dirname(outsideBackup));
    });

    it('harus menolak metadata rollback yang mencoba menargetkan root proyek', async () => {
        const file1 = path.join(tempProjectRoot, 'file1.js');
        await fs.outputFile(file1, 'original');
        const backupDir = await createBackup(tempProjectRoot, [file1], false, 20);
        await fs.writeJson(path.join(backupDir, '.deadkiller-checkpoint.json'), {
            version: 1,
            entries: [{ path: '.', existed: true, dependencyState: false }]
        });

        await expect(rollbackBackup(tempProjectRoot, backupDir))
            .rejects
            .toThrow(/Entri checkpoint tidak valid/);
    });
});
