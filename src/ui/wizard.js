import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { showBanner, uiColors } from './theme.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, '../../bin/dce-cli.js');

export async function launchWizard() {
    showBanner();

    // 1. Pilih Aksi
    let action;
    try {
        const answer = await inquirer.prompt([
            {
                type: 'list',
                name: 'action',
                message: 'Apa yang ingin Anda lakukan hari ini?',
                choices: [
                    { name: '[>] Analisis Proyek          (scan)',      value: 'scan' },
                    { name: '[*] Bersihkan Proyek          (fix)',       value: 'fix' },
                    { name: '[+] Lihat Dependensi          (show-deps)', value: 'show-deps' },
                    { name: '[H] Riwayat & Restore Backup  (history)',   value: 'history' },
                    { name: '[~] Buat Diagram Visualisasi  (visualize)', value: 'visualize' },
                    new inquirer.Separator(),
                    { name: '[x] Keluar', value: 'exit' },
                ]
            }
        ]);
        action = answer.action;
    } catch (err) {
        // Tangani Ctrl+C (ExitPromptError) agar tidak crash
        console.log(uiColors.muted('\n\n[.] Keluar. Sampai jumpa!\n'));
        process.exit(0);
    }

    if (action === 'exit') {
        console.log(uiColors.warning('\nSampai jumpa!\n'));
        process.exit(0);
    }

    // 2. Pilih Target Folder
    let targetDirectory;
    try {
        const answer = await inquirer.prompt([
            {
                type: 'input',
                name: 'targetDirectory',
                message: 'Masukkan direktori target (contoh: ./ atau ./src):',
                default: './',
                validate: (input) => {
                    if (fs.existsSync(path.resolve(input))) return true;
                    return '[!] Direktori tidak ditemukan! Silakan masukkan path yang valid.';
                }
            }
        ]);
        targetDirectory = answer.targetDirectory;
    } catch (err) {
        console.log(uiColors.muted('\n\n[.] Keluar. Sampai jumpa!\n'));
        process.exit(0);
    }

    console.log();

    // 3. Eksekusi Perintah (Pass-through ke CLI)
    try {
        // stdio: 'inherit' memastikan warna dan interaksi CLI tetap berjalan
        execSync(`node "${cliPath}" ${action} "${targetDirectory}"`, { stdio: 'inherit' });
    } catch (error) {
        // Kesalahan sudah ditangani dan di-print oleh proses anak (dce-cli.js)
    }

    console.log();
}
