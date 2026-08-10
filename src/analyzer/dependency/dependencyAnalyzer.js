import fs from 'fs-extra';
import glob from 'fast-glob';
import path from 'path';
import { builtinModules } from 'module';
import { runConfigParsersDetailed } from './configParsers/configParserRunner.js';

const NODE_BUILTINS = new Set([
    ...builtinModules,
    ...builtinModules.map(moduleName => `node:${moduleName}`),
]);

const ALWAYS_EXCLUDED_DEV_PATTERNS = [
    /^@types\//,
    /^@vitest\//,
    /^jest-/,
    /^@testing-library\//,
    /^cypress-/,
    /^eslint-(plugin|config)-/,
    /^@typescript-eslint\//,
    /^prettier-plugin-/,
    /^stylelint-(config|plugin)-/,
    /^@babel\/(plugin|preset)-/,
    /^babel-(plugin|preset)-/,
    /^@rollup\/plugin-/,
    /^rollup-plugin-/,
    /^vite-plugin-/,
    /^@vitejs\/plugin-/,
    /-loader$/,
    /-webpack-plugin$/,
    /^postcss-/,
    /^tailwindcss/,
    /^gatsby-(plugin|source|transformer)-/,
    /^@nuxtjs\//,
];

const ALWAYS_EXCLUDED_DEV_EXACT = new Set([
    'typescript', 'ts-node', 'tsx', 'esbuild', 'swc', '@swc/core',
    'webpack', 'webpack-cli', 'webpack-dev-server', 'vite', 'rollup', 'parcel',
    'vitest', 'jest', 'mocha', 'chai', 'cypress', 'playwright', '@playwright/test',
    'eslint', 'prettier', 'stylelint',
    'husky', 'lint-staged', 'commitlint', '@commitlint/cli', '@commitlint/config-conventional',
    'rimraf', 'cross-env', 'concurrently', 'npm-run-all', 'nodemon', 'pm2', 'dotenv', 'shx',
]);

const IMPLICIT_DEPENDENCIES = new Map([
    ['next', ['react', 'react-dom', 'eslint-config-next']],
    ['react-scripts', ['react', 'react-dom']],
    ['@vitejs/plugin-react', ['react', 'react-dom']],
    ['@vitejs/plugin-react-swc', ['react', 'react-dom']],
    ['nuxt', ['vue']],
    ['nuxt3', ['vue']],
    ['gatsby', ['react', 'react-dom']],
]);

const SYSTEM_SCRIPT_COMMANDS = new Set([
    'node', 'npm', 'npx', 'pnpm', 'yarn', 'bun', 'bunx', 'corepack',
    'sh', 'bash', 'cmd', 'powershell', 'pwsh',
    'echo', 'printf', 'cd', 'pwd', 'set', 'export', 'env',
    'test', 'true', 'false', 'exit', 'sleep',
    'rm', 'rmdir', 'del', 'cp', 'copy', 'mv', 'move', 'mkdir',
    'git', 'docker', 'docker-compose',
]);

const COMMON_BIN_ALIASES = new Map([
    ['@angular/cli', ['ng']],
    ['@commitlint/cli', ['commitlint']],
    ['@nestjs/cli', ['nest']],
    ['@playwright/test', ['playwright']],
    ['@storybook/cli', ['storybook']],
    ['@vue/cli-service', ['vue-cli-service']],
    ['npm-run-all', ['run-p', 'run-s']],
    ['typescript', ['tsc', 'tsserver']],
    ['webpack-cli', ['webpack']],
]);

