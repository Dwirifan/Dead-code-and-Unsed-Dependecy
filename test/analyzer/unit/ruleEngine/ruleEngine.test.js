import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

// === Module Under Test ===
import { parseCode } from '../../../../src/parser/astParser.js';
import { findDeadCode } from '../../../../src/analyzer/deadcode/index.js';
import { RuleEngine } from '../../../../src/analyzer/ruleEngine.js';

// ─── Helper ─────────────────────────────────────────────────────────────
function analyze(code, ruleEngine = null) {
    return parseCode(code, 'test.js').then(ast => findDeadCode(ast, 'test.js', null, ruleEngine));
}

function hasResult(results, name) {
    return results.some(r => r.name === name);
}

describe('Rule Engine — Konfigurasi & Filter', () => {

    // Test 42
    it('TC-42: Variabel berawalan _ yang terikat sintaks atau punya side effect di-skip oleh RuleEngine', async () => {
        const engine = new RuleEngine();
        const results = await analyze(`const [_unused, used] = [1, 2]; const _server = app.listen(3000); console.log(used);`, engine);
        assert.ok(!hasResult(results, '_unused'), 'Variabel _unused dalam destructuring harus di-skip');
        assert.ok(!hasResult(results, '_server'), 'Variabel _server dengan side effect harus di-skip');
    });

    // Test 43
    it('TC-43: Variabel tanpa _ tetap terdeteksi', async () => {
        const engine = new RuleEngine();
        const results = await analyze(`const unused = 42;`, engine);
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
    it('TC-46: file konvensi Next dipertahankan tetapi tetap dianalisis', () => {
        const engine = new RuleEngine();
        engine.rules.mode = 'next';
        assert.strictEqual(engine.isPreservedFile('/project/pages/index.js', '/project'), true);
        assert.strictEqual(engine.isPreservedFile('/project/app/layout.js', '/project'), true);
        assert.strictEqual(engine.isIgnoredFile('/project/pages/index.js', '/project'), false);
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

    it('Should default preserveUnsafeFiles to true and allow overriding to false', () => {
        const engine = new RuleEngine();
        assert.strictEqual(engine.rules.preserveUnsafeFiles, true);
        engine.rules.preserveUnsafeFiles = false;
        assert.strictEqual(engine.rules.preserveUnsafeFiles, false);
    });

    it('mendukung glob ignoreFiles rekursif yang dihasilkan init', () => {
        const engine = new RuleEngine();
        engine.rules.ignoreFiles = ['**/dist/**', '**/.next/**', 'legacy-build'];

        assert.strictEqual(engine.isIgnoredFile('/project/packages/api/dist/index.js', '/project'), true);
        assert.strictEqual(engine.isIgnoredFile('/project/apps/web/.next/server.js', '/project'), true);
        assert.strictEqual(engine.isIgnoredFile('/project/packages/api/legacy-build/index.js', '/project'), true);
        assert.strictEqual(engine.isIgnoredFile('/project/src/index.js', '/project'), false);
    });

    it('membedakan preserveFiles dari ignoreFiles', () => {
        const engine = new RuleEngine();
        engine.rules.preserveFiles = ['test/**'];
        engine.rules.ignoreFiles = ['dist/**'];

        assert.strictEqual(engine.isPreservedFile('/project/test/example.test.js', '/project'), true);
        assert.strictEqual(engine.isIgnoredFile('/project/test/example.test.js', '/project'), false);
        assert.strictEqual(engine.isIgnoredFile('/project/dist/index.js', '/project'), true);
        assert.strictEqual(engine.isPreservedFile('/project/dist/index.js', '/project'), false);
    });

    it('mode vue melindungi convention-based framework paths', () => {
        const engine = new RuleEngine();
        engine.rules.mode = 'vue';

        assert.strictEqual(engine.isPreservedFile('/project/pages/index.vue', '/project'), true);
        assert.strictEqual(engine.isPreservedFile('/project/plugins/auth.ts', '/project'), true);
        assert.strictEqual(engine.isIgnoredFile('/project/pages/index.vue', '/project'), false);
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 4: SCOPE SYSTEM (5 Tests)
// ═════════════════════════════════════════════════════════════════════════


