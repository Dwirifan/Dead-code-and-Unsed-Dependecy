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

describe('Logic Analyzer — Condition Contradiction', () => {

    // Test 94
    it('TC-94: if(x && !x) → body dead (direct negation)', () => {
        const code = `function test(x) { if (x && !x) { console.log("dead"); } }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadBranch') || hasType(results, 'DeadCode'),
            'x && !x adalah kontradiksi');
    });

    // Test 95
    it('TC-95: if(x === "a" && x === "b") → body dead (equality contradiction)', () => {
        const code = `function test(x) { if (x === "a" && x === "b") { console.log("dead"); } }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadBranch') || hasType(results, 'DeadCode'),
            'x === a && x === b adalah kontradiksi');
    });

    // Test 96
    it('TC-96: if(x > 10 && x < 5) → body dead (range contradiction)', () => {
        const code = `function test(x) { if (x > 10 && x < 5) { console.log("dead"); } }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadBranch') || hasType(results, 'DeadCode'),
            'x > 10 && x < 5 adalah kontradiksi');
    });

    // Test 97
    it('TC-97: if(x === "dev" && x === "prod") → dead (env contradiction)', () => {
        const code = `function test(x) { if (x === "dev" && x === "prod") { console.log("dead"); } }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadBranch') || hasType(results, 'DeadCode'),
            'ENV contradiction');
    });

    // Test 98
    it('TC-98: if(a === b && a !== b) → dead (equality vs inequality)', () => {
        const code = `function test(a, b) { if (a === b && a !== b) { console.log("dead"); } }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadBranch') || hasType(results, 'DeadCode'),
            '=== vs !== kontradiksi');
    });

    // Test 99
    it('TC-99: TIDAK false positive pada kondisi valid (x > 0 && x < 100)', () => {
        const code = `function test(x) { if (x > 0 && x < 100) { console.log("valid range"); } }`;
        const results = analyze(code);
        const contradictions = results.filter(r => r.name && r.name.includes('Contradict'));
        assert.strictEqual(contradictions.length, 0, 'Range valid bukan kontradiksi');
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 17: REDUNDANT CODE DETECTION (7 Tests)
// ═════════════════════════════════════════════════════════════════════════


describe('Logic Analyzer — Switch-Case Advanced', () => {

    // Test 107
    it('TC-107: Duplicate switch case terdeteksi', () => {
        const code = `switch(x) { case 1: break; case 1: break; }`;
        const results = analyze(code);
        const dups = results.filter(r => r.name && r.name.includes('Duplicate Switch'));
        assert.ok(dups.length > 0, 'Case duplikat harus terdeteksi');
    });

    // Test 108
    it('TC-108: Duplicate if condition chain terdeteksi', () => {
        const code = `if (x === 1) { a(); } else if (x === 1) { b(); }`;
        const results = analyze(code);
        const dups = results.filter(r => r.name && r.name.includes('Duplicate If'));
        assert.ok(dups.length > 0, 'If condition duplikat harus terdeteksi');
    });

    // Test 109
    it('TC-109: switch(true) with all cases returning → default dead', () => {
        const code = `switch(true) { case x > 0: return 1; case x < 0: return -1; default: return 0; }`;
        const results = analyze(code);
        const dead = results.filter(r => r.name && r.name.includes('Unreachable Default'));
        assert.ok(dead.length > 0, 'Default pada switch(true) bisa unreachable');
    });

    // Test 110
    it('TC-110: switch biasa → default BUKAN dead', () => {
        const code = `switch(x) { case 1: return "one"; default: return "other"; }`;
        const results = analyze(code);
        const dead = results.filter(r => r.name && r.name.includes('Unreachable Default'));
        assert.strictEqual(dead.length, 0, 'Default pada switch biasa valid');
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 19: CONTROL FLOW GRAPH (4 Tests)
// ═════════════════════════════════════════════════════════════════════════


