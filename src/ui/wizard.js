import inquirer from 'inquirer';
import fs from 'fs-extra';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { showBanner, uiColors } from './theme.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Mengarah kembali ke D:\Materi Kuliah\Tugas Akhir\Tugas Akhir\bin\dce-cli.js
const cliPath = path.resolve(__dirname, '../../bin/dce-cli.js');

export async function launchWizard() {
    showBanner();

    // 1. Pilih Aksi
    const { action } = await inquirer.prompt([
        {
            type: 'list',
            name: 'action',
            message: 'Apa yang ingin Anda lakukan hari ini?',
            choices: [
                { name: '🔍 Analisis Proyek (Scan Mode)', value: 'scan' },
                { name: '🧹 Bersihkan Proyek (Fix Mode)', value: 'fix' },
                { name: '📦 Lihat Daftar Dependensi (Show Deps)', value: 'show-deps' },
                { name: '🕸️ Buat Diagram Visualisasi (Visualize)', value: 'visualize' },
                new inquirer.Separator(),
                { name: '❌ Keluar', value: 'exit' },
            ]
        }
    ]);

    if (action === 'exit') {
        console.log(uiColors.warning('\nSampai jumpa! 👋\n'));
        process.exit(0);
    }

    // 2. Pilih Target Folder
    const { targetDirectory } = await inquirer.prompt([
        {
            type: 'input',
            name: 'targetDirectory',
            message: 'Masukkan direktori target (contoh: ./ atau ./src):',
            default: './',
            validate: (input) => {
                if (fs.existsSync(path.resolve(input))) {
                    return true;
                }
                return '❌ Direktori tidak ditemukan! Silakan masukkan path yang valid.';
            }
        }
    ]);

    console.log(); 
    
    // 3. Eksekusi Perintah Asli secara Tembus Pandang (Pass-through)
    try {
        // stdio: 'inherit' memastikan warna dan interaksi CLI (termasuk Inquirer di dalam fix mode) tetap jalan
        execSync(`node "${cliPath}" ${action} "${targetDirectory}"`, { stdio: 'inherit' });
    } catch (error) {
        // Kesalahan sudah ditangani dan di-print oleh proses anak (dce-cli.js)
    }

    console.log();
}
