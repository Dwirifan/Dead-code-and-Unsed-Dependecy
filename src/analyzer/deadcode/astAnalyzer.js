import estraverse from 'estraverse';
import { visitorKeys as tsVisitorKeys } from '@typescript-eslint/visitor-keys';
import { Scope } from './core/scope.js';
import { isReference } from './core/isReference.js';
import { extractIdentifiers } from './core/destructuringExtractor.js';
import { findFunctionScope } from './core/scopeHelpers.js';
import { markUsedExports } from './typescript/exportAnalyzer.js';
import { classifyConfidence } from './core/confidenceClassifier.js';

// Gabungkan Visitor Keys ESTree standar dengan ekstrasi TypeScript/JSX
const visitorKeys = { ...estraverse.VisitorKeys, ...tsVisitorKeys };

export function analyzeAstCode(ast, fileName = null, globalRegistry = null, ruleEngine = null) {
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
                
                identifiers.forEach(({ name }) => {
                    targetScope.addDeclaration(name, 'Variable', node.loc.start.line, node, parent);
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
                currentScope.addDeclaration(node.id.name, 'Variable', node.loc.start.line, node);
            }
            if (node.type === 'TSTypeParameter' && node.name && node.name.type === 'Identifier') {
                currentScope.addDeclaration(node.name.name, 'UnusedType', node.loc.start.line, node);
            }

            // Pelacakan Referensi Penggunaan
            if (node.type === 'Identifier' || node.type === 'JSXIdentifier') {
                const grandParent = parentStack.length >= 3 ? parentStack[parentStack.length - 3] : null;
                if (isReference(node, parent, grandParent)) {
                    const isWriteContext = (
                        (parent.type === 'AssignmentExpression' && parent.left === node && parent.operator === '=')
                    );

                    const isCompoundWrite = (
                        (parent.type === 'AssignmentExpression' && parent.left === node && parent.operator !== '=') ||
                        (parent.type === 'UpdateExpression')
                    );

                    if (isCompoundWrite) {
                        currentScope.addReadReference(node.name);
                        currentScope.addWriteReference(node.name);
                    } else if (isWriteContext) {
                        currentScope.addWriteReference(node.name);
                    } else {
                        currentScope.addReadReference(node.name);
                        
                        // FITUR 6 & 7: Deteksi properti pada Namespace / Enum
                        if (parent.type === 'MemberExpression' && parent.object === node && !parent.computed && parent.property.type === 'Identifier') {
                            const memberKey = `${node.name}.${parent.property.name}`;
                            currentScope.addReadReference(memberKey);
                        }
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

    // Phase 4: Pengumpulan Dead Variables
    const deadCode = [];
    const processedParents = new Set();
    const allDeadNames = new Set();

    allScopes.forEach(scope => {
        scope.declarations.forEach((info, name) => {
            if (!info.used && !(ruleEngine && ruleEngine.isIgnoredVariable(name, fileName))) {
                allDeadNames.add(name);
            }
        });
    });

    allScopes.forEach(scope => {
       scope.declarations.forEach((info, name) => {
           if (!info.used) {
               if (ruleEngine && ruleEngine.isIgnoredVariable(name, fileName)) return;

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

    return deadCode;
}
