import path from 'path';
import fs from 'fs-extra';
import glob from 'fast-glob';
import chalk from 'chalk';
import ora from 'ora';
import { performance } from 'perf_hooks';
import { parseCode } from '../parser/astParser.js';
import { ParseCache } from '../parser/parseCache.js';
import { findDeadCode } from '../analyzer/deadcode/index.js';
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
        .option('--json', 'Output hasil analisis dalam format JSON (untuk integrasi CI/CD)')
        .option('-a, --advanced', 'Tampilkan hasil linter AST lanjutan (Undeclared Variables, Unused Methods, dll)')
        .description('Pindai dead code dan dependensi tidak terpakai tanpa mengubah file')
        .action(async (targetPath, options) => {
            const jsonMode = options.json || false;
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
                    const code = await fs.readFile(absolutePath, 'utf-8');
                    const ast = await parseCode(code, absolutePath);
                    const deadNodes = findDeadCode(ast);

                    if (jsonMode) {
                        const jsonResult = {
                            mode: 'single-file',
                            file: absolutePath,
                            deadCode: deadNodes.map(n => ({ name: n.name, type: n.type, line: n.line, confidence: n.confidence || 'medium', status: n.status || 'review', reason: n.reason || '' })),
                            totalIssues: deadNodes.length,
                            analysisTime: `${(performance.now() - startTime).toFixed(2)} ms`
                        };
                        console.log(JSON.stringify(jsonResult, null, 2));
                        return;
                    }

                    if (deadNodes.length > 0) {
                        const smellTypes = ['EmptyBlock', 'DuplicateCondition', 'ReactSmell', 'RedundantCode'];
                        const deadCodeNodes = deadNodes.filter(n => !smellTypes.includes(n.type));
                        const smellNodes = deadNodes.filter(n => smellTypes.includes(n.type));

                        if (deadCodeNodes.length > 0) {
                            console.log(chalk.bold.red(`\n[!] Temuan (Dead Code):`));
                            console.log(`   -> ${path.relative(process.cwd(), absolutePath)}`);
                            deadCodeNodes.forEach(n => console.log(chalk.red(`      Line ${n.line}: [${n.type}] '${n.name}' ${n.reason ? `- ${n.reason}` : ''}`)));
                        }

                        if (smellNodes.length > 0) {
                            console.log(chalk.bold.yellow(`\n[!] Temuan (Code Smells):`));
                            console.log(`   -> ${path.relative(process.cwd(), absolutePath)}`);
                            smellNodes.forEach(n => console.log(chalk.yellow(`      Line ${n.line}: [${n.type}] '${n.name}' ${n.reason ? `- ${n.reason}` : ''}`)));
                        }

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
            const spinner = ora('Membangun Graph Ketergantungan (Reachability Analysis)...').start();
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

            // Peringatan file dengan pola dinamis (eval, computed property, dynamic import)
            if (graph.unsafeFiles && graph.unsafeFiles.size > 0) {
                console.log(chalk.yellow(`\n[!] ${graph.unsafeFiles.size} file mengandung pola dinamis (eval/computed property/dynamic import).`));
                console.log(chalk.gray('    Akurasi analisis pada file ini mungkin berkurang:'));
                for (const uf of graph.unsafeFiles) {
                    console.log(chalk.gray(`    - ${path.relative(absolutePath, uf)}`));
                }
            }

            // Dependensi tidak terpakai — dianalisis oleh modul dependencyAnalyzer
            try {
                const depReport = await findUnusedDependencies(absolutePath, graph.usedPackages, ruleEngine);

                // (1) Unused Runtime Dependencies
                if (depReport.unused.length > 0) {
                    console.log(`\n[+] [Unused Dependencies] (${depReport.totalUnused} dari ${depReport.totalDeclared} runtime deps):`);
                    depReport.unused.forEach(d => console.log(`   - ${d}`));
                } else {
                    console.log('[+] [Runtime Dependencies]: Clean');
                }

                // (2) Missing Dependencies (pakai di kode tapi tidak di package.json)
                if (depReport.missing && depReport.missing.length > 0) {
                    console.log(chalk.red(`\n[!] [Missing Dependencies] (${depReport.missing.length}) — Dipakai di kode tapi tidak dideklarasikan di package.json:`))
                    console.log(chalk.gray('    Paket ini mungkin tersedia sebagai sub-dependency sekarang, tapi berisiko hilang jika dependensi induknya berubah.'));
                    depReport.missing.forEach(d => console.log(`   - ${chalk.red(d)}`));
                }

                // FITUR 9: Missing Binaries
                if (depReport.missingBinaries && depReport.missingBinaries.length > 0) {
                    console.log(chalk.red(`\n[!] [Missing Binaries] (${depReport.missingBinaries.length}) — Dipanggil di npm scripts tapi tidak di-install:`))
                    depReport.missingBinaries.forEach(d => console.log(`   - ${chalk.red(d)}`));
                }

                // (3) Dead DevDependencies (tidak terpakai di kode, scripts, maupun config files)
                if (depReport.deadDevDeps && depReport.deadDevDeps.length > 0) {
                    console.log(chalk.yellow(`\n[~] [Dead DevDependencies] (${depReport.deadDevDeps.length}) — Terdaftar di devDependencies tapi tidak ditemukan di kode, scripts, maupun config:`));
                    depReport.deadDevDeps.forEach(d => console.log(`   - ${chalk.yellow(d)}`));
                }
            } catch (err) {
                // package.json tidak ditemukan atau gagal diparsing — lewati analisis dependensi
                if (process.env.DEBUG) {
                    console.warn(`[Warning] Gagal menganalisis dependensi proyek:`, err.message);
                }
            }

            // Dead files — normalisasi path glob ke format OS lokal
            const allFiles = (await glob(['**/*.{js,jsx,mjs,cjs,ts,tsx,mts}'], {
                cwd: absolutePath,
                ignore: ['**/node_modules/**', '**/dist/**', '**/test/**', '**/tests/**', '**/coverage/**', '*.config.*', '.*.js', '.*.mjs', '.*.ts'],
                absolute: true
            })).map(f => path.resolve(f));

            const deadFiles = allFiles
                .filter(f => !graph.liveFiles.has(f))
                .filter(f => !ruleEngine.isIgnoredFile(f, absolutePath));

            let totalIssues = 0;
            if (deadFiles.length > 0) {
                console.log(`\n================================================`);
                console.log(chalk.bold('⚠️ POSSIBLY DEAD FILES (File Tidak Terhubung)'));
                console.log(chalk.gray('File ini tidak pernah di-import oleh entry point. Mungkin ini Dead File, atau mungkin ini Dynamic Route / Public Endpoint.'));
                console.log(`================================================`);
                deadFiles.forEach(f => console.log(`   - ${path.relative(absolutePath, f)}`));
                totalIssues += deadFiles.length;
            }

            // FITUR 5: Broken Links (Unresolved Imports)
            if (graph.globalRegistry.unresolvedImports && graph.globalRegistry.unresolvedImports.length > 0) {
                console.log(`\n================================================`);
                console.log(chalk.bold.red('🔗 UNRESOLVED IMPORTS (Broken Links)'));
                console.log(chalk.gray('Import statement menunjuk ke path yang tidak dapat ditemukan di disk.'));
                console.log(`================================================`);
                graph.globalRegistry.unresolvedImports.forEach(ui => {
                    console.log(`   - ${chalk.red(ui.importPath)} (di ${path.relative(absolutePath, ui.file)})`);
                });
                totalIssues += graph.globalRegistry.unresolvedImports.length;
            }

            // FITUR 8: Duplicate Exports
            if (graph.globalRegistry.projectExports) {
                const duplicateExports = [];
                for (const [exportName, files] of graph.globalRegistry.projectExports.entries()) {
                    if (files.size > 1) {
                        duplicateExports.push({ name: exportName, files: Array.from(files) });
                    }
                }

                if (duplicateExports.length > 0) {
                    console.log(`\n================================================`);
                    console.log(chalk.bold.yellow('⚠️ DUPLICATE EXPORTS'));
                    console.log(chalk.gray('Nama ekspor yang sama ditemukan di beberapa file (bisa bentrok jika di-re-export).'));
                    console.log(`================================================`);
                    duplicateExports.forEach(de => {
                        console.log(`   - Ekspor ${chalk.yellow(`'${de.name}'`)} ditemukan di:`);
                        de.files.forEach(f => console.log(`      ↳ ${path.relative(absolutePath, f)}`));
                    });
                    const duplicateExportsCount = duplicateExports.length;
                    totalIssues += duplicateExportsCount;
                }
            }

            // FITUR 9: Circular Dependencies (Siklus Maut)
            if (graph.globalRegistry.circularDependencies && graph.globalRegistry.circularDependencies.length > 0) {
                const cycles = graph.globalRegistry.circularDependencies;
                console.log(`\n================================================`);
                console.log(chalk.bold.magenta(`⚠️ CIRCULAR DEPENDENCIES (${cycles.length} Siklus Ditemukan)`));
                console.log(chalk.gray('File saling mengimpor satu sama lain secara melingkar (A -> B -> A). Bisa memicu error "Cannot access before initialization".'));
                console.log(`================================================`);
                cycles.forEach((cycle, index) => {
                    // Memotong path agar lebih mudah dibaca
                    const shortCycle = cycle.map(p => path.relative(absolutePath, p));
                    console.log(chalk.magenta(`   ${index + 1}. ${shortCycle.join(' -> ')}`));
                });
                totalIssues += cycles.length;
            }

            // Dead code di seluruh file — dikategorisasi berdasarkan tipe
            const scanSpinner = ora('Melacak Dead Code di seluruh file proyek...').start();
            const cache = new ParseCache();

            const allDeadNodes = []; // { file, node }

            // Gabungkan file aktif dan file mati untuk dianalisis dead code-nya
            const filesToAnalyze = new Set([...graph.liveFiles, ...deadFiles]);

            for (const file of filesToAnalyze) {
                // Skip file yang bukan JavaScript/TypeScript (tidak bisa di-parse)
                const PARSEABLE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts']);
                const ext = path.extname(file).toLowerCase();
                if (!PARSEABLE_EXTENSIONS.has(ext) || file.includes('node_modules')) continue;

                try {
                    // Cek cache terlebih dahulu
                    let code, ast;
                    const cached = await cache.get(file);
                    if (cached) {
                        code = cached.code;
                        ast = cached.ast;
                    } else {
                        code = await fs.readFile(file, 'utf-8');
                        ast = await parseCode(code, file);
                    }

                    const deadNodes = findDeadCode(ast, file, graph.globalRegistry, ruleEngine);
                    deadNodes.forEach(n => allDeadNodes.push({ file, ...n }));
                } catch (err) {
                    console.warn(chalk.yellow(`   [!] Gagal parse: ${path.relative(absolutePath, file)}: ${err.message}`));
                }
            }
            scanSpinner.stop();

            // Tampilkan statistik cache
            const cacheStats = cache.getStats();
            if (cacheStats.hits > 0) {
                console.log(chalk.gray(`   [cache] ${cacheStats.hits} hits, ${cacheStats.misses} misses (${cacheStats.hitRate} hit rate)`));
            }

            // Kategorisasi berdasarkan status keamanan (dari analyzer)
            const typeLabels = {
                'Variable': { label: '[Unused Variables]', color: chalk.red },
                'Function': { label: '[Unused Functions]', color: chalk.red },
                'Import': { label: '[Unused Imports]', color: chalk.red },
                'WriteOnly': { label: '[Write-Only Variables]', color: chalk.red },
                'DeadCode': { label: '[Unreachable Code]', color: chalk.magenta },
                'DeadBranch': { label: '[Unreachable Branch]', color: chalk.magenta },
                'DuplicateCondition': { label: '[Duplicate Conditions]', color: chalk.magenta },
                'ClassMethod': { label: '[Unused Class Methods]', color: chalk.yellow },
                'Parameter': { label: '[Unused Parameters]', color: chalk.yellow },
                'EmptyBlock': { label: '[Code Smell: Empty Block]', color: chalk.yellow },
            };

            // Kelompokkan berdasarkan status (safe/review/risky)
            const groupedItems = { safe: [], review: [], risky: [], other: [] };

            for (const node of allDeadNodes) {
                const group = node.status || 'other';
                if (groupedItems[group]) {
                    groupedItems[group].push(node);
                } else {
                    groupedItems.other.push(node);
                }
            }
            const printGroup = (title, description, items) => {
                if (items.length === 0) return false;

                console.log(`\n================================================`);
                console.log(chalk.bold(title));
                console.log(chalk.gray(description));
                console.log(`================================================`);

                // Kelompokkan berdasarkan tipe
                const itemsByType = {};
                items.forEach(n => {
                    const meta = typeLabels[n.type] || { label: `[${n.type}]`, color: chalk.gray };
                    const label = meta.label;
                    if (!itemsByType[label]) itemsByType[label] = { meta, nodes: [] };
                    itemsByType[label].nodes.push(n);
                });

                for (const [label, data] of Object.entries(itemsByType)) {
                    // Ambil confidence dari node pertama di grup ini
                    const sampleConfidence = data.nodes[0]?.confidence || 'medium';
                    const confidenceBadge = sampleConfidence === 'high' ? chalk.bgRed.white(' HIGH ') :
                        sampleConfidence === 'medium' ? chalk.bgYellow.black(' MEDIUM ') :
                            chalk.bgGray.white(' LOW ');
                    console.log(`\n${data.meta.color(label)} ${confidenceBadge}`);

                    const byFile = {};
                    data.nodes.forEach(n => {
                        const rel = path.relative(absolutePath, n.file);
                        if (!byFile[rel]) byFile[rel] = [];
                        byFile[rel].push(n);
                    });
                    for (const [file, nodes] of Object.entries(byFile)) {
                        console.log(`   -> ${file}`);
                        nodes.forEach(n => {
                            const statusIcon = n.status === 'safe' ? chalk.green('[SAFE]') :
                                n.status === 'review' ? chalk.yellow('[REVIEW]') :
                                    chalk.red('[RISKY]');
                            console.log(`      Line ${n.line}: '${n.name}' ${statusIcon} ${n.reason ? `- ${chalk.italic.gray(n.reason)}` : ''}`);
                        });
                    }
                }
                return true;
            };

            let printedAny = false;

            if (printGroup(
                '\u{1F7E2} SAFE TO REMOVE (Aman untuk dihapus)',
                'Kode ini dipastikan tidak pernah dieksekusi atau dipanggil. Auto-fix akan menghapus item ini.',
                groupedItems.safe
            )) {
                printedAny = true;
                totalIssues += groupedItems.safe.length;
            }

            if (options.advanced) {
                if (printGroup(
                    '\u{1F7E1} NEEDS REVIEW (Butuh Peninjauan Manual)',
                    'Kode ini kemungkinan tidak dipakai, tapi ada risiko side-effect. Periksa sebelum menghapus.',
                    groupedItems.review
                )) {
                    printedAny = true;
                    totalIssues += groupedItems.review.length;
                }

                if (printGroup(
                    '\u{1F534} RISKY (Berisiko Tinggi)',
                    'Kode ini mungkin dipanggil secara dinamis (callback, event, inheritance). JANGAN hapus tanpa pengecekan.',
                    groupedItems.risky
                )) {
                    printedAny = true;
                    totalIssues += groupedItems.risky.length;
                }

                if (groupedItems.other.length > 0) {
                    printedAny = true;
                    console.log(`\n${chalk.gray('[Other]')}`);
                    groupedItems.other.forEach(n => {
                        console.log(`   -> ${path.relative(absolutePath, n.file)} Line ${n.line}: ${n.type} '${n.name}'`);
                    });
                    totalIssues += groupedItems.other.length;
                }
            } else {
                const hiddenCount = groupedItems.review.length + groupedItems.risky.length + groupedItems.other.length;
                if (hiddenCount > 0) {
                    console.log(`\n${chalk.gray(`   [i] Disembunyikan ${hiddenCount} peringatan lanjutan AST Linter.`)}`);
                    console.log(`${chalk.gray(`       (Gunakan flag --advanced untuk melihat detailnya)`)}`);
                    totalIssues += hiddenCount; // Tetap dihitung di statistik total
                }
            }

            if (!printedAny && groupedItems.safe.length === 0) console.log('\n   [ok] Tidak ada dead code [SAFE] yang tertinggal!');

            const duration = (performance.now() - startTime).toFixed(2);

            // Tampilkan Summary Statistics Box
            if (!jsonMode) {
                console.log('\n┌──────────────────────────────────────────────┐');
                console.log('│ ' + chalk.bold('📊 SCAN SUMMARY STATISTICS') + '                   │');
                console.log('├──────────────────────────────────────────────┤');
                console.log(`│ Total Files Analyzed : ${String(filesToAnalyze.size).padEnd(21)} │`);
                console.log(`│ Dead Files Found     : ${String(deadFiles.length).padEnd(21)} │`);
                console.log(`│ Total Issues         : ${String(totalIssues).padEnd(21)} │`);
                console.log('├──────────────────────────────────────────────┤');
                console.log(`│ 🟢 Safe to Remove    : ${String(groupedItems.safe.length).padEnd(21)} │`);
                console.log(`│ 🟡 Needs Review      : ${String(groupedItems.review.length).padEnd(21)} │`);
                console.log(`│ 🔴 Risky Actions     : ${String(groupedItems.risky.length).padEnd(21)} │`);
                console.log('├──────────────────────────────────────────────┤');
                console.log(`│ ⏱️  Scan Time        : ${String(duration + ' ms').padEnd(21)} │`);
                console.log('└──────────────────────────────────────────────┘\n');
            }

            // === JSON MODE: Output terstruktur untuk CI/CD ===
            if (jsonMode) {
                const jsonResult = {
                    mode: 'directory',
                    projectRoot: absolutePath,
                    summary: {
                        liveFiles: graph.liveFiles.size,
                        totalIssues,
                        analysisTime: `${(performance.now() - startTime).toFixed(2)} ms`
                    },
                    unsafeFiles: graph.unsafeFiles ? [...graph.unsafeFiles].map(f => path.relative(absolutePath, f)) : [],
                    unusedDependencies: [],
                    deadFiles: deadFiles.map(f => path.relative(absolutePath, f)),
                    deadCode: allDeadNodes.map(n => ({
                        file: path.relative(absolutePath, n.file),
                        name: n.name,
                        type: n.type,
                        line: n.line,
                        confidence: n.confidence || 'medium',
                        status: n.status || 'review',
                        reason: n.reason || ''
                    }))
                };
                // Tambahkan data unused deps jika ada
                try {
                    const depReport = await findUnusedDependencies(absolutePath, graph.usedPackages, ruleEngine);
                    jsonResult.unusedDependencies = depReport.unused;
                    jsonResult.missingDependencies = depReport.missing || [];
                    jsonResult.deadDevDependencies = depReport.deadDevDeps || [];
                } catch (err) {
                    if (process.env.DEBUG) {
                        console.warn(`[Warning] Gagal mengambil laporan unused dependencies untuk JSON:`, err.message);
                    }
                }

                // Output JSON (tanpa menghapus terminal — biarkan user lihat warning sebelumnya)
                console.log('\n--- JSON OUTPUT ---');
                console.log(JSON.stringify(jsonResult, null, 2));
            }
        });
}
