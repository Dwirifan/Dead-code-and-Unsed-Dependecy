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


