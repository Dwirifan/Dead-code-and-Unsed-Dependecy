import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';
import ora from 'ora';
import { listCheckpoints, restoreCheckpoint, deleteCheckpoint } from '../eliminator/restoreManager.js';

/**
 * Mendaftarkan perintah `history` ke instance Commander yang diberikan.
 * Menampilkan riwayat checkpoint backup dan memungkinkan restore atau hapus.
 * @param {import('commander').Command} program
 */
export function registerHistoryCommand(program) {
    program
        .command('history')
        .argument('<path>', 'Path to project directory')
        .description('Lihat riwayat checkpoint backup dan pilih untuk restore atau hapus')
        .action(async (targetPath) => {
            const absolutePath = path.resolve(targetPath);
            if (!fs.existsSync(absolutePath)) {
                console.error(`[ERROR] Path '${absolutePath}' tidak ditemukan.`);
                process.exit(1);
            }

            const spinner = ora('Memindai riwayat checkpoint...').start();
            const checkpoints = await listCheckpoints(absolutePath);
            spinner.stop();

            if (checkpoints.length === 0) {
                console.log(chalk.yellow('\n[!] Belum ada checkpoint backup yang tersimpan.'));
                console.log(chalk.gray('    Jalankan perintah "fix" terlebih dahulu untuk membuat checkpoint.\n'));
                return;
            }

            const inquirer = (await import('inquirer')).default;

            // Format pilihan
            const choices = checkpoints.map(cp => {
                const dateStr = cp.date.toLocaleString('id-ID', {
                    day: '2-digit', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit'
                });
                return { name: `${dateStr}  (${cp.files.length} file)  -- ${cp.name}`, value: cp };
            });

            console.log(chalk.cyan(`\n[H] Riwayat Checkpoint Backup (${checkpoints.length} sesi ditemukan)\n`));

            const { selectedCheckpoint } = await inquirer.prompt([{
                type: 'list', name: 'selectedCheckpoint',
                message: 'Pilih checkpoint yang ingin dikelola:',
                choices
            }]);

            // Tampilkan isi checkpoint
            console.log(chalk.gray(`\nIsi checkpoint "${selectedCheckpoint.name}":`));
            selectedCheckpoint.files.forEach(f => console.log(`   - ${f}`));
            console.log();

            const { action } = await inquirer.prompt([{
                type: 'list', name: 'action',
                message: 'Apa yang ingin Anda lakukan dengan checkpoint ini?',
                choices: [
                    { name: '[<] Restore   — Kembalikan semua file ke kondisi ini', value: 'restore' },
                    { name: '[x] Hapus     — Hapus checkpoint ini dari brankas',     value: 'delete'  },
                    { name: '[.] Batal',                                              value: 'cancel'  },
                ]
            }]);

            if (action === 'cancel') { console.log(chalk.gray('\n[.] Dibatalkan.\n')); return; }

            if (action === 'delete') {
                const { confirm } = await inquirer.prompt([{
                    type: 'confirm', name: 'confirm',
                    message: `Yakin ingin menghapus checkpoint "${selectedCheckpoint.name}"? (tidak bisa dibatalkan)`,
                    default: false
                }]);
                if (!confirm) { console.log(chalk.gray('[.] Dibatalkan.\n')); return; }

                await deleteCheckpoint(selectedCheckpoint.path);
                console.log(chalk.green(`\n[ok] Checkpoint "${selectedCheckpoint.name}" berhasil dihapus.\n`));
                return;
            }

            if (action === 'restore') {
                const { confirm } = await inquirer.prompt([{
                    type: 'confirm', name: 'confirm',
                    message: `Yakin ingin MENGEMBALIKAN file ke kondisi checkpoint "${selectedCheckpoint.name}"?\n  File yang dimodifikasi sesudahnya akan DITIMPA.`,
                    default: false
                }]);
                if (!confirm) { console.log(chalk.gray('[.] Dibatalkan.\n')); return; }

                const restoreSpinner = ora('Mengembalikan file dari checkpoint...').start();
                const { restored, failed } = await restoreCheckpoint(selectedCheckpoint.path, absolutePath);
                restoreSpinner.stop();

                console.log(chalk.green(`\n[ok] Berhasil memulihkan ${restored} file dari checkpoint.`));
                if (failed.length > 0) {
                    console.log(chalk.yellow(`[!] Gagal memulihkan ${failed.length} file:`));
                    failed.forEach(f => console.log(`   - ${f}`));
                } else {
                    try {
                        await deleteCheckpoint(selectedCheckpoint.path);
                        console.log(chalk.gray(`    [i] Folder checkpoint "${selectedCheckpoint.name}" telah dihapus otomatis.`));
                    } catch (e) {
                        console.log(chalk.yellow(`    [!] Gagal menghapus folder checkpoint: ${e.message}`));
                    }
                }
                console.log();
            }
        });
}
