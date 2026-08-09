import path from 'path';
import fs from 'fs-extra';
import glob from 'fast-glob';
import chalk from 'chalk';
import ora from 'ora';
import { performance } from 'perf_hooks';
import { parseCode } from '../parser/astParser.js';
import { ParseCache } from '../parser/parseCache.js';
import { SCRIPT_EXTENSION_SET, SCRIPT_GLOB } from '../parser/supportedExtensions.js';
import { findDeadCode } from '../analyzer/deadcode/index.js';
import { analyzeProjectDependencies } from '../analyzer/dependency/dependencyReportService.js';
import { RuleEngine } from '../analyzer/ruleEngine.js';
import {
    assertExistingPathInsideRoot,
    isExistingPathInsideRoot,
} from '../analyzer/pathContainment.js';
import {
    buildGraphWithInteractiveFallback,
    findProjectRoot,
    printConfigDiagnostics,
} from './commandHelpers.js';
import {
    createDirectoryScanReport,
    createSingleFileScanReport,
    matchingFailCategories,
    parseFailOn,
} from './scanReport.js';

/**
 * Mendaftarkan perintah `scan` ke instance Commander yang diberikan.
 * @param {import('commander').Command} program
 */
export function registerScanCommand(program) {
    program
        .command('scan')
        .argument('<path>', 'Path ke file tunggal atau direktori proyek')
        .option('--json', 'Output hasil analisis dalam format JSON (untuk integrasi CI/CD)')
        .option('--no-config', 'Abaikan konfigurasi DeadKiller pada target dan gunakan profil otomatis')
        .option('--summary-file <path>', 'Simpan ringkasan internal scan untuk integrasi wizard')
        .option('-a, --advanced', 'Tampilkan hasil linter AST lanjutan (Undeclared Variables, Unused Methods, dll)')
        .option('--fail-on <categories>', 'Exit code 2 jika kategori ditemukan: safe,review,risky,dependency,dead-file,any')
        .description('Pindai dead code dan dependensi tidak terpakai tanpa mengubah file')
        .action(async (targetPath, options) => {
            const jsonMode = options.json || false;
            // Commander memetakan negated option `--no-config` ke `config: false`.
            const ignoreConfig = options.config === false;
            let failCategories;
            try {
                failCategories = parseFailOn(options.failOn);
            } catch (error) {
                globalThis.console.error(`[ERROR] ${error.message}`);
                process.exitCode = 1;
                return;
            }
            // Dalam mode JSON, seluruh console.log di command ini dibungkam agar
            // stdout hanya berisi satu dokumen JSON. Warning dan error tetap ke stderr.
            const systemConsole = globalThis.console;
            const console = jsonMode
                ? {
                    log: () => undefined,
                    warn: systemConsole.warn.bind(systemConsole),
                    error: systemConsole.error.bind(systemConsole),
                }
                : systemConsole;
            const writeJsonResult = result => {
                process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            };
            const applyFailPolicy = report => {
                const matched = matchingFailCategories(report, failCategories);
                report.ci = {
                    failOn: failCategories,
                    failed: matched.length > 0,
                    matched,
                    exitCode: matched.length > 0 ? 2 : 0,
                };
                if (matched.length > 0) process.exitCode = 2;
                return report;
            };
            const absolutePath = path.resolve(targetPath);
            if (!fs.existsSync(absolutePath)) {
                console.error(`[ERROR] Path '${absolutePath}' tidak ditemukan.`);
                process.exit(1);
            }

            const startTime = performance.now();
            const stats = await fs.stat(absolutePath);

            // --- MODE SATU FILE ---
            if (stats.isFile()) {
                try {
                    const projectRoot = await findProjectRoot(path.dirname(absolutePath), { ignoreConfig });
                    assertExistingPathInsideRoot(projectRoot, absolutePath, 'memindai');
                    const ruleEngine = new RuleEngine();
                    await ruleEngine.loadConfig(projectRoot, { ignoreConfig });
                    printConfigDiagnostics(ruleEngine, { silent: jsonMode });

                    if (!jsonMode) {
                        console.log(`\n[>] Scanning file tunggal: ${path.basename(absolutePath)}`);
                    }
                    if (ruleEngine.isIgnoredFile(absolutePath, projectRoot)) {
                        const report = applyFailPolicy(createSingleFileScanReport({
                            file: absolutePath,
                            ruleEngine,
                            ignored: true,
                            analysisTimeMs: performance.now() - startTime,
                        }));
                        if (jsonMode) {
                            writeJsonResult(report);
                        } else {
                            console.log(chalk.yellow(`[!] File diabaikan berdasarkan konfigurasi DeadKiller.`));
                        }
                        return;
                    }

                    const code = await fs.readFile(absolutePath, 'utf-8');
                    const ast = await parseCode(code, absolutePath);
                    const registry = {
                        usedExports: new Map(),
                        unsafeFiles: new Set(),
                        graphCompleteness: {
                            status: 'unknown',
                            complete: false,
                            reasons: ['scan satu file tidak membangun graph proyek'],
                        },
                    };
                    const deadNodes = findDeadCode(ast, absolutePath, registry, ruleEngine);
                    const protectedFile = ruleEngine.isPreservedFile(absolutePath, projectRoot);
                    const report = applyFailPolicy(createSingleFileScanReport({
                        file: absolutePath,
                        ruleEngine,
                        protectedFile,
                        deadNodes,
                        analysisTimeMs: performance.now() - startTime,
                    }));

                    if (jsonMode) {
                        writeJsonResult(report);
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
                    if (report.ci.failed) {
                        console.error(chalk.red(`\n[CI] Gagal karena kategori: ${report.ci.matched.join(', ')}`));
                    }
                } catch (err) {
                    console.error('[ERROR] Analisis gagal:', err.message);
                    process.exit(1);
                }
                return;
            }

            // --- MODE DIREKTORI ---
            console.log(`\n[>] Menganalisis proyek di: ${chalk.cyan(absolutePath)}`);
            const ruleEngine = new RuleEngine();
            await ruleEngine.loadConfig(absolutePath, { ignoreConfig });
            printConfigDiagnostics(ruleEngine, { silent: jsonMode });
            const spinner = jsonMode
                ? null
                : ora('Membangun Graph Ketergantungan (Reachability Analysis)...').start();

            let graph;
            try {
                graph = await buildGraphWithInteractiveFallback(
                    absolutePath,
                    ruleEngine,
                    spinner,
                    { interactive: !jsonMode },
                );
            } catch (err) {
                if (spinner) spinner.fail('Gagal membangun struktur graf proyek!');
                console.error(err.message);
                process.exit(1);
            }
            spinner?.succeed(`Graf terbentuk: ${graph.liveFiles.size} File Aktif dipetakan.`);

            if (graph.completeness?.complete === false && !jsonMode) {
                console.log(chalk.yellow(`\n[!] MODULE GRAPH ${graph.completeness.status.toUpperCase()} (${graph.completeness.reasons.length} issue)`));
            }

            // Peringatan file dengan pola dinamis (eval, computed property, dynamic import)
            if (graph.unsafeFiles && graph.unsafeFiles.size > 0) {
                console.log(chalk.yellow(`\n[!] Dynamic Code Detected (${graph.unsafeFiles.size} file)`));
                for (const uf of graph.unsafeFiles) {
                    console.log(chalk.gray(`   - ${path.relative(absolutePath, uf)}`));
                }
            }

            // Satu laporan dependency dipakai ulang oleh output manusia dan JSON
            // agar hasil antar-interface tetap konsisten.
            let dependencyReport = null;
            let dependencyAnalysisError = null;
            try {
                dependencyReport = await analyzeProjectDependencies(absolutePath, graph, ruleEngine);
                const depReport = dependencyReport;

                // (1) Unused Runtime Dependencies
                if (depReport.unused.length > 0) {
                    console.log(`\n[+] [Unused Dependencies] (${depReport.totalUnused} dari ${depReport.totalDeclared} runtime deps):`);
                    depReport.unused.forEach(d => console.log(`   - ${d}`));
                } else if (!depReport.uncertain?.length) {
                    console.log('[+] [Runtime Dependencies]: Clean');
                } else {
                    console.log('[?] [Runtime Dependencies]: Tidak ada kandidat unused berkepercayaan tinggi.');
                }

                if (depReport.uncertain?.length > 0) {
                    console.log(chalk.yellow(`\n[?] [Unknown Dependencies] (${depReport.uncertain.length}) — bukti belum lengkap, tidak aman dihapus:`));
                    depReport.uncertain.forEach(d => console.log(`   - ${chalk.yellow(d)}`));
                    depReport.safety?.reasons?.forEach(reason => console.log(chalk.gray(`     alasan: ${reason}`)));
                }

                // (2) Missing Dependencies (Benar-benar tidak ada di node_modules maupun package.json)
                if (depReport.missing && depReport.missing.length > 0) {
                    console.log(chalk.red(`\n[!] [Missing Dependencies] (${depReport.missing.length}) — Dipakai di kode tapi tidak dideklarasikan dan tidak ditemukan di node_modules:`));
                    depReport.missing.forEach(d => console.log(`   - ${chalk.red(d)}`));
                }

                // (2.1) Nested Dependencies (Dideklarasikan di package.json yang bersarang/nested)
                if (depReport.nestedDeps && depReport.nestedDeps.length > 0) {
                    console.log(chalk.yellow(`\n[i] [Nested Dependencies] (${depReport.nestedDeps.length}) — Digunakan di kode dan dideklarasikan di nested package.json (bukan di root):`));
                    depReport.nestedDeps.forEach(d => console.log(`   - ${chalk.yellow(d)}`));
                }

                // (2.2) Phantom Dependencies (Dipakai di kode, tidak ada di package.json, tapi ADA di node_modules)
                if (depReport.phantomDeps && depReport.phantomDeps.length > 0) {
                    console.log(chalk.red(`\n[!] [Phantom Dependencies] (${depReport.phantomDeps.length}) — Dipakai di kode tapi tidak dideklarasikan di package.json:`));
                    console.log(chalk.gray('    Paket ini ter-install otomatis via dependensi lain (Phantom), tapi berisiko rusak jika dependensi induk berubah. Harap daftarkan eksplisit.'));
                    depReport.phantomDeps.forEach(d => console.log(`   - ${chalk.red(d)}`));
                }

                // FITUR 9: Missing Binaries
                if (depReport.missingBinaries && depReport.missingBinaries.length > 0) {
                    console.log(chalk.red(`\n[!] [Missing Binaries] (${depReport.missingBinaries.length}) — Dipanggil di npm scripts tapi tidak di-install:`));
                    depReport.missingBinaries.forEach(d => console.log(`   - ${chalk.red(d)}`));
                }

                // (3) Dead DevDependencies (tidak terpakai di kode, scripts, maupun config files)
                if (depReport.deadDevDeps && depReport.deadDevDeps.length > 0) {
                    console.log(chalk.yellow(`\n[~] [Dead DevDependencies] (${depReport.deadDevDeps.length}) — Terdaftar di devDependencies tapi tidak ditemukan di kode, scripts, maupun config:`));
                    depReport.deadDevDeps.forEach(d => console.log(`   - ${chalk.yellow(d)}`));
                }
                if (depReport.uncertainDevDeps?.length > 0) {
                    console.log(chalk.yellow(`\n[?] [Unknown DevDependencies] (${depReport.uncertainDevDeps.length}) — perlu review manual:`));
                    depReport.uncertainDevDeps.forEach(d => console.log(`   - ${chalk.yellow(d)}`));
                }
                if (depReport.diagnostics?.length > 0) {
                    console.log(chalk.yellow('\n[?] [Dependency Diagnostics]:'));
                    depReport.diagnostics.forEach(item => {
                        const message = typeof item === 'string' ? item : item.message || JSON.stringify(item);
                        console.log(chalk.gray(`   - ${message}`));
                    });
                }
            } catch (err) {
                dependencyAnalysisError = err.message;
                console.warn(chalk.yellow(`[Warning] Analisis dependency gagal; status dependency dianggap UNKNOWN: ${err.message}`));
            }
            // Dead files — normalisasi path glob ke format OS lokal
            const allFiles = (await glob([SCRIPT_GLOB], {
                cwd: absolutePath,
                ignore: ['**/node_modules/**', '**/dist/**', '**/coverage/**', '*.config.*', '.*.js', '.*.mjs', '.*.ts'],
                absolute: true,
                followSymbolicLinks: false,
            }))
                .map(f => path.resolve(f))
                .filter(file => isExistingPathInsideRoot(absolutePath, file));

            const preservedFiles = allFiles.filter(f => ruleEngine.isPreservedFile(f, absolutePath));
            const deadFiles = allFiles
                .filter(f => !graph.liveFiles.has(f))
                .filter(f => !ruleEngine.isIgnoredFile(f, absolutePath))
                .filter(f => !ruleEngine.isPreservedFile(f, absolutePath));

            if (deadFiles.length > 0) {
                console.log(`\n================================================`);
                console.log(chalk.bold('⚠️ UNCONNECTED FILE CANDIDATES (Perlu Review)'));
                console.log(chalk.gray('File tidak terjangkau dari entry point, tetapi dapat berupa example, test fixture, dynamic route, atau public endpoint.'));
                console.log(`================================================`);
                deadFiles.forEach(f => console.log(`   - ${path.relative(absolutePath, f)}`));
            }

            // FITUR 5: Broken Links (Unresolved Imports)
            if (graph.globalRegistry.unresolvedImports && graph.globalRegistry.unresolvedImports.length > 0) {
                console.log(`\n================================================`);
                console.log(chalk.bold.red('🔗 UNRESOLVED IMPORTS (Broken Links)'));
                console.log(chalk.gray('Import statement menunjuk ke path yang tidak dapat ditemukan di disk.'));
                console.log(`================================================`);
                graph.globalRegistry.unresolvedImports.forEach(ui => {
                    const reasonCode = ui.reasonCode ? ` [${ui.reasonCode}]` : '';
                    console.log(`   - ${chalk.red(ui.importPath)}${reasonCode} (di ${path.relative(absolutePath, ui.file)})`);
                    if (ui.configPath) {
                        console.log(chalk.gray(`     config: ${path.relative(absolutePath, ui.configPath)}`));
                    }
                });
            }

            // FITUR 8: Duplicate Exports
            const duplicateExports = [];
            if (graph.globalRegistry.projectExports) {
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
                }
            }

            // FITUR 9: Circular Dependencies (Siklus Maut)
            let runtimeCycles = [];
            let typeOnlyCycles = [];
            if (graph.globalRegistry.circularDependencies && graph.globalRegistry.circularDependencies.length > 0) {
                const cycles = graph.globalRegistry.circularDependencies;
                runtimeCycles = cycles.filter(cycle => cycle.isRuntimeCycle !== false);
                typeOnlyCycles = cycles.filter(cycle => cycle.isRuntimeCycle === false);
                if (runtimeCycles.length > 0) {
                    console.log(`\n================================================`);
                    console.log(chalk.bold.magenta(`⚠️ CIRCULAR RUNTIME DEPENDENCIES (${runtimeCycles.length} Siklus Ditemukan)`));
                    console.log(chalk.gray('Seluruh edge pada siklus bertahan saat runtime dan dapat memicu "Cannot access before initialization".'));
                    console.log(`================================================`);
                }
                runtimeCycles.forEach((cycle, index) => {
                    // Memotong path agar lebih mudah dibaca
                    const shortCycle = cycle.map(p => path.relative(absolutePath, p));
                    console.log(chalk.magenta(`   ${index + 1}. ${shortCycle.join(' -> ')}`));
                });
                if (typeOnlyCycles.length > 0 && options.advanced) {
                    console.log(`\n================================================`);
                    console.log(chalk.bold.cyan(`ℹ️ TYPE-ONLY CYCLES — RUNTIME SAFE (${typeOnlyCycles.length})`));
                    console.log(chalk.gray('Sedikitnya satu edge adalah import type dan dihapus saat kompilasi, sehingga siklus runtime terputus.'));
                    console.log(`================================================`);
                    typeOnlyCycles.forEach((cycle, index) => {
                        const shortCycle = cycle.map(p => path.relative(absolutePath, p));
                        console.log(chalk.cyan(`   ${index + 1}. ${shortCycle.join(' -> ')}`));
                    });
                }
            }

            // Dead code di seluruh file — dikategorisasi berdasarkan tipe
            const scanSpinner = jsonMode
                ? null
                : ora('Melacak Dead Code di seluruh file proyek...').start();
            const cache = new ParseCache();

            const allDeadNodes = []; // { file, node }
            const normalizeFileKey = file => {
                const resolved = path.isAbsolute(file)
                    ? path.resolve(file)
                    : path.resolve(absolutePath, file);
                return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
            };
            const unsafeFileKeys = new Set(
                [...(graph.unsafeFiles || [])].map(normalizeFileKey),
            );

            // Gabungkan file aktif dan file mati untuk dianalisis dead code-nya
            const filesToAnalyze = new Set([...graph.liveFiles, ...deadFiles, ...preservedFiles]);

            for (const file of filesToAnalyze) {
                // Skip file yang bukan JavaScript/TypeScript (tidak bisa di-parse)
                const ext = path.extname(file).toLowerCase();
                if (!SCRIPT_EXTENSION_SET.has(ext) || file.includes('node_modules')) continue;
                if (!isExistingPathInsideRoot(absolutePath, file)) continue;

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

                    // ignoreFiles benar-benar dikeluarkan dari laporan. File
                    // preserved tetap dilaporkan, tetapi ditandai protected.
                    if (ruleEngine.isIgnoredFile(file, absolutePath)) {
                        continue;
                    }
                    const protectedFile = ruleEngine.isPreservedFile(file, absolutePath);

                    // File dinamis (unsafeFiles): fixCommand hanya memblokir tipe non-struktural.
                    // Tipe struktural (Import, Variable, dll) tetap bisa dieliminasi oleh fix.
                    const isUnsafeFile = unsafeFileKeys.has(normalizeFileKey(file));
                    const STRUCTURAL_SAFE_TYPES = new Set(['Import', 'Variable', 'WriteOnly', 'DeadBranch', 'DeadCode', 'UnusedType', 'UnusedClass', 'Parameter', 'EmptyBlock', 'CatchParameter', 'EmptyCatchBlock']);
                    deadNodes.forEach(n => {
                        if (isUnsafeFile && n.status === 'safe' && !STRUCTURAL_SAFE_TYPES.has(n.type)) {
                            // Tipe ini tidak akan diproses fix (ClassMethod, Function, dll) — downgrade ke REVIEW
                            allDeadNodes.push({
                                file,
                                ...n,
                                protected: protectedFile,
                                originalStatus: n.status,
                                status: 'review',
                                reason: 'Tidak ditemukan pemanggilan statis, tetapi penghapusan otomatis diblokir karena file mengandung pola dinamis.',
                            });
                        } else {
                            allDeadNodes.push({ file, ...n, protected: protectedFile });
                        }
                    });
                } catch (err) {
                    console.warn(chalk.yellow(`   [!] Gagal parse: ${path.relative(absolutePath, file)}: ${err.message}`));
                }
            }
            scanSpinner?.stop();

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
                'CatchParameter': { label: '[Unused Catch Parameters]', color: chalk.yellow },
                'EmptyBlock': { label: '[Code Smell: Empty Block]', color: chalk.yellow },
                'EmptyCatchBlock': { label: '[Code Smell: Empty Catch Block]', color: chalk.yellow },
            };

            // Kelompokkan berdasarkan status (safe/review/risky)
            const groupedItems = { safe: [], review: [], risky: [], protected: [], other: [] };

            for (const node of allDeadNodes) {
                if (node.protected) {
                    groupedItems.protected.push(node);
                    continue;
                }
                const group = node.status || 'other';
                if (groupedItems[group]) {
                    groupedItems[group].push(node);
                } else {
                    groupedItems.other.push(node);
                }
            }
            const printGroup = (title, description, items) => {
                if (items.length === 0) return false;

                console.log(`\n${chalk.bold.underline(title)}`);

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
                            const statusIcon = n.protected ? chalk.cyan('[PROTECTED]') :
                                n.status === 'safe' ? chalk.green('[SAFE]') :
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
            }

            if (printGroup(
                '🔒 PROTECTED (Dianalisis, tidak dieliminasi)',
                'Temuan tetap dilaporkan, tetapi file dilindungi oleh preserveFiles atau konvensi framework.',
                groupedItems.protected,
            )) {
                printedAny = true;
            }

            if (options.advanced) {
                if (printGroup(
                    '\u{1F7E1} NEEDS REVIEW (Butuh Peninjauan Manual)',
                    'Kode ini kemungkinan tidak dipakai, tapi ada risiko side-effect. Periksa sebelum menghapus.',
                    groupedItems.review
                )) {
                    printedAny = true;
                }

                if (printGroup(
                    '\u{1F534} RISKY (Berisiko Tinggi)',
                    'Kode ini mungkin dipanggil secara dinamis (callback, event, inheritance). JANGAN hapus tanpa pengecekan.',
                    groupedItems.risky
                )) {
                    printedAny = true;
                }
                if (groupedItems.other.length > 0) {
                    printedAny = true;
                    console.log(`\n${chalk.gray('[Other]')}`);
                    groupedItems.other.forEach(n => {
                        console.log(`   -> ${path.relative(absolutePath, n.file)} Line ${n.line}: ${n.type} '${n.name}'`);
                    });
                }
            } else {
                // Mode basic: sembunyikan review/risky/other, hanya tampilkan info tersembunyi
                const hiddenCount = groupedItems.review.length + groupedItems.risky.length + groupedItems.other.length;
                if (hiddenCount > 0) {
                    console.log(`\n${chalk.gray(`   [i] Disembunyikan ${hiddenCount} peringatan lanjutan AST Linter.`)}`);
                    console.log(`${chalk.gray(`       (Gunakan flag --advanced untuk melihat detailnya)`)}`);
                }
            }

            if (!printedAny && groupedItems.safe.length === 0) console.log('\n   [ok] Tidak ada dead code [SAFE] yang tertinggal!');

            const analysisTimeMs = performance.now() - startTime;
            const scanReport = applyFailPolicy(createDirectoryScanReport({
                projectRoot: absolutePath,
                ruleEngine,
                graph,
                deadFiles,
                deadNodes: allDeadNodes,
                duplicateExports,
                runtimeCycles,
                typeOnlyCycles,
                dependencyReport,
                dependencyAnalysisError,
                analysisTimeMs,
            }));
            const scanSummary = scanReport.summary;

            // Tampilkan Summary Statistics Box
            if (!jsonMode) {
                const isAdvancedMode = options.advanced || false;
                // Mode basic: Total Issues = hanya SAFE. Mode advanced: seluruh temuan.
                const displayedIssues = isAdvancedMode
                    ? scanSummary.codeFindings
                    : scanSummary.actionableCodeFindings;
                console.log('\n┌──────────────────────────────────────────────┐');
                console.log('│ ' + chalk.bold('📊 SCAN SUMMARY STATISTICS') + '                   │');
                console.log('├──────────────────────────────────────────────┤');
                console.log(`│ Total Files Analyzed : ${String(filesToAnalyze.size).padEnd(21)} │`);
                console.log(`│ Unconnected Candidates: ${String(deadFiles.length).padEnd(19)} │`);
                console.log(`│ Code Findings        : ${String(displayedIssues).padEnd(21)} │`);
                console.log(`│ Dependency Findings  : ${String(scanSummary.dependencyFindings).padEnd(21)} │`);
                console.log('├──────────────────────────────────────────────┤');
                console.log(`│ 🟢 Safe to Remove    : ${String(groupedItems.safe.length).padEnd(21)} │`);
                console.log(`│ 🔒 Protected         : ${String(groupedItems.protected.length).padEnd(21)} │`);
                if (isAdvancedMode) {
                    console.log(`│ 🟡 Needs Review      : ${String(groupedItems.review.length).padEnd(21)} │`);
                    console.log(`│ 🔴 Risky Actions     : ${String(groupedItems.risky.length).padEnd(21)} │`);
                }
                console.log('├──────────────────────────────────────────────┤');
                console.log(`│ ⏱️  Scan Time        : ${String(scanSummary.analysisTime).padEnd(21)} │`);
                console.log('└──────────────────────────────────────────────┘\n');
            }

            // === JSON MODE: Output terstruktur untuk CI/CD ===
            if (jsonMode) {
                writeJsonResult(scanReport);
            } else if (scanReport.ci.failed) {
                console.error(chalk.red(`\n[CI] Gagal karena kategori: ${scanReport.ci.matched.join(', ')}`));
            }

            if (options.summaryFile) {
                await fs.outputJson(path.resolve(options.summaryFile), scanSummary, { spaces: 2 });
            }
        });
}
