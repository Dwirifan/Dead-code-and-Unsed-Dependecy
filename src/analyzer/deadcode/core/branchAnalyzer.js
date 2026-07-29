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
/**
 * Evaluasi nilai statis dari sebuah node AST (literal, array kosong, properti string/array, optional chaining).
 */
function evaluateStaticValue(node, constMap = null) {
    if (!node) return { static: false, value: undefined };

    if (node.type === 'Literal') {
        return { static: true, value: node.value };
    }
    if (node.type === 'Identifier' && node.name === 'undefined') {
        return { static: true, value: undefined };
    }
    if (node.type === 'Identifier' && constMap && constMap.has(node.name)) {
        return { static: true, value: constMap.get(node.name) };
    }
    if (node.type === 'ArrayExpression') {
        const elements = node.elements.map(e => (e && e.type === 'Literal') ? e.value : undefined);
        return { static: true, value: elements };
    }
    if (node.type === 'ObjectExpression') {
        return { static: true, value: {} };
    }
    // Optional Chaining (?. / ??)
    if (node.type === 'ChainExpression') {
        const inner = node.expression;
        if (inner && (inner.type === 'MemberExpression' || inner.type === 'OptionalMemberExpression' || inner.type === 'CallExpression' || inner.type === 'OptionalCallExpression')) {
            const targetObj = inner.object || inner.callee;
            const objVal = evaluateStaticValue(targetObj, constMap);
            if (objVal.static && (objVal.value === null || objVal.value === undefined)) {
                return { static: true, value: undefined };
            }
            if (objVal.static && inner.property && !inner.computed && inner.property.name === 'length' && (typeof objVal.value === 'string' || Array.isArray(objVal.value))) {
                return { static: true, value: objVal.value.length };
            }
        }
    }
    if (node.type === 'LogicalExpression' && node.operator === '??') {
        const leftVal = evaluateStaticValue(node.left, constMap);
        if (leftVal.static) {
            if (leftVal.value !== null && leftVal.value !== undefined) return leftVal;
            return evaluateStaticValue(node.right, constMap);
        }
    }
    // Member Expression: str.length, arr.length, arr[0]
    if (node.type === 'MemberExpression' || node.type === 'OptionalMemberExpression') {
        const objVal = evaluateStaticValue(node.object, constMap);
        if (objVal.static && (objVal.value === null || objVal.value === undefined) && node.optional) {
            return { static: true, value: undefined };
        }
        if (objVal.static && !node.computed && node.property.name === 'length' && (typeof objVal.value === 'string' || Array.isArray(objVal.value))) {
            return { static: true, value: objVal.value.length };
        }
        if (objVal.static && node.computed && node.property.type === 'Literal' && node.property.value === 'length' && (typeof objVal.value === 'string' || Array.isArray(objVal.value))) {
            return { static: true, value: objVal.value.length };
        }
        if (objVal.static && Array.isArray(objVal.value) && node.computed && node.property.type === 'Literal' && typeof node.property.value === 'number') {
            return { static: true, value: objVal.value[node.property.value] };
        }
    }
    // Call Expression: "".trim(), "".charAt(0)
    if (node.type === 'CallExpression' || node.type === 'OptionalCallExpression') {
        if (node.callee && (node.callee.type === 'MemberExpression' || node.callee.type === 'OptionalMemberExpression')) {
            const objVal = evaluateStaticValue(node.callee.object, constMap);
            if (objVal.static && (objVal.value === null || objVal.value === undefined) && (node.optional || node.callee.optional)) {
                return { static: true, value: undefined };
            }
            if (objVal.static && typeof objVal.value === 'string' && !node.callee.computed) {
                if (node.callee.property.name === 'trim') return { static: true, value: objVal.value.trim() };
                if (node.callee.property.name === 'charAt' && node.arguments.length > 0 && node.arguments[0].type === 'Literal') {
                    return { static: true, value: objVal.value.charAt(node.arguments[0].value) };
                }
            }
        }
    }
    // Binary Expression: str.length === 0, arr.length > 0, str === ""
    if (node.type === 'BinaryExpression') {
        const leftVal = evaluateStaticValue(node.left, constMap);
        const rightVal = evaluateStaticValue(node.right, constMap);
        if (leftVal.static && rightVal.static) {
            switch (node.operator) {
                case '===': case '==': return { static: true, value: leftVal.value === rightVal.value };
                case '!==': case '!=': return { static: true, value: leftVal.value !== rightVal.value };
                case '>': return { static: true, value: leftVal.value > rightVal.value };
                case '<': return { static: true, value: leftVal.value < rightVal.value };
                case '>=': return { static: true, value: leftVal.value >= rightVal.value };
                case '<=': return { static: true, value: leftVal.value <= rightVal.value };
            }
        }
    }
    return { static: false, value: undefined };
}

