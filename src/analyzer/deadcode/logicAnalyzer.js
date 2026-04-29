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
 * Menganalisis kondisi logika duplikat yang menyebabkan Unreachable Code.
 * Contoh: if(a){} else if(a){} -> blok kedua adalah dead code.
 * 
 * @param {object} ast - ESTree AST Root Node
 * @returns {Array} Daftar node yang merupakan kondisi duplikat
 */
export function findDuplicateConditions(ast) {
    const deadNodes = [];
    const visitedIfs = new Set();

    estraverse.traverse(ast, {
        enter(node) {
            // 1. Cek IfStatement berantai (if ... else if)
            if (node.type === 'IfStatement') {
                if (visitedIfs.has(node)) return; // Jangan cek ulang chain dari tengah

                const conditions = [node.test];
                let current = node.alternate;

                while (current && current.type === 'IfStatement') {
                    visitedIfs.add(current); // Tandai sebagai sudah dikunjungi dalam chain ini

                    // Cek apakah kondisi saat ini duplikat dari salah satu kondisi sebelumnya
                    const isDuplicate = conditions.some(cond => isAstEqual(cond, current.test));
                    
                    if (isDuplicate) {
                        deadNodes.push({
                            name: 'Duplicate If Condition (Unreachable)',
                            type: 'DuplicateCondition', // Tipe khusus agar TIDAK dihapus otomatis
                            line: current.loc ? current.loc.start.line : 0,
                            node: current
                        });
                    }
                    // Tambahkan ke history untuk mengecek kondisi berikutnya di chain
                    conditions.push(current.test);
                    current = current.alternate;
                }
            } 
            // 2. Cek SwitchStatement (case duplikat)
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
            }
        }
    });

    return deadNodes;
}
