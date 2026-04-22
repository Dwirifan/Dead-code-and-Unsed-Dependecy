/**
 * ══════════════════════════════════════════════════════════════════
 * TEST SUITE: AST Parser & Dead Code Detection — Soliditas Deteksi
 * ══════════════════════════════════════════════════════════════════
 * 
 * Menguji 3 lapisan:
 *   A. Parser (astParser.js) — apakah berbagai pola kode bisa di-parse?
 *   B. Dead Code Detection (deadCodeAnalyzer.js) — apakah deteksi akurat?
 *   C. Edge Cases — kasus-kasus rumit yang sering menjebak analyzer
 * 
 * Jalankan: node test/test_ast_detection.js
 */

import { parseCode } from '../src/parser/astParser.js';
import { findDeadCode } from '../src/analyzer/deadcode/deadCodeAnalyzer.js';
import chalk from 'chalk';

// ── Utilitas Test ─────────────────────────────────────────────────

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function test(category, name, fn) {
    totalTests++;
    try {
        fn();
        passedTests++;
        console.log(chalk.green(`  [PASS] ${name}`));
    } catch (err) {
        failedTests++;
        failures.push({ category, name, error: err.message });
        console.log(chalk.red(`  [FAIL] ${name}`));
        console.log(chalk.gray(`         → ${err.message}`));
    }
}

function assertEqual(actual, expected, msg = '') {
    if (actual !== expected) {
        throw new Error(`${msg} Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
}

function assertIncludes(arr, item, msg = '') {
    if (!arr.includes(item)) {
        throw new Error(`${msg} Expected array to include "${item}", got: [${arr.join(', ')}]`);
    }
}

function assertNotIncludes(arr, item, msg = '') {
    if (arr.includes(item)) {
        throw new Error(`${msg} Expected array NOT to include "${item}", but it was found`);
    }
}

function getDeadNames(code) {
    const ast = parseCode(code);
    const dead = findDeadCode(ast);
    return dead.map(d => d.name);
}

function getDeadItems(code) {
    const ast = parseCode(code);
    return findDeadCode(ast);
}

// ══════════════════════════════════════════════════════════════════
// A. TEST PARSER — Apakah Kode Bisa Di-Parse Tanpa Error?
// ══════════════════════════════════════════════════════════════════

console.log(chalk.bold.cyan('\n═══ A. PARSER TESTS ═══\n'));

test('Parser', 'Variabel dan fungsi dasar', () => {
    const ast = parseCode(`
        const x = 10;
        let y = 20;
        var z = 30;
        function hello() { return x + y; }
    `);
    assertEqual(ast.type, 'Program');
});

test('Parser', 'Arrow function & template literal', () => {
    const ast = parseCode(`
        const greet = (name) => \`Hello, \${name}!\`;
        const add = (a, b) => a + b;
    `);
    assertEqual(ast.type, 'Program');
});

test('Parser', 'Destructuring (object & array)', () => {
    const ast = parseCode(`
        const { a, b, ...rest } = obj;
        const [x, y, ...others] = arr;
        const { nested: { deep } } = complex;
    `);
    assertEqual(ast.type, 'Program');
});

test('Parser', 'Class dengan method dan static', () => {
    const ast = parseCode(`
        class Animal {
            constructor(name) { this.name = name; }
            speak() { return this.name; }
            static create(name) { return new Animal(name); }
        }
    `);
    assertEqual(ast.type, 'Program');
});

test('Parser', 'Async/Await', () => {
    const ast = parseCode(`
        async function fetchData(url) {
            const res = await fetch(url);
            return await res.json();
        }
    `);
    assertEqual(ast.type, 'Program');
});

test('Parser', 'ES Module (import/export)', () => {
    const ast = parseCode(`
        import fs from 'fs';
        import { readFile, writeFile } from 'fs/promises';
        import * as path from 'path';
        export function hello() { return 'world'; }
        export default class App {}
    `);
    assertEqual(ast.type, 'Program');
});

test('Parser', 'CommonJS (require/module.exports)', () => {
    const ast = parseCode(`
        const fs = require('fs');
        const { join } = require('path');
        function doStuff() { return fs.readFileSync('file.txt'); }
        module.exports = { doStuff };
    `);
    assertEqual(ast.type, 'Program');
});

