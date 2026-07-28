import { describe, it } from 'vitest';
import assert from 'node:assert/strict';

import { parseCode } from '../../../../../src/parser/astParser.js';
import { findDeadCode } from '../../../../../src/analyzer/deadcode/index.js';
import { RuleEngine } from '../../../../../src/analyzer/ruleEngine.js';
import { Scope } from '../../../../../src/analyzer/deadcode/core/scope.js';
async function analisis(kode, ruleEngine = new RuleEngine()) {
    const ast = await parseCode(kode, 'test.js');
    return findDeadCode(ast, 'test.js', null, ruleEngine);
}

describe('Scope System — Lexical Environment', () => {

    // Test 49 (was Test 42)
    it('TC-49: Scope addDeclaration & resolve — basic read marks used', async () => {
        const scope = new Scope();
        scope.addDeclaration('x', 'Variable', 1, {});
        scope.addReadReference('x');
        scope.resolve();
        assert.strictEqual(scope.declarations.get('x').used, true);
    });

    // Test 50 (was Test 43)
    it('TC-50: Scope — write-only TIDAK menandai used', async () => {
        const scope = new Scope();
        scope.addDeclaration('y', 'Variable', 1, {});
        scope.addWriteReference('y');
        scope.resolve();
        assert.strictEqual(scope.declarations.get('y').used, false);
        assert.strictEqual(scope.declarations.get('y').writeCount, 1);
    });

    // Test 51
    it('TC-51: Scope — parent chain resolution', async () => {
        const parent = new Scope();
        parent.addDeclaration('x', 'Variable', 1, {});
        const child = new Scope(parent);
        child.addReadReference('x');
        child.resolve();
        assert.strictEqual(parent.declarations.get('x').used, true, 'Parent scope harus ter-resolve dari child');
    });

    // Test 52
    it('TC-52: Scope — self-reference (rekursi) di-skip', async () => {
        const scope = new Scope();
        scope.selfName = 'factorial';
        scope.addDeclaration('factorial', 'Function', 1, {});
        scope.addReadReference('factorial');
        scope.resolve();
        assert.strictEqual(scope.declarations.get('factorial').used, false,
            'Self-reference tidak boleh menandai used');
    });

    // Test 53
    it('TC-53: Scope — readCount dan writeCount tracking', async () => {
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


describe('Scope Analyzer — Callback & Higher-Order Functions', () => {

    // Test 121
    it('TC-121: Callback di array.map terdeteksi sebagai READ', async () => {
        const code = `function transform(x) { return x * 2; } \nconst arr = [1,2];\narr.map(transform);`;
        const results = await analisis(code);
        const isDead = results.some(r => r.node && r.node.id && r.node.id.name === 'transform');
        assert.strictEqual(isDead, false, 'Callback harusnya tidak ditandai sebagai unused');
    });

    // Test 122
    it('TC-122: Callback di addEventListener terdeteksi sebagai READ', async () => {
        const code = `function handleClick() { console.log(1); } \ndocument.addEventListener('click', handleClick);`;
        const results = await analisis(code);
        const isDead = results.some(r => r.node && r.node.id && r.node.id.name === 'handleClick');
        assert.strictEqual(isDead, false, 'Event listener harusnya tidak ditandai sebagai unused');
    });

    // Test 123
    it('TC-123: Fungsi yang diserahkan sebagai argumen middleware', async () => {
        const code = `function myMiddleware(req, res, next) { next(); } \napp.use(myMiddleware);`;
        const results = await analisis(code);
        const isDead = results.some(r => r.node && r.node.id && r.node.id.name === 'myMiddleware');
        assert.strictEqual(isDead, false, 'Middleware callback harus valid');
    });
});


// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 23: JSX / TSX AWARENESS (3 Tests)
// ═════════════════════════════════════════════════════════════════════════


describe('Scope Analyzer — JSX/TSX Awareness', () => {

    // Test 124
    it('TC-124: Komponen React yang dipanggil dengan JSX <Header /> terdeteksi', async () => {
        const code = `function Header() { return 1; } \nfunction App() { return <Header />; }\nApp();`;
        const results = await analisis(code);
        const headerDead = results.some(r => r.node && r.node.id && r.node.id.name === 'Header');
        assert.strictEqual(headerDead, false, 'Komponen <Header /> dianggap terpakai');
    });

    // Test 125
    it('TC-125: Dynamic Component di JSX (const C = isAdmin ? A : B)', async () => {
        const code = `function A() { return 1; } \nfunction B() { return 2; } \nfunction App(isAdmin) { const C = isAdmin ? A : B; return <C />; }\nApp();`;
        const results = await analisis(code);
        const aDead = results.some(r => r.node && r.node.id && r.node.id.name === 'A');
        const bDead = results.some(r => r.node && r.node.id && r.node.id.name === 'B');
        assert.strictEqual(aDead, false, 'Dynamic component A terpakai');
        assert.strictEqual(bDead, false, 'Dynamic component B terpakai');
    });

    // Test 126
    it('TC-126: JSX spread attributes tidak menimbulkan false positive', async () => {
        const code = `function Card(props) { return <div {...props}></div>; }\nCard({ a: 1 });`;
        const results = await analisis(code);
        const cardDead = results.some(r => r.node && r.node.id && r.node.id.name === 'Card');
        assert.strictEqual(cardDead, false, 'Komponen dengan spread props valid');
    });
});

// ═════════════════════════════════════════════════════════════════════════
// BAGIAN 24: TYPESCRIPT-SPECIFIC DEAD CODE (3 Tests)
// ═════════════════════════════════════════════════════════════════════════


describe('Scope Analyzer — TypeScript-Specific Types', () => {

    // Test 127
    it('TC-127: Unused interface terdeteksi sebagai UnusedType', async () => {
        const code = `interface MyInterface { a: string; }`;
        const results = await analisis(code);
        const myInterface = results.find(r => r.name === 'MyInterface');
        assert.ok(myInterface, 'MyInterface harus terdeteksi unused');
        assert.strictEqual(myInterface.type, 'UnusedType', 'Harus berjenis UnusedType');
    });

    // Test 128
    it('TC-128: Unused type alias terdeteksi sebagai UnusedType', async () => {
        const code = `type MyType = string | number;`;
        const results = await analisis(code);
        const myType = results.find(r => r.name === 'MyType');
        assert.ok(myType, 'MyType harus terdeteksi unused');
        assert.strictEqual(myType.type, 'UnusedType', 'Harus berjenis UnusedType');
    });

    // Test 129
    it('TC-129: Unused import type terdeteksi sebagai UnusedType', async () => {
        const code = `import type { UserType } from './types';`;
        const results = await analisis(code);
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
    it('TC-130: preserveExports "strict" menandai unused export', async () => {
        const code = `export function unusedExport() {}`;
        const ast = await parseCode(code);
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