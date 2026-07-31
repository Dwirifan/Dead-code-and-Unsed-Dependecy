import inquirer from 'inquirer';
import chalk from 'chalk';
import fs from 'fs-extra';
import path from 'node:path';
import { buildProjectGraph } from '../analyzer/graph/projectGraph.js';

/**
 * Mencari root konfigurasi terdekat agar perintah file tunggal memakai aturan
 * yang sama dengan scan proyek penuh.
 */
export async function findProjectRoot(startDirectory) {
    let current = path.resolve(startDirectory);
    const rootMarkers = [
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
export async function buildGraphWithInteractiveFallback(absolutePath, ruleEngine, spinner) {
    try {
        return await buildProjectGraph(absolutePath, ruleEngine);
    } catch (err) {
        if (err.message.includes('Could not auto-detect entry point')) {
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
            
            // Simpan ke konfigurasi lokal
            ruleEngine.rules.entryPoints = entryPointsArray;
            await ruleEngine.saveConfig(absolutePath);
            
            console.log(chalk.green('\n[v] Konfigurasi diselamatkan di deadkiller.config.js!\n'));
            if (spinner) spinner.start('Melanjutkan Membangun Graph...');
            
            return await buildProjectGraph(absolutePath, ruleEngine);
        } else {
            throw err;
        }
    }
}
