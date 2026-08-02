import path from 'path';
import fs from 'fs-extra';
import glob from 'fast-glob';
import chalk from 'chalk';
import ora from 'ora';
import { spawn } from 'node:child_process';
import { generateMermaidGraph } from '../ui/graphVisualizer.js';
import { parseCode } from '../parser/astParser.js';
import { findDeadCode } from '../analyzer/deadcode/index.js';
import { analyzeProjectDependencies } from '../analyzer/dependency/dependencyReportService.js';
import { RuleEngine } from '../analyzer/ruleEngine.js';
import { SCRIPT_GLOB } from '../parser/supportedExtensions.js';
import { buildGraphWithInteractiveFallback, printConfigDiagnostics } from './commandHelpers.js';

export function createBrowserOpenInvocation(outputPath, platform = process.platform) {
    if (platform === 'darwin') return { executable: 'open', args: [outputPath] };
    if (platform === 'win32') return { executable: 'explorer.exe', args: [outputPath] };
    return { executable: 'xdg-open', args: [outputPath] };
}

export function openReportInBrowser(outputPath, spawnImpl = spawn) {
    const invocation = createBrowserOpenInvocation(outputPath);
    const child = spawnImpl(invocation.executable, invocation.args, {
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
        shell: false,
    });
    child.once?.('error', error => {
        console.warn(chalk.yellow(`[Warning] Browser tidak dapat dibuka otomatis: ${error.message}`));
    });
    child.unref?.();
    return child;
}

/**
 * Mendaftarkan perintah `visualize` ke instance Commander yang diberikan.
 * @param {import('commander').Command} program
 */
export function registerVisualizeCommand(program) {
    program
        .command('visualize')
        .argument('<path>', 'Path to project directory')
        .option('--no-open', 'Buat dashboard tanpa membuka browser otomatis')
        .description('Analisis proyek dan buka HTML Dashboard keterlacakan kode (termasuk laporan dead code)')
        .action(async (targetPath, options) => {
            const absolutePath = path.resolve(targetPath);
            if (!fs.existsSync(absolutePath)) {
                console.error(`[ERROR] Path '${absolutePath}' tidak ditemukan.`);
                process.exit(1);
            }

            console.log(`\n[>] Menganalisis proyek untuk Traceability di: ${chalk.cyan(absolutePath)}`);
            const spinner = ora('Menambang struktur dan membangun Interactive HTML Map...').start();

            try {
                const ruleEngine = new RuleEngine();
                await ruleEngine.loadConfig(absolutePath);
                printConfigDiagnostics(ruleEngine);
                const graph = await buildGraphWithInteractiveFallback(absolutePath, ruleEngine, spinner);

                const pkgPath = path.join(absolutePath, 'package.json');
                let pkgData = { dependencies: {}, devDependencies: {} };
                if (fs.existsSync(pkgPath)) pkgData = await fs.readJson(pkgPath);

                let dependencyReport;
                try {
                    dependencyReport = await analyzeProjectDependencies(absolutePath, graph, ruleEngine);
                } catch (err) {
                    dependencyReport = {
                        unused: [],
                        deadDevDeps: [],
                        uncertain: Object.keys(pkgData.dependencies || {}),
                        uncertainDevDeps: Object.keys(pkgData.devDependencies || {}),
                        diagnostics: [{ message: err.message }],
                        analysisComplete: false,
                        safety: { reasons: [`Analisis dependency gagal: ${err.message}`] }
                    };
                }

                // === Kumpulkan data Dead Code untuk ditampilkan di dashboard ===
                const allDeadNodes = [];
                const allFiles = (await glob([SCRIPT_GLOB], {
                    cwd: absolutePath,
                    ignore: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '*.config.*', '.*.js', '.*.mjs', '.*.ts'],
                    absolute: true
                })).map(f => path.resolve(f));
                const preservedFiles = allFiles.filter(f => ruleEngine.isPreservedFile(f, absolutePath));
                const filesToAnalyze = new Set([...graph.liveFiles, ...preservedFiles]);

                for (const file of filesToAnalyze) {
                    const ext = path.extname(file);
                    if (ext === '.json' || ext === '.css' || ext === '.scss' || ext === '.sass' || ext === '.less' || file.includes('node_modules')) continue;
                    if (ruleEngine.isIgnoredFile(file, absolutePath)) continue;
                    try {
                        const code = await fs.readFile(file, 'utf-8');
                        const ast = await parseCode(code, file);
                        const deadNodes = findDeadCode(ast, file, graph.globalRegistry, ruleEngine);
                        const protectedFile = ruleEngine.isPreservedFile(file, absolutePath);
                        deadNodes.forEach(n => allDeadNodes.push({
                            file: path.relative(absolutePath, file),
                            ...n,
                            protected: protectedFile,
                        }));
                    } catch (err) {
                        if (process.env.DEBUG) console.warn(`[Warning] Gagal mem-parse ${file} saat membuat visualisasi:`, err.message);
                    }
                }

                // Dead files
                const deadFiles = allFiles
                    .filter(f => !graph.liveFiles.has(f))
                    .filter(f => !ruleEngine.isIgnoredFile(f, absolutePath))
                    .filter(f => !ruleEngine.isPreservedFile(f, absolutePath))
                    .map(f => path.relative(absolutePath, f));

                // Data report untuk dashboard
                const reportData = {
                    safeNodes: allDeadNodes.filter(n => n.status === 'safe' && !n.protected),
                    reviewNodes: allDeadNodes.filter(n => n.status === 'review' && !n.protected),
                    riskyNodes: allDeadNodes.filter(n => n.status === 'risky' && !n.protected),
                    protectedNodes: allDeadNodes.filter(n => n.protected),
                    deadFiles,
                    unsafeFiles: graph.unsafeFiles ? [...graph.unsafeFiles].map(f => path.relative(absolutePath, f)) : [],
                    dependencyReport
                };

                const htmlContent = generateMermaidGraph(graph, absolutePath, pkgData, reportData);
                const outputPath = path.join(absolutePath, 'code-structure-trace.html');
                await fs.writeFile(outputPath, htmlContent);

                spinner.succeed(`Berhasil! Dashboard dibuat: ${outputPath}`);

                if (options.open) {
                    openReportInBrowser(outputPath);
                    console.log(chalk.green('   [web] Browser akan terbuka untuk menampilkan Dashboard.'));
                } else {
                    console.log(chalk.gray('   [web] Browser tidak dibuka karena --no-open.'));
                }
            } catch (err) {
                spinner.fail('Visualisasi gagal');
                console.error(err.message);
                process.exit(1);
            }
        });
}
