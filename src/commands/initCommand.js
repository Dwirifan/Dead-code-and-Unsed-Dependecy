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
    const configPathJS = path.join(cwd, 'deadkiller.config.mjs');
    const legacyConfigPathJS = path.join(cwd, 'deadkiller.config.js');
    const configPathJSON = path.join(cwd, '.deadkillerrc.json');

    console.log(chalk.bold.cyan('\n=== Inisialisasi Konfigurasi DeadKiller ===\n'));

    const jsExists =
        await fs.pathExists(configPathJS) ||
        await fs.pathExists(legacyConfigPathJS);
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
            default: '^_'
        },
        {
            type: 'input',
            name: 'preserveFiles',
            message: 'Pola file/folder yang tidak boleh dihapus/aman dari modifikasi (contoh: *.test.js, __tests__):',
            default: 'test/**, tests/**, __tests__/**, **/*.test.*, **/*.spec.*'
        },
        {
            type: 'input',
            name: 'ignoreFiles',
            message: 'Folder/path yang TIDAK dibaca sama sekali, termasuk untuk bukti dependency (contoh: dist, build, coverage; jangan masukkan test di sini):',
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
            message: 'Entry point tambahan (pisahkan dengan koma). Kosongkan agar runtime, test runner, dan config dideteksi otomatis:',
            default: ''
        }
    ]);

    const preserveFilesArray = answers.preserveFiles.split(',').map(s => s.trim()).filter(Boolean);
    const ignoreFilesArray = answers.ignoreFiles.split(',').map(s => s.trim()).filter(Boolean);
    const additionalEntryPoints = answers.entryPoints
        ? answers.entryPoints.split(',').map(s => s.trim()).filter(Boolean)
        : [];
    let entryPointsArray = [];

    console.log(chalk.gray(`\n[>] Mendeteksi runtime, test, config, dan entry tambahan...`));
    try {
        // Import dinamis untuk menghindari dependency circle atau error loading awal
        const {
            classifyEntryPoint,
            findEntryPoints,
        } = await import('../analyzer/graph/entryPointFinder.js');
        const discoveryRules = {
            rules: {
                entryPoints: additionalEntryPoints,
                ignoreFiles: ignoreFilesArray,
            },
        };
        const detected = await findEntryPoints(cwd, discoveryRules);

        if (detected && detected.length > 0) {
            const choices = detected.map(entry => {
                const relativePath = path.relative(cwd, entry).replace(/\\/g, '/');
                const kind = classifyEntryPoint(entry, cwd);
                return {
                    checked: true,
                    name: `[${kind}] ${relativePath}`,
                    value: relativePath,
                };
            });

            console.log(chalk.green(`    [v] Ditemukan ${choices.length} kandidat entry point.`));
            console.log(chalk.gray('        Semua kandidat dipilih secara default. Gunakan spasi untuk mengubah pilihan.'));

            const selection = await inquirer.prompt([
                {
                    type: 'checkbox',
                    name: 'entryPoints',
                    message: 'Pilih entry point yang akan dimasukkan ke graph:',
                    choices,
                    pageSize: 15,
                    loop: false,
                    validate: selected =>
                        selected.length > 0 || 'Pilih minimal satu entry point agar graph dapat dibangun.',
                },
            ]);
            entryPointsArray = selection.entryPoints;
            console.log(chalk.gray('        Test entry dibaca untuk dependency dan graph, lalu dilindungi oleh preserveFiles.'));
        } else {
            console.log(chalk.yellow(`    [!] Tidak ada entry point yang berhasil dideteksi.`));
        }
    } catch (e) {
        console.log(chalk.yellow(`    [!] Terjadi kesalahan saat deteksi otomatis: ${e.message}`));
        entryPointsArray = additionalEntryPoints;
    }

    const { configFormat } = await inquirer.prompt([
        {
            type: 'list',
            name: 'configFormat',
            message: 'Format file konfigurasi apa yang ingin Anda gunakan?',
            choices: [
                { name: 'JavaScript Dinamis (deadkiller.config.mjs)', value: 'js' },
                { name: 'JSON Statis (.deadkillerrc.json)', value: 'json' }
            ]
        }
    ]);

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
                files: [
                    'test/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
                    'tests/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
                    '__tests__/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
                    '**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'
                ],
                preserveExports: true
            }
        ]
    };

    try {
        if (configFormat === 'json') {
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
            console.log(chalk.green(`\n\u2714\uFE0F Berhasil membuat ${chalk.bold('deadkiller.config.mjs')}`));
        }

        console.log(`\nSekarang Anda bisa menjalankan ${chalk.cyan('deadkiller scan')} dengan konfigurasi baru!\n`);
    } catch (err) {
        console.error(chalk.red(`\n\u2716\uFE0F Gagal menulis konfigurasi: ${err.message}`));
    }
}
