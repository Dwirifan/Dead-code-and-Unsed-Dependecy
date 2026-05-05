import fs from 'fs-extra';
import path from 'path';
import chalk from 'chalk';
import inquirer from 'inquirer';

export function registerInitCommand(program) {
    program
        .command('init')
        .description('Generate .deadkillerrc.json secara interaktif')
        .option('-f, --force', 'Timpa file konfigurasi jika sudah ada')
        .action(initCommand);
}

/**
 * Command 'init': Generate .deadkillerrc.json secara interaktif
 */
export async function initCommand(options) {
    const cwd = process.cwd();
    const configPath = path.join(cwd, '.deadkillerrc.json');

    console.log(chalk.bold.cyan('\n=== Inisialisasi Konfigurasi DeadKiller ===\n'));

    if (await fs.pathExists(configPath)) {
        if (!options.force) {
            console.log(chalk.yellow(`\u26A0\uFE0F File konfigurasi sudah ada di: ${configPath}`));
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
            message: 'Daftar nama variabel yang harus selalu diabaikan (pisahkan dengan koma):',
            default: '^_, dummy'
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
            message: 'Apakah file proyek ini adalah library? (Jika Ya, semua exported function/variable tidak akan ditandai mati)',
            default: false
        }
    ]);

    const config = {
        frameworkMode: answers.frameworkMode,
        ignoreVariables: answers.ignoreVariables.split(',').map(s => s.trim()).filter(Boolean),
        ignoreFiles: answers.ignoreFiles.split(',').map(s => s.trim()).filter(Boolean),
        preserveExports: answers.preserveExports ? 'strict' : false, // menggunakan 'strict' untuk fitur analisis cross-file
        unusedThresholds: {
            variables: "warn",
            functions: "error",
            classes: "warn"
        }
    };

    try {
        await fs.writeJSON(configPath, config, { spaces: 2 });
        console.log(chalk.green(`\n\u2714\uFE0F Berhasil membuat ${chalk.bold('.deadkillerrc.json')}`));
        console.log(chalk.gray(`\nIsi konfigurasi:`));
        console.log(chalk.gray(JSON.stringify(config, null, 2)));
        console.log(`\nSekarang Anda bisa menjalankan ${chalk.cyan('deadkiller scan')} dengan aman!\n`);
    } catch (err) {
        console.error(chalk.red(`\n\u2716\uFE0F Gagal menulis konfigurasi: ${err.message}`));
    }
}
