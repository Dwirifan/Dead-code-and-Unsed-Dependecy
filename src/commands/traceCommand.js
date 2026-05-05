import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';
import ora from 'ora';
import { RuleEngine } from '../analyzer/ruleEngine.js';
import { buildGraphWithInteractiveFallback } from './commandHelpers.js';

/**
 * Mendaftarkan perintah `trace` ke instance Commander yang diberikan.
 * Perintah ini menjawab pertanyaan: "Siapa yang mengimport file X?"
 * 
 * Menggunakan data `graph.edges` yang sudah dikumpulkan oleh BFS projectGraph
 * untuk membangun peta reverse-dependency (siapa yang bergantung pada siapa).
 * 
 * @param {import('commander').Command} program
 */
export function registerTraceCommand(program) {
    program
        .command('trace')
        .argument('<file>', 'Path ke file yang ingin dilacak importernya')
        .description('Lacak siapa saja yang mengimport file tertentu (Reverse Dependency Trace)')
        .action(async (filePath) => {
            const absoluteFile = path.resolve(filePath);
            if (!fs.existsSync(absoluteFile)) {
                console.error(chalk.red(`[ERROR] File '${absoluteFile}' tidak ditemukan.`));
                process.exit(1);
            }

            // Tentukan project root (naik ke atas sampai ketemu package.json)
            let projectRoot = path.dirname(absoluteFile);
            while (projectRoot !== path.parse(projectRoot).root) {
                if (fs.existsSync(path.join(projectRoot, 'package.json'))) break;
                projectRoot = path.dirname(projectRoot);
            }

            if (!fs.existsSync(path.join(projectRoot, 'package.json'))) {
                console.error(chalk.red('[ERROR] Tidak menemukan package.json di direktori mana pun ke atas.'));
                process.exit(1);
            }

            console.log(chalk.cyan(`\n[>] Reverse Trace: siapa yang mengimport ${chalk.bold(path.relative(projectRoot, absoluteFile))}?`));
            const spinner = ora('Membangun graf proyek...').start();

            const ruleEngine = new RuleEngine();
            await ruleEngine.loadConfig(projectRoot);

            let graph;
            try {
                graph = await buildGraphWithInteractiveFallback(projectRoot, ruleEngine, spinner);
            } catch (err) {
                spinner.fail(err.message);
                process.exit(1);
            }
            spinner.succeed(`Graf terbentuk: ${graph.liveFiles.size} file dipetakan.`);

            // Bangun reverse map dari edges
            // graph.edges = [{ from, to, names }]
            // "from" mengimport "to" → kita cari semua edge yang "to" === targetFile
            const importers = graph.edges.filter(edge => edge.to === absoluteFile);

            const relTarget = path.relative(projectRoot, absoluteFile);

            if (importers.length === 0) {
                console.log(chalk.yellow(`\n[!] Tidak ada file yang mengimport ${chalk.bold(relTarget)}.`));

                // Cek apakah file ini adalah entry point
                if (graph.liveFiles.has(absoluteFile)) {
                    console.log(chalk.gray('    File ini mungkin adalah Entry Point (titik masuk utama).'));
                } else {
                    console.log(chalk.red('    File ini TIDAK terjangkau oleh entry point. Kemungkinan Dead File.'));
                }
            } else {
                console.log(chalk.green(`\n[ok] ${importers.length} file mengimport ${chalk.bold(relTarget)}:\n`));

                // Tampilkan sebagai tree
                importers.forEach((edge, i) => {
                    const relFrom = path.relative(projectRoot, edge.from);
                    const isLast = i === importers.length - 1;
                    const prefix = isLast ? '  └── ' : '  ├── ';
                    const names = edge.names && edge.names.length > 0
                        ? chalk.gray(` (imports: ${edge.names.join(', ')})`)
                        : '';
                    console.log(`${prefix}${chalk.white(relFrom)}${names}`);
                });

                // Tampilkan juga: file apa saja yang diimport OLEH file target
                const exports = graph.edges.filter(edge => edge.from === absoluteFile);
                if (exports.length > 0) {
                    console.log(chalk.cyan(`\n[>] File ini mengimport ${exports.length} file lain:`));
                    exports.forEach((edge, i) => {
                        const relTo = path.relative(projectRoot, edge.to);
                        const isLast = i === exports.length - 1;
                        const prefix = isLast ? '  └── ' : '  ├── ';
                        console.log(`${prefix}${chalk.gray(relTo)}`);
                    });
                }
            }

            console.log('');
        });
}
