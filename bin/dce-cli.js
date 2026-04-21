#!/usr/bin/env node

import { program } from 'commander';
import path from 'path';
import fs from 'fs-extra';
import glob from 'fast-glob';
import { parseCode } from '../src/parser/astParser.js';
import { findDeadCode } from '../src/analyzer/deadcode/deadCodeAnalyzer.js';
import { removeDeadCode } from '../src/eliminator/codeCleaner.js';
import { removeUnusedDependencies } from '../src/eliminator/dependencyCleaner.js';
import { buildProjectGraph } from '../src/analyzer/projectGraph.js';
import { generateDiff } from '../src/eliminator/diffGenerator.js';
import { generateMermaidGraph } from '../src/analyzer/graphVisualizer.js';
import { createBackup } from '../src/eliminator/backupManager.js';
import { RuleEngine } from '../src/analyzer/ruleEngine.js';
import chalk from 'chalk';
import ora from 'ora';
import { performance } from 'perf_hooks';

program
    .name('deadkiller')
    .description('Automated Dead Code and Unused Dependency Eliminator')
    .version('1.0.0');

// Perintah: SCAN (Pelacakan Kering)
program
    .command('scan')
    .argument('<path>', 'Path to project directory')
    .description('Scan project for dead code and unused dependencies without modifying files')
    .action(async (targetPath) => {
        const absolutePath = path.resolve(targetPath);
        if (!fs.existsSync(absolutePath)) {
            console.error(`❌ Error: Path '${absolutePath}' not found.`);
            process.exit(1);
        }

        const startTime = performance.now();
        const stats = await fs.stat(absolutePath);

        // --- MODE PELACAKAN SATU FILE ---
        if (stats.isFile()) {
            console.log(`\n🔍 Scanning single file: ${path.basename(absolutePath)}`);
            try {
                const code = await fs.readFile(absolutePath, 'utf-8');
                const ast = parseCode(code);
                const deadNodes = findDeadCode(ast);

                if (deadNodes.length > 0) {
                    console.log(`\n💻 [Dead Code Report]:`);
                    console.log(`   📄 ${path.relative(process.cwd(), absolutePath)}`);
                    deadNodes.forEach(item => {
                        console.log(`      Line ${item.line}: ${item.type} '${item.name}'`);
                    });
                    console.log(`\n❌ Found ${deadNodes.length} issues.`);
                } else {
                    console.log('\n✅ No dead code found in this file.');
                }
            } catch (err) {
                console.error('❌ Analysis Failed:', err.message);
                process.exit(1);
            }
            return;
        }

        // --- MODE DIREKTORI (Pelacakan Proyek Global) ---
        console.log(`\n🔍 Menganalisis proyek di: ${chalk.cyan(absolutePath)}`);
        
        const spinner = ora('Membangun Graph Ketergantungan (Reachability Analysis)...').start();

        const ruleEngine = new RuleEngine();
        await ruleEngine.loadConfig(absolutePath);

        // Fase A & B: Membangun Struktur Graf Proyek
        let graph;
        try {
            graph = await buildProjectGraph(absolutePath);
        } catch (err) {
            spinner.fail('Gagal membangun struktur graf proyek!');
            console.error(err.message);
            process.exit(1);
        }
        spinner.succeed(`Graf terbentuk: ${graph.liveFiles.size} File Aktif dipetakan.`);

        // Logika D: Mendeteksi Dependensi Tak Terpakai (Bandingkan graf.usedPackages vs package.json)
        const pkgPath = path.join(absolutePath, 'package.json');
        const pkg = await fs.readJson(pkgPath);
        const allDeps = new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }));
        const unusedDeps = [...allDeps].filter(d => !graph.usedPackages.has(d));

        if (unusedDeps.length > 0) {
            console.log('📦 [Unused Dependencies]:');
            unusedDeps.forEach(d => console.log(`   - ${d}`));
        } else {
            console.log('📦 [Dependencies]: Clean');
        }

        // Logika B: Menyaring File Yatim/Mati (Ada di disk tapi tak dipetakan di Graf)
        const allFiles = await glob(['**/*.{js,mjs,cjs,ts,tsx,mts}'], {
            cwd: absolutePath,
            ignore: ['node_modules/**', 'dist/**', 'test/**', 'tests/**', 'coverage/**'],
            absolute: true
        });
        
        const rawDeadFiles = allFiles.filter(f => !graph.liveFiles.has(f));
        const deadFiles = rawDeadFiles.filter(f => !ruleEngine.isIgnoredFile(f, absolutePath));
        let totalIssues = 0;

        if (deadFiles.length > 0) {
            console.log('\n📄 [Unreachable / Dead Files]:');
            deadFiles.forEach(f => console.log(`   - ${path.relative(absolutePath, f)}`));
            totalIssues += deadFiles.length;
        }

        // Logika C: Melacak Dead Code (Hanya di dalam rentang file yang Hidup)
        const scanSpinner = ora('Melacak Dead Code di seluruh File Aktif...').start();
        console.log('\n💻 [Dead Code Scanning (Live Files Only)]:');
        
        for (const file of graph.liveFiles) {
            try {
                const code = await fs.readFile(file, 'utf-8');
                const ast = parseCode(code);
                const deadNodes = findDeadCode(ast, file, graph.globalRegistry, ruleEngine);

                if (deadNodes.length > 0) {
                    console.log(`   📄 ${path.relative(absolutePath, file)}`);
                    deadNodes.forEach(item => {
                        console.log(`      Line ${item.line}: ${item.type} '${item.name}'`);
                    });
                    totalIssues += deadNodes.length;
                }
            } catch (err) {
                console.warn(chalk.yellow(`   ⚠️  Warning: Failed to parse ${path.relative(absolutePath, file)}: ${err.message}`));
            }
        }

        scanSpinner.stop();
        if (totalIssues === 0 && deadFiles.length === 0) {
            console.log('   ✅ Tidak ada dead code yang tertinggal!');
        }

        const endTime = performance.now();
        console.log(`\n⏱️  Analysis Time: ${(endTime - startTime).toFixed(2)} ms`);
    });