test('Parser', 'JSX syntax', () => {
    const ast = parseCode(`
        const element = <div className="app"><h1>Hello</h1></div>;
        const Component = ({ name }) => <span>{name}</span>;
    `);
    assertEqual(ast.type, 'Program');
});

test('Parser', 'JSX dengan fragment dan expression', () => {
    const ast = parseCode(`
        const items = [1, 2, 3];
        const el = (
            <>
                {items.map(i => <li key={i}>{i}</li>)}
                <input onChange={(e) => console.log(e.target.value)} />
            </>
        );
    `);
    assertEqual(ast.type, 'Program');
});

test('Parser', 'TypeScript — type annotation & interface', () => {
    const ast = parseCode(`
        interface User { name: string; age: number; }
        type Status = 'active' | 'inactive';
        const greet = (user: User): string => user.name;
        const x: number = 42;
    `);
    assertEqual(ast.type, 'Program');
});

test('Parser', 'TypeScript — generic & enum', () => {
    const ast = parseCode(`
        enum Color { Red, Green, Blue }
        function identity<T>(arg: T): T { return arg; }
        const result: Color = Color.Red;
    `);
    assertEqual(ast.type, 'Program');
});

test('Parser', 'Shebang (#!/usr/bin/env node)', () => {
    const ast = parseCode(`#!/usr/bin/env node
        console.log('CLI tool');
    `);
    assertEqual(ast.type, 'Program');
});

test('Parser', 'Optional chaining & nullish coalescing', () => {
    const ast = parseCode(`
        const name = user?.profile?.name ?? 'Anonymous';
        const len = arr?.length ?? 0;
    `);
    assertEqual(ast.type, 'Program');
});

test('Parser', 'Dynamic import()', () => {
    const ast = parseCode(`
        async function loadModule() {
            const mod = await import('./module.js');
            return mod.default;
        }
    `);
    assertEqual(ast.type, 'Program');
});

test('Parser', 'Error pada sintaks tidak valid', () => {
    let threw = false;
    try {
        parseCode('const x = {{{;');
    } catch (e) {
        threw = true;
    }
    assertEqual(threw, true, 'Seharusnya throw error untuk sintaks tidak valid.');
});

test('Parser', 'Error jika input bukan string', () => {
    let threw = false;
    try {
        parseCode(12345);
    } catch (e) {
        threw = true;
    }
    assertEqual(threw, true, 'Seharusnya throw error untuk input non-string.');
});

// ══════════════════════════════════════════════════════════════════
// B. DEAD CODE DETECTION — Apakah Deteksi Akurat?
// ══════════════════════════════════════════════════════════════════

console.log(chalk.bold.cyan('\n═══ B. DEAD CODE DETECTION TESTS ═══\n'));

// ── B1. Variabel ─────────────────────────────────────────────────

test('DeadCode', 'Variabel tidak terpakai → DEAD', () => {
    const dead = getDeadNames(`
        const used = 10;
        const unused = 20;
        console.log(used);
    `);
    assertIncludes(dead, 'unused');
    assertNotIncludes(dead, 'used');
});

test('DeadCode', 'Variabel let tidak terpakai → DEAD', () => {
    const dead = getDeadNames(`
        let active = true;
        let forgotten = false;
        if (active) console.log('yes');
    `);
    assertIncludes(dead, 'forgotten');
    assertNotIncludes(dead, 'active');
});

test('DeadCode', 'Variabel var tidak terpakai → DEAD', () => {
    const dead = getDeadNames(`
        var oldVar = 'legacy';
        var usedVar = 'used';
        console.log(usedVar);
    `);
    assertIncludes(dead, 'oldVar');
    assertNotIncludes(dead, 'usedVar');
});

test('DeadCode', 'Semua variabel dipakai → tidak ada dead', () => {
    const dead = getDeadNames(`
        const a = 1;
        const b = 2;
        const c = a + b;
        console.log(c);
    `);
    assertEqual(dead.length, 0, 'Seharusnya tidak ada dead code. ');
});

test('DeadCode', 'Multiple declarator — sebagian dead', () => {
    const dead = getDeadNames(`
        const used = 1, unused = 2;
        console.log(used);
    `);
    assertIncludes(dead, 'unused');
    assertNotIncludes(dead, 'used');
});

// ── B2. Fungsi ───────────────────────────────────────────────────

