import estraverse from 'estraverse';
import { visitorKeys as tsVisitorKeys } from '@typescript-eslint/visitor-keys';
import { Scope } from './core/scope.js';
import { isReference } from './core/isReference.js';
import { extractIdentifiers } from './core/destructuringExtractor.js';
import { findFunctionScope } from './core/scopeHelpers.js';
import { findUnreachableBranches } from './core/branchAnalyzer.js';
import { markUsedExports } from './typescript/exportAnalyzer.js';
import { findDuplicateConditions } from './core/logicAnalyzer.js';
import { findUnusedClassMethods } from './typescript/classAnalyzer.js';
import { findRedundantCode } from './core/redundancyAnalyzer.js';
import { buildCFG, analyzePathSensitive } from './core/flowAnalyzer.js';
import { analyzeReactSmells } from './react/reactAnalyzer.js';

// Gabungkan Visitor Keys ESTree standar dengan ekstrasi TypeScript/JSX
const visitorKeys = { ...estraverse.VisitorKeys, ...tsVisitorKeys };

/**
 * Sistem Klasifikasi Kepercayaan (Confidence Scoring)
 * 
 * Setiap temuan dead code diberi label:
 *   - confidence: 'high' | 'medium' | 'low'
 *   - status:     'safe' | 'review' | 'risky'
 * 
 * Aturan Penentuan:
 *   HIGH  + SAFE   → Unused local variable, unused import (99% aman dihapus)
 *   HIGH  + SAFE   → Unreachable code setelah return/throw (100% aman)
 *   MEDIUM + REVIEW → Unused function, write-only variable (perlu cek side-effect)
 *   MEDIUM + REVIEW → Duplicate condition (logika mungkin sengaja)
 *   LOW   + RISKY  → Class method, parameter (risiko rusak API/callback)
 */