// Perintah: FIX (Pemangkasan Fisik Berbasis Interaktif)
program
    .command('fix')
    .argument('<path>', 'Path to project directory')
    .description('Scan and automatically remove dead code and unused dependencies')
    .action(async (targetPath) => {
        const absolutePath = path.resolve(targetPath);
        if (!fs.existsSync(absolutePath)) {
            console.error(`❌ Error: Path '${absolutePath}' not found.`);
            process.exit(1);
        }

        console.log(`\n🔍 Menganalisis proyek di: ${chalk.cyan(absolutePath)}`);
        const startTime = performance.now();
        const ruleEngine = new RuleEngine();
        await ruleEngine.loadConfig(absolutePath);
        
        const spinner = ora('Membangun Graph dan melacak Dead Code...').start();

        // Build Graph
        let graph;
        try {
            graph = await buildProjectGraph(absolutePath);
        } catch (err) {
            spinner.fail('Gagal membangun graf');
            console.error(err.message);
            process.exit(1);
        }

        // 1. Dependencies
        const pkgPath = path.join(absolutePath, 'package.json');
        const pkg = await fs.readJson(pkgPath);
        const allDeps = new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }));
        const unusedDeps = [...allDeps].filter(d => !graph.usedPackages.has(d));

        // 2. Dead Files
        const allFiles = await glob(['**/*.{js,mjs,cjs,ts,tsx,mts}'], {
            cwd: absolutePath,
            ignore: ['node_modules/**', 'dist/**', 'test/**', 'tests/**', 'coverage/**'],
            absolute: true
        });
        const rawDeadFiles = allFiles.filter(f => !graph.liveFiles.has(f));
        const deadFiles = rawDeadFiles.filter(f => !ruleEngine.isIgnoredFile(f, absolutePath));

        // 3. Pemrosesan Dead Code (Live Files) - PERSIAPAN & PRALIHAT (DIFF)
        const deadCodeReport = [];
        const diffs = [];
        let originalLoc = 0;
        let originalSize = 0;
        let newLoc = 0;
        let newSize = 0;

        for (const file of deadFiles) {
             const code = await fs.readFile(file, 'utf-8');
             originalLoc += code.split('\n').length;
             originalSize += Buffer.byteLength(code);
        }

        for (const file of graph.liveFiles) {
            try {
                const code = await fs.readFile(file, 'utf-8');
                originalLoc += code.split('\n').length;
                originalSize += Buffer.byteLength(code);

                const ast = parseCode(code);
                const deadNodes = findDeadCode(ast, file, graph.globalRegistry, ruleEngine);
                if (deadNodes.length > 0) {
                    // DRY RUN: Manipulasi ke String Memori untuk disiapkan (menggunakan magic-string)
                    const newCode = removeDeadCode(code, deadNodes);
                    
                    newLoc += newCode.split('\n').length;
                    newSize += Buffer.byteLength(newCode);

                    // Generate Diff
                    const diffOutput = generateDiff(code, newCode, path.relative(absolutePath, file));
                    diffs.push({ diffOutput, file });

                    deadCodeReport.push({ file, deadNodes, ast, newCode });
                } else {
                    newLoc += code.split('\n').length;
                    newSize += Buffer.byteLength(code);
                }
            } catch (err) {
                // Ignore parse failures
            }
        }
        spinner.stop();

        // --- PELAPORAN & SELEKSI PENGHAPUSAN ---
        if (unusedDeps.length === 0 && deadFiles.length === 0 && deadCodeReport.length === 0) {
            console.log('✅ Project is clean.');
            return;
        }

        const inquirer = (await import('inquirer')).default;
        let selectedDepsToRemove = [];

        if (unusedDeps.length > 0) {
            console.log('\n📦 [Unused Dependencies Detected]:');
            const { depsToRemove } = await inquirer.prompt([{
                type: 'checkbox',
                name: 'depsToRemove',
                message: 'Select unused dependencies to remove:',
                choices: unusedDeps.map(d => ({ name: d, value: d, checked: true }))
            }]);
            selectedDepsToRemove = depsToRemove;
        }

        let finalDeadFiles = [];
        if (deadFiles.length > 0) {
            console.log('\n🗑️  [Dead Files/Orphaned Files Detected]:');
            const { filesToRemove } = await inquirer.prompt([{
                type: 'checkbox',
                name: 'filesToRemove',
                message: 'Pilih File Yatim (Dead Files) yang ingin Anda HAPUS dari penyimpanan:',
                choices: deadFiles.map(f => ({ name: path.relative(absolutePath, f), value: f, checked: false }))
            }]);
            finalDeadFiles = filesToRemove;
        }

        if (diffs.length > 0) {
            console.log('\n📝 [Code Changes Preview]:');
            console.log('==================================================');
            diffs.forEach(({ diffOutput, file }) => {
                if (graph.unsafeFiles.has(file)) {
                    console.log(chalk.yellow(`⚠️  WARNING: ${path.basename(file)} contains dynamic code (eval/with/computed). Optimization is conservative.`));
                }
                console.log(diffOutput);
                console.log('--------------------------------------------------');
            });
        }

        if (selectedDepsToRemove.length === 0 && finalDeadFiles.length === 0 && diffs.length === 0) {
            console.log('\n✅ Tidak ada perubahan fisik yang dipilih / dieksekusi. Selesai.');
            const endTime = performance.now();
            console.log(`   ⏱️  Analysis Time: ${(endTime - startTime).toFixed(2)} ms`);
            return;
        }

        // --- KONFIRMASI AKHIR ---
        const { confirm } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: 'Are you sure you want to apply these physical changes?',
            default: false
        }]);

        if (!confirm) {
            console.log('❌ Cancelled.');
            return;
        }

        console.log('\n🚀 Menerapkan pembersihan (Applying Fixes)...');

        // 0. MENCIPTAKAN TITIK PEMULIHAN (BACKUP) SEBELUM MENGUBAH FISIK FILE
        const backupSpinner = ora('Membuat File Backup Keamanan (Checkpoint)...').start();
        const filesToBackup = [
            ...finalDeadFiles,
            ...deadCodeReport.map(report => report.file)
        ];
        const backupPackageJson = selectedDepsToRemove.length > 0;
        
        try {
            const backupPath = await createBackup(absolutePath, filesToBackup, backupPackageJson);
            backupSpinner.succeed(`Keamanan Terjamin! Backup dibuat di folder .deadkiller_backup`);
        } catch (err) {
            backupSpinner.warn(`Gagal membuat backup penuh. Lanjut berisiko: ${err.message}`);
        }

        // EKSEKUSI FISIK
        // 1. Membersihkan Dependensi
        if (selectedDepsToRemove.length > 0) {
            await removeUnusedDependencies(absolutePath, selectedDepsToRemove);
            console.log('   ✅ Dependencies cleaned.');
        }

        // 2. Remove Dead Files
        for (const f of finalDeadFiles) {
            await fs.remove(f);
            console.log(`   ✅ Menghapus File: ${path.relative(absolutePath, f)}`);
        }

        // 3. Membersihkan Dead Code (Menimpa ulang source code ke disk)
        for (const report of deadCodeReport) {
            await fs.writeFile(report.file, report.newCode); // Use the code we already generated
            console.log(`   ✅ Cleaned code: ${path.relative(absolutePath, report.file)}`);
        }

        console.log('\n✨ Done.');
        console.log(`\n📊 [Impact Metrics]:`);
        console.log(`   📉 Total Lines Removed: ${originalLoc - newLoc} LOC`);
        console.log(`   🗜️ Total Size Reduced: ${((originalSize - newSize) / 1024).toFixed(2)} KB`);
        
        const endTime = performance.now();
        console.log(`   ⏱️  Analysis Time: ${(endTime - startTime).toFixed(2)} ms`);
    });

