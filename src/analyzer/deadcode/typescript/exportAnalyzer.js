import estraverse from 'estraverse';
import { extractIdentifiers } from '../core/destructuringExtractor.js';

/**
 * Memastikan bahwa fungsi atau variabel yang diekspor diperiksa referensinya secara lintas file.
 */
export function markUsedExports(ast, globalScope, fileName, globalRegistry, ruleEngine) {
    estraverse.traverse(ast, {
        fallback: 'iteration',
        enter: function(node) {
             const recordExport = (name) => {
                 if (!globalRegistry || !globalRegistry.projectExports) return;
                 if (name === 'default') return; // Abaikan default exports karena namanya bebas (bisa bentrok tapi sah)
                 if (!globalRegistry.projectExports.has(name)) {
                     globalRegistry.projectExports.set(name, new Set());
                 }
                 globalRegistry.projectExports.get(name).add(fileName);
             };

             const checkUsage = (name) => {
                 const rules = ruleEngine && ruleEngine.rules;
                 
                 // Hybrid Rules: Jika di-export dan preserveExports ON, maka selamatkan.
                 if (rules && rules.preserveExports === true) {
                     return true;
                 }
                 // Jika preserveExports === 'strict', lanjut ke pengecekan cross-file (globalRegistry)

                 if (!globalRegistry) return true; // Default konservatif: Jika tidak ada registri graf global, asumsikan dipakai
                 
                 // Evaluasi Silang File Berbasis Call Graph (Ekspor -> Impor):
                 if (globalRegistry.usedExports && fileName) {
                     const fileUsed = globalRegistry.usedExports.get(fileName);
                     if (fileUsed && (fileUsed.has(name) || fileUsed.has('*'))) {
                         return true; // Ada file lain yang meng-import
                     }
                     // Dalam mode strict, kita sengaja tidak me-return true jika tidak ada yang import.
                     return false;
                 }
                 // Fallback metodologi usang (Global registry lama)
                 return globalRegistry.usages.has(name);
             };

             if (node.type === 'ExportNamedDeclaration') {
                 // 1. Ekspor Deklarasi (export const A = 1, export function B(), export interface C)
                 if (node.declaration) {
                     if (node.declaration.type === 'VariableDeclaration') {
                         node.declaration.declarations.forEach(decl => {
                             const identifiers = extractIdentifiers(decl.id);
                             identifiers.forEach(({ name }) => {
                                 recordExport(name);
                                 if (checkUsage(name)) globalScope.markUsed(name);
                             });
                         });
                     }
                     if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
                         recordExport(node.declaration.id.name);
                         if (checkUsage(node.declaration.id.name)) globalScope.markUsed(node.declaration.id.name);
                     }
                     if (node.declaration.type === 'ClassDeclaration' && node.declaration.id) {
                         recordExport(node.declaration.id.name);
                         if (checkUsage(node.declaration.id.name)) globalScope.markUsed(node.declaration.id.name);
                     }
                     // Dukungan TypeScript Types
                     if (['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration'].includes(node.declaration.type) && node.declaration.id) {
                         recordExport(node.declaration.id.name);
                         if (checkUsage(node.declaration.id.name)) globalScope.markUsed(node.declaration.id.name);
                     }
                 }
                 // 2. Ekspor Spesifikator (export { A, B } atau export type { C })
                 if (node.specifiers && node.specifiers.length > 0) {
                     node.specifiers.forEach(spec => {
                         if (spec.exported && spec.exported.type === 'Identifier') {
                             const exportName = spec.exported.name;
                             recordExport(exportName);
                             // Tandai yang diekspor (baik local name maupun exported name jika sama-sama ada)
                             if (checkUsage(exportName)) {
                                 globalScope.markUsed(exportName);
                                 if (spec.local && spec.local.type === 'Identifier') {
                                     globalScope.markUsed(spec.local.name);
                                 }
                             }
                         }
                     });
                 }
             }
             if (node.type === 'ExportDefaultDeclaration') {
                 recordExport('default');
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
                     recordExport(node.right.name);
                     if (checkUsage(node.right.name)) globalScope.markUsed(node.right.name);
                 }
             }
        }
    });
}
