import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

// === Module Under Test ===
import { parseCode, ParseError } from '../../../../../src/parser/astParser.js';
import { findDeadCode } from '../../../../../src/analyzer/deadcode/deadCodeAnalyzer.js';
import { removeDeadCode } from '../../../../../src/eliminator/codeCleaner.js';
import { RuleEngine } from '../../../../../src/analyzer/ruleEngine.js';
import { Scope } from '../../../../../src/analyzer/deadcode/core/scope.js';
import { buildCFG, buildCallGraph, analyzePathSensitive } from '../../../../../src/analyzer/deadcode/core/flowAnalyzer.js';

// ─── Helper ─────────────────────────────────────────────────────────────
function analyze(code, ruleEngine = null) {
    const ast = parseCode(code, 'test.js');
    return findDeadCode(ast, 'test.js', null, ruleEngine);
}

function findByName(results, name) {
    return results.find(r => r.name === name);
}

function hasResult(results, name) {
    return results.some(r => r.name === name);
}

function hasType(results, type) {
    return results.some(r => r.type === type);
}

describe('Redundancy Analyzer — Redundant Patterns', () => {

    // Test 100
    it('TC-100: x = 1; x = 2; → first assignment redundant', () => {
        const code = `let x;\nx = 1;\nx = 2;\nconsole.log(x);`;
        const results = analyze(code);
        const redundant = results.filter(r => r.type === 'RedundantCode' && r.name.includes('Redundant Assignment'));
        assert.ok(redundant.length > 0, 'First assignment is overwritten');
    });

    // Test 101
    it('TC-101: x = 1; x = x + 1; → TIDAK redundant (reads x)', () => {
        const code = `let x;\nx = 1;\nx = x + 1;\nconsole.log(x);`;
        const results = analyze(code);
        const redundant = results.filter(r => r.type === 'RedundantCode' && r.name.includes('Redundant Assignment'));
        assert.strictEqual(redundant.length, 0, 'Second reads x → first is needed');
    });

    // Test 102
    it('TC-102: x = x; → self-assignment', () => {
        const code = `let x = 5;\nx = x;`;
        const results = analyze(code);
        const self = results.filter(r => r.type === 'RedundantCode' && r.name.includes('Self-Assignment'));
        assert.ok(self.length > 0, 'Self-assignment terdeteksi');
    });

    // Test 103
    it('TC-103: function f() { return; } → redundant return', () => {
        const code = `function f() { console.log("test"); return; }`;
        const results = analyze(code);
        const redundant = results.filter(r => r.type === 'RedundantCode' && r.name.includes('Redundant Return'));
        assert.ok(redundant.length > 0, 'return; di akhir fungsi redundant');
    });

    // Test 104
    it('TC-104: function f() { return undefined; } → redundant return undefined', () => {
        const code = `function f() { console.log("test"); return undefined; }`;
        const results = analyze(code);
        const redundant = results.filter(r => r.type === 'RedundantCode' && r.name.includes('Redundant Return'));
        assert.ok(redundant.length > 0, 'return undefined; redundant');
    });

    // Test 105
    it('TC-105: function f() { return 42; } → BUKAN redundant', () => {
        const code = `function f() { return 42; }`;
        const results = analyze(code);
        const redundant = results.filter(r => r.type === 'RedundantCode' && r.name.includes('Redundant Return'));
        assert.strictEqual(redundant.length, 0, 'return 42 bukan redundant');
    });

    // Test 106
    it('TC-106: 42; sebagai standalone expression → useless', () => {
        const code = `function f() { 42; }`;
        const results = analyze(code);
        const useless = results.filter(r => r.type === 'RedundantCode' && r.name.includes('Useless Expression'));
        assert.ok(useless.length > 0, 'Standalone literal useless');
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 18: SWITCH-CASE ADVANCED (4 Tests)
// ═════════════════════════════════════════════════════════════════════════


