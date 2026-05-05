import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';
import { performance } from 'perf_hooks';
import { parseCode } from '../parser/astParser.js';
import { findDeadCode } from '../analyzer/deadcode/deadCodeAnalyzer.js';
import { RuleEngine } from '../analyzer/ruleEngine.js';
import { buildGraphWithInteractiveFallback } from './commandHelpers.js';

/**
 * Mendaftarkan perintah `watch` ke instance Commander yang diberikan.
 * Memantau perubahan file secara real-time dan menjalankan ulang analisis dead code
 * setiap kali file disimpan.
 * 
 * Menggunakan `fs.watch` (bawaan Node.js) agar tidak perlu install dependency tambahan.
 * 
 * @param {import('commander').Command} program
 */
export function registerWatchCommand(program) {
    program
        .command('watch')
        .argument('<path>', 'Path ke direktori proyek yang ingin dipantau')
        .description('Pantau perubahan file secara real-time dan jalankan analisis dead code otomatis')
        .action(async (targetPath) => {
            const absolutePath = path.resolve(targetPath);
            if (!fs.existsSync(absolutePath)) {
                console.error(chalk.red(`[ERROR] Path '${absolutePath}' tidak ditemukan.`));
                process.exit(1);
            }

            const stats = await fs.stat(absolutePath);
            if (!stats.isDirectory()) {
                console.error(chalk.red('[ERROR] Watch mode hanya mendukung direktori.'));
                process.exit(1);
            }

            console.log(chalk.cyan(`\n[>] Watch Mode: memantau ${chalk.bold(absolutePath)}`));
            console.log(chalk.gray('    Setiap kali file disimpan, analisis akan dijalankan ulang.'));
            console.log(chalk.gray('    Tekan Ctrl+C untuk berhenti.\n'));

            // Debounce: menunggu 500ms setelah perubahan terakhir sebelum menjalankan scan
            let debounceTimer = null;
            let isScanning = false;

            const WATCH_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.mts']);
            const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.deadkiller_backup', 'coverage']);

            // Fungsi utama: jalankan scan
            const runScan = async (changedFile) => {
                if (isScanning) return;
                isScanning = true;

                const startTime = performance.now();
                const relFile = changedFile ? path.relative(absolutePath, changedFile) : '(initial)';

                console.log(chalk.cyan(`\n${'─'.repeat(60)}`));
                console.log(chalk.cyan(`[>] Perubahan terdeteksi: ${chalk.bold(relFile)}`));
                console.log(chalk.cyan(`    Menjalankan analisis ulang...`));

                try {
                    const ruleEngine = new RuleEngine();
                    await ruleEngine.loadConfig(absolutePath);

                    const graph = await buildGraphWithInteractiveFallback(absolutePath, ruleEngine, null);

                    let totalIssues = 0;

                    // Analisis dead code di live files
                    for (const file of graph.liveFiles) {
                        const ext = path.extname(file);
                        if (!WATCH_EXTENSIONS.has(ext) || file.includes('node_modules')) continue;

                        try {
                            const code = await fs.readFile(file, 'utf-8');
                            const ast = parseCode(code, file);
                            const deadNodes = findDeadCode(ast, file, graph.globalRegistry, ruleEngine);

                            if (deadNodes.length > 0) {
                                const safeCount  = deadNodes.filter(n => n.status === 'safe').length;
                                const riskyCount = deadNodes.filter(n => n.status !== 'safe').length;
                                const rel = path.relative(absolutePath, file);

                                console.log(`   ${chalk.yellow('[!]')} ${rel}: ${chalk.green(`${safeCount} safe`)}, ${chalk.red(`${riskyCount} review/risky`)}`);
                                totalIssues += deadNodes.length;
                            }
                        } catch (_) { /* skip parse errors */ }
                    }

                    const elapsed = (performance.now() - startTime).toFixed(0);

                    if (totalIssues === 0) {
                        console.log(chalk.green(`   [ok] Bersih! Tidak ada dead code. (${elapsed} ms)`));
                    } else {
                        console.log(chalk.yellow(`\n   [!] ${totalIssues} total temuan. Gunakan 'deadkiller scan' untuk detail lengkap.`));
                        console.log(chalk.gray(`   [t] ${elapsed} ms`));
                    }
                } catch (err) {
                    console.error(chalk.red(`   [ERROR] ${err.message}`));
                }

                isScanning = false;
            };

            // Jalankan scan awal
            await runScan(null);

            // Setup recursive file watcher
            console.log(chalk.gray(`\n[~] Menunggu perubahan file...\n`));

            const watchDir = (dir) => {
                try {
                    fs.watch(dir, { recursive: true }, (eventType, filename) => {
                        if (!filename) return;

                        // Pastikan file yang berubah relevan
                        const ext = path.extname(filename);
                        if (!WATCH_EXTENSIONS.has(ext)) return;

                        // Skip direktori yang diabaikan
                        const parts = filename.split(path.sep);
                        if (parts.some(p => IGNORE_DIRS.has(p))) return;

                        // Debounce: tunggu 500ms setelah perubahan terakhir
                        if (debounceTimer) clearTimeout(debounceTimer);
                        debounceTimer = setTimeout(() => {
                            runScan(path.join(dir, filename));
                        }, 500);
                    });
                } catch (err) {
                    console.error(chalk.red(`[ERROR] Gagal memantau direktori: ${err.message}`));
                }
            };

            watchDir(absolutePath);

            // Jaga proses tetap hidup
            process.stdin.resume();
        });
}
