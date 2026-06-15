import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

// === Module Under Test ===
import { parseCode, ParseError } from '../../../../src/parser/astParser.js';
import { findDeadCode } from '../../../../src/analyzer/deadcode/deadCodeAnalyzer.js';
import { removeDeadCode } from '../../../../src/eliminator/codeCleaner.js';
import { RuleEngine } from '../../../../src/analyzer/ruleEngine.js';
import { Scope } from '../../../../src/analyzer/deadcode/core/scope.js';
import { buildCFG, buildCallGraph, analyzePathSensitive } from '../../../../src/analyzer/deadcode/core/flowAnalyzer.js';

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


