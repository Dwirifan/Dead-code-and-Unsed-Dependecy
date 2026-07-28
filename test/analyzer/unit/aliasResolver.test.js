import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';

import { resolvePath, clearResolverCache } from '../../../src/analyzer/graph/pathResolver.js';

async function createAliasProject() {
    const tmpDir = path.join(os.tmpdir(), `dce-alias-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    await fs.ensureDir(tmpDir);
    await fs.ensureDir(path.join(tmpDir, 'src', 'components'));
    await fs.ensureDir(path.join(tmpDir, 'src', 'lib', 'utils'));

    await fs.writeJSON(path.join(tmpDir, 'package.json'), {
        name: 'alias-project',
        version: '1.0.0',
        imports: {
            '#utils/*': './src/lib/utils/*'
        }
    });

    // Gunakan jsconfig.json (bukan tsconfig.json) untuk menguji fallback JS project
    await fs.writeJSON(path.join(tmpDir, 'jsconfig.json'), {
        compilerOptions: {
            baseUrl: '.',
            paths: {
                '@components/*': ['./src/components/*'],
                '~/*': ['./src/*']
            }
        }
    });

    await fs.writeFile(
        path.join(tmpDir, 'src', 'components', 'Button.jsx'),
        `export default function Button() { return null; }\n`
    );

    await fs.writeFile(
        path.join(tmpDir, 'src', 'lib', 'utils', 'math.js'),
        `export function add(a, b) { return a + b; }\n`
    );

    await fs.writeFile(
        path.join(tmpDir, 'src', 'index.js'),
        `console.log('index');\n`
    );

    return tmpDir;
}

describe('Alias Resolver (jsconfig, package.json imports, default aliases)', () => {
    beforeEach(() => {
        clearResolverCache();
    });

    it('Should resolve aliases defined in jsconfig.json and #* imports from package.json', async () => {
        const tmpDir = await createAliasProject();
        try {
            const baseDir = path.join(tmpDir, 'src');

            const btnPath = await resolvePath(tmpDir, baseDir, '@components/Button');
            assert.ok(btnPath, 'Should resolve @components/Button using jsconfig.json');
            assert.equal(path.normalize(btnPath), path.normalize(path.join(tmpDir, 'src', 'components', 'Button.jsx')));

            const tildePath = await resolvePath(tmpDir, baseDir, '~/components/Button');
            assert.ok(tildePath, 'Should resolve ~/components/Button using jsconfig.json');

            const mathPath = await resolvePath(tmpDir, baseDir, '#utils/math');
            assert.ok(mathPath, 'Should resolve #utils/math from package.json imports field');
            assert.equal(path.normalize(mathPath), path.normalize(path.join(tmpDir, 'src', 'lib', 'utils', 'math.js')));
        } finally {
            await fs.remove(tmpDir);
        }
    });

    it('Should use default aliases (@, ~, $lib) when no tsconfig or jsconfig is present', async () => {
        const tmpDir = path.join(os.tmpdir(), `dce-defalias-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
        await fs.ensureDir(tmpDir);
        await fs.ensureDir(path.join(tmpDir, 'src', 'lib', 'helpers'));
        await fs.writeFile(path.join(tmpDir, 'src', 'lib', 'helpers', 'format.js'), `export const fmt = () => {};\n`);

        try {
            clearResolverCache();
            const baseDir = path.join(tmpDir, 'src');
            const formatPath = await resolvePath(tmpDir, baseDir, '$lib/helpers/format');
            assert.ok(formatPath, 'Should resolve $lib default alias to src/lib');
            assert.equal(path.normalize(formatPath), path.normalize(path.join(tmpDir, 'src', 'lib', 'helpers', 'format.js')));
        } finally {
            await fs.remove(tmpDir);
        }
    });
});
