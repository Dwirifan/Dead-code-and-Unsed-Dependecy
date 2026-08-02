import fs from 'fs-extra';
import path from 'path';

const BACKUP_METADATA_FILE = '.deadkiller-checkpoint.json';
const DEPENDENCY_STATE_FILES = [
    'package.json',
    'package-lock.json',
    'npm-shrinkwrap.json',
    'yarn.lock',
    'pnpm-lock.yaml',
    'bun.lock',
    'bun.lockb'
];

function isPathInside(parentPath, candidatePath) {
    const relative = path.relative(parentPath, candidatePath);
    return relative === '' || (
        relative !== '..' &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
    );
}

/**
 * Menciptakan titik pemulihan (Checkpoint Backup) untuk file sebelum dimodifikasi atau dihapus.
 *
 * @param {string} projectRoot - Path absolut dari akar proyek.
 * @param {Array<string>} filesToBackup - Daftar path absolut dari file yang akan di-backup.
 * @param {boolean} backupPackageJson - Opsi apakah file package.json perlu diikutsertakan.
 * @returns {Promise<string>} Mengembalikan path (lokasi) direktori backup yang tercipta.
 */
export async function createBackup(projectRoot, filesToBackup, backupPackageJson = false, maxBackups = 20) {
    const absRoot = path.resolve(projectRoot);
    const timestamp = Date.now();
    const backupDir = path.join(absRoot, '.deadkiller_backup', `backup_${timestamp}`);
    const requestedFiles = new Map();

    // Validasi keamanan path traversal: pastikan setiap file ada di dalam projectRoot
    for (const file of filesToBackup) {
        const absFile = path.resolve(file);
        const relativePath = path.relative(absRoot, absFile);
        const pointsToBackupVault = relativePath === '.deadkiller_backup' ||
            relativePath.startsWith(`.deadkiller_backup${path.sep}`);
        if (!isPathInside(absRoot, absFile) || relativePath === '' || pointsToBackupVault) {
            throw new Error(`[Security Error] File '${file}' berada di luar project root '${absRoot}'. Backup dibatalkan untuk mencegah path traversal.`);
        }
        requestedFiles.set(relativePath, {
            absolutePath: absFile,
            dependencyState: false
        });
    }

    // Package manager dapat mengubah manifest dan lockfile sekaligus. Seluruh
    // state deklaratif tersebut harus berada dalam checkpoint yang sama.
    if (backupPackageJson) {
        for (const relativePath of DEPENDENCY_STATE_FILES) {
            requestedFiles.set(relativePath, {
                absolutePath: path.join(absRoot, relativePath),
                dependencyState: true
            });
        }
    }

    try {
        // Pastikan folder brankas utama terbentuk
        await fs.ensureDir(backupDir);

        const metadata = {
            version: 1,
            createdAt: new Date().toISOString(),
            entries: []
        };

        // Lakukan pencadangan file sekaligus catat lockfile yang sebelumnya
        // tidak ada agar rollback dapat menghapus file baru buatan package manager.
        for (const [relativePath, descriptor] of requestedFiles) {
            const existed = await fs.pathExists(descriptor.absolutePath);
            metadata.entries.push({
                path: relativePath,
                existed,
                dependencyState: descriptor.dependencyState
            });

            if (existed) {
                const backupDest = path.join(backupDir, relativePath);

                // Pertahankan struktur hierarki sub-direktori orisinal di dalam brankas
                await fs.ensureDir(path.dirname(backupDest));

                // Salin file dengan aman
                await fs.copy(descriptor.absolutePath, backupDest);
            }
        }

        await fs.writeJson(path.join(backupDir, BACKUP_METADATA_FILE), metadata, { spaces: 2 });

        // --- ROTASI BACKUP (Rolling Cleanup) ---
        if (maxBackups !== false && maxBackups > 0) {
            const baseBackupDir = path.join(absRoot, '.deadkiller_backup');

            try {
                const items = await fs.readdir(baseBackupDir);
                const backupFolders = items.filter(item => item.startsWith('backup_'));
                backupFolders.sort();

                if (backupFolders.length > maxBackups) {
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
    } catch (err) {
        // Transaksi Atomik: Bersihkan direktori backup parsial jika terjadi kegagalan saat proses backup
        if (await fs.pathExists(backupDir)) {
            await fs.remove(backupDir).catch(() => undefined);
        }
        throw err;
    }
}
/**
 * Memulihkan (Rollback) file proyek dari direktori backup jika terjadi kegagalan saat eliminasi.
 *
 * @param {string} projectRoot - Path absolut dari akar proyek.
 * @param {string} backupDir - Path absolut dari direktori backup yang akan dipulihkan.
 * @returns {Promise<void>}
 */
export async function rollbackBackup(projectRoot, backupDir) {
    const absRoot = path.resolve(projectRoot);
    const absBackup = path.resolve(backupDir);
    const backupRoot = path.join(absRoot, '.deadkiller_backup');

    if (!await fs.pathExists(absBackup)) {
        throw new Error(`Direktori backup '${absBackup}' tidak ditemukan untuk rollback.`);
    }
    if (absBackup === backupRoot || !isPathInside(backupRoot, absBackup)) {
        throw new Error(`[Security Error] Direktori backup '${absBackup}' tidak valid.`);
    }

    const metadataPath = path.join(absBackup, BACKUP_METADATA_FILE);
    if (await fs.pathExists(metadataPath)) {
        const metadata = await fs.readJson(metadataPath);
        if (metadata.version !== 1 || !Array.isArray(metadata.entries)) {
            throw new Error(`Metadata checkpoint '${metadataPath}' tidak valid.`);
        }

        for (const entry of metadata.entries) {
            const normalizedEntry = typeof entry?.path === 'string' ? path.normalize(entry.path) : null;
            if (!normalizedEntry ||
                normalizedEntry === '.' ||
                normalizedEntry === BACKUP_METADATA_FILE ||
                path.isAbsolute(normalizedEntry)) {
                throw new Error(`[Security Error] Entri checkpoint tidak valid.`);
            }

            const sourcePath = path.resolve(absBackup, normalizedEntry);
            const destinationPath = path.resolve(absRoot, normalizedEntry);
            if (!isPathInside(absBackup, sourcePath) ||
                !isPathInside(absRoot, destinationPath) ||
                isPathInside(backupRoot, destinationPath)) {
                throw new Error(`[Security Error] Entri checkpoint '${entry.path}' keluar dari batas proyek.`);
            }

            if (entry.existed) {
                if (!await fs.pathExists(sourcePath)) {
                    throw new Error(`File checkpoint '${entry.path}' tidak ditemukan.`);
                }
                await fs.copy(sourcePath, destinationPath, { overwrite: true });
            } else if (entry.dependencyState) {
                // Hapus lockfile baru yang tidak ada sebelum package manager dijalankan.
                await fs.remove(destinationPath);
            }
        }
        return;
    }

    // Kompatibilitas dengan checkpoint versi lama yang belum memiliki metadata.
    const items = await fs.readdir(absBackup);
    for (const item of items.filter(item => item !== BACKUP_METADATA_FILE)) {
        const sourcePath = path.join(absBackup, item);
        const destinationPath = path.join(absRoot, item);
        await fs.copy(sourcePath, destinationPath, { overwrite: true });
    }
}