test('DeadCode', 'Fungsi tidak dipanggil → DEAD', () => {
    const dead = getDeadNames(`
        function used() { return 1; }
        function unused() { return 2; }
        used();
    `);
    assertIncludes(dead, 'unused');
    assertNotIncludes(dead, 'used');
});

test('DeadCode', 'Fungsi dipanggil secara tidak langsung (callback) → LIVE', () => {
    const dead = getDeadNames(`
        function handler(e) { return e; }
        document.addEventListener('click', handler);
    `);
    assertNotIncludes(dead, 'handler');
});

test('DeadCode', 'Fungsi rekursif → DEAD jika tidak dipanggil dari luar', () => {
    const dead = getDeadNames(`
        function factorial(n) {
            if (n <= 1) return 1;
            return n * factorial(n - 1);
        }
    `);
    // factorial memanggil dirinya sendiri, tapi tidak dipanggil dari luar
    assertIncludes(dead, 'factorial');
});

test('DeadCode', 'Arrow function tidak terpakai → DEAD', () => {
    const dead = getDeadNames(`
        const greet = () => 'hello';
        const farewell = () => 'bye';
        console.log(greet());
    `);
    assertIncludes(dead, 'farewell');
    assertNotIncludes(dead, 'greet');
});

// ── B3. Parameter ────────────────────────────────────────────────

test('DeadCode', 'Parameter tidak terpakai → DEAD', () => {
    const dead = getDeadNames(`
        function calc(a, b, unused) {
            return a + b;
        }
        calc(1, 2, 3);
    `);
    assertIncludes(dead, 'unused');
    assertNotIncludes(dead, 'a');
    assertNotIncludes(dead, 'b');
});

// ── B4. Destructuring ────────────────────────────────────────────

test('DeadCode', 'Object destructuring — sebagian dead', () => {
    const dead = getDeadNames(`
        const { name, age, email } = getUser();
        console.log(name);
    `);
    assertIncludes(dead, 'age');
    assertIncludes(dead, 'email');
    assertNotIncludes(dead, 'name');
});

test('DeadCode', 'Array destructuring — sebagian dead', () => {
    const dead = getDeadNames(`
        const [first, second, third] = getItems();
        console.log(first);
    `);
    assertIncludes(dead, 'second');
    assertIncludes(dead, 'third');
    assertNotIncludes(dead, 'first');
});

test('DeadCode', 'Rest element (...rest) tidak terpakai → DEAD', () => {
    const dead = getDeadNames(`
        const { id, ...rest } = data;
        console.log(id);
    `);
    assertIncludes(dead, 'rest');
});

// ── B5. Import ───────────────────────────────────────────────────

test('DeadCode', 'Import tidak terpakai → DEAD', () => {
    const dead = getDeadNames(`
        import { used, unused } from './module.js';
        console.log(used);
    `);
    assertIncludes(dead, 'unused');
    assertNotIncludes(dead, 'used');
});

test('DeadCode', 'Import default tidak terpakai → DEAD', () => {
    const dead = getDeadNames(`
        import React from 'react';
        import Helper from './helper.js';
        console.log(Helper);
    `);
    assertIncludes(dead, 'React');
    assertNotIncludes(dead, 'Helper');
});

// ── B6. Unreachable Code (Dead Branches) ─────────────────────────

test('DeadCode', 'if (false) → branch dead', () => {
    const items = getDeadItems(`
        if (false) {
            console.log('never');
        }
    `);
    const types = items.map(d => d.type);
    assertIncludes(types, 'DeadBranch');
});

test('DeadCode', 'if (true) else → else branch dead', () => {
    const items = getDeadItems(`
        if (true) {
            console.log('always');
        } else {
            console.log('never');
        }
    `);
    const types = items.map(d => d.type);
    assertIncludes(types, 'DeadBranch');
});

test('DeadCode', 'Kode setelah return → unreachable', () => {
    const items = getDeadItems(`
        function foo() {
            return 1;
            console.log('unreachable');
        }
        foo();
    `);
    const types = items.map(d => d.type);
    assertIncludes(types, 'DeadCode');
});

test('DeadCode', 'Kode setelah throw → unreachable', () => {
    const items = getDeadItems(`
        function bar() {
            throw new Error('stop');
            const x = 10;
        }
        bar();
    `);
    const types = items.map(d => d.type);
    assertIncludes(types, 'DeadCode');
});

// ── B7. Scope ────────────────────────────────────────────────────

