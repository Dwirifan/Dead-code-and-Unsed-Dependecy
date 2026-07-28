import path from 'path';
import fs from 'fs-extra';
import chalk from 'chalk';
import ora from 'ora';
import { buildProjectGraph } from '../analyzer/graph/projectGraph.js';
import { RuleEngine } from '../analyzer/ruleEngine.js';
import { analyzeProjectDependencies } from '../analyzer/dependency/dependencyReportService.js';

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
                let dependencyReport = null;
                let analysisError = null;
                try {
                    const ruleEngine = new RuleEngine();
                    await ruleEngine.loadConfig(absolutePath);
                    const graph = await buildProjectGraph(absolutePath, ruleEngine);
                    dependencyReport = await analyzeProjectDependencies(absolutePath, graph, ruleEngine);
                    spinner.succeed('Analisis selesai.');
                } catch (err) {
                    analysisError = err.message;
                    spinner.fail(`Analisis dependency gagal: ${err.message}. Semua status ditandai UNKNOWN.`);
                }

                console.log(`\n[+] Dependencies mapped for: ${chalk.cyan(pkg.name || path.basename(absolutePath))}\n`);

                const unusedDeps = new Set(dependencyReport?.unused || []);
                const uncertainDeps = new Set(dependencyReport?.uncertain || []);
                const deadDevDeps = new Set(dependencyReport?.deadDevDeps || []);
                const uncertainDevDeps = new Set(dependencyReport?.uncertainDevDeps || []);
                const findings = new Map((dependencyReport?.findings || []).map(item => [
                    `${item.section}:${item.dependency}`,
                    item
                ]));

                const removalCandidates = [];

                const printDep = (dep, ver, section = 'runtime') => {
                    const manifestSection = section === 'runtime' ? 'dependencies' : 'devDependencies';
                    const finding = findings.get(`${manifestSection}:${dep}`);
                    const isUnused = section === 'runtime' ? unusedDeps.has(dep) : deadDevDeps.has(dep);
                    const isUnknown = Boolean(analysisError) ||
                        finding?.status === 'unknown' ||
                        (section === 'runtime' ? uncertainDeps.has(dep) : uncertainDevDeps.has(dep));
                    
                    let badge;
                    let desc;
                    if (isUnknown) {
                        badge = chalk.bgYellow.black(' UNKNOWN ');
                        desc = 'Analisis tidak dapat memastikan penggunaan.';
                    } else if (isUnused) {
                        badge = chalk.bgRed.white(' REVIEW ');
                        desc = 'Tidak ditemukan referensi dalam source code.';
                        removalCandidates.push(dep);
                    } else if (finding?.status === 'ignored') {
                        badge = chalk.bgBlue.white(' PROTECTED ');
                        desc = 'Dependency diabaikan sesuai aturan konfigurasi.';
                    } else {
                        badge = chalk.bgGreen.black(section === 'runtime' ? ' USED ' : ' USED/PROTECTED ');
                        desc = 'Dependency aktif digunakan.';
                    }
                    console.log(`  ${chalk.white(dep.padEnd(35))} ${chalk.gray(ver.padEnd(10))} ${badge} ${chalk.dim(desc)}`);
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
                    console.log(chalk.bold.yellow('=== devDependencies (report-only) ==='));
                    for (const [dep, ver] of Object.entries(pkg.devDependencies)) {
                        printDep(dep, ver, 'development');
                    }
                    console.log(chalk.gray('  ℹ  Kandidat penghapusan akan diproses saat menjalankan `fix-deps`.\n'));
                } else {
                    console.log(chalk.gray('No devDependencies found.\n'));
                }

                if (removalCandidates.length > 0) {
                    console.log(chalk.red.bold(`(!) ${removalCandidates.length} potential unused dependencies identified. Run 'fix-deps' to remove them.\n`));
                }

                if (dependencyReport?.safety?.reasons?.length > 0) {
                    console.log(chalk.yellow('[?] Analisis dependency belum lengkap:'));
                    dependencyReport.safety.reasons.forEach(reason => console.log(chalk.gray(`   - ${reason}`)));
                }
                if (dependencyReport?.diagnostics?.length > 0) {
                    dependencyReport.diagnostics.forEach(item => {
                        const message = typeof item === 'string' ? item : item.message || JSON.stringify(item);
                        console.log(chalk.gray(`   - ${message}`));
                    });
                }
            } catch (err) {
                console.error(`[ERROR] Gagal membaca package.json: ${err.message}`);
                process.exit(1);
            }
        });
}

/**
 * Mengumpulkan kandidat dependensi yang bisa dihapus (dipakai oleh wizard).
 * @param {string} absolutePath
 * @returns {Promise<{runtimeCandidates: string[], devCandidates: string[]}>}
 */
export async function collectDepCandidates(absolutePath) {
    try {
        const ruleEngine = new RuleEngine();
        await ruleEngine.loadConfig(absolutePath);
        const graph  = await buildProjectGraph(absolutePath, ruleEngine);
        const report = await analyzeProjectDependencies(absolutePath, graph, ruleEngine);
        return {
            runtimeCandidates: report?.unused      || [],
            devCandidates:     report?.deadDevDeps || [],
        };
    } catch {
        return { runtimeCandidates: [], devCandidates: [] };
    }
}
