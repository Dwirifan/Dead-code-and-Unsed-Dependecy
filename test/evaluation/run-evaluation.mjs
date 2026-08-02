#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
    access,
    lstat,
    mkdir,
    readFile,
    readlink,
    realpath,
    stat,
    writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    ARM_IDS,
    EvaluationValidationError,
    SUPPORTED_CONFIG_NAMES,
    evaluateReport,
    normalizeManifest,
    resolveCommandExecutable,
} from './evaluation-core.mjs';

const MAX_BUFFER = 64 * 1024 * 1024;
const DEFAULT_CLI_PATH = fileURLToPath(new URL('../../bin/dce-cli.js', import.meta.url));

function usage() {
    return [
        'Usage:',
        '  node test/evaluation/run-evaluation.mjs <manifest.json> --output <directory> [--cli <dce-cli.js>]',
        '',
        'Output directory harus belum ada dan berada di luar seluruh repo target.',
    ].join('\n');
}

function parseArguments(argv) {
    if (argv.includes('--help') || argv.includes('-h')) return { help: true };
    let manifestPath = null;
    let outputPath = null;
    let cliPath = DEFAULT_CLI_PATH;

    for (let index = 0; index < argv.length; index++) {
        const argument = argv[index];
        if (argument === '--output') {
            if (outputPath !== null || !argv[index + 1]) {
                throw new EvaluationValidationError('--output wajib memiliki tepat satu nilai.');
            }
            outputPath = argv[++index];
        } else if (argument === '--cli') {
            if (cliPath !== DEFAULT_CLI_PATH || !argv[index + 1]) {
                throw new EvaluationValidationError('--cli wajib memiliki tepat satu nilai.');
            }
            cliPath = argv[++index];
        } else if (argument.startsWith('-')) {
            throw new EvaluationValidationError(`Argumen tidak dikenal: ${argument}.`);
        } else if (manifestPath === null) {
            manifestPath = argument;
        } else {
            throw new EvaluationValidationError(`Argumen posisi berlebih: ${argument}.`);
        }
    }

    if (!manifestPath || !outputPath) {
        throw new EvaluationValidationError('Manifest dan --output wajib diberikan.');
    }
    return { help: false, manifestPath, outputPath, cliPath };
}

async function requireFile(filePath, label) {
    let fileStat;
    try {
        fileStat = await stat(filePath);
    } catch (error) {
        throw new EvaluationValidationError(
            `${label} tidak ditemukan: ${filePath} (${error.message}).`,
            { cause: error },
        );
    }
    if (!fileStat.isFile()) throw new EvaluationValidationError(`${label} bukan file: ${filePath}.`);
    return realpath(filePath);
}

async function requireDirectory(directoryPath, label) {
    let directoryStat;
    try {
        directoryStat = await stat(directoryPath);
    } catch (error) {
        throw new EvaluationValidationError(
            `${label} tidak ditemukan: ${directoryPath} (${error.message}).`,
            { cause: error },
        );
    }
    if (!directoryStat.isDirectory()) {
        throw new EvaluationValidationError(`${label} bukan direktori: ${directoryPath}.`);
    }
    return realpath(directoryPath);
}

function portablePath(value) {
    return value.replace(/\\/g, '/');
}

