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

describe('Branch Analyzer — Enhanced Constant Folding', () => {

    // Test 56
    it('TC-56: Mendeteksi dead branch dari if(0)', () => {
        const code = `if (0) { console.log("dead"); } else { console.log("live"); }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadBranch'), 'if(0) harus menghasilkan dead branch');
    });

    // Test 57
    it('TC-57: Mendeteksi dead branch dari if(null)', () => {
        const code = `if (null) { console.log("dead"); }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadBranch'), 'if(null) harus menghasilkan dead branch');
    });

    // Test 58
    it('TC-58: Mendeteksi dead else dari if(1)', () => {
        const code = `if (1) { console.log("live"); } else { console.log("dead"); }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadBranch'), 'else dari if(1) harus dead');
    });

    // Test 59
    it('TC-59: Mendeteksi dead branch dari if("")', () => {
        const code = `if ("") { console.log("dead"); }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadBranch'), 'if("") harus menghasilkan dead branch');
    });

    // Test 60
    it('TC-60: TIDAK false positive pada if(variabel)', () => {
        const code = `const x = true;\nif (x) { console.log("live"); }`;
        const results = analyze(code);
        const deadBranches = results.filter(r => r.type === 'DeadBranch');
        assert.strictEqual(deadBranches.length, 0, 'if(variabel) bukan constant folding');
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 7: NEGASI & BOOLEAN LOGIC (5 Tests)
// ═════════════════════════════════════════════════════════════════════════


describe('Branch Analyzer — Negasi Operator', () => {

    // Test 61
    it('TC-61: if(!true) → body dead', () => {
        const code = `if (!true) { console.log("dead"); }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadBranch'), '!true === false → dead');
    });

    // Test 62
    it('TC-62: if(!false) → else dead', () => {
        const code = `if (!false) { console.log("live"); } else { console.log("dead"); }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadBranch'), '!false === true → else dead');
    });

    // Test 63
    it('TC-63: if(!0) → TIDAK dead (truthy)', () => {
        const code = `if (!0) { console.log("live"); }`;
        const results = analyze(code);
        const deadBranches = results.filter(r => r.type === 'DeadBranch');
        assert.strictEqual(deadBranches.length, 0, '!0 === true → body tetap live');
    });

    // Test 64
    it('TC-64: if(!1) → body dead', () => {
        const code = `if (!1) { console.log("dead"); }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadBranch'), '!1 === false → dead');
    });

    // Test 65
    it('TC-65: if(!!false) → body dead (double negasi)', () => {
        const code = `if (!!false) { console.log("dead"); }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadBranch'), '!!false === false → dead');
    });
});



describe('Branch Analyzer — Redundant Boolean Logic', () => {

    // Test 66
    it('TC-66: if(flag && false) → always false', () => {
        const code = `const flag = true;\nif (flag && false) { console.log("dead"); }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadBranch'), 'anything && false === false → dead');
    });

    // Test 67
    it('TC-67: if(true || x) → else dead', () => {
        const code = `if (true || something) { console.log("live"); } else { console.log("dead"); }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadBranch'), 'true || anything === true → else dead');
    });

    // Test 68
    it('TC-68: if(false || false) → body dead', () => {
        const code = `if (false || false) { console.log("dead"); }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadBranch'));
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 8: DEAD LOOPS (3 Tests)
// ═════════════════════════════════════════════════════════════════════════


describe('Branch Analyzer — Dead Loop', () => {

    // Test 69
    it('TC-69: while(false) → body dead', () => {
        const code = `while (false) { console.log("dead"); }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadBranch'), 'while(false) body harus dead');
    });

    // Test 70
    it('TC-70: for(;false;) → body dead', () => {
        const code = `for (let i = 0; false; i++) { console.log("dead"); }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadBranch'), 'for(;false;) body harus dead');
    });

    // Test 71
    it('TC-71: while(0) → body dead', () => {
        const code = `while (0) { console.log("dead"); }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadBranch'), 'while(0) body harus dead');
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 9: SHORT-CIRCUIT & TERNARY DEAD (4 Tests)
// ═════════════════════════════════════════════════════════════════════════


describe('Branch Analyzer — Short-Circuit & Ternary', () => {

    // Test 72
    it('TC-72: false && doSomething() → right dead', () => {
        const code = `false && doSomething();`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadCode'), 'Right side of false && never executes');
    });

    // Test 73
    it('TC-73: true || fallback() → right dead', () => {
        const code = `true || fallback();`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadCode'), 'Right side of true || never executes');
    });

    // Test 74
    it('TC-74: false ? dead : alive → consequent dead', () => {
        const code = `const x = false ? deadValue : aliveValue;`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadCode'), 'Ternary consequent is dead when test is false');
    });

    // Test 75
    it('TC-75: true ? alive : dead → alternate dead', () => {
        const code = `const x = true ? aliveValue : deadValue;`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadCode'), 'Ternary alternate is dead when test is true');
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 10: CONSTANT PROPAGATION (4 Tests)
// ═════════════════════════════════════════════════════════════════════════


describe('Branch Analyzer — Constant Propagation', () => {

    // Test 76
    it('TC-76: const FLAG = false; if(FLAG) → body dead', () => {
        const code = `const FLAG = false;\nif (FLAG) { console.log("dead"); }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadBranch'), 'const false → if body harus dead');
    });

    // Test 77
    it('TC-77: const DEBUG = true; if(DEBUG) → else dead', () => {
        const code = `const DEBUG = true;\nif (DEBUG) { console.log("live"); } else { console.log("dead"); }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadBranch'), 'const true → else body harus dead');
    });

    // Test 78
    it('TC-78: const VAL = 0; if(VAL) → body dead', () => {
        const code = `const VAL = 0;\nif (VAL) { console.log("dead"); }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadBranch'), 'const 0 is falsy → body dead');
    });

    // Test 79
    it('TC-79: const FLAG = false; if(!FLAG) → else dead', () => {
        const code = `const FLAG = false;\nif (!FLAG) { console.log("live"); } else { console.log("dead"); }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadBranch'), '!false === true → else dead');
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 11: EMPTY BLOCKS (3 Tests)
// ═════════════════════════════════════════════════════════════════════════


describe('Branch Analyzer — Empty Block Detection', () => {

    // Test 80
    it('TC-80: Mendeteksi empty function body', () => {
        const code = `function placeholder() {}`;
        const results = analyze(code);
        const empty = results.filter(r => r.type === 'EmptyBlock');
        assert.ok(empty.length > 0, 'Empty function harus terdeteksi');
    });

    // Test 81
    it('TC-81: Mendeteksi empty catch block', () => {
        const code = `try { throw new Error(); } catch (e) {}`;
        const results = analyze(code);
        const empty = results.filter(r => r.type === 'EmptyBlock');
        assert.ok(empty.length > 0, 'Empty catch harus terdeteksi');
    });

    // Test 82
    it('TC-82: TIDAK mendeteksi catch dengan isi', () => {
        const code = `try { throw new Error(); } catch (e) { console.log(e); }`;
        const results = analyze(code);
        const empty = results.filter(r => r.type === 'EmptyBlock');
        assert.strictEqual(empty.length, 0, 'Catch yang ada isinya bukan empty');
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 12: LOOP ALWAYS-BREAK (3 Tests)
// ═════════════════════════════════════════════════════════════════════════


describe('Branch Analyzer — Loop Always-Break', () => {

    // Test 83
    it('TC-83: for loop yang langsung break → useless', () => {
        const code = `for (let i = 0; i < 10; i++) { break; }`;
        const results = analyze(code);
        assert.ok(results.some(r => r.name && r.name.includes('Useless Loop')),
            'Loop yang langsung break harus terdeteksi');
    });

    // Test 84
    it('TC-84: while loop yang langsung break → useless', () => {
        const code = `while (true) { break; }`;
        const results = analyze(code);
        assert.ok(results.some(r => r.name && r.name.includes('Useless Loop')));
    });

    // Test 85
    it('TC-85: Loop dengan logika sebelum break → BUKAN useless', () => {
        const code = `for (let i = 0; i < 10; i++) { console.log(i); break; }`;
        const results = analyze(code);
        const useless = results.filter(r => r.name && r.name.includes('Useless Loop'));
        assert.strictEqual(useless.length, 0, 'Loop dengan kode sebelum break bukan useless');
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 13: SIDE-EFFECT IMPORT PROTECTION (3 Tests)
// ═════════════════════════════════════════════════════════════════════════


describe('Branch Analyzer — Constant Propagation Advanced', () => {

    // Test 92
    it('TC-92: const ENABLED = false; while(ENABLED) → dead loop', () => {
        const code = `const ENABLED = false;\nwhile (ENABLED) { console.log("dead"); }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadBranch'), 'while(const false) harus dead');
    });

    // Test 93
    it('TC-93: const X = ""; if(X) → body dead', () => {
        const code = `const X = "";\nif (X) { console.log("dead"); }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadBranch'), 'const "" is falsy → dead');
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 16: CONDITION CONTRADICTION (6 Tests)
// ═════════════════════════════════════════════════════════════════════════


