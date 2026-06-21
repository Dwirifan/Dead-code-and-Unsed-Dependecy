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
    const unreachableNodes = findUnreachableBranches(ast);
    unreachableNodes.forEach(node => {
        const { confidence, status } = classifyConfidence(node.type);
        node.confidence = confidence;
        node.status = status;
    });
    deadCode.push(...unreachableNodes);

    // 3. Duplicate Conditions
    const duplicateConditions = findDuplicateConditions(ast);
    duplicateConditions.forEach(node => {
        const { confidence, status } = classifyConfidence(node.type);
        node.confidence = confidence;
        node.status = status;
    });
    deadCode.push(...duplicateConditions);

    // 4. Unused Class Methods
    const unusedMethods = findUnusedClassMethods(ast, globalRegistry);
    unusedMethods.forEach(node => {
        const { confidence, status } = classifyConfidence(node.type);
        node.confidence = confidence;
        node.status = status;
    });
    deadCode.push(...unusedMethods);

    // 5. Redundant Code
    const redundantNodes = findRedundantCode(ast);
    redundantNodes.forEach(node => {
        const { confidence, status } = classifyConfidence(node.type);
        node.confidence = confidence;
        node.status = status;
    });
    deadCode.push(...redundantNodes);

    // 6. CFG-Based Unreachable Blocks
    const programBody = ast.body || [];
    const cfg = buildCFG(programBody);
    for (const block of cfg.unreachableBlocks) {
        for (const stmt of block.statements) {
            const { confidence, status } = classifyConfidence('DeadCode');
            deadCode.push({
                name: 'CFG Unreachable Block',
                type: 'DeadCode',
                line: stmt.loc ? stmt.loc.start.line : 0,
                node: stmt,
                confidence,
                status
            });
        }
    }

    // 7. Path-Sensitive Analysis
    const pathFindings = analyzePathSensitive(ast);
    pathFindings.forEach(node => {
        const { confidence, status } = classifyConfidence(node.type);
        node.confidence = confidence;
        node.status = status;
    });
    deadCode.push(...pathFindings);

    // 7.5 Dead Stores (Useless Assignment) Analysis
    const ruleConfig = ruleEngine ? ruleEngine.rules : {};
    const deadStores = analyzeDeadStores(ast, ruleConfig);
    deadStores.forEach(node => {
        const { confidence, status } = classifyConfidence(node.type);
        node.confidence = confidence;
        node.status = status;
    });
    deadCode.push(...deadStores);

    // 8. React Bad Smells
    const reactExtensions = new Set(['.jsx', '.tsx']);
    const fileExt = fileName ? '.' + fileName.split('.').pop().toLowerCase() : '';
    if (reactExtensions.has(fileExt)) {
        const reactFindings = analyzeReactSmells(ast);
        reactFindings.forEach(node => {
            node.confidence = 'medium';
            node.status = 'review';
        });
        deadCode.push(...reactFindings);
    }

    // 9. Internal Orphan Functions (Unused Local Functions)
    const { orphanFunctions } = buildCallGraph(ast);
    orphanFunctions.forEach(info => {
        const { confidence, status } = classifyConfidence('Unused Function');
        deadCode.push({
            name: `Orphan Function '${info.name}'`,
            type: 'UnusedFunction',
            line: info.line,
            node: info.node,
            confidence: confidence,
            status: status
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

    return finalReport;
}
