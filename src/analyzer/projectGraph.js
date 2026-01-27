import fs from 'fs-extra';
import path from 'path';
import { parseCode } from '../parser/astParser.js';
import estraverse from 'estraverse';

/**
 * Tries to resolve a file path accurately (handling .js, .json, /index.js)
 */
async function resolvePath(baseDir, relativeImport) {
    // 1. Exact path
    let candidate = path.resolve(baseDir, relativeImport);
    
    const tryExtensions = async (p) => {
        const extensions = ['.js', '.mjs', '.cjs', '.json'];
        for (const ext of extensions) {
            if (await fs.pathExists(p + ext)) return p + ext;
        }
        return null;
    };

    // Check if it's a file directly
    if (await fs.pathExists(candidate) && (await fs.stat(candidate)).isFile()) return candidate;
    
    // Check extensions
    let found = await tryExtensions(candidate);
    if (found) return found;

    // Check directory (index.js)
    if (await fs.pathExists(candidate) && (await fs.stat(candidate)).isDirectory()) {
         // try candidate/index.js
         found = await tryExtensions(path.join(candidate, 'index'));
         if (found) return found;
    }

    return null; // Could not resolve locally (might be dynamic or error)
}

/**
 * Builds a comprehensive project graph starting from entry points.
 * @param {string} projectRoot 
 * @returns {Promise<{ liveFiles: Set<string>, usedPackages: Set<string> }>}
 */
export async function buildProjectGraph(projectRoot) {
    const pkgPath = path.join(projectRoot, 'package.json');
    if (!await fs.pathExists(pkgPath)) {
        throw new Error('No package.json found. Cannot determine entry point.');
    }
    const pkg = await fs.readJson(pkgPath);
    
    // A. Identify Entry Point
    let entryFiles = [];
    if (pkg.main) {
        entryFiles.push(path.resolve(projectRoot, pkg.main));
    } else {
        // Fallbacks
        const candidates = ['index.js', 'main.js', 'src/index.js', 'app.js', 'server.js'];
        for (const c of candidates) {
            const full = path.resolve(projectRoot, c);
            if (await fs.pathExists(full)) {
                entryFiles.push(full);
                break; 
            }
        }
    }
    
    // Include all bin scripts if exist
    if (pkg.bin) {
        if (typeof pkg.bin === 'string') {
            entryFiles.push(path.resolve(projectRoot, pkg.bin));
        } else {
            Object.values(pkg.bin).forEach(p => entryFiles.push(path.resolve(projectRoot, p)));
        }
    }

    if (entryFiles.length === 0) {
        throw new Error('Could not auto-detect entry point. Please specify "main" in package.json.');
    }

    // B. Dependency Graph Construction (BFS)
    const liveFiles = new Set();
    const visitedFiles = new Set();
    const usedPackages = new Set();
    const edges = []; // { from, to }
    const queue = [...entryFiles];

    // Mark entries as live potentially (need verify existence)
    // We filter queue initially
    const validQueue = [];
    for (const f of queue) {
        if (await fs.pathExists(f)) {
            validQueue.push(f);
            visitedFiles.add(f);
            liveFiles.add(f);
        }
    }
    
    while (validQueue.length > 0) {
        const currentFile = validQueue.shift();
        const fileDir = path.dirname(currentFile);
        
        try {
            const code = await fs.readFile(currentFile, 'utf-8');
            // Skip binary or non-js
            if (path.extname(currentFile) === '.json') continue; // Don't parse JSON as JS

            const ast = parseCode(code);

            estraverse.traverse(ast, {
                enter: function (node) {
                    let importPath = null;

                    // require('x')
                    if (node.type === 'CallExpression' && node.callee.name === 'require' && node.arguments[0]?.value) {
                         importPath = node.arguments[0].value;
                    } 
                    // import ... from 'x' or import 'x'
                    else if ((node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source?.value) {
                        importPath = node.source.value;
                    }
                    // dynamic import('x')
                    else if (node.type === 'ImportExpression' && node.source?.value) {
                        importPath = node.source.value;
                    }

                    if (importPath) {
                        if (importPath.startsWith('.')) {
                            // Local File
                            // We need to resolve it asynchronously, but traverse is sync.
                            // Capture it for processing after traversal or manage queue logic carefully.
                            // Optimization: Just collection paths here.
                        } else {
                            // Package
                            // Handle scoped @foo/bar
                            if (!importPath.startsWith('/') && !path.isAbsolute(importPath)) {
                                const parts = importPath.split('/');
                                const pkgName = importPath.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
                                usedPackages.add(pkgName);
                            }
                        }
                    }
                }
            });

            // Re-traverse or Use a collection to handle Async Resolution
            // Since we can't await inside traverse, we'll re-parse or use regex? No, we need AST.
            // Let's modify the approach: Collect imports during traversal, then process.
            const importsToResolve = [];
            estraverse.traverse(ast, {
                enter: function (node) {
                     let src = null;
                     if (node.type === 'CallExpression' && node.callee.name === 'require' && node.arguments[0]?.value) src = node.arguments[0].value;
                     else if ((node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source?.value) src = node.source.value;
                     else if (node.type === 'ImportExpression' && node.source?.value) src = node.source.value;

                     if (src && src.startsWith('.')) {
                         importsToResolve.push(src);
                     }
                }
            });

            // Process local imports
            for (const imp of importsToResolve) {
                const absolute = await resolvePath(fileDir, imp);
                if (absolute) {
                    // Record Edge: currentFile -> absolute
                    edges.push({ from: currentFile, to: absolute });

                    if (!visitedFiles.has(absolute)) {
                        visitedFiles.add(absolute);
                        liveFiles.add(absolute);
                        validQueue.push(absolute);
                    }
                }
            }

        } catch (err) {
            // Ignore parse errors
        }
    }

    return { liveFiles, usedPackages, edges };
}
