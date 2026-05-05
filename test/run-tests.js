/**
 * ================================================
 * DeadKiller — Automated Test Suite
 * ================================================
 * 50 Test Cases menggunakan Node.js built-in test runner
 * Jalankan: npm test (atau node --test test/run-tests.js)
 *
 * Cakupan:
 *   - Dead Code Analyzer (25 tests)
 *   - Code Cleaner (8 tests)
 *   - Rule Engine (7 tests)
 *   - Scope System (5 tests)
 *   - Dependency Analyzer (3 tests)
 *   - AST Parser (2 tests)
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs-extra';
import { fileURLToPath } from 'url';

// === Module Under Test ===
import { parseCode, ParseError } from '../src/parser/astParser.js';
import { findDeadCode } from '../src/analyzer/deadcode/deadCodeAnalyzer.js';
import { removeDeadCode } from '../src/eliminator/codeCleaner.js';
import { RuleEngine } from '../src/analyzer/ruleEngine.js';
import { Scope } from '../src/analyzer/deadcode/scope.js';
import { buildCFG, buildCallGraph, analyzePathSensitive } from '../src/analyzer/deadcode/flowAnalyzer.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 1: DEAD CODE ANALYZER (25 Tests)
// ═════════════════════════════════════════════════════════════════════════

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

describe('Code Cleaner — Penghapusan Dead Code', () => {

    // Test 34
    it('TC-34: Menghapus baris tunggal dead code', () => {
        const code = `const used = 1;\nconst dead = 2;\nconsole.log(used);\n`;
        const ast = parseCode(code, 'test.js');
        const deadNodes = findDeadCode(ast, 'test.js');
        const cleaned = removeDeadCode(code, deadNodes);
        assert.ok(!cleaned.includes('dead'), 'dead harus terhapus');
        assert.ok(cleaned.includes('used'), 'used harus tetap ada');
        assert.ok(cleaned.includes('console.log'), 'console.log harus tetap ada');
    });

    // Test 35
    it('TC-35: Tidak menghapus apapun jika deadNodes kosong', () => {
        const code = `const x = 1;\nconsole.log(x);\n`;
        const result = removeDeadCode(code, []);
        assert.strictEqual(result, code);
    });

    // Test 36
    it('TC-36: Tidak menghapus apapun jika deadNodes null', () => {
        const code = `const x = 1;\n`;
        const result = removeDeadCode(code, null);
        assert.strictEqual(result, code);
    });

    // Test 37
    it('TC-37: Proteksi DuplicateCondition — TIDAK dihapus', () => {
        const deadNodes = [{
            name: 'dup',
            type: 'DuplicateCondition',
            node: { range: [0, 10] }
        }];
        const code = `if (a) {} else if (a) {}`;
        const result = removeDeadCode(code, deadNodes);
        assert.strictEqual(result, code, 'DuplicateCondition tidak boleh dihapus');
    });

    // Test 38
    it('TC-38: Proteksi Parameter — TIDAK dihapus', () => {
        const deadNodes = [{
            name: 'unused',
            type: 'Parameter',
            node: { range: [0, 5] }
        }];
        const code = `function f(unused) {}`;
        const result = removeDeadCode(code, deadNodes);
        assert.strictEqual(result, code, 'Parameter tidak boleh dihapus');
    });

    // Test 39
    it('TC-39: Proteksi ClassMethod — TIDAK dihapus', () => {
        const deadNodes = [{
            name: 'unused',
            type: 'ClassMethod',
            node: { range: [0, 5] }
        }];
        const code = `class Foo { unused() {} }`;
        const result = removeDeadCode(code, deadNodes);
        assert.strictEqual(result, code, 'ClassMethod tidak boleh dihapus');
    });

    // Test 40
    it('TC-40: Menghapus tanpa merusak kode lain di file yang sama', () => {
        const code = `const a = 1;\nconst b = 2;\nconst c = 3;\nconsole.log(a);\nconsole.log(c);\n`;
        const ast = parseCode(code, 'test.js');
        const deadNodes = findDeadCode(ast, 'test.js');
        const cleaned = removeDeadCode(code, deadNodes);
        assert.ok(cleaned.includes('const a = 1;'));
        assert.ok(cleaned.includes('const c = 3;'));
        assert.ok(cleaned.includes('console.log(a)'));
        assert.ok(cleaned.includes('console.log(c)'));
        assert.ok(!cleaned.includes('const b = 2;'));
    });

    // Test 41
    it('TC-41: Menghapus multiple dead nodes tanpa konflik posisi', () => {
        const code = `const a = 1;\nconst b = 2;\nconst c = 3;\n`;
        const ast = parseCode(code, 'test.js');
        const deadNodes = findDeadCode(ast, 'test.js');
        const cleaned = removeDeadCode(code, deadNodes);
        assert.ok(!cleaned.includes('const a'));
        assert.ok(!cleaned.includes('const b'));
        assert.ok(!cleaned.includes('const c'));
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 3: RULE ENGINE (7 Tests)
// ═════════════════════════════════════════════════════════════════════════

describe('Rule Engine — Konfigurasi & Filter', () => {

    // Test 42
    it('TC-42: Variabel berawalan _ di-skip oleh RuleEngine', () => {
        const engine = new RuleEngine();
        const results = analyze(`const _unused = 42;`, engine);
        assert.ok(!hasResult(results, '_unused'), 'Variabel _unused harus di-skip');
    });

    // Test 43
    it('TC-43: Variabel tanpa _ tetap terdeteksi', () => {
        const engine = new RuleEngine();
        const results = analyze(`const unused = 42;`, engine);
        assert.ok(hasResult(results, 'unused'));
    });

    // Test 44
    it('TC-44: isIgnoredVariable mengembalikan true untuk pola yang cocok', () => {
        const engine = new RuleEngine();
        assert.strictEqual(engine.isIgnoredVariable('_temp'), true);
        assert.strictEqual(engine.isIgnoredVariable('_'), true);
    });

    // Test 45
    it('TC-45: isIgnoredVariable mengembalikan false untuk variabel normal', () => {
        const engine = new RuleEngine();
        assert.strictEqual(engine.isIgnoredVariable('data'), false);
        assert.strictEqual(engine.isIgnoredVariable('count'), false);
    });

    // Test 46
    it('TC-46: isIgnoredFile mengenali framework mode next', () => {
        const engine = new RuleEngine();
        engine.rules.mode = 'next';
        assert.strictEqual(engine.isIgnoredFile('/project/pages/index.js', '/project'), true);
        assert.strictEqual(engine.isIgnoredFile('/project/app/layout.js', '/project'), true);
    });

    // Test 47
    it('TC-47: isIgnoredFile vanilla mode tidak memproteksi pages/', () => {
        const engine = new RuleEngine();
        engine.rules.mode = 'vanilla';
        assert.strictEqual(engine.isIgnoredFile('/project/pages/index.js', '/project'), false);
    });

    // Test 48
    it('TC-48: isIgnoredDependency bekerja sesuai daftar', () => {
        const engine = new RuleEngine();
        engine.rules.ignoreDependencies = ['dotenv', 'winston'];
        assert.strictEqual(engine.isIgnoredDependency('dotenv'), true);
        assert.strictEqual(engine.isIgnoredDependency('winston'), true);
        assert.strictEqual(engine.isIgnoredDependency('express'), false);
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 4: SCOPE SYSTEM (5 Tests)
// ═════════════════════════════════════════════════════════════════════════

describe('Scope System — Lexical Environment', () => {

    // Test 49 (was Test 42)
    it('TC-49: Scope addDeclaration & resolve — basic read marks used', () => {
        const scope = new Scope();
        scope.addDeclaration('x', 'Variable', 1, {});
        scope.addReadReference('x');
        scope.resolve();
        assert.strictEqual(scope.declarations.get('x').used, true);
    });

    // Test 50 (was Test 43)
    it('TC-50: Scope — write-only TIDAK menandai used', () => {
        const scope = new Scope();
        scope.addDeclaration('y', 'Variable', 1, {});
        scope.addWriteReference('y');
        scope.resolve();
        assert.strictEqual(scope.declarations.get('y').used, false);
        assert.strictEqual(scope.declarations.get('y').writeCount, 1);
    });

    // Test 51
    it('TC-51: Scope — parent chain resolution', () => {
        const parent = new Scope();
        parent.addDeclaration('x', 'Variable', 1, {});
        const child = new Scope(parent);
        child.addReadReference('x');
        child.resolve();
        assert.strictEqual(parent.declarations.get('x').used, true, 'Parent scope harus ter-resolve dari child');
    });

    // Test 52
    it('TC-52: Scope — self-reference (rekursi) di-skip', () => {
        const scope = new Scope();
        scope.selfName = 'factorial';
        scope.addDeclaration('factorial', 'Function', 1, {});
        scope.addReadReference('factorial');
        scope.resolve();
        assert.strictEqual(scope.declarations.get('factorial').used, false,
            'Self-reference tidak boleh menandai used');
    });

    // Test 53
    it('TC-53: Scope — readCount dan writeCount tracking', () => {
        const scope = new Scope();
        scope.addDeclaration('counter', 'Variable', 1, {});
        scope.addReadReference('counter');
        scope.addReadReference('counter');
        scope.addWriteReference('counter');
        scope.resolve();
        const decl = scope.declarations.get('counter');
        assert.strictEqual(decl.readCount, 2);
        assert.strictEqual(decl.writeCount, 1);
        assert.strictEqual(decl.used, true);
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 5: AST PARSER (2 Tests)
// ═════════════════════════════════════════════════════════════════════════

describe('AST Parser — Parsing', () => {

    // Test 54
    it('TC-54: parseCode mengembalikan AST valid', () => {
        const ast = parseCode(`const x = 1;`, 'test.js');
        assert.ok(ast);
        assert.strictEqual(ast.type, 'Program');
        assert.ok(ast.body.length > 0);
    });

    // Test 55
    it('TC-55: parseCode melempar ParseError untuk syntax invalid', () => {
        assert.throws(
            () => parseCode(`const = ;`, 'broken.js'),
            (err) => err instanceof ParseError,
            'Harus melempar ParseError'
        );
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 6: ENHANCED CONSTANT FOLDING & EDGE CASES (5 Tests)
// ═════════════════════════════════════════════════════════════════════════

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

describe('Flow Analyzer — Control Flow Graph', () => {

    // Test 111
    it('TC-111: CFG mendeteksi blok setelah return sebagai unreachable', () => {
        const code = `function f() { return 1; console.log("dead"); }`;
        const ast = parseCode(code);
        // CFG dari function body
        const funcNode = ast.body[0];
        const cfg = buildCFG(funcNode.body.body);
        assert.ok(cfg.unreachableBlocks.length > 0, 'Block setelah return harus unreachable');
    });

    // Test 112
    it('TC-112: CFG tanpa terminator → semua reachable', () => {
        const code = `function f() { const a = 1; const b = 2; }`;
        const ast = parseCode(code);
        const funcNode = ast.body[0];
        const cfg = buildCFG(funcNode.body.body);
        assert.strictEqual(cfg.unreachableBlocks.length, 0, 'Tidak ada unreachable block');
    });

    // Test 113
    it('TC-113: CFG memiliki entry dan exit block', () => {
        const code = `function f() { return 1; }`;
        const ast = parseCode(code);
        const funcNode = ast.body[0];
        const cfg = buildCFG(funcNode.body.body);
        assert.ok(cfg.entry, 'CFG harus punya entry block');
        assert.ok(cfg.exit, 'CFG harus punya exit block');
        assert.ok(cfg.entry.isEntry, 'Entry block harus ditandai');
        assert.ok(cfg.exit.isExit, 'Exit block harus ditandai');
    });

    // Test 114
    it('TC-114: CFG empty body → entry langsung ke exit', () => {
        const cfg = buildCFG([]);
        assert.ok(cfg.entry.successors.includes(cfg.exit.id), 'Empty body → entry connect ke exit');
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 20: FUNCTION CALL GRAPH (3 Tests)
// ═════════════════════════════════════════════════════════════════════════

describe('Flow Analyzer — Function Call Graph', () => {

    // Test 115
    it('TC-115: Mendeteksi fungsi yang tidak pernah dipanggil', () => {
        const code = `function used() { return 1; }\nfunction orphan() { return 2; }\nused();`;
        const ast = parseCode(code);
        const graph = buildCallGraph(ast);
        assert.ok(graph.orphanFunctions.some(f => f.name === 'orphan'),
            'orphan() harus terdeteksi sebagai orphan');
    });

    // Test 116
    it('TC-116: Fungsi yang dipanggil BUKAN orphan', () => {
        const code = `function helper() { return 1; }\nfunction main() { helper(); }\nmain();`;
        const ast = parseCode(code);
        const graph = buildCallGraph(ast);
        assert.ok(!graph.orphanFunctions.some(f => f.name === 'helper'),
            'helper() dipanggil → bukan orphan');
    });

    // Test 117
    it('TC-117: Call graph melacak caller → callee', () => {
        const code = `function a() { b(); }\nfunction b() { return 1; }\na();`;
        const ast = parseCode(code);
        const graph = buildCallGraph(ast);
        assert.ok(graph.callGraph.has('a'), 'a harus ada di call graph');
        assert.ok(graph.callGraph.get('a').has('b'), 'a harus memanggil b');
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 21: PATH-SENSITIVE ANALYSIS (3 Tests)
// ═════════════════════════════════════════════════════════════════════════

describe('Flow Analyzer — Path-Sensitive Analysis', () => {

    // Test 118
    it('TC-118: typeof guard → variabel mungkin undefined di else', () => {
        const code = `function test(x) { if (typeof x !== 'undefined') { return x; } else { console.log(x); } }`;
        const ast = parseCode(code);
        const findings = analyzePathSensitive(ast);
        assert.ok(findings.length > 0, 'x mungkin undefined di else');
    });

    // Test 119
    it('TC-119: typeof guard tanpa else → TIDAK ada warning', () => {
        const code = `function test(x) { if (typeof x !== 'undefined') { return x; } }`;
        const ast = parseCode(code);
        const findings = analyzePathSensitive(ast);
        assert.strictEqual(findings.length, 0, 'Tanpa else tidak ada warning');
    });

    // Test 120
    it('TC-120: CFG unreachable terdeteksi oleh analyzer utama', () => {
        const code = `function f() { throw new Error('fail'); console.log('dead'); }`;
        const results = analyze(code);
        assert.ok(hasType(results, 'DeadCode'), 'Code setelah throw harus dead');
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 22: CALLBACK & HIGHER-ORDER FUNCTIONS (3 Tests)
// ═════════════════════════════════════════════════════════════════════════

describe('Scope Analyzer — Callback & Higher-Order Functions', () => {

    // Test 121
    it('TC-121: Callback di array.map terdeteksi sebagai READ', () => {
        const code = `function transform(x) { return x * 2; } \nconst arr = [1,2];\narr.map(transform);`;
        const results = analyze(code);
        const isDead = results.some(r => r.node && r.node.id && r.node.id.name === 'transform');
        assert.strictEqual(isDead, false, 'Callback harusnya tidak ditandai sebagai unused');
    });

    // Test 122
    it('TC-122: Callback di addEventListener terdeteksi sebagai READ', () => {
        const code = `function handleClick() { console.log(1); } \ndocument.addEventListener('click', handleClick);`;
        const results = analyze(code);
        const isDead = results.some(r => r.node && r.node.id && r.node.id.name === 'handleClick');
        assert.strictEqual(isDead, false, 'Event listener harusnya tidak ditandai sebagai unused');
    });

    // Test 123
    it('TC-123: Fungsi yang diserahkan sebagai argumen middleware', () => {
        const code = `function myMiddleware(req, res, next) { next(); } \napp.use(myMiddleware);`;
        const results = analyze(code);
        const isDead = results.some(r => r.node && r.node.id && r.node.id.name === 'myMiddleware');
        assert.strictEqual(isDead, false, 'Middleware callback harus valid');
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 23: JSX / TSX AWARENESS (3 Tests)
// ═════════════════════════════════════════════════════════════════════════

describe('Scope Analyzer — JSX/TSX Awareness', () => {

    // Test 124
    it('TC-124: Komponen React yang dipanggil dengan JSX <Header /> terdeteksi', () => {
        const code = `function Header() { return 1; } \nfunction App() { return <Header />; }\nApp();`;
        const results = analyze(code);
        const headerDead = results.some(r => r.node && r.node.id && r.node.id.name === 'Header');
        assert.strictEqual(headerDead, false, 'Komponen <Header /> dianggap terpakai');
    });

    // Test 125
    it('TC-125: Dynamic Component di JSX (const C = isAdmin ? A : B)', () => {
        const code = `function A() { return 1; } \nfunction B() { return 2; } \nfunction App(isAdmin) { const C = isAdmin ? A : B; return <C />; }\nApp();`;
        const results = analyze(code);
        const aDead = results.some(r => r.node && r.node.id && r.node.id.name === 'A');
        const bDead = results.some(r => r.node && r.node.id && r.node.id.name === 'B');
        assert.strictEqual(aDead, false, 'Dynamic component A terpakai');
        assert.strictEqual(bDead, false, 'Dynamic component B terpakai');
    });

    // Test 126
    it('TC-126: JSX spread attributes tidak menimbulkan false positive', () => {
        const code = `function Card(props) { return <div {...props}></div>; }\nCard({ a: 1 });`;
        const results = analyze(code);
        const cardDead = results.some(r => r.node && r.node.id && r.node.id.name === 'Card');
        assert.strictEqual(cardDead, false, 'Komponen dengan spread props valid');
    });
});

// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 24: TYPESCRIPT-SPECIFIC DEAD CODE (3 Tests)
// ═════════════════════════════════════════════════════════════════════════

describe('Scope Analyzer — TypeScript-Specific Types', () => {

    // Test 127
    it('TC-127: Unused interface terdeteksi sebagai UnusedType', () => {
        const code = `interface MyInterface { a: string; }`;
        const results = analyze(code);
        const myInterface = results.find(r => r.name === 'MyInterface');
        assert.ok(myInterface, 'MyInterface harus terdeteksi unused');
        assert.strictEqual(myInterface.type, 'UnusedType', 'Harus berjenis UnusedType');
    });

    // Test 128
    it('TC-128: Unused type alias terdeteksi sebagai UnusedType', () => {
        const code = `type MyType = string | number;`;
        const results = analyze(code);
        const myType = results.find(r => r.name === 'MyType');
        assert.ok(myType, 'MyType harus terdeteksi unused');
        assert.strictEqual(myType.type, 'UnusedType', 'Harus berjenis UnusedType');
    });

    // Test 129
    it('TC-129: Unused import type terdeteksi sebagai UnusedType', () => {
        const code = `import type { UserType } from './types';`;
        const results = analyze(code);
        const userType = results.find(r => r.name === 'UserType');
        assert.ok(userType, 'UserType import type harus terdeteksi unused');
        assert.strictEqual(userType.type, 'UnusedType', 'Harus berjenis UnusedType');
    });
});

// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 25: CROSS-FILE EXPORT (1 Test)
// ═════════════════════════════════════════════════════════════════════════

describe('Scope Analyzer — Cross-File Export (Strict Mode)', () => {
    
    // Test 130
    it('TC-130: preserveExports "strict" menandai unused export', () => {
        const code = `export function unusedExport() {}`;
        const ast = parseCode(code);
        const ruleEngine = { 
            rules: { preserveExports: 'strict' },
            isIgnoredVariable: () => false 
        };
        const globalRegistry = { usedExports: new Map([['test.js', new Set()]]) }; // Tidak ada yang import
        
        const results = findDeadCode(ast, 'test.js', globalRegistry, ruleEngine);
        const unused = results.find(r => r.name === 'unusedExport');
        assert.ok(unused, 'Export yang tidak di-import file lain harus terdeteksi unused');
        assert.strictEqual(unused.status, 'review', 'Unused function harus berstatus review');
    });
});
