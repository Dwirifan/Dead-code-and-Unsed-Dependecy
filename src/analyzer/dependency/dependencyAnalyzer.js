import fs from 'fs-extra';
import path from 'path';

/**
 * Modul Analisis Dependensi (Unused Dependency Analyzer)
 * 
 * Bertanggung jawab atas seluruh siklus deteksi dependensi NPM yang tidak terpakai:
 *   1. Membaca daftar dependensi yang dideklarasikan di package.json
 *   2. Membandingkan dengan daftar paket yang benar-benar dipakai oleh kode
 *   3. Menghasilkan laporan dependensi yang tidak terpakai (unused)
 * 
 * PENTING: Hanya `dependencies` (runtime) yang dianalisis secara ketat.
 * `devDependencies` (build tools seperti webpack, prettier, babel) TIDAK
 * diperiksa karena mereka dipanggil melalui CLI/npm-scripts/config-files,
 * bukan melalui import/require di kode sumber.
 * 
 * Modul ini menerima data `usedPackages` dari Project Graph (BFS) agar
 * tidak perlu melakukan traversal ulang — cukup sekali scan, data dipakai bersama.
 */

/**
 * Membaca package.json dan mengembalikan semua dependensi yang terdaftar.
 * Memisahkan `dependencies` (runtime) dan `devDependencies` (build tools).
 * 
 * @param {string} projectRoot - Path direktori akar proyek
 * @returns {Promise<{runtimeDeps: Set<string>, devDeps: Set<string>, pkg: object}>}
 * @throws {Error} Jika file package.json tidak ditemukan
 */
export async function getDeclaredDependencies(projectRoot) {
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (!await fs.pathExists(packageJsonPath)) {
        throw new Error('File package.json tidak ditemukan di: ' + projectRoot);
    }

    const pkg = await fs.readJson(packageJsonPath);
    const runtimeDeps = new Set(Object.keys(pkg.dependencies || {}));
    const devDeps = new Set(Object.keys(pkg.devDependencies || {}));

    return { runtimeDeps, devDeps, pkg };
}

/**
 * Menganalisis dan mendeteksi dependensi NPM yang tidak terpakai.
 * 
 * Cara kerja:
 *   - Membaca dependensi runtime dari package.json (dependencies)
 *   - Menerima daftar paket yang terdeteksi dipakai dari Project Graph (usedPackages)
 *   - Membandingkan: runtimeDeps - usedPackages = unusedDependencies
 *   - devDependencies DILEWATI karena mereka adalah build tools (webpack, prettier, dll)
 *     yang dipanggil via CLI/npm-scripts, bukan import/require
 * 
 * @param {string} projectRoot - Path direktori akar proyek
 * @param {Set<string>} usedPackages - Set berisi nama paket NPM yang benar-benar
 *                                      dipakai oleh kode (dari buildProjectGraph)
 * @returns {Promise<object>} Objek berisi daftar dependensi tidak terpakai beserta statistik
 */
export async function findUnusedDependencies(projectRoot, usedPackages) {
    const { runtimeDeps, devDeps } = await getDeclaredDependencies(projectRoot);

    // Bandingkan: hanya runtime dependencies vs yang benar-benar dipakai
    const unused = [];
    for (const dep of runtimeDeps) {
        if (!usedPackages.has(dep)) {
            unused.push(dep);
        }
    }

    return {
        unused,                            // Daftar nama dependensi runtime yang tidak terpakai
        declared: runtimeDeps,             // Runtime dependencies yang dideklarasikan
        devDeclared: devDeps,              // Dev dependencies (tidak dianalisis)
        used: usedPackages,                // Semua dependensi yang terdeteksi dipakai
        totalDeclared: runtimeDeps.size,   // Jumlah total runtime declared
        totalUsed: usedPackages.size,      // Jumlah total used
        totalUnused: unused.length         // Jumlah total unused
    };
}
