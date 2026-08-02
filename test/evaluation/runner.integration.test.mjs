import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
    appendFile,
    cp,
    mkdir,
    mkdtemp,
    readFile,
    rm,
    stat,
    writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'vitest';
import { fileURLToPath } from 'node:url';

const runnerPath = fileURLToPath(new URL('./run-evaluation.mjs', import.meta.url));

function run(command, args, cwd, timeout = 60_000) {
    return spawnSync(command, args, {
        cwd,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout,
        maxBuffer: 16 * 1024 * 1024,
    });
}

function requireSuccess(result, label) {
    assert.equal(
        result.status,
        0,
        `${label} gagal: ${result.error?.message || result.stderr || 'tanpa diagnostic'}`,
    );
}

test('runner menjaga treatment, snapshot, root, dan hash CLI', { timeout: 120_000 }, async context => {
    const gitProbe = run('git', ['--version'], process.cwd());
    if (gitProbe.error?.code === 'EPERM') {
        context.skip('Sandbox melarang subprocess; integration test dijalankan di lingkungan CI/host normal.');
        return;
    }
    requireSuccess(gitProbe, 'git probe');

    const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'deadkiller-evaluation-'));
    try {
        const roots = {
            Z: path.join(temporaryRoot, 'project-z'),
            G: path.join(temporaryRoot, 'project-g'),
            T: path.join(temporaryRoot, 'project-t'),
        };
        await mkdir(path.join(roots.Z, 'src'), { recursive: true });
        await writeFile(
            path.join(roots.Z, 'package.json'),
            `${JSON.stringify({ name: 'evaluation-fixture', main: 'src/index.js' }, null, 2)}\n`,
            'utf8',
        );
        await writeFile(path.join(roots.Z, 'src', 'index.js'), 'console.log("fixture");\n', 'utf8');

        requireSuccess(run('git', ['init', '--quiet'], roots.Z), 'git init');
        requireSuccess(run('git', ['config', 'user.name', 'Evaluation Test'], roots.Z), 'git user.name');
        requireSuccess(run('git', ['config', 'user.email', 'evaluation@example.invalid'], roots.Z), 'git user.email');
        requireSuccess(run('git', ['add', '.'], roots.Z), 'git add');
        requireSuccess(run('git', ['commit', '--quiet', '-m', 'fixture'], roots.Z), 'git commit');
        const commitResult = run('git', ['rev-parse', 'HEAD'], roots.Z);
        requireSuccess(commitResult, 'git rev-parse');
        const commit = commitResult.stdout.trim();

        await cp(roots.Z, roots.G, { recursive: true });
        await cp(roots.Z, roots.T, { recursive: true });
        await writeFile(path.join(roots.Z, 'deadkiller.config.js'), 'module.exports = {};\n');
        await writeFile(path.join(roots.G, 'deadkiller.config.mjs'), 'export default { preserveExports: true };\n');
        await writeFile(path.join(roots.T, '.deadkillerrc.json'), '{"preserveExports":false}\n');

        const fakeCliPath = path.join(temporaryRoot, 'fake-cli.mjs');
        await writeFile(fakeCliPath, `
import fs from 'node:fs';
import path from 'node:path';
const repoRoot = path.resolve(process.argv[3]);
const noConfig = process.argv.includes('--no-config');
const configNames = ['deadkiller.config.mjs', 'deadkiller.config.js', '.deadkillerrc.json'];
const configPath = configNames.map(name => path.join(repoRoot, name)).find(file => fs.existsSync(file)) || null;
const report = {
  schemaVersion: 1,
  mode: 'directory',
  projectRoot: repoRoot,
  config: noConfig
    ? { loaded: false, path: null, source: 'auto', policy: 'none', ignoredPaths: configPath ? [configPath] : [] }
    : { loaded: true, path: configPath, source: 'file', policy: 'auto', ignoredPaths: [] },
  deadCode: [],
  deadFiles: [],
  unusedDependencies: [],
  deadDevDependencies: []
};
process.stdout.write(JSON.stringify(report));
`, 'utf8');

        const manifestPath = path.join(temporaryRoot, 'manifest.json');
        await writeFile(manifestPath, `${JSON.stringify({
            schemaVersion: 1,
            name: 'integration-fixture',
            repoRoot: roots.Z,
            commit,
            groundTruth: { findings: [] },
            arms: {
                G: { repoRoot: roots.G, configPath: 'deadkiller.config.mjs' },
                T: { repoRoot: roots.T, configPath: '.deadkillerrc.json' },
            },
        }, null, 2)}\n`);

        const firstOutput = path.join(temporaryRoot, 'result-valid');
        const firstRun = run(
            process.execPath,
            [runnerPath, manifestPath, '--output', firstOutput, '--cli', fakeCliPath],
            temporaryRoot,
        );
        requireSuccess(firstRun, 'evaluation runner');
        const summary = JSON.parse(await readFile(path.join(firstOutput, 'summary.json'), 'utf8'));
        assert.equal(summary.arms.Z.treatment.policy, 'none');
        assert.equal(summary.arms.Z.config.path, 'deadkiller.config.js');
        assert.equal(summary.arms.G.treatment.loaded, true);
        assert.equal(summary.arms.T.treatment.source, 'file');
        assert.equal(summary.arms.Z.snapshot.sha256, summary.arms.G.snapshot.sha256);
        assert.equal(summary.arms.Z.snapshot.sha256, summary.arms.T.snapshot.sha256);
        assert.equal(summary.arms.Z.metrics.precision, null);
        assert.equal(summary.arms.Z.metrics.recall, null);
        assert.equal(summary.arms.Z.metrics.f1, null);

        const mutatingCliPath = path.join(temporaryRoot, 'mutating-cli.mjs');
        await cp(fakeCliPath, mutatingCliPath);
        await appendFile(mutatingCliPath, `
const { appendFileSync } = await import('node:fs');
const { fileURLToPath } = await import('node:url');
appendFileSync(fileURLToPath(import.meta.url), '\\n// mutated during evaluation');
`);
        const cliMutationOutput = path.join(temporaryRoot, 'result-cli-mutation');
        const cliMutationRun = run(
            process.execPath,
            [runnerPath, manifestPath, '--output', cliMutationOutput, '--cli', mutatingCliPath],
            temporaryRoot,
        );
        assert.equal(cliMutationRun.status, 1);
        assert.match(cliMutationRun.stderr, /File CLI berubah setelah arm Z/);

        const nestedRoot = path.join(roots.Z, 'nested-arm');
        await mkdir(nestedRoot);
        const nestedManifestPath = path.join(temporaryRoot, 'manifest-nested.json');
        const nestedManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
        nestedManifest.arms.G.repoRoot = nestedRoot;
        await writeFile(nestedManifestPath, `${JSON.stringify(nestedManifest, null, 2)}\n`);
        const nestedOutput = path.join(temporaryRoot, 'result-nested');
        const nestedRun = run(
            process.execPath,
            [runnerPath, nestedManifestPath, '--output', nestedOutput, '--cli', fakeCliPath],
            temporaryRoot,
        );
        assert.equal(nestedRun.status, 1);
        assert.match(nestedRun.stderr, /tidak boleh saling nested/);
        await assert.rejects(stat(nestedOutput), /ENOENT/);
        await rm(nestedRoot, { recursive: true, force: true });

        await appendFile(path.join(roots.G, 'src', 'index.js'), '// snapshot berbeda\n');
        const secondOutput = path.join(temporaryRoot, 'result-invalid');
        const secondRun = run(
            process.execPath,
            [runnerPath, manifestPath, '--output', secondOutput, '--cli', fakeCliPath],
            temporaryRoot,
        );
        assert.equal(secondRun.status, 1);
        assert.match(secondRun.stderr, /Snapshot arm G berbeda dari Z/);
        await assert.rejects(stat(secondOutput), /ENOENT/);
    } finally {
        await rm(temporaryRoot, { recursive: true, force: true });
    }
});
