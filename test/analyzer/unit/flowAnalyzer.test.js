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


