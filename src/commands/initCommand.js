import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';

export function registerInitCommand(program) {
    program
        .command('init')
        .description('Generate konfigurasi DeadKiller secara interaktif')
        .option('-f, --force', 'Timpa file konfigurasi jika sudah ada')
        .action(initCommand);
}

/**
 * Command 'init': Generate konfigurasi secara interaktif
 */
export async function initCommand(options) {
    const cwd = process.cwd();
    const configPathJS = path.join(cwd, 'deadkiller.config.js');
    const configPathJSON = path.join(cwd, '.deadkillerrc.json');

    console.log(chalk.bold.cyan('\n=== Inisialisasi Konfigurasi DeadKiller ===\n'));

    const jsExists = await fs.pathExists(configPathJS);
    const jsonExists = await fs.pathExists(configPathJSON);

    if (jsExists || jsonExists) {
        if (!options.force) {
            console.log(chalk.yellow(`\u26A0\uFE0F File konfigurasi sudah ada di proyek ini.`));
            console.log(chalk.gray(`Gunakan flag --force untuk menimpa file yang ada.`));
            return;
        } else {
            console.log(chalk.yellow(`\u26A0\uFE0F Menimpa file konfigurasi yang sudah ada...`));
        }
    }

    const answers = await inquirer.prompt([
        {
            type: 'list',
            name: 'frameworkMode',
            message: 'Framework apa yang digunakan dalam proyek ini?',
            choices: [
                { name: 'Vanilla JS/TS', value: 'vanilla' },
                { name: 'Next.js', value: 'next' },
                { name: 'React (Create React App / Vite)', value: 'react' },
                { name: 'Vue/Nuxt', value: 'vue' }
            ]
        },
        {
            type: 'input',
            name: 'ignoreVariables',
            message: 'Regex untuk variabel yang harus diabaikan (contoh: ^_ untuk variabel berawalan underscore):',
            default: '^_|dummy'
        },
        {
            type: 'input',
            name: 'preserveFiles',
            message: 'Pola file/folder yang tidak boleh dihapus/aman dari modifikasi (contoh: *.test.js, __tests__):',
            default: '*.test.js, __tests__'
        },
        {
            type: 'input',
            name: 'ignoreFiles',
            message: 'Folder/path yang sepenuhnya diabaikan dari pemindaian AST (contoh: dist, build, coverage):',
            default: 'dist, build, coverage'
        },
        {
            type: 'confirm',
            name: 'preserveExports',
            message: 'Apakah proyek ini sebuah Library/Pustaka publik (seperti NPM package)?\n  \u26A0\uFE0F PERINGATAN: Jika Anda pilih (Y), fungsi yang di-export TIDAK AKAN dihapus meskipun tak terpakai.\n  \u26A0\uFE0F Jika Anda pilih (N/Aplikasi Web Biasa), export yang tak terpakai akan otomatis dihapus!\n  Pilih: ',
            default: false
        },
        {
            type: 'input',
            name: 'entryPoints',
            message: 'Masukkan entry points proyek Anda (pisahkan dengan koma, biarkan kosong untuk deteksi otomatis):',
            default: ''
        },
        {
            type: 'list',
            name: 'configFormat',
            message: 'Format file konfigurasi apa yang ingin Anda gunakan?',
            choices: [
                { name: 'JavaScript Dinamis (deadkiller.config.js)', value: 'js' },
                { name: 'JSON Statis (.deadkillerrc.json)', value: 'json' }
            ]
        }
    ]);

    const preserveFilesArray = answers.preserveFiles.split(',').map(s => s.trim()).filter(Boolean);
    const ignoreFilesArray = answers.ignoreFiles.split(',').map(s => s.trim()).filter(Boolean);
    let entryPointsArray = answers.entryPoints ? answers.entryPoints.split(',').map(s => s.trim()).filter(Boolean) : [];

    // Jika pengguna mengosongkan, lakukan deteksi otomatis nyata sebelum menyimpan!
    if (entryPointsArray.length === 0) {
        console.log(chalk.gray(`\n[>] Mendeteksi entry point secara otomatis...`));
        try {
            // Import dinamis untuk menghindari dependency circle atau error loading awal
            const { findEntryPoints } = await import('../analyzer/graph/entryPointFinder.js');
            const detected = await findEntryPoints(cwd);
            if (detected && detected.length > 0) {
                // Konversi absolut ke relatif agar rapi di config
                entryPointsArray = detected.map(p => path.relative(cwd, p).replace(/\\/g, '/'));
                console.log(chalk.green(`    [v] Ditemukan ${entryPointsArray.length} entry point: ${entryPointsArray.join(', ')}`));
            } else {
                console.log(chalk.yellow(`    [!] Gagal mendeteksi entry point secara otomatis. Menyimpan array kosong.`));
            }
        } catch (e) {
            console.log(chalk.yellow(`    [!] Terjadi kesalahan saat deteksi otomatis: ${e.message}`));
        }
    }

    const configObj = {
        mode: answers.frameworkMode,
        entryPoints: entryPointsArray,
        ignorePrefixedVariables: answers.ignoreVariables,
        preserveExports: answers.preserveExports,
        preserveFiles: preserveFilesArray,
        ignoreFiles: ignoreFilesArray,
        ignoreDependencies: [],
        globals: [],
        overrides: [
            {
                files: ['**/*.test.js', 'tests/**/*.js'],
                ignorePrefixedVariables: '.*', // Abaikan semua unused variable di file testing
                preserveExports: true
            }
        ]
    };

    try {
        if (answers.configFormat === 'json') {
            await fs.writeJson(configPathJSON, configObj, { spaces: 4 });
            console.log(chalk.green(`\n\u2714\uFE0F Berhasil membuat ${chalk.bold('.deadkillerrc.json')}`));
        } else {
            const jsContent = `/**
 * Konfigurasi DeadKiller
 * Anda bisa menggunakan logika JS dinamis dan sistem overrides di sini.
 */
export default ${JSON.stringify(configObj, null, 4)};
`;
            await fs.writeFile(configPathJS, jsContent, 'utf-8');
            console.log(chalk.green(`\n\u2714\uFE0F Berhasil membuat ${chalk.bold('deadkiller.config.js')}`));
        }

        console.log(`\nSekarang Anda bisa menjalankan ${chalk.cyan('deadkiller scan')} dengan konfigurasi baru!\n`);
    } catch (err) {
        console.error(chalk.red(`\n\u2716\uFE0F Gagal menulis konfigurasi: ${err.message}`));
    }
}
