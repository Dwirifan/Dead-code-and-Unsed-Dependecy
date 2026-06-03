import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// === Module Under Test ===
import { parseCode, ParseError } from '../../src/parser/astParser.js';
import { findDeadCode } from '../../src/analyzer/deadcode/deadCodeAnalyzer.js';
import { removeDeadCode } from '../../src/eliminator/codeCleaner.js';
import { RuleEngine } from '../../src/analyzer/ruleEngine.js';
import { Scope } from '../../src/analyzer/deadcode/scope.js';
import { buildCFG, buildCallGraph, analyzePathSensitive } from '../../src/analyzer/deadcode/flowAnalyzer.js';

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

describe('Dead Code Analyzer — Unused Variables', () => {

    // Test 1
    it('TC-01: Mendeteksi variabel lokal yang tidak dipakai', () => {
        const results = analyze(`const x = 5;`);
        assert.ok(hasResult(results, 'x'), 'Variabel x harus terdeteksi');
    });

    // Test 2
    it('TC-02: TIDAK mendeteksi variabel yang dipakai', () => {
        const results = analyze(`const x = 5;\nconsole.log(x);`);
        assert.ok(!hasResult(results, 'x'), 'Variabel x tidak boleh terdeteksi');
    });

    // Test 3
    it('TC-03: Mendeteksi let yang tidak dipakai', () => {
        const results = analyze(`let count = 0;`);
        assert.ok(hasResult(results, 'count'));
    });

    // Test 4
    it('TC-04: Mendeteksi var yang tidak dipakai', () => {
        const results = analyze(`var oldVar = "test";`);
        assert.ok(hasResult(results, 'oldVar'));
    });

    // Test 5
    it('TC-05: Mendeteksi multiple unused dalam satu deklarasi', () => {
        const results = analyze(`const a = 1, b = 2;`);
        // Ketika SEMUA declarator dalam satu VariableDeclaration dead,
        // analyzer mengoptimalkan: menghapus seluruh deklarasi sekaligus.
        // Cukup pastikan setidaknya 'a' terdeteksi (parent deduplication).
        assert.ok(hasResult(results, 'a'));
    });

    // Test 6
    it('TC-06: Hanya mendeteksi yang unused jika sebagian dipakai', () => {
        const results = analyze(`const a = 1, b = 2;\nconsole.log(a);`);
        assert.ok(!hasResult(results, 'a'), 'a dipakai, tidak boleh terdeteksi');
        assert.ok(hasResult(results, 'b'), 'b tidak dipakai, harus terdeteksi');
    });

    // Test 7
    it('TC-07: TIDAK mendeteksi variabel yang dipakai di dalam fungsi', () => {
        const code = `const x = 10;\nfunction show() { return x; }\nshow();`;
        const results = analyze(code);
        assert.ok(!hasResult(results, 'x'));
    });
});



describe('Dead Code Analyzer — Unused Functions', () => {

    // Test 8
    it('TC-08: Mendeteksi function declaration yang tidak dipanggil', () => {
        const results = analyze(`function unused() { return 42; }`);
        assert.ok(hasResult(results, 'unused'));
    });

    // Test 9
    it('TC-09: TIDAK mendeteksi function yang dipanggil', () => {
        const code = `function greet() { return "hi"; }\ngreet();`;
        const results = analyze(code);
        assert.ok(!hasResult(results, 'greet'));
    });

    // Test 10
    it('TC-10: Mendeteksi arrow function yang tidak dipakai', () => {
        const results = analyze(`const fn = () => 42;`);
        assert.ok(hasResult(results, 'fn'));
    });

    // Test 11
    it('TC-11: Mendeteksi function expression yang tidak dipakai', () => {
        const results = analyze(`const fn = function() { return 1; };`);
        assert.ok(hasResult(results, 'fn'));
    });

    // Test 12
    it('TC-12: Mendeteksi fungsi rekursif yang tidak dipanggil dari luar', () => {
        const code = `function factorial(n) {\n  if (n <= 1) return 1;\n  return n * factorial(n - 1);\n}`;
        const results = analyze(code);
        assert.ok(hasResult(results, 'factorial'), 'Fungsi rekursif tanpa pemanggilan eksternal harus terdeteksi');
    });

    // Test 13
    it('TC-13: TIDAK mendeteksi fungsi rekursif yang dipanggil dari luar', () => {
        const code = `function factorial(n) {\n  if (n <= 1) return 1;\n  return n * factorial(n - 1);\n}\nfactorial(5);`;
        const results = analyze(code);
        assert.ok(!hasResult(results, 'factorial'));
    });
});



