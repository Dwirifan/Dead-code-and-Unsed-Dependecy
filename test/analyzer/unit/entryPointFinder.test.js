import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import path from 'path';
import os from 'os';
import fs from 'fs-extra';

import { findEntryPoints } from '../../../src/analyzer/graph/entryPointFinder.js';

async function createProject(pkg = {}) {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'deadkiller-entry-'));
    await fs.writeJson(path.join(projectRoot, 'package.json'), {
        name: 'entry-fixture',
        private: true,
        ...pkg,
    });
    return projectRoot;
}

function createRuleEngine({ entryPoints = [], ignoreFiles = [] } = {}) {
    return { rules: { entryPoints, ignoreFiles } };
}

function relativeEntries(entries, projectRoot) {
    return entries.map(entry => path.relative(projectRoot, entry).replace(/\\/g, '/'));
}

describe('Entry Point Finder accuracy', () => {
    it('memakai source fallback ketika manifest dist diabaikan', async () => {
        const projectRoot = await createProject({ main: 'dist/index.js' });
        try {
            await fs.outputFile(path.join(projectRoot, 'dist/index.js'), 'module.exports = {};\n');
            await fs.outputFile(path.join(projectRoot, 'src/index.ts'), 'export {};\n');

            const entries = relativeEntries(
                await findEntryPoints(projectRoot, createRuleEngine({ ignoreFiles: ['dist/**'] })),
                projectRoot,
            );

            assert.ok(entries.includes('src/index.ts'));
            assert.ok(!entries.includes('dist/index.js'));
        } finally {
            await fs.remove(projectRoot);
        }
    });

    it('melaporkan exact custom entry yang tidak ada meski fallback tersedia', async () => {
        const projectRoot = await createProject({ main: 'index.js' });
        try {
            await fs.outputFile(path.join(projectRoot, 'index.js'), 'console.log("runtime");\n');

            await assert.rejects(
                findEntryPoints(projectRoot, createRuleEngine({
                    entryPoints: ['src/typo-entry.ts'],
                })),
                error => {
                    assert.equal(error.code, 'DEADKILLER_ENTRY_NOT_FOUND');
                    assert.match(error.message, /src\/typo-entry\.ts/);
                    assert.equal(error.diagnostics?.[0]?.pattern, 'src/typo-entry.ts');
                    return true;
                },
            );
        } finally {
            await fs.remove(projectRoot);
        }
    });

    it('mengekspansi custom directory entry hanya ke file script yang didukung', async () => {
        const projectRoot = await createProject();
        try {
            await fs.outputFile(path.join(projectRoot, 'src/main.ts'), 'export {};\n');
            await fs.outputFile(path.join(projectRoot, 'src/nested/worker.js'), 'export {};\n');
            await fs.outputFile(path.join(projectRoot, 'src/README.md'), '# bukan entry\n');

            const entries = relativeEntries(
                await findEntryPoints(projectRoot, createRuleEngine({ entryPoints: ['src'] })),
                projectRoot,
            );

            assert.deepEqual(entries.sort(), ['src/main.ts', 'src/nested/worker.js']);
        } finally {
            await fs.remove(projectRoot);
        }
    });

    it('meresolusi manifest directory ke index tanpa menghidupkan seluruh subtree', async () => {
        const projectRoot = await createProject({ main: 'src' });
        try {
            await fs.outputFile(path.join(projectRoot, 'src/index.js'), 'export {};\n');
            await fs.outputFile(path.join(projectRoot, 'src/dead.js'), 'export {};\n');

            const entries = relativeEntries(await findEntryPoints(projectRoot), projectRoot);

            assert.ok(entries.includes('src/index.js'));
            assert.ok(!entries.includes('src/dead.js'));
        } finally {
            await fs.remove(projectRoot);
        }
    });

    it('menjadikan hanya file convention Next sebagai root, bukan helper app', async () => {
        const projectRoot = await createProject({
            dependencies: { next: '^16.0.0', react: '^19.0.0' },
        });
        try {
            await fs.outputFile(path.join(projectRoot, 'app/page.tsx'), 'export default null;\n');
            await fs.outputFile(path.join(projectRoot, 'app/lib/dead.ts'), 'export const dead = 1;\n');
            await fs.outputFile(path.join(projectRoot, 'instrumentation.ts'), 'export function register() {}\n');
            await fs.outputFile(path.join(projectRoot, 'proxy.ts'), 'export function proxy() {}\n');

            const entries = relativeEntries(await findEntryPoints(projectRoot), projectRoot);

            assert.ok(entries.includes('app/page.tsx'));
            assert.ok(entries.includes('instrumentation.ts'));
            assert.ok(entries.includes('proxy.ts'));
            assert.ok(!entries.includes('app/lib/dead.ts'));
        } finally {
            await fs.remove(projectRoot);
        }
    });

    it('menolak proyek yang hanya memiliki config tanpa runtime entry', async () => {
        const projectRoot = await createProject();
        try {
            await fs.outputFile(path.join(projectRoot, 'vite.config.js'), 'export default {};\n');
            await fs.outputFile(path.join(projectRoot, '.eslintrc.js'), 'module.exports = {};\n');

            await assert.rejects(
                findEntryPoints(projectRoot),
                error => {
                    assert.equal(error.code, 'DEADKILLER_ENTRY_POINT_NOT_FOUND');
                    assert.match(error.message, /File config, test, atau example saja tidak cukup/);
                    return true;
                },
            );
        } finally {
            await fs.remove(projectRoot);
        }
    });

    it('menerapkan custom entry pattern secara berurutan termasuk negasi dan re-include', async () => {
        const projectRoot = await createProject();
        try {
            await fs.outputFile(path.join(projectRoot, 'src/app.js'), 'export {};\n');
            await fs.outputFile(path.join(projectRoot, 'src/generated/drop.js'), 'export {};\n');
            await fs.outputFile(path.join(projectRoot, 'src/generated/keep.js'), 'export {};\n');

            const entries = relativeEntries(
                await findEntryPoints(projectRoot, createRuleEngine({
                    entryPoints: [
                        'src/**/*.js',
                        '!src/generated/**',
                        'src/generated/keep.js',
                    ],
                })),
                projectRoot,
            );

            assert.ok(entries.includes('src/app.js'));
            assert.ok(entries.includes('src/generated/keep.js'));
            assert.ok(!entries.includes('src/generated/drop.js'));
        } finally {
            await fs.remove(projectRoot);
        }
    });

    it('menolak custom entry yang keluar dari root proyek', async () => {
        const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'deadkiller-containment-'));
        const projectRoot = path.join(fixtureRoot, 'project');
        try {
            await fs.ensureDir(projectRoot);
            await fs.writeJson(path.join(projectRoot, 'package.json'), { name: 'contained-project' });
            await fs.writeFile(path.join(fixtureRoot, 'outside.js'), 'export {};\n');

            await assert.rejects(
                findEntryPoints(projectRoot, createRuleEngine({ entryPoints: ['../outside.js'] })),
                error => {
                    assert.equal(error.code, 'DEADKILLER_ENTRY_OUTSIDE_PROJECT');
                    assert.match(error.message, /di luar root proyek/);
                    return true;
                },
            );
        } finally {
            await fs.remove(fixtureRoot);
        }
    });

    it('mengabaikan manifest entry di luar root lalu memakai source fallback', async () => {
        const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'deadkiller-manifest-containment-'));
        const projectRoot = path.join(fixtureRoot, 'project');
        try {
            await fs.ensureDir(projectRoot);
            await fs.writeJson(path.join(projectRoot, 'package.json'), {
                name: 'contained-project',
                main: '../outside.js',
            });
            await fs.writeFile(path.join(fixtureRoot, 'outside.js'), 'export {};\n');
            await fs.outputFile(path.join(projectRoot, 'src/index.js'), 'export {};\n');

            const entries = relativeEntries(await findEntryPoints(projectRoot), projectRoot);
            assert.deepEqual(entries, ['src/index.js']);
        } finally {
            await fs.remove(fixtureRoot);
        }
    });
});
