import estraverse from 'estraverse';

/**
 * Evaluasi apakah sebuah AST expression bersifat statis (always truthy/falsy).
 * Mendukung: Literal, Identifier(undefined), UnaryExpression(!), LogicalExpression(&&, ||),
 * dan Constant Propagation (variabel const dengan nilai literal).
 * 
 * @param {object} node - AST Expression node
 * @param {Map<string, any>} [constMap] - Peta konstanta yang diketahui nilainya
 * @returns {{ falsy: boolean, truthy: boolean, static: boolean }}
 */
function evaluateStaticBool(node, constMap = null) {
    if (!node) return { falsy: false, truthy: false, static: false };

    // Literal: false, 0, null, "" → falsy; true, 1, "abc" → truthy
    if (node.type === 'Literal') {
        return { falsy: !node.value, truthy: !!node.value, static: true };
    }

    // undefined → always falsy
    if (node.type === 'Identifier' && node.name === 'undefined') {
        return { falsy: true, truthy: false, static: true };
    }

    // ═══ CONSTANT PROPAGATION ═══
    // Jika identifier diketahui sebagai const dengan nilai literal, evaluasi nilainya.
    // Contoh: const FLAG = false; if (FLAG) { dead }
    if (node.type === 'Identifier' && constMap && constMap.has(node.name)) {
        const value = constMap.get(node.name);
        return { falsy: !value, truthy: !!value, static: true };
    }

    // void 0 → always undefined → falsy
    if (node.type === 'UnaryExpression' && node.operator === 'void') {
        return { falsy: true, truthy: false, static: true };
    }

    // Negasi: !true → false, !false → true, !0 → true, !1 → false
    if (node.type === 'UnaryExpression' && node.operator === '!') {
        const inner = evaluateStaticBool(node.argument, constMap);
        if (inner.static) {
            return { falsy: inner.truthy, truthy: inner.falsy, static: true };
        }
    }

    // Double negasi: !!expr
    if (node.type === 'UnaryExpression' && node.operator === '!' &&
        node.argument.type === 'UnaryExpression' && node.argument.operator === '!') {
        const inner = evaluateStaticBool(node.argument.argument, constMap);
        if (inner.static) return inner;
    }

    // LogicalExpression: && dan || dengan literal
    if (node.type === 'LogicalExpression') {
        const left = evaluateStaticBool(node.left, constMap);
        const right = evaluateStaticBool(node.right, constMap);

        if (node.operator === '&&') {
            if (left.static && left.falsy) return { falsy: true, truthy: false, static: true };
            if (right.static && right.falsy) return { falsy: true, truthy: false, static: true };
            if (left.static && left.truthy && right.static && right.truthy) {
                return { falsy: false, truthy: true, static: true };
            }
        }
        if (node.operator === '||') {
            if (left.static && left.truthy) return { falsy: false, truthy: true, static: true };
            if (right.static && right.truthy) return { falsy: false, truthy: true, static: true };
            if (left.static && left.falsy && right.static && right.falsy) {
                return { falsy: true, truthy: false, static: true };
            }
        }
    }

    return { falsy: false, truthy: false, static: false };
}


/**
 * PHASE 0: Mengumpulkan semua deklarasi `const` dengan nilai literal di file-level.
 * Ini memungkinkan Constant Propagation untuk mengevaluasi kondisi seperti:
 *   const DEBUG = false;
 *   if (DEBUG) { ... } // ← dead branch
 * 
 * Hanya mengumpulkan const di top-level scope (bukan di dalam fungsi)
 * karena variabel lokal bisa di-shadow.
 */
