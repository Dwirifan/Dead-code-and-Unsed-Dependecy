import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';
import ora from 'ora';
import { listCheckpoints, restoreCheckpoint, deleteCheckpoint } from '../eliminator/restoreManager.js';

/**
 * Mendaftarkan perintah `undo` dan `restore` ke instance Commander yang diberikan.
 * Memungkinkan pemulihan cepat (Time Machine) dari checkpoint backup terakhir atau pilihan riwayat.
 * @param {import('commander').Command} program
 */
export function registerUndoCommand(program) {
    program
        .command('undo [path]')
        .alias('restore')
        .description('Kembalikan proyek ke kondisi sebelum eliminasi dari checkpoint backup (Time Machine)')
        .option('-l, --latest', 'Langsung pulihkan dari checkpoint terbaru tanpa pemilihan interaktif')
        .option('-y, --yes', 'Lewati konfirmasi pemulihan')
        .action(async (targetPath, options) => {
            const absolutePath = path.resolve(targetPath || '.');
            if (!fs.existsSync(absolutePath)) {
                console.error(`[ERROR] Path '${absolutePath}' tidak ditemukan.`);
                process.exit(1);
            }

            const spinner = ora('Memindai brankas checkpoint backup...').start();
            const checkpoints = await listCheckpoints(absolutePath);
            spinner.stop();

            if (checkpoints.length === 0) {
                console.log(chalk.yellow('\n[!] Belum ada checkpoint backup yang tersimpan di proyek ini.'));
                console.log(chalk.gray('    Jalankan perintah "fix" terlebih dahulu untuk menciptakan checkpoint otomatis.\n'));
                return;
            }

            let selectedCheckpoint = checkpoints[0]; // Daftar sudah diurutkan dari yang terbaru

            if (!options.latest && !options.yes) {
                const inquirer = (await import('inquirer')).default;

                const choices = checkpoints.map((cp, idx) => {
                    const dateStr = cp.date.toLocaleString('id-ID', {
                        day: '2-digit', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                    });
                    const badge = idx === 0 ? chalk.green('[⭐️ TERBARU] ') : chalk.gray('[riwayat]  ');
                    return {
                        name: `${badge}${dateStr}  (${cp.files.length} file)  -- ${cp.name}`,
                        value: cp
                    };
                });

                console.log(chalk.cyan(`\n[<] Time Machine Pemulihan DeadCode (${checkpoints.length} checkpoint tersedia)\n`));

                const result = await inquirer.prompt([{
                    type: 'list',
                    name: 'selectedCheckpoint',
                    message: 'Pilih checkpoint yang ingin dipulihkan (Restore):',
                    choices
                }]);
                selectedCheckpoint = result.selectedCheckpoint;

                // Tampilkan preview file yang akan dikembalikan
                console.log(chalk.gray(`\nFile yang akan dipulihkan dari "${selectedCheckpoint.name}":`));
                selectedCheckpoint.files.forEach(f => console.log(`   - ${f}`));
                console.log();

                const { confirm } = await inquirer.prompt([{
                    type: 'confirm',
                    name: 'confirm',
                    message: `Yakin ingin MENGEMBALIKAN proyek ke kondisi checkpoint "${selectedCheckpoint.name}"?\n  Perubahan setelah checkpoint ini akan ditimpa.`,
                    default: true
                }]);
                if (!confirm) {
                    console.log(chalk.gray('[.] Pemulihan dibatalkan.\n'));
                    return;
                }
            } else {
                console.log(chalk.cyan(`\n[<] Memulihkan dari checkpoint terbaru: "${selectedCheckpoint.name}"`));
            }

            const restoreSpinner = ora('Mengembalikan file dan manifest dari checkpoint...').start();
            const { restored, failed } = await restoreCheckpoint(selectedCheckpoint.path, absolutePath);
            restoreSpinner.stop();

            console.log(chalk.green(`\n[ok] Berhasil memulihkan ${restored} file ke kondisi semula.`));
            if (failed.length > 0) {
                console.log(chalk.yellow(`[!] Gagal memulihkan ${failed.length} file:`));
                failed.forEach(f => console.log(`   - ${f}`));
            } else {
                // Menghapus backup setelah berhasil dipulihkan
                try {
                    await deleteCheckpoint(selectedCheckpoint.path);
                    console.log(chalk.gray(`    [i] Folder checkpoint "${selectedCheckpoint.name}" telah dihapus otomatis.`));
                } catch (e) {
                    console.log(chalk.yellow(`    [!] Gagal menghapus folder checkpoint: ${e.message}`));
                }
            }
            console.log(chalk.gray(`    Proyek Anda kini telah aman kembali seperti sebelum eliminasi dilakukan.\n`));
        });
}
