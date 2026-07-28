import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';

import { buildProjectGraph } from '../../../src/analyzer/graph/projectGraph.js';
import { findUnusedDependencies } from '../../../src/analyzer/dependency/dependencyAnalyzer.js';

/**
 * Membuat direktori proyek dummy sementara di folder temp OS.
 *
 *   dummy-project/
 *   ├── package.json          ← entry: "main": "index.js"
 *   ├── index.js              ← entry point
 *   └── utils/
 *       └── index.js          ← barrel file (re-export)
 */
async function buatProyekDummy() {
    const tmpDir = path.join(os.tmpdir(), `dce-test-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    await fs.ensureDir(tmpDir);
    await fs.ensureDir(path.join(tmpDir, 'utils'));

    // package.json proyek dummy (ada satu dep yang tidak dipakai = 'lodash')
    await fs.writeJSON(path.join(tmpDir, 'package.json'), {
        name: 'dummy-project',
        version: '1.0.0',
        main: 'index.js',
        dependencies: {
            chalk: '*',   // ← akan DI-IMPORT di index.js (used)
            lodash: '*'   // ← tidak di-import di mana pun (unused)
        }
    });

    // Barrel file: utils/index.js
    await fs.writeFile(
        path.join(tmpDir, 'utils', 'index.js'),
        `export function greet(name) { return 'Hello ' + name; }\n`
    );

    // Entry point: index.js
    await fs.writeFile(
        path.join(tmpDir, 'index.js'),
        [
            `import chalk from 'chalk';`,                        // npm package (used)
            `import { greet } from './utils/index.js';`,         // barrel import
            `console.log(chalk.green(greet('Dunia')));`
        ].join('\n')
    );

    return tmpDir;
}

describe('[TC-G01] BFS Traversal & Entry Point Finder', () => {

    it('TC-G01: Graph Builder menemukan semua file yang dapat dijangkau via BFS', async () => {
        const proyekDummy = await buatProyekDummy();
        try {
            const { liveFiles } = await buildProjectGraph(proyekDummy);

            assert.ok(liveFiles instanceof Set, 'liveFiles harus berupa Set');
            assert.ok(liveFiles.size > 0, 'BFS harus menemukan setidaknya satu file dari entry point');

            const entries = [...liveFiles].map(f => path.basename(f));
            assert.ok(entries.includes('index.js'), 'index.js (entry point) harus ada di liveFiles');
        } finally {
            await fs.remove(proyekDummy);
        }
    });
});

describe('[TC-G02] Barrel Export (index.js) Resolver', () => {

    it('TC-G02: Graph Builder menembus barrel file (index.js) dan merekam edges', async () => {
        const proyekDummy = await buatProyekDummy();
        try {
            const { edges } = await buildProjectGraph(proyekDummy);

            assert.ok(Array.isArray(edges), 'edges harus berupa Array');
            assert.ok(edges.length > 0, 'Harus ada setidaknya satu relasi impor yang berhasil direkam');

            for (const edge of edges) {
                assert.ok(edge.from, 'Setiap edge harus punya properti "from"');
                assert.ok(edge.to, 'Setiap edge harus punya properti "to"');
                assert.ok(Array.isArray(edge.names), 'Setiap edge harus punya properti "names" berupa Array');
            }

            const adaBarrel = edges.some(e => path.basename(e.from) === 'index.js' && e.to.includes('utils'));
            assert.ok(adaBarrel, 'Harus ada edge dari index.js menuju utils/index.js (barrel file)');
        } finally {
            await fs.remove(proyekDummy);
        }
    });
});

describe('[TC-G03] Deteksi Unused Dependencies', () => {

    it('TC-G03: Dependensi yang tidak di-import terdeteksi via set difference', async () => {
        const proyekDummy = await buatProyekDummy();
        try {
            const { usedPackages } = await buildProjectGraph(proyekDummy);
            const depReport = await findUnusedDependencies(proyekDummy, usedPackages);

            assert.ok(depReport !== undefined, 'Laporan dependensi harus selalu dikembalikan');
            assert.ok(Array.isArray(depReport.unused), 'depReport.unused harus berupa Array');
            assert.ok(depReport.unused.includes('lodash'), '"lodash" yang tidak di-import harus masuk daftar unused dependencies');
        } finally {
            await fs.remove(proyekDummy);
        }
    });

    it('mengenali package yang digunakan melalui require.resolve()', async () => {
        const proyekDummy = await buatProyekDummy();
        try {
            await fs.writeFile(
                path.join(proyekDummy, 'index.js'),
                `console.log(require.resolve('lodash'));\n`
            );

            const graph = await buildProjectGraph(proyekDummy);

            assert.ok(graph.usedPackages.has('lodash'));
            assert.equal(graph.dynamicDependencyFiles.size, 0);
        } finally {
            await fs.remove(proyekDummy);
        }
    });
});
