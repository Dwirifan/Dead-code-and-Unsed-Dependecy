import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { parseCode } from '../../../src/parser/astParser.js';
import { findDeadCode } from '../../../src/analyzer/deadcode/index.js';
import { RuleEngine } from '../../../src/analyzer/ruleEngine.js';

/** Jalankan analisis dead-code pada potongan kode string */
async function analisis(kode, ruleEngine = new RuleEngine()) {
    const ast = await parseCode(kode, 'test.js');
    return findDeadCode(ast, 'test.js', null, ruleEngine);
}

function cariByName(results, name) { return results.find(r => r.name === name); }
function adaHasil(results, name) { return results.some(r => r.name === name); }
function adaTipe(results, type) { return results.some(r => r.type === type); }

describe('[TC-A01 – TC-A04] Deklarasi Dasar & Penugasan Buntu', () => {

    it('TC-A01: Variabel yang tidak pernah dipakai terdeteksi', async () => {
        const hasil = await analisis(`const x = 5;`);
        assert.ok(adaHasil(hasil, 'x'), 'Variabel yang tidak pernah dibaca harus terdeteksi sebagai dead code');
    });

    it('TC-A02: Variabel yang dipakai TIDAK terdeteksi', async () => {
        const hasil = await analisis(`const x = 5;\nconsole.log(x);`);
        assert.ok(!adaHasil(hasil, 'x'), 'Variabel yang dipakai tidak boleh masuk laporan dead code');
    });

    it('TC-A03: Variabel Write-Only (ditulis tapi tidak pernah dibaca) terdeteksi', async () => {
        const hasil = await analisis(`let x = 0;\nx = 5;`);
        const found = cariByName(hasil, 'x');
        assert.ok(found, 'x harus terdeteksi sebagai dead code');
        assert.strictEqual(found.type, 'WriteOnly', 'Tipe harus WriteOnly karena hanya ditulis, tidak pernah dibaca');
    });

    it('unused variable dengan initializer side-effect diklasifikasikan Review', async () => {
        const hasil = await analisis(`const registration = registerPlugin();`);
        const found = hasil.find(item => item.name === 'registration');

        assert.ok(found, 'Binding hasil pemanggilan fungsi yang tidak dibaca harus tetap terdeteksi');
        assert.strictEqual(found.type, 'Variable');
        assert.strictEqual(found.status, 'review');
        assert.strictEqual(found.confidence, 'medium');
        assert.match(found.reason, /efek samping/i);
    });

    it('TC-A04: Kode setelah return tidak dapat dijangkau (Unreachable Code)', async () => {
        const hasil = await analisis(`function f() {\n  return 1;\n  console.log("unreachable");\n}`);
        assert.ok(adaTipe(hasil, 'DeadCode'), 'Kode setelah return harus dilaporkan sebagai DeadCode');
    });
});

describe('[TC-A05 – TC-A08] Penelusuran Scope Bercabang', () => {

    it('TC-A05: Variabel di dalam block scope terdeteksi jika tidak dipakai', async () => {
        const hasil = await analisis(`{\n  const inner = 42;\n}`);
        assert.ok(adaHasil(hasil, 'inner'), 'Variabel di dalam block scope yang tidak dipakai harus terdeteksi');
    });

    it('TC-A06: Variabel yang dipakai di dalam fungsi bersarang (closure) TIDAK terdeteksi', async () => {
        const kode = `const x = 10;\nfunction show() { return x; }\nshow();`;
        const hasil = await analisis(kode);
        assert.ok(!adaHasil(hasil, 'x'), 'Variabel yang dibaca lewat closure tidak boleh dilaporkan');
    });

    it('TC-A07: Fungsi rekursif yang tidak dipanggil dari luar terdeteksi', async () => {
        const kode = `function factorial(n) {\n  if (n <= 1) return 1;\n  return n * factorial(n - 1);\n}`;
        const hasil = await analisis(kode);
        assert.ok(adaHasil(hasil, 'factorial'), 'Fungsi rekursif tanpa pemanggilan eksternal harus terdeteksi sebagai unused');
    });

    it('TC-A08: Fungsi rekursif yang dipanggil dari luar TIDAK terdeteksi', async () => {
        const kode = `function factorial(n) {\n  if (n <= 1) return 1;\n  return n * factorial(n - 1);\n}\nfactorial(5);`;
        const hasil = await analisis(kode);
        assert.ok(!adaHasil(hasil, 'factorial'), 'Fungsi rekursif yang dipanggil dari luar tidak boleh dilaporkan');
    });
});

