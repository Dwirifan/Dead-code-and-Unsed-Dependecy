import { analyzeAstCode } from './astAnalyzer.js';
import { classifyConfidence } from './core/confidenceClassifier.js';
import { findUnreachableBranches } from './core/branchAnalyzer.js';
import { findDuplicateConditions } from './core/logicAnalyzer.js';
import { findUnusedClassMethods } from './typescript/classAnalyzer.js';
import { findRedundantCode } from './core/redundancyAnalyzer.js';
import { buildCFG, analyzePathSensitive, buildCallGraph, analyzeDeadStores } from './core/flowAnalyzer.js';
import { analyzeReactSmells } from './react/reactAnalyzer.js';

export function findDeadCode(ast, fileName = null, globalRegistry = null, ruleEngine = null) {
    // 1. Eksekusi Analisis AST (Scope, Variables, Imports, Types, Enum)
    const deadCode = analyzeAstCode(ast, fileName, globalRegistry, ruleEngine);

    // 2. Unreachable Branches
    const unreachableNodes = findUnreachableBranches(ast, ruleEngine, fileName);
    unreachableNodes.forEach(node => {
        const { confidence, status, reason } = classifyConfidence(node.type);
        node.confidence = confidence;
        node.status = status;
        node.reason = reason;
    });
    deadCode.push(...unreachableNodes);

    // 3. Duplicate Conditions
    const duplicateConditions = findDuplicateConditions(ast);
    duplicateConditions.forEach(node => {
        const { confidence, status, reason } = classifyConfidence(node.type);
        node.confidence = confidence;
        node.status = status;
        node.reason = reason;
    });
    deadCode.push(...duplicateConditions);

    // 4. Unused Class Methods
    const unusedMethods = findUnusedClassMethods(ast, globalRegistry);
    unusedMethods.forEach(node => {
        const { confidence, status, reason } = classifyConfidence(node.type, node.info);
        node.confidence = confidence;
        node.status = status;
        node.reason = reason;
    });
    deadCode.push(...unusedMethods);

    // 5. Redundant Code
    const redundantNodes = findRedundantCode(ast);
    redundantNodes.forEach(node => {
        const { confidence, status, reason } = classifyConfidence(node.type);
        node.confidence = confidence;
        node.status = status;
        node.reason = reason;
    });
    deadCode.push(...redundantNodes);

    // 6. CFG-Based Unreachable Blocks
    const programBody = ast.body || [];
    const cfg = buildCFG(programBody);
    for (const block of cfg.unreachableBlocks) {
        for (const stmt of block.statements) {
            const { confidence, status, reason } = classifyConfidence('DeadCode');
            deadCode.push({
                name: 'CFG Unreachable Block',
                type: 'DeadCode',
                line: stmt.loc ? stmt.loc.start.line : 0,
                node: stmt,
                confidence,
                status,
                reason
            });
        }
    }

    // 7. Path-Sensitive Analysis
    const pathFindings = analyzePathSensitive(ast);
    pathFindings.forEach(node => {
        const { confidence, status, reason } = classifyConfidence(node.type);
        node.confidence = confidence;
        node.status = status;
        node.reason = reason;
    });
    deadCode.push(...pathFindings);

    // 7.5 Dead Stores (Useless Assignment) Analysis
    const ruleConfig = ruleEngine ? ruleEngine.rules : {};
    const deadStores = analyzeDeadStores(ast, ruleConfig);
    deadStores.forEach(node => {
        const { confidence, status, reason } = classifyConfidence(node.type);
        node.confidence = confidence;
        node.status = status;
        node.reason = reason;
    });
    deadCode.push(...deadStores);

    // 8. React Bad Smells
    const reactExtensions = new Set(['.jsx', '.tsx']);
    const fileExt = fileName ? '.' + fileName.split('.').pop().toLowerCase() : '';
    if (reactExtensions.has(fileExt)) {
        const reactFindings = analyzeReactSmells(ast);
        reactFindings.forEach(node => {
            const { confidence, status, reason } = classifyConfidence(node.type);
            node.confidence = confidence || 'medium';
            node.status = status || 'review';
            node.reason = reason || 'Potensi bau kode (code smell) pada komponen atau hooks React.';
        });
        deadCode.push(...reactFindings);
    }

    // 9. Internal Orphan Functions (Unused Local Functions)
    const { orphanFunctions } = buildCallGraph(ast);
    orphanFunctions.forEach(info => {
        const { confidence, status, reason } = classifyConfidence('Function');
        deadCode.push({
            name: `Orphan Function '${info.name}'`,
            type: 'UnusedFunction',
            line: info.line,
            node: info.node,
            confidence: confidence,
            status: status,
            reason: reason
        });
    });

    // 10. ESCAPE HATCHES (Pragmas & JSDoc)
    const ignoredLines = new Set();
    if (ast.comments) {
        for (const comment of ast.comments) {
            const val = comment.value.trim();
            if (
                val.includes('deadkiller-ignore') ||
                val.includes('deadkiller-disable-next-line') ||
                val.includes('@public')
            ) {
                if (comment.loc) {
                    ignoredLines.add(comment.loc.start.line);
                    ignoredLines.add(comment.loc.end.line + 1);
                }
            }
        }
    }

    // Filter baris yang di-ignore
    const finalReport = deadCode.filter(item => {
        if (!item || !item.line) return true;
        return !ignoredLines.has(item.line);
    });

    // Pilar 4: Pemangkasan Hierarki AST (Parent-Child Pruning)
    // Jika sebuah blok/node (seperti UnusedFunction, DeadBranch, atau DeadCode) mati,
    // hapus semua temuan anomali lain yang berada di dalam rentang lokasi AST node mati tersebut.
    const parentDeadTypes = new Set(['DeadBranch', 'DeadCode', 'UnreachableCode', 'UnusedClass']);
    const parentDeadNodes = finalReport.filter(item => item && item.node && item.node.loc && parentDeadTypes.has(item.type));

    const hierarchicallyPrunedReport = finalReport.filter(item => {
        if (!item || !item.node || !item.node.loc) return true;
        for (const parentItem of parentDeadNodes) {
            if (item === parentItem) continue;
            const pLoc = parentItem.node.loc;
            const cLoc = item.node.loc;
            if (!pLoc || !cLoc || !pLoc.start || !pLoc.end || !cLoc.start || !cLoc.end) continue;

            const startsAfterOrEqual = (cLoc.start.line > pLoc.start.line) || (cLoc.start.line === pLoc.start.line && (cLoc.start.column || 0) >= (pLoc.start.column || 0));
            const endsBeforeOrEqual = (cLoc.end.line < pLoc.end.line) || (cLoc.end.line === pLoc.end.line && (cLoc.end.column || 0) <= (pLoc.end.column || 0));

            if (startsAfterOrEqual && endsBeforeOrEqual) {
                if (cLoc.start.line === pLoc.start.line && cLoc.end.line === pLoc.end.line && cLoc.start.column === pLoc.start.column) {
                    continue;
                }
                return false; // Hapus temuan anak dari laporan (Pruned!)
            }
        }
        return true;
    });

    // Deduplikasi & Pruning Berbasis Lokasi AST (Location-Based Report Deduplication / Pruning)
    const byLine = new Map();
    for (const item of hierarchicallyPrunedReport) {
        if (!item || !item.line) continue;
        if (!byLine.has(item.line)) byLine.set(item.line, []);
        byLine.get(item.line).push(item);
    }

    const prunedReport = [];
    for (const [lineNo, itemsOnLine] of byLine.entries()) {
        const hasContradiction = itemsOnLine.some(it => (it.name || '').includes('Contradictory'));
        const hasBranch = itemsOnLine.some(it => (it.type === 'DeadBranch' && !(it.name || '').includes('Contradictory')) || (it.name || '').includes('Branch') || (it.name || '').includes('Loop'));

        if (hasContradiction && hasBranch) {
            // Logika Pruning: Jika pada koordinat baris AST yang sama terdapat Contradictory Expression dan Unreachable Branch,
            // lebur menjadi satu pesan gabungan.
            const sample = itemsOnLine[0];
            prunedReport.push({
                ...sample,
                name: 'Dead Branch due to Contradictory Condition (always false)',
                type: 'DeadBranch',
                line: lineNo,
                confidence: 'high',
                status: 'safe',
                reason: 'Percabangan tidak akan pernah dieksekusi karena kondisi evaluasi selalu bernilai salah (kontradiktif).'
            });
        } else {
            // Deduplikasi reguler pada baris yang sama berdasarkan tipe dan nama elemen
            const seenTypes = new Set();
            for (const item of itemsOnLine) {
                const cleanName = (item.name || '').replace(/^Orphan Function '([^']+)'$/, '$1');
                const dedupeKey = `${item.type}::${cleanName}`;
                if (!seenTypes.has(dedupeKey)) {
                    seenTypes.add(dedupeKey);
                    prunedReport.push(item);
                }
            }
        }
    }

    // Urutkan kembali berdasarkan nomor baris agar pelaporan teratur
    prunedReport.sort((a, b) => (a.line || 0) - (b.line || 0));

    return prunedReport;
}
