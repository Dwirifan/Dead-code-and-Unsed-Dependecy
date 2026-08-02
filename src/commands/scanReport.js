import path from 'node:path';

export const SCAN_SCHEMA_VERSION = 1;

export function toPortablePath(projectRoot, file) {
    if (!file) return file;
    const relative = path.isAbsolute(file) ? path.relative(projectRoot, file) : file;
    return relative.replace(/\\/g, '/');
}

function sortedStrings(values = []) {
    return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function normalizeDeadCode(projectRoot, nodes = []) {
    return nodes
        .map(node => ({
            file: toPortablePath(projectRoot, node.file),
            name: node.name,
            type: node.type,
            line: node.line,
            confidence: node.confidence || 'medium',
            status: node.status || 'review',
            protected: Boolean(node.protected),
            reason: node.reason || '',
        }))
        .sort((left, right) => (
            left.file.localeCompare(right.file) ||
            (left.line || 0) - (right.line || 0) ||
            String(left.type).localeCompare(String(right.type)) ||
            String(left.name).localeCompare(String(right.name))
        ));
}

function normalizeUnresolvedImports(projectRoot, values = []) {
    return values
        .map(item => ({
            file: toPortablePath(projectRoot, item.file),
            importPath: item.importPath,
        }))
        .sort((left, right) => (
            left.file.localeCompare(right.file) ||
            String(left.importPath).localeCompare(String(right.importPath))
        ));
}

function normalizeDuplicateExports(projectRoot, values = []) {
    return values
        .map(item => ({
            name: item.name,
            files: sortedStrings((item.files || []).map(file => toPortablePath(projectRoot, file))),
        }))
        .sort((left, right) => String(left.name).localeCompare(String(right.name)));
}

function normalizeCycles(projectRoot, values = []) {
    return values
        .map(cycle => cycle.map(file => toPortablePath(projectRoot, file)))
        .sort((left, right) => left.join('\0').localeCompare(right.join('\0')));
}

function statusCounts(deadCode) {
    const counts = { safe: 0, review: 0, risky: 0, protected: 0, other: 0 };
    for (const finding of deadCode) {
        if (finding.protected) {
            counts.protected += 1;
        } else if (Object.hasOwn(counts, finding.status) && finding.status !== 'protected') {
            counts[finding.status] += 1;
        } else {
            counts.other += 1;
        }
    }
    return counts;
}

function dependencyData(dependencyReport, dependencyAnalysisError) {
    const report = dependencyReport || {};
    const unusedDependencies = sortedStrings(report.unused || []);
    const uncertainDependencies = sortedStrings(report.uncertain || []);
    const missingDependencies = sortedStrings(report.missing || []);
    const missingBinaries = sortedStrings(report.missingBinaries || []);
    const deadDevDependencies = sortedStrings(report.deadDevDeps || []);
    const uncertainDevDependencies = sortedStrings(report.uncertainDevDeps || []);

    return {
        unusedDependencies,
        uncertainDependencies,
        missingDependencies,
        missingBinaries,
        deadDevDependencies,
        uncertainDevDependencies,
        dependencyAnalysis: {
            complete: Boolean(dependencyReport?.analysisComplete),
            reasons: sortedStrings(dependencyReport?.safety?.reasons || []),
            diagnostics: dependencyReport?.diagnostics || [],
            error: dependencyAnalysisError,
        },
    };
}

export function createDirectoryScanReport({
    projectRoot,
    ruleEngine,
    graph,
    deadFiles,
    deadNodes,
    duplicateExports,
    runtimeCycles,
    typeOnlyCycles,
    dependencyReport,
    dependencyAnalysisError,
    analysisTimeMs,
}) {
    const deadCode = normalizeDeadCode(projectRoot, deadNodes);
    const normalizedDeadFiles = sortedStrings(deadFiles.map(file => toPortablePath(projectRoot, file)));
    const unresolvedImports = normalizeUnresolvedImports(
        projectRoot,
        graph.globalRegistry.unresolvedImports || [],
    );
    const normalizedDuplicateExports = normalizeDuplicateExports(projectRoot, duplicateExports);
    const circularDependencies = normalizeCycles(projectRoot, runtimeCycles);
    const typeOnlyCircularDependencies = normalizeCycles(projectRoot, typeOnlyCycles);
    const unsafeFiles = sortedStrings(
        [...(graph.unsafeFiles || [])].map(file => toPortablePath(projectRoot, file)),
    );
    const dependencies = dependencyData(dependencyReport, dependencyAnalysisError);
    const counts = statusCounts(deadCode);

    const codeFindings = deadCode.length + normalizedDeadFiles.length + unresolvedImports.length +
        normalizedDuplicateExports.length + circularDependencies.length;
    const certainDependencyFindings = dependencies.unusedDependencies.length +
        dependencies.missingDependencies.length + dependencies.missingBinaries.length +
        dependencies.deadDevDependencies.length;
    const uncertainDependencyFindings = dependencies.uncertainDependencies.length +
        dependencies.uncertainDevDependencies.length;
    const dependencyFindings = certainDependencyFindings + uncertainDependencyFindings;
    const totalFindings = codeFindings + dependencyFindings;
    const actionableDependencyFindings = dependencies.unusedDependencies.length +
        dependencies.deadDevDependencies.length;
    const actionableFindings = counts.safe + actionableDependencyFindings;

    return {
        schemaVersion: SCAN_SCHEMA_VERSION,
        mode: 'directory',
        projectRoot,
        config: {
            loaded: ruleEngine.configLoaded,
            path: ruleEngine.configPath,
            source: ruleEngine.configSource,
            profile: ruleEngine.autoProfile,
            diagnostics: ruleEngine.configDiagnostics,
        },
        summary: {
            liveFiles: graph.liveFiles.size,
            totalIssues: totalFindings,
            totalFindings,
            codeFindings,
            astFindings: deadCode.length,
            dependencyFindings,
            certainDependencyFindings,
            uncertainDependencyFindings,
            actionableFindings,
            actionableCodeFindings: counts.safe,
            actionableDependencyFindings,
            removableDependencyFindings: actionableDependencyFindings,
            safeFixCount: actionableFindings,
            safe: counts.safe,
            review: counts.review,
            risky: counts.risky,
            protected: counts.protected,
            other: counts.other,
            deadFiles: normalizedDeadFiles.length,
            unresolvedImports: unresolvedImports.length,
            duplicateExports: normalizedDuplicateExports.length,
            circularDependencies: circularDependencies.length,
            analysisTimeMs,
            analysisTime: `${analysisTimeMs.toFixed(2)} ms`,
        },
        unsafeFiles,
        ...dependencies,
        deadFiles: normalizedDeadFiles,
        unresolvedImports,
        duplicateExports: normalizedDuplicateExports,
        circularDependencies,
        typeOnlyCircularDependencies,
        deadCode,
    };
}

export function createSingleFileScanReport({
    file,
    ruleEngine,
    ignored = false,
    protectedFile = false,
    deadNodes = [],
    analysisTimeMs,
}) {
    const deadCode = deadNodes
        .map(node => ({
            name: node.name,
            type: node.type,
            line: node.line,
            confidence: node.confidence || 'medium',
            status: node.status || 'review',
            protected: Boolean(protectedFile),
            reason: node.reason || '',
        }))
        .sort((left, right) => (
            (left.line || 0) - (right.line || 0) ||
            String(left.type).localeCompare(String(right.type)) ||
            String(left.name).localeCompare(String(right.name))
        ));
    const counts = statusCounts(deadCode);

    return {
        schemaVersion: SCAN_SCHEMA_VERSION,
        mode: 'single-file',
        file,
        ignored,
        protected: Boolean(protectedFile),
        config: {
            loaded: ruleEngine.configLoaded,
            path: ruleEngine.configPath,
            source: ruleEngine.configSource,
            profile: ruleEngine.autoProfile,
            diagnostics: ruleEngine.configDiagnostics,
        },
        summary: {
            totalIssues: deadCode.length,
            totalFindings: deadCode.length,
            codeFindings: deadCode.length,
            astFindings: deadCode.length,
            dependencyFindings: 0,
            certainDependencyFindings: 0,
            uncertainDependencyFindings: 0,
            actionableFindings: counts.safe,
            actionableCodeFindings: counts.safe,
            actionableDependencyFindings: 0,
            safe: counts.safe,
            review: counts.review,
            risky: counts.risky,
            protected: counts.protected,
            other: counts.other,
            deadFiles: 0,
            analysisTimeMs,
            analysisTime: `${analysisTimeMs.toFixed(2)} ms`,
        },
        // Alias lama dipertahankan selama transisi schema v1.
        totalIssues: deadCode.length,
        analysisTime: `${analysisTimeMs.toFixed(2)} ms`,
        deadCode,
    };
}

const FAIL_CATEGORIES = new Set(['safe', 'review', 'risky', 'dependency', 'dead-file', 'any']);

export function parseFailOn(value) {
    if (!value) return [];
    const categories = sortedStrings(String(value).split(',').map(item => item.trim().toLowerCase()));
    const invalid = categories.filter(category => !FAIL_CATEGORIES.has(category));
    if (invalid.length > 0) {
        const error = new Error(
            `Nilai --fail-on tidak valid: ${invalid.join(', ')}. Gunakan safe, review, risky, dependency, dead-file, atau any.`,
        );
        error.code = 'INVALID_FAIL_ON';
        throw error;
    }
    return categories;
}

export function matchingFailCategories(report, categories = []) {
    if (categories.includes('any') && report.summary.totalFindings > 0) return ['any'];
    const matches = [];
    if (categories.includes('safe') && report.summary.actionableCodeFindings > 0) matches.push('safe');
    if (categories.includes('review') && report.summary.review > 0) matches.push('review');
    if (categories.includes('risky') && report.summary.risky > 0) matches.push('risky');
    if (categories.includes('dependency') && report.summary.dependencyFindings > 0) matches.push('dependency');
    if (categories.includes('dead-file') && report.summary.deadFiles > 0) matches.push('dead-file');
    return matches;
}