describe('[TC-A09 – TC-A10] Edge Case: TypeScript Namespace & Enum', () => {

    it('TC-A09: Unused TypeScript interface terdeteksi sebagai UnusedType', async () => {
        const hasil = await analisis(`interface MyInterface { a: string; }`);
        const found = cariByName(hasil, 'MyInterface');
        assert.ok(found, 'Interface TypeScript yang tidak dipakai harus terdeteksi');
        assert.strictEqual(found.type, 'UnusedType', 'Tipe laporan harus UnusedType untuk TypeScript interface');
    });

    it('TC-A10: Unused TypeScript type alias terdeteksi sebagai UnusedType', async () => {
        const hasil = await analisis(`type MyType = string | number;`);
        const found = cariByName(hasil, 'MyType');
        assert.ok(found, 'Type alias TypeScript yang tidak dipakai harus terdeteksi');
        assert.strictEqual(found.type, 'UnusedType', 'Tipe laporan harus UnusedType untuk TypeScript type alias');
    });
});

describe('[TC-A11 – TC-A13] Variabel: Varian Deklarasi & Multi-Deklarasi', () => {

    it('TC-A11: Mendeteksi var yang tidak dipakai', async () => {
        const hasil = await analisis(`var oldVar = "test";`);
        assert.ok(adaHasil(hasil, 'oldVar'));
    });

    it('TC-A12: Mendeteksi multiple unused dalam satu deklarasi', async () => {
        const hasil = await analisis(`const a = 1, b = 2;`);
        assert.ok(adaHasil(hasil, 'a'));
    });

    it('TC-A13: Hanya mendeteksi yang unused jika sebagian dipakai', async () => {
        const hasil = await analisis(`const a = 1, b = 2;\nconsole.log(a);`);
        assert.ok(!adaHasil(hasil, 'a'), 'a dipakai, tidak boleh terdeteksi');
        assert.ok(adaHasil(hasil, 'b'), 'b tidak dipakai, harus terdeteksi');
    });
});

describe('[TC-A14 – TC-A17] Unused Functions: Semua Varian', () => {

    it('TC-A14: Mendeteksi function declaration yang tidak dipanggil', async () => {
        const hasil = await analisis(`function unused() { return 42; }`);
        assert.ok(adaHasil(hasil, 'unused'));
    });

    it('TC-A15: TIDAK mendeteksi function yang dipanggil', async () => {
        const kode = `function greet() { return "hi"; }\ngreet();`;
        const hasil = await analisis(kode);
        assert.ok(!adaHasil(hasil, 'greet'));
    });

    it('TC-A16: Mendeteksi arrow function yang tidak dipakai', async () => {
        const hasil = await analisis(`const fn = () => 42;`);
        assert.ok(adaHasil(hasil, 'fn'));
    });

    it('TC-A17: Mendeteksi function expression yang tidak dipakai', async () => {
        const hasil = await analisis(`const fn = function() { return 1; };`);
        assert.ok(adaHasil(hasil, 'fn'));
    });
});

describe('[TC-A18 – TC-A22] Unused Imports: Semua Varian', () => {

    it('TC-A18: Mendeteksi named import yang tidak dipakai', async () => {
        const hasil = await analisis(`import { helper } from './utils.js';`);
        assert.ok(adaHasil(hasil, 'helper'));
    });

    it('TC-A19: Mendeteksi default import yang tidak dipakai', async () => {
        const hasil = await analisis(`import React from 'react';`);
        assert.ok(adaHasil(hasil, 'React'));
    });

    it('TC-A20: TIDAK mendeteksi import yang dipakai', async () => {
        const kode = `import { format } from './utils.js';\nformat();`;
        const hasil = await analisis(kode);
        assert.ok(!adaHasil(hasil, 'format'));
    });

    it('TC-A21: Mendeteksi alias import yang tidak dipakai', async () => {
        const hasil = await analisis(`import { foo as bar } from './lib.js';`);
        assert.ok(adaHasil(hasil, 'bar'), 'Alias "bar" harus terdeteksi jika tidak dipakai');
    });

    it('TC-A22: Mendeteksi namespace import yang tidak dipakai', async () => {
        const hasil = await analisis(`import * as Utils from './utils.js';`);
        assert.ok(adaHasil(hasil, 'Utils'));
    });
});

