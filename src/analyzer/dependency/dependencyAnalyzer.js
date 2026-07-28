import fs from 'fs-extra';
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

function isHeuristicallyExcluded(packageName) {
    return ALWAYS_EXCLUDED_DEV_EXACT.has(packageName) ||
        ALWAYS_EXCLUDED_DEV_PATTERNS.some(pattern => pattern.test(packageName));
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

function extractScriptCommands(pkg) {
    const commands = [];
    if (!pkg.scripts || typeof pkg.scripts !== 'object') return commands;

    for (const [scriptName, script] of Object.entries(pkg.scripts)) {
        if (typeof script !== 'string') continue;
        const segments = splitCommandSegments(script);

        for (const segment of segments) {
            const tokens = tokenizeCommand(segment);
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

    const findings = [];
    const unusedRuntime = [];
    const uncertainRuntime = [];

    for (const dependency of runtimeDeps) {
        const evidence = evidenceFor(
            dependency,
            sourceUsedPackages,
            scriptReport.usedPackages,
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
            uncertainRuntime.push(dependency);
            findings.push(finding(
                dependency,
                'dependencies',
                'unknown',
                'Relasi framework melindungi dependency, tetapi bukan bukti penggunaan langsung.',
                ['framework-implicit'],
            ));
            continue;
        }
        if (isHeuristicallyExcluded(dependency)) {
            uncertainRuntime.push(dependency);
            findings.push(finding(
                dependency,
                'dependencies',
                'unknown',
                'Dependency dilindungi heuristic exclusion; tidak ada bukti penggunaan langsung.',
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
    if (workspaceAnalysisComplete) {
        for (const dependency of effectiveUsedPackages) {
            if (dependency.startsWith('.') || dependency.startsWith('/') || path.isAbsolute(dependency)) continue;
            if (dependency.startsWith('@/') || dependency.startsWith('~/') || dependency.startsWith('#') || dependency.startsWith('$')) continue;
            if (isTsconfigAlias(projectRoot, dependency)) continue;
            if (isWorkspaceDependency(pkg, dependency)) continue;
            if (NODE_BUILTINS.has(dependency)) continue;
            if (allDeclared.has(dependency)) continue;
            missing.push(dependency);
        }
    }

    const deadDevDeps = [];
    const uncertainDevDeps = [];
    for (const dependency of devDeps) {
        const evidence = evidenceFor(
            dependency,
            sourceUsedPackages,
            scriptReport.usedPackages,
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
            uncertainDevDeps.push(dependency);
            findings.push(finding(
                dependency,
                'devDependencies',
                'unknown',
                'Relasi framework melindungi dev dependency, tetapi bukan bukti penggunaan langsung.',
                ['framework-implicit'],
            ));
            continue;
        }
        if (isHeuristicallyExcluded(dependency)) {
            uncertainDevDeps.push(dependency);
            findings.push(finding(
                dependency,
                'devDependencies',
                'unknown',
                'Dev dependency dilindungi heuristic exclusion.',
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
