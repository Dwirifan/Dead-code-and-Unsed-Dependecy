import fs from 'fs-extra';
import path from 'path';

/**
 * Membersihkan dan menghapus daftar dependensi yang tidak terpakai
 * secara langsung dari berkas manifesto `package.json`.
 * @param {string} projectRoot - Path direktori akar proyek
 * @param {string[]} unusedDeps - Array berisi nama-nama dependensi NPM yang akan dihapus
 * @returns {Promise<number>} Jumlah total dependensi yang berhasil dihapus
 */
export async function removeUnusedDependencies(projectRoot, unusedDeps) {
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (!await fs.pathExists(packageJsonPath)) {
        throw new Error('package.json not found');
    }

    const pkg = await fs.readJson(packageJsonPath);
    let removedCount = 0;

    if (pkg.dependencies) {
        unusedDeps.forEach(dep => {
            if (pkg.dependencies[dep]) {
                delete pkg.dependencies[dep];
                removedCount++;
            }
        });
    }

    if (pkg.devDependencies) {
        unusedDeps.forEach(dep => {
            if (pkg.devDependencies[dep]) {
                delete pkg.devDependencies[dep];
                removedCount++;
            }
        });
    }

    if (removedCount > 0) {
        await fs.writeJson(packageJsonPath, pkg, { spaces: 2 });
    }

    return removedCount;
}
