import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import {
    ConfigValidationError,
    validateAndNormalizeConfig,
} from '../../../src/analyzer/configValidator.js';
import { RuleEngine } from '../../../src/analyzer/ruleEngine.js';

const DEFAULTS = {
    mode: 'vanilla',
    framework: 'vanilla',
    ignorePrefixedVariables: '^_',
    preserveExports: true,
    preserveUnsafeFiles: true,
    detectDeadStores: true,
    preserveFiles: [],
    ignoreFiles: [],
    ignoreDependencies: [],
    entryPoints: [],
    eliminator: {
        autoRenameUnusedParameters: false,
        autoRemoveEmptyBlocks: false,
        maxBackups: 20,
    },
    globals: [],
    overrides: [],
};

describe('configValidator', () => {
    it('menormalisasi shorthand dan tetap mempertahankan default nested', () => {
        const result = validateAndNormalizeConfig({
            entryPoints: 'src\\index.ts',
            preserveExports: 'strict',
            eliminator: { maxBackups: 5 },
        }, DEFAULTS);

        expect(result.config.entryPoints).toEqual(['src/index.ts']);
        expect(result.config.preserveExports).toBe('strict');
        expect(result.config.eliminator).toEqual({
            autoRenameUnusedParameters: false,
            autoRemoveEmptyBlocks: false,
            maxBackups: 5,
        });
        expect(result.diagnostics).toContainEqual(expect.objectContaining({
            level: 'warning',
            code: 'CONFIG_LIST_NORMALIZED',
            path: 'entryPoints',
        }));
    });

    it('menolak tipe, mode, dan regex yang tidak aman', () => {
        expect(() => validateAndNormalizeConfig({
            mode: 'express',
            preserveUnsafeFiles: 'yes',
            ignorePrefixedVariables: '[',
        }, DEFAULTS)).toThrow(ConfigValidationError);

        try {
            validateAndNormalizeConfig({ mode: 'express' }, DEFAULTS);
        } catch (error) {
            expect(error.code).toBe('DEADKILLER_INVALID_CONFIG');
            expect(error.diagnostics).toContainEqual(expect.objectContaining({
                code: 'CONFIG_INVALID_MODE',
                path: 'mode',
            }));
        }
    });

    it('mewajibkan pola files pada setiap override', () => {
        expect(() => validateAndNormalizeConfig({
            overrides: [{ preserveExports: false }],
        }, DEFAULTS)).toThrowError(/Override wajib memiliki files/);
    });

    it('menolak key tidak dikenal agar typo proteksi tidak diabaikan', () => {
        expect(() => validateAndNormalizeConfig({
            preserveFile: ['critical.js'],
        }, DEFAULTS)).toThrowError(expect.objectContaining({
            code: 'DEADKILLER_INVALID_CONFIG',
            diagnostics: expect.arrayContaining([
                expect.objectContaining({
                    level: 'error',
                    code: 'CONFIG_UNKNOWN_KEY',
                    path: 'preserveFile',
                }),
            ]),
        }));
    });

    it('menolak glob dengan bracket yang tidak seimbang', () => {
        expect(() => validateAndNormalizeConfig({
            ignoreFiles: ['src/[generated.js'],
        }, DEFAULTS)).toThrowError(expect.objectContaining({
            diagnostics: expect.arrayContaining([
                expect.objectContaining({ code: 'CONFIG_INVALID_GLOB' }),
            ]),
        }));
    });

    it('menolak field tingkat proyek di dalam override', () => {
        expect(() => validateAndNormalizeConfig({
            overrides: [{ files: ['test/**'], entryPoints: ['test/index.js'] }],
        }, DEFAULTS)).toThrowError(expect.objectContaining({
            diagnostics: expect.arrayContaining([
                expect.objectContaining({ code: 'CONFIG_OVERRIDE_FIELD_NOT_ALLOWED' }),
            ]),
        }));
    });

    it('menolak pasangan framework dan mode yang bertentangan', () => {
        expect(() => validateAndNormalizeConfig({
            mode: 'vanilla',
            framework: 'next',
        }, DEFAULTS)).toThrowError(expect.objectContaining({
            diagnostics: expect.arrayContaining([
                expect.objectContaining({ code: 'CONFIG_INCOMPATIBLE_FRAMEWORK_MODE' }),
            ]),
        }));
    });
});

