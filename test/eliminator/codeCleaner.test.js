import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// === Module Under Test ===
import { parseCode, ParseError } from '../../src/parser/astParser.js';
import { findDeadCode } from '../../src/analyzer/deadcode/deadCodeAnalyzer.js';
import { removeDeadCode } from '../../src/eliminator/codeCleaner.js';
import { RuleEngine } from '../../src/analyzer/ruleEngine.js';
import { Scope } from '../../src/analyzer/deadcode/core/scope.js';
import { buildCFG, buildCallGraph, analyzePathSensitive } from '../../src/analyzer/deadcode/core/flowAnalyzer.js';

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
    it('TC-38: Proteksi Parameter — Diubah menjadi _ (Level 3 Default)', () => {
        const deadNodes = [{
            name: 'unused',
            type: 'Parameter',
            node: { range: [11, 17] } // 'unused'
        }];
        const code = `function f(unused) {}`;
        const result = removeDeadCode(code, deadNodes);
        assert.strictEqual(result, `function f(_unused) {}`, 'Parameter diberi awalan _');
    });

    // Test 39
    it('TC-39: Proteksi ClassMethod — Body dikosongkan (Level 3 Default)', () => {
        const deadNodes = [{
            name: 'unused',
            type: 'ClassMethod',
            node: { 
                range: [12, 31], 
                value: { body: { range: [21, 31] } } 
            }
        }];
        const code = `class Foo { unused() { let x; } }`;
        const result = removeDeadCode(code, deadNodes);
        assert.strictEqual(result, `class Foo { unused() {} }`, 'ClassMethod diubah menjadi {}');
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

    // Test 42
    it('TC-42: Level 0 (Dry-Run) tidak memodifikasi kode', () => {
        const code = `const a = 1;\n`;
        const deadNodes = [{ name: 'a', type: 'VariableDeclarator', node: { range: [0, 12] } }];
        const cleaned = removeDeadCode(code, deadNodes, 0); // Level 0
        assert.strictEqual(cleaned, code, 'Level 0 tidak boleh menghapus apapun');
    });

    // Test 43
    it('TC-43: Level 2 (Empty Body) mengosongkan fungsi, bukan menghapus', () => {
        const code = `class Foo { unusedMethod() { console.log("mati"); } }`;
        const deadNodes = [{ 
            name: 'unusedMethod', 
            type: 'ClassMethod', 
            node: { 
                range: [12, 51], 
                value: { body: { range: [27, 51] } } 
            } 
        }];
        const cleaned = removeDeadCode(code, deadNodes, 2); // Level 2
        assert.ok(cleaned.includes('unusedMethod() {}'), 'Body fungsi harus dikosongkan menjadi {}');
        assert.ok(!cleaned.includes('console.log'), 'Isi fungsi harus hilang');
    });

    // Test 44
    it('TC-44: Level 3 (Aggressive) menghapus variabel secara total', () => {
        const code = `const a = 1, b = 2;`;
        const deadNodes = [{ name: 'a', type: 'VariableDeclarator', node: { range: [6, 11] } }];
        const cleaned = removeDeadCode(code, deadNodes, 3); // Level 3
        assert.ok(!cleaned.includes('a = 1'), 'Variabel mati harus diamputasi penuh di Level 3');
        assert.ok(cleaned.includes('b = 2'), 'Variabel lain tidak terpengaruh');
    });

    // Test 45
    it('TC-45: Mencegah Syntax Leak (Residu "const ;") pada penghapusan deklarator ganda', () => {
        // Skenario: a dan b keduanya usang. Setelah keduanya dihapus, jangan sampai tersisa "const ;"
        const code = `const a = 1, b = 2;\nconsole.log("hidup");`;
        const ast = parseCode(code, 'test.js');
        const deadNodes = findDeadCode(ast, 'test.js');
        const cleaned = removeDeadCode(code, deadNodes);
        
        // Pastikan 'a' dan 'b' terhapus
        assert.ok(!cleaned.includes('a = 1'), 'Variabel a harus terhapus');
        assert.ok(!cleaned.includes('b = 2'), 'Variabel b harus terhapus');
        
        // PENGUJIAN UTAMA: Pastikan tidak ada "const ;" atau "const" yang menggantung
        assert.ok(!cleaned.includes('const ;'), 'Tidak boleh ada kebocoran sintaks "const ;"');
        assert.ok(!cleaned.includes('const\n'), 'Kata kunci const harus ikut terhapus seluruhnya');
        assert.ok(cleaned.includes('console.log("hidup");'), 'Baris berikutnya harus tetap aman');
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 3: RULE ENGINE (7 Tests)
// ═════════════════════════════════════════════════════════════════════════


