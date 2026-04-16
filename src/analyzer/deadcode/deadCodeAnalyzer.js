import estraverse from 'estraverse';
import { Scope } from './scope.js';
import { isReference } from './isReference.js';
import { extractIdentifiers } from './destructuringExtractor.js';
import { findFunctionScope } from './scopeHelpers.js';
import { findUnreachableBranches } from './branchAnalyzer.js';
import { markUsedExports } from './exportAnalyzer.js';

// Main Analysis Logic
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
        enter: function (node, parent) {
            parentStack.push(node);

            // Scope Creation
            if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
                const newScope = new Scope(currentScope);
                allScopes.push(newScope);
                currentScope = newScope;
                scopeStack.push(newScope);
                scopeTypeStack.push('function');
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

            // Declarations
            if (node.type === 'VariableDeclarator') {
                const declarationKind = (parent && parent.type === 'VariableDeclaration') ? parent.kind : 'let';
                const identifiers = extractIdentifiers(node.id);
                const targetScope = (declarationKind === 'var')
                    ? findFunctionScope(scopeStack, scopeTypeStack)
                    : currentScope;
                
                identifiers.forEach(({ name, node: idNode }) => {
                    targetScope.addDeclaration(name, 'Variable', node.loc.start.line, idNode);
                });
            }

            if (node.type === 'FunctionDeclaration' && node.id) {
                if (currentScope.parent) {
                    currentScope.parent.addDeclaration(node.id.name, 'Function', node.loc.start.line, node);
                }
            }

            // Function parameters
            if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
                node.params.forEach(param => {
                    const identifiers = extractIdentifiers(param);
                    identifiers.forEach(({ name, node: idNode }) => {
                        currentScope.addDeclaration(name, 'Parameter', param.loc.start.line, idNode);
                    });
                });
            }

            // Import declarations
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

    // Phase 2: Hubungkan Expor / Lintas Modul
    markUsedExports(ast, globalScope, fileName, globalRegistry, ruleEngine);

    // Phase 3: Analisis Scope
    allScopes.forEach(s => s.resolve());

    // Phase 4: Pengumpulan Dead Variables & Unreachable Branches
    const deadCode = [];
    allScopes.forEach(scope => {
       scope.declarations.forEach((info, name) => {
           if (!info.used) {
               if (ruleEngine && ruleEngine.isIgnoredVariable(name)) {
                   return;
               }

               deadCode.push({
                   name,
                   type: info.type,
                   line: info.line,
                   node: info.node
               });
           }
       });
    });

    const unreachableNodes = findUnreachableBranches(ast);
    deadCode.push(...unreachableNodes);

    return deadCode;
}

export { analyzeDeadCodeRevised as findDeadCode };
