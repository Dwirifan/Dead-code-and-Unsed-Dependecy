import estraverse from 'estraverse';
import { extractIdentifiers } from '../core/destructuringExtractor.js';

const PRESERVED_FRAMEWORK_EXPORTS = new Set([
    'getServerSideProps', 'getStaticProps', 'getStaticPaths',
    'metadata', 'generateMetadata', 'generateStaticParams',
    'revalidate', 'dynamic', 'runtime', 'fetchCache',
    'preferredRegion', 'maxDuration', 'alt', 'size',
    'contentType', 'loader', 'action', 'meta', 'links',
    'headers', 'handle', 'shouldRevalidate',
    'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'
]);

function hasFrameworkDirective(node) {
    if (!node || !node.body) return false;
    const body = Array.isArray(node.body) ? node.body : (node.body.body || []);
    for (const stmt of body) {
        if (stmt.type === 'ExpressionStatement' && stmt.expression && stmt.expression.type === 'Literal') {
            const val = stmt.expression.value;
            if (val === 'use server' || val === 'use client') return true;
        }
        if (stmt.directive === 'use server' || stmt.directive === 'use client') return true;
    }
    return false;
}

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

             const checkUsage = (name, nodeDecl = null) => {
                 if (PRESERVED_FRAMEWORK_EXPORTS.has(name)) return true;
                 if (hasFrameworkDirective(ast)) return true;
                 if (nodeDecl && (hasFrameworkDirective(nodeDecl) || hasFrameworkDirective(nodeDecl.body))) return true;

                 const rules = ruleEngine && ruleEngine.rules;
                 
                 // Hybrid Rules: Jika di-export dan preserveExports ON, maka selamatkan.
                 if (rules && rules.preserveExports === true) {
                     return true;
                 }
                 // Jika preserveExports === 'strict', lanjut ke pengecekan cross-file (globalRegistry)

                 if (!globalRegistry) return true; // Default konservatif: Jika tidak ada registri graf global, asumsikan dipakai
                 if (globalRegistry.unsafeFiles && fileName && globalRegistry.unsafeFiles.has(fileName)) {
                     return true; // Conservative bailout: File ini mengandung pola dinamis/eval/computed, selamatkan semua ekspor!
                 }
                 
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
                                 if (checkUsage(name, decl)) globalScope.markUsed(name);
                             });
                         });
                     }
                     if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
                         recordExport(node.declaration.id.name);
                         if (checkUsage(node.declaration.id.name, node.declaration)) globalScope.markUsed(node.declaration.id.name);
                     }
                     if (node.declaration.type === 'ClassDeclaration' && node.declaration.id) {
                         recordExport(node.declaration.id.name);
                         if (checkUsage(node.declaration.id.name, node.declaration)) globalScope.markUsed(node.declaration.id.name);
                     }
                     // Dukungan TypeScript Types & Namespaces
                     if (['TSInterfaceDeclaration', 'TSTypeAliasDeclaration', 'TSEnumDeclaration', 'TSDeclareFunction', 'TSImportEqualsDeclaration'].includes(node.declaration.type) && node.declaration.id) {
                         recordExport(node.declaration.id.name);
                         if (checkUsage(node.declaration.id.name, node.declaration)) globalScope.markUsed(node.declaration.id.name);
                     }
                     if (node.declaration.type === 'TSModuleDeclaration' && node.declaration.id) {
                         const nsName = node.declaration.id.name;
                         recordExport(nsName);
                         if (checkUsage(nsName, node.declaration)) {
                             globalScope.markUsed(nsName);
                             if (node.declaration.body && node.declaration.body.body) {
                                 node.declaration.body.body.forEach(stmt => {
                                     if (stmt.type === 'ExportNamedDeclaration' && stmt.declaration) {
                                         if (stmt.declaration.type === 'VariableDeclaration') {
                                             stmt.declaration.declarations.forEach(d => {
                                                 if (d.id && d.id.type === 'Identifier') globalScope.markUsed(d.id.name);
                                             });
                                         } else if (stmt.declaration.id) {
                                             globalScope.markUsed(stmt.declaration.id.name);
                                         }
                                     }
                                 });
                             }
                         }
                     }
                 }
                 // 2. Ekspor Spesifikator (export { A, B } atau export type { C })
                 if (node.specifiers && node.specifiers.length > 0) {
                     node.specifiers.forEach(spec => {
                         if (spec.exported && spec.exported.type === 'Identifier') {
                             const exportName = spec.exported.name;
                             recordExport(exportName);
                             if (checkUsage(exportName, null)) {
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
                     if (checkUsage(node.declaration.name, node.declaration)) globalScope.markUsed(node.declaration.name);
                 }
                 if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
                     if (checkUsage(node.declaration.id.name, node.declaration)) globalScope.markUsed(node.declaration.id.name);
                 }
                 if (node.declaration.type === 'ClassDeclaration' && node.declaration.id) {
                     if (checkUsage(node.declaration.id.name, node.declaration)) globalScope.markUsed(node.declaration.id.name);
                 }
             }
             // Dukungan gaya ekspor CommonJS (module.exports.foo = foo)
             if (node.type === 'AssignmentExpression' && node.left.type === 'MemberExpression' &&
                 node.left.object.type === 'MemberExpression' && node.left.object.object.name === 'module') {
                 if (node.right.type === 'Identifier') {
                     recordExport(node.right.name);
                     if (checkUsage(node.right.name, null)) globalScope.markUsed(node.right.name);
                 }
             }
             // Dukungan ExportAllDeclaration (export * from '...' dan export * as ns from '...')
             if (node.type === 'ExportAllDeclaration') {
                 if (node.exported && node.exported.type === 'Identifier') {
                     const exportName = node.exported.name;
                     recordExport(exportName);
                     if (checkUsage(exportName, null)) {
                         globalScope.markUsed(exportName);
                     }
                 } else {
                     recordExport('*');
                 }
             }
        }
    });
}
