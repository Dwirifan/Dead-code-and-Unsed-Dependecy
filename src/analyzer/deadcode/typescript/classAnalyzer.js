import estraverse from 'estraverse';
import { visitorKeys as tsVisitorKeys } from '@typescript-eslint/visitor-keys';
import { shouldSkipTsNode } from './tsVisitor.js';

const visitorKeys = { ...estraverse.VisitorKeys, ...tsVisitorKeys };

function getStaticMemberName(member) {
    if (!member || member.type !== 'MemberExpression' || !member.property) return null;
    if (!member.computed && (member.property.type === 'Identifier' || member.property.type === 'PrivateIdentifier')) {
        return member.property.type === 'PrivateIdentifier' ? `#${member.property.name}` : member.property.name;
    }
    if (member.computed && member.property.type === 'Literal' && typeof member.property.value === 'string') {
        return member.property.value;
    }
    return null;
}

/**
 * Class Analyzer: Simple Type Inference Engine (Level 3 - Semantic Analysis)
 * 
 * Melacak instansiasi kelas dan pemanggilan method untuk mendeteksi 
 * method yang dideklarasikan tapi tidak pernah dipanggil.
 * 
 * Strategi:
 *   1. Kumpulkan semua ClassDeclaration/ClassExpression beserta method-nya
 *   2. Lacak `const x = new ClassName()` → catat { x → ClassName }
 *   3. Lacak `x.methodName()` → tandai methodName pada ClassName sebagai "used"
 *   4. Lacak `this.methodName()` di dalam class body → tandai sebagai "used"
 *   5. Laporkan method yang tidak pernah dipanggil
 * 
 * Keterbatasan (Documented):
 *   - Tidak melacak objek yang dikirim antar fungsi (parameter passing)
 *   - Tidak melacak reassignment (let x = new A(); x = new B())
 *   - Melacak pewarisan (inheritance) method dan status leaf class (Pilar 3)
 *   - Melacak modifier enkapsulasi (private, protected, public) dan dekorator
 * 
 * @module classAnalyzer
 */

/**
 * Menganalisis penggunaan method di dalam kelas.
 * @param {object} ast - AST dari file yang sedang dianalisis
 * @returns {Array} Daftar dead class methods { name, type, line, node, info }
 */
