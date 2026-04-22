import path from 'path';
import fs from 'fs-extra';
import glob from 'fast-glob';
import chalk from 'chalk';
import ora from 'ora';
import { performance } from 'perf_hooks';
import { parseCode } from '../parser/astParser.js';
import { findDeadCode } from '../analyzer/deadcode/deadCodeAnalyzer.js';
import { buildProjectGraph } from '../analyzer/projectGraph.js';
import { findUnusedDependencies } from '../analyzer/dependency/dependencyAnalyzer.js';
import { RuleEngine } from '../analyzer/ruleEngine.js';

/**
 * Mendaftarkan perintah `scan` ke instance Commander yang diberikan.
 * @param {import('commander').Command} program
 */
export function registerScanCommand(program) {
    program
        .command('scan')
        .argument('<path>', 'Path ke file tunggal atau direktori proyek')
        .description('Pindai dead code dan dependensi tidak terpakai tanpa mengubah file')
        .action(async (targetPath) => {
            const absolutePath = path.resolve(targetPath);
            if (!fs.existsSync(absolutePath)) {
                console.error(`[ERROR] Path '${absolutePath}' tidak ditemukan.`);
                process.exit(1);
            }

            const startTime = performance.now();
            const stats = await fs.stat(absolutePath);

            // --- MODE SATU FILE ---
            if (stats.isFile()) {
                console.log(`\n[>] Scanning file tunggal: ${path.basename(absolutePath)}`);
                try {
                    const code     = await fs.readFile(absolutePath, 'utf-8');
                    const ast      = parseCode(code);
                    const deadNodes = findDeadCode(ast);

                    if (deadNodes.length > 0) {
                        console.log(`\n[!] Dead Code ditemukan:`);
                        console.log(`   -> ${path.relative(process.cwd(), absolutePath)}`);
                        deadNodes.forEach(n => console.log(`      Line ${n.line}: ${n.type} '${n.name}'`));
                        console.log(`\n[x] ${deadNodes.length} masalah ditemukan.`);
                    } else {
                        console.log('\n[ok] Tidak ada dead code pada file ini.');
                    }
                } catch (err) {
                    console.error('[ERROR] Analisis gagal:', err.message);
                    process.exit(1);
                }
                return;
            }

            // --- MODE DIREKTORI ---
            console.log(`\n[>] Menganalisis proyek di: ${chalk.cyan(absolutePath)}`);
            const spinner    = ora('Membangun Graph Ketergantungan (Reachability Analysis)...').start();
            const ruleEngine = new RuleEngine();
            await ruleEngine.loadConfig(absolutePath);

            let graph;
            try {
                graph = await buildProjectGraph(absolutePath);
            } catch (err) {
                spinner.fail('Gagal membangun struktur graf proyek!');
                console.error(err.message);
                process.exit(1);
            }
            spinner.succeed(`Graf terbentuk: ${graph.liveFiles.size} File Aktif dipetakan.`);

            // Dependensi tidak terpakai — dianalisis oleh modul dependencyAnalyzer
            try {
                const depReport = await findUnusedDependencies(absolutePath, graph.usedPackages);
                if (depReport.unused.length > 0) {
                    console.log(`\n[+] [Unused Dependencies] (${depReport.totalUnused} dari ${depReport.totalDeclared}):`);
                    depReport.unused.forEach(d => console.log(`   - ${d}`));
                } else {
                    console.log('[+] [Dependencies]: Clean');
                }
            } catch (_) {
                // package.json tidak ditemukan — lewati analisis dependensi
            }

            // Dead files — normalisasi path glob ke format OS lokal
            const allFiles = (await glob(['**/*.{js,jsx,mjs,cjs,ts,tsx,mts}'], {
                cwd: absolutePath,
                ignore: ['node_modules/**', 'dist/**', 'test/**', 'tests/**', 'coverage/**'],
                absolute: true
            })).map(f => path.resolve(f));

            const deadFiles = allFiles
                .filter(f => !graph.liveFiles.has(f))
                .filter(f => !ruleEngine.isIgnoredFile(f, absolutePath));

            let totalIssues = 0;
            if (deadFiles.length > 0) {
                console.log('\n[~] [Unreachable / Dead Files]:');
                deadFiles.forEach(f => console.log(`   - ${path.relative(absolutePath, f)}`));
                totalIssues += deadFiles.length;
            }

            // Dead code di live files
            const scanSpinner = ora('Melacak Dead Code di seluruh File Aktif...').start();
            console.log('\n[*] [Dead Code Scanning (Live Files Only)]:');

            for (const file of graph.liveFiles) {
                try {
                    const code     = await fs.readFile(file, 'utf-8');
                    const ast      = parseCode(code);
                    const deadNodes = findDeadCode(ast, file, graph.globalRegistry, ruleEngine);

                    if (deadNodes.length > 0) {
                        console.log(`   -> ${path.relative(absolutePath, file)}`);
                        deadNodes.forEach(n => console.log(`      Line ${n.line}: ${n.type} '${n.name}'`));
                        totalIssues += deadNodes.length;
                    }
                } catch (err) {
                    console.warn(chalk.yellow(`   [!] Gagal parse: ${path.relative(absolutePath, file)}: ${err.message}`));
                }
            }

            scanSpinner.stop();
            if (totalIssues === 0) console.log('   [ok] Tidak ada dead code yang tertinggal!');

            console.log(`\n[t] Analysis Time: ${(performance.now() - startTime).toFixed(2)} ms`);
        });
}
