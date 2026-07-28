import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { parseCode } from '../../../../../src/parser/astParser.js';
import { findDeadCode } from '../../../../../src/analyzer/deadcode/index.js';
import { RuleEngine } from '../../../../../src/analyzer/ruleEngine.js';
async function analisis(kode, ruleEngine = new RuleEngine()) {
    const ast = await parseCode(kode, 'test.js');
    return findDeadCode(ast, 'test.js', null, ruleEngine);
}

describe('Redundancy Analyzer — Redundant Patterns', () => {

    // Test 100
    it('TC-100: x = 1; x = 2; → first assignment redundant', async () => {
        const code = `let x;\nx = 1;\nx = 2;\nconsole.log(x);`;
        const results = await analisis(code);
        const redundant = results.filter(r => r.type === 'RedundantCode' && r.name.includes('Redundant Assignment'));
        assert.ok(redundant.length > 0, 'First assignment is overwritten');
    });

    // Test 101
    it('TC-101: x = 1; x = x + 1; → TIDAK redundant (reads x)', async () => {
        const code = `let x;\nx = 1;\nx = x + 1;\nconsole.log(x);`;
        const results = await analisis(code);
        const redundant = results.filter(r => r.type === 'RedundantCode' && r.name.includes('Redundant Assignment'));
        assert.strictEqual(redundant.length, 0, 'Second reads x → first is needed');
    });

    // Test 102
    it('TC-102: x = x; → self-assignment', async () => {
        const code = `let x = 5;\nx = x;`;
        const results = await analisis(code);
        const self = results.filter(r => r.type === 'RedundantCode' && r.name.includes('Self-Assignment'));
        assert.ok(self.length > 0, 'Self-assignment terdeteksi');
    });

    // Test 103
    it('TC-103: function f() { return; } → redundant return', async () => {
        const code = `function f() { console.log("test"); return; }`;
        const results = await analisis(code);
        const redundant = results.filter(r => r.type === 'RedundantCode' && r.name.includes('Redundant Return'));
        assert.ok(redundant.length > 0, 'return; di akhir fungsi redundant');
    });

    // Test 104
    it('TC-104: function f() { return undefined; } → redundant return undefined', async () => {
        const code = `function f() { console.log("test"); return undefined; }`;
        const results = await analisis(code);
        const redundant = results.filter(r => r.type === 'RedundantCode' && r.name.includes('Redundant Return'));
        assert.ok(redundant.length > 0, 'return undefined; redundant');
    });

    // Test 105
    it('TC-105: function f() { return 42; } → BUKAN redundant', async () => {
        const code = `function f() { return 42; }`;
        const results = await analisis(code);
        const redundant = results.filter(r => r.type === 'RedundantCode' && r.name.includes('Redundant Return'));
        assert.strictEqual(redundant.length, 0, 'return 42 bukan redundant');
    });

    // Test 106
    it('TC-106: 42; sebagai standalone expression → useless', async () => {
        const code = `function f() { 42; }`;
        const results = await analisis(code);
        const useless = results.filter(r => r.type === 'RedundantCode' && r.name.includes('Useless Expression'));
        assert.ok(useless.length > 0, 'Standalone literal useless');
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 18: SWITCH-CASE ADVANCED (4 Tests)
// ═════════════════════════════════════════════════════════════════════════