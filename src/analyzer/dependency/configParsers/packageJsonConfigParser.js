import fs from 'fs-extra';
import path from 'path';

/**
 * Memindai kamus field konfigurasi standar/implisit di dalam package.json.
 * 
 * @param {string} projectRoot
 * @returns {Promise<{
 *   packages: Set<string>,
 *   diagnostics: Array<object>,
 *   files: string[],
 *   complete: boolean
 * }>}
 */
export async function parsePackageJsonConfigDetailed(projectRoot) {
    const packages = new Set();
    const diagnostics = [];
    const files = [];

    const pkgPath = path.join(projectRoot, 'package.json');
    if (!await fs.pathExists(pkgPath)) {
        return { packages, diagnostics, files, complete: true };
    }

    try {
        const pkg = await fs.readJson(pkgPath);
        files.push(pkgPath);

        // 1. PRETTIER
        if (pkg.prettier !== undefined) {
            packages.add('prettier');
            if (typeof pkg.prettier === 'string') {
                packages.add(pkg.prettier); // Contoh: "@sxzz/prettier-config"
            } else if (typeof pkg.prettier === 'object' && pkg.prettier !== null) {
                if (Array.isArray(pkg.prettier.plugins)) {
                    pkg.prettier.plugins.forEach(p => typeof p === 'string' && packages.add(p));
                }
            }
        }

        // 2. SIMPLE-GIT-HOOKS
        if (pkg['simple-git-hooks'] !== undefined) {
            packages.add('simple-git-hooks');
        }

        // 3. HUSKY
        if (pkg.husky !== undefined) {
            const declared = {
                ...(pkg.dependencies || {}),
                ...(pkg.devDependencies || {}),
                ...(pkg.optionalDependencies || {}),
            };
            if (Object.hasOwn(declared, 'husky')) {
                packages.add('husky');
            } else {
                diagnostics.push({
                    source: `${pkgPath}#husky`,
                    code: 'UNDECLARED_CONFIG_TOOL',
                    severity: 'warning',
                    message: "Konfigurasi 'husky' ditemukan tanpa dependency terkait. Periksa apakah paket belum dideklarasikan atau konfigurasi ini sudah usang.",
                    package: 'husky',
                    line: null,
                    affectsDependencyClassification: false,
                });
            }
        }

        // 4. LINT-STAGED
        if (pkg['lint-staged'] !== undefined) {
            packages.add('lint-staged');
            if (typeof pkg['lint-staged'] === 'object' && pkg['lint-staged'] !== null) {
                Object.values(pkg['lint-staged']).forEach(val => {
                    const cmds = Array.isArray(val) ? val : [val];
                    cmds.forEach(cmd => {
                        if (typeof cmd === 'string') {
                            const firstWord = cmd.trim().split(/\s+/)[0];
                            if (firstWord && !['echo', 'git', 'node', 'npm', 'pnpm', 'yarn', 'bun', 'npx'].includes(firstWord)) {
                                packages.add(firstWord);
                            }
                        }
                    });
                });
            }
        }

        // 5. STYLELINT
        if (pkg.stylelint !== undefined) {
            packages.add('stylelint');
            extractExtendsAndPlugins(pkg.stylelint, packages);
        }

        // 6. COMMITLINT
        if (pkg.commitlint !== undefined) {
            packages.add('@commitlint/cli');
            packages.add('commitlint');
            extractExtendsAndPlugins(pkg.commitlint, packages);
        }

        // 7. JEST
        if (pkg.jest !== undefined) {
            packages.add('jest');
            if (typeof pkg.jest.preset === 'string') {
                packages.add(pkg.jest.preset);
            }
        }

        // 8. POSTCSS
        if (pkg.postcss !== undefined && typeof pkg.postcss.plugins === 'object' && pkg.postcss.plugins !== null) {
            packages.add('postcss');
            Object.keys(pkg.postcss.plugins).forEach(pluginName => {
                if (typeof pluginName === 'string') packages.add(pluginName);
            });
        }
    } catch (err) {
        diagnostics.push({
            source: pkgPath,
            code: 'PACKAGE_JSON_IMPLICIT_PARSE_FAILED',
            severity: 'warning',
            message: `Gagal memparse implicit config di package.json: ${err.message}`,
            line: null,
            affectsDependencyClassification: false,
        });
    }

    return { packages, diagnostics, files, complete: true };
}

/**
 * Helper untuk mengekstrak field extends dan plugins standar
 */
function extractExtendsAndPlugins(configObj, packages) {
    if (!configObj || typeof configObj !== 'object') return;
    
    if (configObj.extends) {
        const extList = Array.isArray(configObj.extends) ? configObj.extends : [configObj.extends];
        extList.forEach(item => typeof item === 'string' && packages.add(item));
    }
    
    if (configObj.plugins) {
        const pluginList = Array.isArray(configObj.plugins) ? configObj.plugins : Object.keys(configObj.plugins);
        pluginList.forEach(item => typeof item === 'string' && packages.add(item));
    }
}
