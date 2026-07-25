import estraverse from 'estraverse';
import { visitorKeys as tsVisitorKeys } from '@typescript-eslint/visitor-keys';
import { Scope } from './core/scope.js';
import { isReference } from './core/isReference.js';
import { extractIdentifiers } from './core/destructuringExtractor.js';
import { findFunctionScope } from './core/scopeHelpers.js';
import { markUsedExports } from './typescript/exportAnalyzer.js';
import { classifyConfidence } from './core/confidenceClassifier.js';
import { BUILTIN_GLOBALS } from './core/globals.js';

// Gabungkan Visitor Keys ESTree standar dengan ekstrasi TypeScript/JSX
const visitorKeys = { ...estraverse.VisitorKeys, ...tsVisitorKeys };

/**
 * Mengecek apakah sebuah AST expression bersifat statis/pure (tidak memiliki side-effect saat dievaluasi).
 */
function isPureExpression(node) {
    if (!node) return true; // Tidak ada inisialisasi (let x;) adalah pure

    switch (node.type) {
        case 'Literal':
        case 'Identifier':
        case 'ArrowFunctionExpression':
        case 'FunctionExpression':
        case 'ClassExpression':
        case 'ThisExpression':
        case 'Super':
        case 'MetaProperty': // import.meta
            return true;
        case 'TemplateLiteral':
            return node.expressions.every(isPureExpression);
        case 'UnaryExpression':
            return isPureExpression(node.argument);
        case 'UpdateExpression':
            return false; // ++x, x-- punya side effect
        case 'BinaryExpression':
        case 'LogicalExpression':
            return isPureExpression(node.left) && isPureExpression(node.right);
        case 'ConditionalExpression':
            return isPureExpression(node.test) && isPureExpression(node.consequent) && isPureExpression(node.alternate);
        case 'ArrayExpression':
            return node.elements.every(elem => !elem || isPureExpression(elem));
        case 'ObjectExpression':
            return node.properties.every(prop => {
                if (prop.type === 'SpreadElement') return isPureExpression(prop.argument);
                return isPureExpression(prop.key) && isPureExpression(prop.value);
            });
        case 'MemberExpression':
            return !node.computed ? isPureExpression(node.object) : (isPureExpression(node.object) && isPureExpression(node.property));
        case 'CallExpression': {
            let callName = '';
            if (node.callee.type === 'Identifier') {
                callName = node.callee.name;
            } else if (node.callee.type === 'MemberExpression') {
                const objName = node.callee.object.type === 'Identifier' ? node.callee.object.name : '';
                const propName = !node.callee.computed && node.callee.property.type === 'Identifier' ? node.callee.property.name : '';
                if (objName && propName) callName = `${objName}.${propName}`;
            }

            const pureWhitelist = new Set([
                'path.dirname', 'path.resolve', 'path.join', 'path.basename', 'path.extname', 'path.normalize',
                'fileURLToPath', 'require', 'Symbol', 'Symbol.for', 'Object.create', 'Object.freeze',
                'Object.assign', 'Object.defineProperty', 'Object.keys', 'Object.values', 'Object.entries',
                'Array.isArray', 'Boolean', 'String', 'Number', 'parseInt', 'parseFloat'
            ]);

            if (pureWhitelist.has(callName)) {
                return node.arguments.every(arg => !arg || isPureExpression(arg));
            }
            return false;
        }
        default:
            return false;
    }
}

/**
 * Smart Background Analysis 3 Lapis: Mengecek apakah variabel yang berawalan ignore
 * (seperti _req, _e, atau __dirname) sebenarnya adalah 100% Dead Code mandiri tanpa side effect.
 */
function is100PercentDeadIgnoredVariable(info) {
    if (!info || !info.node) return false;

    // Lapis 1 & 2: Bukan parameter, bukan catch parameter, bukan import, bukan class/function
    if (['Parameter', 'CatchParameter', 'Import', 'Class', 'Function'].includes(info.type)) {
        return false;
    }

    // Pastikan ini adalah deklarasi variabel biasa
    if (info.type !== 'Variable') {
        return false;
    }

    // Pastikan deklarasi adalah mandiri (Identifier), BUKAN hasil destructuring (ArrayPattern / ObjectPattern)
    if (info.node.type === 'VariableDeclarator') {
        if (!info.node.id || info.node.id.type !== 'Identifier') {
            return false; // Terikat sintaks destructuring (misal: const { pwd: _pwd, ...rest } = obj)
        }
        // Lapis 3: Evaluasi side effect pada inisialisasinya
        return isPureExpression(info.node.init);
    }

    return false;
}

