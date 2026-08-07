import estraverse from 'estraverse';
import { visitorKeys as tsVisitorKeys } from '@typescript-eslint/visitor-keys';

const visitorKeys = { ...estraverse.VisitorKeys, ...tsVisitorKeys };

/**
 * Public API Reachability Analyzer
 * 
 * Modul ini bertujuan untuk mendeteksi kelas mana saja yang merupakan
 * bagian dari "Public API" suatu library. Kelas yang menjadi Public API
 * tidak boleh ditandai method public/protected-nya sebagai Dead Code, 
 * meskipun tidak pernah dipanggil secara internal.
 * 
 * Deteksi meliputi:
 * 1. Export langsung (export class A {})
 * 2. Export named (export { A })
 * 3. Export instansiasi (export default new A())
 * 4. Fungsi yang mengembalikan instansiasi (export function x() { return new A(); })
 * 5. CommonJS exports (module.exports = A, exports.B = new A())
 */
export function analyzePublicApiClasses(ast) {
    const publicClasses = new Set();
    const exportedFunctions = new Set();

    // Pass 1: Deteksi ekspor dan struktur dasar
    estraverse.traverse(ast, {
        fallback: 'iteration',
        keys: visitorKeys,
        enter(node) {
            // 1. ES6 Export Named Declaration (export class A {})
            if (node.type === 'ExportNamedDeclaration') {
                if (node.declaration) {
                    if (node.declaration.type === 'ClassDeclaration' && node.declaration.id) {
                        publicClasses.add(node.declaration.id.name);
                    } else if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
                        exportedFunctions.add(node.declaration.id.name);
                    } else if (node.declaration.type === 'VariableDeclaration') {
                        node.declaration.declarations.forEach(decl => {
                            if (decl.id && decl.id.type === 'Identifier') {
                                if (decl.init && (decl.init.type === 'ArrowFunctionExpression' || decl.init.type === 'FunctionExpression')) {
                                    exportedFunctions.add(decl.id.name);
                                }
                                if (decl.init && decl.init.type === 'NewExpression' && decl.init.callee.type === 'Identifier') {
                                    publicClasses.add(decl.init.callee.name);
                                }
                                if (decl.init && decl.init.type === 'Identifier') { // export const A = B (B mungkin kelas)
                                    // Kita tampung dulu, idealnya ada alias tracker, tapi minimal kita bisa
                                    // tandai B jika kita tahu B adalah kelas.
                                    publicClasses.add(decl.init.name); 
                                }
                            }
                        });
                    }
                }
                if (node.specifiers) {
                    node.specifiers.forEach(spec => {
                        if (spec.local && spec.local.type === 'Identifier') {
                            publicClasses.add(spec.local.name);
                            exportedFunctions.add(spec.local.name);
                        }
                    });
                }
            }

            // 2. ES6 Export Default
            if (node.type === 'ExportDefaultDeclaration') {
                if (node.declaration.type === 'ClassDeclaration' && node.declaration.id) {
                    publicClasses.add(node.declaration.id.name);
                } else if (node.declaration.type === 'Identifier') {
                    publicClasses.add(node.declaration.name);
                    exportedFunctions.add(node.declaration.name);
                } else if (node.declaration.type === 'NewExpression' && node.declaration.callee.type === 'Identifier') {
                    publicClasses.add(node.declaration.callee.name);
                }
            }

            // 3. CommonJS module.exports atau exports
            if (node.type === 'AssignmentExpression') {
                const isExports = (
                    (node.left.type === 'MemberExpression' && node.left.object.name === 'module' && node.left.property.name === 'exports') ||
                    (node.left.type === 'MemberExpression' && node.left.object.name === 'exports') ||
                    (node.left.type === 'Identifier' && node.left.name === 'exports')
                );
                
                if (isExports) {
                    if (node.right.type === 'Identifier') {
                        publicClasses.add(node.right.name);
                    } else if (node.right.type === 'NewExpression' && node.right.callee.type === 'Identifier') {
                        publicClasses.add(node.right.callee.name);
                    } else if (node.right.type === 'ClassExpression' && node.right.id) {
                        publicClasses.add(node.right.id.name);
                    }
                }
            }
        }
    });

    // Pass 2: Analisis isi fungsi yang diekspor untuk mencari `return new ClassName()`
    // Karena kita tidak mengikat nama dengan scope (demi kecepatan), pencarian ini
    // bersifat agak fuzzy tapi sangat aman untuk menghindari False Positives di library.
    let currentFunction = null;
    let isInsideExportedFunction = false;

    estraverse.traverse(ast, {
        fallback: 'iteration',
        keys: visitorKeys,
        enter(node, parent) {
            if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
                let funcName = null;
                if (node.id) {
                    funcName = node.id.name;
                } else if (parent && parent.type === 'VariableDeclarator' && parent.id.type === 'Identifier') {
                    funcName = parent.id.name;
                } else if (parent && parent.type === 'AssignmentExpression' && parent.left.type === 'MemberExpression' && parent.left.property.type === 'Identifier') {
                    // misal: exports.foo = function() {}
                    funcName = parent.left.property.name;
                    // Anggap saja semua fungsi yang di-assign ke member adalah potensial Public API
                    // untuk amannya di mode library.
                    isInsideExportedFunction = true; 
                } else if (parent && parent.type === 'ExportDefaultDeclaration') {
                    isInsideExportedFunction = true;
                }

                if (funcName && exportedFunctions.has(funcName)) {
                    isInsideExportedFunction = true;
                }
            }

            if (isInsideExportedFunction && node.type === 'ReturnStatement' && node.argument) {
                if (node.argument.type === 'NewExpression' && node.argument.callee.type === 'Identifier') {
                    publicClasses.add(node.argument.callee.name);
                }
                if (node.argument.type === 'Identifier') {
                    // Bisa jadi yang direturn adalah kelas/instansi yang dideklarasikan sebelumnya.
                    // Ini berpotensi menandai Identifier apapun sebagai "Public API class",
                    // tetapi karena classAnalyzer.js hanya akan memproses nama yang benar-benar
                    // sebuah class, ini adalah fuzzy matching yang aman.
                    publicClasses.add(node.argument.name);
                }
            }
        },
        leave(node) {
            if (node.type === 'FunctionDeclaration' || node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression') {
                isInsideExportedFunction = false;
            }
        }
    });

    return publicClasses;
}
