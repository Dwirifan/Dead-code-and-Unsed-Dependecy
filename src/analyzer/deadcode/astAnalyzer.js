import estraverse from 'estraverse';
import { visitorKeys as tsVisitorKeys } from '@typescript-eslint/visitor-keys';
import { analyze } from '@typescript-eslint/scope-manager';
import { shouldSkipTsNode } from './typescript/tsVisitor.js';
import { Scope } from './core/scope.js';
import { isReference } from './core/isReference.js';
import { extractIdentifiers } from './core/destructuringExtractor.js';
import { findFunctionScope } from './core/scopeHelpers.js';
import { markUsedExports } from './typescript/exportAnalyzer.js';
import { classifyConfidence } from './core/confidenceClassifier.js';
import { BUILTIN_GLOBALS } from './core/globals.js';
import { evaluateCatchParameter } from './safeguards/catchParameterGuard.js';
import { evaluateTypeDefinitionVariable } from './safeguards/typeDefinitionGuard.js';
import { evaluateArrayDestructuring } from './safeguards/arrayDestructuringGuard.js';
import { evaluateClassContract } from './safeguards/interfaceImplementationGuard.js';

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

function namespaceMatches(declarationNamespace, reference) {
    const isType = reference.isTypeReference === true;
    const isValue = reference.isValueReference !== false;

    if (declarationNamespace === 'both') return isType || isValue;
    if (declarationNamespace === 'type') return isType;
    return isValue;
}

function isReferenceInsideDeclaration(referenceNode, declarationNode) {
    if (!referenceNode || !declarationNode || !referenceNode.range || !declarationNode.range) return false;
    return referenceNode.range[0] >= declarationNode.range[0] && referenceNode.range[1] <= declarationNode.range[1];
}

function getWriteOperationNode(identifier, nodeParents) {
    const parent = nodeParents.get(identifier);
    if (!parent) return identifier;
    if (parent.type === 'AssignmentExpression' || parent.type === 'UpdateExpression') return parent;
    return identifier;
}

