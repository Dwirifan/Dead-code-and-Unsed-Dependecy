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
 *   - Tidak melacak pewarisan (inheritance) method dari parent class
 * 
 * @module classAnalyzer
 */

/**
 * Menganalisis penggunaan method di dalam kelas.
 * @param {object} ast - AST dari file yang sedang dianalisis
 * @returns {Array} Daftar dead class methods { name, type, line, node }
 */
export function findUnusedClassMethods(ast, globalRegistry = null) {
    // Phase 1: Kumpulkan semua deklarasi kelas dan method-nya
    const classMap = new Map(); // className → { methods: Map<methodName, { line, node, used }> }
    const instanceMap = new Map(); // variableName → className
    const calledMethods = new Map(); // className → Set<methodName>
    let currentClassName = null;

    estraverse.traverse(ast, {
        fallback: 'iteration',
        enter(node, parent) {
            // --- Deteksi Deklarasi Kelas ---
            if (node.type === 'ClassDeclaration' && node.id) {
                currentClassName = node.id.name;
                if (!classMap.has(currentClassName)) {
                    classMap.set(currentClassName, { methods: new Map(), node });
                }
            }
            if (node.type === 'ClassExpression' && parent && parent.type === 'VariableDeclarator' && parent.id) {
                currentClassName = parent.id.name;
                if (!classMap.has(currentClassName)) {
                    classMap.set(currentClassName, { methods: new Map(), node });
                }
            }

            // --- Deteksi Method di dalam Class Body ---
            if (node.type === 'MethodDefinition' && currentClassName && classMap.has(currentClassName)) {
                const methodName = node.key && node.key.type === 'Identifier' ? node.key.name : null;
                if (methodName && methodName !== 'constructor') {
                    // Hanya lacak method non-constructor (constructor selalu dipanggil via `new`)
                    classMap.get(currentClassName).methods.set(methodName, {
                        line: node.loc ? node.loc.start.line : 0,
                        node: node,
                        used: false
                    });
                }
            }

            // Dukungan PropertyDefinition (class field / arrow method)
            // class Foo { bar = () => {} }
            if (node.type === 'PropertyDefinition' && currentClassName && classMap.has(currentClassName)) {
                const fieldName = node.key && node.key.type === 'Identifier' ? node.key.name : null;
                if (fieldName && node.value && 
                    (node.value.type === 'ArrowFunctionExpression' || node.value.type === 'FunctionExpression')) {
                    classMap.get(currentClassName).methods.set(fieldName, {
                        line: node.loc ? node.loc.start.line : 0,
                        node: node,
                        used: false
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

    // Phase 2: Lacak instansiasi & pemanggilan method
    let insideClassName = null;

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
                node.property && node.property.type === 'Identifier') {

                const objName = node.object.name;
                const methodName = node.property.name;

                // Pemanggilan via instance: svc.fetchData()
                if (instanceMap.has(objName)) {
                    const className = instanceMap.get(objName);
                    if (classMap.has(className) && classMap.get(className).methods.has(methodName)) {
                        classMap.get(className).methods.get(methodName).used = true;
                    }
                }

                // Pemanggilan via static: ClassName.staticMethod()
                if (classMap.has(objName) && classMap.get(objName).methods.has(methodName)) {
                    classMap.get(objName).methods.get(methodName).used = true;
                }
            }

            // --- Deteksi this.methodName() di dalam class body ---
            if (node.type === 'MemberExpression' && !node.computed &&
                node.object && node.object.type === 'ThisExpression' &&
                node.property && node.property.type === 'Identifier') {

                const methodName = node.property.name;
                if (insideClassName && classMap.has(insideClassName) &&
                    classMap.get(insideClassName).methods.has(methodName)) {
                    classMap.get(insideClassName).methods.get(methodName).used = true;
                }
            }
        },
        leave(node) {
            if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
                insideClassName = null;
            }
        }
    });

    // Phase 3: Kumpulkan method yang tidak pernah dipanggil
    const deadMethods = [];
    for (const [className, classInfo] of classMap.entries()) {
        for (const [methodName, methodInfo] of classInfo.methods.entries()) {
            // Mitigasi aman: jika method pernah dipanggil DI FILE MANAPUN, anggap dia hidup (used)
            const isUsedGlobally = globalRegistry && globalRegistry.calledMethods && globalRegistry.calledMethods.has(methodName);
            
            if (!methodInfo.used && !isUsedGlobally) {
                deadMethods.push({
                    name: `${className}.${methodName}`,
                    type: 'ClassMethod',
                    line: methodInfo.line,
                    node: methodInfo.node
                });
            }
        }
    }

    return deadMethods;
}