describe('[TC-A23 – TC-A24] Unreachable Code: Setelah Throw & False Positive', () => {

    it('TC-A23: Mendeteksi kode setelah throw', async () => {
        const kode = `function f() {\n  throw new Error("fail");\n  console.log("unreachable");\n}`;
        const hasil = await analisis(kode);
        assert.ok(adaTipe(hasil, 'DeadCode'));
    });

    it('TC-A24: TIDAK false positive pada kode setelah if-return (fallthrough)', async () => {
        const kode = `function f(x) {\n  if (x) return 1;\n  return 2;\n}`;
        const hasil = await analisis(kode);
        const unreachable = hasil.filter(r => r.type === 'DeadCode');
        assert.strictEqual(unreachable.length, 0, 'Return setelah if-return bukan unreachable');
    });
});

describe('[TC-A25 – TC-A26] Write-Only: Varian Penugasan', () => {

    it('TC-A25: TIDAK mendeteksi write-only jika juga di-read', async () => {
        const kode = `let counter = 0;\ncounter = 10;\nconsole.log(counter);`;
        const hasil = await analisis(kode);
        assert.ok(!adaHasil(hasil, 'counter'), 'counter dibaca, bukan write-only');
    });

    it('TC-A26: Compound assignment (+=) dianggap READ', async () => {
        const kode = `let sum = 0;\nsum += 5;\nconsole.log(sum);`;
        const hasil = await analisis(kode);
        assert.ok(!adaHasil(hasil, 'sum'), '+= melibatkan read, jadi bukan dead');
    });
});

describe('[TC-A27 – TC-A31] Confidence & Status Scoring', () => {

    it('TC-A27: Unused variable → confidence HIGH, status SAFE', async () => {
        const hasil = await analisis(`const unused = 42;`);
        const found = cariByName(hasil, 'unused');
        assert.ok(found);
        assert.strictEqual(found.confidence, 'high');
        assert.strictEqual(found.status, 'safe');
    });

    it('TC-A28: Unused function → confidence MEDIUM, status REVIEW', async () => {
        const hasil = await analisis(`function unused() { return 1; }`);
        const found = cariByName(hasil, 'unused');
        assert.ok(found);
        assert.strictEqual(found.confidence, 'medium');
        assert.strictEqual(found.status, 'review');
    });

    it('TC-A29: Positional placeholder dan trailing parameter sama-sama dilaporkan RISKY', async () => {
        const kode = `function handler(req, res, next) { res.send("ok"); }`;
        const hasil = await analisis(kode);
        const reqResult = cariByName(hasil, 'req');
        assert.ok(reqResult, 'req harus dilaporkan sebagai anomali positional');
        assert.strictEqual(reqResult.confidence, 'high');
        assert.strictEqual(reqResult.status, 'risky');
        assert.strictEqual(reqResult.positional, true);
        assert.match(reqResult.reason, /posisinya wajib dipertahankan/);

        const nextResult = cariByName(hasil, 'next');
        assert.ok(nextResult);
        assert.strictEqual(nextResult.confidence, 'low');
        assert.strictEqual(nextResult.status, 'risky');
        assert.strictEqual(nextResult.positional, false);
        assert.match(nextResult.reason, /misal: _next/);
    });

    it('rekomendasi unused parameter menggunakan nama temuan konkret', async () => {
        const hasil = await analisis(`function onError(err) { return "fallback"; }`);
        const errResult = cariByName(hasil, 'err');

        assert.ok(errResult);
        assert.match(errResult.reason, /misal: _err/);
        assert.doesNotMatch(errResult.reason, /misal: _req/);
    });

    it('TC-A30: Impure Write-only variable -> confidence MEDIUM, status REVIEW', async () => {
        const kode = `let x = 0;\nx = doSomething();`;
        const hasil = await analisis(kode);
        const found = cariByName(hasil, 'x');
        assert.ok(found);
        assert.strictEqual(found.type, 'WriteOnly');
        assert.strictEqual(found.confidence, 'medium');
        assert.strictEqual(found.status, 'review');
    });

    it('TC-A30b: Pure Write-only variable -> confidence HIGH, status SAFE', async () => {
        const kode = `let x = 0;\nx = 5;`;
        const hasil = await analisis(kode);
        const found = cariByName(hasil, 'x');
        assert.ok(found);
        assert.strictEqual(found.type, 'WriteOnly');
        assert.strictEqual(found.confidence, 'high');
        assert.strictEqual(found.status, 'safe');
    });

    it('TC-A31: Unreachable code → confidence HIGH, status SAFE', async () => {
        const kode = `function f() { return 1; console.log("dead"); }`;
        const hasil = await analisis(kode);
        const dead = hasil.find(r => r.type === 'DeadCode');
        assert.ok(dead);
        assert.strictEqual(dead.confidence, 'high');
        assert.strictEqual(dead.status, 'safe');
    });
});

