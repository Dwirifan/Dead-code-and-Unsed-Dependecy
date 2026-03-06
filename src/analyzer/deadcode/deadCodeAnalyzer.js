import estraverse from 'estraverse';
import { Scope } from './scope.js';
import { isReference } from './utils.js';

// Main Analysis Logic
function analyzeDeadCodeRevised(ast, fileName = null, globalRegistry = null) {
    const allScopes = [];
    const globalScope = new Scope();
    allScopes.push(globalScope);
    
    let currentScope = globalScope;
    let scopeStack = [globalScope];
    const unreachableNodes = [];

    estraverse.traverse(ast, {
        enter: function (node, parent) {
            // Dead Branch Analysis (Constant Folding)
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
    
    // Explicit Exports Handling
    // 1. CommonJS: module.exports = ...
    // 2. ESM: export default ... / export const ...
    estraverse.traverse(ast, {
        enter: function(node) {
             const checkUsage = (name) => {
                 if (!globalRegistry) return true; // Default: conservative, if no registry assume used
                 // Cross-file Call Graph DCE:
                 // Only mark used if it is in usages set of the global registry
                 return globalRegistry.usages.has(name);
             };

             if (node.type === 'ExportNamedDeclaration' && node.declaration) {
                 // export const x = 1;
                 if (node.declaration.type === 'VariableDeclaration') {
                     node.declaration.declarations.forEach(decl => {
                         if (decl.id.type === 'Identifier') {
                             if (checkUsage(decl.id.name)) globalScope.markUsed(decl.id.name);
                         }
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
