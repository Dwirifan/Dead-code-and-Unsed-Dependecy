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
            name: 'ignoreFiles',
            message: 'Pola file/folder yang tidak boleh dihapus (pisahkan dengan koma):',
            default: '*.test.js, __tests__'
        },
        {
            type: 'confirm',
            name: 'preserveExports',
            message: 'Apakah file proyek ini adalah library? (Jika Ya, semua exported function/variable dilindungi)',
            default: false
        },
        {
            type: 'input',
            name: 'entryPoints',
            message: 'Masukkan entry points proyek Anda (pisahkan dengan koma, biarkan kosong untuk deteksi otomatis):',
            default: ''
        }
    ]);

    const ignoreFilesArray = answers.ignoreFiles.split(',').map(s => s.trim()).filter(Boolean);
    const entryPointsArray = answers.entryPoints ? answers.entryPoints.split(',').map(s => s.trim()).filter(Boolean) : [];

    try {
        const jsContent = `/**
 * Konfigurasi DeadKiller
 * Anda bisa menggunakan logika JS dinamis dan sistem overrides di sini.
 */
module.exports = {
    mode: '${answers.frameworkMode}',
    entryPoints: ${JSON.stringify(entryPointsArray)},
    ignorePrefixedVariables: '${answers.ignoreVariables}',
    preserveExports: ${answers.preserveExports},
    preserveFiles: ${JSON.stringify(ignoreFilesArray)},
    ignoreDependencies: [],
    
    // Contoh sistem overrides: Terapkan aturan berbeda untuk file spesifik
    overrides: [
        {
            files: ['**/*.test.js', 'tests/**/*.js'],
            ignorePrefixedVariables: '.*', // Abaikan semua unused variable di file testing
            preserveExports: true
        }
    ]
};
`;
        await fs.writeFile(configPathJS, jsContent, 'utf-8');
        console.log(chalk.green(`\n\u2714\uFE0F Berhasil membuat ${chalk.bold('deadkiller.config.js')}`));

        console.log(`\nSekarang Anda bisa menjalankan ${chalk.cyan('deadkiller scan')} dengan konfigurasi baru!\n`);
    } catch (err) {
        console.error(chalk.red(`\n\u2716\uFE0F Gagal menulis konfigurasi: ${err.message}`));
    }
}
