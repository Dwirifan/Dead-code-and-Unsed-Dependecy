import estraverse from 'estraverse';
import { Scope } from './scope.js';
import { isReference } from './isReference.js';
import { extractIdentifiers } from './destructuringExtractor.js';
import { findFunctionScope } from './scopeHelpers.js';
import { findUnreachableBranches } from './branchAnalyzer.js';
import { markUsedExports } from './exportAnalyzer.js';

// Logika Analisis Utama
function analyzeDeadCodeRevised(ast, fileName = null, globalRegistry = null, ruleEngine = null) {
    const allScopes = [];
    const globalScope = new Scope();
    allScopes.push(globalScope);
    
    let currentScope = globalScope;
    let scopeStack = [globalScope];
    let scopeTypeStack = ['global']; 
    const parentStack = []; 

    // Phase 1: Murni memetakan Variable Scope & Referensi Variabel
    estraverse.traverse(ast, {
        fallback: 'iteration', 
        enter: function (node, parent) {
            parentStack.push(node);

            // Pembuatan Jangkauan (Scope)
            if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
                const newScope = new Scope(currentScope);
                allScopes.push(newScope);
                currentScope = newScope;
                scopeStack.push(newScope);
                scopeTypeStack.push('function');

                // Deteksi Self-Reference (Rekursi):
                // Tandai nama fungsi pemilik scope ini agar self-call tidak dihitung
                // sebagai penggunaan eksternal. Tanpa ini, fungsi rekursif yang tidak
                // dipanggil dari luar akan lolos deteksi dead code.
                if (node.type === 'FunctionDeclaration' && node.id) {
                    // function factorial(n) { ... factorial(n-1) ... }
                    newScope.selfName = node.id.name;
                } else if (parent && parent.type === 'VariableDeclarator'
                           && parent.id && parent.id.type === 'Identifier') {
                    // const factorial = function(n) { ... factorial(n-1) ... }
                    // const factorial = (n) => ... factorial(n-1) ...
                    newScope.selfName = parent.id.name;
                }
            } else if (node.type === 'BlockStatement') {
                const isFunctionBody = parent && ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(parent.type);
                if (!isFunctionBody) {
                    const newScope = new Scope(currentScope);
                    allScopes.push(newScope);
                    currentScope = newScope;
                    scopeStack.push(newScope);
                    scopeTypeStack.push('block');
                }
            }

            // Sinkronisasi Deklarasi Variabel/Fungsi
            if (node.type === 'VariableDeclarator') {
                const declarationKind = (parent && parent.type === 'VariableDeclaration') ? parent.kind : 'let';
                const identifiers = extractIdentifiers(node.id);
                const targetScope = (declarationKind === 'var')
                    ? findFunctionScope(scopeStack, scopeTypeStack)
                    : currentScope;
                
                identifiers.forEach(({ name, node: idNode }) => {
                    // Simpan referensi ke VariableDeclarator (node) dan VariableDeclaration (parent)
                    // agar magic-string bisa menghapus seluruh deklarasi, bukan hanya nama identifier
                    targetScope.addDeclaration(name, 'Variable', node.loc.start.line, node, parent);
                });
            }

            if (node.type === 'FunctionDeclaration' && node.id) {
                if (currentScope.parent) {
                    currentScope.parent.addDeclaration(node.id.name, 'Function', node.loc.start.line, node);
                }
            }

            // Evaluasi Parameter Fungsi
            if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
                node.params.forEach(param => {
                    const identifiers = extractIdentifiers(param);
                    identifiers.forEach(({ name, node: idNode }) => {
                        currentScope.addDeclaration(name, 'Parameter', param.loc.start.line, idNode);
                    });
                });
            }

            // Pendataan Deklarasi Impor
            if (node.type === 'ImportDeclaration' && node.specifiers) {
                node.specifiers.forEach(spec => {
                    if (spec.local && spec.local.type === 'Identifier') {
                        currentScope.addDeclaration(spec.local.name, 'Variable', spec.loc.start.line, spec.local);
                    }
                });
            }

            // Pelacakan Referensi Penggunaan
            if (node.type === 'Identifier') {
                const grandParent = parentStack.length >= 3 ? parentStack[parentStack.length - 3] : null;
                if (isReference(node, parent, grandParent)) {
                    currentScope.addReference(node.name);
                }
            }
        },
        leave: function (node, parent) {
            parentStack.pop();
            if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
                scopeStack.pop();
                scopeTypeStack.pop();
                currentScope = scopeStack[scopeStack.length - 1];
            } else if (node.type === 'BlockStatement') {
                const isFunctionBody = parent && ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(parent.type);
                if (!isFunctionBody) {
                    scopeStack.pop();
                    scopeTypeStack.pop();
                    currentScope = scopeStack[scopeStack.length - 1];
                }
            }
        }
    });

    // Phase 2: Hubungkan Expor / Lintas Modul
    markUsedExports(ast, globalScope, fileName, globalRegistry, ruleEngine);

    // Phase 3: Analisis Scope
    allScopes.forEach(s => s.resolve());

    // Phase 4: Pengumpulan Dead Variables & Unreachable Branches
    const deadCode = [];
    const processedParents = new Set(); // Cegah duplikasi penghapusan VariableDeclaration

    // Kumpulkan semua dead variable names terlebih dahulu
    const allDeadNames = new Set();
    allScopes.forEach(scope => {
        scope.declarations.forEach((info, name) => {
            if (!info.used && !(ruleEngine && ruleEngine.isIgnoredVariable(name))) {
                allDeadNames.add(name);
            }
        });
    });

    allScopes.forEach(scope => {
       scope.declarations.forEach((info, name) => {
           if (!info.used) {
               if (ruleEngine && ruleEngine.isIgnoredVariable(name)) {
                   return;
               }

               // Tentukan node yang tepat untuk dihapus oleh magic-string
               let targetNode = info.node; // Default: VariableDeclarator

               if (info.type === 'Variable' && info.parentNode && info.parentNode.type === 'VariableDeclaration') {
                   const parentDecl = info.parentNode;

                   if (processedParents.has(parentDecl)) {
                       // Parent sudah diproses sebelumnya, skip agar tidak duplikat
                       return;
                   }

                   // Cek apakah SEMUA declarator di parent ini juga dead
                   const allDeclaratorsDead = parentDecl.declarations.every(declarator => {
                       if (declarator.id && declarator.id.type === 'Identifier') {
                           return allDeadNames.has(declarator.id.name);
                       }
                       // Untuk destructuring, cek semua identifier di dalamnya
                       const ids = extractIdentifiers(declarator.id);
                       return ids.every(({ name: idName }) => allDeadNames.has(idName));
                   });

                   if (allDeclaratorsDead) {
                       // Semua declarator dead → hapus seluruh VariableDeclaration
                       targetNode = parentDecl;
                       processedParents.add(parentDecl);
                   } else {
                       // Hanya sebagian dead → hapus VariableDeclarator individual
                       targetNode = info.node;
                   }
               }

               deadCode.push({
                   name,
                   type: info.type,
                   line: info.line,
                   node: targetNode
               });
           }
       });
    });

    const unreachableNodes = findUnreachableBranches(ast);
    deadCode.push(...unreachableNodes);

    return deadCode;
}

export { analyzeDeadCodeRevised as findDeadCode };
