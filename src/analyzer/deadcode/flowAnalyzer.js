import estraverse from 'estraverse';

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
    for (const [id, block] of blocks) {
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
    const functions = new Map();  // funcName -> { line, node, called: false }
    const callGraph = new Map();  // caller -> Set<callee>
    let currentFunction = '__top__';

    estraverse.traverse(ast, {
        fallback: 'iteration',
        enter(node, parent) {
            // Track function declarations
            if (node.type === 'FunctionDeclaration' && node.id) {
                functions.set(node.id.name, {
                    line: node.loc ? node.loc.start.line : 0,
                    node: node,
                    called: false
                });
                currentFunction = node.id.name;
                if (!callGraph.has(currentFunction)) {
                    callGraph.set(currentFunction, new Set());
                }
            }

            // Track named function expressions / arrow functions
            if ((node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') &&
                parent && parent.type === 'VariableDeclarator' && parent.id && parent.id.type === 'Identifier') {
                functions.set(parent.id.name, {
                    line: node.loc ? node.loc.start.line : 0,
                    node: node,
                    called: false
                });
                currentFunction = parent.id.name;
                if (!callGraph.has(currentFunction)) {
                    callGraph.set(currentFunction, new Set());
                }
            }

            // Track function calls
            if (node.type === 'CallExpression') {
                let calleeName = null;
                if (node.callee.type === 'Identifier') {
                    calleeName = node.callee.name;
                } else if (node.callee.type === 'MemberExpression' && 
                           node.callee.property.type === 'Identifier') {
                    calleeName = node.callee.property.name;
                }

                if (calleeName) {
                    if (functions.has(calleeName)) {
                        functions.get(calleeName).called = true;
                    }
                    if (!callGraph.has(currentFunction)) {
                        callGraph.set(currentFunction, new Set());
                    }
                    callGraph.get(currentFunction).add(calleeName);
                }
            }
        },
        leave(node) {
            if (node.type === 'FunctionDeclaration' || 
                node.type === 'FunctionExpression' || 
                node.type === 'ArrowFunctionExpression') {
                currentFunction = '__top__';
            }
        }
    });

    // Deteksi orphan functions (tidak dipanggil dari manapun termasuk top-level)
    const orphanFunctions = [];
    for (const [name, info] of functions) {
        if (!info.called && name !== '__top__') {
            // Cek apakah dipanggil dari graph manapun
            let calledFromGraph = false;
            for (const [, callees] of callGraph) {
                if (callees.has(name)) {
                    calledFromGraph = true;
                    break;
                }
            }
            if (!calledFromGraph) {
                orphanFunctions.push({ name, line: info.line, node: info.node });
            }
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
