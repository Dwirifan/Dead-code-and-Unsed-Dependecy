import estraverse from 'estraverse';

/**
 * Menganalisis dead branch dan unreachable code.
 * @param {object} ast - File AST
 * @returns {Array} Array yang berisi dead nodes
 */
export function findUnreachableBranches(ast) {
    const unreachableNodes = [];
    
    estraverse.traverse(ast, {
        fallback: 'iteration',
        enter: function (node) {
            // Analisis Percabangan Mati 1: Constant Folding (Simulasi if true/false statis statis)
            if (node.type === 'IfStatement' && node.test.type === 'Literal') {
                if (node.test.value === false) {
                    unreachableNodes.push({
                        name: 'Unreachable Branch',
                        type: 'DeadBranch',
                        line: node.consequent.loc ? node.consequent.loc.start.line : node.loc.start.line,
                        node: node.consequent
                    });
                } else if (node.test.value === true && node.alternate) {
                    unreachableNodes.push({
                        name: 'Unreachable Branch',
                        type: 'DeadBranch',
                        line: node.alternate.loc ? node.alternate.loc.start.line : node.loc.start.line,
                        node: node.alternate
                    });
                }
            }

            // Analisis Percabangan Mati 2: Kode Tak Terjangkau setelah terminator (return/throw/break/continue)
            const terminators = new Set([
                'ReturnStatement',
                'ThrowStatement',
                'BreakStatement',
                'ContinueStatement'
            ]);

            const statementsToScan =
                node.type === 'BlockStatement' ? node.body :
                node.type === 'SwitchCase'     ? node.consequent :
                null;

            if (statementsToScan) {
                let terminatorFound = false;
                for (const stmt of statementsToScan) {
                    if (terminatorFound) {
                        unreachableNodes.push({
                            name: 'Unreachable Statement',
                            type: 'DeadCode',
                            line: stmt.loc ? stmt.loc.start.line : 0,
                            node: stmt
                        });
                    }
                    if (terminators.has(stmt.type)) {
                        terminatorFound = true;
                    }
                }
            }
        }
    });

    return unreachableNodes;
}