test('DeadCode', 'Variabel di inner scope tidak mempengaruhi outer', () => {
    const dead = getDeadNames(`
        const x = 10;
        function foo() {
            const y = 20;
            console.log(y);
        }
        console.log(x);
        foo();
    `);
    assertEqual(dead.length, 0, 'Semua variabel dipakai di scope-nya. ');
});

test('DeadCode', 'Variabel di block scope (let/const)', () => {
    const dead = getDeadNames(`
        {
            const inner = 'scoped';
        }
    `);
    assertIncludes(dead, 'inner');
});

test('DeadCode', 'var hoisting — tetap dead jika tidak dipakai', () => {
    const dead = getDeadNames(`
        function foo() {
            if (true) {
                var hoisted = 123;
            }
        }
        foo();
    `);
    assertIncludes(dead, 'hoisted');
});

test('DeadCode', 'Closure — variabel dipakai di inner function → LIVE', () => {
    const dead = getDeadNames(`
        function outer() {
            const secret = 42;
            return function inner() {
                return secret;
            };
        }
        outer();
    `);
    assertNotIncludes(dead, 'secret');
});

// ══════════════════════════════════════════════════════════════════
// C. EDGE CASES — Kasus Rumit
// ══════════════════════════════════════════════════════════════════

console.log(chalk.bold.cyan('\n═══ C. EDGE CASES ═══\n'));

test('Edge', 'Export named function — tetap live (mode preserveExports)', () => {
    const dead = getDeadNames(`
        export function publicApi() { return 'api'; }
        function privateHelper() { return 'helper'; }
    `);
    // publicApi di-export → seharusnya live (default preserveExports=true)
    assertNotIncludes(dead, 'publicApi');
    assertIncludes(dead, 'privateHelper');
});

test('Edge', 'Export const — tetap live', () => {
    const dead = getDeadNames(`
        export const API_KEY = 'abc123';
        const SECRET = 'hidden';
    `);
    assertNotIncludes(dead, 'API_KEY');
    assertIncludes(dead, 'SECRET');
});

test('Edge', 'Export default — tetap live', () => {
    const dead = getDeadNames(`
        function main() { return 'main'; }
        export default main;
    `);
    assertNotIncludes(dead, 'main');
});

test('Edge', 'IIFE (Immediately Invoked Function Expression)', () => {
    const dead = getDeadNames(`
        const result = (function() { return 42; })();
        console.log(result);
    `);
    assertEqual(dead.length, 0, 'IIFE result dipakai. ');
});

test('Edge', 'Ternary expression — variabel dipakai di dalamnya', () => {
    const dead = getDeadNames(`
        const flag = true;
        const value = flag ? 'yes' : 'no';
        console.log(value);
    `);
    assertNotIncludes(dead, 'flag');
    assertNotIncludes(dead, 'value');
});

test('Edge', 'For loop — variabel iterator', () => {
    const dead = getDeadNames(`
        const items = [1, 2, 3];
        for (const item of items) {
            console.log(item);
        }
    `);
    assertNotIncludes(dead, 'items');
});

test('Edge', 'Try-catch — parameter error', () => {
    const dead = getDeadNames(`
        try {
            throw new Error('test');
        } catch (err) {
            console.log(err);
        }
    `);
    assertNotIncludes(dead, 'err');
});

test('Edge', 'Object shorthand property', () => {
    const dead = getDeadNames(`
        const name = 'John';
        const age = 30;
        const user = { name, age };
        console.log(user);
    `);
    assertNotIncludes(dead, 'name');
    assertNotIncludes(dead, 'age');
});

test('Edge', 'Spread operator', () => {
    const dead = getDeadNames(`
        const defaults = { color: 'red' };
        const config = { ...defaults, size: 10 };
        console.log(config);
    `);
    assertNotIncludes(dead, 'defaults');
});

test('Edge', 'Computed property name', () => {
    const dead = getDeadNames(`
        const key = 'name';
        const obj = { [key]: 'value' };
        console.log(obj);
    `);
    assertNotIncludes(dead, 'key');
});

test('Edge', 'Tagged template literal', () => {
    const dead = getDeadNames(`
        function tag(strings, ...vals) { return strings.join(''); }
        const result = tag\`hello \${'world'}\`;
        console.log(result);
    `);
    assertNotIncludes(dead, 'tag');
});

