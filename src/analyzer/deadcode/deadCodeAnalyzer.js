import estraverse from 'estraverse';
import { Scope } from './scope.js';
import { isReference } from './utils.js';

/**
 * Recursively extracts all Identifier names from a destructuring pattern.
 * Supports: Identifier, ObjectPattern, ArrayPattern, RestElement, AssignmentPattern.
 * @param {object} pattern - AST pattern node (e.g., node.id of a VariableDeclarator)
 * @returns {Array<{name: string, node: object}>} List of extracted identifiers with their AST nodes
 */
function extractIdentifiers(pattern) {
    const identifiers = [];

    if (!pattern) return identifiers;

    switch (pattern.type) {
        case 'Identifier':
            identifiers.push({ name: pattern.name, node: pattern });
            break;

        case 'ObjectPattern':
            // const { a, b: c, ...rest } = obj;
            for (const prop of pattern.properties) {
                if (prop.type === 'RestElement') {
                    identifiers.push(...extractIdentifiers(prop.argument));
                } else if (prop.type === 'Property') {
                    identifiers.push(...extractIdentifiers(prop.value));
                }
            }
            break;

        case 'ArrayPattern':
            // const [a, b, ...rest] = arr;
            for (const element of pattern.elements) {
                if (element) {
                    identifiers.push(...extractIdentifiers(element));
                }
            }
            break;

        case 'RestElement':
            // ...rest
            identifiers.push(...extractIdentifiers(pattern.argument));
            break;

        case 'AssignmentPattern':
            // const { a = 10 } = obj;  or  const [x = 5] = arr;
            identifiers.push(...extractIdentifiers(pattern.left));
            break;

        default:
            break;
    }

    return identifiers;
}

/**
 * Finds the nearest function scope (or global scope) in the scope stack.
 * Used for `var` declarations which are function-scoped, not block-scoped.
 * @param {Array<object>} scopeStack - The current scope stack
 * @param {Array<string>} scopeTypeStack - The type of each scope ('function', 'block', 'global')
 * @returns {object} The nearest function or global scope
 */
function findFunctionScope(scopeStack, scopeTypeStack) {
    // Walk backwards through the stack to find the nearest function/global scope
    for (let i = scopeStack.length - 1; i >= 0; i--) {
        if (scopeTypeStack[i] === 'function' || scopeTypeStack[i] === 'global') {
            return scopeStack[i];
        }
    }
    // Fallback to the first scope (global)
    return scopeStack[0];
}