function canonicalPath(value) {
    const resolved = path.resolve(value);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function isWithin(parentPath, candidatePath) {
    const relative = path.relative(canonicalPath(parentPath), canonicalPath(candidatePath));
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}

async function prospectiveRealPath(targetPath) {
    const missingSegments = [];
    let cursor = path.resolve(targetPath);

    while (true) {
        try {
            const existingRoot = await realpath(cursor);
            return path.resolve(existingRoot, ...missingSegments);
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            const parent = path.dirname(cursor);
            if (parent === cursor) throw error;
            missingSegments.unshift(path.basename(cursor));
            cursor = parent;
        }
    }
}

function runProcess(command, args, { cwd, timeoutMs }) {
    const executable = resolveCommandExecutable(command);
    const result = spawnSync(executable, args, {
        cwd,
        encoding: 'utf8',
        shell: false,
        windowsHide: true,
        timeout: timeoutMs,
        maxBuffer: MAX_BUFFER,
        env: {
            ...process.env,
            FORCE_COLOR: '0',
            NO_COLOR: '1',
        },
    });

    if (result.error) {
        const timeoutDetail = result.error.code === 'ETIMEDOUT'
            ? ` setelah ${timeoutMs} ms`
            : '';
        throw new Error(
            `Gagal menjalankan '${executable}'${timeoutDetail}: ${result.error.message}`,
            { cause: result.error },
        );
    }
    return {
        status: result.status,
        signal: result.signal,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
    };
}

function requireSuccessfulProcess(result, description) {
    if (result.status !== 0) {
        throw new Error(
            `${description} gagal dengan exit code ${String(result.status)}.` +
            `${result.stderr ? `\n${result.stderr.trim()}` : ''}`,
        );
    }
}

function runGit(repoRoot, args, description) {
    const result = runProcess('git', ['-C', repoRoot, ...args], {
        cwd: repoRoot,
        timeoutMs: 30_000,
    });
    requireSuccessfulProcess(result, description);
    return result.stdout.trim();
}

function verifyCommit(repoRoot, expectedCommit, armId) {
    const head = runGit(repoRoot, ['rev-parse', 'HEAD'], `Verifikasi commit arm ${armId}`).toLowerCase();
    if (!head.startsWith(expectedCommit)) {
        throw new EvaluationValidationError(
            `Commit arm ${armId} tidak cocok: manifest=${expectedCommit}, HEAD=${head}.`,
        );
    }
    return head;
}

function readGitState(repoRoot) {
    return runGit(
        repoRoot,
        ['status', '--porcelain=v1', '--untracked-files=all'],
        `Snapshot git state ${repoRoot}`,
    );
}

async function sha256(filePath) {
    const content = await readFile(filePath);
    return createHash('sha256').update(content).digest('hex');
}

async function listRootConfigs(armId, armRoot) {
    const existingConfigs = [];
    for (const configName of SUPPORTED_CONFIG_NAMES) {
        const candidate = path.join(armRoot, configName);
        try {
            await access(candidate);
            const realPath = await requireFile(candidate, `Config arm ${armId}`);
            if (
                !isWithin(armRoot, realPath) ||
                canonicalPath(path.dirname(realPath)) !== canonicalPath(armRoot)
            ) {
                throw new EvaluationValidationError(
                    `Config aktif arm ${armId} harus berupa file nyata pada root arm, bukan symlink ke luar.`,
                );
            }
            existingConfigs.push({
                path: candidate,
                realPath,
                relativePath: configName,
                sha256: await sha256(candidate),
            });
        } catch (error) {
            if (error.code !== 'ENOENT' && !(error instanceof EvaluationValidationError && /tidak ditemukan/.test(error.message))) {
                throw error;
            }
        }
    }
    return existingConfigs;
}

async function resolveZeroConfig(armRoot) {
    const existingConfigs = await listRootConfigs('Z', armRoot);
    if (existingConfigs.length > 1) {
        throw new EvaluationValidationError(
            `Arm Z boleh mengecualikan paling banyak satu config root; ditemukan ${existingConfigs.length}.`,
        );
    }
    return existingConfigs[0] || null;
}

async function resolvePreparedConfig(armId, armRoot, configPathValue) {
    const existingConfigs = await listRootConfigs(armId, armRoot);

    if (existingConfigs.length !== 1) {
        throw new EvaluationValidationError(
            `Arm ${armId} harus memiliki tepat satu config aktif di root; ditemukan ${existingConfigs.length}.`,
        );
    }

    const detectedConfig = existingConfigs[0];
    if (configPathValue !== null) {
        const declaredPath = path.isAbsolute(configPathValue)
            ? configPathValue
            : path.resolve(armRoot, configPathValue);
        const declaredConfig = await requireFile(declaredPath, `arms.${armId}.configPath`);
        if (
            !isWithin(armRoot, declaredConfig) ||
            canonicalPath(path.dirname(declaredConfig)) !== canonicalPath(armRoot)
        ) {
            throw new EvaluationValidationError(
                `arms.${armId}.configPath harus menunjuk config pada root arm ${armId}.`,
            );
        }
        if (canonicalPath(declaredConfig) !== canonicalPath(detectedConfig.realPath)) {
            throw new EvaluationValidationError(
                `arms.${armId}.configPath tidak sama dengan config aktif yang dideteksi.`,
            );
        }
    }

    return detectedConfig;
}

function listGitSnapshotPaths(repoRoot, armId) {
    const result = runProcess(
        'git',
        ['-C', repoRoot, 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', '.'],
        { cwd: repoRoot, timeoutMs: 30_000 },
    );
    requireSuccessfulProcess(result, `Daftar file snapshot arm ${armId}`);
    return result.stdout.split('\0').filter(Boolean);
}

function validateSnapshotRelativePath(value, armId) {
    const portable = portablePath(value);
    const normalized = path.posix.normalize(portable);
    if (
        normalized === '.' ||
        normalized === '..' ||
        normalized.startsWith('../') ||
        path.posix.isAbsolute(normalized) ||
        path.win32.isAbsolute(normalized)
    ) {
        throw new EvaluationValidationError(
            `Git mengembalikan path snapshot tidak aman pada arm ${armId}: ${JSON.stringify(value)}.`,
        );
    }
    return normalized;
}

async function snapshotRecord(repoRoot, relativePath, armId) {
    const absolutePath = path.resolve(repoRoot, ...relativePath.split('/'));
    if (!isWithin(repoRoot, absolutePath)) {
        throw new EvaluationValidationError(
            `Path snapshot arm ${armId} keluar dari root: ${relativePath}.`,
        );
    }

    let fileStat;
    try {
        fileStat = await lstat(absolutePath);
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        return {
            file: relativePath,
            type: 'missing',
            mode: null,
            size: 0,
            sha256: createHash('sha256').update('').digest('hex'),
        };
    }

    if (fileStat.isSymbolicLink()) {
        const linkTarget = await readlink(absolutePath);
        return {
            file: relativePath,
            type: 'symlink',
            mode: fileStat.mode & 0o777,
            size: Buffer.byteLength(linkTarget),
            sha256: createHash('sha256').update(linkTarget).digest('hex'),
        };
    }
    if (fileStat.isFile()) {
        return {
            file: relativePath,
            type: 'file',
            mode: fileStat.mode & 0o777,
            size: fileStat.size,
            sha256: await sha256(absolutePath),
        };
    }
    if (fileStat.isDirectory()) {
        const stage = runGit(
            repoRoot,
            ['ls-files', '--stage', '--', relativePath],
            `Metadata gitlink arm ${armId}: ${relativePath}`,
        );
        const gitlink = stage.match(/^160000\s+([0-9a-f]{40,64})\s+/i);
        if (!gitlink) {
            throw new EvaluationValidationError(
                `Entry direktori snapshot bukan gitlink yang didukung pada arm ${armId}: ${relativePath}.`,
            );
        }
        return {
            file: relativePath,
            type: 'gitlink',
            mode: 0,
            size: 0,
            sha256: createHash('sha256').update(gitlink[1].toLowerCase()).digest('hex'),
        };
    }

    return {
        file: relativePath,
        type: `special-${fileStat.mode}`,
        mode: fileStat.mode & 0o777,
        size: fileStat.size,
        sha256: createHash('sha256').update(String(fileStat.mode)).digest('hex'),
    };
}

async function createGitSnapshot(armId, repoRoot, excludedConfig) {
    const excludedConfigPath = excludedConfig?.relativePath || null;
    const listedPaths = listGitSnapshotPaths(repoRoot, armId)
        .map(value => validateSnapshotRelativePath(value, armId));
    if (new Set(listedPaths).size !== listedPaths.length) {
        throw new EvaluationValidationError(`Daftar file Git arm ${armId} memuat path duplikat.`);
    }

    const snapshotPaths = listedPaths
        .filter(relativePath => relativePath !== excludedConfigPath)
        .sort((left, right) => left.localeCompare(right));
    const records = [];
    for (const relativePath of snapshotPaths) {
        records.push(await snapshotRecord(repoRoot, relativePath, armId));
    }

    const aggregateHash = createHash('sha256');
    for (const record of records) {
        aggregateHash.update(`${JSON.stringify(record)}\n`);
    }
    return {
        sha256: aggregateHash.digest('hex'),
        fileCount: records.length,
        excludedConfigPath,
        excludedConfigWasListed: excludedConfigPath === null
            ? false
            : listedPaths.includes(excludedConfigPath),
        records,
    };
}

function describeSnapshotDifference(baseline, candidate) {
    const baselineByFile = new Map(baseline.records.map(record => [record.file, record]));
    const candidateByFile = new Map(candidate.records.map(record => [record.file, record]));
    const files = [...new Set([...baselineByFile.keys(), ...candidateByFile.keys()])]
        .sort((left, right) => left.localeCompare(right));
    for (const file of files) {
        const left = baselineByFile.get(file) || null;
        const right = candidateByFile.get(file) || null;
        if (JSON.stringify(left) !== JSON.stringify(right)) {
            return `${file}: Z=${JSON.stringify(left)}, candidate=${JSON.stringify(right)}`;
        }
    }
    return 'hash agregat berbeda tanpa record pembeda (kemungkinan collision atau urutan tidak stabil)';
}

function assertIdenticalSnapshots(snapshots) {
    const baseline = snapshots.Z;
    for (const armId of ['G', 'T']) {
        const candidate = snapshots[armId];
        if (
            candidate.fileCount !== baseline.fileCount ||
            candidate.sha256 !== baseline.sha256
        ) {
            throw new EvaluationValidationError(
                `Snapshot arm ${armId} berbeda dari Z setelah config root dikecualikan. ` +
                describeSnapshotDifference(baseline, candidate),
            );
        }
    }
}

function resolveCommandDirectory(repoRoot, relativeDirectory, label) {
    const commandDirectory = path.resolve(repoRoot, relativeDirectory);
    if (!isWithin(repoRoot, commandDirectory)) {
        throw new EvaluationValidationError(`${label} keluar dari root arm.`);
    }
    return commandDirectory;
}

async function runValidationCommands(commands, armId, repoRoot, outputRoot) {
    const results = [];
    for (let index = 0; index < commands.length; index++) {
        const command = commands[index];
        const requestedCwd = resolveCommandDirectory(
            repoRoot,
            command.cwd,
            `validation command ${armId}[${index}].cwd`,
        );
        const cwd = await requireDirectory(
            requestedCwd,
            `validation command ${armId}[${index}].cwd`,
        );
        if (!isWithin(repoRoot, cwd)) {
            throw new EvaluationValidationError(
                `validation command ${armId}[${index}].cwd mengikuti symlink ke luar root arm.`,
            );
        }
        const result = runProcess(command.command, command.args, {
            cwd,
            timeoutMs: command.timeoutMs,
        });
        results.push({
            command: command.command,
            args: command.args,
            cwd: portablePath(path.relative(repoRoot, cwd)) || '.',
            timeoutMs: command.timeoutMs,
            ...result,
        });
        if (result.status !== 0) break;
    }

    const outputName = `${armId}.validation.json`;
    await writeFile(
        path.join(outputRoot, outputName),
        `${JSON.stringify({ arm: armId, commands: results }, null, 2)}\n`,
        'utf8',
    );
    const failed = results.find(result => result.status !== 0);
    if (failed) {
        throw new Error(
            `Validation arm ${armId} gagal pada '${failed.command}' dengan exit code ${String(failed.status)}.`,
        );
    }
    return { outputPath: outputName, commandsRun: results.length, passed: true };
}

async function runScan({ armId, repoRoot, cliPath, timeoutMs, outputRoot }) {
    const args = [cliPath, 'scan', repoRoot, '--json'];
    if (armId === 'Z') args.push('--no-config');
    const result = runProcess(process.execPath, args, { cwd: repoRoot, timeoutMs });
    const reportOutputName = `${armId}.raw.json`;
    const stderrOutputName = `${armId}.stderr.txt`;
    await writeFile(path.join(outputRoot, reportOutputName), result.stdout, 'utf8');
    await writeFile(path.join(outputRoot, stderrOutputName), result.stderr, 'utf8');
    requireSuccessfulProcess(result, `Scan arm ${armId}`);

    let report;
    try {
        report = JSON.parse(result.stdout);
    } catch (error) {
        throw new Error(
            `stdout scan arm ${armId} bukan JSON valid: ${error.message}`,
            { cause: error },
        );
    }
    return {
        report,
        reportOutputName,
        stderrOutputName,
        command: [process.execPath, ...args],
    };
}

async function validateArmTreatment(armId, report, repoRoot, expectedConfig) {
    if (report.schemaVersion !== 1) {
        throw new EvaluationValidationError(
            `Raw report arm ${armId} memakai schemaVersion ${String(report.schemaVersion)}; wajib 1.`,
        );
    }
    if (report.mode !== 'directory') {
        throw new EvaluationValidationError(`Raw report arm ${armId} bukan scan direktori.`);
    }
    if (typeof report.projectRoot !== 'string') {
        throw new EvaluationValidationError(`Raw report arm ${armId} tidak memiliki projectRoot valid.`);
    }
    const reportedRoot = await requireDirectory(report.projectRoot, `projectRoot report arm ${armId}`);
    if (canonicalPath(reportedRoot) !== canonicalPath(repoRoot)) {
        throw new EvaluationValidationError(`Raw report arm ${armId} berasal dari root proyek yang berbeda.`);
    }

    const config = report.config;
    if (!config || typeof config !== 'object' || Array.isArray(config)) {
        throw new EvaluationValidationError(`Raw report arm ${armId} tidak memiliki metadata config.`);
    }

    if (armId === 'Z') {
        if (
            config.policy !== 'none' ||
            config.loaded !== false ||
            config.source !== 'auto' ||
            config.path !== null
        ) {
            throw new EvaluationValidationError(
                'Treatment Z tidak nyata: report wajib policy=none, loaded=false, source=auto, path=null.',
            );
        }
        if (expectedConfig !== null) {
            const ignoredPaths = Array.isArray(config.ignoredPaths) ? config.ignoredPaths : [];
            const expectedPath = canonicalPath(expectedConfig.path);
            if (!ignoredPaths.some(value => typeof value === 'string' && canonicalPath(value) === expectedPath)) {
                throw new EvaluationValidationError(
                    'Treatment Z tidak mencatat config root yang seharusnya diabaikan.',
                );
            }
        }
    } else {
        if (config.loaded !== true || config.source !== 'file' || typeof config.path !== 'string') {
            throw new EvaluationValidationError(
                `Treatment ${armId} tidak nyata: report wajib loaded=true, source=file, dan path config.`,
            );
        }
        const reportedConfig = await requireFile(config.path, `config report arm ${armId}`);
        if (canonicalPath(reportedConfig) !== canonicalPath(expectedConfig.realPath)) {
            throw new EvaluationValidationError(
                `Treatment ${armId} memuat config berbeda dari config yang disiapkan manifest.`,
            );
        }
    }

    return {
        policy: config.policy ?? null,
        loaded: config.loaded,
        source: config.source,
        path: config.path,
    };
}

async function assertCliUnchanged(context, phase, cause = undefined) {
    const currentHash = await sha256(context.cliPath);
    if (currentHash !== context.cliSha256) {
        throw new Error(
            `File CLI berubah ${phase}; hasil run tidak reproducible.`,
            { cause },
        );
    }
}

async function prepareContext(argumentsValue) {
    const manifestPath = await requireFile(
        path.resolve(argumentsValue.manifestPath),
        'Manifest',
    );
    let parsedManifest;
    try {
        parsedManifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    } catch (error) {
        throw new EvaluationValidationError(
            `Manifest bukan JSON valid: ${error.message}`,
            { cause: error },
        );
    }
    const manifest = normalizeManifest(parsedManifest);
    const manifestDirectory = path.dirname(manifestPath);
    const cliPath = await requireFile(path.resolve(argumentsValue.cliPath), 'DeadKiller CLI');
    const cliSha256 = await sha256(cliPath);

    const roots = {
        Z: await requireDirectory(path.resolve(manifestDirectory, manifest.repoRoot), 'repoRoot arm Z'),
        G: await requireDirectory(path.resolve(manifestDirectory, manifest.arms.G.repoRoot), 'repoRoot arm G'),
        T: await requireDirectory(path.resolve(manifestDirectory, manifest.arms.T.repoRoot), 'repoRoot arm T'),
    };
    const uniqueRoots = new Set(Object.values(roots).map(canonicalPath));
    if (uniqueRoots.size !== ARM_IDS.length) {
        throw new EvaluationValidationError('Root arm Z, G, dan T harus berupa tiga copy/worktree yang berbeda.');
    }
    for (let leftIndex = 0; leftIndex < ARM_IDS.length; leftIndex++) {
        for (let rightIndex = leftIndex + 1; rightIndex < ARM_IDS.length; rightIndex++) {
            const leftArm = ARM_IDS[leftIndex];
            const rightArm = ARM_IDS[rightIndex];
            if (isWithin(roots[leftArm], roots[rightArm]) || isWithin(roots[rightArm], roots[leftArm])) {
                throw new EvaluationValidationError(
                    `Root arm ${leftArm} dan ${rightArm} tidak boleh saling nested.`,
                );
            }
        }
    }

    const outputRoot = await prospectiveRealPath(path.resolve(argumentsValue.outputPath));
    for (const [armId, repoRoot] of Object.entries(roots)) {
        if (isWithin(repoRoot, outputRoot)) {
            throw new EvaluationValidationError(`Output tidak boleh berada di dalam repo arm ${armId}.`);
        }
    }
    try {
        await access(outputRoot);
        throw new EvaluationValidationError(`Output directory sudah ada: ${outputRoot}.`);
    } catch (error) {
        if (error instanceof EvaluationValidationError) throw error;
        if (error.code !== 'ENOENT') throw error;
    }

    const commits = {};
    for (const armId of ARM_IDS) {
        commits[armId] = verifyCommit(roots[armId], manifest.commit, armId);
    }
    if (new Set(Object.values(commits)).size !== 1) {
        throw new EvaluationValidationError('HEAD arm Z, G, dan T tidak identik.');
    }

    const configs = {
        Z: await resolveZeroConfig(roots.Z),
        G: await resolvePreparedConfig('G', roots.G, manifest.arms.G.configPath),
        T: await resolvePreparedConfig('T', roots.T, manifest.arms.T.configPath),
    };
    const snapshots = {};
    for (const armId of ARM_IDS) {
        snapshots[armId] = await createGitSnapshot(
            armId,
            roots[armId],
            configs[armId],
        );
    }
    assertIdenticalSnapshots(snapshots);
    return {
        manifestPath,
        manifest,
        cliPath,
        cliSha256,
        roots,
        commits,
        configs,
        snapshots,
        outputRoot,
    };
}

async function executeEvaluation(context) {
    await assertCliUnchanged(context, 'sebelum output dibuat');
    await mkdir(path.dirname(context.outputRoot), { recursive: true });
    // Tanpa `recursive` agar race dengan proses lain tidak menimpa run lama.
    await mkdir(context.outputRoot);
    const armSummaries = {};

    for (const armId of ARM_IDS) {
        process.stderr.write(`[evaluation] Menjalankan arm ${armId}...\n`);
        await assertCliUnchanged(context, `sebelum arm ${armId}`);
        const repoRoot = context.roots[armId];
        const beforeState = readGitState(repoRoot);
        let operationError = null;
        try {
            const commands = [
                ...context.manifest.validationCommands,
                ...context.manifest.arms[armId].validationCommands,
            ];
            const validation = await runValidationCommands(
                commands,
                armId,
                repoRoot,
                context.outputRoot,
            );
            const scan = await runScan({
                armId,
                repoRoot,
                cliPath: context.cliPath,
                timeoutMs: context.manifest.scanTimeoutMs,
                outputRoot: context.outputRoot,
            });
            const treatment = await validateArmTreatment(
                armId,
                scan.report,
                repoRoot,
                context.configs[armId],
            );
            const evaluation = evaluateReport(
                scan.report,
                context.manifest.groundTruth.findings,
            );

            armSummaries[armId] = {
                repoRoot,
                commit: context.commits[armId],
                treatment,
                config: {
                    path: context.configs[armId]?.relativePath || null,
                    sha256: context.configs[armId]?.sha256 || null,
                },
                snapshot: {
                    sha256: context.snapshots[armId].sha256,
                    fileCount: context.snapshots[armId].fileCount,
                    excludedConfigPath: context.snapshots[armId].excludedConfigPath,
                    excludedConfigWasListed: context.snapshots[armId].excludedConfigWasListed,
                },
                command: scan.command,
                reportPath: scan.reportOutputName,
                stderrPath: scan.stderrOutputName,
                validation,
                reportSchemaVersion: scan.report.schemaVersion ?? null,
                metrics: evaluation.metrics,
            };
        } catch (error) {
            operationError = error;
        }

        const afterState = readGitState(repoRoot);
        await assertCliUnchanged(context, `setelah arm ${armId}`, operationError || undefined);
        if (afterState !== beforeState) {
            throw new Error(
                `Repo target arm ${armId} berubah selama evaluasi. Harness tidak melakukan rollback; tinjau git status.`,
                { cause: operationError || undefined },
            );
        }
        if (operationError) throw operationError;
    }

    await assertCliUnchanged(context, 'sebelum summary ditulis');

    const summary = {
        schemaVersion: 1,
        evaluationName: context.manifest.name,
        manifestPath: context.manifestPath,
        commit: context.commits.Z,
        cli: {
            path: context.cliPath,
            sha256: context.cliSha256,
        },
        matchingKey: ['file', 'type', 'name'],
        evaluatedPredictionSources: [
            'deadCode',
            'deadFiles',
            'unusedDependencies',
            'deadDevDependencies',
        ],
        groundTruth: {
            count: context.manifest.groundTruth.findings.length,
            findings: context.manifest.groundTruth.findings,
        },
        snapshot: {
            sha256: context.snapshots.Z.sha256,
            fileCount: context.snapshots.Z.fileCount,
            comparison: 'tracked + untracked non-ignored; satu config root per arm dikecualikan',
        },
        arms: armSummaries,
    };
    await writeFile(
        path.join(context.outputRoot, 'summary.json'),
        `${JSON.stringify(summary, null, 2)}\n`,
        'utf8',
    );
    await assertCliUnchanged(context, 'setelah summary ditulis');
    return summary;
}

async function main() {
    try {
        const argumentsValue = parseArguments(process.argv.slice(2));
        if (argumentsValue.help) {
            process.stdout.write(`${usage()}\n`);
            return;
        }
        const context = await prepareContext(argumentsValue);
        const summary = await executeEvaluation(context);
        process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    } catch (error) {
        process.stderr.write(`[evaluation:error] ${error.message}\n`);
        if (process.env.DEBUG && error.stack) process.stderr.write(`${error.stack}\n`);
        process.exitCode = 1;
    }
}

await main();