export function findUnusedClassMethods(ast, globalRegistry = null, publicApiClasses = new Set(), fileName = null, ruleEngine = null) {
    // Phase 1: Kumpulkan semua deklarasi kelas dan method-nya
    const classMap = new Map(); // className → { methods: Map, node, superClassName, isLeafClass }
    const instanceMap = new Map(); // variableName → className
    const classStack = [];

    estraverse.traverse(ast, {
        fallback: 'iteration',
        keys: visitorKeys,
        enter(node, parent) {
            if (shouldSkipTsNode(node)) {
                return estraverse.VisitorOption.Skip;
            }

            // --- Deteksi Deklarasi Kelas ---
            if (node.type === 'ClassDeclaration' && node.id) {
                const currentClassName = node.id.name;
                const superClassName = node.superClass && node.superClass.type === 'Identifier' ? node.superClass.name : null;
                if (!classMap.has(currentClassName)) {
                    classMap.set(currentClassName, { methods: new Map(), node, superClassName, isLeafClass: true, dynamicAccesses: [] });
                } else {
                    classMap.get(currentClassName).superClassName = superClassName;
                }
                classStack.push(currentClassName);
            }
            if (node.type === 'ClassExpression' && parent && parent.type === 'VariableDeclarator' && parent.id) {
                const currentClassName = parent.id.name;
                const superClassName = node.superClass && node.superClass.type === 'Identifier' ? node.superClass.name : null;
                if (!classMap.has(currentClassName)) {
                    classMap.set(currentClassName, { methods: new Map(), node, superClassName, isLeafClass: true, dynamicAccesses: [] });
                } else {
                    classMap.get(currentClassName).superClassName = superClassName;
                }
                classStack.push(currentClassName);
            }

            // --- Deteksi Method di dalam Class Body ---
            const currentClassName = classStack[classStack.length - 1] || null;
            if ((node.type === 'MethodDefinition' || node.type === 'TSAbstractMethodDefinition' || node.type === 'TSDeclareMethod') && currentClassName && classMap.has(currentClassName)) {
                const isDeclare = node.type === 'TSAbstractMethodDefinition' || node.type === 'TSDeclareMethod' || node.value?.type === 'TSEmptyBodyFunctionExpression';

                const rawName = node.key ? (node.key.type === 'Identifier' ? node.key.name : (node.key.type === 'PrivateIdentifier' ? `#${node.key.name}` : null)) : null;
                if (rawName && rawName !== 'constructor') {
                    const isPrivate = node.accessibility === 'private' || (node.key && node.key.type === 'PrivateIdentifier') || rawName.startsWith('#');
                    const isProtected = node.accessibility === 'protected';
                    const accessibility = isPrivate ? 'private' : (isProtected ? 'protected' : 'public');
                    const clsNode = classMap.get(currentClassName).node;
                    const hasDecorator = (node.decorators && node.decorators.length > 0) || (clsNode && clsNode.decorators && clsNode.decorators.length > 0);

                    classMap.get(currentClassName).methods.set(rawName, {
                        line: node.loc ? node.loc.start.line : 0,
                        node: node,
                        used: false,
                        accessibility,
                        isPrivate,
                        isProtected,
                        hasDecorator,
                        isDeclare
                    });
                }
            }

            // Dukungan PropertyDefinition (class field / arrow method / private field)
            if (node.type === 'PropertyDefinition' && currentClassName && classMap.has(currentClassName)) {
                const isDeclare = !!node.declare;

                const rawName = node.key ? (node.key.type === 'Identifier' ? node.key.name : (node.key.type === 'PrivateIdentifier' ? `#${node.key.name}` : null)) : null;
                
                // Filter asli user: Menangkap Arrow Function / Method
                const isMethodOrDeclare = isDeclare || (node.value && (node.value.type === 'ArrowFunctionExpression' || node.value.type === 'FunctionExpression'));
                
                // Safe guard validasi: Mengecek properti kelas biasa sebelum diabaikan
                const isRegularProperty = !isMethodOrDeclare && node.key && !node.computed;

                if (rawName && (isMethodOrDeclare || isRegularProperty)) {
                    const isPrivate = node.accessibility === 'private' || (node.key && node.key.type === 'PrivateIdentifier') || rawName.startsWith('#');
                    const isProtected = node.accessibility === 'protected';
                    const accessibility = isPrivate ? 'private' : (isProtected ? 'protected' : 'public');
                    const clsNode = classMap.get(currentClassName).node;
                    const hasDecorator = (node.decorators && node.decorators.length > 0) || (clsNode && clsNode.decorators && clsNode.decorators.length > 0);

                    classMap.get(currentClassName).methods.set(rawName, {
                        line: node.loc ? node.loc.start.line : 0,
                        node: node,
                        used: false,
                        accessibility,
                        isPrivate,
                        isProtected,
                        hasDecorator,
                        isDeclare,
                        isField: true
                    });
                }
            }
        },
        leave(node) {
            if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
                classStack.pop();
            }
        }
    });

    // Phase 2: Lacak instansiasi & pemanggilan method (termasuk inheritance)
    const insideClassStack = [];
    const thisAliases = new Set(); // Lacak 'const self = this;'

    function markMethodUsedInHierarchy(className, methodName) {
        let curr = className;
        while (curr && classMap.has(curr)) {
            const clsInfo = classMap.get(curr);
            if (clsInfo.methods.has(methodName)) {
                clsInfo.methods.get(methodName).used = true;
                return true;
            }
            if (methodName && !methodName.startsWith('#') && clsInfo.methods.has(`#${methodName}`)) {
                clsInfo.methods.get(`#${methodName}`).used = true;
                return true;
            }
            curr = clsInfo.superClassName;
        }
        return false;
    }

    estraverse.traverse(ast, {
        fallback: 'iteration',
        keys: visitorKeys,
        enter(node, parent) {
            if (shouldSkipTsNode(node)) {
                return estraverse.VisitorOption.Skip;
            }

            if ((node.type === 'ClassDeclaration' || node.type === 'ClassExpression')) {
                if (node.id) {
                    insideClassStack.push(node.id.name);
                } else if (parent && parent.type === 'VariableDeclarator' && parent.id) {
                    insideClassStack.push(parent.id.name);
                } else {
                    insideClassStack.push(null);
                }
            }

            // --- Deteksi Aliasing 'this' (contoh: const self = this) ---
            if (node.type === 'VariableDeclarator' && node.init && node.init.type === 'ThisExpression' && node.id && node.id.type === 'Identifier') {
                thisAliases.add(node.id.name);
            }
            if (node.type === 'AssignmentExpression' && node.operator === '=' && node.right && node.right.type === 'ThisExpression' && node.left && node.left.type === 'Identifier') {
                thisAliases.add(node.left.name);
            }

            // --- Deteksi Instansiasi: const x = new ClassName() atau x = new ClassName() ---
            if (node.type === 'VariableDeclarator' && node.init &&
                node.init.type === 'NewExpression' && node.init.callee &&
                node.init.callee.type === 'Identifier') {

                const className = node.init.callee.name;
                if (classMap.has(className)) {
                    if (node.id && node.id.type === 'Identifier') {
                        instanceMap.set(node.id.name, className);
                    } else if (node.id && node.id.type === 'ObjectPattern') {
                        // Destructuring: const { myMethod } = new ClassName()
                        for (const prop of node.id.properties) {
                            if (prop.key && prop.key.type === 'Identifier') {
                                markMethodUsedInHierarchy(className, prop.key.name);
                            }
                        }
                    }
                }
            }
            if (node.type === 'AssignmentExpression' && node.operator === '=' &&
                node.right && node.right.type === 'NewExpression' && node.right.callee &&
                node.right.callee.type === 'Identifier' && node.left && node.left.type === 'Identifier') {
                const varName = node.left.name;
                const className = node.right.callee.name;
                if (classMap.has(className)) {
                    instanceMap.set(varName, className);
                }
            }

            // --- Deteksi Destructuring dari 'this' atau instance ---
            if (node.type === 'VariableDeclarator' && node.id && node.id.type === 'ObjectPattern' && node.init) {
                let targetClass = null;
                const insideClassName = insideClassStack[insideClassStack.length - 1] || null;

                if (node.init.type === 'ThisExpression' || (node.init.type === 'Identifier' && thisAliases.has(node.init.name))) {
                    targetClass = insideClassName;
                } else if (node.init.type === 'Identifier' && instanceMap.has(node.init.name)) {
                    targetClass = instanceMap.get(node.init.name);
                }

                if (targetClass && classMap.has(targetClass)) {
                    for (const prop of node.id.properties) {
                        if (prop.key && prop.key.type === 'Identifier') {
                            markMethodUsedInHierarchy(targetClass, prop.key.name);
                        }
                    }
                }
            }

            // --- Deteksi Pemanggilan Method: x.methodName() atau (new ClassName()).methodName() ---
            const staticMemberName = getStaticMemberName(node);

            const isWrite = parent && parent.type === 'AssignmentExpression' && parent.left === node && parent.operator === '=';

            if (!isWrite && node.type === 'MemberExpression' && staticMemberName && node.object) {
                const methodName = staticMemberName;

                // 1. Pemanggilan via instance identifier (x.method)
                if (node.object.type === 'Identifier') {
                    const objName = node.object.name;
                    if (instanceMap.has(objName)) {
                        markMethodUsedInHierarchy(instanceMap.get(objName), methodName);
                    } else if (classMap.has(objName)) {
                        // Pemanggilan via static: ClassName.staticMethod()
                        markMethodUsedInHierarchy(objName, methodName);
                    }
                }
                // 2. Pemanggilan via Direct Instantiation: (new ClassName()).method()
                else if (node.object.type === 'NewExpression' && node.object.callee && node.object.callee.type === 'Identifier') {
                    const className = node.object.callee.name;
                    if (classMap.has(className)) {
                        markMethodUsedInHierarchy(className, methodName);
                    }
                }
            }

            // --- Deteksi this.methodName(), super.methodName(), atau self.methodName() ---
            const insideClassName = insideClassStack[insideClassStack.length - 1] || null;
            if (!isWrite && node.type === 'MemberExpression' && staticMemberName && node.object &&
                (node.object.type === 'ThisExpression' || node.object.type === 'Super' ||
                    (node.object.type === 'Identifier' && thisAliases.has(node.object.name))) &&
                node.property) {

                const methodName = staticMemberName;
                if (insideClassName && classMap.has(insideClassName)) {
                    markMethodUsedInHierarchy(insideClassName, methodName);
                }
            }

            // Nama computed yang tidak dapat ditentukan hanya memengaruhi kelas receiver.
            if (node.type === 'MemberExpression' && node.computed && !staticMemberName &&
                node.object && (node.object.type === 'ThisExpression' || node.object.type === 'Super' ||
                    (node.object.type === 'Identifier' && thisAliases.has(node.object.name))) &&
                insideClassName && classMap.has(insideClassName)) {
                classMap.get(insideClassName).dynamicAccesses.push({
                    line: node.loc ? node.loc.start.line : 0,
                    reason: 'computed member access'
                });
            }
        },
        leave(node) {
            if ((node.type === 'ClassDeclaration' || node.type === 'ClassExpression')) {
                insideClassStack.pop();
            }
        }
    });

    // Tandai kelas yang bukan leaf class (ada kelas lain yang mewarisinya)
    for (const clsInfo of classMap.values()) {
        if (clsInfo.superClassName && classMap.has(clsInfo.superClassName)) {
            classMap.get(clsInfo.superClassName).isLeafClass = false;
        }
    }

    // Phase 3: Kumpulkan method yang tidak pernah dipanggil
    const deadMethods = [];
    for (const [className, classInfo] of classMap.entries()) {
        for (const [methodName, methodInfo] of classInfo.methods.entries()) {
            // Mitigasi aman: jika method pernah dipanggil DI FILE MANAPUN, anggap dia hidup (used)
            // Nama method global tidak boleh membuktikan pemakaian method private:
            // pemanggilan foo.sameName() pada kelas lain sebelumnya menyebabkan false negative.
            const isUsedGlobally = !methodInfo.isPrivate && globalRegistry && globalRegistry.calledMethods && (
                globalRegistry.calledMethods.has(methodName) ||
                (methodName.startsWith('#') && globalRegistry.calledMethods.has(methodName.slice(1)))
            );

            // Cek Public API: Jika class di-export / reachable dan project ini me-preserve export
            const isPublicApi = publicApiClasses.has(className) && !methodInfo.isPrivate;
            let shouldPreserve = false;

            if (isPublicApi && ruleEngine && fileName) {
                const effectiveRules = (typeof ruleEngine.effectiveRulesFor === 'function' ? ruleEngine.effectiveRulesFor(fileName) :
                    (typeof ruleEngine._resolveConfigForFile === 'function' ? ruleEngine._resolveConfigForFile(fileName) :
                        (ruleEngine.rules || {})));
                if (effectiveRules && effectiveRules.preserveExports === true) {
                    shouldPreserve = true;
                }
            }

            if (!methodInfo.used && !isUsedGlobally && !shouldPreserve) {
                deadMethods.push({
                    name: `${className}.${methodName}`,
                    type: 'ClassMethod',
                    line: methodInfo.line,
                    node: methodInfo.node,
                    info: {
                        accessibility: methodInfo.accessibility,
                        isPrivate: methodInfo.isPrivate,
                        isProtected: methodInfo.isProtected,
                        isLeafClass: classInfo.isLeafClass,
                        hasDecorator: methodInfo.hasDecorator,
                        dynamicRisk: classInfo.dynamicAccesses.length > 0,
                        dynamicRiskScope: classInfo.dynamicAccesses.length > 0 ? `class ${className}` : null,
                        evidence: [
                            `${methodInfo.accessibility} method declaration found`,
                            'zero statically resolved references',
                            ...(classInfo.dynamicAccesses.length > 0 ? ['unresolved computed access exists in class'] : [])
                        ]
                    }
                });
            }
        }
    }

    return deadMethods;
}