function collectConstantMap(ast) {
    const constMap = new Map();

    for (const node of (ast.body || [])) {
        if (node.type === 'VariableDeclaration' && node.kind === 'const') {
            for (const decl of node.declarations) {
                if (decl.id && decl.id.type === 'Identifier' && decl.init) {
                    // Hanya track literal values (string, number, boolean, null)
                    if (decl.init.type === 'Literal') {
                        constMap.set(decl.id.name, decl.init.value);
                    }
                    // Track undefined
                    if (decl.init.type === 'Identifier' && decl.init.name === 'undefined') {
                        constMap.set(decl.id.name, undefined);
                    }
                }
            }
        }
        // ExportNamedDeclaration yang membungkus VariableDeclaration
        if (node.type === 'ExportNamedDeclaration' && node.declaration &&
            node.declaration.type === 'VariableDeclaration' && node.declaration.kind === 'const') {
            for (const decl of node.declaration.declarations) {
                if (decl.id && decl.id.type === 'Identifier' && decl.init) {
                    if (decl.init.type === 'Literal') {
                        constMap.set(decl.id.name, decl.init.value);
                    }
                }
            }
        }
    }
    return constMap;
}


/**
 * Menganalisis dead branch, unreachable code, empty blocks, dan loop patterns.
 * 
 * Cakupan deteksi:
 *   1. Constant folding: if(false), if(0), if(null), if(""), if(undefined), void 0
 *   2. Constant propagation: const FLAG = false; if(FLAG) { dead }
 *   3. Negasi operator: if(!true), if(!0), if(!false), if(!!false)
 *   4. Redundant boolean: if(flag && false), if(true || x)
 *   5. Unreachable setelah terminator: return, throw, break, continue
 *   6. Dead loop body: while(false), for(;false;), while(FLAG) dimana FLAG=false
 *   7. Loop always-break: for(...) { break; } → loop hanya jalan sekali
 *   8. Short-circuit dead: false && doSomething() → right side dead
 *   9. Ternary dead: false ? dead : alive → consequent dead
 *   10. Empty blocks: function(){}, catch(e){}
 * 
 * @param {object} ast - File AST
 * @returns {Array} Array yang berisi dead nodes
 */
