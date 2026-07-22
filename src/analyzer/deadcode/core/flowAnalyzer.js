import estraverse from 'estraverse';
import { isReference } from './isReference.js';

/**
 * ═══════════════════════════════════════════════════════════════════
 * CONTROL FLOW GRAPH (CFG) BUILDER
 * ═══════════════════════════════════════════════════════════════════
 * 
 * Membangun representasi Control Flow Graph dari AST function body.
 * CFG terdiri dari BasicBlock (kumpulan statement berurutan)
 * dan Edge (koneksi antar block).
 *
 * Kegunaan:
 *   - Mendeteksi blok yang tidak memiliki predecessor (unreachable)
 *   - Mendeteksi blok yang tidak memiliki successor (dead end tanpa return)
 *   - Analisis flow-aware yang lebih akurat dari simple AST traversal
 * 
 * Representasi:
 *   BasicBlock: { id, statements: [], successors: [], predecessors: [] }
 *   CFG:        { entry, exit, blocks: Map<id, BasicBlock> }
 */

let blockIdCounter = 0;

function createBlock() {
    const id = `B${blockIdCounter++}`;
    return {
        id,
        statements: [],
        successors: [],
        predecessors: [],
        isEntry: false,
        isExit: false
    };
}

/**
 * Membangun CFG dari body sebuah fungsi/program.
 * @param {Array} bodyStatements - Array of statement nodes
 * @returns {{ entry: object, exit: object, blocks: Map, unreachableBlocks: Array }}
 */
export function buildCFG(bodyStatements) {
    blockIdCounter = 0;
    const blocks = new Map();
    const entry = createBlock();
    entry.isEntry = true;
    blocks.set(entry.id, entry);

    const exit = createBlock();
    exit.isExit = true;
    blocks.set(exit.id, exit);

    if (!bodyStatements || bodyStatements.length === 0) {
        addEdge(entry, exit);
        return { entry, exit, blocks, unreachableBlocks: [] };
    }

    let currentBlock = entry;
    const terminators = new Set(['ReturnStatement', 'ThrowStatement', 'BreakStatement', 'ContinueStatement']);

    for (const stmt of bodyStatements) {
        currentBlock.statements.push(stmt);

        if (terminators.has(stmt.type)) {
            // Terminator → connect to exit, start new block for any following code
            if (stmt.type === 'ReturnStatement' || stmt.type === 'ThrowStatement') {
                addEdge(currentBlock, exit);
            }
            // Create a new block for anything after the terminator (it will be unreachable)
            currentBlock = createBlock();
            blocks.set(currentBlock.id, currentBlock);
            continue;
        }

        if (stmt.type === 'IfStatement') {
            const thenBlock = createBlock();
            const elseBlock = createBlock();
            const mergeBlock = createBlock();
            blocks.set(thenBlock.id, thenBlock);
            blocks.set(elseBlock.id, elseBlock);
            blocks.set(mergeBlock.id, mergeBlock);

            addEdge(currentBlock, thenBlock);
            addEdge(currentBlock, elseBlock);

            // Simplified: then and else both merge
            addEdge(thenBlock, mergeBlock);
            addEdge(elseBlock, mergeBlock);

            currentBlock = mergeBlock;
        }
    }

    // Jika current block belum terhubung ke exit, hubungkan
    if (!currentBlock.isExit && currentBlock.successors.length === 0) {
        addEdge(currentBlock, exit);
    }

    // Deteksi unreachable blocks (blocks tanpa predecessor, kecuali entry)
    const unreachableBlocks = [];
    for (const [, block] of blocks) {
        if (!block.isEntry && block.predecessors.length === 0 && block.statements.length > 0) {
            unreachableBlocks.push(block);
        }
    }

    return { entry, exit, blocks, unreachableBlocks };
}

function addEdge(from, to) {
    from.successors.push(to.id);
    to.predecessors.push(from.id);
}