async function validateHeuristicExclusion(dependency, projectRoot, allDeclared, effectiveUsedPackages) {
    const isExcluded = ALWAYS_EXCLUDED_DEV_EXACT.has(dependency) || ALWAYS_EXCLUDED_DEV_PATTERNS.some(pattern => pattern.test(dependency));
    if (!isExcluded) return false;

    // 1. Ambient Types (@types/*) — Heuristik 3 Lapis
    if (dependency.startsWith('@types/')) {
        const base = dependency.slice(7); // e.g. "@types/express" -> "express"

        // Aturan 1 (Coupled Types): @types/X berguna jika paket X ada di dependencies/imports
        if (base === 'node') return true; // @types/node selalu berguna jika ada TypeScript
        if (allDeclared.has(base) || effectiveUsedPackages.has(base)) return true;

        // Aturan 2 (Global Ambient): Deteksi penggunaan berdasarkan pola dalam kode sumber
        const globalAmbientSignals = {
            'jest': ['describe(', 'it(', 'test(', 'expect(', 'beforeEach(', 'afterEach('],
            'mocha': ['describe(', 'it(', 'before(', 'after('],
            'jasmine': ['describe(', 'it(', 'expect(', 'jasmine.'],
            'node': ['require(', 'process.', '__dirname', '__filename', 'module.exports'],
            'express': ['express()', 'Router()', 'req.body', 'res.json('],
        };
        const signals = globalAmbientSignals[base];
        if (signals) {
            try {
                const srcFiles = await glob(['src/**/*.{ts,tsx,js}', 'lib/**/*.{ts,tsx,js}'], {
                    cwd: projectRoot,
                    ignore: ['**/node_modules/**'],
                    limit: 50,
                });
                for (const file of srcFiles) {
                    const content = fs.readFileSync(path.join(projectRoot, file), 'utf8');
                    if (signals.some(signal => content.includes(signal))) return true;
                }
            } catch (_e) {}
        }

        // Aturan 3 (TSConfig Types): Jika tercantum dalam field "types" atau "typeRoots" di tsconfig
        try {
            for (const cfgName of ['tsconfig.json', 'tsconfig.app.json', 'tsconfig.base.json']) {
                const cfgPath = path.join(projectRoot, cfgName);
                if (fs.existsSync(cfgPath)) {
                    const cfg = fs.readJsonSync(cfgPath);
                    const types = cfg?.compilerOptions?.types || [];
                    if (types.includes(base)) return true;
                }
            }
        } catch (_e) {}

        // Removed weak fallback for @types based on typescript presence
        return false;
    }

    // 2. Test Frameworks (Strong Evidence)
    const testFrameworkConfigs = {
        'vitest': ['vitest.config.*', 'vitest.workspace.*'],
        'jest': ['jest.config.*'],
        'cypress': ['cypress.config.*', 'cypress/'],
        'playwright': ['playwright.config.*'],
        '@playwright/test': ['playwright.config.*'],
        'mocha': ['.mocharc.*']
    };

    const isTestEcosystem = dependency.startsWith('@vitest/') || dependency.startsWith('jest-') || dependency.startsWith('@testing-library/') || ['vitest', 'jest', 'cypress', 'playwright', '@playwright/test', 'mocha', 'chai'].includes(dependency);

    if (isTestEcosystem) {
        let baseFramework = null;
        if (dependency.includes('vitest')) baseFramework = 'vitest';
        else if (dependency.includes('jest')) baseFramework = 'jest';
        else if (dependency.includes('cypress')) baseFramework = 'cypress';
        else if (dependency.includes('playwright')) baseFramework = 'playwright';
        else if (dependency.includes('mocha') || dependency.includes('chai')) baseFramework = 'mocha';

        if (baseFramework) {
            // Cek keberadaan file config
            const configs = testFrameworkConfigs[baseFramework];
            if (configs) {
                const foundConfigs = await glob(configs, { cwd: projectRoot, ignore: ['**/node_modules/**']});
                if (foundConfigs.length > 0) return true;
            }

            // Cek import/penggunaan framework di dalam file test
            const testFiles = await glob(['**/*.test.*', '**/*.spec.*', '**/__tests__/**', '**/test/**'], { 
                cwd: projectRoot, 
                ignore: ['**/node_modules/**'],
                limit: 20
            });
            
            if (testFiles.length > 0) {
                const signals = {
                    'vitest': ['vitest', 'vi.'],
                    'jest': ['jest', '@jest/globals'],
                    'mocha': ['mocha', 'chai'],
                    'cypress': ['cy.'],
                    'playwright': ['@playwright/test']
                }[baseFramework] || [baseFramework];

                for (const file of testFiles) {
                    try {
                        const content = fs.readFileSync(path.join(projectRoot, file), 'utf8');
                        if (signals.some(s => content.includes(s))) return true;
                    } catch (_e) {}
                }
            }
        }
        return false;
    }

    // 3. TypeScript
    if (['typescript', 'ts-node', 'tsx'].includes(dependency)) {
        const tsFiles = await glob(['**/*.ts', '**/*.tsx', 'tsconfig*.json'], { 
            cwd: projectRoot, 
            ignore: ['**/node_modules/**'] 
        });
        return tsFiles.length > 0;
    }

    // 4. Build tools & config based
    const buildToolConfigs = {
        'vite': 'vite.config.*',
        'webpack': 'webpack.config.*',
        'rollup': 'rollup.config.*',
        'parcel': '.parcelrc'
    };
    if (buildToolConfigs[dependency]) {
        const configs = await glob([buildToolConfigs[dependency]], { cwd: projectRoot, ignore: ['**/node_modules/**']});
        return configs.length > 0;
    }

    // Plugins/Loaders usually tied to build tools
    if (dependency.includes('plugin') || dependency.includes('loader')) {
        return false;
    }

    // For any remaining tooling (linters etc) that reached this point:
    // They are not in code, not in scripts, and have no detected configs.
    return false;
}