describe('RuleEngine config lifecycle', () => {
    let projectRoot;

    beforeEach(async () => {
        projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'deadkiller-config-'));
        await fs.writeJson(path.join(projectRoot, 'package.json'), {
            name: 'config-fixture',
            type: 'module',
        });
    });

    afterEach(async () => {
        await fs.remove(projectRoot);
    });

    it('gagal tertutup saat JSON config rusak', async () => {
        await fs.writeFile(path.join(projectRoot, '.deadkillerrc.json'), '{ invalid json');
        const engine = new RuleEngine();

        await expect(engine.loadConfig(projectRoot)).rejects.toMatchObject({
            name: 'ConfigLoadError',
            code: 'DEADKILLER_CONFIG_LOAD_FAILED',
        });
        expect(engine.configLoaded).toBe(false);
        expect(engine.configValid).toBe(false);
        expect(engine.configDiagnostics[0]).toEqual(expect.objectContaining({
            level: 'error',
        }));
    });

    it('memuat config valid dan mengekspos warning normalisasi', async () => {
        await fs.writeJson(path.join(projectRoot, '.deadkillerrc.json'), {
            mode: 'react',
            entryPoints: 'src/index.jsx',
        });
        const engine = new RuleEngine();

        const state = await engine.loadConfig(projectRoot);

        expect(state.loaded).toBe(true);
        expect(state.source).toBe('file');
        expect(state.profile).toEqual(expect.objectContaining({
            packageName: 'config-fixture',
        }));
        expect(engine.configValid).toBe(true);
        expect(engine.rules.entryPoints).toEqual(['src/index.jsx']);
        expect(state.diagnostics).toContainEqual(expect.objectContaining({
            code: 'CONFIG_LIST_NORMALIZED',
            file: path.join(projectRoot, '.deadkillerrc.json'),
        }));
    });

    it('mewariskan profil otomatis ke config parsial', async () => {
        await fs.writeJson(path.join(projectRoot, 'package.json'), {
            name: 'partial-react-app',
            private: true,
            scripts: { dev: 'vite' },
            dependencies: { react: '^19.0.0' },
        });
        await fs.writeJson(path.join(projectRoot, '.deadkillerrc.json'), {
            globals: ['APP_VERSION'],
        });
        const engine = new RuleEngine();

        await engine.loadConfig(projectRoot);

        expect(engine.configSource).toBe('file');
        expect(engine.rules).toEqual(expect.objectContaining({
            mode: 'react',
            framework: 'react',
            reactRuntime: 'automatic',
            preserveExports: false,
            globals: ['APP_VERSION'],
        }));
        expect(engine.rules.ignoreFiles).toContain('**/coverage/**');
    });

    it('menurunkan mode dari framework pada config parsial', async () => {
        await fs.writeJson(path.join(projectRoot, '.deadkillerrc.json'), {
            framework: 'next',
        });
        const engine = new RuleEngine();

        await engine.loadConfig(projectRoot);

        expect(engine.rules.framework).toBe('next');
        expect(engine.rules.mode).toBe('next');
    });

    it('mengabaikan seluruh file config ketika policy none dipilih', async () => {
        const markerPath = path.join(projectRoot, 'config-executed.marker');
        await fs.writeFile(
            path.join(projectRoot, 'deadkiller.config.mjs'),
            `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(markerPath)}, 'executed'); export default { mode: 'next' };\n`,
        );
        const engine = new RuleEngine();

        const state = await engine.loadConfig(projectRoot, { ignoreConfig: true });

        expect(state.loaded).toBe(false);
        expect(state.source).toBe('auto');
        expect(state.policy).toBe('none');
        expect(state.ignoredPaths).toEqual([path.join(projectRoot, 'deadkiller.config.mjs')]);
        expect(await fs.pathExists(markerPath)).toBe(false);
    });

    it('menghormati negasi ordered glob pada ignore dan preserve', () => {
        const engine = new RuleEngine();
        engine.projectRoot = projectRoot;
        engine.rules.ignoreFiles = ['src/**', '!src/vendor/**'];
        engine.rules.preserveFiles = ['src/**', '!src/vendor/**'];

        expect(engine.isIgnoredFile(path.join(projectRoot, 'src', 'app.js'))).toBe(true);
        expect(engine.isIgnoredFile(path.join(projectRoot, 'src', 'vendor', 'lib.js'))).toBe(false);
        expect(engine.isPreservedFile(path.join(projectRoot, 'src', 'app.js'))).toBe(true);
        expect(engine.isPreservedFile(path.join(projectRoot, 'src', 'vendor', 'lib.js'))).toBe(false);
    });

    it('menyelaraskan framework pada override mode-only', () => {
        const engine = new RuleEngine();
        engine.projectRoot = projectRoot;
        engine.rules.mode = 'vanilla';
        engine.rules.framework = 'vanilla';
        engine.rules.overrides = [{ files: ['app/**'], mode: 'next' }];

        expect(engine.effectiveRulesFor(path.join(projectRoot, 'app', 'page.js')))
            .toEqual(expect.objectContaining({ mode: 'next', framework: 'next' }));
        expect(engine.effectiveRulesFor(path.join(projectRoot, 'src', 'index.js')))
            .toEqual(expect.objectContaining({ mode: 'vanilla', framework: 'vanilla' }));
    });

    it('mencocokkan nama direktori lama berdasarkan segmen, bukan substring', () => {
        const engine = new RuleEngine();
        engine.projectRoot = projectRoot;
        engine.rules.ignoreFiles = ['dist'];

        expect(engine.isIgnoredFile(path.join(projectRoot, 'dist', 'index.js'))).toBe(true);
        expect(engine.isIgnoredFile(path.join(projectRoot, 'packages', 'api', 'dist', 'index.js'))).toBe(true);
        expect(engine.isIgnoredFile(path.join(projectRoot, 'src', 'distinct.js'))).toBe(false);
    });

    it('tidak memperluas literal file root ke file bernama sama di workspace', () => {
        const engine = new RuleEngine();
        engine.projectRoot = projectRoot;
        engine.rules.ignoreFiles = ['src/index.js'];

        expect(engine.isIgnoredFile(path.join(projectRoot, 'src', 'index.js'))).toBe(true);
        expect(engine.isIgnoredFile(
            path.join(projectRoot, 'packages', 'api', 'src', 'index.js'),
        )).toBe(false);
    });

    it('melindungi file convention Next tanpa melindungi helper app biasa', () => {
        const engine = new RuleEngine();
        engine.projectRoot = projectRoot;
        engine.rules.mode = 'next';
        engine.rules.framework = 'next';

        expect(engine.isPreservedFile(path.join(projectRoot, 'app', 'page.tsx'))).toBe(true);
        expect(engine.isPreservedFile(path.join(projectRoot, 'instrumentation.ts'))).toBe(true);
        expect(engine.isPreservedFile(path.join(projectRoot, 'proxy.ts'))).toBe(true);
        expect(engine.isPreservedFile(path.join(projectRoot, 'app', 'lib', 'dead.ts'))).toBe(false);
    });

    it('menerapkan profil React otomatis tanpa menulis file konfigurasi', async () => {
        await fs.writeJson(path.join(projectRoot, 'package.json'), {
            name: 'react-app',
            type: 'module',
            scripts: { dev: 'vite' },
            dependencies: { react: '^19.0.0', 'react-dom': '^19.0.0' },
        });
        await fs.ensureDir(path.join(projectRoot, 'src'));
        await fs.writeFile(path.join(projectRoot, 'src', 'App.jsx'), 'export default function App() {}\n');
        const engine = new RuleEngine();

        const state = await engine.loadConfig(projectRoot);

        expect(state.loaded).toBe(false);
        expect(state.source).toBe('auto');
        expect(state.path).toBeNull();
        expect(state.profile).toEqual(expect.objectContaining({
            hasPackageJson: true,
            framework: 'react',
            projectType: 'application',
        }));
        expect(engine.rules).toEqual(expect.objectContaining({
            mode: 'react',
            reactRuntime: 'automatic',
            preserveExports: false,
            preserveUnsafeFiles: true,
        }));
        expect(engine.rules.preserveFiles).toContain('**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}');
        expect(engine.rules.ignoreFiles).toContain('**/coverage/**');
        expect(await fs.pathExists(path.join(projectRoot, 'deadkiller.config.mjs'))).toBe(false);
        expect(await fs.pathExists(path.join(projectRoot, '.deadkillerrc.json'))).toBe(false);
    });

    it.each([
        ['library', { exports: './src/index.js' }],
        ['cli', { bin: { fixture: './bin/cli.js' } }],
    ])('mempertahankan API publik proyek %s pada zero-config', async (projectType, manifest) => {
        await fs.writeJson(path.join(projectRoot, 'package.json'), {
            name: `${projectType}-fixture`,
            type: 'module',
            ...manifest,
        });
        const engine = new RuleEngine();

        await engine.loadConfig(projectRoot);

        expect(engine.configSource).toBe('auto');
        expect(engine.autoProfile.projectType).toBe(projectType);
        expect(engine.rules.preserveExports).toBe(true);
    });

    it('mengenali component library meskipun memiliki dependensi framework', async () => {
        await fs.writeJson(path.join(projectRoot, 'package.json'), {
            name: 'react-components',
            type: 'module',
            exports: './src/index.js',
            scripts: { dev: 'vite' },
            peerDependencies: { react: '^19.0.0' },
        });
        const engine = new RuleEngine();

        await engine.loadConfig(projectRoot);

        expect(engine.autoProfile).toEqual(expect.objectContaining({
            framework: 'react',
            projectType: 'library',
        }));
        expect(engine.rules.mode).toBe('react');
        expect(engine.rules.preserveExports).toBe(true);
    });

    it('memakai fallback konservatif saat package.json tidak tersedia', async () => {
        await fs.remove(path.join(projectRoot, 'package.json'));
        await fs.writeFile(path.join(projectRoot, 'index.js'), 'export const publicApi = 1;\n');
        const engine = new RuleEngine();

        const state = await engine.loadConfig(projectRoot);

        expect(state.source).toBe('auto');
        expect(state.profile.hasPackageJson).toBe(false);
        expect(engine.rules.preserveExports).toBe(true);
    });

    it('menolak beberapa format config aktif agar precedence tidak ambigu', async () => {
        await fs.writeJson(path.join(projectRoot, '.deadkillerrc.json'), { mode: 'react' });
        await fs.writeFile(
            path.join(projectRoot, 'deadkiller.config.mjs'),
            "export default { mode: 'next' };\n",
        );
        const engine = new RuleEngine();

        await expect(engine.loadConfig(projectRoot)).rejects.toMatchObject({
            code: 'DEADKILLER_CONFIG_LOAD_FAILED',
            diagnostics: [expect.objectContaining({
                code: 'CONFIG_CONFLICTING_FILES',
            })],
        });
        expect(engine.configValid).toBe(false);
    });

    it('memuat ulang module config terbaru tanpa memakai cache import lama', async () => {
        const configPath = path.join(projectRoot, 'deadkiller.config.mjs');
        const engine = new RuleEngine();
        await fs.writeFile(configPath, "export default { mode: 'react' };\n");
        await engine.loadConfig(projectRoot);
        expect(engine.rules.mode).toBe('react');

        await fs.writeFile(configPath, "export default { mode: 'next' };\n");
        const future = new Date(Date.now() + 2000);
        await fs.utimes(configPath, future, future);
        await engine.loadConfig(projectRoot);

        expect(engine.rules.mode).toBe('next');
    });

    it('menolak penyimpanan rules invalid sebelum file ditulis', async () => {
        const engine = new RuleEngine();
        engine.rules.mode = 'unsupported';

        await expect(engine.saveConfig(projectRoot)).rejects.toMatchObject({
            code: 'DEADKILLER_CONFIG_SAVE_FAILED',
        });
        expect(await fs.pathExists(path.join(projectRoot, 'deadkiller.config.mjs'))).toBe(false);
    });
});
