import * as Diff from 'diff';
import chalk from 'chalk';

/**
 * Menganalisis perbedaan dua buah string dan mencetaknya dalam format Git-style Unified Diff.
 * Laporan ini digunakan sebagai pralihat visualisasi keamanan sebelum mengeksekusi penghapusan asli.
 * 
 * Format output:
 *   ┌─ <filename> ──────────────────────
 *   │ @@ -10,5 +10,3 @@
 *   │  unchanged line
 *   │ -removed line
 *   │ +added line
 *   └──────────────────────────────────
 * 
 * @param {string} oldCode - Teks kode sumber versi asli/lama.
 * @param {string} newCode - Teks kode sumber versi modifikasi (setelah pemotongan dead code).
 * @param {string} fileName - Nama file yang sedang dianalisis.
 * @returns {string} String keluaran Diff yang sudah diwarnai dengan Chalk.
 */
export function generateDiff(oldCode, newCode, fileName) {
    const patch = Diff.createTwoFilesPatch(fileName, fileName, oldCode, newCode, 'Original', 'Cleaned', { context: 3 });
    const lines = patch.split('\n');
    let output = '';

    // Hitung statistik perubahan
    let additions = 0, deletions = 0;

    // Header bergaya Git
    output += chalk.bold.white(`\n  ┌─ ${fileName} ${'─'.repeat(Math.max(1, 40 - fileName.length))}`) + '\n';

    // Pewarnaan Keluaran (Git-style Colorize)
    lines.forEach(line => {
        if (line.startsWith('Index:') || line.startsWith('===')) {
            // Skip metadata header noise
            return; 
        }
        if (line.startsWith('---')) {
            output += chalk.red(`  │ ${line}`) + '\n';
        } else if (line.startsWith('+++')) {
            output += chalk.green(`  │ ${line}`) + '\n';
        } else if (line.startsWith('@@')) {
            // Baris hunk header — highlight khusus seperti Git
            output += chalk.cyan(`  │ ${line}`) + '\n';
        } else if (line.startsWith('+')) {
            additions++;
            output += chalk.green(`  │ ${line}`) + '\n';
        } else if (line.startsWith('-')) {
            deletions++;
            output += chalk.red(`  │ ${line}`) + '\n';
        } else if (line.startsWith(' ')) {
            // Baris konteks (tidak berubah) — tampilkan redup
            output += chalk.dim(`  │ ${line}`) + '\n';
        } else if (line.trim() === '') {
            // Baris kosong dalam diff
            output += chalk.dim(`  │`) + '\n';
        }
    });

    // Footer dengan statistik
    const statsLine = `${chalk.green(`+${additions}`)} ${chalk.red(`-${deletions}`)}`;
    output += chalk.bold.white(`  └${'─'.repeat(42)} ${statsLine}`) + '\n';

    return output;
}
