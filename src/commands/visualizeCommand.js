import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';
import ora from 'ora';
import { buildProjectGraph } from '../analyzer/projectGraph.js';
import { generateMermaidGraph } from '../analyzer/graphVisualizer.js';

/**
 * Mendaftarkan perintah `visualize` ke instance Commander yang diberikan.
 * @param {import('commander').Command} program
 */
export function registerVisualizeCommand(program) {
    program
        .command('visualize')
        .argument('<path>', 'Path to project directory')
        .description('Analisis proyek dan buka HTML Dashboard keterlacakan kode')
        .action(async (targetPath) => {
            const absolutePath = path.resolve(targetPath);
            if (!fs.existsSync(absolutePath)) {
                console.error(`[ERROR] Path '${absolutePath}' tidak ditemukan.`);
                process.exit(1);
            }

            console.log(`\n[>] Menganalisis proyek untuk Traceability di: ${chalk.cyan(absolutePath)}`);
            const spinner = ora('Menambang struktur dan membangun Interactive HTML Map...').start();

            try {
                const graph = await buildProjectGraph(absolutePath);

                const pkgPath = path.join(absolutePath, 'package.json');
                let pkgData   = { dependencies: {}, devDependencies: {} };
                if (fs.existsSync(pkgPath)) pkgData = await fs.readJson(pkgPath);

                const htmlContent = generateMermaidGraph(graph, absolutePath, pkgData);
                const outputPath  = path.join(absolutePath, 'code-structure-trace.html');
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
