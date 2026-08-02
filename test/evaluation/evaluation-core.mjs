import path from 'node:path';

export const ARM_IDS = Object.freeze(['Z', 'G', 'T']);

export const SUPPORTED_CONFIG_NAMES = Object.freeze([
    'deadkiller.config.mjs',
    'deadkiller.config.js',
    '.deadkillerrc.json',
]);

const WINDOWS_PACKAGE_MANAGER_SHIMS = new Set(['npm', 'npx', 'pnpm', 'yarn']);

export function resolveCommandExecutable(command, platform = process.platform) {
    if (platform !== 'win32' || typeof command !== 'string') return command;
    const normalized = command.toLowerCase();
    return WINDOWS_PACKAGE_MANAGER_SHIMS.has(normalized) ? `${normalized}.cmd` : command;
}

export class EvaluationValidationError extends Error {
    constructor(message, options = undefined) {
        super(message, options);
        this.name = 'EvaluationValidationError';
        this.code = 'EVALUATION_INVALID_INPUT';
    }
}

function fail(message) {
    throw new EvaluationValidationError(message);
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function requirePlainObject(value, label) {
    if (!isPlainObject(value)) fail(`${label} harus berupa object JSON.`);
    return value;
}

function requireNonEmptyString(value, label) {
    if (typeof value !== 'string' || value.trim().length === 0) {
        fail(`${label} harus berupa string yang tidak kosong.`);
    }
    if (value.includes('\0')) fail(`${label} tidak boleh mengandung null byte.`);
    return value.trim();
}

function normalizeRelativeFile(value, label) {
    const raw = requireNonEmptyString(value, label).replace(/\\/g, '/');
    if (path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw)) {
        fail(`${label} harus relatif terhadap root repo, bukan path absolut.`);
    }
    const normalized = path.posix.normalize(raw.replace(/^\.\//, ''));
    if (normalized === '.' || normalized === '..' || normalized.startsWith('../')) {
        fail(`${label} keluar dari root repo atau tidak menunjuk file.`);
    }
    return normalized;
}

function normalizeRelativeDirectory(value, label) {
    if (value === undefined) return '.';
    const raw = requireNonEmptyString(value, label).replace(/\\/g, '/');
    if (path.posix.isAbsolute(raw) || path.win32.isAbsolute(raw)) {
        fail(`${label} harus relatif terhadap root repo.`);
    }
    const normalized = path.posix.normalize(raw);
    if (normalized === '..' || normalized.startsWith('../')) {
        fail(`${label} keluar dari root repo.`);
    }
    return normalized;
}

function normalizeTimeout(value, label, defaultValue) {
    if (value === undefined) return defaultValue;
    if (!Number.isInteger(value) || value < 1 || value > 3_600_000) {
        fail(`${label} harus berupa bilangan bulat 1..3600000 milidetik.`);
    }
    return value;
}

function normalizeValidationCommand(value, label) {
    const command = requirePlainObject(value, label);
    const executable = requireNonEmptyString(command.command, `${label}.command`);
    const args = command.args === undefined ? [] : command.args;
    if (!Array.isArray(args) || args.some(argument => typeof argument !== 'string' || argument.includes('\0'))) {
        fail(`${label}.args harus berupa array string tanpa null byte.`);
    }

    return {
        command: executable,
        args: [...args],
        cwd: normalizeRelativeDirectory(command.cwd, `${label}.cwd`),
        timeoutMs: normalizeTimeout(command.timeoutMs, `${label}.timeoutMs`, 120_000),
    };
}

function normalizeValidationCommands(value, label) {
    if (value === undefined) return [];
    if (!Array.isArray(value)) fail(`${label} harus berupa array command.`);
    return value.map((command, index) => normalizeValidationCommand(command, `${label}[${index}]`));
}

export function normalizeFinding(value, label = 'finding') {
    const finding = requirePlainObject(value, label);
    return {
        file: normalizeRelativeFile(finding.file, `${label}.file`),
        type: requireNonEmptyString(finding.type, `${label}.type`),
        name: requireNonEmptyString(finding.name, `${label}.name`),
    };
}

export function findingKey(finding) {
    return JSON.stringify([finding.file, finding.type, finding.name]);
}

function compareFindings(left, right) {
    return left.file.localeCompare(right.file) ||
        left.type.localeCompare(right.type) ||
        left.name.localeCompare(right.name);
}

function uniqueFindings(findings, label, { rejectDuplicates = false } = {}) {
    const byKey = new Map();
    for (const finding of findings) {
        const key = findingKey(finding);
        if (rejectDuplicates && byKey.has(key)) {
            fail(`${label} memuat finding duplikat: ${key}.`);
        }
        byKey.set(key, finding);
    }
    return [...byKey.values()].sort(compareFindings);
}

function normalizeArm(value, armId) {
    const arm = requirePlainObject(value, `arms.${armId}`);
    if (armId === 'Z' && arm.repoRoot !== undefined) {
        fail('arms.Z.repoRoot tidak boleh diisi; arm Z selalu memakai repoRoot utama.');
    }
    if (armId !== 'Z') {
        requireNonEmptyString(arm.repoRoot, `arms.${armId}.repoRoot`);
    }
    if (arm.configPath !== undefined && armId === 'Z') {
        fail('arms.Z.configPath tidak diperlukan karena arm Z selalu memakai --no-config.');
    }

    return {
        repoRoot: armId === 'Z' ? null : arm.repoRoot.trim(),
        configPath: arm.configPath === undefined
            ? null
            : requireNonEmptyString(arm.configPath, `arms.${armId}.configPath`),
        validationCommands: normalizeValidationCommands(
            arm.validationCommands,
            `arms.${armId}.validationCommands`,
        ),
    };
}

/**
 * Validasi struktur manifest yang tidak menyentuh filesystem.
 */
export function normalizeManifest(value) {
    const manifest = requirePlainObject(value, 'manifest');
    if (manifest.schemaVersion !== 1) {
        fail('manifest.schemaVersion harus bernilai 1.');
    }

    const commit = requireNonEmptyString(manifest.commit, 'manifest.commit').toLowerCase();
    if (!/^[0-9a-f]{7,64}$/.test(commit)) {
        fail('manifest.commit harus berupa commit hash heksadesimal sepanjang 7..64 karakter.');
    }

    const groundTruth = requirePlainObject(manifest.groundTruth, 'manifest.groundTruth');
    if (!Array.isArray(groundTruth.findings)) {
        fail('manifest.groundTruth.findings harus berupa array.');
    }
    const findings = uniqueFindings(
        groundTruth.findings.map((finding, index) => (
            normalizeFinding(finding, `manifest.groundTruth.findings[${index}]`)
        )),
        'manifest.groundTruth.findings',
        { rejectDuplicates: true },
    );

    const arms = requirePlainObject(manifest.arms, 'manifest.arms');
    for (const armId of ['G', 'T']) {
        if (!Object.hasOwn(arms, armId)) fail(`manifest.arms.${armId} wajib tersedia.`);
    }
    const unknownArms = Object.keys(arms).filter(armId => !ARM_IDS.includes(armId));
    if (unknownArms.length > 0) {
        fail(`Arm tidak dikenal: ${unknownArms.join(', ')}. Gunakan Z, G, dan T.`);
    }

    return {
        schemaVersion: 1,
        name: manifest.name === undefined
            ? null
            : requireNonEmptyString(manifest.name, 'manifest.name'),
        repoRoot: requireNonEmptyString(manifest.repoRoot, 'manifest.repoRoot'),
        commit,
        scanTimeoutMs: normalizeTimeout(manifest.scanTimeoutMs, 'manifest.scanTimeoutMs', 300_000),
        validationCommands: normalizeValidationCommands(
            manifest.validationCommands,
            'manifest.validationCommands',
        ),
        arms: {
            Z: normalizeArm(arms.Z || {}, 'Z'),
            G: normalizeArm(arms.G, 'G'),
            T: normalizeArm(arms.T, 'T'),
        },
        groundTruth: { findings },
    };
}

function requireStringArray(value, label) {
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
        fail(`${label} pada raw report harus berupa array string.`);
    }
    return value;
}

/**
 * Mengubah output scan menjadi finding set yang dapat dibandingkan. Scope:
 * deadCode, deadFiles, unusedDependencies, dan deadDevDependencies.
 */
export function extractPredictedFindings(report) {
    requirePlainObject(report, 'raw report');
    if (report.schemaVersion !== 1) {
        fail(`raw report.schemaVersion harus 1, diterima ${String(report.schemaVersion)}.`);
    }
    if (report.mode !== 'directory') {
        fail(`raw report harus berasal dari scan direktori; mode diterima: ${String(report.mode)}.`);
    }
    if (!Array.isArray(report.deadCode)) {
        fail('raw report.deadCode harus berupa array.');
    }

    const findings = report.deadCode.map((finding, index) => (
        normalizeFinding(finding, `raw report.deadCode[${index}]`)
    ));

    for (const file of requireStringArray(report.deadFiles, 'raw report.deadFiles')) {
        findings.push(normalizeFinding({ file, type: 'DeadFile', name: '*' }, 'raw report.deadFiles item'));
    }
    for (const dependency of requireStringArray(
        report.unusedDependencies,
        'raw report.unusedDependencies',
    )) {
        findings.push({ file: 'package.json', type: 'UnusedDependency', name: dependency });
    }
    for (const dependency of requireStringArray(
        report.deadDevDependencies,
        'raw report.deadDevDependencies',
    )) {
        findings.push({ file: 'package.json', type: 'DeadDevDependency', name: dependency });
    }

    return uniqueFindings(findings, 'raw report findings');
}

function roundedRatio(numerator, denominator) {
    if (denominator === 0) return null;
    return Number((numerator / denominator).toFixed(6));
}

export function calculateMetrics(groundTruthFindings, predictedFindings) {
    const truth = uniqueFindings(
        groundTruthFindings.map((finding, index) => normalizeFinding(finding, `groundTruth[${index}]`)),
        'groundTruth',
        { rejectDuplicates: true },
    );
    const predicted = uniqueFindings(
        predictedFindings.map((finding, index) => normalizeFinding(finding, `predicted[${index}]`)),
        'predicted',
    );
    const truthByKey = new Map(truth.map(finding => [findingKey(finding), finding]));
    const predictedByKey = new Map(predicted.map(finding => [findingKey(finding), finding]));

    const truePositives = predicted.filter(finding => truthByKey.has(findingKey(finding)));
    const falsePositives = predicted.filter(finding => !truthByKey.has(findingKey(finding)));
    const falseNegatives = truth.filter(finding => !predictedByKey.has(findingKey(finding)));
    const tp = truePositives.length;
    const fp = falsePositives.length;
    const fn = falseNegatives.length;
    const precision = roundedRatio(tp, tp + fp);
    const recall = roundedRatio(tp, tp + fn);
    const f1 = roundedRatio(2 * tp, (2 * tp) + fp + fn);

    return {
        groundTruth: truth.length,
        predicted: predicted.length,
        tp,
        fp,
        fn,
        precision,
        recall,
        f1,
        truePositives,
        falsePositives,
        falseNegatives,
    };
}

export function evaluateReport(report, groundTruthFindings) {
    const predictedFindings = extractPredictedFindings(report);
    return {
        predictedFindings,
        metrics: calculateMetrics(groundTruthFindings, predictedFindings),
    };
}
