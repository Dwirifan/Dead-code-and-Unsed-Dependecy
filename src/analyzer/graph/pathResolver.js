import fs from 'fs-extra';
import path from 'path';

/**
 * Mencoba mensimulasikan resolusi path Node.js secara akurat (Memperkirakan .js, .json, hingga /index.js)
 * @param {string} baseDir - Direktori tempat file yang memanggil berada
 * @param {string} relativeImport - Path import yang tertera di kode
 * @returns {Promise<string|null>} Path absolut file yang dituju, atau null jika tidak ditemukan
 */
export async function resolvePath(baseDir, relativeImport) {
    // 1. Exact path
    let candidate = path.resolve(baseDir, relativeImport);
    
    const tryExtensions = async (p) => {
        const extensions = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.json'];
        for (const ext of extensions) {
            if (await fs.pathExists(p + ext)) return p + ext;
        }
        return null;
    };

    // Mengecek apakah target mengarah langsung ke sebuah file spesifik
    if (await fs.pathExists(candidate) && (await fs.stat(candidate)).isFile()) return candidate;
    
    // Menebak ekstensi bila resolusi spesifik gagal
    let found = await tryExtensions(candidate);
    if (found) return found;

    // Jika target terdeteksi sebagai folder, asumsikan memanggil file `index` di dalamnya
    if (await fs.pathExists(candidate) && (await fs.stat(candidate)).isDirectory()) {
         // try candidate/index.js
         found = await tryExtensions(path.join(candidate, 'index'));
         if (found) return found;
    }

    return null; // Gagal diresolusi secara lokal (Bisa jadi impor dinamis paksa atau path rusak)
}
