import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';

import { buildProjectGraph } from '../../../src/analyzer/graph/projectGraph.js';
import { findUnusedDependencies } from '../../../src/analyzer/dependency/dependencyAnalyzer.js';
import { RuleEngine } from '../../../src/analyzer/ruleEngine.js';

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

    it('custom entry glob tidak merayapi node_modules atau symlink di bawah examples', async () => {
        const proyekDummy = await buatProyekDummy();
        try {
            await fs.outputFile(
                path.join(proyekDummy, 'examples', 'demo.ts'),
                `import 'tinyexec';\n`,
            );
            await fs.outputFile(
                path.join(proyekDummy, 'examples', 'node_modules', 'fake-package', 'index.ts'),
                `throw new Error('must not be scanned');\n`,
            );

            const ruleEngine = new RuleEngine();
            ruleEngine.rules.entryPoints = ['index.js', 'examples/**/*.{js,ts}'];
            const { liveFiles, usedPackages } = await buildProjectGraph(proyekDummy, ruleEngine);
            const relativeFiles = [...liveFiles].map(file =>
                path.relative(proyekDummy, file).replace(/\\/g, '/')
            );

            assert.ok(relativeFiles.includes('examples/demo.ts'));
            assert.ok(!relativeFiles.some(file => file.includes('node_modules')));
            assert.ok(usedPackages.has('tinyexec'));
        } finally {
            await fs.remove(proyekDummy);
        }
    });

    it('mengabaikan protocol import non-npm dan menghormati glob ignoreFiles', async () => {
        const proyekDummy = await buatProyekDummy();
        try {
            await fs.outputFile(
                path.join(proyekDummy, 'examples', 'deno.ts'),
                `import cac from 'jsr:@cac/cac';\nconsole.log(cac);\n`,
            );
            await fs.outputFile(
                path.join(proyekDummy, 'dist', 'index.js'),
                `console.log('generated');\n`,
            );

            const ruleEngine = new RuleEngine();
            ruleEngine.rules.entryPoints = [
                'index.js',
                'examples/**/*.ts',
                'dist/index.js',
            ];
            ruleEngine.rules.ignoreFiles = ['dist/**'];
            const graph = await buildProjectGraph(proyekDummy, ruleEngine);
            const relativeFiles = [...graph.liveFiles].map(file =>
                path.relative(proyekDummy, file).replace(/\\/g, '/')
            );

            assert.ok(relativeFiles.includes('examples/deno.ts'));
            assert.ok(!relativeFiles.includes('dist/index.js'));
            assert.ok(!graph.usedPackages.has('jsr:@cac'));
        } finally {
            await fs.remove(proyekDummy);
        }
    });

    it('mendeteksi test Mocha sebagai root dan mencatat dependency yang hanya dipakai test', async () => {
        const proyekDummy = await buatProyekDummy();
        try {
            const pkgPath = path.join(proyekDummy, 'package.json');
            const pkg = await fs.readJson(pkgPath);
            pkg.scripts = { test: 'mocha --timeout 10000' };
            pkg.devDependencies = {
                chai: '*',
                'chai-http': '*',
                mocha: '*',
            };
            await fs.writeJson(pkgPath, pkg);
            await fs.outputFile(
                path.join(proyekDummy, 'test', 'products.js'),
                [
                    `const chai = require('chai');`,
                    `const chaiHttp = require('chai-http');`,
                    `chai.use(chaiHttp);`,
                ].join('\n'),
            );

            const graph = await buildProjectGraph(proyekDummy);
            const relativeFiles = [...graph.liveFiles].map(file =>
                path.relative(proyekDummy, file).replace(/\\/g, '/')
            );

            assert.ok(relativeFiles.includes('test/products.js'));
            assert.ok(graph.usedPackages.has('chai'));
            assert.ok(graph.usedPackages.has('chai-http'));
        } finally {
            await fs.remove(proyekDummy);
        }
    });

    it('tetap menghormati ignoreFiles ketika test terdeteksi otomatis', async () => {
        const proyekDummy = await buatProyekDummy();
        try {
            const pkgPath = path.join(proyekDummy, 'package.json');
            const pkg = await fs.readJson(pkgPath);
            pkg.scripts = { test: 'mocha' };
            pkg.devDependencies = { mocha: '*', 'chai-http': '*' };
            await fs.writeJson(pkgPath, pkg);
            await fs.outputFile(
                path.join(proyekDummy, 'test', 'ignored.js'),
                `require('chai-http');\n`,
            );

            const ruleEngine = new RuleEngine();
            ruleEngine.rules.ignoreFiles = ['test/**'];
            const graph = await buildProjectGraph(proyekDummy, ruleEngine);
            const relativeFiles = [...graph.liveFiles].map(file =>
                path.relative(proyekDummy, file).replace(/\\/g, '/')
            );

            assert.ok(!relativeFiles.includes('test/ignored.js'));
            assert.ok(!graph.usedPackages.has('chai-http'));
        } finally {
            await fs.remove(proyekDummy);
        }
    });

    it('menemukan runtime nonstandar dari script ketika main rusak dan test root ditemukan', async () => {
        const proyekDummy = await buatProyekDummy();
        try {
            const pkgPath = path.join(proyekDummy, 'package.json');
            const pkg = await fs.readJson(pkgPath);
            pkg.main = 'missing-index.js';
            pkg.scripts = {
                start: 'node services/http-entry.js',
                test: 'mocha',
            };
            pkg.devDependencies = { mocha: '*' };
            await fs.writeJson(pkgPath, pkg);
            await fs.outputFile(
                path.join(proyekDummy, 'services', 'http-entry.js'),
                `module.exports = {};\n`,
            );
            await fs.outputFile(
                path.join(proyekDummy, 'test', 'products.js'),
                `require('../services/http-entry');\n`,
            );

            const graph = await buildProjectGraph(proyekDummy);
            const relativeFiles = [...graph.liveFiles].map(file =>
                path.relative(proyekDummy, file).replace(/\\/g, '/')
            );

            assert.ok(relativeFiles.includes('services/http-entry.js'));
            assert.ok(relativeFiles.includes('test/products.js'));
            assert.ok(!relativeFiles.includes('missing-index.js'));
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
