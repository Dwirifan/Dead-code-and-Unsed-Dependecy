import estraverse from 'estraverse';

class Scope {
    constructor(parent = null) {
        this.parent = parent;
        this.declarations = new Map(); // name -> { type, line, node, used: false }
        this.references = []; // names of referenced variables
    }

    addDeclaration(name, type, line, node) {
        // Only add if not already declared in this scope (handle var vs let/const redundancy if needed, but simple map is ok)
        if (!this.declarations.has(name)) {
            this.declarations.set(name, { type, line, node, used: false });
        }
    }

    addReference(name) {
        this.references.push(name);
    }

    resolve() {
        // Resolve references in this scope against declarations in this scope or parents
        for (const refName of this.references) {
            this.markUsed(refName);
        }
    }

    markUsed(name) {
        if (this.declarations.has(name)) {
            const decl = this.declarations.get(name);
            decl.used = true;
        } else if (this.parent) {
            this.parent.markUsed(name);
        }
    }
}

export function analyzeDeadCode(ast) {
    const globalScope = new Scope();
    let currentScope = globalScope;
    const scopeStack = [globalScope];

    // PASS 1: Scope Building & Usage Collection
    estraverse.traverse(ast, {
        enter: function (node, parent) {
            // Enter new scope
            // FunctionDeclaration, FunctionExpression, ArrowFunctionExpression -> Function Scope
            // BlockStatement -> Block Scope (let/const) - Simplified: Treating Blocks as scopes for all specific logic
            // Program -> Global Scope (already set)
            if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'BlockStatement'].includes(node.type)) {
                const newScope = new Scope(currentScope);
                scopeStack.push(newScope);
                currentScope = newScope;
            }

            // Handle Declarations
            if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
                const kind = parent.kind; // var, let, const
                // Note: 'var' ignores block scope, technically should go to nearest function scope. 
                // For simplicity in this acadmic prototype, we check strict block scoping or assume 'let/const' mostly.
                // Improvement: If 'var', walk up scopeStack to find function scope.
                
                let targetScope = currentScope;
                if (kind === 'var') {
                    // Walk up to find function or global
                     // (Simplified logic: just use current for now, or real implementation needs proper scope types)
                }
                
                targetScope.addDeclaration(node.id.name, 'Variable', node.loc.start.line, node);
            }
            
            if (node.type === 'FunctionDeclaration' && node.id) {
                // Function name is declared in the PARENT scope (unlike params which are inner)
                // BUT currentScope has already switched to the function's body scope above?
                // Wait, estraverse 'enter' for function happens BEFORE body. 
                // So when we hit FunctionDeclaration, we are technically IN the parent scope regarding the function name itself.
                // However, we pushed a new scope immediately above.
                // Let's adjust: The name belongs to `currentScope.parent` (which was the scope before we pushed).
                if (currentScope.parent) {
                    currentScope.parent.addDeclaration(node.id.name, 'Function', node.loc.start.line, node);
                } else {
                    // Should be global if no parent, but we pushed for FuncDecl.
                }
            }

            // Params (Argument declarations)
            if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
                node.params.forEach(param => {
                    if (param.type === 'Identifier') {
                        currentScope.addDeclaration(param.name, 'Parameter', param.loc.start.line, param);
                    }
                });
            }
            
            // Handle References (Identifiers that are NOT declarations)
            // We need to check if Identifier is being used as a value.
            if (node.type === 'Identifier') {
                if (isReference(node, parent)) {
                    currentScope.addReference(node.name);
                }
            }
        },
        leave: function (node) {
            if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'BlockStatement'].includes(node.type)) {
                scopeStack.pop();
                currentScope = scopeStack[scopeStack.length - 1];
            }
        }
    });

    // Handle Exports (Prevent marking as dead)
    // 1. CommonJS: module.exports = ...
    // 2. ESM: export default ... / export const ...
    estraverse.traverse(ast, {
        enter: function(node) {
             if (node.type === 'ExportNamedDeclaration' && node.declaration) {
                 // export const x = 1;
                 // Mark declarations inside as used.
                 if (node.declaration.type === 'VariableDeclaration') {
                     node.declaration.declarations.forEach(decl => {
                         if (decl.id.type === 'Identifier') globalScope.markUsed(decl.id.name);
                     });
                 }
                 if (node.declaration.type === 'FunctionDeclaration') {
                     globalScope.markUsed(node.declaration.id.name);
                 }
             }
             if (node.type === 'ExportDefaultDeclaration') {
                 // export default x;
                 if (node.declaration.type === 'Identifier') {
                     globalScope.markUsed(node.declaration.name);
                 }
             }
        }
    });


    // PASS 2: Resolve References
    // We create a list of all scopes created (we need to track them differently if we popped them)
    // Actually, simple way: We should have stored ALL scopes in a flat list or tree to traverse for resolution.
    // The previous traversal popped them, so they are gone from `currentScope`. 
    // Let's refactor: Gather a list of scopes.
    // Or better: Resolve immediately? No, because hoisting.
    // FIX: Store all scopes in a flat array `allScopes` during creation.
}

