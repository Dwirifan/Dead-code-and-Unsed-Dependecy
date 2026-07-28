import estraverse from 'estraverse';

/**
 * Mengecek apakah dua AST node secara struktural sama (Deep Equality)
 * Mengabaikan metadata posisi (loc, range, start, end).
 */
function isAstEqual(node1, node2) {
    if (node1 === node2) return true;
    if (!node1 || !node2) return false;
    if (typeof node1 !== 'object' || typeof node2 !== 'object') return node1 === node2;
    if (node1.type !== node2.type) return false;

    const ignoredKeys = new Set(['loc', 'range', 'start', 'end', 'parent', 'tokens', 'comments']);
    const keys1 = Object.keys(node1).filter(k => !ignoredKeys.has(k) && !k.startsWith('_'));
    const keys2 = Object.keys(node2).filter(k => !ignoredKeys.has(k) && !k.startsWith('_'));

    if (keys1.length !== keys2.length) return false;

    for (const key of keys1) {
        if (!isAstEqual(node1[key], node2[key])) {
            return false;
        }
    }
    return true;
}

/**
 * Mengecek apakah sebuah node adalah negasi dari node lain.
 * Contoh: `x` dan `!x`, `a === b` dan `a !== b`
 */
function isNegation(nodeA, nodeB) {
    // Pola 1: x && !x  atau  !x && x
    if (nodeA.type === 'UnaryExpression' && nodeA.operator === '!') {
        return isAstEqual(nodeA.argument, nodeB);
    }
    if (nodeB.type === 'UnaryExpression' && nodeB.operator === '!') {
        return isAstEqual(nodeA, nodeB.argument);
    }

    // Pola 2: a === b && a !== b  (atau sebaliknya)
    if (nodeA.type === 'BinaryExpression' && nodeB.type === 'BinaryExpression') {
        const sameOperands = isAstEqual(nodeA.left, nodeB.left) && isAstEqual(nodeA.right, nodeB.right);
        if (sameOperands) {
            const contradictionPairs = {
                '===': '!==', '!==': '===',
                '==': '!=', '!=': '==',
                '<': '>=', '>=': '<',
                '>': '<=', '<=': '>'
            };
            return contradictionPairs[nodeA.operator] === nodeB.operator;
        }
    }

    return false;
}

/**
 * Mengekstrak semua kondisi dari sebuah LogicalExpression chain.
 * Contoh: a && b && c → [a, b, c]
 */
function extractConditions(node, operator) {
    const conditions = [];
    if (node.type === 'LogicalExpression' && node.operator === operator) {
        conditions.push(...extractConditions(node.left, operator));
        conditions.push(...extractConditions(node.right, operator));
    } else {
        conditions.push(node);
    }
    return conditions;
}

/**
 * Mengecek apakah sebuah LogicalExpression mengandung kontradiksi.
 * 
 * Pola yang terdeteksi:
 *   1. x && !x                        → always false
 *   2. x === 'a' && x === 'b'         → always false (same var, different literal)
 *   3. x === val && x !== val          → always false
 *   4. x > 10 && x < 5                → always false (range contradiction, basic)
 *   5. ENV === 'dev' && ENV === 'prod' → always false
 */
function hasContradiction(node) {
    if (node.type !== 'LogicalExpression' || node.operator !== '&&') return false;

    const conditions = extractConditions(node, '&&');
    
    for (let i = 0; i < conditions.length; i++) {
        for (let j = i + 1; j < conditions.length; j++) {
            const a = conditions[i];
            const b = conditions[j];

            // Pola 1: Negasi langsung (x && !x)
            if (isNegation(a, b)) return true;

            // Pola 2: Variable sama, literal berbeda
            // x === 'a' && x === 'b' → kontradiksi
            if (a.type === 'BinaryExpression' && b.type === 'BinaryExpression') {
                const aIsEquality = (a.operator === '===' || a.operator === '==');
                const bIsEquality = (b.operator === '===' || b.operator === '==');

                if (aIsEquality && bIsEquality) {
                    // Cek apakah operand kiri sama dan operand kanan literal yang berbeda
                    if (isAstEqual(a.left, b.left) &&
                        a.right.type === 'Literal' && b.right.type === 'Literal' &&
                        a.right.value !== b.right.value) {
                        return true;
                    }
                    // Cek juga pola terbalik (literal di kiri)
                    if (isAstEqual(a.right, b.right) &&
                        a.left.type === 'Literal' && b.left.type === 'Literal' &&
                        a.left.value !== b.left.value) {
                        return true;
                    }
                }

                // Pola 3: Range contradiction
                // x > 10 && x < 5 → kontradiksi
                if (isAstEqual(a.left, b.left) &&
                    a.right.type === 'Literal' && b.right.type === 'Literal' &&
                    typeof a.right.value === 'number' && typeof b.right.value === 'number') {
                    // x > A && x < B dimana A >= B → kontradiksi
                    if (a.operator === '>' && b.operator === '<' && a.right.value >= b.right.value) return true;
                    if (a.operator === '>=' && b.operator === '<=' && a.right.value > b.right.value) return true;
                    if (a.operator === '>=' && b.operator === '<' && a.right.value >= b.right.value) return true;
                    if (a.operator === '>' && b.operator === '<=' && a.right.value >= b.right.value) return true;
                    // Reverse: x < A && x > B dimana B >= A
                    if (a.operator === '<' && b.operator === '>' && b.right.value >= a.right.value) return true;
                    if (a.operator === '<=' && b.operator === '>=' && b.right.value > a.right.value) return true;
                    if (a.operator === '<' && b.operator === '>=' && b.right.value >= a.right.value) return true;
                    if (a.operator === '<=' && b.operator === '>' && b.right.value >= a.right.value) return true;
                }
            }

            // Pola 4: String & Collection Length Contradiction (Pilar 1)
            // str === '' && str.length > 0 → kontradiksi
            if (isCollectionLengthContradiction(a, b) || isCollectionLengthContradiction(b, a)) {
                return true;
            }
        }
    }

    return false;
}

