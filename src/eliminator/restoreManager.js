import fs from 'fs-extra';
import path from 'path';

const BACKUP_DIR_NAME = '.deadkiller_backup';

/**
 * Mengembalikan daftar semua sesi checkpoint backup yang tersimpan di dalam folder brankas.
 * @param {string} projectRoot - Direktori akar proyek
 * @returns {Promise<Array<{name: string, path: string, date: Date, files: string[]}>>}
 */
export async function listCheckpoints(projectRoot) {
    const backupRoot = path.join(projectRoot, BACKUP_DIR_NAME);

    if (!await fs.pathExists(backupRoot)) {
        return [];
    }

    const entries = await fs.readdir(backupRoot);
    const checkpoints = [];

    for (const entry of entries) {
        if (!entry.startsWith('backup_')) continue;

        const checkpointPath = path.join(backupRoot, entry);
        const stat = await fs.stat(checkpointPath);
        if (!stat.isDirectory()) continue;

        // Ekstrak timestamp dari nama folder (backup_TIMESTAMP)
        const timestamp = parseInt(entry.replace('backup_', ''), 10);
        const date = isNaN(timestamp) ? stat.mtime : new Date(timestamp);

        // Kumpulkan daftar file yang ada di checkpoint ini
        const files = await collectFiles(checkpointPath, checkpointPath);

        checkpoints.push({
            name: entry,
            path: checkpointPath,
            date,
            files
        });
    }

    // Urutkan dari yang paling baru ke paling lama
    return checkpoints.sort((a, b) => b.date - a.date);
}

/**
 * Mengembalikan (restore) semua file dari sebuah checkpoint ke posisi aslinya di proyek.
 * @param {string} checkpointPath - Path absolut ke folder checkpoint backup
 * @param {string} projectRoot    - Path direktori akar proyek
 * @returns {Promise<{restored: number, failed: string[]}>}
 */
export async function restoreCheckpoint(checkpointPath, projectRoot) {
    const files = await collectFiles(checkpointPath, checkpointPath);
    let restored = 0;
    const failed = [];

    for (const relFile of files) {
        const srcFile  = path.join(checkpointPath, relFile);
        const destFile = path.join(projectRoot, relFile);

        try {
            // Pastikan direktori tujuan ada sebelum menyalin
            await fs.ensureDir(path.dirname(destFile));
            await fs.copy(srcFile, destFile, { overwrite: true });
            restored++;
        } catch (err) {
            failed.push(`${relFile}: ${err.message}`);
        }
    }

    return { restored, failed };
}

/**
 * Menghapus sebuah checkpoint dari folder brankas backup.
 * @param {string} checkpointPath - Path absolut ke folder checkpoint
 * @returns {Promise<void>}
 */
export async function deleteCheckpoint(checkpointPath) {
    await fs.remove(checkpointPath);
}

/**
 * Mengumpulkan semua file secara rekursif dari sebuah direktori.
 * @param {string} dir      - Direktori yang sedang dipindai
 * @param {string} baseDir  - Direktori dasar untuk path relatif
 * @returns {Promise<string[]>}
 */
async function collectFiles(dir, baseDir) {
    const result = [];
    const entries = await fs.readdir(dir);

    for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        const stat = await fs.stat(fullPath);

        if (stat.isDirectory()) {
            const subFiles = await collectFiles(fullPath, baseDir);
            result.push(...subFiles);
        } else {
            result.push(path.relative(baseDir, fullPath).replace(/\\/g, '/'));
        }
    }

    return result;
}
