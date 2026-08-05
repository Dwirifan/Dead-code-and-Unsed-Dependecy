import estraverse from 'estraverse';
import fs from 'fs-extra';
import path from 'node:path';
import { extractIdentifiers } from '../core/destructuringExtractor.js';
import {
    NEXT_APP_COMPONENT_NAMES,
    NEXT_IMAGE_METADATA_NAMES,
    NEXT_METADATA_ROUTE_NAMES,
    NEXT_ROUTE_SEGMENT_NAMES,
} from '../../frameworkConventions.js';

const NEXT_PAGES_EXPORTS = new Set([
    'getServerSideProps', 'getStaticProps', 'getStaticPaths',
    'config', 'reportWebVitals',
]);

const NEXT_ROUTE_SEGMENT_EXPORTS = new Set([
    'generateStaticParams',
    'revalidate', 'dynamic', 'dynamicParams', 'runtime', 'fetchCache',
    'preferredRegion', 'maxDuration',
]);

const NEXT_PAGE_LAYOUT_EXPORTS = new Set([
    'metadata', 'generateMetadata', 'viewport', 'generateViewport',
]);

const NEXT_IMAGE_METADATA_EXPORTS = new Set([
    'alt', 'size', 'contentType', 'generateImageMetadata',
]);

const NEXT_SITEMAP_EXPORTS = new Set(['generateSitemaps']);

const NEXT_INSTRUMENTATION_EXPORTS = new Set(['register', 'onRequestError']);
const NEXT_INSTRUMENTATION_CLIENT_EXPORTS = new Set(['onRouterTransitionStart']);
const NEXT_PROXY_EXPORTS = new Set(['proxy', 'middleware', 'config']);
const NEXT_MDX_EXPORTS = new Set(['useMDXComponents']);

const NEXT_ROUTE_EXPORTS = new Set([
    'GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS',
]);

const REMIX_ROUTE_EXPORTS = new Set([
    'loader', 'action', 'clientLoader', 'clientAction',
    'meta', 'links', 'headers', 'handle', 'shouldRevalidate',
    'Component', 'ErrorBoundary', 'HydrateFallback', 'Layout',
]);

const SCRIPT_EXTENSION = '\\.[cm]?[jt]sx?$';

function effectiveRulesForFile(ruleEngine, fileName) {
    if (!ruleEngine) return {};
    if (typeof ruleEngine.effectiveRulesFor === 'function') {
        return ruleEngine.effectiveRulesFor(fileName) || {};
    }
    if (typeof ruleEngine._resolveConfigForFile === 'function') {
        return ruleEngine._resolveConfigForFile(fileName) || ruleEngine.rules || {};
    }
    return ruleEngine.rules || {};
}

function frameworkRelativePath(fileName, ruleEngine) {
    const rawFileName = String(fileName || '');
    if (!path.isAbsolute(rawFileName) || !ruleEngine?.projectRoot) {
        return rawFileName.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
    }

    const projectRoot = path.resolve(ruleEngine.projectRoot);
    let packageRoot = path.dirname(path.resolve(rawFileName));
    while (true) {
        if (fs.existsSync(path.join(packageRoot, 'package.json'))) break;
        if (packageRoot === projectRoot) break;
        const parent = path.dirname(packageRoot);
        const relativeParent = path.relative(projectRoot, parent);
        if (
            parent === packageRoot ||
            relativeParent === '..' ||
            relativeParent.startsWith(`..${path.sep}`) ||
            path.isAbsolute(relativeParent)
        ) {
            packageRoot = projectRoot;
            break;
        }
        packageRoot = parent;
    }
    return path.relative(packageRoot, rawFileName).replace(/\\/g, '/').toLowerCase();
}

function frameworkContext(fileName, rules, ruleEngine) {
    const normalizedPath = frameworkRelativePath(fileName, ruleEngine);
    const configuredFramework = typeof rules.framework === 'string'
        ? rules.framework.toLowerCase()
        : null;
    const usesNextConventions = configuredFramework
        ? configuredFramework === 'next'
        : rules.mode === 'next';
    const usesRemixConventions = configuredFramework
        ? configuredFramework === 'remix'
        : rules.mode === 'react';
    const nextPagesModule = new RegExp(`^(?:src/)?pages/.+${SCRIPT_EXTENSION}`, 'i').test(normalizedPath);
    const nextAppMatch = normalizedPath.match(new RegExp(
        `^(?:src/)?app/(?:.*/)?([^/]+)${SCRIPT_EXTENSION}`,
        'i',
    ));
    const nextAppModuleName = nextAppMatch?.[1] || null;
    const remixRouteModule = new RegExp(
        `^app/(?:routes/.+|root)${SCRIPT_EXTENSION}`,
        'i',
    ).test(normalizedPath);
    const nextInstrumentationModule = /^(?:src\/)?instrumentation\.[jt]s$/i.test(normalizedPath);
    const nextInstrumentationClientModule = /^(?:src\/)?instrumentation-client\.[jt]s$/i.test(normalizedPath);
    const nextProxyModule = /^(?:src\/)?(?:proxy|middleware)\.[jt]s$/i.test(normalizedPath);
    const nextMdxModule = /^(?:src\/)?mdx-components\.[cm]?[jt]sx?$/i.test(normalizedPath);

    return {
        nextPagesModule: usesNextConventions && nextPagesModule,
        nextPageLayoutModule: usesNextConventions && ['page', 'layout'].includes(nextAppModuleName),
        nextRouteSegmentModule: usesNextConventions && NEXT_ROUTE_SEGMENT_NAMES.includes(nextAppModuleName),
        nextComponentModule: usesNextConventions && NEXT_APP_COMPONENT_NAMES.includes(nextAppModuleName),
        nextImageMetadataModule: usesNextConventions && NEXT_IMAGE_METADATA_NAMES.includes(nextAppModuleName),
        nextMetadataRouteModule: usesNextConventions && NEXT_METADATA_ROUTE_NAMES.includes(nextAppModuleName),
        nextRouteModule: usesNextConventions && nextAppModuleName === 'route',
        nextInstrumentationModule: usesNextConventions && nextInstrumentationModule,
        nextInstrumentationClientModule: usesNextConventions && nextInstrumentationClientModule,
        nextProxyModule: usesNextConventions && nextProxyModule,
        nextMdxModule: usesNextConventions && nextMdxModule,
        remixRouteModule: usesRemixConventions && remixRouteModule,
    };
}

