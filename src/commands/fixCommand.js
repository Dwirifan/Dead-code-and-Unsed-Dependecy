import path from 'path';
import fs from 'fs-extra';
import glob from 'fast-glob';
import chalk from 'chalk';
import ora from 'ora';
import { performance } from 'perf_hooks';
import { parseCode } from '../parser/astParser.js';
import { ParseCache } from '../parser/parseCache.js';
import { findDeadCode } from '../analyzer/deadcode/index.js';
import { analyzeProjectDependencies } from '../analyzer/dependency/dependencyReportService.js';
import { removeDeadCode } from '../eliminator/codeCleaner.js';
import { removeUnusedDependencies } from '../eliminator/dependencyCleaner.js';
import { generateDiff } from '../eliminator/diffGenerator.js';
import { createBackup, rollbackBackup } from '../eliminator/backupManager.js';
import { RuleEngine } from '../analyzer/ruleEngine.js';
import { buildGraphWithInteractiveFallback } from './commandHelpers.js';

/**
 * Mendaftarkan perintah `fix` ke instance Commander yang diberikan.
 * Mendukung dua mode: file tunggal (langsung tanpa graph) dan direktori (analisis via graph).
 * @param {import('commander').Command} program
 */
export function registerFixCommand(program) {
    program
        .command('fix')
        .argument('<path>', 'Path ke file tunggal (.js/.ts) atau direktori proyek')
        .description('Deteksi dan hapus dead code. Mendukung satu file maupun seluruh proyek.')
        .option('-l, --level <number>', 'Tingkat agresi penghapusan (0: Dry-run, 1-2: Safe refactor, 3: Aggressive)', '3')
        .option('-y, --yes', 'Konfirmasi otomatis fix SAFE; dependency REVIEW tidak dipilih')
        .action(async (targetPath, options) => {
            const inquirer = (await import('inquirer')).default;
            const level = parseInt(options.level, 10);
            const absolutePath = path.resolve(targetPath);
            if (!fs.existsSync(absolutePath)) {
                console.error(`[ERROR] Path '${absolutePath}' tidak ditemukan.`);
                process.exit(1);
            }

            const startTime = performance.now();
            const stats = await fs.stat(absolutePath);

            // ================================================================
            // MODE A: FILE TUNGGAL — analisis langsung, tidak perlu graph
            // ================================================================
            if (stats.isFile()) {
                await _fixSingleFile(absolutePath, startTime, inquirer, level, options.yes);
                return;
            }

            // ================================================================
            // MODE B: DIREKTORI — analisis seluruh proyek via graph
            // ================================================================
            await _fixDirectory(absolutePath, startTime, inquirer, level, options.yes);
        });
}

// ---------------------------------------------------------------------------
// Helpers (private)
// ---------------------------------------------------------------------------

async function _findProjectRoot(startDir) {
    let curr = path.resolve(startDir);
    while (true) {
        if (await fs.pathExists(path.join(curr, 'deadkiller.config.js')) ||
            await fs.pathExists(path.join(curr, 'deadkiller.config.mjs')) ||
            await fs.pathExists(path.join(curr, '.deadkillerrc.json')) ||
            await fs.pathExists(path.join(curr, 'package.json'))) {
            return curr;
        }
        const parent = path.dirname(curr);
        if (parent === curr) break;
        curr = parent;
    }
    return path.resolve(startDir);
}