/**
 * Evaluasi apakah sebuah AST expression bersifat statis (always truthy/falsy).
 * Mendukung: Literal, Identifier(undefined), UnaryExpression(!), LogicalExpression(&&, ||, ??),
 * Constant Propagation, String/Collection Length, dan Optional Chaining.
 */
function evaluateStaticBool(node, constMap = null) {
    if (!node) return { falsy: false, truthy: false, static: false };

    // Evaluasi berbasis nilai semantik lintas-tipe (Pilar 1)
    const valResult = evaluateStaticValue(node, constMap);
    if (valResult.static) {
        return { falsy: !valResult.value, truthy: !!valResult.value, static: true };
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

    // LogicalExpression: && dan || dengan literal / symbolic value
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
                    if (decl.init.type === 'Literal') {
                        constMap.set(decl.id.name, decl.init.value);
                    }
                    if (decl.init.type === 'Identifier' && decl.init.name === 'undefined') {
                        constMap.set(decl.id.name, undefined);
                    }
                    if (decl.init.type === 'ArrayExpression') {
                        const elements = decl.init.elements.map(e => (e && e.type === 'Literal') ? e.value : undefined);
                        constMap.set(decl.id.name, elements);
                    }
                    if (decl.init.type === 'ObjectExpression') {
                        constMap.set(decl.id.name, {});
                    }
                }
            }
        }
        if (node.type === 'ExportNamedDeclaration' && node.declaration &&
            node.declaration.type === 'VariableDeclaration' && node.declaration.kind === 'const') {
            for (const decl of node.declaration.declarations) {
                if (decl.id && decl.id.type === 'Identifier' && decl.init) {
                    if (decl.init.type === 'Literal') {
                        constMap.set(decl.id.name, decl.init.value);
                    }
                    if (decl.init.type === 'ArrayExpression') {
                        const elements = decl.init.elements.map(e => (e && e.type === 'Literal') ? e.value : undefined);
                        constMap.set(decl.id.name, elements);
                    }
                }
            }
        }
    }
    return constMap;
}


/**
 * Mengekstrak nomor baris awal dari sebuah blok percabangan (consequent/alternate/loop body).
 * Jika berupa BlockStatement dengan body tidak kosong, kembalikan baris dari statement pertama di dalamnya.
 */