describe('Positional parameter anomaly reporting', () => {
    it('melaporkan placeholder callback meskipun namanya tidak diawali underscore', async () => {
        const ruleEngine = new RuleEngine();
        ruleEngine.rules.ignorePrefixedVariables = null;
        const hasil = await analisis(`
            export function camelcase(input: string): string {
                return input.replaceAll(/([a-z])-([a-z])/g, (match, p1, p2) => {
                    return p1 + p2.toUpperCase();
                });
            }
        `, ruleEngine);

        const matchResult = cariByName(hasil, 'match');
        assert.ok(matchResult, 'Placeholder sebelum capture group harus dilaporkan sebagai anomali');
        assert.strictEqual(matchResult.type, 'Parameter');
        assert.strictEqual(matchResult.status, 'risky');
        assert.strictEqual(matchResult.positional, true);
        assert.match(matchResult.reason, /posisinya wajib dipertahankan/);
    });

    it('melaporkan parameter awal fungsi biasa ketika parameter berikutnya digunakan', async () => {
        const ruleEngine = new RuleEngine();
        ruleEngine.rules.ignorePrefixedVariables = null;
        const hasil = await analisis(`
            function select(unused, value) {
                return value;
            }
            console.log(select('placeholder', 'result'));
        `, ruleEngine);

        const unusedResult = cariByName(hasil, 'unused');
        assert.ok(unusedResult, 'Parameter awal harus dilaporkan karena menghapusnya akan menggeser argumen');
        assert.strictEqual(unusedResult.positional, true);
        assert.strictEqual(unusedResult.status, 'risky');
    });

    it('zero-config tetap melaporkan placeholder underscore positional', async () => {
        const ruleEngine = new RuleEngine();
        const hasil = await analisis(`
            export function camelcase(input: string): string {
                return input.replaceAll(/([a-z])-([a-z])/g, (_, p1, p2) => {
                    return p1 + p2.toUpperCase();
                });
            }
        `, ruleEngine);

        const placeholder = cariByName(hasil, '_');
        assert.ok(placeholder, 'Aturan prefix umum tidak boleh menyembunyikan anomali positional');
        assert.strictEqual(placeholder.positional, true);
        assert.strictEqual(placeholder.status, 'risky');
    });

    it('prefix ignore tetap berlaku untuk parameter underscore yang bukan positional', async () => {
        const ruleEngine = new RuleEngine();
        const hasil = await analisis(`
            function select(value, _unused) {
                return value;
            }
            console.log(select('result', 'ignored'));
        `, ruleEngine);

        assert.ok(!adaHasil(hasil, '_unused'), 'Parameter trailing underscore tetap mengikuti ignorePrefixedVariables');
    });

    it('dapat menonaktifkan laporan positional melalui konfigurasi khusus', async () => {
        const ruleEngine = new RuleEngine();
        ruleEngine.rules.ignorePrefixedVariables = null;
        ruleEngine.rules.reportPositionalParameters = false;
        const hasil = await analisis(`
            function select(unused, value) {
                return value;
            }
            console.log(select('placeholder', 'result'));
        `, ruleEngine);

        assert.ok(!adaHasil(hasil, 'unused'), 'Konfigurasi khusus harus dapat menyembunyikan laporan positional');
    });

    it('tetap melaporkan parameter trailing yang tidak digunakan', async () => {
        const ruleEngine = new RuleEngine();
        ruleEngine.rules.ignorePrefixedVariables = null;
        const hasil = await analisis(`
            function select(value, unused) {
                return value;
            }
            console.log(select('result', 'unused'));
        `, ruleEngine);

        const unusedResult = cariByName(hasil, 'unused');
        assert.ok(unusedResult, 'Parameter trailing harus tetap dianalisis');
        assert.strictEqual(unusedResult.type, 'Parameter');
        assert.strictEqual(unusedResult.status, 'risky');
        assert.strictEqual(unusedResult.positional, false);
    });

    it('tidak menyembunyikan binding destructuring yang sebagian tidak digunakan', async () => {
        const ruleEngine = new RuleEngine();
        ruleEngine.rules.ignorePrefixedVariables = null;
        const hasil = await analisis(`
            function format({ keep, discard }, suffix) {
                return keep + suffix;
            }
            console.log(format({ keep: 'a', discard: 'b' }, '!'));
        `, ruleEngine);

        const discardResult = cariByName(hasil, 'discard');
        assert.ok(discardResult, 'Binding destructuring bukan positional placeholder utuh');
        assert.strictEqual(discardResult.type, 'Parameter');
        assert.strictEqual(discardResult.positional, false);
    });
});