export function analyzeAstCode(ast, fileName = null, globalRegistry = null, ruleEngine = null) {
    const allScopes = [];
    const globalScope = new Scope();
    allScopes.push(globalScope);
    
    let currentScope = globalScope;
    let scopeStack = [globalScope];
    let scopeTypeStack = ['global']; 
    const parentStack = []; 
    const ownerStack = []; 

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

                // Deteksi Self-Reference (Rekursi)
                if (node.type === 'FunctionDeclaration' && node.id) {
                    newScope.selfName = node.id.name;
                } else if (parent && parent.type === 'VariableDeclarator'
                           && parent.id && parent.id.type === 'Identifier') {
                    newScope.selfName = parent.id.name;
                }
            } else if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
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
                
                identifiers.forEach(({ name, node: idNode }) => {
                    const targetDeletionNode = (node.id.type === 'Identifier') ? node : idNode;
                    targetScope.addDeclaration(name, 'Variable', node.loc.start.line, targetDeletionNode, parent);
                });
            }

            if (node.type === 'FunctionDeclaration' && node.id) {
                if (currentScope.parent) {
                    currentScope.parent.addDeclaration(node.id.name, 'Function', node.loc.start.line, node);
                }
            }

            // Pendataan Deklarasi Class
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

            // Evaluasi CatchClause (parameter error seperti catch(err))
            if (node.type === 'CatchClause' && node.param) {
                const identifiers = extractIdentifiers(node.param);
                identifiers.forEach(({ name, node: idNode }) => {
                    currentScope.addDeclaration(name, 'CatchParameter', node.loc.start.line, idNode);
                });
            }

            // Pendataan Deklarasi Impor
            if (node.type === 'ImportDeclaration' && node.specifiers) {
                if (node.specifiers.length === 0) {
                    return; // Side-effect import
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

            if (node.type === 'TSImportEqualsDeclaration' && node.id) {
                const isTypeImport = node.isTypeOnly || node.importKind === 'type';
                const declarationType = isTypeImport ? 'UnusedType' : 'Variable';
                currentScope.addDeclaration(node.id.name, declarationType, node.loc ? node.loc.start.line : 0, node.id, { isImport: true });
            }

            if (node.type === 'ExportAllDeclaration' && node.exported && node.exported.type === 'Identifier') {
                currentScope.addDeclaration(node.exported.name, 'Variable', node.loc.start.line, node.exported, { isImport: true, isExport: true });
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
                if (node.members) {
                    node.members.forEach(member => {
                        if (member.id && member.id.type === 'Identifier') {
                            const memberKey = `${node.id.name}.${member.id.name}`;
                            currentScope.addDeclaration(memberKey, 'UnusedEnumMember', member.loc.start.line, member);
                        }
                    });
                }
            }
            if (node.type === 'TSModuleDeclaration' && node.id) {
                currentScope.addDeclaration(node.id.name, 'Variable', node.loc ? node.loc.start.line : 0, node);
            }
            if (node.type === 'TSDeclareFunction' && node.id) {
                currentScope.addDeclaration(node.id.name, 'Function', node.loc ? node.loc.start.line : 0, node);
            }
            if (node.type === 'TSTypeParameter' && node.name && node.name.type === 'Identifier') {
                currentScope.addDeclaration(node.name.name, 'UnusedType', node.loc.start.line, node);
            }

            // Melacak owner untuk Fixed-Point Iterative Elimination
            if (node.type === 'VariableDeclarator') {
                const identifiers = extractIdentifiers(node.id);
                const declarationKind = (parent && parent.type === 'VariableDeclaration') ? parent.kind : 'let';
                const targetScope = (declarationKind === 'var') ? findFunctionScope(scopeStack, scopeTypeStack) : currentScope;
                const declInfos = identifiers.map(({ name }) => targetScope.declarations.get(name)).filter(Boolean);
                ownerStack.push(declInfos.length > 0 ? declInfos : null);
            }

            // Implicit JSX React Usage (Older React)
            // Di React < 17, JSX butuh import React from 'react' meskipun tidak dipanggil secara eksplisit.
            if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
                const reactRuntime = ruleEngine && ruleEngine.rules ? ruleEngine.rules.reactRuntime : 'classic';
                if (reactRuntime === 'classic') {
                    const currentOwners = ownerStack.length > 0 ? ownerStack[ownerStack.length - 1] : null;
                    currentScope.addReadReference('React', node, currentOwners);
                }
            }

            // Pelacakan Referensi Penggunaan
            if (node.type === 'Identifier' || node.type === 'JSXIdentifier') {
                const grandParent = parentStack.length >= 3 ? parentStack[parentStack.length - 3] : null;
                if (isReference(node, parent, grandParent)) {
                    const currentOwners = ownerStack.length > 0 ? ownerStack[ownerStack.length - 1] : null;
                    const isWriteContext = (
                        (parent.type === 'AssignmentExpression' && parent.left === node && parent.operator === '=')
                    );

                    const isCompoundWrite = (
                        (parent.type === 'AssignmentExpression' && parent.left === node && parent.operator !== '=') ||
                        (parent.type === 'UpdateExpression')
                    );

                    if (isCompoundWrite) {
                        currentScope.addReadReference(node.name, node, currentOwners);
                        currentScope.addWriteReference(node.name, node, currentOwners);
                    } else if (isWriteContext) {
                        currentScope.addWriteReference(node.name, node, currentOwners);
                    } else {
                        currentScope.addReadReference(node.name, node, currentOwners);
                        
                        // FITUR 6 & 7: Deteksi properti pada Namespace / Enum
                        if (parent.type === 'MemberExpression' && parent.object === node && !parent.computed && parent.property.type === 'Identifier') {
                            const memberKey = `${node.name}.${parent.property.name}`;
                            currentScope.addReadReference(memberKey, parent.property, currentOwners);
                        }
                    }
                }
            }
        },
        leave: function (node, parent) {
            parentStack.pop();
            if (node.type === 'VariableDeclarator') {
                ownerStack.pop();
            }
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
        }
    });

    // Phase 2: Hubungkan Expor / Lintas Modul
    markUsedExports(ast, globalScope, fileName, globalRegistry, ruleEngine);

    // Phase 3: Analisis Scope
    allScopes.forEach(s => s.resolve());

    // Phase 3.5: Fixed-Point Iterative Elimination (Cascading Dead Code Detection)
    // Melakukan konvergensi loop dalam memori untuk mendeteksi dead code berantai dalam 1 scan.
    const deadDeclarations = new Set();
    let newlyDead = [];

    allScopes.forEach(scope => {
        scope.declarations.forEach((info, name) => {
            if (info.readCount === 0 && info.type !== 'CatchParameter') {
                const isIgnored = ruleEngine && ruleEngine.isIgnoredVariable(name, fileName);
                if (!isIgnored || is100PercentDeadIgnoredVariable(info)) {
                    deadDeclarations.add(info);
                    newlyDead.push(info);
                }
            }
        });
    });

    while (newlyDead.length > 0) {
        const nextDead = [];
        
        allScopes.forEach(scope => {
            // Evaluasi Read References
            scope.readReferences.forEach(ref => {
                if (!ref.active || !ref.targetDecl || !ref.owners) return;
                const allOwnersDead = ref.owners.every(owner => deadDeclarations.has(owner));
                if (allOwnersDead) {
                    ref.active = false;
                    ref.targetDecl.readCount--;
                    if (ref.targetDecl.readCount === 0) {
                        ref.targetDecl.used = false;
                        if (ref.targetDecl.type !== 'CatchParameter' && !deadDeclarations.has(ref.targetDecl)) {
                            const isIgnored = ruleEngine && ruleEngine.isIgnoredVariable(ref.targetDecl.name, fileName);
                            if (!isIgnored || is100PercentDeadIgnoredVariable(ref.targetDecl)) {
                                deadDeclarations.add(ref.targetDecl);
                                nextDead.push(ref.targetDecl);
                            }
                        }
                    }
                }
            });

            // Evaluasi Write References (supaya writeCount akurat saat writernya sudah mati)
            scope.writeReferences.forEach(ref => {
                if (!ref.active || !ref.targetDecl || !ref.owners) return;
                const allOwnersDead = ref.owners.every(owner => deadDeclarations.has(owner));
                if (allOwnersDead) {
                    ref.active = false;
                    ref.targetDecl.writeCount--;
                }
            });
        });

        newlyDead = nextDead;
    }

    // Phase 4: Pengumpulan Dead Variables
    const deadCode = [];
    const processedParents = new Set();
    const allDeadNames = new Set();

    allScopes.forEach(scope => {
        scope.declarations.forEach((info, name) => {
            if (!info.used && info.type !== 'CatchParameter') {
                const isIgnored = ruleEngine && ruleEngine.isIgnoredVariable(name, fileName);
                if (!isIgnored || is100PercentDeadIgnoredVariable(info)) {
                    allDeadNames.add(name);
                }
            }
        });
    });

    allScopes.forEach(scope => {
       scope.declarations.forEach((info, name) => {
           if (!info.used) {
               if (info.type === 'CatchParameter') return; // JANGAN laporkan parameter catch karena menghapusnya bisa merusak sintaks (catch ())
               const isIgnored = ruleEngine && ruleEngine.isIgnoredVariable(name, fileName);
               if (isIgnored && !is100PercentDeadIgnoredVariable(info)) return;

               let targetNode = info.node;

               if (info.type === 'Variable' && info.parentNode && info.parentNode.type === 'VariableDeclaration') {
                   const parentDecl = info.parentNode;

                   if (processedParents.has(parentDecl)) return;

                   const allDeclaratorsDead = parentDecl.declarations.every(declarator => {
                       if (declarator.id && declarator.id.type === 'Identifier') {
                           return allDeadNames.has(declarator.id.name);
                       }
                       const ids = extractIdentifiers(declarator.id);
                       return ids.every(({ name: idName }) => allDeadNames.has(idName));
                   });

                   if (allDeclaratorsDead) {
                       targetNode = parentDecl;
                       processedParents.add(parentDecl);
                   } else {
                       targetNode = info.node;
                   }
               }

                const effectiveType = (info.writeCount > 0 && info.readCount === 0) ? 'WriteOnly' : info.type;
                const isImport = info.node && (
                    info.node.type === 'ImportSpecifier' ||
                    info.node.type === 'ImportDefaultSpecifier' ||
                    info.node.type === 'ImportNamespaceSpecifier' ||
                    (info.node.type === 'Identifier' && info.parentNode && (info.parentNode.type === 'ImportDeclaration' || info.parentNode.isImport))
                );

                const { confidence, status, reason } = classifyConfidence(effectiveType, { isImport });

                deadCode.push({
                    name,
                    type: effectiveType,
                    line: info.line,
                    node: targetNode,
                    confidence,
                    status,
                    reason
                });
           }
       });
    });

    // Phase 7: Duplicate Import Detection
    const importMap = new Map();
    for (const node of (ast.body || [])) {
        if (node.type === 'ImportDeclaration' && node.specifiers && node.source) {
            const modulePath = node.source.value;
            for (const spec of node.specifiers) {
                const localName = spec.local ? spec.local.name : null;
                if (!localName) continue;
                const key = `${modulePath}::${localName}`;
                if (importMap.has(key)) {
                    const { confidence, status, reason } = classifyConfidence('DuplicateImport');
                    deadCode.push({
                        name: `Duplicate import '${localName}' from '${modulePath}'`,
                        type: 'DuplicateImport',
                        line: spec.loc ? spec.loc.start.line : node.loc.start.line,
                        node: node,
                        confidence,
                        status,
                        reason
                    });
                } else {
                    importMap.set(key, true);
                }
            }
        }
    }

    // Phase 5: Pengecekan Undeclared Variables (no-undef)
    // globalScope menampung variabel yang direferensikan tetapi tidak ditemukan deklarasinya
    globalScope.undeclaredVariables.forEach(({ name, node }) => {
        // Ambil globals kustom milik pengguna dari ruleEngine
        const userGlobals = ruleEngine ? (ruleEngine._resolveConfigForFile(fileName).globals || []) : [];

        // Abaikan variabel bawaan JS, Node, Browser, custom globals, dan yang di-ignore ruleEngine
        if (BUILTIN_GLOBALS.has(name) || userGlobals.includes(name) || (ruleEngine && ruleEngine.isIgnoredVariable(name, fileName))) {
            return;
        }

        const { confidence, status } = classifyConfidence('UndeclaredVariable');
        deadCode.push({
            name,
            type: 'UndeclaredVariable',
            line: node ? node.loc.start.line : 0,
            node: node,
            confidence,
            status
        });
    });

    return deadCode;
}
