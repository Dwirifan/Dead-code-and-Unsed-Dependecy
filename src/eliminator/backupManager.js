import fs from 'fs-extra';
import path from 'path';

/**
 * Creates a checkpoint backup of files before they are modified or deleted.
 * 
 * @param {string} projectRoot - The absolute path of the root project.
 * @param {Array<string>} filesToBackup - List of absolute paths of files to backup.
 * @param {boolean} backupPackageJson - Whether to include package.json in the backup.
 * @returns {Promise<string>} The path to the backup directory.
 */
export async function createBackup(projectRoot, filesToBackup, backupPackageJson = false) {
    const timestamp = Date.now();
    const backupDir = path.join(projectRoot, '.deadkiller_backup', `backup_${timestamp}`);
    
    // Ensure the backup base directory exists
    await fs.ensureDir(backupDir);

    // Backup individual valid files
    for (const file of filesToBackup) {
        if (await fs.pathExists(file)) {
            const relativePath = path.relative(projectRoot, file);
            const backupDest = path.join(backupDir, relativePath);
            
            // Ensure proper directory structure in backup
            await fs.ensureDir(path.dirname(backupDest));
            
            // Copy file securely
            await fs.copy(file, backupDest);
        }
    }

    // Backup package.json if requested
    if (backupPackageJson) {
        const pkgPath = path.join(projectRoot, 'package.json');
        if (await fs.pathExists(pkgPath)) {
            await fs.copy(pkgPath, path.join(backupDir, 'package.json'));
        }
    }

    return backupDir;
}
