import fs from 'fs-extra';
import path from 'path';
import { spawnSync } from 'child_process';

/**
 * Membersihkan dan menghapus daftar dependensi yang tidak terpakai
 * secara langsung hingga ke folder node_modules dengan mengeksekusi
 * package manager bawaan (npm/yarn/pnpm/bun).
 * @param {string} projectRoot - Path direktori akar proyek
 * @param {string[]} unusedDeps - Array berisi nama-nama dependensi NPM yang akan dihapus
 * @returns {Promise<number>} Jumlah total dependensi yang berhasil dihapus
 */
export async function removeUnusedDependencies(projectRoot, unusedDeps) {
    if (!unusedDeps || unusedDeps.length === 0) return 0;

    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (!await fs.pathExists(packageJsonPath)) {
        throw new Error('package.json not found');
    }

    // Deteksi package manager berdasarkan file lock
    let cmd = 'npm';
    let cmdArgs = ['uninstall'];
    if (await fs.pathExists(path.join(projectRoot, 'yarn.lock'))) {
        cmd = 'yarn';
        cmdArgs = ['remove'];
    } else if (await fs.pathExists(path.join(projectRoot, 'pnpm-lock.yaml'))) {
        cmd = 'pnpm';
        cmdArgs = ['remove'];
    } else if (await fs.pathExists(path.join(projectRoot, 'bun.lockb'))) {
        cmd = 'bun';
        cmdArgs = ['remove'];
    }

    // Validasi nama package untuk keamanan ekstra (hanya alphanumeric, -, _, @, ., /)
    const validDeps = unusedDeps.filter(dep => /^[a-zA-Z0-9\-_.@/]+$/.test(dep));
    if (validDeps.length === 0) return 0;
    
    cmdArgs.push(...validDeps);

    try {
        if (process.env.DEBUG) console.log(`[DependencyCleaner] Executing: ${cmd} ${cmdArgs.join(' ')}`);
        
        // Gunakan spawnSync dengan shell: false untuk mencegah Command Injection
        const result = spawnSync(cmd, cmdArgs, { 
            cwd: projectRoot, 
            stdio: 'ignore', 
            shell: false 
        });

        if (result.error) throw result.error;
        if (result.status !== 0) throw new Error(`Exited with code ${result.status}`);

        return validDeps.length;
    } catch (err) {
        throw new Error(`Gagal menghapus dependensi. Perintah '${cmd} ${cmdArgs.join(' ')}' gagal: ${err.message}`);
    }
}
