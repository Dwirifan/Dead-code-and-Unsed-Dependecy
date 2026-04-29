import path from 'path';
import fs from 'fs-extra';
import glob from 'fast-glob';
import chalk from 'chalk';
import ora from 'ora';
import { performance } from 'perf_hooks';
import { parseCode } from '../parser/astParser.js';
import { findDeadCode } from '../analyzer/deadcode/deadCodeAnalyzer.js';
import { findUnusedDependencies } from '../analyzer/dependency/dependencyAnalyzer.js';
import { removeDeadCode } from '../eliminator/codeCleaner.js';
import { removeUnusedDependencies } from '../eliminator/dependencyCleaner.js';
import { generateDiff } from '../eliminator/diffGenerator.js';
import { createBackup } from '../eliminator/backupManager.js';
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
        .action(async (targetPath) => {
            const inquirer    = (await import('inquirer')).default;
            const absolutePath = path.resolve(targetPath);
            if (!fs.existsSync(absolutePath)) {
                console.error(`[ERROR] Path '${absolutePath}' tidak ditemukan.`);
                process.exit(1);
            }

            const startTime = performance.now();
            const stats     = await fs.stat(absolutePath);

            // ================================================================
            // MODE A: FILE TUNGGAL — analisis langsung, tidak perlu graph
            // ================================================================
            if (stats.isFile()) {
                await _fixSingleFile(absolutePath, startTime, inquirer);
                return;
            }

            // ================================================================
            // MODE B: DIREKTORI — analisis seluruh proyek via graph
            // ================================================================
            await _fixDirectory(absolutePath, startTime, inquirer);
        });
}

// ---------------------------------------------------------------------------
// Helpers (private)
// ---------------------------------------------------------------------------

async function _fixSingleFile(absolutePath, startTime, inquirer) {
    console.log(chalk.cyan(`\n[>] Fix mode: file tunggal — ${path.basename(absolutePath)}\n`));

    let code;
    try { code = await fs.readFile(absolutePath, 'utf-8'); }
    catch (e) { console.error(`[ERROR] Tidak bisa membaca file: ${e.message}`); process.exit(1); }

    const ast        = parseCode(code);
    const ruleEngine = new RuleEngine();
    const deadNodes  = findDeadCode(ast, absolutePath, new Map(), ruleEngine);

    if (deadNodes.length === 0) {
        console.log(chalk.green('[ok] File bersih! Tidak ada dead code ditemukan.\n'));
        return;
    }

    console.log(chalk.yellow(`[*] Dead code ditemukan (${deadNodes.length} item):`));
    deadNodes.forEach(n => console.log(`   Line ${n.line}: ${n.type} '${n.name}'`));

    const newCode = removeDeadCode(code, deadNodes);
    const diff    = generateDiff(code, newCode, path.basename(absolutePath));
    console.log(chalk.gray('\n--- Preview ---'));
    console.log(diff);
    console.log(chalk.gray('---------------'));

    const { ok } = await inquirer.prompt([{
        type: 'confirm', name: 'ok',
        message: `Hapus ${deadNodes.length} item dead code dari file ini? (backup otomatis dibuat)`,
        default: true
    }]);
    if (!ok) { console.log(chalk.gray('[.] Dibatalkan.\n')); return; }

    try { await createBackup(path.dirname(absolutePath), [absolutePath], false); } catch (_) {}
    await fs.writeFile(absolutePath, newCode);

    const locDiff = code.split('\n').length - newCode.split('\n').length;
    console.log(chalk.green(`\n[ok] Selesai! ${locDiff} baris dihapus. (${(performance.now() - startTime).toFixed(0)} ms)\n`));
}

