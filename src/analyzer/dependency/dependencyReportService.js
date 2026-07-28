import path from 'path';
import { findUnusedDependencies } from './dependencyAnalyzer.js';

const UNSUPPORTED_COMPONENT_EXTENSIONS = new Set(['.vue', '.svelte', '.astro']);

function findingName(value) {
    if (typeof value === 'string') return value;
    return value?.dependency || value?.name || null;
}

function uniqueNames(values = []) {
    return [...new Set(values.map(findingName).filter(Boolean))].sort();
}

/**
 * Membentuk context kelengkapan graph yang digunakan bersama oleh scan, fix,
 * show-deps, dan dashboard. Satu sumber keputusan mencegah hasil antar-command
 * berbeda untuk proyek yang sama.
 */
export function getDependencySafetyContext(graph) {
    // `unsafeFiles` juga memuat computed property yang relevan bagi dead-code
    // elimination tetapi tidak menyembunyikan import package. Untuk dependency,
    // gunakan set yang lebih spesifik bila graph versi baru menyediakannya.
    const dependencyUnsafeFiles = graph && Object.hasOwn(graph, 'dynamicDependencyFiles')
        ? graph.dynamicDependencyFiles
        : graph?.unsafeFiles;
    const unsafeFiles = [...(dependencyUnsafeFiles || [])];
    const unresolvedImports = [...(graph?.globalRegistry?.unresolvedImports || [])];
    const unsupportedFiles = [...(graph?.liveFiles || [])]
        .filter(file => UNSUPPORTED_COMPONENT_EXTENSIONS.has(path.extname(file).toLowerCase()));
    const reasons = [];

    if (unsafeFiles.length > 0) {
        reasons.push(`${unsafeFiles.length} file menggunakan pola dinamis`);
    }
    if (unsupportedFiles.length > 0) {
        reasons.push(`${unsupportedFiles.length} file framework belum dapat diparse`);
    }
    if (unresolvedImports.length > 0) {
        reasons.push(`${unresolvedImports.length} import belum terselesaikan`);
    }

    return { unsafeFiles, unresolvedImports, unsupportedFiles, reasons };
}

/**
 * Menjalankan analyzer dan menerapkan kebijakan fail-conservative. Jika bukti
 * penggunaan tidak lengkap, kandidat "unused" dipindahkan ke "uncertain" dan
 * tidak boleh diteruskan ke dependency cleaner.
 */
export async function analyzeProjectDependencies(projectRoot, graph, ruleEngine = null) {
    const safety = getDependencySafetyContext(graph);
    const report = await findUnusedDependencies(
        projectRoot,
        new Set(graph?.usedPackages || []),
        ruleEngine,
        safety
    );

    const diagnostics = [...(report.diagnostics || [])];
    const safetyReasons = [...safety.reasons];
    if (report.configAnalysisComplete === false) {
        safetyReasons.push('satu atau lebih file konfigurasi tidak dapat dianalisis secara statis');
    }
    if (report.workspaceAnalysisComplete === false) {
        safetyReasons.push('manifest workspace belum dianalisis per-package');
    }

    const rawUnused = uniqueNames(report.unused || []);
    const reportedUncertain = uniqueNames([
        ...(report.uncertain || []),
        ...(report.uncertainDependencies || [])
    ]);
    const rawDeadDevDeps = uniqueNames(report.deadDevDeps || []);
    const reportedUncertainDevDeps = uniqueNames(report.uncertainDevDeps || []);
    const analysisComplete = safetyReasons.length === 0;
    const uncertain = analysisComplete
        ? reportedUncertain
        : uniqueNames([...reportedUncertain, ...rawUnused]);
    const unused = analysisComplete ? rawUnused : [];
    const uncertainDevDeps = analysisComplete
        ? reportedUncertainDevDeps
        : uniqueNames([...reportedUncertainDevDeps, ...rawDeadDevDeps]);
    const deadDevDeps = analysisComplete ? rawDeadDevDeps : [];
    const uncertainSet = new Set([...uncertain, ...uncertainDevDeps]);

    const findings = (report.findings || []).map(finding => {
        if (!uncertainSet.has(finding.dependency)) return finding;
        return {
            ...finding,
            status: 'unknown',
            confidence: 'low',
            reason: [
                finding.reason,
                ...safetyReasons
            ].filter(Boolean).join('; ')
        };
    });

    return {
        ...report,
        rawUnused,
        rawDeadDevDeps,
        unused,
        deadDevDeps,
        uncertain,
        uncertainDependencies: uncertain,
        uncertainDevDeps,
        findings,
        diagnostics,
        analysisComplete,
        safety: {
            ...safety,
            reasons: safetyReasons
        },
        totalUnused: unused.length,
        totalDeadDev: deadDevDeps.length,
        totalUncertain: uncertain.length,
        totalUncertainDev: uncertainDevDeps.length
    };
}
