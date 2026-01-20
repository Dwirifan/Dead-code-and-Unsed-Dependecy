#!/usr/bin/env node

import { program } from 'commander';
import path from 'path';
import fs from 'fs-extra';
import glob from 'fast-glob';
import { parseCode } from '../src/parser/astParser.js';
import { findUnusedDependencies } from '../src/analyzer/dependencyAnalyzer.js';
import { findDeadCode } from '../src/analyzer/deadCodeAnalyzer.js';
import { removeDeadCode } from '../src/eliminator/codeCleaner.js';
import { removeUnusedDependencies } from '../src/eliminator/dependencyCleaner.js';

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

        console.log(`\n🔍 Scanning project at: ${absolutePath}\n`);

        // 1. Dependency Analysis
        try {
            const unusedDeps = await findUnusedDependencies(absolutePath);
            if (unusedDeps.length > 0) {
                console.log('📦 [Unused Dependencies]:');
                unusedDeps.forEach(d => console.log(`   - ${d}`));
            } else {
                console.log('📦 [Dependencies]: Clean');
            }
        } catch (err) {
            console.error('   Error scanning dependencies:', err.message);
        }

        // 2. Dead Code Analysis
        console.log('\n💻 [Dead Code Scanning]:');
        const files = await glob(['**/*.{js,mjs,cjs}'], {
            cwd: absolutePath,
            ignore: ['node_modules/**', 'dist/**', 'test/**', 'tests/**', 'coverage/**'],
            absolute: true
        });

        let totalDead = 0;
        for (const file of files) {
            try {
                const code = await fs.readFile(file, 'utf-8');
                const ast = parseCode(code);
                const deadNodes = findDeadCode(ast);

                if (deadNodes.length > 0) {
                    console.log(`   📄 ${path.relative(absolutePath, file)}`);
                    deadNodes.forEach(item => {
                        console.log(`      Line ${item.line}: ${item.type} '${item.name}'`);
                    });
                    totalDead += deadNodes.length;
                }
            } catch (err) {
                // Ignore parse errors for now
            }
        }

        if (totalDead === 0) {
            console.log('   ✅ No dead code found.');
        } else {
            console.log(`\n   Found ${totalDead} dead code issues.`);
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

        console.log(`\n🔍 Analyzing project at: ${absolutePath} ...\n`);

        // 1. Analyze Dependencies
        let unusedDeps = [];
        try {
            unusedDeps = await findUnusedDependencies(absolutePath);
        } catch (err) {
            console.error('   Error scanning dependencies:', err.message);
        }

        // 2. Analyze Dead Code
        const files = await glob(['**/*.{js,mjs,cjs}'], {
            cwd: absolutePath,
            ignore: ['node_modules/**', 'dist/**', 'test/**', 'tests/**', 'coverage/**'],
            absolute: true
        });

        const deadCodeReport = []; // { file, deadNodes: [] }
        for (const file of files) {
            try {
                const code = await fs.readFile(file, 'utf-8');
                const ast = parseCode(code);
                const deadNodes = findDeadCode(ast);

                if (deadNodes.length > 0) {
                    deadCodeReport.push({ file, deadNodes, ast });
                }
            } catch (err) {
                // Ignore parse errors
            }
        }

        // --- REPORTING PHASE ---
        let hasIssues = false;

        if (unusedDeps.length > 0) {
            hasIssues = true;
            console.log('📦 [Unused Dependencies to be REMOVED]:');
            unusedDeps.forEach(d => console.log(`   - ${d}`));
        }

        let totalDead = 0;
        if (deadCodeReport.length > 0) {
            hasIssues = true;
            console.log('\n💻 [Dead Code to be REMOVED]:');
            deadCodeReport.forEach(report => {
                totalDead += report.deadNodes.length;
                console.log(`   📄 ${path.relative(absolutePath, report.file)}`);
                report.deadNodes.forEach(item => {
                    console.log(`      Line ${item.line}: ${item.type} '${item.name}'`);
                });
            });
        }

        if (!hasIssues) {
            console.log('✅ Project is clean. No changes needed.');
            return;
        }

        console.log(`\n⚠️  SUMMARY: ${unusedDeps.length} dependencies and ${totalDead} code segments will be PERMANENTLY deleted.`);

        // --- INTERACTIVE CONFIRMATION ---
        
        // Dynamically import inquirer (ESM)
        const inquirer = (await import('inquirer')).default;

        const { confirm } = await inquirer.prompt([
            {
                type: 'confirm',
                name: 'confirm',
                message: 'Are you sure you want to proceed with the deletion? (This cannot be undone)',
                default: false
            }
        ]);

        if (!confirm) {
            console.log('❌ Operation cancelled by user.');
            return;
        }

        console.log('\n🚀 Proceeding with fixes...\n');

        // --- EXECUTION PHASE ---

        // 1. Fix Dependencies
        if (unusedDeps.length > 0) {
            try {
                process.stdout.write('   Cleaning dependencies... ');
                await removeUnusedDependencies(absolutePath, unusedDeps);
                console.log('Done.');
            } catch (err) {
                console.error('\n   Error fixing dependencies:', err.message);
            }
        }

        // 2. Fix Dead Code
        if (deadCodeReport.length > 0) {
            process.stdout.write('   Cleaning dead code... ');
            for (const report of deadCodeReport) {
                try {
                    // Re-clean using the stored AST to ensure consistency, 
                    // though ideally we should re-read to be safe, but locking state is fine for CLI tool flow
                    // We need to use 'report.deadNodes' which we found earlier.
                    const cleanedCode = removeDeadCode(report.ast, report.deadNodes);
                    await fs.writeFile(report.file, cleanedCode);
                } catch (err) {
                    console.warn(`\n   ⚠️  Failed to write ${path.relative(absolutePath, report.file)}: ${err.message}`);
                }
            }
            console.log('Done.');
        }

        console.log(`\n✨ Cleanup Complete.`);
    });

program.parse();