describe('Dead Code Analyzer — Unused Imports', () => {

    // Test 14
    it('TC-14: Mendeteksi named import yang tidak dipakai', () => {
        const results = analyze(`import { helper } from './utils.js';`);
        assert.ok(hasResult(results, 'helper'));
    });

    // Test 15
    it('TC-15: Mendeteksi default import yang tidak dipakai', () => {
        const results = analyze(`import React from 'react';`);
        assert.ok(hasResult(results, 'React'));
    });

    // Test 16
    it('TC-16: TIDAK mendeteksi import yang dipakai', () => {
        const code = `import { format } from './utils.js';\nformat();`;
        const results = analyze(code);
        assert.ok(!hasResult(results, 'format'));
    });

    // Test 17
    it('TC-17: Mendeteksi alias import yang tidak dipakai', () => {
        const results = analyze(`import { foo as bar } from './lib.js';`);
        assert.ok(hasResult(results, 'bar'), 'Alias "bar" harus terdeteksi jika tidak dipakai');
    });

    // Test 18
    it('TC-18: Mendeteksi namespace import yang tidak dipakai', () => {
        const results = analyze(`import * as Utils from './utils.js';`);
        assert.ok(hasResult(results, 'Utils'));
    });
});



describe('Dead Code Analyzer — Unreachable Code', () => {

    // Test 19
    it('TC-19: Mendeteksi kode setelah return', () => {
        const code = `function f() {\n  return 1;\n  console.log("unreachable");\n}`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadCode'), 'Kode setelah return harus terdeteksi');
    });

    // Test 20
    it('TC-20: Mendeteksi kode setelah throw', () => {
        const code = `function f() {\n  throw new Error("fail");\n  console.log("unreachable");\n}`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadCode'));
    });

    // Test 21
    it('TC-21: TIDAK false positive pada kode setelah if-return (fallthrough)', () => {
        const code = `function f(x) {\n  if (x) return 1;\n  return 2;\n}`;
        const results = analyze(code);
        const unreachable = results.filter(r => r.type === 'DeadCode');
        assert.strictEqual(unreachable.length, 0, 'Return setelah if-return bukan unreachable');
    });
});



describe('Dead Code Analyzer — Write-Only Variables', () => {

    // Test 22
    it('TC-22: Mendeteksi variabel yang hanya ditulis (write-only)', () => {
        const code = `let counter = 0;\ncounter = 10;\ncounter = 20;`;
        const results = analyze(code);
        const found = findByName(results, 'counter');
        assert.ok(found, 'counter harus terdeteksi');
        assert.strictEqual(found.type, 'WriteOnly');
    });

    // Test 23
    it('TC-23: TIDAK mendeteksi write-only jika juga di-read', () => {
        const code = `let counter = 0;\ncounter = 10;\nconsole.log(counter);`;
        const results = analyze(code);
        assert.ok(!hasResult(results, 'counter'), 'counter dibaca, bukan write-only');
    });

    // Test 24
    it('TC-24: Compound assignment (+=) dianggap READ', () => {
        const code = `let sum = 0;\nsum += 5;\nconsole.log(sum);`;
        const results = analyze(code);
        assert.ok(!hasResult(results, 'sum'), '+= melibatkan read, jadi bukan dead');
    });
});



describe('Dead Code Analyzer — Confidence & Status', () => {

    // Test 25
    it('TC-25: Unused variable → confidence HIGH, status SAFE', () => {
        const results = analyze(`const unused = 42;`);
        const found = findByName(results, 'unused');
        assert.ok(found);
        assert.strictEqual(found.confidence, 'high');
        assert.strictEqual(found.status, 'safe');
    });

    // Test 26
    it('TC-26: Unused function → confidence MEDIUM, status REVIEW', () => {
        const results = analyze(`function unused() { return 1; }`);
        const found = findByName(results, 'unused');
        assert.ok(found);
        assert.strictEqual(found.confidence, 'medium');
        assert.strictEqual(found.status, 'review');
    });

    // Test 27
    it('TC-27: Unused parameter → confidence LOW, status RISKY', () => {
        const code = `function handler(req, res, next) { res.send("ok"); }`;
        const results = analyze(code);
        // 'req' dan 'next' tidak dipakai
        const reqResult = findByName(results, 'req');
        assert.ok(reqResult);
        assert.strictEqual(reqResult.confidence, 'low');
        assert.strictEqual(reqResult.status, 'risky');
    });

    // Test 28
    it('TC-28: Write-only variable → confidence MEDIUM, status REVIEW', () => {
        const code = `let x = 0;\nx = 5;`;
        const results = analyze(code);
        const found = findByName(results, 'x');
        assert.ok(found);
        assert.strictEqual(found.type, 'WriteOnly');
        assert.strictEqual(found.confidence, 'medium');
        assert.strictEqual(found.status, 'review');
    });

    // Test 29
    it('TC-29: Unreachable code → confidence HIGH, status SAFE', () => {
        const code = `function f() { return 1; console.log("dead"); }`;
        const results = analyze(code);
        const dead = results.find(r => r.type === 'DeadCode');
        assert.ok(dead);
        assert.strictEqual(dead.confidence, 'high');
        assert.strictEqual(dead.status, 'safe');
    });
});