describe('[TC-A32 – TC-A33] Destructuring', () => {

    it('TC-A32: Mendeteksi destructured variable yang tidak dipakai', async () => {
        const kode = `const { a, b } = { a: 1, b: 2 };\nconsole.log(a);`;
        const hasil = await analisis(kode);
        assert.ok(!adaHasil(hasil, 'a'), 'a dipakai, tidak boleh terdeteksi');
        assert.ok(adaHasil(hasil, 'b'), 'b tidak dipakai, harus terdeteksi');
    });

    it('TC-A33: Mendeteksi array destructuring yang tidak dipakai', async () => {
        const kode = `const [first, second] = [1, 2];`;
        const hasil = await analisis(kode);
        assert.ok(adaHasil(hasil, 'first'), 'first harus terdeteksi');
        assert.ok(hasil.length >= 1, 'Minimal 1 temuan dari array destructuring');
    });
});

describe('[TC-A34] Scope Isolation', () => {

    it('TC-A34: Variabel di inner scope TIDAK bocor ke outer', async () => {
        const kode = `function outer() {\n  function inner() {\n    const x = 1;\n    return x;\n  }\n  inner();\n}`;
        const hasil = await analisis(kode);
        assert.ok(!adaHasil(hasil, 'x'), 'x dipakai di scope-nya, tidak boleh terdeteksi');
    });
});

describe('[TC-A35 – TC-A37] Side-Effect Imports', () => {

    it('TC-A35: import "./polyfill.js" → TIDAK boleh terdeteksi sebagai dead', async () => {
        const kode = `import './polyfill.js';`;
        const hasil = await analisis(kode);
        assert.strictEqual(hasil.length, 0, 'Side-effect import bukan dead code');
    });

    it('TC-A36: import "reflect-metadata" → TIDAK boleh terdeteksi', async () => {
        const kode = `import 'reflect-metadata';`;
        const hasil = await analisis(kode);
        assert.strictEqual(hasil.length, 0, 'Side-effect import tanpa specifier bukan dead');
    });

    it('TC-A37: import { x } tetap terdeteksi jika x tidak dipakai', async () => {
        const kode = `import { unused } from './utils.js';`;
        const hasil = await analisis(kode);
        assert.ok(adaHasil(hasil, 'unused'), 'Named import yang tidak dipakai tetap dead');
    });
});

