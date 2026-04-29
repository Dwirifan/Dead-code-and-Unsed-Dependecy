import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';
import ora from 'ora';
import { buildProjectGraph } from '../analyzer/projectGraph.js';
import { RuleEngine } from '../analyzer/ruleEngine.js';
import { findUnusedDependencies } from '../analyzer/dependency/dependencyAnalyzer.js';

/**
 * Mendaftarkan perintah `show-deps` ke instance Commander yang diberikan.
 * @param {import('commander').Command} program
 */
export function registerShowDepsCommand(program) {
    program
        .command('show-deps')
        .argument('<path>', 'Path to project directory')
        .description('Tampilkan daftar dependencies dan devDependencies dari package.json (beserta penanda Unused)')
        .action(async (targetPath) => {
            const absolutePath = path.resolve(targetPath);
            const pkgPath      = path.join(absolutePath, 'package.json');

            if (!fs.existsSync(pkgPath)) {
                console.error(`[ERROR] 'package.json' tidak ditemukan di '${absolutePath}'.`);
                process.exit(1);
            }

            try {
                const pkg = await fs.readJson(pkgPath);

                const spinner = ora('Memetakan graph ketergantungan...').start();
                let unusedDeps = new Set();
                try {
                    const ruleEngine = new RuleEngine();
                    await ruleEngine.loadConfig(absolutePath);
                    const graph = await buildProjectGraph(absolutePath, ruleEngine);
                    const depReport = await findUnusedDependencies(absolutePath, graph.usedPackages);
                    unusedDeps = new Set(depReport.unused);
                    spinner.succeed('Analisis selesai.');
                } catch (err) {
                    spinner.fail(`Analisis unused graph gagal: ${err.message}. Tetap menampilkan list.`);
                }

                console.log(`\n[+] Dependencies mapped for: ${chalk.cyan(pkg.name || path.basename(absolutePath))}\n`);

                const printDep = (dep, ver) => {
                    if (unusedDeps.has(dep)) {
                        console.log(`  ${chalk.red(dep)}: ${chalk.gray(ver)}  ${chalk.bgRed.white(' UNUSED ')}`);
                    } else {
                        console.log(`  ${chalk.white(dep)}: ${chalk.gray(ver)}`);
                    }
                };

                if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
                    console.log(chalk.bold.green('=== Dependencies ==='));
                    for (const [dep, ver] of Object.entries(pkg.dependencies)) {
                        printDep(dep, ver);
                    }
                    console.log();
                } else {
                    console.log(chalk.gray('No standard dependencies found.\n'));
                }

                if (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0) {
                    console.log(chalk.bold.yellow('=== devDependencies (Build Tools — tidak dianalisis) ==='));
                    for (const [dep, ver] of Object.entries(pkg.devDependencies)) {
                        console.log(`  ${chalk.white(dep)}: ${chalk.gray(ver)}`);
                    }
                    console.log(chalk.gray('  ℹ  devDependencies tidak dianalisis karena dipanggil via CLI/config, bukan import.\n'));
                } else {
                    console.log(chalk.gray('No devDependencies found.\n'));
                }
            } catch (err) {
                console.error(`[ERROR] Gagal membaca package.json: ${err.message}`);
                process.exit(1);
            }
        });
}
