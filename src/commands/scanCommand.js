import path from 'path';
import fs from 'fs-extra';
import glob from 'fast-glob';
import chalk from 'chalk';
import ora from 'ora';
import { performance } from 'perf_hooks';
import { parseCode } from '../parser/astParser.js';
import { findDeadCode } from '../analyzer/deadcode/deadCodeAnalyzer.js';
import { findUnusedDependencies } from '../analyzer/dependency/dependencyAnalyzer.js';
import { RuleEngine } from '../analyzer/ruleEngine.js';
import { buildGraphWithInteractiveFallback } from './commandHelpers.js';

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
                graph = await buildGraphWithInteractiveFallback(absolutePath, ruleEngine, spinner);
            } catch (err) {
                if (spinner) spinner.fail('Gagal membangun struktur graf proyek!');
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

            // Dead code di live files — dikategorisasi berdasarkan tipe
            const scanSpinner = ora('Melacak Dead Code di seluruh File Aktif...').start();

            const allDeadNodes = []; // { file, node }
            for (const file of graph.liveFiles) {
                // Skip file JSON dan node_modules (tidak bisa di-parse sebagai JS/TS)
                const ext = path.extname(file);
                if (ext === '.json' || file.includes('node_modules')) continue;

                try {
                    const code     = await fs.readFile(file, 'utf-8');
                    const ast      = parseCode(code);
                    const deadNodes = findDeadCode(ast, file, graph.globalRegistry, ruleEngine);
                    deadNodes.forEach(n => allDeadNodes.push({ file, ...n }));
                } catch (err) {
                    console.warn(chalk.yellow(`   [!] Gagal parse: ${path.relative(absolutePath, file)}: ${err.message}`));
                }
            }
            scanSpinner.stop();

            // Kategorisasi berdasarkan tipe
            const categories = {
                'Variable':             { label: '[Unused Variables]',        color: chalk.red,     severity: 'high',   items: [] },
                'Function':             { label: '[Unused Functions]',        color: chalk.red,     severity: 'high',   items: [] },
                'Import':               { label: '[Unused Imports]',          color: chalk.red,     severity: 'high',   items: [] },
                'Parameter':            { label: '[Unused Parameters]',       color: chalk.yellow,  severity: 'low',    items: [] },
                'UnreachableBranch':     { label: '[Unreachable Code]',        color: chalk.magenta, severity: 'medium', items: [] },
                'DuplicateCondition':   { label: '[Duplicate Conditions]',    color: chalk.magenta, severity: 'medium', items: [] },
            };
            const otherItems = [];

            for (const node of allDeadNodes) {
                const cat = categories[node.type];
                if (cat) {
                    cat.items.push(node);
                } else {
                    otherItems.push(node);
                }
            }

            // Output per kategori
            let printedAny = false;
            for (const [, cat] of Object.entries(categories)) {
                if (cat.items.length === 0) continue;
                printedAny = true;
                const severityBadge = cat.severity === 'high' ? chalk.bgRed.white(` ${cat.severity.toUpperCase()} `) :
                                      cat.severity === 'medium' ? chalk.bgYellow.black(` ${cat.severity.toUpperCase()} `) :
                                      chalk.bgGray.white(` ${cat.severity.toUpperCase()} `);
                console.log(`\n${cat.color(cat.label)} ${severityBadge}`);
                // Group by file
                const byFile = {};
                cat.items.forEach(n => {
                    const rel = path.relative(absolutePath, n.file);
                    if (!byFile[rel]) byFile[rel] = [];
                    byFile[rel].push(n);
                });
                for (const [file, nodes] of Object.entries(byFile)) {
                    console.log(`   -> ${file}`);
                    nodes.forEach(n => console.log(`      Line ${n.line}: '${n.name}'`));
                }
                totalIssues += cat.items.length;
            }
            if (otherItems.length > 0) {
                printedAny = true;
                console.log(`\n${chalk.gray('[Other]')}`);
                otherItems.forEach(n => {
                    console.log(`   -> ${path.relative(absolutePath, n.file)} Line ${n.line}: ${n.type} '${n.name}'`);
                });
                totalIssues += otherItems.length;
            }
            if (!printedAny) console.log('\n   [ok] Tidak ada dead code yang tertinggal!');

            console.log(`\n[t] Analysis Time: ${(performance.now() - startTime).toFixed(2)} ms`);
        });
}
