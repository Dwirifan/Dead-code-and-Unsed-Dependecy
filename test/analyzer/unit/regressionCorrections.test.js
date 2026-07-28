import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

import { findDeadCode } from '../../../src/analyzer/deadcode/index.js';
import { findUnusedDependencies } from '../../../src/analyzer/dependency/dependencyAnalyzer.js';
import { findCircularDependencies } from '../../../src/analyzer/graph/projectGraph.js';
import { parseCode } from '../../../src/parser/astParser.js';

async function analyze(code) {
    const ast = await parseCode(code, 'fixture.ts');
    return findDeadCode(ast, 'fixture.ts');
}

describe('Regression corrections for report accuracy', () => {
    let projectRoot;

    beforeEach(async () => {
        projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'deadkiller-regression-'));
    });

    afterEach(async () => {
        await fs.remove(projectRoot);
    });

    it('deduplicates scope and call-graph findings for one orphan function', async () => {
        const results = await analyze(
            'function isValidFlagSyntax(flag) { return Boolean(flag); }',
        );
        const matches = results.filter(result =>
            (result.name || '').includes('isValidFlagSyntax')
        );

        expect(matches).toHaveLength(1);
    });

    it('merges a contradictory condition and its body into one root issue', async () => {
        const results = await analyze(`
            function match(name) {
                if (name === '' && name.length > 0) {
                    console.warn('unreachable');
                }
            }
        `);
        const contradictions = results.filter(result =>
            (result.name || '').includes('Contradictory')
        );

        expect(contradictions).toHaveLength(1);
        expect(contradictions[0].relatedLocations).toHaveLength(2);
    });

    it('groups consecutive statements after return into one unreachable region', async () => {
        const results = await analyze(`
            function longest(values) {
                return values[0];
                const fallback = '';
                console.log(fallback);
            }
        `);
        const unreachable = results.filter(result =>
            result.type === 'DeadCode' &&
            (result.name || '').includes('Unreachable')
        );

        expect(unreachable).toHaveLength(1);
        expect(unreachable[0].statements).toHaveLength(2);
    });

    it('does not treat pnpm shorthand for a declared script as a binary', async () => {
        await fs.writeJson(path.join(projectRoot, 'package.json'), {
            scripts: {
                build: 'echo build',
                prepublishOnly: 'pnpm build',
            },
        });

        const report = await findUnusedDependencies(projectRoot, new Set());

        expect(report.missingBinaries).not.toContain('build');
    });

    it('reports undeclared husky config as review evidence instead of missing usage', async () => {
        await fs.writeJson(path.join(projectRoot, 'package.json'), {
            husky: {
                hooks: {
                    'pre-commit': 'npm test',
                },
            },
        });

        const report = await findUnusedDependencies(projectRoot, new Set());

        expect(report.missing).not.toContain('husky');
        expect(report.diagnostics).toEqual(expect.arrayContaining([
            expect.objectContaining({
                code: 'UNDECLARED_CONFIG_TOOL',
                package: 'husky',
            }),
        ]));
    });

    it('distinguishes runtime cycles from cycles broken by a type-only edge', () => {
        const runtimeCycle = findCircularDependencies([
            { from: 'a.js', to: 'b.js', isTypeOnly: false },
            { from: 'b.js', to: 'a.js', isTypeOnly: false },
        ])[0];
        const typeBrokenCycle = findCircularDependencies([
            { from: 'a.ts', to: 'b.ts', isTypeOnly: false },
            { from: 'b.ts', to: 'a.ts', isTypeOnly: true },
        ])[0];

        expect(runtimeCycle.isRuntimeCycle).toBe(true);
        expect(typeBrokenCycle.hasTypeOnlyEdge).toBe(true);
        expect(typeBrokenCycle.isRuntimeCycle).toBe(false);
    });
});