/**
 * ═══════════════════════════════════════════════════════════════════
 * FUNCTION CALL GRAPH BUILDER
 * ═══════════════════════════════════════════════════════════════════
 * 
 * Membangun graf pemanggilan fungsi dalam satu file.
 * Melacak fungsi mana yang memanggil fungsi mana.
 * 
 * Kegunaan:
 *   - Mendeteksi fungsi yang tidak pernah dipanggil (leaf dead)
 *   - Mendeteksi cluster fungsi yang saling memanggil tapi tidak terhubung (orphan cluster)
 *   - Mendeteksi unreachable function chains
 *
 * @param {object} ast - ESTree AST Root
 * @returns {{ functions: Map, callGraph: Map, orphanFunctions: Array }}
 */
export function buildCallGraph(ast) {
    const functions = new Map();  // funcName -> { line, node, isExported: false }
    const callGraph = new Map();  // caller -> Set<callee>
    let currentFunction = '__top__';
    const stack = [];

    estraverse.traverse(ast, {
        fallback: 'iteration',
        enter(node, parent) {
            stack.push(node);
            const grandParent = stack.length >= 3 ? stack[stack.length - 3] : null;

            // Track function declarations
            if (node.type === 'FunctionDeclaration' && node.id) {
                const isExported = parent && (parent.type === 'ExportNamedDeclaration' || parent.type === 'ExportDefaultDeclaration');
                functions.set(node.id.name, {
                    line: node.loc ? node.loc.start.line : 0,
                    node: node,
                    isExported: isExported
                });
                currentFunction = node.id.name;
                if (!callGraph.has(currentFunction)) {
                    callGraph.set(currentFunction, new Set());
                }
            }

            // Track named function expressions / arrow functions
            if ((node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') &&
                parent && parent.type === 'VariableDeclarator' && parent.id && parent.id.type === 'Identifier') {
                const isExported = grandParent && grandParent.type === 'VariableDeclaration' && stack.length >= 4 && stack[stack.length - 4].type === 'ExportNamedDeclaration';
                functions.set(parent.id.name, {
                    line: node.loc ? node.loc.start.line : 0,
                    node: node,
                    isExported: isExported
                });
                currentFunction = parent.id.name;
                if (!callGraph.has(currentFunction)) {
                    callGraph.set(currentFunction, new Set());
                }
            }

            // Track ALL references (pemanggilan, callback, passing, dll)
            if (node.type === 'Identifier' || node.type === 'JSXIdentifier') {
                if (isReference(node, parent, grandParent)) {
                    if (!callGraph.has(currentFunction)) {
                        callGraph.set(currentFunction, new Set());
                    }
                    // Tambahkan edge dari fungsi saat ini ke fungsi/variabel yang direferensikan
                    // Kita catat SEMUA reference, tidak peduli apakah fungsi sudah dideklarasikan (mengatasi Hoisting)
                    callGraph.get(currentFunction).add(node.name);
                }
            }
        },
        leave(node) {
            stack.pop();
            if (node.type === 'FunctionDeclaration' ||
                node.type === 'FunctionExpression' ||
                node.type === 'ArrowFunctionExpression') {
                currentFunction = '__top__';
            }
        }
    });

    // Graph Reachability (DFS)
    const visited = new Set();
    
    function dfs(fnName) {
        if (visited.has(fnName)) return;
        visited.add(fnName);
        const callees = callGraph.get(fnName);
        if (callees) {
            for (const callee of callees) {
                dfs(callee);
            }
        }
    }

    // Start DFS from __top__
    dfs('__top__');

    // Start DFS from all exported functions
    for (const [name, info] of functions) {
        if (info.isExported) {
            dfs(name);
        }
    }

    // Identifikasi Orphan Functions (fungsi yang belum dikunjungi sama sekali)
    const orphanFunctions = [];
    for (const [name, info] of functions) {
        if (!visited.has(name) && name !== '__top__') {
            orphanFunctions.push({ name, line: info.line, node: info.node });
        }
    }

    return { functions, callGraph, orphanFunctions };
}


/**
 * ═══════════════════════════════════════════════════════════════════
 * BASIC PATH-SENSITIVE ANALYSIS
 * ═══════════════════════════════════════════════════════════════════
 * 
 * Melacak state variabel melalui branch yang berbeda.
 * Mendeteksi:
 *   - Variabel yang di-assign di if tapi tidak di else (partial init)
 *   - typeof check diikuti penggunaan → variabel bisa undefined di else
 * 
 * @param {object} ast - ESTree AST Root
 * @returns {Array} Daftar temuan path-sensitive
 */
export function analyzePathSensitive(ast) {
    const findings = [];

    estraverse.traverse(ast, {
        fallback: 'iteration',
        enter(node) {
            // Deteksi: if(typeof x !== 'undefined') → artinya di else x mungkin undefined
            // Jika x diakses di else tanpa guard → risky
            if (node.type === 'IfStatement' && node.test.type === 'BinaryExpression') {
                const test = node.test;

                // typeof x !== 'undefined'
                if (test.left.type === 'UnaryExpression' && test.left.operator === 'typeof' &&
                    test.left.argument.type === 'Identifier' &&
                    test.right.type === 'Literal' && test.right.value === 'undefined' &&
                    (test.operator === '!==' || test.operator === '!=')) {

                    const varName = test.left.argument.name;

                    // Cek apakah varName diakses di else block tanpa guard
                    if (node.alternate) {
                        const usedInElse = containsIdentifier(node.alternate, varName);
                        if (usedInElse) {
                            findings.push({
                                name: `'${varName}' may be undefined in else branch`,
                                type: 'PathWarning',
                                line: node.alternate.loc ? node.alternate.loc.start.line : 0,
                                node: node.alternate
                            });
                        }
                    }
                }
            }
        }
    });

    return findings;
}

/**
 * Mengecek apakah sebuah AST subtree mengandung Identifier tertentu.
 */
function containsIdentifier(node, name) {
    if (!node) return false;
    if (node.type === 'Identifier' && node.name === name) return true;

    for (const key of Object.keys(node)) {
        if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
        const child = node[key];
        if (child && typeof child === 'object') {
            if (Array.isArray(child)) {
                for (const item of child) {
                    if (item && typeof item.type === 'string' && containsIdentifier(item, name)) return true;
                }
            } else if (typeof child.type === 'string') {
                if (containsIdentifier(child, name)) return true;
            }
        }
    }
    return false;
}

/**
 * ═══════════════════════════════════════════════════════════════════
 * DEAD STORE ANALYSIS (STRICT BUT SMART)
 * ═══════════════════════════════════════════════════════════════════
 * 
 * Mendeteksi variabel yang diinisialisasi/diassign namun ditimpa lagi
 * sebelum nilai sebelumnya sempat dibaca (Useless Assignment).
 * Dilengkapi dengan heuristik `isTrivialInit` agar tidak memarahi
 * gaya penulisan inisialisasi default yang lumrah (e.g., let x = null;).
 */
export function analyzeDeadStores(ast, rules = {}) {
    const findings = [];
    if (rules.detectDeadStores === false) return findings;

    function isTrivialInit(node) {
        if (!node) return true;
        if (node.type === 'Literal') {
            const val = node.value;
            if (val === null || val === undefined || val === '' || val === 0 || val === false) return true;
        }
        if (node.type === 'Identifier' && node.name === 'undefined') return true;
        if (node.type === 'ArrayExpression' && node.elements.length === 0) return true;
        if (node.type === 'ObjectExpression' && node.properties.length === 0) return true;
        return false;
    }

    estraverse.traverse(ast, {
        fallback: 'iteration',
        enter(node) {
            if (node.type === 'BlockStatement' || node.type === 'Program') {
                const body = node.body || [];
                const blockWriteMap = new Map(); // varName -> { node: ASTNode, line: number, isTrivial: boolean }

                for (const stmt of body) {
                    // Reset if branching, jump, or throw
                    if (stmt.type === 'IfStatement' || stmt.type === 'ForStatement' || 
                        stmt.type === 'WhileStatement' || stmt.type === 'DoWhileStatement' ||
                        stmt.type === 'SwitchStatement' || stmt.type === 'TryStatement' ||
                        stmt.type === 'ReturnStatement' || stmt.type === 'BreakStatement' ||
                        stmt.type === 'ContinueStatement' || stmt.type === 'ThrowStatement') {
                        blockWriteMap.clear();
                        continue;
                    }

                    // Reset if there is a function call (side-effects safety)
                    if (containsFunctionCall(stmt)) {
                        blockWriteMap.clear();
                        // Jangan continue, biarkan proses assignment saat ini dicatat!
                    }

                    // 1. Process Variable Declarations
                    if (stmt.type === 'VariableDeclaration') {
                        stmt.declarations.forEach(decl => {
                            if (decl.id.type === 'Identifier' && decl.init) {
                                const varName = decl.id.name;
                                blockWriteMap.set(varName, {
                                    node: decl,
                                    line: decl.loc ? decl.loc.start.line : 0,
                                    isTrivial: isTrivialInit(decl.init)
                                });
                            }
                        });
                    }
                    
                    // 2. Process Assignments
                    else if (stmt.type === 'ExpressionStatement' && stmt.expression.type === 'AssignmentExpression') {
                        const assign = stmt.expression;
                        if (assign.left.type === 'Identifier' && assign.operator === '=') {
                            const varName = assign.left.name;
                            
                            // Check if RHS reads the variable itself (e.g. x = x + 1)
                            if (containsIdentifier(assign.right, varName)) {
                                blockWriteMap.delete(varName);
                            } else {
                                // Overwrite happens here!
                                if (blockWriteMap.has(varName)) {
                                    const prevWrite = blockWriteMap.get(varName);
                                    // STRICT BUT SMART: Only warn if the previous write was NOT trivial!
                                    if (!prevWrite.isTrivial) {
                                        findings.push({
                                            name: `'${varName}' is reassigned before its previous value is used. The previous assignment is a Dead Store (Wasted Computation).`,
                                            type: 'DeadStore',
                                            line: prevWrite.line,
                                            node: prevWrite.node
                                        });
                                    }
                                }
                                
                                // Record the new write
                                blockWriteMap.set(varName, {
                                    node: assign,
                                    line: assign.loc ? assign.loc.start.line : 0,
                                    isTrivial: isTrivialInit(assign.right)
                                });
                            }
                        }
                    }

                    // 3. Clear tracked variables if they are read in this statement
                    for (const trackedVar of blockWriteMap.keys()) {
                        let checkNode = stmt;
                        // Skip checking the LHS if it was just assigned
                        if (stmt.type === 'ExpressionStatement' && stmt.expression.type === 'AssignmentExpression' && stmt.expression.left.name === trackedVar) {
                            checkNode = stmt.expression.right;
                        } else if (stmt.type === 'VariableDeclaration') {
                            const decl = stmt.declarations.find(d => d.id.type === 'Identifier' && d.id.name === trackedVar);
                            if (decl) checkNode = decl.init;
                        }

                        if (containsIdentifier(checkNode, trackedVar)) {
                            blockWriteMap.delete(trackedVar); // Variable read, clear the write track
                        }
                    }
                }
            }
        }
    });

    return findings;
}

/**
 * Mengecek apakah sebuah AST subtree mengandung pemanggilan fungsi (Call/New).
 */
function containsFunctionCall(node) {
    if (!node) return false;
    if (node.type === 'CallExpression' || node.type === 'NewExpression') return true;

    for (const key of Object.keys(node)) {
        if (key === 'loc' || key === 'range' || key === 'start' || key === 'end') continue;
        const child = node[key];
        if (child && typeof child === 'object') {
            if (Array.isArray(child)) {
                for (const item of child) {
                    if (item && typeof item.type === 'string' && containsFunctionCall(item)) return true;
                }
            } else if (typeof child.type === 'string') {
                if (containsFunctionCall(child)) return true;
            }
        }
    }
    return false;
}