// Rewriting logic with 'allScopes'
function analyzeDeadCodeRevised(ast) {
    const allScopes = [];
    const globalScope = new Scope();
    allScopes.push(globalScope);
    
    let currentScope = globalScope;
    let scopeStack = [globalScope];

    estraverse.traverse(ast, {
        enter: function (node, parent) {
            // Scope Creation
            if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'BlockStatement'].includes(node.type)) {
                const newScope = new Scope(currentScope);
                allScopes.push(newScope);
                currentScope = newScope;
                scopeStack.push(newScope);
            }

            // Declarations
            if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier') {
                currentScope.addDeclaration(node.id.name, 'Variable', node.loc.start.line, node);
            }
            if (node.type === 'FunctionDeclaration' && node.id) {
                // Name belongs to PARENT scope
                if (currentScope.parent) {
                    currentScope.parent.addDeclaration(node.id.name, 'Function', node.loc.start.line, node);
                }
            }
            if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
                node.params.forEach(param => {
                    if (param.type === 'Identifier') {
                        currentScope.addDeclaration(param.name, 'Parameter', param.loc.start.line, param);
                    }
                });
            }

            // References
            if (node.type === 'Identifier') {
                if (isReference(node, parent)) {
                    currentScope.addReference(node.name);
                }
            }
        },
        leave: function (node) {
            if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'BlockStatement'].includes(node.type)) {
                scopeStack.pop();
                currentScope = scopeStack[scopeStack.length - 1];
            }
        }
    });
    
    // Explicit Exports Handling (Simple Check)
    // If usage is in Export node, treat as used.
    // The previous check handled ExportNamed, but let's do more robust check or rely on references.
    
    // Resolve all scopes
    // We must resolve leaf scopes first? Order doesn't strictly matter if we just bubble up usage.
    // Actually we iterate all scopes and resolve their local refs.
    allScopes.forEach(s => s.resolve());

    // Collect Dead Code
    const deadCode = [];
    allScopes.forEach(scope => {
       scope.declarations.forEach((info, name) => {
           if (!info.used) {
               deadCode.push({
                   name,
                   type: info.type,
                   line: info.line
               });
           }
       });
    });

    return deadCode;
}


// Helper to determine if identifier is a reference (usage) vs declaration
function isReference(node, parent) {
    if (!parent) return false;
    
    // Declaration cases (NOT references)
    if (parent.type === 'VariableDeclarator' && parent.id === node) return false;
    if (parent.type === 'FunctionDeclaration' && parent.id === node) return false;
    if (parent.type === 'MethodDefinition' && parent.key === node) return false;
    if (parent.type === 'Property' && parent.key === node && !parent.computed) return false; // { key: val } -> key is not ref
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(parent.type)) {
        if (parent.params.includes(node)) return false;
    }
    if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return false; // obj.prop -> prop is not ref, obj is.
    
    return true;
}

export { analyzeDeadCodeRevised as findDeadCode };
