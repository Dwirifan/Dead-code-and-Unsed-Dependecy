import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'node:path';
import { buildProjectGraph } from '../analyzer/graph/projectGraph.js';

/**
 * Mencari root konfigurasi terdekat agar perintah file tunggal memakai aturan
 * yang sama dengan scan proyek penuh.
 */
export async function findProjectRoot(startDirectory, { ignoreConfig = false } = {}) {
    let current = path.resolve(startDirectory);
    const rootMarkers = ignoreConfig
        ? ['package.json']
        : [
            'deadkiller.config.js',
            'deadkiller.config.mjs',
            '.deadkillerrc.json',
            'package.json',
        ];

    while (true) {
        for (const marker of rootMarkers) {
            if (await fs.pathExists(path.join(current, marker))) return current;
        }
        const parent = path.dirname(current);
        if (parent === current) return path.resolve(startDirectory);
        current = parent;
    }
}

/**
 * Menampilkan warning normalisasi config tanpa mencemari output JSON.
 */
export function printConfigDiagnostics(ruleEngine, { silent = false } = {}) {
    if (silent) return;

    if (ruleEngine.configSource === 'auto' && ruleEngine.autoProfile) {
        const ignoredConfig = ruleEngine.configPolicy === 'none' && ruleEngine.ignoredConfigPaths?.length > 0;
        console.log(chalk.cyan(ignoredConfig
            ? '\n[i] Konfigurasi target diabaikan oleh --no-config; DeadKiller memakai profil otomatis.'
            : '\n[i] Tidak ada konfigurasi; DeadKiller memakai profil otomatis (tanpa menulis file).'));
    }

    const warnings = (ruleEngine.configDiagnostics || [])
        .filter(item => item.level === 'warning');
    if (warnings.length === 0) return;

    console.log(chalk.yellow('\n[!] Peringatan konfigurasi DeadKiller:'));
    for (const item of warnings) {
        console.log(chalk.gray(`   - ${item.path}: ${item.message} (${item.code})`));
    }
}

/**
 * Membangun Project Graph dengan fallback prompt interaktif
 * jika Entry Point tidak ditemukan.
 */
export async function buildGraphWithInteractiveFallback(
    absolutePath,
    ruleEngine,
    spinner,
    { interactive = true } = {},
) {
    try {
        return await buildProjectGraph(absolutePath, ruleEngine);
    } catch (err) {
        if (err.message.includes('Could not auto-detect entry point')) {
            if (!interactive) throw err;
            if (spinner) spinner.stop();
            
            console.log(chalk.yellow('\n[!] Kami tidak dapat mendeteksi file utama proyek Anda (Entry Point) secara otomatis.'));
            console.log(chalk.gray('    Contoh jawaban: src/index.js, pages/, app/**/*.jsx, bin/\n'));
            
            const { entryPointsInput } = await inquirer.prompt([{
                type: 'input',
                name: 'entryPointsInput',
                message: 'Masukkan letak file utama atau direktori proyek (pisahkan koma jika > 1):',
                default: 'src/index.js'
            }]);

            const entryPointsArray = entryPointsInput.split(',').map(s => s.trim()).filter(Boolean);
            
            // Entry point manual hanya berlaku untuk proses saat ini. Perintah
            // analisis tidak boleh membuat atau mengubah konfigurasi target.
            ruleEngine.rules.entryPoints = entryPointsArray;

            console.log(chalk.green('\n[v] Entry point diterapkan sementara untuk analisis ini.'));
            console.log(chalk.gray('    Jalankan `deadkiller init` jika ingin menyimpannya sebagai konfigurasi proyek.\n'));
            if (spinner) spinner.start('Melanjutkan Membangun Graph...');
            
            return await buildProjectGraph(absolutePath, ruleEngine);
        } else {
            throw err;
        }
    }
}