// Perintah: SHOW-DEPS (Bedah Dependensi)
program
    .command('show-deps')
    .argument('<path>', 'Path to project directory')
    .description('Show a summarized list of installed dependencies and devDependencies from package.json')
    .action(async (targetPath) => {
        const absolutePath = path.resolve(targetPath);
        const pkgPath = path.join(absolutePath, 'package.json');
        
        if (!fs.existsSync(pkgPath)) {
            console.error(`❌ Error: 'package.json' not found at '${absolutePath}'.`);
            process.exit(1);
        }

        try {
            const pkg = await fs.readJson(pkgPath);
            const chalk = (await import('chalk')).default;

            console.log(`\n📦 Dependencies mapped for: ${chalk.cyan(pkg.name || path.basename(absolutePath))}\n`);

            if (pkg.dependencies && Object.keys(pkg.dependencies).length > 0) {
                console.log(chalk.bold.green('=== Dependencies ==='));
                for (const [dep, version] of Object.entries(pkg.dependencies)) {
                    console.log(`  ${chalk.white(dep)}: ${chalk.gray(version)}`);
                }
                console.log();
            } else {
                console.log(chalk.gray('No standard dependencies found.\n'));
            }

            if (pkg.devDependencies && Object.keys(pkg.devDependencies).length > 0) {
                console.log(chalk.bold.yellow('=== devDependencies ==='));
                for (const [dep, version] of Object.entries(pkg.devDependencies)) {
                    console.log(`  ${chalk.white(dep)}: ${chalk.gray(version)}`);
                }
                console.log();
            } else {
                console.log(chalk.gray('No devDependencies found.\n'));
            }

        } catch (err) {
            console.error(`❌ Failed to read or parse package.json: ${err.message}`);
            process.exit(1);
        }
    });