/**
 * Deteksi kontradiksi koleksi/string (Pola 4)
 * Contoh: str === '' dengan str.length > 0 atau arr.length === 0 dengan arr[0]
 */
function isCollectionLengthContradiction(emptyNode, nonEmptyNode) {
    const emptyTarget = getEmptyCollectionTarget(emptyNode);
    if (!emptyTarget) return false;
    const nonEmptyTarget = getNonEmptyCollectionTarget(nonEmptyNode);
    return nonEmptyTarget && emptyTarget === nonEmptyTarget;
}

function getTargetKey(node) {
    if (!node) return null;
    if (node.type === 'Identifier') return node.name;
    if (node.type === 'MemberExpression' && !node.computed) {
        const objKey = getTargetKey(node.object);
        if (objKey && (node.property.type === 'Identifier' || node.property.type === 'PrivateIdentifier')) {
            return `${objKey}.${node.property.name}`;
        }
    }
    if (node.type === 'ThisExpression') return 'this';
    return null;
}

function getEmptyCollectionTarget(node) {
    if (node.type !== 'BinaryExpression') return null;
    const isEq = node.operator === '===' || node.operator === '==';
    const isLt = node.operator === '<' || node.operator === '<=';

    // x === '' atau this.name === ''
    if (isEq && node.right.type === 'Literal' && node.right.value === '') {
        const key = getTargetKey(node.left);
        if (key) return key;
    }
    if (isEq && node.left.type === 'Literal' && node.left.value === '') {
        const key = getTargetKey(node.right);
        if (key) return key;
    }
    // x.length === 0 atau x.length < 1
    if (node.left.type === 'MemberExpression' && !node.left.computed && node.left.property.name === 'length') {
        const objKey = getTargetKey(node.left.object);
        if (objKey) {
            if (isEq && node.right.type === 'Literal' && node.right.value === 0) return objKey;
            if (isLt && node.right.type === 'Literal' && (node.right.value === 1 || (node.operator === '<=' && node.right.value === 0))) return objKey;
        }
    }
    return null;
}

function getNonEmptyCollectionTarget(node) {
    if (node.type === 'MemberExpression' && node.computed) {
        return getTargetKey(node.object); // akses elemen misal arr[0]
    }
    if (node.type === 'CallExpression' && node.callee.type === 'MemberExpression' && !node.callee.computed) {
        if (['trim', 'charAt'].includes(node.callee.property.name)) {
            return getTargetKey(node.callee.object);
        }
    }
    if (node.type !== 'BinaryExpression') return null;
    const isNeq = node.operator === '!==' || node.operator === '!=';
    const isGt = node.operator === '>' || node.operator === '>=';

    // x !== '' atau this.name !== ''
    if (isNeq && node.right.type === 'Literal' && node.right.value === '') {
        const key = getTargetKey(node.left);
        if (key) return key;
    }
    if (isNeq && node.left.type === 'Literal' && node.left.value === '') {
        const key = getTargetKey(node.right);
        if (key) return key;
    }
    // x.length > 0 atau x.length >= 1
    if (node.left.type === 'MemberExpression' && !node.left.computed && node.left.property.name === 'length') {
        const objKey = getTargetKey(node.left.object);
        if (objKey) {
            if (isGt && node.right.type === 'Literal' && (node.right.value === 0 || (node.operator === '>=' && node.right.value === 1))) return objKey;
        }
    }
    return null;
}


/**
 * Mengekstrak nomor baris awal dari sebuah blok percabangan (consequent/alternate).
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
 * Menganalisis kondisi logika duplikat dan kontradiksi yang menyebabkan Unreachable Code / Branch.
 * 
 * Deteksi:
 *   1. Duplicate If Condition: if(a){} else if(a){} → blok kedua dead
 *   2. Duplicate Switch Case: case 'a': ... case 'a': → case kedua dead
 *   3. Condition Contradiction: if(x && !x) → always false → body dead
 *   4. Variable Equality Contradiction: if(x === 'a' && x === 'b') → dead
 *   5. Range Contradiction: if(x > 10 && x < 5) → dead
 * 
 * @param {object} ast - ESTree AST Root Node
 * @returns {Array} Daftar node yang merupakan kondisi duplikat/kontradiksi
 */