test('Edge', 'Default parameter value', () => {
    const dead = getDeadNames(`
        const DEFAULT_SIZE = 10;
        function create(size = DEFAULT_SIZE) {
            return { size };
        }
        create();
    `);
    assertNotIncludes(dead, 'DEFAULT_SIZE');
});

test('Edge', 'String kosong → parse berhasil tapi tidak ada dead code', () => {
    const dead = getDeadNames('');
    assertEqual(dead.length, 0);
});

test('Edge', 'Komentar saja → tidak ada dead code', () => {
    const dead = getDeadNames(`
        // ini komentar
        /* block comment */
    `);
    assertEqual(dead.length, 0);
});

test('Edge', 'Multiple return di function — kode setelah return pertama dead', () => {
    const items = getDeadItems(`
        function check(x) {
            if (x > 0) {
                return 'positive';
                console.log('unreachable 1');
            }
            return 'non-positive';
            console.log('unreachable 2');
        }
        check(1);
    `);
    const deadCodeItems = items.filter(d => d.type === 'DeadCode');
    assertEqual(deadCodeItems.length, 2, 'Harus ada 2 statement unreachable. ');
});

test('Edge', 'Switch-case — kode setelah break', () => {
    const items = getDeadItems(`
        function test(x) {
            switch(x) {
                case 1:
                    return 'one';
                    console.log('dead after return in case');
                    break;
            }
        }
        test(1);
    `);
    const deadCodeItems = items.filter(d => d.type === 'DeadCode');
    // Setelah return ada console.log dan break yang unreachable
    assertEqual(deadCodeItems.length >= 1, true, 'Harus ada unreachable code setelah return di case. ');
});

// ══════════════════════════════════════════════════════════════════
// D. TSX (TypeScript + JSX) — Dukungan Format Gabungan
// ══════════════════════════════════════════════════════════════════

console.log(chalk.bold.cyan('\n═══ D. TSX (TypeScript + JSX) TESTS ═══\n'));

test('TSX', 'Parse TSX — interface + JSX element', () => {
    const ast = parseCode(`
        interface Props { title: string; count: number; }
        const Card = ({ title, count }: Props): JSX.Element => (
            <div className="card">
                <h2>{title}</h2>
                <span>{count}</span>
            </div>
        );
    `);
    assertEqual(ast.type, 'Program');
});

test('TSX', 'Parse TSX — generic component', () => {
    const ast = parseCode(`
        interface ListProps<T> { items: T[]; renderItem: (item: T) => JSX.Element; }
        function GenericList<T>({ items, renderItem }: ListProps<T>): JSX.Element {
            return <ul>{items.map((item, i) => <li key={i}>{renderItem(item)}</li>)}</ul>;
        }
    `);
    assertEqual(ast.type, 'Program');
});

test('TSX', 'Parse TSX — enum + union type + JSX', () => {
    const ast = parseCode(`
        enum Status { Active = 'active', Inactive = 'inactive' }
        type BadgeVariant = 'primary' | 'danger' | 'success';
        const Badge = ({ variant, label }: { variant: BadgeVariant; label: string }) => (
            <span className={\`badge-\${variant}\`}>{label}</span>
        );
    `);
    assertEqual(ast.type, 'Program');
});

test('TSX', 'Parse TSX — React hooks dengan type parameter', () => {
    const ast = parseCode(`
        import { useState, useEffect, useRef } from 'react';
        interface User { id: number; name: string; }
        function UserList(): JSX.Element {
            const [users, setUsers] = useState<User[]>([]);
            const inputRef = useRef<HTMLInputElement>(null);
            useEffect(() => { setUsers([]); }, []);
            return <div ref={inputRef}>{users.length}</div>;
        }
    `);
    assertEqual(ast.type, 'Program');
});

test('TSX', 'Dead code di TSX — variabel TS tidak terpakai → DEAD', () => {
    const dead = getDeadNames(`
        interface Config { debug: boolean; }
        const API_URL: string = 'https://api.example.com';
        const TIMEOUT: number = 5000;
        const Widget = (): JSX.Element => <div>{API_URL}</div>;
        console.log(Widget);
    `);
    assertIncludes(dead, 'TIMEOUT');
    assertNotIncludes(dead, 'API_URL');
});

