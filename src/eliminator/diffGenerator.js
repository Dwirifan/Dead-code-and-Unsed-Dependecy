import * as Diff from 'diff';
import chalk from 'chalk';

/**
 * Menganalisis perbedaan dua buah string dan mencetaknya dalam bentuk warna-warni (Unified Diff) yang ramah Terminal.
 * Laporan ini digunakan sebagai pralihat visualisasi keamanan sebelum mengeksekusi penghapusan asli.
 * 
 * @param {string} oldCode - Teks kode sumber versi asli/lama.
 * @param {string} newCode - Teks kode sumber versi modifikasi (setelah pemotongan dead code).
 * @param {string} fileName - Nama file yang sedang dianalisis.
 * @returns {string} String keluaran Diff yang sudah diwarnai dengan kapur (Chalk).
 */
export function generateDiff(oldCode, newCode, fileName) {
    const patch = Diff.createTwoFilesPatch(fileName, fileName, oldCode, newCode, 'Original', 'Modified', { context: 3 });
    const lines = patch.split('\n');
    let output = '';

    // Pewarnaan Keluaran (Colorize Output)
    lines.forEach(line => {
        if (line.startsWith('Index:') || line.startsWith('===')) {
            // Lewati sampah metadata header (Skip header noise)
            return; 
        }
        if (line.startsWith('---') || line.startsWith('+++')) {
             output += chalk.gray(line) + '\n';
        } else if (line.startsWith('@@')) {
             output += chalk.cyan(line) + '\n';
        } else if (line.startsWith('+')) {
             output += chalk.green(line) + '\n';
        } else if (line.startsWith('-')) {
             output += chalk.red(line) + '\n';
        } else {
             output += chalk.dim(line) + '\n';
        }
    });

    return output;
}
