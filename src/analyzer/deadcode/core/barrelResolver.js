import fs from 'fs-extra';
import path from 'path';
import { parseCode } from '../../../parser/astParser.js';
import estraverse from 'estraverse';
import { resolvePath } from '../../graph/pathResolver.js';

/**
 * Barrel Resolver: Mengurai `export * from './file'` secara rekursif
 * untuk mengetahui SEMUA nama ekspor yang sebenarnya tersedia dari sebuah barrel file.
 * 
 * @module barrelResolver
 */

/**
 * Mengekstrak semua named exports dari sebuah file AST.
 * @param {object} ast - AST hasil parsing
 * @returns {Set<string>} Kumpulan nama ekspor
 */
function extractExportNames(ast) {
    const names = new Set();

    estraverse.traverse(ast, {
        fallback: 'iteration',
        enter(node) {
            // export const foo = ...; / export function bar() {}
            if (node.type === 'ExportNamedDeclaration') {
                if (node.declaration) {
                    if (node.declaration.type === 'VariableDeclaration') {
                        node.declaration.declarations.forEach(d => {
                            if (d.id && d.id.type === 'Identifier') names.add(d.id.name);
                        });
                    } else if (node.declaration.type === 'FunctionDeclaration' && node.declaration.id) {
                        names.add(node.declaration.id.name);
                    } else if (node.declaration.type === 'ClassDeclaration' && node.declaration.id) {
                        names.add(node.declaration.id.name);
                    } else if (node.declaration.type === 'TSEnumDeclaration' && node.declaration.id) {
                        names.add(node.declaration.id.name);
                    } else if (node.declaration.type === 'TSInterfaceDeclaration' && node.declaration.id) {
                        names.add(node.declaration.id.name);
                    } else if (node.declaration.type === 'TSTypeAliasDeclaration' && node.declaration.id) {
                        names.add(node.declaration.id.name);
                    }
                }
                // export { foo, bar } atau export { foo as bar } from './mod'
                if (node.specifiers) {
                    node.specifiers.forEach(spec => {
                        if (spec.exported && spec.exported.type === 'Identifier') {
                            names.add(spec.exported.name);
                        }
                    });
                }
            }
            // export * as ns from './mod'
            if (node.type === 'ExportAllDeclaration' && node.exported && node.exported.type === 'Identifier') {
                names.add(node.exported.name);
            }
            // export default ...
            if (node.type === 'ExportDefaultDeclaration') {
                names.add('default');
            }
        }
    });

    return names;
}

/**
 * Melakukan resolusi rekursif untuk `export * from './file'`.
 * Menghasilkan peta: barrelFile → Set<string> (semua nama yang sebenarnya di-export).
 * 
 * @param {string} filePath - Path file barrel
 * @param {string|null} projectRoot - Akar proyek untuk resolusi alias/tsconfig
 * @param {Set<string>} visited - Set file yang sudah dikunjungi (anti circular dependency)
 * @returns {Promise<Set<string>>} Kumpulan semua nama ekspor dari barrel ini
 */
export async function resolveBarrelExports(filePath, projectRoot = null, visited = new Set()) {
    // Pencegahan circular dependency (A re-exports B, B re-exports A)
    if (visited.has(filePath)) return new Set();
    visited.add(filePath);

    const allExports = new Set();

    try {
        const code = await fs.readFile(filePath, 'utf-8');
        const ast = await parseCode(code, filePath);

        // Kumpulkan ekspor lokal dari file ini
        const localExports = extractExportNames(ast);
        localExports.forEach(n => allExports.add(n));

        // Cari semua `export * from './...'` (tanpa namespace) dan resolve secara rekursif
        const reExportSources = [];
        estraverse.traverse(ast, {
            fallback: 'iteration',
            enter(node) {
                if (node.type === 'ExportAllDeclaration' && !node.exported && node.source && node.source.value) {
                    reExportSources.push(node.source.value);
                }
            }
        });

        const rootDir = projectRoot || path.dirname(filePath);
        for (const src of reExportSources) {
            const resolved = await resolvePath(rootDir, path.dirname(filePath), src);
            if (resolved && !resolved.includes('node_modules')) {
                const childExports = await resolveBarrelExports(resolved, rootDir, visited);
                childExports.forEach(n => allExports.add(n));
            }
        }
    } catch (err) {
        if (process.env.DEBUG) {
            console.warn(`[Warning] Gagal memparsing file barrel ${filePath}:`, err.message);
        }
    }

    return allExports;
}