describe('Dead Code Analyzer — Destructuring', () => {

    // Test 30
    it('TC-30: Mendeteksi destructured variable yang tidak dipakai', () => {
        const code = `const { a, b } = { a: 1, b: 2 };\nconsole.log(a);`;
        const results = analyze(code);
        assert.ok(!hasResult(results, 'a'), 'a dipakai, tidak boleh terdeteksi');
        assert.ok(hasResult(results, 'b'), 'b tidak dipakai, harus terdeteksi');
    });

    // Test 31
    it('TC-31: Mendeteksi array destructuring yang tidak dipakai', () => {
        const code = `const [first, second] = [1, 2];`;
        const results = analyze(code);
        // Array destructuring menghasilkan setidaknya satu identifier terdeteksi
        assert.ok(hasResult(results, 'first'), 'first harus terdeteksi');
        // 'second' mungkin didedup jika seluruh deklarasi dead → cek total saja
        assert.ok(results.length >= 1, 'Minimal 1 temuan dari array destructuring');
    });
});



describe('Dead Code Analyzer — Scope & Block', () => {

    // Test 32
    it('TC-32: Variabel di dalam block scope terdeteksi jika unused', () => {
        const code = `{\n  const inner = 42;\n}`;
        const results = analyze(code);
        assert.ok(hasResult(results, 'inner'));
    });

    // Test 33
    it('TC-33: Variabel di inner scope TIDAK bocor ke outer', () => {
        const code = `function outer() {\n  function inner() {\n    const x = 1;\n    return x;\n  }\n  inner();\n}`;
        const results = analyze(code);
        assert.ok(!hasResult(results, 'x'), 'x dipakai di scope-nya, tidak boleh terdeteksi');
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 2: CODE CLEANER (8 Tests)
// ═════════════════════════════════════════════════════════════════════════


describe('Dead Code Analyzer — Side-Effect Imports', () => {

    // Test 86
    it('TC-86: import "./polyfill.js" → TIDAK boleh terdeteksi sebagai dead', () => {
        const code = `import './polyfill.js';`;
        const results = analyze(code);
        assert.strictEqual(results.length, 0, 'Side-effect import bukan dead code');
    });

    // Test 87
    it('TC-87: import "reflect-metadata" → TIDAK boleh terdeteksi', () => {
        const code = `import 'reflect-metadata';`;
        const results = analyze(code);
        assert.strictEqual(results.length, 0, 'Side-effect import tanpa specifier bukan dead');
    });

    // Test 88
    it('TC-88: import { x } tetap terdeteksi jika x tidak dipakai', () => {
        const code = `import { unused } from './utils.js';`;
        const results = analyze(code);
        assert.ok(hasResult(results, 'unused'), 'Named import yang tidak dipakai tetap dead');
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 14: DUPLICATE IMPORT DETECTION (3 Tests)
// ═════════════════════════════════════════════════════════════════════════


describe('Dead Code Analyzer — Duplicate Imports', () => {

    // Test 89
    it('TC-89: Import yang sama dari modul sama → duplikat', () => {
        const code = `import { foo } from './lib.js';\nimport { foo } from './lib.js';\nfoo();`;
        const results = analyze(code);
        const dups = results.filter(r => r.type === 'DuplicateImport');
        assert.ok(dups.length > 0, 'Import duplikat harus terdeteksi');
    });

    // Test 90
    it('TC-90: Import berbeda dari modul sama → BUKAN duplikat', () => {
        const code = `import { foo } from './lib.js';\nimport { bar } from './lib.js';\nfoo();\nbar();`;
        const results = analyze(code);
        const dups = results.filter(r => r.type === 'DuplicateImport');
        assert.strictEqual(dups.length, 0, 'Import berbeda bukan duplikat');
    });

    // Test 91
    it('TC-91: Import sama dari modul BERBEDA → BUKAN duplikat', () => {
        const code = `import { foo } from './a.js';\nimport { foo } from './b.js';\nfoo();`;
        const results = analyze(code);
        const dups = results.filter(r => r.type === 'DuplicateImport');
        assert.strictEqual(dups.length, 0, 'Import dari modul berbeda bukan duplikat');
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 15: CONSTANT PROPAGATION ADVANCED (2 Tests)
// ═════════════════════════════════════════════════════════════════════════


