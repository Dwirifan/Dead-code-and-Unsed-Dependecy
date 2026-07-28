import { describe, it, beforeAll, afterAll } from 'vitest';
import assert from 'node:assert/strict';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';

import { RuleEngine } from '../../../src/analyzer/ruleEngine.js';
import { buildProjectGraph } from '../../../src/analyzer/graph/projectGraph.js';
import { findUnusedDependencies } from '../../../src/analyzer/dependency/dependencyAnalyzer.js';
import { parseCode } from '../../../src/parser/astParser.js';
import { findDeadCode } from '../../../src/analyzer/deadcode/index.js';

describe('Integration Pipeline (Graph + Analyzer + Dependency)', () => {
    let tempDir;

    beforeAll(async () => {
        // 1. Buat direktori mock
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deadkiller-pipeline-'));

        // 2. Buat package.json (lodash akan menjadi unused dependency)
        await fs.writeJson(path.join(tempDir, 'package.json'), {
            name: "test-integration",
            dependencies: {
                "chalk": "^4.1.2",
                "lodash": "^4.17.21"
            }
        });

        // 3. Buat deadkiller.config.js (Rule Engine test)
        await fs.writeFile(
            path.join(tempDir, 'deadkiller.config.js'),
            `export default { ignorePrefixedVariables: '^_', preserveExports: 'strict' };`
        );

        // 4. Buat source files
        const srcDir = path.join(tempDir, 'src');
        await fs.mkdir(srcDir);

        // File: src/index.js (Entry Point)
        await fs.writeFile(path.join(srcDir, 'index.js'), `
            import { add } from './math.js';
            import chalk from 'chalk';
            
            const unusedVar = 42; // Harus terdeteksi mati
            const _protectedVar = chalk.green('init'); // Harus dilindungi oleh Rule Engine karena side-effect
            
            console.log(chalk.green(add(1, 2)));
        `);

        // File: src/math.js
        await fs.writeFile(path.join(srcDir, 'math.js'), `
            export function add(a, b) {
                return a + b;
            }
            
            export function deadExport() {
                // Harus terdeteksi mati karena tidak diimport siapa pun
                return "I am dead";
            }
        `);
    });

    afterAll(async () => {
        if (tempDir) {
            await fs.remove(tempDir);
        }
    });

    it('TC-INT01: Pipeline mengeksekusi analisis secara terpadu', async () => {
        // --- TAHAP 1: INISIALISASI RULE ENGINE ---
        const ruleEngine = new RuleEngine();
        await ruleEngine.loadConfig(tempDir);
        
        // Assert Rule Engine berhasil dimuat
        assert.ok(ruleEngine.isIgnoredVariable('_protectedVar'), 'Rule Engine harus melindungi variabel berawalan _');

        // --- TAHAP 2: GRAPH BUILDER ---
        const graph = await buildProjectGraph(tempDir, ruleEngine);
        
        assert.ok(graph.liveFiles.size >= 2, 'Minimal 2 file (index.js, math.js) harus dipetakan');
        assert.ok(graph.usedPackages.has('chalk'), 'chalk harus terdeteksi digunakan');
        assert.ok(!graph.usedPackages.has('lodash'), 'lodash tidak boleh terdeteksi digunakan');

        // --- TAHAP 3: DEPENDENCY ANALYZER ---
        const depReport = await findUnusedDependencies(tempDir, graph.usedPackages);
        const unusedDeps = depReport.unused;
        
        assert.ok(unusedDeps.includes('lodash'), 'lodash harus dilaporkan sebagai unused dependency');
        assert.ok(!unusedDeps.includes('chalk'), 'chalk tidak boleh dilaporkan unused');

        // --- TAHAP 4: AST DEAD CODE ANALYZER ---
        const allDeadCodeIssues = [];
        
        for (const filePath of graph.liveFiles) {
            const code = await fs.readFile(filePath, 'utf-8');
            const ast = await parseCode(code, filePath);
            
            // Analisis per file
            const fileIssues = findDeadCode(ast, filePath, graph.globalRegistry, ruleEngine);
            allDeadCodeIssues.push(...fileIssues);
        }

        // --- TAHAP 5: VALIDASI AKHIR PIPELINE ---
        
        // 1. Pastikan 'unusedVar' terdeteksi mati
        const hasUnusedVar = allDeadCodeIssues.some(issue => issue.name === 'unusedVar');
        assert.ok(hasUnusedVar, 'Pipeline gagal mendeteksi unusedVar');

        // 2. Pastikan '_protectedVar' DILINDUNGI (tidak ada dalam daftar dead code)
        const hasProtectedVar = allDeadCodeIssues.some(issue => issue.name === '_protectedVar');
        assert.ok(!hasProtectedVar, 'Pipeline gagal melindungi _protectedVar (Rule Engine bypass)');

        // 3. Pastikan 'deadExport' terdeteksi mati (Cross-file unused export)
        const hasDeadExport = allDeadCodeIssues.some(issue => issue.name === 'deadExport');
        assert.ok(hasDeadExport, 'Pipeline gagal mendeteksi deadExport dari math.js');

        // 4. Pastikan 'add' TIDAK terdeteksi mati (Karena di-import dan dipakai)
        const hasAddFunc = allDeadCodeIssues.some(issue => issue.name === 'add');
        assert.ok(!hasAddFunc, 'Pipeline salah mendeteksi fungsi add() yang terpakai sebagai mati');
    });
});
