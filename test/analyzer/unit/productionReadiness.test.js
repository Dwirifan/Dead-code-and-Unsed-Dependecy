import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';

// === Modules Under Test ===
import { RuleEngine } from '../../../src/analyzer/ruleEngine.js';
import { buildProjectGraph } from '../../../src/analyzer/graph/projectGraph.js';
import { parseCode } from '../../../src/parser/astParser.js';
import { analyzeAstCode } from '../../../src/analyzer/deadcode/astAnalyzer.js';
import { generateMermaidGraph } from '../../../src/ui/graphVisualizer.js';

describe('Production-Readiness Architectural Refinements', () => {

    it('1. Should match complex glob patterns (brace expansion, extglobs, negation) via micromatch in RuleEngine', () => {
        const engine = new RuleEngine();
        const rootDir = path.join(os.tmpdir(), 'test-project-root');
        engine.projectRoot = rootDir;
        engine.rules.preserveExports = false; // Set default false untuk menguji override

        engine.rules.overrides = [
            {
                files: ['src/**/*.{js,ts}', '!**/vendor/**'],
                preserveExports: true
            },
            {
                files: ['**/vendor/**'],
                preserveExports: false
            },
            {
                files: ['+(helpers|utils)/*.js'],
                ignorePrefixedVariables: '^_temp'
            }
        ];

        // Harus cocok dengan src/**/*.{js,ts} dan mengaktifkan preserveExports: true
        const srcRules = engine._resolveConfigForFile(path.join(rootDir, 'src/components/Button.js'));
        assert.strictEqual(srcRules.preserveExports, true, 'Seharusnya mengaktifkan preserveExports untuk src/components/Button.js');

        // Harus diabaikan oleh pola pertama karena negasi !**/vendor/**, lalu cocok dengan pola kedua (preserveExports: false)
        const vendorRules = engine._resolveConfigForFile(path.join(rootDir, 'src/vendor/external.js'));
        assert.strictEqual(vendorRules.preserveExports, false, 'Seharusnya mengabaikan vendor directory pada pola pertama dan mengikuti pola khusus vendor');

        // Harus cocok dengan extglob +(helpers|utils)/*.js
        const helperRules = engine._resolveConfigForFile(path.join(rootDir, 'helpers/math.js'));
        assert.strictEqual(helperRules.ignorePrefixedVariables, '^_temp', 'Seharusnya cocok dengan pola extglob +(helpers|utils)/*.js');
    });

    it('2. Should perform End-Consumer Tracing for multi-hop re-exports without false positives', async () => {
        const tmpDir = path.join(os.tmpdir(), `dce-prod-reexport-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
        await fs.ensureDir(tmpDir);

        try {
            await fs.writeJSON(path.join(tmpDir, 'package.json'), {
                name: 'prod-reexport-test',
                version: '1.0.0',
                main: 'index.js'
            });

            // mod.js memiliki 1 ekspor yang dipakai dan 1 ekspor yang tidak pernah dipakai
            const modPath = path.join(tmpDir, 'mod.js');
            await fs.writeFile(modPath, [
                `export function usedFunc() { return 'used'; }`,
                `export function unusedFunc() { return 'unused'; }`
            ].join('\n'));

            // barrel1.js melakukan re-export ke mod.js
            await fs.writeFile(path.join(tmpDir, 'barrel1.js'), [
                `export { usedFunc as midFunc, unusedFunc as midUnused } from './mod.js';`
            ].join('\n'));

            // barrel2.js melakukan re-export dari barrel1.js (2-hop re-export chain)
            await fs.writeFile(path.join(tmpDir, 'barrel2.js'), [
                `export { midFunc as finalFunc, midUnused as finalUnused } from './barrel1.js';`
            ].join('\n'));

            // index.js (end-consumer) hanya mengimpor dan menggunakan finalFunc
            await fs.writeFile(path.join(tmpDir, 'index.js'), [
                `import { finalFunc } from './barrel2.js';`,
                `console.log(finalFunc());`
            ].join('\n'));

            const { globalRegistry } = await buildProjectGraph(tmpDir);
            const modUsed = globalRegistry.usedExports.get(modPath) || new Set();

            // Verifikasi End-Consumer Tracing berhasil mempropagasi dari index.js -> barrel2 -> barrel1 -> mod.js
            assert.ok(modUsed.has('usedFunc'), 'Seharusnya menandai usedFunc di mod.js sebagai terpakai via 2-hop re-export chain');
            
            // Verifikasi tidak ada False Positive (unusedFunc tidak boleh dianggap terpakai hanya karena dire-export oleh barrel)
            assert.strictEqual(modUsed.has('unusedFunc'), false, 'Seharusnya TIDAK menandai unusedFunc sebagai terpakai (menghindari 1-hop false positive)');
        } finally {
            await fs.remove(tmpDir);
        }
    });

    it('3. Should trigger Conservative Safety Fallback for dynamic require(var) and protect exports', async () => {
        const code = `
            const modName = 'fs';
            const dynamicMod = require(modName);
            export function secretExport() { return 42; }
        `;
        const ast = await parseCode(code, 'dynamic.js');
        const globalRegistry = {
            usedExports: new Map(),
            unsafeFiles: new Set()
        };

        const deadCode = analyzeAstCode(ast, 'dynamic.js', globalRegistry);

        // Verifikasi file ditandai sebagai unsafe karena require(var)
        assert.ok(globalRegistry.unsafeFiles.has('dynamic.js'), 'Seharusnya menandai dynamic.js sebagai unsafe file karena dynamic require');

        // Verifikasi Conservative Safety Fallback menyelamatkan rawan false positive (secretExport tidak masuk deadCode)
        const hasSecretExport = deadCode.some(item => item.name === 'secretExport');
        assert.strictEqual(hasSecretExport, false, 'Seharusnya menyelamatkan secretExport (Conservative Safety Fallback aktif)');
    });

    it('4. Should display Conservative Safety Fallback disclosure in generateMermaidGraph when unsafeFiles exist', () => {
        const mockGraph = { liveFiles: new Set(['/src/app.js']), usedPackages: new Set(), edges: [] };
        const mockReport = {
            safeNodes: [],
            reviewNodes: [],
            riskyNodes: [],
            deadFiles: [],
            unsafeFiles: ['src/dynamic/pluginLoader.js']
        };

        const htmlReport = generateMermaidGraph(mockGraph, '/src', undefined, mockReport);
        assert.ok(htmlReport.includes('Conservative Safety Fallback: Dynamic Files'), 'HTML Report harus memuat judul Conservative Safety Fallback');
        assert.ok(htmlReport.includes('Limited Accuracy Disclosure'), 'HTML Report harus memuat penjelasan Limited Accuracy Disclosure');
        assert.ok(htmlReport.includes('src/dynamic/pluginLoader.js'), 'HTML Report harus mencantumkan nama file dinamis');
    });
});
