import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';

import { buildProjectGraph } from '../../../src/analyzer/graph/projectGraph.js';

describe('Cross-File Usage Detection (Destructuring, Namespace Member Access, Renamed Imports, Re-exports)', () => {
    it('Should accurately track used exports across files for complex import/usage patterns', async () => {
        const tmpDir = path.join(os.tmpdir(), `dce-cross-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
        await fs.ensureDir(tmpDir);

        await fs.writeJSON(path.join(tmpDir, 'package.json'), {
            name: 'cross-project',
            version: '1.0.0',
            main: 'index.js'
        });

        // mod.js exports 5 functions
        const modPath = path.join(tmpDir, 'mod.js');
        await fs.writeFile(
            modPath,
            [
                `export function add(a, b) { return a + b; }`,
                `export function subtract(a, b) { return a - b; }`,
                `export function multiply(a, b) { return a * b; }`,
                `export function divide(a, b) { return a / b; }`,
                `export function unusedFunc() { return 'unused'; }`
            ].join('\n')
        );

        // reexporter.js re-exports 'divide' from mod.js
        await fs.writeFile(
            path.join(tmpDir, 'reexporter.js'),
            `export { divide } from './mod.js';\n`
        );

        // index.js imports and uses the functions in various ways
        await fs.writeFile(
            path.join(tmpDir, 'index.js'),
            [
                `import * as ns from './mod.js';`,                  // namespace import
                `import { multiply as mult } from './mod.js';`,       // renamed import
                `import { divide } from './reexporter.js';`,          // using re-export
                `import { add as addFunc } from './mod.js';`,         // another renamed import
                ``,
                `console.log(ns.subtract(10, 5));`,                   // namespace member access
                `console.log(mult(2, 3));`,                           // renamed usage
                `console.log(divide(20, 4));`,                        // re-exported usage
                `console.log(addFunc(1, 1));`                         // renamed usage
            ].join('\n')
        );

        try {
            const { globalRegistry } = await buildProjectGraph(tmpDir);

            const modUsedExports = globalRegistry.usedExports.get(modPath) || new Set();

            assert.ok(modUsedExports.has('subtract'), 'Should detect namespace member access ns.subtract as used in mod.js');
            assert.ok(modUsedExports.has('multiply'), 'Should detect renamed import multiply as used in mod.js');
            assert.ok(modUsedExports.has('divide'), 'Should detect re-exported divide as used in mod.js');
            assert.ok(modUsedExports.has('add'), 'Should detect renamed import add as used in mod.js');
            assert.equal(modUsedExports.has('unusedFunc'), false, 'Should not mark unusedFunc as used');
        } finally {
            await fs.remove(tmpDir);
        }
    });
});
