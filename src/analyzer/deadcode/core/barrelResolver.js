import fs from 'fs-extra';
import path from 'path';
import { parseCode } from '../../../parser/astParser.js';
import estraverse from 'estraverse';

/**
 * Barrel Resolver: Mengurai `export * from './file'` secara rekursif
 * untuk mengetahui SEMUA nama ekspor yang sebenarnya tersedia dari sebuah barrel file.
 * 
 * Contoh:
 *   // utils/index.js (barrel)
 *   export * from './math.js';     → { add, subtract }
 *   export * from './string.js';   → { capitalize, trim }
 *   
 *   // app.js
 *   import { add } from './utils'; → hanya 'add' yang dipakai
 *   → subtract, capitalize, trim = DEAD EXPORTS
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
                // export { foo, bar }
                if (node.specifiers && !node.source) {
                    node.specifiers.forEach(spec => {
                        if (spec.exported && spec.exported.type === 'Identifier') {
                            names.add(spec.exported.name);
                        }
                    });
                }
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
 * Mencoba meresolusi path import relatif ke file absolut.
 * @param {string} baseDir - Direktori dasar
 * @param {string} relPath - Path relatif
 * @returns {Promise<string|null>} Path absolut atau null
 */
async function resolveFilePath(baseDir, relPath) {
    const candidate = path.resolve(baseDir, relPath);
    const extensions = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'];

    // Cek langsung
    if (await fs.pathExists(candidate) && (await fs.stat(candidate)).isFile()) return candidate;

    // Cek dengan ekstensi
    for (const ext of extensions) {
        if (await fs.pathExists(candidate + ext)) return candidate + ext;
    }

    // Cek sebagai direktori dengan index
    if (await fs.pathExists(candidate) && (await fs.stat(candidate)).isDirectory()) {
        for (const ext of extensions) {
            const indexPath = path.join(candidate, 'index' + ext);
            if (await fs.pathExists(indexPath)) return indexPath;
        }
    }

    return null;
}

/**
 * Melakukan resolusi rekursif untuk `export * from './file'`.
 * Menghasilkan peta: barrelFile → Set<string> (semua nama yang sebenarnya di-export).
 * 
 * @param {string} filePath - Path file barrel
 * @param {Set<string>} visited - Set file yang sudah dikunjungi (anti circular dependency)
 * @returns {Promise<Set<string>>} Kumpulan semua nama ekspor dari barrel ini
 */
export async function resolveBarrelExports(filePath, visited = new Set()) {
    // Pencegahan circular dependency (A re-exports B, B re-exports A)
    if (visited.has(filePath)) return new Set();
    visited.add(filePath);

    const allExports = new Set();

    try {
        const code = await fs.readFile(filePath, 'utf-8');
        const ast = await parseCode(code, resolvedFile);

        // Kumpulkan ekspor lokal dari file ini
        const localExports = extractExportNames(ast);
        localExports.forEach(n => allExports.add(n));

        // Cari semua `export * from './...'` dan resolve secara rekursif
        const reExportSources = [];
        estraverse.traverse(ast, {
            fallback: 'iteration',
            enter(node) {
                if (node.type === 'ExportAllDeclaration' && node.source && node.source.value) {
                    reExportSources.push(node.source.value);
                }
            }
        });

        for (const src of reExportSources) {
            if (src.startsWith('.') || src.startsWith('/')) {
                const resolved = await resolveFilePath(path.dirname(filePath), src);
                if (resolved && !resolved.includes('node_modules')) {
                    const childExports = await resolveBarrelExports(resolved, visited);
                    childExports.forEach(n => allExports.add(n));
                }
            }
        }
    } catch (err) {
        if (process.env.DEBUG) {
            console.warn(`[Warning] Gagal memparsing file barrel ${filePath}:`, err.message);
        }
    }

    return allExports;
}
