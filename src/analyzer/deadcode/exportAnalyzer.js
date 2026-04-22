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

                 if (!globalRegistry) return true; // Default konservatif: Jika tidak ada registri graf global, asumsikan dipakai
                 // Evaluasi Silang File Berbasis Call Graph (Ekspor -> Impor):
                 if (globalRegistry.usedExports && fileName) {
                     const fileUsed = globalRegistry.usedExports.get(fileName);
                     if (fileUsed && (fileUsed.has(name) || fileUsed.has('*'))) {
                         return true;
                     }
                     return false;
                 }
                 // Fallback metodologi usang (Global registry lama)
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
                 // export default function Foo() { ... }
                 if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
                     if (checkUsage(node.declaration.id.name)) globalScope.markUsed(node.declaration.id.name);
                 }
                 // export default class Bar { ... }
                 if (node.declaration.type === 'ClassDeclaration' && node.declaration.id) {
                     if (checkUsage(node.declaration.id.name)) globalScope.markUsed(node.declaration.id.name);
                 }
             }
             // Dukungan gaya ekspor CommonJS (module.exports.foo = foo)
             if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' &&
                 node.left.object.type === 'MemberExpression' && node.left.object.object.name === 'module') {
                 if (node.right.type === 'Identifier') {
                     if (checkUsage(node.right.name)) globalScope.markUsed(node.right.name);
                 }
             }
        }
    });
}