// Main Analysis Logic
function analyzeDeadCodeRevised(ast, fileName = null, globalRegistry = null) {
    const allScopes = [];
    const globalScope = new Scope();
    allScopes.push(globalScope);
    
    let currentScope = globalScope;
    let scopeStack = [globalScope];
    let scopeTypeStack = ['global']; // Track whether each scope is 'global', 'function', or 'block'
    const unreachableNodes = [];
    const parentStack = []; // Track parent chain for grandParent context

    estraverse.traverse(ast, {
        fallback: 'iteration', // Handle unknown node types (e.g. TypeScript AST nodes)
        enter: function (node, parent) {
            parentStack.push(node);
            // Dead Branch Analysis 1: Constant Folding (if true/false literal)
            if (node.type === 'IfStatement' && node.test.type === 'Literal') {
                if (node.test.value === false) {
                    // if (false) { ... } -> Consequent is dead
                    unreachableNodes.push({
                        name: 'Unreachable Branch',
                        type: 'DeadBranch',
                        line: node.consequent.loc ? node.consequent.loc.start.line : node.loc.start.line,
                        node: node.consequent
                    });
                } else if (node.test.value === true && node.alternate) {
                    // if (true) { ... } else { ... } -> Alternate is dead
                    unreachableNodes.push({
                        name: 'Unreachable Branch',
                        type: 'DeadBranch',
                        line: node.alternate.loc ? node.alternate.loc.start.line : node.loc.start.line,
                        node: node.alternate
                    });
                }
            }

            // Dead Branch Analysis 2: Unreachable code after return/throw/break/continue
            // Works on two container types:
            //   - BlockStatement: normal function/if/loop bodies  (body array)
            //   - SwitchCase: case bodies are flat in `consequent` array, not a BlockStatement
            const terminators = new Set([
                'ReturnStatement',
                'ThrowStatement',
                'BreakStatement',
                'ContinueStatement'
            ]);

            const statementsToScan =
                node.type === 'BlockStatement' ? node.body :
                node.type === 'SwitchCase'     ? node.consequent :
                null;

            if (statementsToScan) {
                let terminatorFound = false;
                for (const stmt of statementsToScan) {
                    if (terminatorFound) {
                        unreachableNodes.push({
                            name: 'Unreachable Statement',
                            type: 'DeadCode',
                            line: stmt.loc ? stmt.loc.start.line : 0,
                            node: stmt
                        });
                    }
                    if (terminators.has(stmt.type)) {
                        terminatorFound = true;
                    }
                }
            }

            // Scope Creation — distinguish function scopes from block scopes
            if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
                const newScope = new Scope(currentScope);
                allScopes.push(newScope);
                currentScope = newScope;
                scopeStack.push(newScope);
                scopeTypeStack.push('function');
            } else if (node.type === 'BlockStatement') {
                // Only create a new block scope if this block is NOT a function body
                // (function body scope is already created by the function node above)
                const isFunctionBody = parent && ['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(parent.type);
                if (!isFunctionBody) {
                    const newScope = new Scope(currentScope);
                    allScopes.push(newScope);
                    currentScope = newScope;
                    scopeStack.push(newScope);
                    scopeTypeStack.push('block');
                }
            }

            // Declarations — with destructuring support & var scope fix
            if (node.type === 'VariableDeclarator') {
                // Determine declaration kind from parent VariableDeclaration
                const declarationKind = (parent && parent.type === 'VariableDeclaration') ? parent.kind : 'let';
                
                // Extract all identifiers (handles Identifier, ObjectPattern, ArrayPattern, etc.)
                const identifiers = extractIdentifiers(node.id);
                
                // Choose target scope: var → nearest function/global scope, let/const → current (block) scope
                const targetScope = (declarationKind === 'var')
                    ? findFunctionScope(scopeStack, scopeTypeStack)
                    : currentScope;
                
                identifiers.forEach(({ name, node: idNode }) => {
                    targetScope.addDeclaration(name, 'Variable', node.loc.start.line, idNode);
                });
            }

            if (node.type === 'FunctionDeclaration' && node.id) {
                // Function name belongs to PARENT scope (enclosing scope before the function's own scope)
                if (currentScope.parent) {
                    currentScope.parent.addDeclaration(node.id.name, 'Function', node.loc.start.line, node);
                }
            }

            // Function parameters — with destructuring support
            if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
                node.params.forEach(param => {
                    const identifiers = extractIdentifiers(param);
                    identifiers.forEach(({ name, node: idNode }) => {
                        currentScope.addDeclaration(name, 'Parameter', param.loc.start.line, idNode);
                    });
                });
            }

            // Import declarations — register imported names as variable declarations
            if (node.type === 'ImportDeclaration' && node.specifiers) {
                node.specifiers.forEach(spec => {
                    if (spec.local && spec.local.type === 'Identifier') {
                        currentScope.addDeclaration(spec.local.name, 'Variable', spec.loc.start.line, spec.local);
                    }
                });
            }

            // References
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
    
    // Explicit Exports Handling
    // 1. CommonJS: module.exports = ...
    // 2. ESM: export default ... / export const ...
    estraverse.traverse(ast, {
        fallback: 'iteration', // Handle unknown node types (e.g. TypeScript AST nodes)
        enter: function(node) {
             const checkUsage = (name) => {
                 if (!globalRegistry) return true; // Default: conservative, if no registry assume used
                 // Cross-file Call Graph DCE:
                 // Only mark used if it is in usedExports set of the global registry
                 if (globalRegistry.usedExports && fileName) {
                     const fileUsed = globalRegistry.usedExports.get(fileName);
                     if (fileUsed && (fileUsed.has(name) || fileUsed.has('*'))) {
                         return true;
                     }
                     return false;
                 }
                 // Legacy fallback
                 return globalRegistry.usages.has(name);
             };

             if (node.type === 'ExportNamedDeclaration' && node.declaration) {
                 // export const x = 1;
                 if (node.declaration.type === 'VariableDeclaration') {
                     node.declaration.declarations.forEach(decl => {
                         // Support destructured exports: export const { a, b } = obj;
                         const identifiers = extractIdentifiers(decl.id);
                         identifiers.forEach(({ name }) => {
                             if (checkUsage(name)) globalScope.markUsed(name);
                         });
                     });
                 }
                 if (node.declaration.type === 'FunctionDeclaration') {
                     if (checkUsage(node.declaration.id.name)) globalScope.markUsed(node.declaration.id.name);
                 }
             }
             if (node.type === 'ExportDefaultDeclaration') {
                 // export default x;
                 if (node.declaration.type === 'Identifier') {
                     if (checkUsage(node.declaration.name)) globalScope.markUsed(node.declaration.name);
                 }
             }
             // For CommonJS (module.exports.foo = foo)
             if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' &&
                 node.left.object.type === 'MemberExpression' && node.left.object.object.name === 'module') {
                 if (node.right.type === 'Identifier') {
                     if (checkUsage(node.right.name)) globalScope.markUsed(node.right.name);
                 }
             }
        }
    });

    // Resolve all scopes
    allScopes.forEach(s => s.resolve());

    // Collect Dead Code (Unused Variables)
    const deadCode = [];
    allScopes.forEach(scope => {
       scope.declarations.forEach((info, name) => {
           if (!info.used) {
               deadCode.push({
                   name,
                   type: info.type,
                   line: info.line,
                   node: info.node // Ensure node is passed for cleaner
               });
           }
       });
    });

    // Merge Unreachable Code
    deadCode.push(...unreachableNodes);

    return deadCode;
}

export { analyzeDeadCodeRevised as findDeadCode };
