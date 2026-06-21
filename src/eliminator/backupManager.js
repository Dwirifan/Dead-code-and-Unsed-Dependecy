import fs from 'fs-extra';
import path from 'path';

/**
 * Menciptakan titik pemulihan (Checkpoint Backup) untuk file sebelum dimodifikasi atau dihapus.
 * 
 * @param {string} projectRoot - Path absolut dari akar proyek.
 * @param {Array<string>} filesToBackup - Daftar path absolut dari file yang akan di-backup.
 * @param {boolean} backupPackageJson - Opsi apakah file package.json perlu diikutsertakan.
 * @returns {Promise<string>} Mengembalikan path (lokasi) direktori backup yang tercipta.
 */
export async function createBackup(projectRoot, filesToBackup, backupPackageJson = false, maxBackups = 20) {
    const timestamp = Date.now();
    const backupDir = path.join(projectRoot, '.deadkiller_backup', `backup_${timestamp}`);

    // Pastikan folder brankas utama terbentuk
    await fs.ensureDir(backupDir);

    // Lakukan pencadangan (Backup) file individual yang masih valid
    for (const file of filesToBackup) {
        if (await fs.pathExists(file)) {
            const relativePath = path.relative(projectRoot, file);
            const backupDest = path.join(backupDir, relativePath);

            // Pertahankan struktur hierarki sub-direktori orisinal di dalam brankas
            await fs.ensureDir(path.dirname(backupDest));

            // Salin file dengan aman
            await fs.copy(file, backupDest);
        }
    }

    // Cadangkan package.json bila ada instruksi (opsional)
    if (backupPackageJson) {
        const pkgPath = path.join(projectRoot, 'package.json');
        if (await fs.pathExists(pkgPath)) {
            await fs.copy(pkgPath, path.join(backupDir, 'package.json'));
        }
    }

    // --- ROTASI BACKUP (Rolling Cleanup) ---
    // Batasi maksimal sesi backup agar tidak memakan ruang disk.
    // Jika maxBackups di-set ke 0 atau false, maka tidak ada batasan.
    if (maxBackups !== false && maxBackups > 0) {
        const baseBackupDir = path.join(projectRoot, '.deadkiller_backup');

        try {
            const items = await fs.readdir(baseBackupDir);
            // Ambil hanya direktori yang memiliki prefix 'backup_'
            const backupFolders = items.filter(item => item.startsWith('backup_'));

            // Urutkan (sort) nama folder. Karena formatnya 'backup_timestamp',
            // pengurutan alfabetis otomatis akan mengurutkan dari yang terlama ke terbaru.
            backupFolders.sort();

            // Jika jumlah folder melebihi batas, hapus folder-folder yang paling tua (oldest)
            if (backupFolders.length > maxBackups) {
                // Ambil elemen dari index 0 sampai selisihnya
                const foldersToDelete = backupFolders.slice(0, backupFolders.length - maxBackups);
                for (const folder of foldersToDelete) {
                    await fs.remove(path.join(baseBackupDir, folder));
                }
            }
        } catch (err) {
            if (process.env.DEBUG) console.warn(err);
        }
    }

    return backupDir;
}