function isFrameworkExport(name, context) {
    if (context.nextPagesModule && NEXT_PAGES_EXPORTS.has(name)) return true;
    if (context.nextPageLayoutModule && NEXT_PAGE_LAYOUT_EXPORTS.has(name)) return true;
    if (context.nextRouteSegmentModule && NEXT_ROUTE_SEGMENT_EXPORTS.has(name)) return true;
    if (context.nextImageMetadataModule && NEXT_IMAGE_METADATA_EXPORTS.has(name)) return true;
    if (context.nextMetadataRouteModule && NEXT_SITEMAP_EXPORTS.has(name)) return true;
    if (context.nextRouteModule && NEXT_ROUTE_EXPORTS.has(name)) return true;
    if (context.nextInstrumentationModule && NEXT_INSTRUMENTATION_EXPORTS.has(name)) return true;
    if (context.nextInstrumentationClientModule && NEXT_INSTRUMENTATION_CLIENT_EXPORTS.has(name)) return true;
    if (context.nextProxyModule && NEXT_PROXY_EXPORTS.has(name)) return true;
    if (context.nextMdxModule && NEXT_MDX_EXPORTS.has(name)) return true;
    return context.remixRouteModule && REMIX_ROUTE_EXPORTS.has(name);
}

function hasFrameworkDefaultExport(context) {
    return context.nextPagesModule ||
        context.nextComponentModule ||
        context.nextImageMetadataModule ||
        context.nextMetadataRouteModule ||
        context.nextProxyModule ||
        context.remixRouteModule;
}

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
    const rules = effectiveRulesForFile(ruleEngine, fileName);
    const context = frameworkContext(fileName, rules, ruleEngine);

    estraverse.traverse(ast, {
        fallback: 'iteration',
        enter: function(node) {
             const recordExport = (name, localName = name) => {
                 if (!globalRegistry) return;

                 if (!globalRegistry.fileExportedLocals) {
                     globalRegistry.fileExportedLocals = new Map();
                 }
                 if (!globalRegistry.fileExportedLocals.has(fileName)) {
                     globalRegistry.fileExportedLocals.set(fileName, new Set());
                 }
                 if (localName) {
                     globalRegistry.fileExportedLocals.get(fileName).add(localName);
                 }

                 if (!globalRegistry.projectExports || name === 'default') return;
                 if (!globalRegistry.projectExports.has(name)) {
                     globalRegistry.projectExports.set(name, new Set());
                 }
                 globalRegistry.projectExports.get(name).add(fileName);
             };

             const checkUsage = (name, nodeDecl = null) => {
                 if (isFrameworkExport(name, context)) return true;
                 if (hasFrameworkDirective(ast)) return true;
                 if (nodeDecl && (hasFrameworkDirective(nodeDecl) || hasFrameworkDirective(nodeDecl.body))) return true;
                 
                 // Hybrid Rules: Jika di-export dan preserveExports ON, maka selamatkan.
                 if (rules && rules.preserveExports === true) {
                     return true;
                 }
                 // Jika preserveExports === 'strict', lanjut ke pengecekan cross-file (globalRegistry)

                 if (!globalRegistry) return true; // Default konservatif: Jika tidak ada registri graf global, asumsikan dipakai
                 if (
                     rules.preserveUnsafeFiles !== false &&
                     globalRegistry.unsafeFiles &&
                     fileName &&
                     globalRegistry.unsafeFiles.has(fileName)
                 ) {
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
                 return false;
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
                             recordExport(
                                 exportName,
                                 spec.local && spec.local.type === 'Identifier'
                                     ? spec.local.name
                                     : exportName,
                             );
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
                 const defaultLocalName = node.declaration.type === 'Identifier'
                     ? node.declaration.name
                     : node.declaration.id?.name;
                 recordExport('default', defaultLocalName || null);
                 const preserveDefault = hasFrameworkDefaultExport(context);
                 if (node.declaration.type === 'Identifier') {
                     if (preserveDefault || checkUsage(node.declaration.name, node.declaration)) {
                         globalScope.markUsed(node.declaration.name);
                     }
                 }
                 if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
                     if (preserveDefault || checkUsage(node.declaration.id.name, node.declaration)) {
                         globalScope.markUsed(node.declaration.id.name);
                     }
                 }
                 if (node.declaration.type === 'ClassDeclaration' && node.declaration.id) {
                     if (preserveDefault || checkUsage(node.declaration.id.name, node.declaration)) {
                         globalScope.markUsed(node.declaration.id.name);
                     }
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
