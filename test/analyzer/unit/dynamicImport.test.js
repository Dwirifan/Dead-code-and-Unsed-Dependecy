import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';

import { buildProjectGraph } from '../../../src/analyzer/graph/projectGraph.js';
import { findDeadCode } from '../../../src/analyzer/deadcode/index.js';
import { RuleEngine } from '../../../src/analyzer/ruleEngine.js';
import { parseCode } from '../../../src/parser/astParser.js';

async function createDynamicProject() {
    const tmpDir = path.join(os.tmpdir(), `dce-dyn-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    await fs.ensureDir(tmpDir);
    await fs.ensureDir(path.join(tmpDir, 'pages'));
    await fs.ensureDir(path.join(tmpDir, 'plugins'));

    await fs.writeJSON(path.join(tmpDir, 'package.json'), {
        name: 'dyn-project',
        version: '1.0.0',
        main: 'index.js'
    });

    await fs.writeFile(
        path.join(tmpDir, 'pages', 'home.js'),
        `export const title = 'Home';\n`
    );

    await fs.writeFile(
        path.join(tmpDir, 'pages', 'about.js'),
        `export const title = 'About';\n`
    );

    await fs.writeFile(
        path.join(tmpDir, 'plugins', 'analytics.js'),
        `export default function init() {}\n`
    );

    await fs.writeFile(
        path.join(tmpDir, 'plugins', 'logger.js'),
        `export default function log() {}\n`
    );

    await fs.writeFile(
        path.join(tmpDir, 'index.js'),
        [
            `async function loadPage(name) {`,
            `    const mod = await import(\`./pages/\${name}.js\`);`,
            `    return mod.title;`,
            `}`,
            `const plugins = import.meta.glob('./plugins/*.js');`,
            `console.log(loadPage, plugins);`
        ].join('\n')
    );

    return tmpDir;
}

describe('Dynamic Imports & import.meta.glob Support', () => {
    it('Should detect files targeted by template literal dynamic imports and import.meta.glob as live files', async () => {
        const tmpDir = await createDynamicProject();
        try {
            const { liveFiles, edges } = await buildProjectGraph(tmpDir);
            const filenames = [...liveFiles].map(f => path.basename(f));

            assert.ok(filenames.includes('home.js'), 'home.js should be included in liveFiles via dynamic import template literal');
            assert.ok(filenames.includes('about.js'), 'about.js should be included in liveFiles via dynamic import template literal');
            assert.ok(filenames.includes('analytics.js'), 'analytics.js should be included in liveFiles via import.meta.glob');
            assert.ok(filenames.includes('logger.js'), 'logger.js should be included in liveFiles via import.meta.glob');

            const hasGlobEdge = edges.some(e => path.basename(e.to) === 'analytics.js' && e.names.includes('*'));
            assert.ok(hasGlobEdge, 'Should record wildcard edge to analytics.js');
        } finally {
            await fs.remove(tmpDir);
        }
    });

    it('Should conservatively treat all exports as used when file is in unsafeFiles (eval/computed/dynamic)', async () => {
        const tmpDir = path.join(os.tmpdir(), `dce-unsafe-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
        await fs.ensureDir(tmpDir);
        await fs.writeJSON(path.join(tmpDir, 'package.json'), { name: 'unsafe-proj', version: '1.0.0', main: 'index.js' });

        const unsafeFilePath = path.join(tmpDir, 'dynamic.js');
        const code = [
            `export function normalFunc() { return 1; }`,
            `export function dynamicTarget() { return 2; }`,
            `eval('console.log(dynamicTarget())');`
        ].join('\n');
        await fs.writeFile(unsafeFilePath, code);
        await fs.writeFile(path.join(tmpDir, 'index.js'), `import './dynamic.js';\n`);

        try {
            const { globalRegistry } = await buildProjectGraph(tmpDir);
            const ast = await parseCode(code, unsafeFilePath);
            const ruleEngine = new RuleEngine({ preserveExports: 'strict' });

            const deadNodes = findDeadCode(ast, unsafeFilePath, globalRegistry, ruleEngine);
            assert.equal(deadNodes.length, 0, 'Should not report any dead exports in unsafeFiles');
        } finally {
            await fs.remove(tmpDir);
        }
    });
});
