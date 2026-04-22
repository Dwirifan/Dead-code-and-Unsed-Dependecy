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
 * Modul ini menerima data `usedPackages` dari Project Graph (BFS) agar
 * tidak perlu melakukan traversal ulang — cukup sekali scan, data dipakai bersama.
 */

/**
 * Membaca package.json dan mengembalikan semua dependensi yang terdaftar.
 * Menggabungkan `dependencies` dan `devDependencies` menjadi satu Set.
 * 
 * @param {string} projectRoot - Path direktori akar proyek
 * @returns {Promise<{declared: Set<string>, pkg: object}>} Set berisi nama dependensi + objek package.json
 * @throws {Error} Jika file package.json tidak ditemukan
 */
export async function getDeclaredDependencies(projectRoot) {
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (!await fs.pathExists(packageJsonPath)) {
        throw new Error('File package.json tidak ditemukan di: ' + projectRoot);
    }

    const pkg = await fs.readJson(packageJsonPath);
    const declared = new Set(Object.keys({
        ...pkg.dependencies,
        ...pkg.devDependencies
    }));

    return { declared, pkg };
}

/**
 * Menganalisis dan mendeteksi dependensi NPM yang tidak terpakai.
 * 
 * Cara kerja:
 *   - Membaca semua dependensi dari package.json (declared)
 *   - Menerima daftar paket yang terdeteksi dipakai dari Project Graph (usedPackages)
 *   - Membandingkan: declared - usedPackages = unusedDependencies
 * 
 * @param {string} projectRoot - Path direktori akar proyek
 * @param {Set<string>} usedPackages - Set berisi nama paket NPM yang benar-benar
 *                                      dipakai oleh kode (dari buildProjectGraph)
 * @returns {Promise<{unused: string[], declared: Set<string>, used: Set<string>}>}
 *          Objek berisi daftar dependensi tidak terpakai beserta statistik
 */
export async function findUnusedDependencies(projectRoot, usedPackages) {
    const { declared } = await getDeclaredDependencies(projectRoot);

    // Bandingkan: dependensi yang dideklarasikan vs yang benar-benar dipakai
    const unused = [];
    for (const dep of declared) {
        if (!usedPackages.has(dep)) {
            unused.push(dep);
        }
    }

    return {
        unused,                        // Daftar nama dependensi yang tidak terpakai
        declared,                      // Semua dependensi yang dideklarasikan
        used: usedPackages,            // Semua dependensi yang terdeteksi dipakai
        totalDeclared: declared.size,  // Jumlah total declared
        totalUsed: usedPackages.size,  // Jumlah total used
        totalUnused: unused.length     // Jumlah total unused
    };
}