// Perintah: VISUALIZE (Keterlacakan Visual Dashboard HTML)
program
    .command('visualize')
    .argument('<path>', 'Path to project directory')
    .description('Menganalisis Proyek dan menampilkan Code Structure Traceability HTML Dashboard')
    .action(async (targetPath) => {
        const absolutePath = path.resolve(targetPath);
        if (!fs.existsSync(absolutePath)) {
            console.error(`❌ Error: Path '${absolutePath}' tidak ditemukan.`);
            process.exit(1);
        }

        console.log(`\n🔍 Menganalisis Celah Proyek untuk Traceability di: ${chalk.cyan(absolutePath)}`);
        const spinner = ora('Menambang struktur dan membangun Interactive HTML Map...').start();

        try {
            const graph = await buildProjectGraph(absolutePath);
            
            // Baca Package JSON
            const pkgPath = path.join(absolutePath, 'package.json');
            let pkgData = { dependencies: {}, devDependencies: {} };
            if (fs.existsSync(pkgPath)) {
                pkgData = await fs.readJson(pkgPath);
            }

            const htmlContent = generateMermaidGraph(graph, absolutePath, pkgData);
            
            const outputPath = path.join(absolutePath, 'code-structure-trace.html');
            await fs.writeFile(outputPath, htmlContent);
            
            spinner.succeed(`Berhasil! Dashboard Keterlacakan dibuat: ${outputPath}`);
            
            // Buka di Default Browser secara otomatis
            const { exec } = await import('child_process');
            let command;
            switch (process.platform) {
                case 'darwin': command = `open "${outputPath}"`; break;
                case 'win32': command = `start "" "${outputPath}"`; break;
                default: command = `xdg-open "${outputPath}"`; break;
            }
            exec(command);
            
            console.log(chalk.green('   🌐 Browser lokal Anda akan terbuka untuk menampilkan Dashboard Traceability.'));
        } catch (err) {
            spinner.fail('Visualisasi Gagal');
            console.error(err.message);
            process.exit(1);
        }
    });

// 🚀 ENGINE STARTUP ORCHESTRATOR
if (process.argv.length === 2) {
    import('../src/ui/wizard.js').then(({ launchWizard }) => {
        launchWizard();
    }).catch(err => {
        console.error("Gagal meluncurkan antarmuka Wizard UI:", err);
    });
} else {
    program.parse(process.argv);
}
