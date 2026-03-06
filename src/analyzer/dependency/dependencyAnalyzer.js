import fs from 'fs-extra';
import path from 'path';
import glob from 'fast-glob';
import estraverse from 'estraverse';
import { parseCode } from '../../parser/astParser.js';

/**
 * Reads package.json and returns a list of all dependencies.
 * @param {string} projectRoot 
 * @returns {Promise<Set<string>>} Set of dependency names
 */
async function getPackageDependencies(projectRoot) {
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (!await fs.pathExists(packageJsonPath)) {
        throw new Error('package.json not found');
    }

    const pkg = await fs.readJson(packageJsonPath);
    const allDeps = {
        ...pkg.dependencies,
        ...pkg.devDependencies
    };

    return new Set(Object.keys(allDeps));
}

/**
 * Extracts the base package name from an import string.
 * Handles scoped packages (@scope/pkg/sub) -> @scope/pkg
 * Handles regular packages (pkg/sub) -> pkg
 * @param {string} importPath 
 * @returns {string} Base package name
 */
function getPackageName(importPath) {
    if (importPath.startsWith('.')) return null; // Ignore relative imports
    if (path.isAbsolute(importPath)) return null; // Ignore absolute paths

    const parts = importPath.split('/');
    if (importPath.startsWith('@')) {
        return parts.slice(0, 2).join('/');
    }
    return parts[0];
}

/**
 * Scans all JavaScript files in the project and extracts imported modules.
 * @param {string} projectRoot 
 * @returns {Promise<Set<string>>} Set of used package names
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
            // Skip empty files or shell scripts
            if (!code.trim() || code.startsWith('#!')) continue;

            const ast = parseCode(code);

            estraverse.traverse(ast, {
                enter: function (node) {
                    let source = null;

                    // 1. ImportDeclaration: import x from 'y'; import 'y';
                    if (node.type === 'ImportDeclaration' && node.source && node.source.value) {
                        source = node.source.value;
                    }
                    // 2. CallExpression: require('y');
                    else if (node.type === 'CallExpression' && 
                             node.callee.name === 'require' && 
                             node.arguments.length > 0 && 
                             node.arguments[0].type === 'Literal') {
                        source = node.arguments[0].value;
                    }
                    // 3. Dynamic Import: import('y') - treated as CallExpression with import keyword in some parsers or ImportExpression in newer ones
                    // Acorn 'latest' parses dynamic import import('x') as ImportExpression
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
            console.warn(`Warning: Failed to parse ${path.basename(file)}: ${err.message}`);
        }
    }

    return usedDeps;
}

/**
 * Main function to analyze unused dependencies.
 * @param {string} projectRoot 
 * @returns {Promise<string[]>} List of unused dependencies
 */
export async function findUnusedDependencies(projectRoot) {
    console.log(`Analyzing dependencies in: ${projectRoot}`);
    
    const declaredDeps = await getPackageDependencies(projectRoot);
    const usedDeps = await getUsedDependencies(projectRoot);

    const unused = [];
    for (const dep of declaredDeps) {
        // Special case: definitions/types often used implicitly, but let's stick to strict code usage for now
        // or dependencies that start with @types/ might be devDependencies not imported in code directly if uses JSDoc
        if (!usedDeps.has(dep)) {
            unused.push(dep);
        }
    }

    return unused;
}
