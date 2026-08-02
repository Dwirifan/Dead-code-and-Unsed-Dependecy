import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
    EvaluationValidationError,
    calculateMetrics,
    extractPredictedFindings,
    findingKey,
    normalizeManifest,
    resolveCommandExecutable,
} from './evaluation-core.mjs';

function validManifest() {
    return {
        schemaVersion: 1,
        name: 'fixture evaluation',
        repoRoot: '../../worktrees/project-z',
        commit: '0123456789abcdef0123456789abcdef01234567',
        groundTruth: {
            findings: [
                { file: 'src\\unused.js', type: 'Function', name: 'unusedFunction' },
            ],
        },
        arms: {
            G: { repoRoot: '../../worktrees/project-g' },
            T: { repoRoot: '../../worktrees/project-t' },
        },
    };
}

test('normalizeManifest menghasilkan tiga arm dan path finding portabel', () => {
    const manifest = normalizeManifest(validManifest());

    assert.equal(manifest.arms.Z.repoRoot, null);
    assert.equal(manifest.arms.G.repoRoot, '../../worktrees/project-g');
    assert.equal(manifest.groundTruth.findings[0].file, 'src/unused.js');
    assert.equal(manifest.scanTimeoutMs, 300_000);
});

test('resolveCommandExecutable memakai shim package manager hanya pada Windows', () => {
    assert.equal(resolveCommandExecutable('npm', 'win32'), 'npm.cmd');
    assert.equal(resolveCommandExecutable('NPX', 'win32'), 'npx.cmd');
    assert.equal(resolveCommandExecutable('pnpm', 'linux'), 'pnpm');
    assert.equal(resolveCommandExecutable('git', 'win32'), 'git');
    assert.equal(resolveCommandExecutable('npm.cmd', 'win32'), 'npm.cmd');
});

test('normalizeManifest menolak finding ground truth duplikat', () => {
    const manifest = validManifest();
    manifest.groundTruth.findings.push({
        file: 'src/unused.js',
        type: 'Function',
        name: 'unusedFunction',
    });

    assert.throws(
        () => normalizeManifest(manifest),
        error => error instanceof EvaluationValidationError && /duplikat/.test(error.message),
    );
});

test('extractPredictedFindings memetakan code, dead file, dan dependency', () => {
    const findings = extractPredictedFindings({
        schemaVersion: 1,
        mode: 'directory',
        deadCode: [
            { file: 'src/a.js', type: 'Variable', name: 'unused' },
        ],
        deadFiles: ['src/old.js'],
        unusedDependencies: ['left-pad'],
        deadDevDependencies: ['old-test-runner'],
    });

    assert.deepEqual(findings.map(findingKey), [
        ['package.json', 'DeadDevDependency', 'old-test-runner'],
        ['package.json', 'UnusedDependency', 'left-pad'],
        ['src/a.js', 'Variable', 'unused'],
        ['src/old.js', 'DeadFile', '*'],
    ].map(value => JSON.stringify(value)));
});

test('extractPredictedFindings menolak schema raw report yang berbeda', () => {
    assert.throws(
        () => extractPredictedFindings({ schemaVersion: 2, mode: 'directory', deadCode: [] }),
        error => error instanceof EvaluationValidationError && /schemaVersion/.test(error.message),
    );
});

test('calculateMetrics menghitung TP, FP, FN, precision, recall, dan F1', () => {
    const truth = [
        { file: 'src/a.js', type: 'Variable', name: 'a' },
        { file: 'src/b.js', type: 'Function', name: 'b' },
    ];
    const predicted = [
        { file: 'src/a.js', type: 'Variable', name: 'a' },
        { file: 'src/c.js', type: 'Function', name: 'c' },
    ];

    const metrics = calculateMetrics(truth, predicted);

    assert.deepEqual(
        {
            tp: metrics.tp,
            fp: metrics.fp,
            fn: metrics.fn,
            precision: metrics.precision,
            recall: metrics.recall,
            f1: metrics.f1,
        },
        { tp: 1, fp: 1, fn: 1, precision: 0.5, recall: 0.5, f1: 0.5 },
    );
    assert.deepEqual(metrics.falseNegatives, [truth[1]]);
});

test('calculateMetrics mendefinisikan metrik tanpa denominator sebagai null', () => {
    const metrics = calculateMetrics([], []);
    assert.deepEqual(
        { precision: metrics.precision, recall: metrics.recall, f1: metrics.f1 },
        { precision: null, recall: null, f1: null },
    );
});

test('calculateMetrics hanya membuat metrik dengan denominator nol menjadi null', () => {
    const truthOnly = calculateMetrics([
        { file: 'src/a.js', type: 'Variable', name: 'a' },
    ], []);
    const predictionOnly = calculateMetrics([], [
        { file: 'src/b.js', type: 'Variable', name: 'b' },
    ]);

    assert.deepEqual(
        { precision: truthOnly.precision, recall: truthOnly.recall, f1: truthOnly.f1 },
        { precision: null, recall: 0, f1: 0 },
    );
    assert.deepEqual(
        { precision: predictionOnly.precision, recall: predictionOnly.recall, f1: predictionOnly.f1 },
        { precision: 0, recall: null, f1: 0 },
    );
});
