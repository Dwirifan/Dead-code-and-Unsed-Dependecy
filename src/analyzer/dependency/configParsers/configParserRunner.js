import { parseEslintConfig } from './eslintParser.js';
import { parseBabelConfig } from './babelParser.js';

/**
 * Config Parser Runner (Orkestrasi)
 *
 * Bertanggung jawab menjalankan seluruh config parser yang tersedia
 * dan menggabungkan hasilnya menjadi satu Set nama paket NPM yang
 * benar-benar digunakan dalam file-file konfigurasi di proyek.
 *
 * Hasil Set ini kemudian digunakan oleh dependencyAnalyzer.js untuk
 * memutuskan apakah sebuah devDependency benar-benar mati (Dead DevDep)
 * atau masih digunakan di dalam sebuah file konfigurasi.
 *
 * Config Parsers yang tersedia:
 *   - eslintParser  : membaca .eslintrc.* / eslint.config.* / package.json#eslintConfig
 *   - babelParser   : membaca babel.config.* / .babelrc / package.json#babel
 *
 * Menambah parser baru cukup dengan:
 *   1. Membuat file baru di folder ini (misal: jestParser.js)
 *   2. Meng-import dan menambahkannya ke dalam fungsi `runConfigParsers` di bawah.
 */

/**
 * Menjalankan seluruh config parsers dan menggabungkan hasilnya.
 *
 * @param {string} projectRoot - Path absolut direktori akar proyek
 * @returns {Promise<Set<string>>} - Set berisi nama paket NPM yang digunakan di config files
 */
export async function runConfigParsers(projectRoot) {
    const configUsedPackages = new Set();

    // Jalankan semua parser secara paralel untuk efisiensi
    const results = await Promise.allSettled([
        parseEslintConfig(projectRoot),
        parseBabelConfig(projectRoot),
    ]);

    for (const result of results) {
        if (result.status === 'fulfilled' && Array.isArray(result.value)) {
            for (const pkg of result.value) {
                if (pkg) configUsedPackages.add(pkg);
            }
        }
        // Jika 'rejected', abaikan dan lanjutkan — parser lain tetap berjalan
    }

    return configUsedPackages;
}
