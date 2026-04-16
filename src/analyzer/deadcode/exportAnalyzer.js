import estraverse from 'estraverse';
import { extractIdentifiers } from './destructuringExtractor.js';

/**
 * Memastikan bahwa fungsi atau variabel yang diekspor diperiksa referensinya secara lintas file.
 */
export function markUsedExports(ast, globalScope, fileName, globalRegistry, ruleEngine) {
    estraverse.traverse(ast, {
        fallback: 'iteration',
        enter: function(node) {
             const checkUsage = (name) => {
                 // Hybrid Rules: Jika di-export dan preserveExports ON, maka selamatkan.
                 if (ruleEngine && ruleEngine.rules && ruleEngine.rules.preserveExports) {
                     return true;
                 }

                 if (!globalRegistry) return true; // Default: conservative, if no registry assume used
                 // Cross-file Call Graph DCE:
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
                 if (node.declaration.type === 'VariableDeclaration') {
                     node.declaration.declarations.forEach(decl => {
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
}
