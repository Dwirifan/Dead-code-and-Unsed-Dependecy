import inquirer from 'inquirer';
import chalk from 'chalk';
import { buildProjectGraph } from '../analyzer/projectGraph.js';

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
            
            console.log(chalk.green('\n[v] Konfigurasi diselamatkan di .deadkillerrc.json!\n'));
            if (spinner) spinner.start('Melanjutkan Membangun Graph...');
            
            return await buildProjectGraph(absolutePath, ruleEngine);
        } else {
            throw err;
        }
    }
}