export function analyzeAstCode(ast, fileName = null, globalRegistry = null, ruleEngine = null) {
    const effectiveRules = ruleEngine
        ? (ruleEngine.effectiveRulesFor?.(fileName) || ruleEngine._resolveConfigForFile?.(fileName) || ruleEngine.rules || {})
        : {};
    const allScopes = [];
    const globalScope = new Scope();
    allScopes.push(globalScope);

    let currentScope = globalScope;
    let scopeStack = [globalScope];
    let scopeTypeStack = ['global'];
    const parentStack = [];
    const ownerStack = [];
    const declarationByBindingNode = new WeakMap();
    const nodeParents = new WeakMap();
    const parameterGroupByBindingNode = new WeakMap();
    const parameterGroupsByFunction = new WeakMap();

    let tsScopeManager = null;
    let scopeManagerError = null;
    let managerUndeclaredReferences = [];
    try {
        tsScopeManager = analyze(ast, {
            sourceType: ast.sourceType || 'module',
            jsxPragma: effectiveRules.reactRuntime === 'automatic' ? null : 'React',
            lib: ['esnext']
        });
    } catch (error) {
        scopeManagerError = error;
        if (globalRegistry) {
            if (!globalRegistry.analysisDiagnostics) globalRegistry.analysisDiagnostics = [];
            globalRegistry.analysisDiagnostics.push({
                file: fileName,
                backend: 'legacy-fallback',
                message: `Scope manager gagal: ${error.message}`
            });
        }
        if (process.env.DEBUG) {
            console.warn(`[DeadKiller] Scope manager gagal untuk ${fileName || '<memory>'}; memakai legacy fallback: ${error.message}`);
        }
    }
    const registerDeclaration = (scope, name, type, line, node, parentNode = null, metadata = {}) => {
        const info = scope.addDeclaration(name, type, line, node, parentNode, metadata);
        if (info?.bindingNode) declarationByBindingNode.set(info.bindingNode, info);
        return info;
    };

    // Phase 1: Murni memetakan Variable Scope & Referensi Variabel

    function handleLeave(node, parent) {
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

    estraverse.traverse(ast, {
        fallback: 'iteration',
        keys: visitorKeys,
        enter: function (node, parent) {
            if (parent) nodeParents.set(node, parent);
            parentStack.push(node);

            // Deteksi Pola Dinamis (Conservative Bailout: require(var), eval, with, computed member)
            if (globalRegistry && fileName) {
                if (!globalRegistry.unsafeFiles) globalRegistry.unsafeFiles = new Set();
                if ((node.type === 'CallExpression' && node.callee.name === 'eval') ||
                    (node.type === 'WithStatement') ||
                    (node.type === 'MemberExpression' && node.computed && node.property.type !== 'Literal') ||
                    (node.type === 'CallExpression' && node.callee.name === 'require' && node.arguments.length > 0 && node.arguments[0].type !== 'Literal' && node.arguments[0].type !== 'TemplateLiteral') ||
                    (node.type === 'ImportExpression' && node.source && node.source.type !== 'Literal' && (node.source.type !== 'TemplateLiteral' || node.source.expressions.length > 0))) {
                    globalRegistry.unsafeFiles.add(fileName);
                }
            }

            // Fuzzy Member Tracing: Kumpulkan semua nama properti non-computed yang pernah
            // diakses di seluruh proyek. Set ini digunakan di Phase 4 untuk mendeteksi
            // metode/properti kelas yang tidak pernah dipanggil di mana pun.
            if (node.type === 'MemberExpression' && !node.computed && node.property?.type === 'Identifier') {
                if (globalRegistry) {
                    if (!globalRegistry.allProjectMemberNames) globalRegistry.allProjectMemberNames = new Set();
                    globalRegistry.allProjectMemberNames.add(node.property.name);
                }
            }

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

                const isDeclare = !!(parent && parent.declare);
                identifiers.forEach(({ name, node: removalNode, bindingNode }) => {
                    const idNode = bindingNode || removalNode;
                    const targetDeletionNode = (node.id.type === 'Identifier') ? node : removalNode;
                    registerDeclaration(targetScope, name, 'Variable', node.loc.start.line, targetDeletionNode, parent, {
                        bindingNode: idNode,
                        namespace: 'value',
                        isDeclare
                    });
                });
            }

            if ((node.type === 'FunctionDeclaration' || node.type === 'TSDeclareFunction') && node.id) {
                if (currentScope.parent) {
                    const isDeclare = node.type === 'TSDeclareFunction' || !!node.declare;
                    registerDeclaration(currentScope.parent, node.id.name, 'Function', node.loc.start.line, node, null, {
                        bindingNode: node.id,
                        namespace: 'value',
                        isDeclare
                    });
                }
            }

            // Pendataan Deklarasi Class
            if (node.type === 'ClassDeclaration' && node.id) {
                if (currentScope.parent) {
                    const isDeclare = !!node.declare;
                    registerDeclaration(currentScope.parent, node.id.name, 'UnusedClass', node.loc.start.line, node, null, {
                        bindingNode: node.id,
                        namespace: 'both',
                        isDeclare
                    });
                }
            }

            // Fuzzy Member Tracing - Pendataan Metode & Properti Kelas:
            // Daftarkan setiap MethodDefinition dan PropertyDefinition sehingga
            // dapat dibandingkan dengan globalRegistry.allProjectMemberNames nanti.
            if ((node.type === 'MethodDefinition' || node.type === 'PropertyDefinition' || node.type === 'TSPropertySignature' || node.type === 'TSDeclareMethod' || node.type === 'TSAbstractMethodDefinition') &&
                node.key?.type === 'Identifier' &&
                node.kind !== 'constructor') {
                const ownerClass = parentStack.slice().reverse().find(n =>
                    n.type === 'ClassDeclaration' || n.type === 'ClassExpression'
                );
                const ownerName = ownerClass?.id?.name || '<anonymous>';
                const memberKey = `${ownerName}#${node.key.name}`;

                const isDeclare = !!node.declare || node.type === 'TSPropertySignature' || node.type === 'TSDeclareMethod' || node.type === 'TSAbstractMethodDefinition';

                registerDeclaration(currentScope, memberKey, 'UnusedClassMember', node.loc.start.line, node, null, {
                    bindingNode: node.key,
                    namespace: 'value',
                    memberName: node.key.name,
                    isStatic: node.static || false,
                    ownerClass: ownerName,
                    classNode: ownerClass,
                    isDeclare
                });
            }

            // Evaluasi Parameter Fungsi
            if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
                const parameterGroups = node.params.map((param, index) => ({
                    functionNode: node,
                    index,
                    parameterNode: param,
                    declarations: [],
                }));
                parameterGroupsByFunction.set(node, parameterGroups);

                node.params.forEach((param, index) => {
                    const isFakeThisContext = index === 0 && param.type === 'Identifier' && param.name === 'this';

                    const parameterGroup = parameterGroups[index];
                    const identifiers = extractIdentifiers(param);
                    identifiers.forEach(({ name, node: removalNode, bindingNode }) => {
                        const declaration = registerDeclaration(currentScope, name, 'Parameter', param.loc.start.line, removalNode, null, {
                            bindingNode: bindingNode || removalNode,
                            namespace: 'value',
                            isFakeThisContext
                        });
                        if (declaration?.bindingNode) {
                            parameterGroup.declarations.push(declaration);
                            parameterGroupByBindingNode.set(declaration.bindingNode, parameterGroup);
                        }
                    });
                });
            }

            // Evaluasi CatchClause (parameter error seperti catch(err))
            if (node.type === 'CatchClause' && node.param) {
                const identifiers = extractIdentifiers(node.param);
                identifiers.forEach(({ name, node: removalNode, bindingNode }) => {
                    registerDeclaration(currentScope, name, 'CatchParameter', node.loc.start.line, removalNode, null, {
                        bindingNode: bindingNode || removalNode,
                        namespace: 'value'
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
                        registerDeclaration(currentScope, spec.local.name, declarationType, spec.loc.start.line, spec.local, { isImport: true }, {
                            bindingNode: spec.local,
                            namespace: isSpecifierTypeImport ? 'type' : 'both'
                        });
                    }
                });
            }

            if (node.type === 'TSImportEqualsDeclaration' && node.id) {
                const isTypeImport = node.isTypeOnly || node.importKind === 'type';
                const declarationType = isTypeImport ? 'UnusedType' : 'Variable';
                registerDeclaration(currentScope, node.id.name, declarationType, node.loc ? node.loc.start.line : 0, node.id, { isImport: true }, {
                    bindingNode: node.id,
                    namespace: isTypeImport ? 'type' : 'both'
                });
            }

            // Pendataan TypeScript-only Deklarasi (Interface, Type Alias, Enum)
            if (node.type === 'TSInterfaceDeclaration' && node.id) {
                registerDeclaration(currentScope, node.id.name, 'UnusedType', node.loc.start.line, node, null, {
                    bindingNode: node.id,
                    namespace: 'type'
                });
            }
            if (node.type === 'TSTypeAliasDeclaration' && node.id) {
                registerDeclaration(currentScope, node.id.name, 'UnusedType', node.loc.start.line, node, null, {
                    bindingNode: node.id,
                    namespace: 'type'
                });
            }
            if (node.type === 'TSEnumDeclaration' && node.id) {
                registerDeclaration(currentScope, node.id.name, 'UnusedType', node.loc.start.line, node, null, {
                    bindingNode: node.id,
                    namespace: 'both'
                });
                const enumMembers = Array.isArray(node.body?.members)
                    ? node.body.members
                    : (Reflect.get(node, 'members') || []);
                if (enumMembers.length > 0) {
                    enumMembers.forEach(member => {
                        if (member.id && member.id.type === 'Identifier') {
                            const memberKey = `${node.id.name}.${member.id.name}`;
                            registerDeclaration(currentScope, memberKey, 'UnusedEnumMember', member.loc.start.line, member, null, {
                                bindingNode: member.id,
                                namespace: 'both',
                                ownerSymbol: node.id.name,
                                requiresSemanticProof: true,
                            });
                        }
                    });
                }
            }
            if (node.type === 'TSModuleDeclaration' && node.id) {
                registerDeclaration(currentScope, node.id.name, 'Variable', node.loc ? node.loc.start.line : 0, node, null, {
                    bindingNode: node.id,
                    namespace: 'both'
                });
            }
            if (node.type === 'TSDeclareFunction' && node.id) {
                registerDeclaration(currentScope, node.id.name, 'Function', node.loc ? node.loc.start.line : 0, node, null, {
                    bindingNode: node.id,
                    namespace: 'value'
                });
            }
            if (node.type === 'TSTypeParameter' && node.name && node.name.type === 'Identifier') {
                registerDeclaration(currentScope, node.name.name, 'UnusedType', node.loc.start.line, node, null, {
                    bindingNode: node.name,
                    namespace: 'type'
                });
            }

            // Melacak owner untuk Fixed-Point Iterative Elimination
            if (node.type === 'VariableDeclarator') {
                const identifiers = extractIdentifiers(node.id);
                
                const arrayPatternGroups = new Map();

                const declInfos = identifiers
                    .map(({ node: removalNode, bindingNode, isArrayDestructuring, arrayIndex, arrayLength, arrayPattern }) => {
                        const declInfo = declarationByBindingNode.get(bindingNode || removalNode);
                        if (declInfo && isArrayDestructuring) {
                             declInfo.isArrayDestructuring = true;
                             declInfo.arrayIndex = arrayIndex;
                             declInfo.arrayLength = arrayLength;
                             
                             if (!arrayPatternGroups.has(arrayPattern)) {
                                 arrayPatternGroups.set(arrayPattern, []);
                             }
                             arrayPatternGroups.get(arrayPattern).push(declInfo);
                        }
                        return declInfo;
                    })
                    .filter(Boolean);

                for (const siblings of arrayPatternGroups.values()) {
                    siblings.forEach(sibling => {
                        sibling.arraySiblings = siblings;
                    });
                }

                ownerStack.push(declInfos.length > 0 ? declInfos : null);
            }

            // Implicit JSX React Usage (Older React)
            // Di React < 17, JSX butuh import React from 'react' meskipun tidak dipanggil secara eksplisit.
            if (node.type === 'JSXElement' || node.type === 'JSXFragment') {
                const reactRuntime = effectiveRules.reactRuntime || 'classic';
                if (reactRuntime === 'classic') {
                    const currentOwners = ownerStack.length > 0 ? ownerStack[ownerStack.length - 1] : null;
                    currentScope.addReadReference('React', node, currentOwners);
                }
            }

            // Pelacakan Referensi Penggunaan
            if (node.type === 'Identifier' || node.type === 'JSXIdentifier') {
                const grandParent = parentStack.length >= 3 ? parentStack[parentStack.length - 3] : null;
                if (isReference(node, parent, grandParent, parentStack)) {
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
                        if (parent.type === 'MemberExpression' && parent.object === node && !parent.computed && parent.property.type === 'Identifier') {
                            const memberKey = `${node.name}.${parent.property.name}`;
                            currentScope.addReadReference(memberKey, parent.property, currentOwners);
                        }
                    }
                }
            }


            if (shouldSkipTsNode(node)) {
                handleLeave(node, parent);
                return estraverse.VisitorOption.Skip;
            }
        },
        leave: handleLeave
    });

    // Phase 2: Hubungkan Expor / Lintas Modul
    markUsedExports(ast, globalScope, fileName, globalRegistry, ruleEngine);

    // Phase 3: scope-manager menjadi sumber kebenaran untuk identitas binding.
    // Traversal custom tetap menyediakan metadata penghapusan, owner, enum member,
    // implicit React runtime, serta fixed-point cascading milik DeadKiller.
    if (tsScopeManager) {
        const referenceTargets = new WeakMap();
        const unresolvedSeen = new WeakSet();

        tsScopeManager.scopes.forEach(tsScope => {
            tsScope.variables.forEach(tsVar => {
                const declarations = tsVar.defs
                    .map(definition => declarationByBindingNode.get(definition.name))
                    .filter(Boolean);

                declarations.forEach(info => {
                    info.scopeManagerBacked = true;
                });

                tsVar.references.forEach(reference => {
                    const compatibleDeclarations = declarations.filter(info => namespaceMatches(info.namespace, reference));
                    const externalDeclarations = compatibleDeclarations.filter(info => (
                        !isReferenceInsideDeclaration(reference.identifier, info.node)
                    ));

                    // Simpan juga reference self/unmapped agar tidak jatuh ke name-walking legacy.
                    referenceTargets.set(reference.identifier, {
                        reference,
                        declarations: externalDeclarations
                    });

                    externalDeclarations.forEach(info => {
                        if (reference.isRead()) {
                            info.used = true;
                            info.readCount++;
                        }
                        // Initializer declaration (`const x = ...`) bukan write-only assignment.
                        if (reference.isWrite() && reference.init !== true) {
                            info.writeCount++;
                            info.writeNodes.push(getWriteOperationNode(reference.identifier, nodeParents));
                        }
                    });
                });
            });

            tsScope.through.forEach(reference => {
                if (reference.resolved || unresolvedSeen.has(reference.identifier)) return;
                unresolvedSeen.add(reference.identifier);
                managerUndeclaredReferences.push({
                    name: reference.identifier.name,
                    node: reference.identifier
                });
            });
        });

        // Hubungkan reference custom ke binding canonical untuk cascading analysis.
        allScopes.forEach(scope => {
            scope.readReferences.forEach(ref => {
                const target = referenceTargets.get(ref.node);
                if (target) {
                    ref.targetDecl = target.declarations[0] || null;
                } else if (ref.name.includes('.') || !['Identifier', 'JSXIdentifier'].includes(ref.node?.type)) {
                    // Reference sintetis DeadKiller (mis. E.Member dan classic React runtime).
                    scope.markRead(ref.name, ref.node, ref);
                }
            });

            scope.writeReferences.forEach(ref => {
                const target = referenceTargets.get(ref.node);
                if (target) ref.targetDecl = target.declarations[0] || null;
            });
        });
    } else {
        // Fallback bersifat file-wide supaya hasil dua resolver tidak tercampur.
        allScopes.forEach(s => s.resolve());
    }

    /**
     * Parameter yang tidak dibaca tetap wajib dipertahankan bila parameter pada
     * posisi sesudahnya digunakan. Menghapusnya akan menggeser argumen posisi,
     * misalnya `(match, p1, p2)` pada callback String.replace/replaceAll.
     *
     * Pemeriksaan dilakukan pada grup parameter, bukan sekadar nama binding,
     * agar destructuring yang sebagian masih digunakan tidak salah dilindungi.
     */
    const isRequiredPositionalParameter = info => {
        if (info?.type !== 'Parameter' || !info.bindingNode) return false;

        const parameterGroup = parameterGroupByBindingNode.get(info.bindingNode);
        if (!parameterGroup) return false;

        const currentGroupIsUnused = parameterGroup.declarations.every(declaration => (
            declaration.readCount === 0
        ));
        if (!currentGroupIsUnused) return false;

        const parameterGroups = parameterGroupsByFunction.get(parameterGroup.functionNode) || [];
        return parameterGroups.slice(parameterGroup.index + 1).some(laterGroup => (
            laterGroup.declarations.some(declaration => declaration.readCount > 0)
        ));
    };

    /**
     * Positional parameter memakai kebijakan laporan khusus. Secara default
     * anomali ini tetap dilaporkan meskipun namanya cocok dengan pola ignore
     * seperti `_`, karena prefix tidak menghilangkan risiko pergeseran argumen.
     */
    const shouldSuppressUnusedDeclaration = info => {
        if (isRequiredPositionalParameter(info)) {
            return effectiveRules.reportPositionalParameters === false;
        }

        const isIgnored = ruleEngine && ruleEngine.isIgnoredVariable(info.name, fileName);
        return Boolean(isIgnored && !is100PercentDeadIgnoredVariable(info));
    };

    const exportedLocals = globalRegistry?.fileExportedLocals?.get(fileName) || null;
    const projectGraphCompleteness = globalRegistry?.graphCompleteness || null;
    const graphCompleteness = globalRegistry?.fileGraphCompleteness?.get(fileName) ||
        projectGraphCompleteness;
    const isExportedDeclaration = info => Boolean(
        exportedLocals && (
            exportedLocals.has(info.name) ||
            (info.ownerSymbol && exportedLocals.has(info.ownerSymbol))
        )
    );

    // Phase 3.5: Fixed-Point Iterative Elimination (Cascading Dead Code Detection)
    // Melakukan konvergensi loop dalam memori untuk mendeteksi dead code berantai dalam 1 scan.
    const deadDeclarations = new Set();
    let newlyDead = [];

    allScopes.forEach(scope => {
        scope.declarations.forEach(info => {
            if (
                info.readCount === 0 &&
                info.type !== 'CatchParameter' &&
                !shouldSuppressUnusedDeclaration(info)
            ) {
                // Safeguard Interception: Jika RISKY, jangan picu efek domino (kematian berantai).
                const isVariable = info.type === 'Variable' || info.type === 'WriteOnly';
                let isRiskyType = false;
                if (isVariable) {
                    const typeGuard = evaluateTypeDefinitionVariable(info, fileName);
                    if (typeGuard.shouldBeRisky) isRiskyType = true;
                    else {
                        const arrayGuard = evaluateArrayDestructuring(info);
                        if (arrayGuard.shouldBeRisky) isRiskyType = true;
                    }
                }
                
                if (!isRiskyType) {
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
                        if (
                            ref.targetDecl.type !== 'CatchParameter' &&
                            !shouldSuppressUnusedDeclaration(ref.targetDecl) &&
                            !deadDeclarations.has(ref.targetDecl)
                        ) {
                            // Safeguard Interception di fase reaksi berantai
                            const isVariable = ref.targetDecl.type === 'Variable' || ref.targetDecl.type === 'WriteOnly';
                            let isRiskyType = false;
                            if (isVariable) {
                                const typeGuard = evaluateTypeDefinitionVariable(ref.targetDecl, fileName);
                                if (typeGuard.shouldBeRisky) isRiskyType = true;
                                else {
                                    const arrayGuard = evaluateArrayDestructuring(ref.targetDecl);
                                    if (arrayGuard.shouldBeRisky) isRiskyType = true;
                                }
                            }
                            
                            if (!isRiskyType) {
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
    const deadBindingNodes = new Set();

    allScopes.forEach(scope => {
        scope.declarations.forEach(info => {
            if (
                !info.used &&
                info.type !== 'CatchParameter' &&
                !shouldSuppressUnusedDeclaration(info)
            ) {
                deadBindingNodes.add(info.bindingNode);
            }
        });
    });

    allScopes.forEach(scope => {
        scope.declarations.forEach(info => {
            const name = info.name;
            if (!info.used) {
                if (info.type === 'CatchParameter') {
                    const guardResult = evaluateCatchParameter(info, globalRegistry, ruleEngine);
                    if (guardResult.isCodeSmell) {
                        
deadCode.push({
                            name: info.name,
                            type: guardResult.codeSmellType,
                            line: info.line,
                            node: info.bindingNode || info.node,
                            confidence: 100,
                            status: 'review',
                            reason: guardResult.codeSmellMessage
                        });
                    }

                    if (guardResult.isValidLegacy) {
                        return; // Konvensi `_` terpenuhi pada Node < 12. Silently ignore.
                    }

                    if (guardResult.canBeDeleted) {
                        // Buka proteksi agar bisa dihapus (Auto-Fix)
                        // Lanjut ke bawah sebagai SAFE
                    } else if (guardResult.shouldBeRisky) {
                        // Jika tidak aman dihapus, laporkan sebagai RISKY
                        let targetNode = info.node;
                        let endLine = targetNode.loc ? targetNode.loc.end.line : info.line;
                        deadCode.push({
                            name: info.name,
                            type: 'CatchParameter',
                            line: info.line,
                            endLine: endLine,
                            node: targetNode,
                            confidence: 50,
                            status: 'risky',
                            reason: guardResult.riskyMessage
                        });
                        return; // Selesai untuk CatchParameter yang berisiko dihapus
                    } else {
                        return;
                    }
                }

                if (info.isDeclare || info.isFakeThisContext) return; // Abaikan sepenuhnya elemen khusus TypeScript agar output CLI lebih bersih
                if (info.type !== 'CatchParameter' && shouldSuppressUnusedDeclaration(info)) return;

                let targetNode = info.node;

                if (info.type === 'Variable' && info.parentNode && info.parentNode.type === 'VariableDeclaration') {
                    const parentDecl = info.parentNode;

                    if (processedParents.has(parentDecl)) return;

                    const allDeclaratorsDead = parentDecl.declarations.every(declarator => {
                        if (declarator.id && declarator.id.type === 'Identifier') {
                            return deadBindingNodes.has(declarator.id);
                        }
                        const ids = extractIdentifiers(declarator.id);
                        return ids.every(({ node: removalNode, bindingNode }) => deadBindingNodes.has(bindingNode || removalNode));
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

                let isImpureWrite = false;
                let isImpureInitializer = false;
                if (
                    effectiveType === 'Variable' &&
                    info.node &&
                    info.node.type === 'VariableDeclarator' &&
                    info.node.init &&
                    !isPureExpression(info.node.init)
                ) {
                    isImpureInitializer = true;
                }
                if (effectiveType === 'WriteOnly') {
                    // Evaluasi inisialisasi: let x = db.save()
                    if (info.node && info.node.type === 'VariableDeclarator' && info.node.init && !isPureExpression(info.node.init)) {
                        isImpureWrite = true;
                    }
                    // Evaluasi setiap assignment: x = db.save() atau x++
                    if (!isImpureWrite && info.writeNodes && info.writeNodes.length > 0) {
                        for (const wn of info.writeNodes) {
                            if (!wn) continue;
                            if (wn.type === 'AssignmentExpression' && !isPureExpression(wn.right)) {
                                isImpureWrite = true;
                                break;
                            }
                            if (wn.type === 'UpdateExpression' || wn.type === 'CallExpression') {
                                isImpureWrite = true;
                                break;
                            }
                        }
                    }
                }

                const positional = isRequiredPositionalParameter(info);
                const exported = isExportedDeclaration(info);
                const exportedEnumMemberWithoutSemanticProof = Boolean(
                    exported && info.type === 'UnusedEnumMember' && info.requiresSemanticProof
                );
                let { confidence, status, reason } = classifyConfidence(effectiveType, {
                    name,
                    isImport,
                    isImpureInitializer,
                    isImpureWrite,
                    isPositional: positional,
                    isDeclare: info.isDeclare,
                    isFakeThisContext: info.isFakeThisContext
                });

                let originalStatus = null;

                if (effectiveType === 'Variable' || effectiveType === 'WriteOnly') {
                    const typeGuard = evaluateTypeDefinitionVariable(info, fileName);
                    if (typeGuard.shouldBeRisky) {
                        originalStatus = status;
                        status = 'risky';
                        confidence = 90;
                        reason = typeGuard.reason || 'Variabel memiliki anotasi tipe pada pengujian/deklarasi TypeScript. Menghapusnya berisiko merusak mekanisme test compiler.';
                    } else {
                        const arrayGuard = evaluateArrayDestructuring(info);
                        if (arrayGuard.shouldBeRisky) {
                            originalStatus = status;
                            status = 'risky';
                            confidence = 90;
                            reason = arrayGuard.reason;
                        }
                    }
                }

                let uncertainty = null;

                if (scopeManagerError && status === 'safe') {
                    originalStatus = status;
                    confidence = 'medium';
                    status = 'review';
                    uncertainty = 'local-scope-incomplete';
                    reason = `${reason} Scope manager tidak tersedia untuk file ini; hasil legacy fallback wajib ditinjau.`;
                }

                if (exported && graphCompleteness?.complete === false && status === 'safe') {
                    originalStatus ||= status;
                    confidence = 'medium';
                    status = 'review';
                    uncertainty = 'module-graph-incomplete';
                    reason = `${reason} Export tidak boleh dihapus otomatis karena graph modul berstatus ${graphCompleteness.status}; ${graphCompleteness.reasons.join('; ')}.`;
                }

                if (exportedEnumMemberWithoutSemanticProof && status === 'safe') {
                    originalStatus ||= status;
                    confidence = 'medium';
                    status = 'review';
                    uncertainty = 'cross-file-enum-member-unproven';
                    reason = `${reason} Enum diekspor dan penggunaan member lintas file belum dapat dibuktikan lengkap tanpa analisis simbol semantik.`;
                }

                const proof = {
                    localUsageComplete: !scopeManagerError,
                    crossFileRequired: exported,
                    moduleGraphStatus: graphCompleteness?.status || 'not-applicable',
                    moduleGraphComponentId: graphCompleteness?.id ?? null,
                    projectGraphStatus: projectGraphCompleteness?.status || 'not-applicable',
                    moduleResolutionComplete: exported
                        ? (graphCompleteness?.complete ?? null)
                        : null,
                    semanticReferenceComplete: exportedEnumMemberWithoutSemanticProof
                        ? false
                        : null,
                };
                // Fuzzy Member Tracing - Phase 4 Evaluasi:
                if (info.type === 'UnusedClassMember') {
                    const memberName = info.memberName || name.split('#')[1];
                    const projectMemberNames = globalRegistry?.allProjectMemberNames;
                    if (projectMemberNames && memberName) {
                        if (!projectMemberNames.has(memberName)) {
                            // Nama ini TIDAK pernah dipanggil di seluruh proyek -> 100% mati
                            confidence = 'high';
                            status = 'safe';
                            reason = `Metode/properti '${memberName}' tidak ditemukan di seluruh basis kode proyek (Fuzzy Member Tracing).`;

                            const contractGuard = evaluateClassContract(info.node, info.classNode);
                            if (contractGuard.shouldBeRisky) {
                                originalStatus = status;
                                status = 'risky';
                                confidence = 90;
                                reason = contractGuard.reason;
                            }
                        } else {
                            // Nama ada di proyek, tapi bisa dari kelas lain -> tidak bisa memastikan.
                            // Prinsip Fail-Closed: Daripada memunculkan False Positive yang masif,
                            // kita asumsikan metode ini terpakai dan tidak kita laporkan.
                            return;
                        }
                    } else if (info.type !== 'CatchParameter') {
                        // Tidak ada registry atau globalMemberNames belum siap -> Fallback Fail-Closed
                        return;
                    }
                }

                deadCode.push({
                    name,
                    type: effectiveType,
                    line: info.line,
                    node: targetNode,
                    relatedNodes: effectiveType === 'WriteOnly' ? [...(info.writeNodes || [])] : [],
                    confidence,
                    status,
                    reason,
                    positional,
                    exported,
                    proof,
                    ...(originalStatus ? { originalStatus } : {}),
                    ...(uncertainty ? { uncertainty } : {}),
                    ...(info.type === 'UnusedClassMember' ? {
                        memberName: info.memberName,
                        ownerClass: info.ownerClass,
                        isStatic: info.isStatic,
                    } : {}),
                    analysisBackend: tsScopeManager ? 'scope-manager' : 'legacy-fallback'
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

    // Phase 5: Pengecekan Undeclared Variables (no-undef).
    // Dalam mode utama, hanya unresolved reference dari scope-manager yang dipakai.
    // Keyword/syntax marker ESM seperti `default` tidak pernah menjadi reference,
    // sehingga tidak memerlukan blanket suppression berdasarkan nama.
    const undeclaredReferences = tsScopeManager
        ? managerUndeclaredReferences
        : globalScope.undeclaredVariables;
    const reportedUndeclaredNodes = new WeakSet();

    undeclaredReferences.forEach(({ name, node }) => {
        if (node && reportedUndeclaredNodes.has(node)) return;
        if (node) reportedUndeclaredNodes.add(node);

        // Ambil globals kustom milik pengguna dari ruleEngine
        const userGlobals = effectiveRules.globals || [];

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
            status,
            analysisBackend: tsScopeManager ? 'scope-manager' : 'legacy-fallback'
        });
    });

    return deadCode;
}