function classifyConfidence(type, info = {}) {
    switch (type) {
        // === HIGH CONFIDENCE (Aman dihapus) ===
        case 'Variable':
            // Import yang tidak dipakai = high confidence
            if (info.isImport) return { confidence: 'high', status: 'safe' };
            // Variable lokal biasa = high confidence
            return { confidence: 'high', status: 'safe' };

        case 'UnusedType':
            // Interface/Type/Enum TypeScript yang tidak dipakai
            return { confidence: 'high', status: 'safe' };

        case 'WriteOnly':
            // Variable yang hanya ditulis tapi tidak pernah dibaca
            return { confidence: 'medium', status: 'review' };

        case 'Function':
            // Fungsi yang tidak dipanggil di scope manapun
            return { confidence: 'medium', status: 'review' };

        // === HIGH CONFIDENCE (Pasti tidak tereksekusi) ===
        case 'DeadCode':
        case 'DeadBranch':
            return { confidence: 'high', status: 'safe' };

        // === MEDIUM CONFIDENCE (Butuh peninjauan) ===
        case 'DuplicateCondition':
            return { confidence: 'medium', status: 'review' };

        case 'EmptyBlock':
            return { confidence: 'medium', status: 'review' };

        case 'DuplicateImport':
            return { confidence: 'high', status: 'safe' };

        case 'RedundantCode':
            return { confidence: 'medium', status: 'review' };

        case 'PathWarning':
            return { confidence: 'low', status: 'risky' };

        // === LOW CONFIDENCE (Berisiko tinggi) ===
        case 'ClassMethod':
            return { confidence: 'low', status: 'risky' };

        case 'Parameter':
            return { confidence: 'low', status: 'risky' };

        default:
            return { confidence: 'medium', status: 'review' };
    }
}

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
        keys: visitorKeys,
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
            } else if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
                // Class Body mendapatkan scope sendiri agar method-nya bisa dilacak
                const newScope = new Scope(currentScope);
                allScopes.push(newScope);
                currentScope = newScope;
                scopeStack.push(newScope);
                scopeTypeStack.push('class');
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
                
                identifiers.forEach(({ name }) => {
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

            // Pendataan Deklarasi Class (agar class tanpa penggunaan terdeteksi)
            if (node.type === 'ClassDeclaration' && node.id) {
                if (currentScope.parent) {
                    currentScope.parent.addDeclaration(node.id.name, 'Variable', node.loc.start.line, node);
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
            // PENTING: Side-effect imports (tanpa specifier) TIDAK didaftarkan ke scope
            // karena memang tidak mendeklarasikan variabel apapun.
            // Contoh: import './polyfill.js' atau import 'reflect-metadata'
            if (node.type === 'ImportDeclaration' && node.specifiers) {
                // Skip side-effect imports — mereka punya efek samping (polyfill, CSS, etc)
                if (node.specifiers.length === 0) {
                    // Ini adalah side-effect import: import './something'
                    // Jangan masukkan ke scope apapun — ini BUKAN dead code.
                    return;
                }
                const isTypeImport = node.importKind === 'type';
                
                node.specifiers.forEach(spec => {
                    if (spec.local && spec.local.type === 'Identifier') {
                        const isSpecifierTypeImport = spec.importKind === 'type' || isTypeImport;
                        const declarationType = isSpecifierTypeImport ? 'UnusedType' : 'Variable';
                        currentScope.addDeclaration(spec.local.name, declarationType, spec.loc.start.line, spec.local, { isImport: true });
                    }
                });
            }

            // Pendataan TypeScript-only Deklarasi (Interface, Type Alias, Enum)
            if (node.type === 'TSInterfaceDeclaration' && node.id) {
                currentScope.addDeclaration(node.id.name, 'UnusedType', node.loc.start.line, node);
            }
            if (node.type === 'TSTypeAliasDeclaration' && node.id) {
                currentScope.addDeclaration(node.id.name, 'UnusedType', node.loc.start.line, node);
            }
            if (node.type === 'TSEnumDeclaration' && node.id) {
                currentScope.addDeclaration(node.id.name, 'UnusedType', node.loc.start.line, node);
            }
            if (node.type === 'TSModuleDeclaration' && node.id) {
                currentScope.addDeclaration(node.id.name, 'Variable', node.loc.start.line, node);
            }

            // Pelacakan Referensi Penggunaan (Read vs Write Differentiation)
            if (node.type === 'Identifier' || node.type === 'JSXIdentifier') {
                const grandParent = parentStack.length >= 3 ? parentStack[parentStack.length - 3] : null;
                if (isReference(node, parent, grandParent)) {
                    // Tentukan apakah ini konteks WRITE (assignment target) atau READ
                    const isWriteContext = (
                        // a = 10 (left side of assignment, bukan compound +=, -=, dll)
                        (parent.type === 'AssignmentExpression' && parent.left === node && parent.operator === '=')
                    );

                    // Compound assignment (a += 10) atau Update (a++) → READ + WRITE
                    const isCompoundWrite = (
                        (parent.type === 'AssignmentExpression' && parent.left === node && parent.operator !== '=') ||
                        (parent.type === 'UpdateExpression')
                    );

                    if (isCompoundWrite) {
                        // +=, -=, *=, dll → variabel DIBACA lalu ditulis, jadi tetap READ
                        currentScope.addReadReference(node.name);
                        currentScope.addWriteReference(node.name);
                    } else if (isWriteContext) {
                        // Pure write (a = 10) → hanya WRITE, TIDAK menandai used
                        currentScope.addWriteReference(node.name);
                    } else {
                        // Normal read (console.log(a), return a, dst)
                        currentScope.addReadReference(node.name);
                    }
                }
            }
        },
        leave: function (node, parent) {
            parentStack.pop();
            if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
                scopeStack.pop();
                scopeTypeStack.pop();
                currentScope = scopeStack[scopeStack.length - 1];
            } else if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
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
        },
        keys: visitorKeys
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

                // Tentukan tipe: apakah Write-Only atau benar-benar tidak pernah disentuh
                const effectiveType = (info.writeCount > 0 && info.readCount === 0)
                    ? 'WriteOnly'
                    : info.type;

                // Tentukan apakah ini deklarasi import
                const isImport = info.node && (
                    info.node.type === 'ImportSpecifier' ||
                    info.node.type === 'ImportDefaultSpecifier' ||
                    info.node.type === 'ImportNamespaceSpecifier' ||
                    (info.node.type === 'Identifier' && info.parentNode && info.parentNode.type === 'ImportDeclaration')
                );

                const { confidence, status } = classifyConfidence(effectiveType, { isImport });

                deadCode.push({
                    name,
                    type: effectiveType,
                    line: info.line,
                    node: targetNode,
                    confidence,
                    status
                });
           }
       });
    });

    const unreachableNodes = findUnreachableBranches(ast);
    unreachableNodes.forEach(node => {
        const { confidence, status } = classifyConfidence(node.type);
        node.confidence = confidence;
        node.status = status;
    });
    deadCode.push(...unreachableNodes);

    // Phase 5: Analisis Logika (Duplicate Conditions)
    const duplicateConditions = findDuplicateConditions(ast);
    duplicateConditions.forEach(node => {
        const { confidence, status } = classifyConfidence(node.type);
        node.confidence = confidence;
        node.status = status;
    });
    deadCode.push(...duplicateConditions);

    // Phase 6: Simple Type Inference — Unused Class Methods
    const unusedMethods = findUnusedClassMethods(ast, globalRegistry);
    unusedMethods.forEach(node => {
        const { confidence, status } = classifyConfidence(node.type);
        node.confidence = confidence;
        node.status = status;
    });
    deadCode.push(...unusedMethods);

    // Phase 7: Duplicate Import Detection
    // Mendeteksi import yang sama dari modul yang sama dideklarasikan lebih dari sekali.
    // Contoh: import { foo } from './lib'; import { foo } from './lib'; → duplikat
    const importMap = new Map(); // key: 'modulePath::specifierName'
    for (const node of (ast.body || [])) {
        if (node.type === 'ImportDeclaration' && node.specifiers && node.source) {
            const modulePath = node.source.value;
            for (const spec of node.specifiers) {
                const localName = spec.local ? spec.local.name : null;
                if (!localName) continue;
                const key = `${modulePath}::${localName}`;
                if (importMap.has(key)) {
                    const { confidence, status } = classifyConfidence('DuplicateImport');
                    deadCode.push({
                        name: `Duplicate import '${localName}' from '${modulePath}'`,
                        type: 'DuplicateImport',
                        line: spec.loc ? spec.loc.start.line : node.loc.start.line,
                        node: node,
                        confidence,
                        status
                    });
                } else {
                    importMap.set(key, true);
                }
            }
        }
    }

    // Phase 8: Redundant Code Detection
    const redundantNodes = findRedundantCode(ast);
    redundantNodes.forEach(node => {
        const { confidence, status } = classifyConfidence(node.type);
        node.confidence = confidence;
        node.status = status;
    });
    deadCode.push(...redundantNodes);

    // Phase 9: CFG-Based Unreachable Block Detection
    // Membangun Control Flow Graph dan mendeteksi blok tanpa predecessor.
    const programBody = ast.body || [];
    const cfg = buildCFG(programBody);
    for (const block of cfg.unreachableBlocks) {
        for (const stmt of block.statements) {
            const { confidence, status } = classifyConfidence('DeadCode');
            deadCode.push({
                name: 'CFG Unreachable Block',
                type: 'DeadCode',
                line: stmt.loc ? stmt.loc.start.line : 0,
                node: stmt,
                confidence,
                status
            });
        }
    }

    // Phase 10: Path-Sensitive Analysis
    const pathFindings = analyzePathSensitive(ast);
    pathFindings.forEach(node => {
        const { confidence, status } = classifyConfidence(node.type);
        node.confidence = confidence;
        node.status = status;
    });
    deadCode.push(...pathFindings);

    // Phase 11: React Bad Smells — hanya untuk file .jsx dan .tsx
    const reactExtensions = new Set(['.jsx', '.tsx']);
    const fileExt = fileName ? '.' + fileName.split('.').pop().toLowerCase() : '';
    if (reactExtensions.has(fileExt)) {
        const reactFindings = analyzeReactSmells(ast);
        reactFindings.forEach(node => {
            node.confidence = 'medium';
            node.status = 'review';
        });
        deadCode.push(...reactFindings);
    }

    return deadCode;
}

export { analyzeDeadCodeRevised as findDeadCode };
