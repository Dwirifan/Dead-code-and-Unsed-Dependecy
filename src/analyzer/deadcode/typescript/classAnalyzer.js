import estraverse from 'estraverse';

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
export function findUnusedClassMethods(ast, globalRegistry = null) {
    // Phase 1: Kumpulkan semua deklarasi kelas dan method-nya
    const classMap = new Map(); // className → { methods: Map, node, superClassName, isLeafClass }
    const instanceMap = new Map(); // variableName → className
    let currentClassName = null;

    estraverse.traverse(ast, {
        fallback: 'iteration',
        enter(node, parent) {
            // --- Deteksi Deklarasi Kelas ---
            if (node.type === 'ClassDeclaration' && node.id) {
                currentClassName = node.id.name;
                const superClassName = node.superClass && node.superClass.type === 'Identifier' ? node.superClass.name : null;
                if (!classMap.has(currentClassName)) {
                    classMap.set(currentClassName, { methods: new Map(), node, superClassName, isLeafClass: true });
                } else {
                    classMap.get(currentClassName).superClassName = superClassName;
                }
            }
            if (node.type === 'ClassExpression' && parent && parent.type === 'VariableDeclarator' && parent.id) {
                currentClassName = parent.id.name;
                const superClassName = node.superClass && node.superClass.type === 'Identifier' ? node.superClass.name : null;
                if (!classMap.has(currentClassName)) {
                    classMap.set(currentClassName, { methods: new Map(), node, superClassName, isLeafClass: true });
                } else {
                    classMap.get(currentClassName).superClassName = superClassName;
                }
            }

            // --- Deteksi Method di dalam Class Body ---
            if (node.type === 'MethodDefinition' && currentClassName && classMap.has(currentClassName)) {
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
                        hasDecorator
                    });
                }
            }

            // Dukungan PropertyDefinition (class field / arrow method / private field)
            if (node.type === 'PropertyDefinition' && currentClassName && classMap.has(currentClassName)) {
                const rawName = node.key ? (node.key.type === 'Identifier' ? node.key.name : (node.key.type === 'PrivateIdentifier' ? `#${node.key.name}` : null)) : null;
                if (rawName && node.value &&
                    (node.value.type === 'ArrowFunctionExpression' || node.value.type === 'FunctionExpression')) {
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
                        hasDecorator
                    });
                }
            }
        },
        leave(node) {
            if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
                currentClassName = null;
            }
        }
    });

    // Phase 2: Lacak instansiasi & pemanggilan method (termasuk inheritance)
    let insideClassName = null;

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
        enter(node, parent) {
            // Track saat kita masuk ke body class (untuk mendeteksi this.method())
            if ((node.type === 'ClassDeclaration' || node.type === 'ClassExpression')) {
                if (node.id) {
                    insideClassName = node.id.name;
                } else if (parent && parent.type === 'VariableDeclarator' && parent.id) {
                    insideClassName = parent.id.name;
                }
            }

            // --- Deteksi Instansiasi: const x = new ClassName() ---
            if (node.type === 'VariableDeclarator' && node.init &&
                node.init.type === 'NewExpression' && node.init.callee &&
                node.init.callee.type === 'Identifier' && node.id && node.id.type === 'Identifier') {
                const varName = node.id.name;
                const className = node.init.callee.name;
                if (classMap.has(className)) {
                    instanceMap.set(varName, className);
                }
            }

            // --- Deteksi Pemanggilan Method: x.methodName() atau x.methodName ---
            if (node.type === 'MemberExpression' && !node.computed &&
                node.object && node.object.type === 'Identifier' &&
                node.property && (node.property.type === 'Identifier' || node.property.type === 'PrivateIdentifier')) {

                const objName = node.object.name;
                const methodName = node.property.type === 'PrivateIdentifier' ? `#${node.property.name}` : node.property.name;

                // Pemanggilan via instance: svc.fetchData()
                if (instanceMap.has(objName)) {
                    const className = instanceMap.get(objName);
                    markMethodUsedInHierarchy(className, methodName);
                }

                // Pemanggilan via static: ClassName.staticMethod()
                if (classMap.has(objName)) {
                    markMethodUsedInHierarchy(objName, methodName);
                }
            }

            // --- Deteksi this.methodName() atau super.methodName() di dalam class body ---
            if (node.type === 'MemberExpression' && !node.computed &&
                node.object && (node.object.type === 'ThisExpression' || node.object.type === 'Super') &&
                node.property && (node.property.type === 'Identifier' || node.property.type === 'PrivateIdentifier')) {

                const methodName = node.property.type === 'PrivateIdentifier' ? `#${node.property.name}` : node.property.name;
                if (insideClassName && classMap.has(insideClassName)) {
                    markMethodUsedInHierarchy(insideClassName, methodName);
                }
            }
        },
        leave(node, parent) {
            if ((node.type === 'ClassDeclaration' || node.type === 'ClassExpression')) {
                if (node.id && node.id.name === insideClassName) {
                    insideClassName = null;
                } else if (parent && parent.type === 'VariableDeclarator' && parent.id && parent.id.name === insideClassName) {
                    insideClassName = null;
                }
            }
        }
    });

    // Tandai kelas yang bukan leaf class (ada kelas lain yang mewarisinya)
    for (const [clsName, clsInfo] of classMap.entries()) {
        if (clsInfo.superClassName && classMap.has(clsInfo.superClassName)) {
            classMap.get(clsInfo.superClassName).isLeafClass = false;
        }
    }

    // Phase 3: Kumpulkan method yang tidak pernah dipanggil
    const deadMethods = [];
    for (const [className, classInfo] of classMap.entries()) {
        for (const [methodName, methodInfo] of classInfo.methods.entries()) {
            // Mitigasi aman: jika method pernah dipanggil DI FILE MANAPUN, anggap dia hidup (used)
            const isUsedGlobally = globalRegistry && globalRegistry.calledMethods && (
                globalRegistry.calledMethods.has(methodName) ||
                (methodName.startsWith('#') && globalRegistry.calledMethods.has(methodName.slice(1)))
            );

            if (!methodInfo.used && !isUsedGlobally) {
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
                        hasDecorator: methodInfo.hasDecorator
                    }
                });
            }
        }
    }

    return deadMethods;
}
