import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { parseCode } from '../../../src/parser/astParser.js';
import { findDeadCode } from '../../../src/analyzer/deadcode/index.js';
import { RuleEngine } from '../../../src/analyzer/ruleEngine.js';

function analyze(code, ruleEngine = null) {
    return parseCode(code, 'test.js').then(ast => findDeadCode(ast, 'test.js', null, ruleEngine));
}

function hasResult(results, name) {
    return results.some(r => r.name === name);
}

describe('Smart Background Analysis 3 Lapis untuk Ignored Variables', () => {
    const engine = new RuleEngine(); // Konfigurasi default mengabaikan ^_|dummy

    it('TC-SMART-01: Variabel mandiri berawalan __ dengan inisialisasi pure (seperti __dirname) HARUS terdeteksi mati', async () => {
        const code = `
            import path from 'path';
            const __filename = 'test.js';
            const __dirname = path.dirname('test.js'); // Tidak dipanggil
        `;
        const results = await analyze(code, engine);
        assert.ok(hasResult(results, '__dirname'), '__dirname harus terdeteksi sebagai dead code');
        assert.ok(hasResult(results, '__filename'), '__filename harus terdeteksi sebagai dead code');
    });

    it('TC-SMART-02: Variabel mandiri berawalan _ dengan literal/statis HARUS terdeteksi mati', async () => {
        const code = `
            const _dummy = "test data";
            let _temp = 100;
        `;
        const results = await analyze(code, engine);
        assert.ok(hasResult(results, '_dummy'), '_dummy harus terdeteksi mati');
        assert.ok(hasResult(results, '_temp'), '_temp harus terdeteksi mati');
    });

    it('TC-SMART-03: Parameter positional berawalan _ tetap dilaporkan sebagai anomali RISKY', async () => {
        const code = `
            function process(_req, res) {
                return res.send('ok');
            }
        `;
        const results = await analyze(code, engine);
        const finding = results.find(result => result.name === '_req');
        assert.ok(finding, 'Parameter _req harus dilaporkan melalui kebijakan positional khusus');
        assert.strictEqual(finding.positional, true);
        assert.strictEqual(finding.status, 'risky');
    });

    it('TC-SMART-04: Parameter blok catch berawalan _ TETAP dilindungi (di-skip)', async () => {
        const code = `
            try {
                doSomething();
            } catch (_err) {
                // diabaikan
            }
        `;
        const results = await analyze(code, engine);
        assert.ok(!hasResult(results, '_err'), 'Catch parameter _err tidak boleh dilaporkan mati');
    });

    it('TC-SMART-05: Variabel hasil rest destructuring berawalan _ TETAP dilindungi (di-skip)', async () => {
        const code = `
            const user = { id: 1, pwd: 'secret', name: 'Dwi' };
            const { pwd: _pwd, ...safeUser } = user;
            console.log(safeUser);
        `;
        const results = await analyze(code, engine);
        assert.ok(!hasResult(results, '_pwd'), 'Variabel destructuring _pwd tidak boleh dilaporkan mati');
    });

    it('TC-SMART-06: Variabel mandiri berawalan _ dengan side-effect (seperti app.listen) TETAP dilindungi (di-skip)', async () => {
        const code = `
            const _server = app.listen(3000);
            const _timer = setInterval(callback, 1000);
        `;
        const results = await analyze(code, engine);
        assert.ok(!hasResult(results, '_server'), 'Variabel dengan side effect (_server) harus dilindungi');
        assert.ok(!hasResult(results, '_timer'), 'Variabel dengan side effect (_timer) harus dilindungi');
    });

    it('TC-SMART-07: Fixed-Point Iterative Elimination: Variabel berantai (__filename -> __dirname) HARUS langsung terdeteksi sekaligus dalam 1 scan', async () => {
        const code = `
            import path from 'path';
            import { fileURLToPath } from 'url';
            const __filename = fileURLToPath(import.meta.url);
            const __dirname = path.dirname(__filename); // Tidak dipanggil
        `;
        const results = await analyze(code, engine);
        assert.ok(hasResult(results, '__dirname'), '__dirname harus terdeteksi sebagai dead code');
        assert.ok(hasResult(results, '__filename'), '__filename harus terdeteksi sebagai dead code');
        assert.ok(hasResult(results, 'fileURLToPath'), 'fileURLToPath harus terdeteksi sebagai dead code');
    });
});