async function _fixSingleFile(absolutePath, startTime, inquirer, level = 3, autoConfirm = false) {
    console.log(chalk.cyan(`\n[>] Fix mode: file tunggal — ${path.basename(absolutePath)}\n`));

    let code;
    try { code = await fs.readFile(absolutePath, 'utf-8'); }
    catch (e) { console.error(`[ERROR] Tidak bisa membaca file: ${e.message}`); process.exit(1); }

    const ruleEngine = new RuleEngine();
    const projectRoot = await _findProjectRoot(path.dirname(absolutePath));
    await ruleEngine.loadConfig(projectRoot);

    if (ruleEngine.isIgnoredFile(absolutePath, projectRoot)) {
        console.log(chalk.yellow(`[!] File '${path.basename(absolutePath)}' diabaikan berdasarkan konfigurasi.`));
        return;
    }

    const ast = await parseCode(code, absolutePath);
    const dummyRegistry = { usedExports: new Map(), unsafeFiles: new Set() };
    const deadNodes = findDeadCode(ast, absolutePath, dummyRegistry, ruleEngine);

    if (dummyRegistry.unsafeFiles.has(absolutePath)) {
        console.log(chalk.yellow(`\n[!] CONSERVATIVE SAFETY FALLBACK: Dynamic Code Detected`));
        console.log(chalk.gray(`Peringatan: File ini mengandung pola dinamis (eval/with/computed property/dynamic require).`));
        console.log(chalk.yellow(`Perbaikan otomatis ditiadakan demi mencegah false positive.\n`));
        return;
    }

    if (deadNodes.length === 0) {
        console.log(chalk.green('[ok] File bersih! Tidak ada dead code maupun anomali kode ditemukan.\n'));
        return;
    }

    // Pisahkan item berdasarkan status keamanan
    const safeNodes = deadNodes.filter(n => n.status === 'safe');
    const reviewNodes = deadNodes.filter(n => n.status === 'review');
    const riskyNodes = deadNodes.filter(n => n.status === 'risky');

    // Tampilkan laporan lengkap
    console.log(chalk.yellow(`[*] Temuan (Dead Code & Code Smell) (${deadNodes.length} item):`));
    if (safeNodes.length > 0) {
        console.log(chalk.green(`\n   ${chalk.bold('[SAFE]')} — Akan dihapus otomatis (${safeNodes.length} item):`));
        safeNodes.forEach(n => console.log(`      Line ${n.line}: ${n.type} '${n.name}'`));
    }
    if (reviewNodes.length > 0) {
        console.log(chalk.yellow(`\n   ${chalk.bold('[REVIEW]')} — Hanya dilaporkan (${reviewNodes.length} item):`));
        reviewNodes.forEach(n => console.log(`      Line ${n.line}: ${n.type} '${n.name}'`));
    }
    if (riskyNodes.length > 0) {
        console.log(chalk.red(`\n   ${chalk.bold('[RISKY]')} — Tidak dihapus (${riskyNodes.length} item):`));
        riskyNodes.forEach(n => console.log(`      Line ${n.line}: ${n.type} '${n.name}'`));
    }

    // Terapkan aturan Modul Eliminator
    const eliminatorConfig = ruleEngine.rules.eliminator || {};
    if (eliminatorConfig.autoRenameUnusedParameters) {
        deadNodes.forEach(n => { if (n.type === 'Parameter') n.status = 'safe'; });
    }
    if (eliminatorConfig.autoRemoveEmptyBlocks) {
        deadNodes.forEach(n => { if (n.type === 'EmptyBlock') n.status = 'safe'; });
    }

    // Refresh safeNodes after config application: HANYA status 'safe' yang diproses otomatis
    const nodesToProcess = deadNodes.filter(n => n.status === 'safe');

    if (nodesToProcess.length === 0) {
        console.log(chalk.gray('\n[ok] Tidak ada item yang aman (SAFE) untuk diproses otomatis. Tinjau manual item di atas.\n'));
        return;
    }

    const simLevel = level === 0 ? 3 : level;
    const newCode = removeDeadCode(code, nodesToProcess, ruleEngine, simLevel);
    const diff = generateDiff(code, newCode, path.basename(absolutePath));
    console.log(chalk.gray('\n--- Preview ---'));
    console.log(diff);
    console.log(chalk.gray('---------------'));

    if (level === 0) {
        console.log(chalk.cyan(`\n[DRY-RUN] Mode Dry-Run (Level 0). Tidak ada perubahan fisik yang disimpan, tidak ada backup yang dibuat.`));
        if (reviewNodes.length + riskyNodes.length > 0) {
            console.log(chalk.yellow(`[!] ${reviewNodes.length + riskyNodes.length} item REVIEW/RISKY dilaporkan dan tidak akan dihapus otomatis.\n`));
        }
        return;
    }

    const { ok } = autoConfirm ? { ok: true } : await inquirer.prompt([{
        type: 'confirm', name: 'ok',
        message: `Terapkan eliminasi (Level ${level}) pada ${nodesToProcess.length} item di file ini? (backup otomatis dibuat)`,
        default: true
    }]);
    if (!ok) { console.log(chalk.gray('[.] Dibatalkan.\n')); return; }

    let backupDir;
    try { 
        const maxBackups = eliminatorConfig.maxBackups !== undefined ? eliminatorConfig.maxBackups : 20;
        backupDir = await createBackup(projectRoot, [absolutePath], false, maxBackups);
        console.log(chalk.gray(`   [ok] Checkpoint backup dibuat di ${path.relative(projectRoot, backupDir)}`));
    } catch (err) { 
        console.error(chalk.red(`\n[ERROR] Gagal membuat checkpoint backup: ${err.message}`));
        console.error(chalk.red(`[ABORTED] Proses eliminasi dibatalkan demi keamanan data (Backup wajib berhasil sebelum perubahan diterapkan).\n`));
        return;
    }

    try {
        await fs.writeFile(absolutePath, newCode);
    } catch (err) {
        console.error(chalk.red(`\n[ERROR] Gagal menulis file: ${err.message}`));
        console.log(chalk.yellow(`[ROLLBACK] Melakukan pemulihan data dari checkpoint backup...`));
        try {
            await rollbackBackup(projectRoot, backupDir);
            console.log(chalk.green(`[ROLLBACK BERHASIL] Proyek telah dikembalikan ke kondisi semula.`));
        } catch (rollbackErr) {
            console.error(chalk.red(`[ROLLBACK GAGAL] Gagal memulihkan dari backup: ${rollbackErr.message}`));
        }
        return;
    }

    const locDiff = code.split('\n').length - newCode.split('\n').length;
    console.log(chalk.green(`\n[ok] Selesai! ${locDiff} baris dihapus. (${(performance.now() - startTime).toFixed(0)} ms)`));
    if (reviewNodes.length + riskyNodes.length > 0) {
        console.log(chalk.yellow(`[!] ${reviewNodes.length + riskyNodes.length} item REVIEW/RISKY tidak dihapus. Tinjau secara manual.\n`));
    }
}
async function _fixDirectory(absolutePath, startTime, inquirer, level = 3, autoConfirm = false) {
    console.log(chalk.cyan(`\n[>] Fix mode: direktori — ${absolutePath}`));
    const spinner = ora('Membangun graph & mendeteksi dead code di semua file...').start();
    const ruleEngine = new RuleEngine();
    await ruleEngine.loadConfig(absolutePath);

    let graph;
    try { graph = await buildGraphWithInteractiveFallback(absolutePath, ruleEngine, spinner); }
    catch (err) { if (spinner) spinner.fail(err.message); process.exit(1); }
    const normalizeFileKey = file => {
        const resolved = path.isAbsolute(file)
            ? path.resolve(file)
            : path.resolve(absolutePath, file);
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    };
    const unsafeFileKeys = new Set(
        [...(graph.unsafeFiles || [])].map(normalizeFileKey),
    );

    // Dependensi tidak terpakai dianalisis secara konservatif. Jika graph tidak
    // lengkap, kandidat dipindahkan ke UNKNOWN dan tidak boleh di-uninstall.
    let unusedDeps = [];
    let uncertainDeps = [];
    let dependencyDiagnostics = [];
    let dependencyBlockReasons = [];

    try {
        const depReport = await analyzeProjectDependencies(absolutePath, graph, ruleEngine);
        unusedDeps = [...(depReport.unused || [])];
        uncertainDeps = [...(depReport.uncertain || [])];
        dependencyDiagnostics = [...(depReport.diagnostics || [])]
            .map(item => typeof item === 'string' ? item : item.message || JSON.stringify(item))
            .filter(Boolean);
        dependencyBlockReasons = [...(depReport.safety?.reasons || [])];
    } catch (err) {
        dependencyDiagnostics.push(`Analisis dependency gagal: ${err.message}`);
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

    // Dead code di dalam live files (global, otomatis)
    const deadCodeReport = [];
    const skippedReport = []; // Item review/risky yang hanya dilaporkan
    const cache = new ParseCache();
    let originalLoc = 0, originalSize = 0, newLoc = 0, newSize = 0;

    for (const file of graph.liveFiles) {
        // Skip file yang bukan JavaScript/TypeScript (tidak bisa di-parse)
        const PARSEABLE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts']);
        const ext = path.extname(file).toLowerCase();
        if (!PARSEABLE_EXTENSIONS.has(ext) || file.includes('node_modules')) continue;

        // File dinamis (unsafeFiles): Safety Fallback melindungi EKSPOR di graph (sudah ditangani saat traversal).
        // Tapi dead code STRUKTURAL (unreachable code, unused import, unused variable) tetap aman dieliminasi.
        // Hanya tipe yang berpotensi dipanggil secara dinamis yang diblokir.
        const isUnsafeFile = unsafeFileKeys.has(normalizeFileKey(file));
        // Tipe yang AMAN dieliminasi bahkan dari file dinamis (tidak tergantung pada export resolution)
        const STRUCTURAL_SAFE_TYPES = new Set(['Import', 'Variable', 'WriteOnly', 'DeadBranch', 'DeadCode', 'UnusedType', 'UnusedClass', 'Parameter', 'EmptyBlock']);

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
                await cache.set(file, ast, code);
            }

            originalLoc += code.split('\n').length;
            originalSize += Buffer.byteLength(code);
            const allDead = findDeadCode(ast, file, graph.globalRegistry, ruleEngine);

            // Terapkan aturan Modul Eliminator
            const eliminatorConfig = ruleEngine.rules.eliminator || {};
            if (eliminatorConfig.autoRenameUnusedParameters) {
                allDead.forEach(n => { if (n.type === 'Parameter') n.status = 'safe'; });
            }
            if (eliminatorConfig.autoRemoveEmptyBlocks) {
                allDead.forEach(n => { if (n.type === 'EmptyBlock') n.status = 'safe'; });
            }

            // Pisahkan: HANYA item SAFE yang diproses otomatis oleh Eliminator.
            // Untuk file dinamis (unsafeFiles): filter tambahan — hanya proses tipe struktural.
            const nodesToProcess = allDead.filter(n => {
                if (n.status !== 'safe') return false;
                if (isUnsafeFile && !STRUCTURAL_SAFE_TYPES.has(n.type)) return false;
                return true;
            });
            const unsafeDead = allDead.filter(n => !nodesToProcess.includes(n));

            // Catat item yang tidak di-fix
            unsafeDead.forEach(n => skippedReport.push({ file, ...n }));

            if (nodesToProcess.length > 0) {
                const simLevel = level === 0 ? 3 : level;
                const newCode = removeDeadCode(code, nodesToProcess, ruleEngine, simLevel);
                newLoc += newCode.split('\n').length;
                newSize += Buffer.byteLength(newCode);
                deadCodeReport.push({
                    file, dead: nodesToProcess, newCode,
                    diff: generateDiff(code, newCode, path.relative(absolutePath, file))
                });
            } else {
                newLoc += code.split('\n').length;
                newSize += Buffer.byteLength(code);
            }
        } catch (err) {
            // Beri warning jika file gagal di-parse, jangan silent skip
            console.warn(chalk.yellow(`   [!] Gagal parse: ${path.relative(absolutePath, file)}: ${err.message?.split('\n')[0] || err.message}`));
        }
    }

    for (const f of deadFiles) {
        try { 
            const c = await fs.readFile(f, 'utf-8'); 
            originalLoc += c.split('\n').length; 
            originalSize += Buffer.byteLength(c); 
        } catch (err) { 
            if (process.env.DEBUG) console.warn(`[Warning] Gagal menghitung baris file mati ${f}:`, err.message);
        }
    }

    spinner.stop();

    // ---- Laporan ----
    const hasAnything = unusedDeps.length > 0 ||
        uncertainDeps.length > 0 ||
        dependencyDiagnostics.length > 0 ||
        deadFiles.length > 0 ||
        deadCodeReport.length > 0;
    if (!hasAnything) {
        console.log(chalk.green('\n[ok] Proyek bersih! Tidak ada dead code maupun dependensi mati.\n'));
        console.log(`   [t] ${(performance.now() - startTime).toFixed(0)} ms`);
        return;
    }

    console.log(chalk.cyan('\n====== LAPORAN ANALISIS ======'));

    // Tampilkan unsafe files warning (Conservative Safety Fallback)
    if (graph.unsafeFiles && graph.unsafeFiles.size > 0) {
        console.log(chalk.yellow(`\n================================================================================`));
        console.log(chalk.yellow(`[!] CONSERVATIVE SAFETY FALLBACK: Dynamic Code Detected (${graph.unsafeFiles.size} file)`));
        console.log(chalk.yellow(`================================================================================`));
        console.log(chalk.gray(`Peringatan: File berikut mengandung pola dinamis (eval, with, computed property,`));
        console.log(chalk.gray(`dynamic require/import) yang membatasi akurasi analisis statis.`));
        console.log(chalk.gray(`Untuk mencegah False Positive (salah hapus), seluruh ekspor DISELAMATKAN:`));
        console.log(chalk.gray(`--------------------------------------------------------------------------------`));
        for (const uf of graph.unsafeFiles) {
            console.log(chalk.gray(` - ${path.relative(absolutePath, uf)}`));
        }
        console.log(chalk.yellow(`================================================================================\n`));
    }

    if (deadCodeReport.length > 0) {
        console.log(chalk.yellow(`\n[*] Dead code SAFE di ${deadCodeReport.length} file (akan dihapus):`));
        deadCodeReport.forEach(({ file, dead, diff }) => {
            console.log(`   -> ${path.relative(absolutePath, file)}  (${dead.length} item)`);
            dead.forEach(n => console.log(`      Line ${n.line}: ${n.type} '${n.name}' ${chalk.green('[SAFE]')}`));
            console.log(chalk.gray(diff));
        });
    } else {
        console.log(chalk.green('\n[ok] Tidak ada dead code SAFE di file aktif.'));
    }

    // Tampilkan item review/risky sebagai laporan saja
    if (skippedReport.length > 0) {
        console.log(chalk.yellow(`\n[~] ${skippedReport.length} item REVIEW/RISKY (tidak dihapus, hanya dilaporkan):`));
        const byFile = {};
        skippedReport.forEach(n => {
            const rel = path.relative(absolutePath, n.file);
            if (!byFile[rel]) byFile[rel] = [];
            byFile[rel].push(n);
        });
        for (const [file, nodes] of Object.entries(byFile)) {
            console.log(`   -> ${file}`);
            nodes.forEach(n => {
                const badge = n.status === 'review' ? chalk.yellow('[REVIEW]') : chalk.red('[RISKY]');
                console.log(`      Line ${n.line}: ${n.type} '${n.name}' ${badge}`);
            });
        }
    }

    if (deadFiles.length > 0) {
        console.log(chalk.yellow(`\n[~] File mati/tak terjangkau (${deadFiles.length}):`));
        deadFiles.forEach(f => console.log(`   - ${path.relative(absolutePath, f)}`));
    }
    if (unusedDeps.length > 0) {
        console.log(chalk.yellow(`\n[+] Kandidat dependensi tidak terpakai — perlu review (${unusedDeps.length}):`));
        unusedDeps.forEach(d => console.log(`   - ${d}`));
    }
    if (uncertainDeps.length > 0) {
        console.log(chalk.yellow(`\n[?] Status dependency UNKNOWN — tidak dapat dihapus otomatis (${uncertainDeps.length}):`));
        uncertainDeps.forEach(d => console.log(`   - ${d}`));
        dependencyBlockReasons.forEach(reason => console.log(chalk.gray(`     alasan: ${reason}`)));
    }
    if (dependencyDiagnostics.length > 0) {
        console.log(chalk.yellow('\n[?] Diagnostik analisis dependency:'));
        dependencyDiagnostics.forEach(message => console.log(chalk.gray(`   - ${message}`)));
    }

    if (level === 0) {
        console.log(chalk.cyan(`\n[DRY-RUN] Mode Dry-Run (Level 0). Tidak ada perubahan fisik yang disimpan, tidak ada backup yang dibuat.`));
        console.log(chalk.gray(`   Lines to remove : ${originalLoc - newLoc} LOC`));
        console.log(chalk.gray(`   Size to reduce  : ${((originalSize - newSize) / 1024).toFixed(2)} KB\n`));
        return;
    }

    // ---- Prompt Minimal ----
    // 1. Checkbox deps (opsional)
    let selectedDepsToRemove = [];
    if (unusedDeps.length > 0 && !autoConfirm) {
        const { depsToRemove } = await inquirer.prompt([{
            type: 'checkbox', name: 'depsToRemove',
            message: 'Pilih dependensi yang sudah Anda review untuk dihapus:',
            choices: unusedDeps.map(d => ({
                name: `${d} [REVIEW]`,
                value: d,
                checked: false
            }))
        }]);
        selectedDepsToRemove = depsToRemove;
    }

    // 2. Satu konfirmasi akhir
    const parts = [
        deadCodeReport.length > 0 && `bersihkan dead code di ${deadCodeReport.length} file`,
        deadFiles.length > 0 && `hapus ${deadFiles.length} file mati`,
        selectedDepsToRemove.length > 0 && `hapus ${selectedDepsToRemove.length} dependensi`,
    ].filter(Boolean);

    if (parts.length === 0) {
        console.log(chalk.gray('\n[ok] Tidak ada perubahan yang dipilih. Selesai.\n'));
        return;
    }

    const { confirm } = autoConfirm ? { confirm: true } : await inquirer.prompt([{
        type: 'confirm', name: 'confirm',
        message: `Terapkan (Level ${level}): ${parts.join(' + ')}? (backup otomatis)`,
        default: true
    }]);
    if (!confirm) { console.log(chalk.gray('[.] Dibatalkan.\n')); return; }

    // ---- Eksekusi ----
    console.log(chalk.cyan('\n[>>] Menerapkan...'));

    const filesToBackup = [...deadFiles, ...deadCodeReport.map(r => r.file)];
    let backupDir;
    try {
        const eliminatorConfig = ruleEngine.rules.eliminator || {};
        const maxBackups = eliminatorConfig.maxBackups !== undefined ? eliminatorConfig.maxBackups : 20;
        backupDir = await createBackup(absolutePath, filesToBackup, selectedDepsToRemove.length > 0, maxBackups);
        console.log(chalk.gray(`   [ok] Checkpoint backup dibuat di ${path.relative(absolutePath, backupDir)}`));
    } catch (err) {
        console.error(chalk.red(`\n[ERROR] Gagal membuat checkpoint backup: ${err.message}`));
        console.error(chalk.red(`[ABORTED] Proses eliminasi dibatalkan demi keamanan data (Backup wajib berhasil sebelum perubahan diterapkan).\n`));
        return;
    }

    let dependencyCommandStarted = false;
    try {
        // Package manager selalu menjadi langkah terakhir sehingga tidak ada
        // mutasi source lain yang dapat gagal setelah uninstall berhasil.
        for (const f of deadFiles) {
            await fs.remove(f);
            console.log(chalk.green(`   [ok] Dihapus: ${path.relative(absolutePath, f)}`));
        }
        for (const { file, newCode } of deadCodeReport) {
            await fs.writeFile(file, newCode);
            console.log(chalk.green(`   [ok] Dibersihkan: ${path.relative(absolutePath, file)}`));
        }
        if (selectedDepsToRemove.length > 0) {
            dependencyCommandStarted = true;
            await removeUnusedDependencies(absolutePath, selectedDepsToRemove);
            console.log(chalk.green(`   [ok] ${selectedDepsToRemove.length} dependensi dihapus.`));
        }
    } catch (err) {
        console.error(chalk.red(`\n[ERROR] Terjadi kesalahan saat menerapkan perubahan: ${err.message}`));
        console.log(chalk.yellow(`[ROLLBACK] Melakukan pemulihan data dari checkpoint backup...`));
        try {
            await rollbackBackup(absolutePath, backupDir);
            console.log(chalk.green('[ROLLBACK BERHASIL] Source, manifest, dan lockfile dikembalikan ke checkpoint.'));
            if (dependencyCommandStarted) {
                console.log(chalk.yellow(
                    '[!] Package manager sempat dijalankan. Sinkronkan ulang node_modules dengan install bersih bila diperlukan.\n'
                ));
            } else {
                console.log();
            }
        } catch (rollbackErr) {
            console.error(chalk.red(`[ROLLBACK GAGAL] Gagal memulihkan dari backup: ${rollbackErr.message}\n`));
        }
        return;
    }

    const endTime = performance.now();
    console.log(chalk.green('\n[ok] Selesai!'));
    console.log(`   Lines removed : ${originalLoc - newLoc} LOC`);
    console.log(`   Size reduced  : ${((originalSize - newSize) / 1024).toFixed(2)} KB`);
    console.log(`   Waktu         : ${(endTime - startTime).toFixed(0)} ms\n`);
}