describe('[TC-A38 – TC-A40] Duplicate Import Detection', () => {

    it('TC-A38: Import yang sama dari modul sama → duplikat', async () => {
        const kode = `import { foo } from './lib.js';\nimport { foo } from './lib.js';\nfoo();`;
        const hasil = await analisis(kode);
        const dups = hasil.filter(r => r.type === 'DuplicateImport');
        assert.ok(dups.length > 0, 'Import duplikat harus terdeteksi');
    });

    it('TC-A39: Import berbeda dari modul sama → BUKAN duplikat', async () => {
        const kode = `import { foo } from './lib.js';\nimport { bar } from './lib.js';\nfoo();\nbar();`;
        const hasil = await analisis(kode);
        const dups = hasil.filter(r => r.type === 'DuplicateImport');
        assert.strictEqual(dups.length, 0, 'Import berbeda bukan duplikat');
    });

    it('TC-A40: Import sama dari modul BERBEDA → BUKAN duplikat', async () => {
        const kode = `import { foo } from './a.js';\nimport { foo } from './b.js';\nfoo();`;
        const hasil = await analisis(kode);
        const dups = hasil.filter(r => r.type === 'DuplicateImport');
        assert.strictEqual(dups.length, 0, 'Import dari modul berbeda bukan duplikat');
    });
});

describe('[TC-A41 – TC-A42] ExportAllDeclaration Re-exports', () => {
    it('TC-A41: export * from "./mod" → mencatat wildcard re-export tanpa error', async () => {
        const kode = `export * from './mod.js';`;
        const hasil = await analisis(kode);
        assert.ok(Array.isArray(hasil));
    });

    it('TC-A42: export * as ns tidak membuat local binding ns', async () => {
        const kode = `export * as ns from './mod.js';\nconsole.log(ns);`;
        const hasil = await analisis(kode);
        const nsFindings = hasil.filter(r => r.name === 'ns');
        assert.strictEqual(nsFindings.length, 1);
        assert.strictEqual(nsFindings[0].type, 'UndeclaredVariable', 'Re-export alias tidak tersedia sebagai local binding');
    });
});

describe('[TC-A43 - TC-A47] Canonical TypeScript Scope Manager', () => {
    it('TC-A43: binding let pada switch tetap terpisah dari binding luar', async () => {
        const kode = `let value = 1;\nswitch (kind) { case 1: let value = 2; break; }\nconsole.log(value);`;
        const hasil = await analisis(kode);
        const deadValues = hasil.filter(item => item.name === 'value');

        assert.strictEqual(deadValues.length, 1, 'Hanya binding value di dalam switch yang unused');
        assert.strictEqual(deadValues[0].line, 2);
        assert.strictEqual(deadValues[0].analysisBackend, 'scope-manager');
    });

    it('TC-A44: binding let pada for tidak tertukar dengan binding luar', async () => {
        const kode = `let index = 10;\nfor (let index = 0; shouldContinue;) { work(); }\nconsole.log(index);`;
        const hasil = await analisis(kode);
        const deadIndexes = hasil.filter(item => item.name === 'index');

        assert.strictEqual(deadIndexes.length, 1);
        assert.strictEqual(deadIndexes[0].line, 2);
    });

    it('TC-A45: namespace type dan value dengan nama sama dianalisis terpisah', async () => {
        const kode = `interface User { id: number }\nconst User = 1;\nconsole.log(User);`;
        const hasil = await analisis(kode);
        const userFindings = hasil.filter(item => item.name === 'User');

        assert.strictEqual(userFindings.length, 1);
        assert.strictEqual(userFindings[0].type, 'UnusedType');
        assert.strictEqual(userFindings[0].line, 1);
    });

    it('TC-A46: named function expression rekursif bukan undeclared variable', async () => {
        const hasil = await analisis(`const fn = function inner() { return inner(); };\nconsole.log(fn);`);
        const falseUndeclared = hasil.filter(item => item.type === 'UndeclaredVariable' && item.name === 'inner');

        assert.strictEqual(falseUndeclared.length, 0);
    });

    it('TC-A47: default ESM ditangani sebagai syntax marker, bukan global suppression', async () => {
        const kode = `const thing = 1;\nexport { thing as default };`;
        const hasil = await analisis(kode);

        assert.strictEqual(hasil.some(item => item.type === 'UndeclaredVariable' && item.name === 'default'), false);
        assert.strictEqual(hasil.some(item => item.name === 'thing'), false);
    });
});
