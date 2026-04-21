import fs from 'fs-extra';
import path from 'path';
import glob from 'fast-glob';
import estraverse from 'estraverse';
import { parseCode } from '../../parser/astParser.js';

/**
 * Membaca package.json dan mengembalikan daftar seluruh dependensi yang terdaftar.
 * @param {string} projectRoot - Path direktori akar proyek
 * @returns {Promise<Set<string>>} Set berisi nama-nama dependensi NPM
 */
async function getPackageDependencies(projectRoot) {
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (!await fs.pathExists(packageJsonPath)) {
        throw new Error('File package.json tidak ditemukan');
    }

    const pkg = await fs.readJson(packageJsonPath);
    const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies
    };

    return new Set(Object.keys(allDeps));
}

/**
 * Mengekstraksi nama paket dasar dari string impor.
 * Menangani scoped packages (@scope/pkg/sub) -> @scope/pkg
 * Menangani package reguler (pkg/sub) -> pkg
 * @param {string} importPath - Path impor mentah
 * @returns {string|null} Nama dasar paket atau null jika merupakan impor lokal
 */
function getPackageName(importPath) {
    if (importPath.startsWith('.')) return null; // Abaikan impor relatif (file lokal)
    if (path.isAbsolute(importPath)) return null; // Abaikan impor absolut (Sistem File OS)

    const parts = importPath.split('/');
    if (importPath.startsWith('@')) {
        return parts.slice(0, 2).join('/');
    }
    return parts[0];
}

/**
 * Melacak semua file JavaScript di dalam proyek dan mengeksekusi modul impor
 * untuk mendata paket NPM apa saja yang secara fisik dipanggil oleh kode.
 * @param {string} projectRoot - Path direktori akar proyek
 * @returns {Promise<Set<string>>} Set berisi nama dependensi yang benar-benar dipakai
 */
async function getUsedDependencies(projectRoot) {
    const usedDeps = new Set();
    const files = await glob(['**/*.{js,mjs,cjs}'], {
        cwd: projectRoot,
        ignore: ['node_modules/**', 'dist/**', 'test/**', 'tests/**', 'coverage/**'],
        absolute: true
    });

    for (const file of files) {
        try {
            const code = await fs.readFile(file, 'utf-8');
            // Lewati file kosong atau skrip shell
            if (!code.trim() || code.startsWith('#!')) continue;

            const ast = parseCode(code);

            estraverse.traverse(ast, {
                enter: function (node) {
                    let source = null;

                    // 1. Deklarasi Import: import x from 'y'; import 'y';
                    if (node.type === 'ImportDeclaration' && node.source && node.source.value) {
                        source = node.source.value;
                    }
                    // 2. Ekspresi Pemanggilan: require('y');
                    else if (node.type === 'CallExpression' && 
                             node.callee.name === 'require' && 
                             node.arguments.length > 0 && 
                             node.arguments[0].type === 'Literal') {
                        source = node.arguments[0].value;
                    }
                    // 3. Impor Dinamis: import('y')
                    else if (node.type === 'ImportExpression' && node.source && node.source.type === 'Literal') {
                        source = node.source.value;
                    }


                    if (source) {
                        const pkgName = getPackageName(source);
                        if (pkgName) {
                            usedDeps.add(pkgName);
                        }
                    }
                }
            });
        } catch (err) {
            console.warn(`Peringatan: Gagal mem-parsing ${path.basename(file)}: ${err.message}`);
        }
    }

    return usedDeps;
}

/**
 * Logika Utama untuk menganalisis dan mencari Dependensi NPM yang tidak terpakai.
 * @param {string} projectRoot - Path direktori akar proyek
 * @returns {Promise<string[]>} Daftar nama dependensi yang yatim/tak terpakai
 */
export async function findUnusedDependencies(projectRoot) {
    console.log(`Menganalisis dependensi paket NPM di: ${projectRoot}`);
    
    const declaredDeps = await getPackageDependencies(projectRoot);
    const usedDeps = await getUsedDependencies(projectRoot);

    const unused = [];
    for (const dep of declaredDeps) {
        // Catatan: Dependensi seperti @types/ mungkin dipakai secara implisit untuk JSDoc
        // Namun, jika tidak ditemukan pemanggilannya di kode aktual, kita anggap yatim.
        if (!usedDeps.has(dep)) {
            unused.push(dep);
        }
    }

    return unused;
}