async function _fixDirectory(absolutePath, startTime, inquirer) {
    console.log(chalk.cyan(`\n[>] Fix mode: direktori — ${absolutePath}`));
    const spinner    = ora('Membangun graph & mendeteksi dead code di semua file...').start();
    const ruleEngine = new RuleEngine();
    await ruleEngine.loadConfig(absolutePath);

    let graph;
    try { graph = await buildGraphWithInteractiveFallback(absolutePath, ruleEngine, spinner); }
    catch (err) { if (spinner) spinner.fail(err.message); process.exit(1); }

    // Dependensi tidak terpakai — dianalisis oleh modul dependencyAnalyzer
    let unusedDeps = [];
    try {
        const depReport = await findUnusedDependencies(absolutePath, graph.usedPackages);
        unusedDeps = depReport.unused;
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

    // Dead code di dalam live files (global, otomatis)
    const deadCodeReport = [];
    let originalLoc = 0, originalSize = 0, newLoc = 0, newSize = 0;

    for (const file of graph.liveFiles) {
        // Skip file JSON dan node_modules (tidak bisa di-parse sebagai JS/TS)
        const ext = path.extname(file);
        if (ext === '.json' || file.includes('node_modules')) continue;

        try {
            const code    = await fs.readFile(file, 'utf-8');
            originalLoc  += code.split('\n').length;
            originalSize += Buffer.byteLength(code);
            const ast     = parseCode(code);
            const dead    = findDeadCode(ast, file, graph.globalRegistry, ruleEngine);
            if (dead.length > 0) {
                const newCode = removeDeadCode(code, dead);
                newLoc  += newCode.split('\n').length;
                newSize += Buffer.byteLength(newCode);
                deadCodeReport.push({ file, dead, newCode,
                    diff: generateDiff(code, newCode, path.relative(absolutePath, file)) });
            } else {
                newLoc  += code.split('\n').length;
                newSize += Buffer.byteLength(code);
            }
        } catch (_) { /* skip file yang gagal di-parse */ }
    }

    for (const f of deadFiles) {
        try { const c = await fs.readFile(f, 'utf-8'); originalLoc += c.split('\n').length; originalSize += Buffer.byteLength(c); } catch (_) {}
    }

    spinner.stop();

    // ---- Laporan ----
    const hasAnything = unusedDeps.length > 0 || deadFiles.length > 0 || deadCodeReport.length > 0;
    if (!hasAnything) {
        console.log(chalk.green('\n[ok] Proyek bersih! Tidak ada dead code maupun dependensi mati.\n'));
        console.log(`   [t] ${(performance.now() - startTime).toFixed(0)} ms`);
        return;
    }

    console.log(chalk.cyan('\n====== LAPORAN ANALISIS ======'));
    if (deadCodeReport.length > 0) {
        console.log(chalk.yellow(`\n[*] Dead code di ${deadCodeReport.length} file:`));
        deadCodeReport.forEach(({ file, dead, diff }) => {
            console.log(`   -> ${path.relative(absolutePath, file)}  (${dead.length} item)`);
            dead.forEach(n => console.log(`      Line ${n.line}: ${n.type} '${n.name}'`));
            console.log(chalk.gray(diff));
        });
    } else {
        console.log(chalk.green('\n[ok] Tidak ada dead code di file aktif.'));
    }
    if (deadFiles.length > 0) {
        console.log(chalk.yellow(`\n[~] File mati/tak terjangkau (${deadFiles.length}):`));
        deadFiles.forEach(f => console.log(`   - ${path.relative(absolutePath, f)}`));
    }
    if (unusedDeps.length > 0) {
        console.log(chalk.yellow(`\n[+] Dependensi tidak terpakai (${unusedDeps.length}):`));
        unusedDeps.forEach(d => console.log(`   - ${d}`));
    }

    // ---- Prompt Minimal ----
    // 1. Checkbox deps (opsional)
    let selectedDepsToRemove = [];
    if (unusedDeps.length > 0) {
        const { depsToRemove } = await inquirer.prompt([{
            type: 'checkbox', name: 'depsToRemove',
            message: 'Dependensi yang ingin dihapus dari package.json:',
            choices: unusedDeps.map(d => ({ name: d, value: d, checked: true }))
        }]);
        selectedDepsToRemove = depsToRemove;
    }

    // 2. Satu konfirmasi akhir
    const parts = [
        deadCodeReport.length > 0       && `bersihkan dead code di ${deadCodeReport.length} file`,
        deadFiles.length > 0            && `hapus ${deadFiles.length} file mati`,
        selectedDepsToRemove.length > 0 && `hapus ${selectedDepsToRemove.length} dependensi`,
    ].filter(Boolean);

    if (parts.length === 0) {
        console.log(chalk.gray('\n[ok] Tidak ada perubahan yang dipilih. Selesai.\n'));
        return;
    }

    const { confirm } = await inquirer.prompt([{
        type: 'confirm', name: 'confirm',
        message: `Terapkan: ${parts.join(' + ')}? (backup otomatis)`,
        default: true
    }]);
    if (!confirm) { console.log(chalk.gray('[.] Dibatalkan.\n')); return; }

    // ---- Eksekusi ----
    console.log(chalk.cyan('\n[>>] Menerapkan...'));

    const filesToBackup = [...deadFiles, ...deadCodeReport.map(r => r.file)];
    try {
        await createBackup(absolutePath, filesToBackup, selectedDepsToRemove.length > 0);
        console.log(chalk.gray('   [ok] Checkpoint backup dibuat di .deadkiller_backup/'));
    } catch (err) {
        console.log(chalk.yellow(`   [!] Backup gagal: ${err.message}`));
    }

    if (selectedDepsToRemove.length > 0) {
        await removeUnusedDependencies(absolutePath, selectedDepsToRemove);
        console.log(chalk.green(`   [ok] ${selectedDepsToRemove.length} dependensi dihapus.`));
    }
    for (const f of deadFiles) {
        await fs.remove(f);
        console.log(chalk.green(`   [ok] Dihapus: ${path.relative(absolutePath, f)}`));
    }
    for (const { file, newCode } of deadCodeReport) {
        await fs.writeFile(file, newCode);
        console.log(chalk.green(`   [ok] Dibersihkan: ${path.relative(absolutePath, file)}`));
    }

    const endTime = performance.now();
    console.log(chalk.green('\n[ok] Selesai!'));
    console.log(`   Lines removed : ${originalLoc - newLoc} LOC`);
    console.log(`   Size reduced  : ${((originalSize - newSize) / 1024).toFixed(2)} KB`);
    console.log(`   Waktu         : ${(endTime - startTime).toFixed(0)} ms\n`);
}
