import estraverse from 'estraverse';

/**
 * Menganalisis pola kode redundan yang tidak memberikan nilai tambah.
 * 
 * Deteksi:
 *   1. Redundant Assignment: x = 1; x = 2; (assign pertama sia-sia)
 *   2. Redundant Return: return undefined di akhir fungsi (otomatis undefined)
 *   3. Self-Assignment: x = x; (assign ke diri sendiri)
 *   4. Redundant typeof: typeof x === 'undefined' && typeof x === 'string'
 *   5. Useless Expression Statement: standalone literal ('use strict' dikecualikan)
 *
 * @param {object} ast - ESTree AST Root Node
 * @returns {Array} Daftar node redundan
 */
export function findRedundantCode(ast) {
    const deadNodes = [];

    estraverse.traverse(ast, {
        fallback: 'iteration',
        enter(node) {
            // ═══════════════════════════════════════════════════
            // 1. REDUNDANT ASSIGNMENT: x = 1; x = 2; tanpa membaca x
            // ═══════════════════════════════════════════════════
            const statementsToScan =
                node.type === 'BlockStatement' ? node.body :
                node.type === 'Program'        ? node.body :
                null;

            if (statementsToScan && statementsToScan.length >= 2) {
                for (let i = 0; i < statementsToScan.length - 1; i++) {
                    const curr = statementsToScan[i];
                    const next = statementsToScan[i + 1];

                    // Cek: curr dan next keduanya assignment ke variabel yang sama
                    const currTarget = getAssignmentTarget(curr);
                    const nextTarget = getAssignmentTarget(next);

                    if (currTarget && nextTarget && currTarget === nextTarget) {
                        // Cek apakah next membaca variabel yang sama di sisi kanan
                        const nextReadsTarget = readsVariable(getAssignmentValue(next), currTarget);
                        
                        if (!nextReadsTarget) {
                            deadNodes.push({
                                name: `Redundant Assignment to '${currTarget}'`,
                                type: 'RedundantCode',
                                line: curr.loc ? curr.loc.start.line : 0,
                                node: curr
                            });
                        }
                    }
                }
            }

            // ═══════════════════════════════════════════════════
            // 2. SELF-ASSIGNMENT: x = x;
            // ═══════════════════════════════════════════════════
            if (node.type === 'ExpressionStatement' &&
                node.expression.type === 'AssignmentExpression' &&
                node.expression.operator === '=') {
                const left = node.expression.left;
                const right = node.expression.right;

                if (left.type === 'Identifier' && right.type === 'Identifier' &&
                    left.name === right.name) {
                    deadNodes.push({
                        name: `Self-Assignment '${left.name} = ${left.name}'`,
                        type: 'RedundantCode',
                        line: node.loc ? node.loc.start.line : 0,
                        node: node
                    });
                }
            }

            // ═══════════════════════════════════════════════════
            // 3. REDUNDANT RETURN: return undefined di akhir fungsi
            // ═══════════════════════════════════════════════════
            if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || 
                node.type === 'ArrowFunctionExpression') {
                const body = node.body;
                if (body && body.type === 'BlockStatement' && body.body.length > 0) {
                    const lastStmt = body.body[body.body.length - 1];
                    if (lastStmt.type === 'ReturnStatement') {
                        // return; → redundant (fungsi sudah otomatis return undefined)
                        if (lastStmt.argument === null || lastStmt.argument === undefined) {
                            deadNodes.push({
                                name: 'Redundant Return (function returns undefined by default)',
                                type: 'RedundantCode',
                                line: lastStmt.loc ? lastStmt.loc.start.line : 0,
                                node: lastStmt
                            });
                        }
                        // return undefined; → redundant
                        else if (lastStmt.argument.type === 'Identifier' && lastStmt.argument.name === 'undefined') {
                            deadNodes.push({
                                name: 'Redundant Return undefined',
                                type: 'RedundantCode',
                                line: lastStmt.loc ? lastStmt.loc.start.line : 0,
                                node: lastStmt
                            });
                        }
                    }
                }
            }

            // ═══════════════════════════════════════════════════
            // 4. USELESS EXPRESSION: standalone literal (kecuali 'use strict')
            // ═══════════════════════════════════════════════════
            if (node.type === 'ExpressionStatement' && node.expression.type === 'Literal') {
                const val = node.expression.value;
                if (val !== 'use strict' && val !== 'use client' && val !== 'use server') {
                    deadNodes.push({
                        name: `Useless Expression '${val}'`,
                        type: 'RedundantCode',
                        line: node.loc ? node.loc.start.line : 0,
                        node: node
                    });
                }
            }
        }
    });

    return deadNodes;
}


/**
 * Mengekstrak nama variabel target dari sebuah assignment statement.
 * Mengembalikan null jika bukan assignment sederhana.
 */
function getAssignmentTarget(stmt) {
    if (stmt && stmt.type === 'ExpressionStatement' &&
        stmt.expression.type === 'AssignmentExpression' &&
        stmt.expression.operator === '=' &&
        stmt.expression.left.type === 'Identifier') {
        return stmt.expression.left.name;
    }
    return null;
}

/**
 * Mengekstrak nilai kanan dari sebuah assignment statement.
 */
function getAssignmentValue(stmt) {
    if (stmt && stmt.type === 'ExpressionStatement' &&
        stmt.expression.type === 'AssignmentExpression') {
        return stmt.expression.right;
    }
    return null;
}

/**
 * Mengecek apakah sebuah expression node mengandung referensi ke variabel tertentu.
 */
function readsVariable(node, varName) {
    if (!node) return false;
    if (node.type === 'Identifier' && node.name === varName) return true;

    // Traverse children
    for (const key of Object.keys(node)) {
        if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
        const child = node[key];
        if (child && typeof child === 'object') {
            if (Array.isArray(child)) {
                for (const item of child) {
                    if (item && typeof item.type === 'string' && readsVariable(item, varName)) return true;
                }
            } else if (typeof child.type === 'string') {
                if (readsVariable(child, varName)) return true;
            }
        }
    }
    return false;
}