function isWorkspaceDependency(pkg, depName) {
    if (!depName) return false;
    if (depName.startsWith('@workspace/') || depName.startsWith('workspace:')) return true;
    const version = (pkg.dependencies && pkg.dependencies[depName]) ||
                    (pkg.devDependencies && pkg.devDependencies[depName]) ||
                    (pkg.peerDependencies && pkg.peerDependencies[depName]) ||
                    (pkg.optionalDependencies && pkg.optionalDependencies[depName]);
    if (typeof version === 'string' && (version.startsWith('workspace:') || version.startsWith('link:') || version.startsWith('file:'))) {
        return true;
    }
    return false;
}

function isTsconfigAlias(projectRoot, depName) {
    if (!depName) return false;
    if (depName.startsWith('@/') || depName.startsWith('~/') || depName.startsWith('#') || depName.startsWith('$')) return true;
    try {
        for (const cfgName of ['tsconfig.json', 'jsconfig.json', 'tsconfig.app.json', 'tsconfig.base.json']) {
            const p = path.join(projectRoot, cfgName);
            if (fs.existsSync(p)) {
                const cfg = fs.readJsonSync(p);
                if (cfg && cfg.compilerOptions && cfg.compilerOptions.paths) {
                    for (const aliasKey of Object.keys(cfg.compilerOptions.paths)) {
                        const prefix = aliasKey.replace(/\/\*$/, '').replace(/\*$/, '');
                        if (prefix && depName.startsWith(prefix)) return true;
                    }
                }
            }
        }
    } catch (_e) {}
    return false;
}

function rootPackageName(specifier) {
    if (typeof specifier !== 'string' || !specifier) return null;
    const parts = specifier.split('/');
    return specifier.startsWith('@')
        ? parts.slice(0, 2).join('/')
        : parts[0];
}

function isPackageSelfReference(specifier, projectPackageName) {
    return Boolean(projectPackageName) && rootPackageName(specifier) === projectPackageName;
}

/**
 * Membaca seluruh section dependency yang relevan. Key lama tetap tersedia.
 */
export async function getDeclaredDependencies(projectRoot) {
    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (!await fs.pathExists(packageJsonPath)) {
        throw new Error('File package.json tidak ditemukan di: ' + projectRoot);
    }

    const pkg = await fs.readJson(packageJsonPath);
    const runtimeDeps = new Set(Object.keys(pkg.dependencies || {}));
    const devDeps = new Set(Object.keys(pkg.devDependencies || {}));
    const peerDeps = new Set(Object.keys(pkg.peerDependencies || {}));
    const optionalDeps = new Set(Object.keys(pkg.optionalDependencies || {}));
    const allDeclared = new Set([
        ...runtimeDeps,
        ...devDeps,
        ...peerDeps,
        ...optionalDeps,
    ]);

    return {
        runtimeDeps,
        devDeps,
        peerDeps,
        optionalDeps,
        allDeclared,
        pkg,
    };
}

function stripQuotes(token) {
    if (typeof token !== 'string' || token.length < 2) return token;
    const first = token[0];
    const last = token[token.length - 1];
    if ((first === '"' && last === '"') || (first === '\'' && last === '\'') || (first === '`' && last === '`')) {
        return token.slice(1, -1);
    }
    return token;
}