function getBranchStartLine(branch, fallbackNode) {
    if (branch && branch.type === 'BlockStatement' && branch.body && branch.body.length > 0) {
        const firstStmt = branch.body[0];
        if (firstStmt.loc) return firstStmt.loc.start.line;
    }
    if (branch && branch.loc) return branch.loc.start.line;
    if (fallbackNode && fallbackNode.loc) return fallbackNode.loc.start.line;
    return 0;
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
export function findUnreachableBranches(ast, ruleEngine = null, fileName = null) {
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
                        line: getBranchStartLine(node.consequent, node),
                        node: node.consequent
                    });
                } else if (result.static && result.truthy && node.alternate) {
                    unreachableNodes.push({
                        name: 'Unreachable Branch (always true)',
                        type: 'DeadBranch',
                        line: getBranchStartLine(node.alternate, node),
                        node: node.alternate
                    });
                }
            }

            // ═══════════════════════════════════════════════════
            // 2. UNREACHABLE AFTER TERMINATOR (return/throw/break/continue)
            // ═══════════════════════════════════════════════════
            const statementsToScan =
                node.type === 'BlockStatement' ? node.body :
                node.type === 'SwitchCase'     ? node.consequent :
                null;

            if (statementsToScan) {
                let terminatorFound = false;
                let terminatorNode = null;
                const unreachableStatements = [];
                for (const stmt of statementsToScan) {
                    if (terminatorFound) {
                        unreachableStatements.push(stmt);
                    }
                    if (!terminatorFound && alwaysTerminates(stmt)) {
                        terminatorFound = true;
                        terminatorNode = stmt;
                    }
                }
                if (unreachableStatements.length > 0) {
                    const first = unreachableStatements[0];
                    const last = unreachableStatements[unreachableStatements.length - 1];
                    unreachableNodes.push({
                        name: 'Unreachable Code After Terminator',
                        type: 'DeadCode',
                        line: first.loc ? first.loc.start.line : 0,
                        endLine: last.loc ? last.loc.end.line : 0,
                        node: {
                            type: 'DeadCodeRegion',
                            loc: { start: first.loc?.start, end: last.loc?.end },
                            range: [first.range?.[0] ?? first.start, last.range?.[1] ?? last.end]
                        },
                        statements: unreachableStatements,
                        terminator: terminatorNode,
                        rootCauseId: `after-terminator:${terminatorNode?.start ?? terminatorNode?.range?.[0] ?? terminatorNode?.loc?.start.line}`
                    });
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
                        line: getBranchStartLine(node.body, node),
                        node: node
                    });
                }
            }

            if (node.type === 'ForStatement' && node.test) {
                const testResult = evaluateStaticBool(node.test, constMap);
                if (testResult.static && testResult.falsy) {
                    unreachableNodes.push({
                        name: 'Dead Loop (condition always false)',
                        type: 'DeadBranch',
                        line: node.loc ? node.loc.start.line : getBranchStartLine(node.body, node),
                        node
                    });
                }
            }

            // Pilar 1: Dead Loop pada array/koleksi kosong (for of / for in)
            if (node.type === 'ForOfStatement' || node.type === 'ForInStatement') {
                const rightVal = evaluateStaticValue(node.right, constMap);
                if (rightVal.static && (
                    (Array.isArray(rightVal.value) && rightVal.value.length === 0) ||
                    (typeof rightVal.value === 'string' && rightVal.value.length === 0) ||
                    (rightVal.value && typeof rightVal.value === 'object' && Object.keys(rightVal.value).length === 0)
                )) {
                    unreachableNodes.push({
                        name: 'Dead Loop (collection is empty)',
                        type: 'DeadBranch',
                        line: node.loc ? node.loc.start.line : getBranchStartLine(node.body, node),
                        node
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
                    if (!(ruleEngine && ruleEngine.isIgnoredVariable(fnName, fileName))) {
                        unreachableNodes.push({
                            name: `Empty Function '${fnName}'`,
                            type: 'EmptyBlock',
                            line: node.loc ? node.loc.start.line : 0,
                            node: node
                        });
                    }
                }
            }

            // Empty catch block (error silently swallowed)
            if (node.type === 'CatchClause') {
                if (node.body && node.body.type === 'BlockStatement' && node.body.body.length === 0) {
                    const paramName = node.param && node.param.type === 'Identifier' ? node.param.name : null;
                    if (!(paramName && ruleEngine && ruleEngine.isIgnoredVariable(paramName, fileName))) {
                        unreachableNodes.push({
                            name: 'Empty Catch Block (error silently swallowed)',
                            type: 'EmptyBlock',
                            line: node.loc ? node.loc.start.line : 0,
                            node: node
                        });
                    }
                }
            }
        }
    });

    return unreachableNodes;
}

/**
 * Menentukan apakah sebuah statement memutus semua jalur yang keluar darinya.
 * Ini menangani terminator langsung sekaligus terminator majemuk seperti
 * if/else yang kedua cabangnya return/throw.
 */
function alwaysTerminates(statement) {
    if (!statement) return false;

    switch (statement.type) {
        case 'ReturnStatement':
        case 'ThrowStatement':
        case 'BreakStatement':
        case 'ContinueStatement':
            return true;

        case 'BlockStatement':
            return blockAlwaysTerminates(statement.body);

        case 'IfStatement':
            return Boolean(statement.alternate) &&
                alwaysTerminates(statement.consequent) &&
                alwaysTerminates(statement.alternate);

        case 'TryStatement':
            // finally yang terminator selalu mengalahkan hasil try/catch.
            if (statement.finalizer && alwaysTerminates(statement.finalizer)) return true;
            // Tanpa catch, exception dari try masih dapat keluar lewat jalur throw.
            if (!statement.handler) return false;
            return alwaysTerminates(statement.block) &&
                alwaysTerminates(statement.handler.body);

        default:
            return false;
    }
}

function blockAlwaysTerminates(statements) {
    if (!Array.isArray(statements)) return false;
    for (const statement of statements) {
        if (alwaysTerminates(statement)) return true;
    }
    return false;
}
