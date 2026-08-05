import { describe, it, beforeEach } from 'vitest';
import assert from 'node:assert/strict';
import path from 'path';
import fs from 'fs-extra';
import os from 'os';

import {
    RESOLUTION_REASON,
    clearResolverCache,
    resolvePath,
    resolvePathDetailed,
} from '../../../src/analyzer/graph/pathResolver.js';

async function createAliasProject() {
    const tmpDir = path.join(os.tmpdir(), `dce-alias-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
    await fs.ensureDir(tmpDir);
    await fs.ensureDir(path.join(tmpDir, 'src', 'components'));
    await fs.ensureDir(path.join(tmpDir, 'src', 'lib', 'utils'));

    await fs.writeJSON(path.join(tmpDir, 'package.json'), {
        name: 'alias-project',
        version: '1.0.0',
        imports: {
            '#utils/*': './src/lib/utils/*'
        }
    });

    // Gunakan jsconfig.json (bukan tsconfig.json) untuk menguji fallback JS project
    await fs.writeJSON(path.join(tmpDir, 'jsconfig.json'), {
        compilerOptions: {
            baseUrl: '.',
            paths: {
                '@components/*': ['./src/components/*'],
                '~/*': ['./src/*']
            }
        }
    });

    await fs.writeFile(
        path.join(tmpDir, 'src', 'components', 'Button.jsx'),
        `export default function Button() { return null; }\n`
    );

    await fs.writeFile(
        path.join(tmpDir, 'src', 'lib', 'utils', 'math.js'),
        `export function add(a, b) { return a + b; }\n`
    );

    await fs.writeFile(
        path.join(tmpDir, 'src', 'index.js'),
        `console.log('index');\n`
    );

    return tmpDir;
}

describe('Alias Resolver (jsconfig, package.json imports, default aliases)', () => {
    beforeEach(() => {
        clearResolverCache();
    });

    it('Should resolve aliases defined in jsconfig.json and #* imports from package.json', async () => {
        const tmpDir = await createAliasProject();
        try {
            const baseDir = path.join(tmpDir, 'src');

            const btnPath = await resolvePath(tmpDir, baseDir, '@components/Button');
            assert.ok(btnPath, 'Should resolve @components/Button using jsconfig.json');
            assert.equal(path.normalize(btnPath), path.normalize(path.join(tmpDir, 'src', 'components', 'Button.jsx')));

            const tildePath = await resolvePath(tmpDir, baseDir, '~/components/Button');
            assert.ok(tildePath, 'Should resolve ~/components/Button using jsconfig.json');

            const mathPath = await resolvePath(tmpDir, baseDir, '#utils/math');
            assert.ok(mathPath, 'Should resolve #utils/math from package.json imports field');
            assert.equal(path.normalize(mathPath), path.normalize(path.join(tmpDir, 'src', 'lib', 'utils', 'math.js')));
        } finally {
            await fs.remove(tmpDir);
        }
    });

    it('Should use default aliases (@, ~, $lib) when no tsconfig or jsconfig is present', async () => {
        const tmpDir = path.join(os.tmpdir(), `dce-defalias-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
        await fs.ensureDir(tmpDir);
        await fs.ensureDir(path.join(tmpDir, 'src', 'lib', 'helpers'));
        await fs.writeFile(path.join(tmpDir, 'src', 'lib', 'helpers', 'format.js'), `export const fmt = () => {};\n`);

        try {
            clearResolverCache();
            const baseDir = path.join(tmpDir, 'src');
            const formatPath = await resolvePath(tmpDir, baseDir, '$lib/helpers/format');
            assert.ok(formatPath, 'Should resolve $lib default alias to src/lib');
            assert.equal(path.normalize(formatPath), path.normalize(path.join(tmpDir, 'src', 'lib', 'helpers', 'format.js')));
        } finally {
            await fs.remove(tmpDir);
        }
    });

    it('menyubstitusi ekstensi output JavaScript ke source TypeScript ketika target JS tidak ada', async () => {
        const tmpDir = path.join(os.tmpdir(), `dce-ts-substitution-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`);
        await fs.ensureDir(path.join(tmpDir, 'src'));
        await fs.writeJson(path.join(tmpDir, 'package.json'), { name: 'ts-substitution' });
        await fs.writeFile(path.join(tmpDir, 'tsconfig.json'), '{}');
        await fs.writeFile(path.join(tmpDir, 'src', 'service.ts'), 'export const value = 1;\n');

        try {
            clearResolverCache();
            const resolved = await resolvePath(tmpDir, path.join(tmpDir, 'src'), './service.js');
            assert.equal(
                path.normalize(resolved),
                path.normalize(path.join(tmpDir, 'src', 'service.ts')),
            );
        } finally {
            await fs.remove(tmpDir);
        }
    });

    it('memakai tsconfig terdekat dari importer pada proyek monorepo', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dce-nearest-tsconfig-'));
        const packageRoot = path.join(tmpDir, 'packages', 'api');
        try {
            await fs.outputJson(path.join(tmpDir, 'tsconfig.json'), {
                compilerOptions: {
                    baseUrl: '.',
                    paths: { '@root/*': ['src/*'] },
                },
            });
            await fs.outputJson(path.join(packageRoot, 'tsconfig.json'), {
                compilerOptions: {
                    baseUrl: '.',
                    paths: { '@feature/*': ['src/features/*'] },
                },
            });
            await fs.outputFile(
                path.join(packageRoot, 'src', 'features', 'auth.ts'),
                'export const auth = true;\n',
            );

            clearResolverCache();
            const result = await resolvePathDetailed(
                tmpDir,
                path.join(packageRoot, 'src'),
                '@feature/auth',
            );

            assert.equal(result.status, 'resolved');
            assert.equal(
                path.normalize(result.path),
                path.normalize(path.join(packageRoot, 'src', 'features', 'auth.ts')),
            );
            assert.equal(
                path.normalize(result.configPath),
                path.normalize(path.join(packageRoot, 'tsconfig.json')),
            );
            assert.match(result.strategy, /^tsconfig-paths/);
        } finally {
            await fs.remove(tmpDir);
        }
    });

    it('mendukung wildcard paths bersuffix dan target fallback sesuai urutan', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dce-path-pattern-'));
        try {
            await fs.outputJson(path.join(tmpDir, 'tsconfig.json'), {
                compilerOptions: {
                    baseUrl: '.',
                    paths: {
                        '@features/*/api': [
                            'missing/features/*/api.ts',
                            'src/features/*/api/index.ts',
                        ],
                    },
                },
            });
            await fs.outputFile(
                path.join(tmpDir, 'src', 'features', 'users', 'api', 'index.ts'),
                'export const listUsers = () => [];\n',
            );

            clearResolverCache();
            const result = await resolvePathDetailed(
                tmpDir,
                path.join(tmpDir, 'src'),
                '@features/users/api',
            );

            assert.equal(result.status, 'resolved');
            assert.equal(
                path.normalize(result.path),
                path.normalize(path.join(tmpDir, 'src', 'features', 'users', 'api', 'index.ts')),
            );
            assert.ok(result.attempts.some(attempt => (
                /missing[\\/]features[\\/]users/.test(attempt.request)
            )));
        } finally {
            await fs.remove(tmpDir);
        }
    });

    it('mengembalikan diagnosis terstruktur untuk target alias yang hilang dan virtual module', async () => {
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dce-resolution-diagnostic-'));
        try {
            await fs.outputJson(path.join(tmpDir, 'tsconfig.json'), {
                compilerOptions: {
                    baseUrl: '.',
                    paths: {
                        '@missing/*': ['src/missing/*'],
                        '$app/*': ['src/app/*'],
                    },
                },
            });
            await fs.outputFile(
                path.join(tmpDir, 'src', 'app', 'navigation.ts'),
                'export const navigate = () => {};\n',
            );

            clearResolverCache();
            const unresolved = await resolvePathDetailed(
                tmpDir,
                tmpDir,
                '@missing/service',
            );
            const virtual = await resolvePathDetailed(tmpDir, tmpDir, 'virtual:generated');
            const frameworkVirtual = await resolvePathDetailed(tmpDir, tmpDir, '#imports');
            const configuredFrameworkAlias = await resolvePathDetailed(
                tmpDir,
                tmpDir,
                '$app/navigation',
            );
            const external = await resolvePathDetailed(tmpDir, tmpDir, 'not-installed-package');

            assert.equal(unresolved.status, 'unresolved');
            assert.equal(unresolved.reasonCode, RESOLUTION_REASON.PATHS_TARGET_NOT_FOUND);
            assert.ok(unresolved.attempts.length > 0);
            assert.equal(virtual.status, 'virtual');
            assert.equal(virtual.reasonCode, RESOLUTION_REASON.VIRTUAL_MODULE);
            assert.equal(frameworkVirtual.status, 'virtual');
            assert.equal(configuredFrameworkAlias.status, 'resolved');
            assert.equal(external.status, 'external');
            assert.equal(external.reasonCode, RESOLUTION_REASON.EXTERNAL_PACKAGE);
        } finally {
            await fs.remove(tmpDir);
        }
    });
});
