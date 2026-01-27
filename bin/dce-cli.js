#!/usr/bin/env node

import { program } from 'commander';
import path from 'path';
import fs from 'fs-extra';
import glob from 'fast-glob';
import { parseCode } from '../src/parser/astParser.js';
import { findUnusedDependencies } from '../src/analyzer/dependencyAnalyzer.js';
import { findDeadCode } from '../src/analyzer/deadcode/deadCodeAnalyzer.js';
import { removeDeadCode } from '../src/eliminator/codeCleaner.js';
import { removeUnusedDependencies } from '../src/eliminator/dependencyCleaner.js';
import { buildProjectGraph } from '../src/analyzer/projectGraph.js';
import { generateDiff } from '../src/eliminator/diffGenerator.js';
import { generateMermaidGraph } from '../src/analyzer/graphVisualizer.js';

program
    .name('deadkiller')
    .description('Automated Dead Code and Unused Dependency Eliminator')
    .version('1.0.0');

// Command: SCAN
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

        console.log(`\n🔍 Scanning project at: ${absolutePath}`);
        console.log('   (Using Graph Reachability Analysis)\n');

        // A & B: Build Graph
        let graph;
        try {
            graph = await buildProjectGraph(absolutePath);
        } catch (err) {
            console.error('❌ Graph Build Failed:', err.message);
            process.exit(1);
        }

        // Logic D: Unused Dependencies (Compare graph.usedPackages vs package.json)
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

        // Logic B (Dead Files): Files on disk but NOT in graph.liveFiles
        const allFiles = await glob(['**/*.{js,mjs,cjs}'], {
            cwd: absolutePath,
            ignore: ['node_modules/**', 'dist/**', 'test/**', 'tests/**', 'coverage/**'],
            absolute: true
        });
        
        const deadFiles = allFiles.filter(f => !graph.liveFiles.has(f));
        let totalIssues = 0;

        if (deadFiles.length > 0) {
            console.log('\n📄 [Unreachable / Dead Files]:');
            deadFiles.forEach(f => console.log(`   - ${path.relative(absolutePath, f)}`));
            totalIssues += deadFiles.length;
        }

        // Logic C: Dead Code in LIVE files only
        console.log('\n💻 [Dead Code Scanning (Live Files Only)]:');
        
        for (const file of graph.liveFiles) {
            try {
                const code = await fs.readFile(file, 'utf-8');
                const ast = parseCode(code);
                const deadNodes = findDeadCode(ast);

                if (deadNodes.length > 0) {
                    console.log(`   📄 ${path.relative(absolutePath, file)}`);
                    deadNodes.forEach(item => {
                        console.log(`      Line ${item.line}: ${item.type} '${item.name}'`);
                    });
                    totalIssues += deadNodes.length;
                }
            } catch (err) {
                // Ignore parse errors
            }
        }

        if (totalIssues === 0 && deadFiles.length === 0) {
            console.log('   ✅ No dead code found.');
        }
    });

// Command: FIX
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

        console.log(`\n🔍 Analyzing project at: ${absolutePath}`);
        
        // Build Graph
        let graph;
        try {
            graph = await buildProjectGraph(absolutePath);
        } catch (err) {
            console.error('❌ Graph Build Failed:', err.message);
            process.exit(1);
        }

        // 1. Dependencies
        const pkgPath = path.join(absolutePath, 'package.json');
        const pkg = await fs.readJson(pkgPath);
        const allDeps = new Set(Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }));
        const unusedDeps = [...allDeps].filter(d => !graph.usedPackages.has(d));

        // 2. Dead Files
        const allFiles = await glob(['**/*.{js,mjs,cjs}'], {
            cwd: absolutePath,
            ignore: ['node_modules/**', 'dist/**', 'test/**', 'tests/**', 'coverage/**'],
            absolute: true
        });
        const deadFiles = allFiles.filter(f => !graph.liveFiles.has(f));

        // 3. Dead Code (Live Files) - PREPARE & DIFF
        const deadCodeReport = [];
        const diffs = [];

        for (const file of graph.liveFiles) {
            try {
                const code = await fs.readFile(file, 'utf-8');
                const ast = parseCode(code);
                const deadNodes = findDeadCode(ast);
                if (deadNodes.length > 0) {
                    // DRY RUN: Generate New Code in Memory
                    const newCode = removeDeadCode(ast, deadNodes);
                    
                    // Generate Diff
                    const diffOutput = generateDiff(code, newCode, path.relative(absolutePath, file));
                    diffs.push(diffOutput);

                    deadCodeReport.push({ file, deadNodes, ast, newCode });
                }
            } catch (err) {}
        }

        // --- REPORT ---
        if (unusedDeps.length === 0 && deadFiles.length === 0 && deadCodeReport.length === 0) {
            console.log('✅ Project is clean.');
            return;
        }

        if (unusedDeps.length > 0) {
            console.log('\n📦 [Unused Dependencies to be REMOVED]:');
            unusedDeps.forEach(d => console.log(`   - ${d}`));
        }
        if (deadFiles.length > 0) {
            console.log('\n🗑️  [Dead Files to be DELETED]:');
            deadFiles.forEach(f => console.log(`   - ${path.relative(absolutePath, f)}`));
        }

        if (diffs.length > 0) {
            console.log('\n📝 [Code Changes Preview]:');
            console.log('==================================================');
            diffs.forEach(diff => {
                console.log(diff);
                console.log('--------------------------------------------------');
            });
        }

        // --- CONFIRM ---
        const inquirer = (await import('inquirer')).default;
        const { confirm } = await inquirer.prompt([{
            type: 'confirm',
            name: 'confirm',
            message: 'Are you sure you want to apply these changes?',
            default: false
        }]);

        if (!confirm) {
            console.log('❌ Cancelled.');
            return;
        }

        console.log('\n🚀 Applying fixes...');

        // EXECUTE
        // 1. Remove Deps
        if (unusedDeps.length > 0) {
            await removeUnusedDependencies(absolutePath, unusedDeps);
            console.log('   ✅ Dependencies cleaned.');
        }

        // 2. Remove Dead Files
        for (const f of deadFiles) {
            await fs.remove(f);
            console.log(`   ✅ Deleted file: ${path.relative(absolutePath, f)}`);
        }

        // 3. Clean Dead Code (Write from memory to disk)
        for (const report of deadCodeReport) {
            await fs.writeFile(report.file, report.newCode); // Use the code we already generated
            console.log(`   ✅ Cleaned code: ${path.relative(absolutePath, report.file)}`);
        }

        console.log('✨ Done.');
    });

// Command: VISUALIZE
program
    .command('visualize')
    .argument('<path>', 'Path to project directory')
    .description('Generate a Mermaid graph of the project structure')
    .action(async (targetPath) => {
        const absolutePath = path.resolve(targetPath);
        if (!fs.existsSync(absolutePath)) {
            console.error(`❌ Error: Path '${absolutePath}' not found.`);
            process.exit(1);
        }

        console.log(`\n🔍 Analyzing project at: ${absolutePath}`);

        try {
            const graph = await buildProjectGraph(absolutePath);
            const mermaidContent = generateMermaidGraph(graph, absolutePath);
            
            const outputPath = path.join(absolutePath, 'project-graph.mmd');
            await fs.writeFile(outputPath, mermaidContent);
            
            console.log(`\n✨ Graph generated: ${outputPath}`);
            console.log('   (Preview this file using Mermaid Live Editor or VSCode extensions)');
        } catch (err) {
            console.error('❌ Visualization Failed:', err.message);
            process.exit(1);
        }
    });

program.parse();
