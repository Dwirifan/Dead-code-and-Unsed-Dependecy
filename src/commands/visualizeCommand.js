import path from 'path';
import fs from 'fs-extra';
import glob from 'fast-glob';
import chalk from 'chalk';
import ora from 'ora';
import { generateMermaidGraph } from '../ui/graphVisualizer.js';
import { parseCode } from '../parser/astParser.js';
import { findDeadCode } from '../analyzer/deadcode/index.js';
import { analyzeProjectDependencies } from '../analyzer/dependency/dependencyReportService.js';
import { RuleEngine } from '../analyzer/ruleEngine.js';
import { SCRIPT_GLOB } from '../parser/supportedExtensions.js';
import { buildGraphWithInteractiveFallback, printConfigDiagnostics } from './commandHelpers.js';

/**
 * Mendaftarkan perintah `visualize` ke instance Commander yang diberikan.
 * @param {import('commander').Command} program
 */
export function registerVisualizeCommand(program) {
    program
        .command('visualize')
        .argument('<path>', 'Path to project directory')
        .description('Analisis proyek dan buka HTML Dashboard keterlacakan kode (termasuk laporan dead code)')
        .action(async (targetPath) => {
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
                for (const file of graph.liveFiles) {
                    const ext = path.extname(file);
                    if (ext === '.json' || ext === '.css' || ext === '.scss' || ext === '.sass' || ext === '.less' || file.includes('node_modules')) continue;
                    try {
                        const code = await fs.readFile(file, 'utf-8');
                        const ast = await parseCode(code, file);
                        const deadNodes = findDeadCode(ast, file, graph.globalRegistry, ruleEngine);
                        deadNodes.forEach(n => allDeadNodes.push({ file: path.relative(absolutePath, file), ...n }));
                    } catch (err) {
                        if (process.env.DEBUG) console.warn(`[Warning] Gagal mem-parse ${file} saat membuat visualisasi:`, err.message);
                    }
                }

                // Dead files
                const allFiles = (await glob([SCRIPT_GLOB], {
                    cwd: absolutePath,
                    ignore: ['**/node_modules/**', '**/dist/**', '**/test/**', '**/tests/**', '**/coverage/**', '*.config.*', '.*.js', '.*.mjs', '.*.ts'],
                    absolute: true
                })).map(f => path.resolve(f));

                const deadFiles = allFiles
                    .filter(f => !graph.liveFiles.has(f))
                    .filter(f => !ruleEngine.isIgnoredFile(f, absolutePath))
                    .map(f => path.relative(absolutePath, f));

                // Data report untuk dashboard
                const reportData = {
                    safeNodes: allDeadNodes.filter(n => n.status === 'safe'),
                    reviewNodes: allDeadNodes.filter(n => n.status === 'review'),
                    riskyNodes: allDeadNodes.filter(n => n.status === 'risky'),
                    deadFiles,
                    unsafeFiles: graph.unsafeFiles ? [...graph.unsafeFiles].map(f => path.relative(absolutePath, f)) : [],
                    dependencyReport
                };

                const htmlContent = generateMermaidGraph(graph, absolutePath, pkgData, reportData);
                const outputPath = path.join(absolutePath, 'code-structure-trace.html');
                await fs.writeFile(outputPath, htmlContent);

                spinner.succeed(`Berhasil! Dashboard dibuat: ${outputPath}`);

                // Buka di browser default
                const { exec } = await import('child_process');
                const cmd = process.platform === 'darwin'
                    ? `open "${outputPath}"`
                    : process.platform === 'win32'
                        ? `start "" "${outputPath}"`
                        : `xdg-open "${outputPath}"`;
                exec(cmd);

                console.log(chalk.green('   [web] Browser akan terbuka untuk menampilkan Dashboard.'));
            } catch (err) {
                spinner.fail('Visualisasi gagal');
                console.error(err.message);
                process.exit(1);
            }
        });
}