export function findDuplicateConditions(ast) {
    const deadNodes = [];
    const visitedIfs = new Set();

    estraverse.traverse(ast, {
        fallback: 'iteration',
        enter(node, parent) {
            // ═══════════════════════════════════════════════════
            // 1. Duplicate If Conditions (if ... else if chain)
            // ═══════════════════════════════════════════════════
            if (node.type === 'IfStatement') {
                if (visitedIfs.has(node)) return;

                const conditions = [node.test];
                let current = node.alternate;

                while (current && current.type === 'IfStatement') {
                    visitedIfs.add(current);

                    const isDuplicate = conditions.some(cond => isAstEqual(cond, current.test));
                    
                    if (isDuplicate) {
                        deadNodes.push({
                            name: 'Duplicate If Condition (Unreachable)',
                            type: 'DuplicateCondition',
                            line: current.loc ? current.loc.start.line : 0,
                            node: current
                        });
                    }
                    conditions.push(current.test);
                    current = current.alternate;
                }

                // ═══════════════════════════════════════════════════
                // 2. Condition Contradiction in the IF test itself
                // ═══════════════════════════════════════════════════
                if (hasContradiction(node.test)) {
                    const rootCauseId = `contradictory-condition:${node.start ?? node.range?.[0] ?? node.loc?.start.line}`;
                    // Laporan 1: Menunjuk tepat ke ekspresi kondisi yang kontradiktif
                    const exprLine = node.test.loc ? node.test.loc.start.line : (node.loc ? node.loc.start.line : 0);
                    deadNodes.push({
                        name: 'Contradictory Expression (always false)',
                        type: 'DeadBranch',
                        line: exprLine,
                        node: node.test,
                        rootCauseId,
                        rootNode: node
                    });

                    // Laporan 2: Menunjuk tepat ke blok kode percabangan yang tidak terjangkau akibat kondisi di atas
                    const branchLine = getBranchStartLine(node.consequent, node);
                    deadNodes.push({
                        name: 'Dead Branch Block (unreachable)',
                        type: 'DeadBranch',
                        line: branchLine,
                        node: node.consequent,
                        rootCauseId,
                        rootNode: node
                    });
                }
            } 

            // ═══════════════════════════════════════════════════
            // 3. Duplicate Switch Cases
            // ═══════════════════════════════════════════════════
            else if (node.type === 'SwitchStatement') {
                const caseTests = [];
                for (const switchCase of node.cases) {
                    if (switchCase.test) {
                        const isDuplicate = caseTests.some(test => isAstEqual(test, switchCase.test));
                        if (isDuplicate) {
                            deadNodes.push({
                                name: 'Duplicate Switch Case (Unreachable)',
                                type: 'DuplicateCondition',
                                line: switchCase.loc ? switchCase.loc.start.line : 0,
                                node: switchCase
                            });
                        } else {
                            caseTests.push(switchCase.test);
                        }
                    }
                }

                // ═══════════════════════════════════════════════════
                // 4. Switch: Default unreachable if all cases return
                // ═══════════════════════════════════════════════════
                const defaultCase = node.cases.find(c => c.test === null);
                const nonDefaultCases = node.cases.filter(c => c.test !== null);

                if (defaultCase && nonDefaultCases.length > 0) {
                    // Cek apakah SEMUA non-default case memiliki terminator
                    const terminators = new Set(['ReturnStatement', 'ThrowStatement', 'BreakStatement', 'ContinueStatement']);
                    
                    // Cek discriminant: switch(true) dengan setiap case sudah cover
                    if (node.discriminant.type === 'Literal' && node.discriminant.value === true) {
                        // switch(true) → setiap case adalah kondisi boolean
                        // Jika semua case return, default unreachable
                        const allReturn = nonDefaultCases.every(c => {
                            return c.consequent.some(stmt => terminators.has(stmt.type));
                        });
                        if (allReturn && defaultCase.consequent.length > 0) {
                            deadNodes.push({
                                name: 'Potentially Unreachable Default Case',
                                type: 'DuplicateCondition',
                                line: defaultCase.loc ? defaultCase.loc.start.line : 0,
                                node: defaultCase
                            });
                        }
                    }
                }
            }

            // ═══════════════════════════════════════════════════
            // 5. Standalone Contradiction in any LogicalExpression
            // ═══════════════════════════════════════════════════
            if (node.type === 'LogicalExpression' && node.operator === '&&') {
                // Skip jika parent adalah IfStatement/Loop yang sudah di-handle di atas
                const isHandledCondition = parent && (
                    (parent.type === 'IfStatement' && parent.test === node) ||
                    (parent.type === 'WhileStatement' && parent.test === node) ||
                    (parent.type === 'ForStatement' && parent.test === node) ||
                    (parent.type === 'ConditionalExpression' && parent.test === node)
                );

                if (!isHandledCondition && hasContradiction(node)) {
                    deadNodes.push({
                        name: 'Contradictory Expression (always false)',
                        type: 'DeadBranch',
                        line: node.loc ? node.loc.start.line : 0,
                        node: node
                    });
                }
            }
        }
    });

    return deadNodes;
}
