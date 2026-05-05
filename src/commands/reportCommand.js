import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';

/**
 * Mendaftarkan perintah `report` sebagai alias dari perintah `visualize`.
 * 
 * Perintah ini menjalankan visualize secara otomatis —
 * laporan dead code sudah terintegrasi di dalam HTML dashboard yang sama.
 * 
 * @param {import('commander').Command} program
 */
export function registerReportCommand(program) {
    program
        .command('report')
        .argument('<path>', 'Path ke direktori proyek')
        .description('Alias dari visualize — Generate HTML Dashboard + Laporan Dead Code')
        .action(async (targetPath) => {
            const absolutePath = path.resolve(targetPath);
            if (!fs.existsSync(absolutePath)) {
                console.error(chalk.red(`[ERROR] Path '${absolutePath}' tidak ditemukan.`));
                process.exit(1);
            }

            console.log(chalk.gray('[i] Perintah `report` menjalankan `visualize` (laporan sudah terintegrasi di dashboard).\n'));

            // Jalankan visualize secara programatik
            await program.parseAsync(['node', 'deadkiller', 'visualize', targetPath]);
        });
}