function tokenizeCommand(segment) {
    return (segment.match(/"[^"]*"|'[^']*'|`[^`]*`|[^\s]+/g) || [])
        .map(stripQuotes)
        .filter(Boolean);
}

function splitCommandSegments(script) {
    const segments = [];
    let current = '';
    let quote = null;
    let escaped = false;

    for (let i = 0; i < script.length; i++) {
        const char = script[i];
        if (escaped) {
            current += char;
            escaped = false;
            continue;
        }
        if (char === '\\') {
            current += char;
            escaped = true;
            continue;
        }
        if (quote) {
            current += char;
            if (char === quote) quote = null;
            continue;
        }
        if (char === '"' || char === '\'' || char === '`') {
            quote = char;
            current += char;
            continue;
        }

        const twoChars = script.slice(i, i + 2);
        if (twoChars === '&&' || twoChars === '||') {
            if (current.trim()) segments.push(current.trim());
            current = '';
            i++;
            continue;
        }
        if (char === ';' || char === '|') {
            if (current.trim()) segments.push(current.trim());
            current = '';
            continue;
        }
        current += char;
    }

    if (current.trim()) segments.push(current.trim());
    return segments;
}

function isEnvironmentAssignment(token) {
    return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

function isLocalExecutable(command) {
    if (/^@[^/]+\/[^/]+$/.test(command)) return false;
    return command.startsWith('.') ||
        command.startsWith('/') ||
        command.includes('\\') ||
        command.includes('/') ||
        /\.(?:js|cjs|mjs|ts|cts|mts|sh|cmd|bat|ps1)$/i.test(command);
}

function normalizeRunnerTarget(command) {
    if (!command) return command;
    const withoutExtension = command.replace(/\.(?:cmd|exe)$/i, '');
    if (withoutExtension.startsWith('@')) {
        const lastAt = withoutExtension.lastIndexOf('@');
        const slash = withoutExtension.indexOf('/');
        return lastAt > slash ? withoutExtension.slice(0, lastAt) : withoutExtension;
    }
    const versionSeparator = withoutExtension.indexOf('@');
    return versionSeparator > 0 ? withoutExtension.slice(0, versionSeparator) : withoutExtension;
}

function firstNonFlag(tokens, startIndex) {
    for (let i = startIndex; i < tokens.length; i++) {
        if (tokens[i] === '--') return tokens[i + 1] || null;
        if (!tokens[i].startsWith('-')) return tokens[i];
    }
    return null;
}

const CLI_INJECTION_FLAGS = new Set([
    '-r', '--require', '--import', '--loader', '--plugin',
    '--preset', '--extends', '--template', '--parser', '--compiler'
]);

function extractCliFlagDependencies(tokens, scriptName, commands) {
    for (let i = 0; i < tokens.length; i++) {
        let token = tokens[i];
        let dep = null;

        if (token.includes('=')) {
            const [flag, value] = token.split('=', 2);
            if (CLI_INJECTION_FLAGS.has(flag) && value) {
                dep = value;
            }
        } else if (CLI_INJECTION_FLAGS.has(token)) {
            dep = tokens[i + 1];
            if (dep && dep.startsWith('-')) dep = null;
        }

        if (dep) {
            // Filter local paths
            if (!dep.startsWith('.') && !dep.startsWith('/') && !dep.includes('\\')) {
                commands.push({ command: dep, scriptName, isCliFlag: true });
            }
        }
    }
}

function extractScriptCommands(pkg) {
    const commands = [];
    if (!pkg.scripts || typeof pkg.scripts !== 'object') return commands;

    for (const [scriptName, script] of Object.entries(pkg.scripts)) {
        if (typeof script !== 'string') continue;
        const segments = splitCommandSegments(script);

        for (const segment of segments) {
            const tokens = tokenizeCommand(segment);
            
            // Ekstraksi flag injeksi dependensi
            extractCliFlagDependencies(tokens, scriptName, commands);
            
            while (tokens.length > 0 && isEnvironmentAssignment(tokens[0])) tokens.shift();
            if (tokens.length === 0) continue;

            if (tokens[0] === 'env') {
                tokens.shift();
                while (tokens.length > 0 && isEnvironmentAssignment(tokens[0])) tokens.shift();
            }

            if (tokens[0] === 'cross-env' || tokens[0] === 'cross-env-shell') {
                commands.push({ command: tokens[0], scriptName, explicitRunner: false });
                tokens.shift();
                while (tokens.length > 0 && (tokens[0].startsWith('-') || isEnvironmentAssignment(tokens[0]))) {
                    tokens.shift();
                }
            }
            if (tokens.length === 0) continue;

            const head = normalizeRunnerTarget(tokens[0]);
            if (head === 'npx' || head === 'bunx') {
                const target = firstNonFlag(tokens, 1);
                if (target) commands.push({
                    command: normalizeRunnerTarget(target),
                    scriptName,
                    explicitRunner: true,
                });
                continue;
            }

            if (head === 'npm' || head === 'pnpm' || head === 'yarn' || head === 'bun') {
                const subcommand = tokens[1];
                if (['exec', 'x', 'dlx'].includes(subcommand)) {
                    const target = firstNonFlag(tokens, 2);
                    if (target) commands.push({
                        command: normalizeRunnerTarget(target),
                        scriptName,
                        explicitRunner: true,
                    });
                } else if ((head === 'yarn' || head === 'pnpm') && !Object.hasOwn(pkg.scripts, subcommand)) {
                    if (subcommand && !['run', 'install', 'add', 'remove'].includes(subcommand) && !subcommand.startsWith('-')) {
                        commands.push({
                            command: normalizeRunnerTarget(subcommand),
                            scriptName,
                            explicitRunner: true,
                        });
                    }
                }
                continue;
            }

            commands.push({ command: head, scriptName, explicitRunner: false });
        }
    }

    return commands;
}

function addAlias(aliasMap, alias, dependency) {
    if (!alias) return;
    if (!aliasMap.has(alias)) aliasMap.set(alias, new Set());
    aliasMap.get(alias).add(dependency);
}

async function buildBinaryAliasMap(dependencies, projectRoot) {
    const aliases = new Map();
    for (const dependency of dependencies) {
        addAlias(aliases, dependency, dependency);
        addAlias(aliases, dependency.startsWith('@') ? dependency.split('/').pop() : dependency, dependency);
        for (const alias of COMMON_BIN_ALIASES.get(dependency) || []) {
            addAlias(aliases, alias, dependency);
        }
        if (projectRoot) {
            try {
                const depPkgPath = path.join(projectRoot, 'node_modules', dependency, 'package.json');
                if (await fs.pathExists(depPkgPath)) {
                    const depPkg = await fs.readJson(depPkgPath).catch(() => null);
                    if (depPkg && depPkg.bin) {
                        if (typeof depPkg.bin === 'string') {
                            const binName = depPkg.name ? (depPkg.name.startsWith('@') ? depPkg.name.split('/').pop() : depPkg.name) : dependency;
                            addAlias(aliases, binName, dependency);
                        } else if (typeof depPkg.bin === 'object' && depPkg.bin !== null) {
                            for (const binName of Object.keys(depPkg.bin)) {
                                addAlias(aliases, binName, dependency);
                            }
                        }
                    }
                }
            } catch (_err) {
                // Abaikan error pembacaan agar tidak menghentikan alur analisis
            }
        }
    }
    return aliases;
}

async function analyzePackageScripts(pkg, executableDependencies, projectRoot) {
    const usedPackages = new Set();
    const missingBinaries = new Set();
    const scriptBinaries = new Set();
    const diagnostics = [];
    const aliases = await buildBinaryAliasMap(executableDependencies, projectRoot);

    for (const commandInfo of extractScriptCommands(pkg)) {
        const command = commandInfo.command;
        if (!command || isLocalExecutable(command) || SYSTEM_SCRIPT_COMMANDS.has(command)) continue;
        scriptBinaries.add(command);

        const matches = aliases.get(command);
        if (matches?.size) {
            matches.forEach(dependency => usedPackages.add(dependency));
            if (matches.size > 1) {
                diagnostics.push({
                    source: 'package.json#scripts',
                    code: 'SCRIPT_BINARY_AMBIGUOUS',
                    severity: 'warning',
                    message: `Binary '${command}' cocok dengan beberapa dependency: ${[...matches].join(', ')}.`,
                    script: commandInfo.scriptName,
                    affectsDependencyClassification: false,
                });
            }
        } else {
            missingBinaries.add(command);
        }
    }

    return {
        usedPackages,
        missingBinaries: [...missingBinaries],
        scriptBinaries,
        diagnostics,
    };
}

function finding(dependency, section, status, reason, evidence = []) {
    return {
        dependency,
        section,
        status,
        confidence: status === 'unknown' ? 'low' : 'high',
        reason,
        evidence,
    };
}

function evidenceFor(dependency, sourceUsed, usedViaCli, configUsed, implicitProtected) {
    const evidence = [];
    if (sourceUsed.has(dependency)) evidence.push('source');
    if (usedViaCli.has(dependency)) evidence.push('script');
    if (configUsed.has(dependency)) evidence.push('config');
    if (implicitProtected.has(dependency)) evidence.push('framework-implicit');
    return evidence;
}

async function analyzeShellScripts(projectRoot) {
    const usedPackages = new Set();
    const diagnostics = [];

    // Set perintah sistem yang tidak boleh dianggap sebagai npm package
    const SHELL_SYSTEM_COMMANDS = new Set([
        ...SYSTEM_SCRIPT_COMMANDS,
        'source', 'export', 'local', 'read', 'exec', 'eval', 'trap',
        'cat', 'ls', 'grep', 'sed', 'awk', 'cut', 'sort', 'head', 'tail', 'wc',
        'chmod', 'chown', 'ln', 'touch', 'find', 'xargs', 'tee', 'kill', 'ps',
        'if', 'then', 'else', 'fi', 'for', 'do', 'done', 'while', 'case', 'esac',
        'return', 'continue', 'break', 'function', 'type', 'which', 'dirname',
    ]);

    try {
        // DIPERLUAS: sertakan folder .husky/ di samping file .sh/.bash
        // Catatan: .git/hooks/* dikecualikan karena berisi file *.sample teks prosa
        const shellFiles = await glob([
            '**/*.sh',
            '**/*.bash',
            '.husky/*',
            '.githooks/*',
        ], {
            cwd: projectRoot,
            ignore: ['**/node_modules/**'],
            absolute: true,
        });

        // Regex lama: flags seperti --require, --plugin, dll.
        const flagRegex = /(?:^|\\s)(?:-r|--require|--import|--loader|--plugin|--preset|--extends|--template|--parser|--compiler)(?:=|\\s+)(['"]?)([a-zA-Z0-9_.-@/]+)\\1/g;

        // Regex bare command yang AMAN:
        // Cocok dengan perintah yang memiliki tanda hubung (pola npm package)
        // atau diawali dengan @ (scoped package), seperti: lint-staged, release-it, @scope/tool
        // Juga menangani: yarn lint-staged, npx lint-staged, pnpm lint-staged
        // Regex ini TIDAK cocok dengan kata-kata Inggris biasa (tidak punya tanda hubung)
        const bareNpmCommandRegex = /(?:^|[;|&]|then\s|do\s)\s*(?:npx\s+|bunx\s+|yarn\s+(?:exec\s+|dlx\s+)?|pnpm\s+(?:exec\s+|dlx\s+)?)?(@[a-zA-Z][\w-]*\/[\w-]+|[a-zA-Z][\w]*-[\w-]+)(?:\s|$)/gm;

        for (const file of shellFiles) {
            try {
                const content = await fs.readFile(file, 'utf-8');

                // Hanya proses bare command pada file yang memiliki shebang shell
                // atau berasal dari folder .husky / .githooks (pasti script)
                const isShellScript = content.trimStart().startsWith('#!') ||
                    file.includes('/.husky/') ||
                    file.includes('\\.husky\\') ||
                    file.includes('/.githooks/') ||
                    file.includes('\\.githooks\\');

                // Proses regex flag lama (untuk semua file)
                let match;
                flagRegex.lastIndex = 0;
                while ((match = flagRegex.exec(content)) !== null) {
                    const dep = match[2];
                    if (dep && !dep.startsWith('.') && !dep.startsWith('/') && !dep.includes('\\')) {
                        usedPackages.add(dep);
                    }
                }

                // Proses bare npm command — HANYA untuk file shell yang teridentifikasi
                if (isShellScript) {
                    for (const bareMatch of content.matchAll(bareNpmCommandRegex)) {
                        const cmd = bareMatch[1].trim();
                        if (!cmd || SHELL_SYSTEM_COMMANDS.has(cmd)) continue;
                        usedPackages.add(cmd);
                    }
                }
            } catch (_err) {
                // Abaikan file individual yang gagal dibaca
            }
        }
    } catch (err) {
        diagnostics.push({
            source: 'shell-scripts',
            code: 'SHELL_SCRIPT_ANALYSIS_FAILED',
            severity: 'warning',
            message: `Gagal memindai skrip shell: ${err.message}`,
            affectsDependencyClassification: false,
        });
    }

    return { usedPackages, diagnostics };
}




/**
 * Memeriksa peerDependencies dari setiap paket yang sudah dideklarasikan.
 * Paket yang menjadi peer dependency dan SUDAH ADA di root package.json
 * akan ditambahkan ke implicitProtected agar tidak dilabeli dead/unused.
 *
 * Bersifat konservatif: hanya melindungi, tidak pernah menambahkan paket baru.
 *
 * @param {string} projectRoot
 * @param {Set<string>} allDeclared - Semua paket yang dideklarasikan di root package.json
 * @returns {Promise<Set<string>>}
 */
async function analyzePeerDependencies(projectRoot, allDeclared) {
    const peerProtected = new Set();
    const PEER_SCAN_LIMIT = 300; // batas jumlah paket yang diperiksa agar tidak lambat
    let scanned = 0;

    for (const pkg of allDeclared) {
        if (scanned++ >= PEER_SCAN_LIMIT) break;
        const pkgJsonPath = path.join(projectRoot, 'node_modules', pkg, 'package.json');
        if (!fs.existsSync(pkgJsonPath)) continue;

        try {
            const pkgData = fs.readJsonSync(pkgJsonPath);
            const peers = Object.keys(pkgData.peerDependencies || {});
            for (const peer of peers) {
                const peerRoot = peer.startsWith('@') ? peer.split('/').slice(0, 2).join('/') : peer.split('/')[0];
                // Hanya lindungi jika memang sudah dideklarasikan oleh pengguna
                if (allDeclared.has(peerRoot)) {
                    peerProtected.add(peerRoot);
                }
            }
        } catch (_e) { /* abaikan */ }
    }

    return peerProtected;
}

/**
 * Menganalisis anomali dependency tanpa memodifikasi Set `usedPackages` milik caller.
 *
 * Kontrak lama dipertahankan. Field baru:
 * - uncertain / uncertainDependencies
 * - uncertainDevDeps
 * - findings
 * - diagnostics
 * - peerDeclared / optionalDeclared / allDeclared
 */
export async function findUnusedDependencies(projectRoot, usedPackages, ruleEngine = null) {
    const {
        runtimeDeps,
        devDeps,
        peerDeps,
        optionalDeps,
        allDeclared,
        pkg,
    } = await getDeclaredDependencies(projectRoot);

    const sourceUsedPackages = new Set(usedPackages || []);
    const effectiveUsedPackages = new Set(sourceUsedPackages);
    const diagnostics = [];
    const workspaceAnalysisComplete = !pkg.workspaces;

    if (!workspaceAnalysisComplete) {
        diagnostics.push({
            source: 'package.json#workspaces',
            code: 'WORKSPACE_MANIFEST_SCOPE_UNSUPPORTED',
            severity: 'warning',
            message: 'Manifest workspace belum dianalisis per-package; dependency tanpa bukti diperlakukan sebagai unknown.',
            affectsDependencyClassification: true,
        });
    }

    // Script executables intentionally use runtime + dev dependency sections.
    const scriptReport = await analyzePackageScripts(pkg, new Set([...runtimeDeps, ...devDeps]), projectRoot);
    scriptReport.usedPackages.forEach(dependency => effectiveUsedPackages.add(dependency));
    diagnostics.push(...scriptReport.diagnostics);

    const configReport = await runConfigParsersDetailed(projectRoot);
    const configUsedPackages = configReport.usedPackages;
    configUsedPackages.forEach(dependency => effectiveUsedPackages.add(dependency));
    diagnostics.push(...configReport.diagnostics);

    const shellScriptReport = await analyzeShellScripts(projectRoot);
    shellScriptReport.usedPackages.forEach(dependency => effectiveUsedPackages.add(dependency));
    diagnostics.push(...shellScriptReport.diagnostics);

    // A framework relationship protects declared packages from false positives, but
    // is not direct usage evidence and must never manufacture a missing dependency.
    const implicitProtected = new Set();
    for (const [framework, dependencies] of IMPLICIT_DEPENDENCIES.entries()) {
        if (!allDeclared.has(framework) && !effectiveUsedPackages.has(framework)) continue;
        if (allDeclared.has(framework) && !effectiveUsedPackages.has(framework)) {
            implicitProtected.add(framework);
        }
        for (const dependency of dependencies) {
            if (allDeclared.has(dependency) && !effectiveUsedPackages.has(dependency)) {
                implicitProtected.add(dependency);
            }
        }
    }

    // Safeguard: lindungi paket yang menjadi peer dependency dari paket lain
    // yang sudah dideklarasikan. Hanya melindungi, tidak pernah menambahkan paket baru.
    const peerProtected = await analyzePeerDependencies(projectRoot, allDeclared);
    for (const dep of peerProtected) {
        implicitProtected.add(dep);
    }

    const findings = [];
    const unusedRuntime = [];
    const uncertainRuntime = [];
    
    const combinedScriptUsed = new Set([...scriptReport.usedPackages, ...shellScriptReport.usedPackages]);

    for (const dependency of runtimeDeps) {
        const evidence = evidenceFor(
            dependency,
            sourceUsedPackages,
            combinedScriptUsed,
            configUsedPackages,
            implicitProtected,
        );

        if (effectiveUsedPackages.has(dependency)) {
            findings.push(finding(dependency, 'dependencies', 'used', 'Dependency memiliki bukti penggunaan.', evidence));
            continue;
        }
        if (ruleEngine?.isIgnoredDependency(dependency)) {
            findings.push(finding(dependency, 'dependencies', 'ignored', 'Dependency dilindungi oleh ignoreDependencies.'));
            continue;
        }
        if (isWorkspaceDependency(pkg, dependency)) {
            findings.push(finding(dependency, 'dependencies', 'ignored', 'Dependency dikelola sebagai paket monorepo workspace.'));
            continue;
        }
        if (implicitProtected.has(dependency)) {
            findings.push(finding(
                dependency,
                'dependencies',
                'ignored',
                'Bukti kuat dari Framework Guard melindungi dependency ini secara otomatis.',
                ['framework-implicit'],
            ));
            continue;
        }
        if (await validateHeuristicExclusion(dependency, projectRoot, allDeclared, effectiveUsedPackages)) {
            findings.push(finding(
                dependency,
                'dependencies',
                'ignored',
                'Dependency dilindungi secara otomatis oleh classifier (tipe bawaan/tooling).',
                ['heuristic-exclusion'],
            ));
            continue;
        }
        if (!workspaceAnalysisComplete) {
            uncertainRuntime.push(dependency);
            findings.push(finding(
                dependency,
                'dependencies',
                'unknown',
                'Manifest workspace belum dianalisis per-package.',
                ['workspace-analysis-incomplete'],
            ));
            continue;
        }
        if (!configReport.complete) {
            uncertainRuntime.push(dependency);
            findings.push(finding(
                dependency,
                'dependencies',
                'unknown',
                'Config proyek tidak dapat dianalisis sepenuhnya secara statis.',
                ['config-incomplete'],
            ));
            continue;
        }

        unusedRuntime.push(dependency);
        findings.push(finding(
            dependency,
            'dependencies',
            'unused',
            'Tidak ditemukan penggunaan di source, scripts, config, atau aturan framework.',
        ));
    }

    const missing = [];
    const phantomDeps = [];
    const nestedDeps = [];
    const selfReferences = new Set();
    const nestedDeclaredDepsSet = new Set();
    
    if (workspaceAnalysisComplete) {
        // Safeguard: Collect dependencies declared in any nested package.json
        const nestedPackageJsonPaths = await glob('**/package.json', { 
            cwd: projectRoot, 
            ignore: ['**/node_modules/**', 'package.json'] 
        });
        
        for (const nestedPath of nestedPackageJsonPaths) {
            const fullPath = path.join(projectRoot, nestedPath);
            try {
                const nestedPkg = await fs.readJson(fullPath);
                const deps = [
                    ...Object.keys(nestedPkg.dependencies || {}),
                    ...Object.keys(nestedPkg.devDependencies || {}),
                    ...Object.keys(nestedPkg.peerDependencies || {}),
                    ...Object.keys(nestedPkg.optionalDependencies || {})
                ];
                deps.forEach(d => nestedDeclaredDepsSet.add(d));
            } catch(e) {}
        }

        for (const dependency of effectiveUsedPackages) {
            if (dependency.startsWith('.') || dependency.startsWith('/') || path.isAbsolute(dependency)) continue;
            if (dependency.startsWith('@/') || dependency.startsWith('~/') || dependency.startsWith('#') || dependency.startsWith('$')) continue;
            if (isTsconfigAlias(projectRoot, dependency)) continue;
            if (isWorkspaceDependency(pkg, dependency)) continue;
            if (NODE_BUILTINS.has(dependency)) continue;
            if (isPackageSelfReference(dependency, pkg.name)) {
                selfReferences.add(rootPackageName(dependency));
                continue;
            }
            if (allDeclared.has(dependency)) continue;
            
            // Check if it's a phantom dependency (installed in node_modules but not declared)
            const depNodeModulesPath = path.join(projectRoot, 'node_modules', dependency);
            if (fs.existsSync(depNodeModulesPath)) {
                phantomDeps.push(dependency);
            } else if (nestedDeclaredDepsSet.has(dependency)) {
                nestedDeps.push(dependency);
            } else {
                missing.push(dependency);
            }
        }
    }

    const deadDevDeps = [];
    const uncertainDevDeps = [];
    for (const dependency of devDeps) {
        const evidence = evidenceFor(
            dependency,
            sourceUsedPackages,
            combinedScriptUsed,
            configUsedPackages,
            implicitProtected,
        );

        if (effectiveUsedPackages.has(dependency)) {
            findings.push(finding(dependency, 'devDependencies', 'used', 'Dev dependency memiliki bukti penggunaan.', evidence));
            continue;
        }
        if (ruleEngine?.isIgnoredDependency(dependency)) {
            findings.push(finding(dependency, 'devDependencies', 'ignored', 'Dependency dilindungi oleh ignoreDependencies.'));
            continue;
        }
        if (isWorkspaceDependency(pkg, dependency)) {
            findings.push(finding(dependency, 'devDependencies', 'ignored', 'Dev dependency dikelola sebagai paket monorepo workspace.'));
            continue;
        }
        if (implicitProtected.has(dependency)) {
            findings.push(finding(
                dependency,
                'devDependencies',
                'ignored',
                'Bukti kuat dari Framework Guard melindungi dev dependency ini secara otomatis.',
                ['framework-implicit'],
            ));
            continue;
        }
        if (await validateHeuristicExclusion(dependency, projectRoot, allDeclared, effectiveUsedPackages)) {
            findings.push(finding(
                dependency,
                'devDependencies',
                'ignored',
                'Dev dependency dilindungi secara otomatis oleh classifier (tipe bawaan/tooling).',
                ['heuristic-exclusion'],
            ));
            continue;
        }
        if (!workspaceAnalysisComplete) {
            uncertainDevDeps.push(dependency);
            findings.push(finding(
                dependency,
                'devDependencies',
                'unknown',
                'Manifest workspace belum dianalisis per-package.',
                ['workspace-analysis-incomplete'],
            ));
            continue;
        }
        if (!configReport.complete) {
            uncertainDevDeps.push(dependency);
            findings.push(finding(
                dependency,
                'devDependencies',
                'unknown',
                'Config proyek tidak dapat dianalisis sepenuhnya secara statis.',
                ['config-incomplete'],
            ));
            continue;
        }

        deadDevDeps.push(dependency);
        findings.push(finding(
            dependency,
            'devDependencies',
            'unused',
            'Tidak ditemukan penggunaan di source, scripts, atau config.',
        ));
    }

    return {
        // Kontrak lama
        unused: unusedRuntime,
        missing,
        phantomDeps,
        nestedDeps,
        selfReferences,
        missingBinaries: scriptReport.missingBinaries,
        deadDevDeps,
        declared: runtimeDeps,
        devDeclared: devDeps,
        used: effectiveUsedPackages,
        configUsed: configUsedPackages,
        usedViaCli: scriptReport.usedPackages,
        totalDeclared: runtimeDeps.size,
        totalUsed: effectiveUsedPackages.size,
        totalUnused: unusedRuntime.length,
        totalMissing: missing.length,
        totalDeadDev: deadDevDeps.length,

        // Kontrak aditif untuk klasifikasi konservatif
        peerDeclared: peerDeps,
        optionalDeclared: optionalDeps,
        allDeclared,
        uncertain: uncertainRuntime,
        uncertainDependencies: uncertainRuntime,
        uncertainDevDeps,
        findings,
        diagnostics,
        scriptBinaries: scriptReport.scriptBinaries,
        configAnalysisComplete: configReport.complete,
        workspaceAnalysisComplete,
        totalUncertain: uncertainRuntime.length,
        totalUncertainDev: uncertainDevDeps.length,
    };
}
