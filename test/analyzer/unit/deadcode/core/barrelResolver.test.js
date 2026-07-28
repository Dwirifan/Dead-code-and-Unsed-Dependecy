import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';

import { resolveBarrelExports } from '../../../../../src/analyzer/deadcode/core/barrelResolver.js';
import { clearResolverCache } from '../../../../../src/analyzer/graph/pathResolver.js';

describe('Barrel Resolver (Complex re-exports, namespace re-exports, and aliases)', () => {
    beforeEach(() => {
        clearResolverCache();
    });

    it('Should resolve wildcard, namespace, named re-exports, and alias re-exports correctly', async () => {
        const tmpDir = path.join(os.tmpdir(), `dce-barrel-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
        await fs.ensureDir(path.join(tmpDir, 'src', 'utils'));

        await fs.writeJSON(path.join(tmpDir, 'jsconfig.json'), {
            compilerOptions: {
                baseUrl: '.',
                paths: {
                    '@utils/*': ['./src/utils/*']
                }
            }
        });

        // math.js exports 'add' and 'subtract'
        await fs.writeFile(
            path.join(tmpDir, 'src', 'utils', 'math.js'),
            `export function add(a, b) { return a + b; }\nexport function subtract(a, b) { return a - b; }\n`
        );

        // string.js exports 'capitalize' and 'trim'
        await fs.writeFile(
            path.join(tmpDir, 'src', 'utils', 'string.js'),
            `export const capitalize = (s) => s.toUpperCase();\nexport const trim = (s) => s.trim();\n`
        );

        // index.js (barrel file) using different export styles
        await fs.writeFile(
            path.join(tmpDir, 'src', 'utils', 'index.js'),
            `export * from './math.js';\nexport * as strNs from './string.js';\nexport { capitalize as upper } from '@utils/string';\nexport const localVal = 42;\n`
        );

        try {
            const barrelPath = path.join(tmpDir, 'src', 'utils', 'index.js');
            const exportsSet = await resolveBarrelExports(barrelPath, tmpDir);

            assert.ok(exportsSet.has('add'), 'Should resolve wildcard re-export add from math.js');
            assert.ok(exportsSet.has('subtract'), 'Should resolve wildcard re-export subtract from math.js');
            assert.ok(exportsSet.has('strNs'), 'Should resolve namespace re-export strNs');
            assert.ok(exportsSet.has('upper'), 'Should resolve named re-export upper using alias @utils/string');
            assert.ok(exportsSet.has('localVal'), 'Should include local export localVal');
            assert.equal(exportsSet.has('capitalize'), false, 'Should not include capitalize directly as it was renamed to upper and namespaced in strNs');
        } finally {
            await fs.remove(tmpDir);
        }
    });
});