export function findUnreachableBranches(ast) {
    const unreachableNodes = [];

    // Phase 0: Kumpulkan constant values untuk propagation
    const constMap = collectConstantMap(ast);
    
    estraverse.traverse(ast, {
        fallback: 'iteration',
        enter: function (node) {

            // ═══════════════════════════════════════════════════
            // 1. IF STATEMENT: Constant Folding + Propagation + Negasi + Boolean Logic
            // ═══════════════════════════════════════════════════
            if (node.type === 'IfStatement') {
                const result = evaluateStaticBool(node.test, constMap);
                if (result.static && result.falsy) {
                    unreachableNodes.push({
                        name: 'Unreachable Branch (always false)',
                        type: 'DeadBranch',
                        line: node.consequent.loc ? node.consequent.loc.start.line : node.loc.start.line,
                        node: node.consequent
                    });
                } else if (result.static && result.truthy && node.alternate) {
                    unreachableNodes.push({
                        name: 'Unreachable Branch (always true)',
                        type: 'DeadBranch',
                        line: node.alternate.loc ? node.alternate.loc.start.line : node.loc.start.line,
                        node: node.alternate
                    });
                }
            }

            // ═══════════════════════════════════════════════════
            // 2. UNREACHABLE AFTER TERMINATOR (return/throw/break/continue)
            // ═══════════════════════════════════════════════════
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

            // ═══════════════════════════════════════════════════
            // 3. DEAD LOOP BODY: while(false), for(;false;), while(FLAG)
            // ═══════════════════════════════════════════════════
            if (node.type === 'WhileStatement') {
                const testResult = evaluateStaticBool(node.test, constMap);
                if (testResult.static && testResult.falsy) {
                    unreachableNodes.push({
                        name: 'Dead Loop (condition always false)',
                        type: 'DeadBranch',
                        line: node.body.loc ? node.body.loc.start.line : node.loc.start.line,
                        node: node.body
                    });
                }
            }

            if (node.type === 'ForStatement' && node.test) {
                const testResult = evaluateStaticBool(node.test, constMap);
                if (testResult.static && testResult.falsy) {
                    unreachableNodes.push({
                        name: 'Dead Loop (condition always false)',
                        type: 'DeadBranch',
                        line: node.body.loc ? node.body.loc.start.line : node.loc.start.line,
                        node: node.body
                    });
                }
            }

            // ═══════════════════════════════════════════════════
            // 4. LOOP ALWAYS-BREAK: for(...){ break; } → loop useless
            // ═══════════════════════════════════════════════════
            if (node.type === 'ForStatement' || node.type === 'WhileStatement' ||
                node.type === 'ForInStatement' || node.type === 'ForOfStatement') {
                const body = node.body;
                let statements = [];
                if (body.type === 'BlockStatement') {
                    statements = body.body;
                } else if (body.type === 'BreakStatement') {
                    statements = [body];
                }
                if (statements.length > 0 && statements[0].type === 'BreakStatement') {
                    unreachableNodes.push({
                        name: 'Useless Loop (immediately breaks)',
                        type: 'DeadCode',
                        line: node.loc ? node.loc.start.line : 0,
                        node: node
                    });
                }
            }

            // ═══════════════════════════════════════════════════
            // 5. SHORT-CIRCUIT DEAD: false && expr() → right side dead
            // ═══════════════════════════════════════════════════
            if (node.type === 'ExpressionStatement' && node.expression.type === 'LogicalExpression') {
                const expr = node.expression;

                if (expr.operator === '&&') {
                    const leftResult = evaluateStaticBool(expr.left, constMap);
                    if (leftResult.static && leftResult.falsy) {
                        unreachableNodes.push({
                            name: 'Dead Short-Circuit (left always false)',
                            type: 'DeadCode',
                            line: expr.right.loc ? expr.right.loc.start.line : node.loc.start.line,
                            node: expr.right
                        });
                    }
                }
                if (expr.operator === '||') {
                    const leftResult = evaluateStaticBool(expr.left, constMap);
                    if (leftResult.static && leftResult.truthy) {
                        unreachableNodes.push({
                            name: 'Dead Short-Circuit (left always true)',
                            type: 'DeadCode',
                            line: expr.right.loc ? expr.right.loc.start.line : node.loc.start.line,
                            node: expr.right
                        });
                    }
                }
            }

            // ═══════════════════════════════════════════════════
            // 6. TERNARY DEAD: false ? DEAD : alive
            // ═══════════════════════════════════════════════════
            if (node.type === 'ConditionalExpression') {
                const testResult = evaluateStaticBool(node.test, constMap);
                if (testResult.static && testResult.falsy) {
                    unreachableNodes.push({
                        name: 'Dead Ternary Consequent (test always false)',
                        type: 'DeadCode',
                        line: node.consequent.loc ? node.consequent.loc.start.line : 0,
                        node: node.consequent
                    });
                } else if (testResult.static && testResult.truthy) {
                    unreachableNodes.push({
                        name: 'Dead Ternary Alternate (test always true)',
                        type: 'DeadCode',
                        line: node.alternate.loc ? node.alternate.loc.start.line : 0,
                        node: node.alternate
                    });
                }
            }

            // ═══════════════════════════════════════════════════
            // 7. EMPTY BLOCKS: function(){}, catch(e){}
            // ═══════════════════════════════════════════════════

            // Empty function body (declaration & expression)
            if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
                const body = node.body;
                if (body && body.type === 'BlockStatement' && body.body.length === 0) {
                    const fnName = (node.id && node.id.name) || '(anonymous)';
                    unreachableNodes.push({
                        name: `Empty Function '${fnName}'`,
                        type: 'EmptyBlock',
                        line: node.loc ? node.loc.start.line : 0,
                        node: node
                    });
                }
            }

            // Empty catch block (error silently swallowed)
            if (node.type === 'CatchClause') {
                if (node.body && node.body.type === 'BlockStatement' && node.body.body.length === 0) {
                    unreachableNodes.push({
                        name: 'Empty Catch Block (error silently swallowed)',
                        type: 'EmptyBlock',
                        line: node.loc ? node.loc.start.line : 0,
                        node: node
                    });
                }
            }
        }
    });

    return unreachableNodes;
}
