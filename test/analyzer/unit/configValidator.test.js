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
    ignorePrefixedVariables: '^_',
    preserveExports: true,
    preserveUnsafeFiles: true,
    preserveFiles: [],
    ignoreFiles: [],
    ignoreDependencies: [],
    entryPoints: [],
    eliminator: {
        autoRenameUnusedParameters: false,
        autoRemoveEmptyBlocks: false,
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
        expect(engine.configValid).toBe(true);
        expect(engine.rules.entryPoints).toEqual(['src/index.jsx']);
        expect(state.diagnostics).toContainEqual(expect.objectContaining({
            code: 'CONFIG_LIST_NORMALIZED',
            file: path.join(projectRoot, '.deadkillerrc.json'),
        }));
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