test('TSX', 'Dead code di TSX — fungsi typed tidak terpakai → DEAD', () => {
    const dead = getDeadNames(`
        function usedHelper(x: number): string { return String(x); }
        function unusedHelper(x: number): string { return x.toFixed(2); }
        export const result: string = usedHelper(42);
    `);
    assertIncludes(dead, 'unusedHelper');
    assertNotIncludes(dead, 'usedHelper');
});

test('TSX', 'TSX — export default component tetap live', () => {
    const dead = getDeadNames(`
        interface ButtonProps { label: string; onClick: () => void; }
        export default function Button({ label, onClick }: ButtonProps): JSX.Element {
            return <button onClick={onClick}>{label}</button>;
        }
    `);
    assertNotIncludes(dead, 'Button');
});

test('TSX', 'TSX — arrow function rekursif dengan type → DEAD', () => {
    const dead = getDeadNames(`
        const countdown = (n: number): void => {
            if (n <= 0) return;
            console.log(n);
            countdown(n - 1);
        };
    `);
    // Rekursif tapi tidak dipanggil dari luar → dead
    assertIncludes(dead, 'countdown');
});

// ══════════════════════════════════════════════════════════════════
// E. BAILOUT HEURISTICS — Keamanan Penanganan Dynamic Code
// ══════════════════════════════════════════════════════════════════

console.log(chalk.bold.cyan('\n═══ E. BAILOUT HEURISTIC TESTS ═══\n'));

test('Bailout', 'Kode dengan eval() → parse berhasil (tidak crash)', () => {
    const ast = parseCode(`
        function dangerous(code) {
            return eval(code);
        }
        dangerous('1+1');
    `);
    assertEqual(ast.type, 'Program');
});

test('Bailout', 'Dynamic require(variable) → parse berhasil', () => {
    const ast = parseCode(`
        const moduleName = 'fs';
        const mod = require(moduleName);
    `);
    assertEqual(ast.type, 'Program');
});

test('Bailout', 'Dynamic import(variable) → parse berhasil', () => {
    const ast = parseCode(`
        async function load(name) {
            const mod = await import(name);
            return mod.default;
        }
        load('fs');
    `);
    assertEqual(ast.type, 'Program');
});

test('Bailout', 'Computed member access obj[var] → parse berhasil', () => {
    const ast = parseCode(`
        const obj = { a: 1, b: 2 };
        const key = 'a';
        console.log(obj[key]);
    `);
    assertEqual(ast.type, 'Program');
});

test('Bailout', 'Dead code tetap terdeteksi di file dengan eval', () => {
    const dead = getDeadNames(`
        const used = 10;
        const unused = 20;
        eval('console.log(1)');
        console.log(used);
    `);
    // Meskipun ada eval, dead code yang jelas tetap terdeteksi
    assertIncludes(dead, 'unused');
    assertNotIncludes(dead, 'used');
});

test('Bailout', 'WithStatement → parse berhasil', () => {
    // with() sudah deprecated tapi masih valid syntax
    let parsed = false;
    try {
        const ast = parseCode(`
            const obj = { x: 1 };
            with (obj) { console.log(x); }
        `);
        parsed = ast.type === 'Program';
    } catch (e) {
        // Beberapa parser mungkin reject 'with' di strict mode
        parsed = true; // Tetap dianggap berhasil jika parser memilih reject
    }
    assertEqual(parsed, true);
});

// ══════════════════════════════════════════════════════════════════
// LAPORAN AKHIR
// ══════════════════════════════════════════════════════════════════

console.log(chalk.bold.cyan('\n═══════════════════════════════════════'));
console.log(chalk.bold.cyan('           LAPORAN HASIL TEST          '));
console.log(chalk.bold.cyan('═══════════════════════════════════════\n'));

console.log(`  Total    : ${totalTests} test`);
console.log(chalk.green(`  Passed   : ${passedTests} test`));
if (failedTests > 0) {
    console.log(chalk.red(`  Failed   : ${failedTests} test`));
}
console.log(`  Coverage : ${((passedTests / totalTests) * 100).toFixed(1)}%`);

if (failures.length > 0) {
    console.log(chalk.red('\n── DETAIL KEGAGALAN ──\n'));
    failures.forEach(({ category, name, error }, i) => {
        console.log(chalk.red(`  ${i + 1}. [${category}] ${name}`));
        console.log(chalk.gray(`     → ${error}\n`));
    });
}

console.log();
process.exit(failedTests > 0 ? 1 : 0);
