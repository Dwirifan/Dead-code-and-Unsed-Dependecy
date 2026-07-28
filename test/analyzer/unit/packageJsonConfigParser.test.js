import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs-extra';
import path from 'path';
import os from 'os';
import { parsePackageJsonConfigDetailed } from '../../../src/analyzer/dependency/configParsers/packageJsonConfigParser.js';
import { runConfigParsersDetailed } from '../../../src/analyzer/dependency/configParsers/configParserRunner.js';

describe('packageJsonConfigParser', () => {
    let tmpDir;

    beforeEach(async () => {
        tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deadkiller-pkg-json-config-'));
    });

    afterEach(async () => {
        if (tmpDir) {
            await fs.remove(tmpDir);
        }
    });

    it('Should extract used packages from prettier, simple-git-hooks, husky, and lint-staged', async () => {
        const pkgJson = {
            name: "test-project",
            version: "1.0.0",
            prettier: "@sxzz/prettier-config",
            "simple-git-hooks": {
                "pre-commit": "npx lint-staged"
            },
            husky: {
                "hooks": {}
            },
            "lint-staged": {
                "*.ts": ["eslint --fix", "prettier --write"]
            }
        };

        await fs.writeJson(path.join(tmpDir, 'package.json'), pkgJson);

        const result = await parsePackageJsonConfigDetailed(tmpDir);
        expect(result.complete).toBe(true);
        expect(result.packages.has('prettier')).toBe(true);
        expect(result.packages.has('@sxzz/prettier-config')).toBe(true);
        expect(result.packages.has('simple-git-hooks')).toBe(true);
        expect(result.packages.has('husky')).toBe(true);
        expect(result.packages.has('lint-staged')).toBe(true);
        expect(result.packages.has('eslint')).toBe(true); // Extracted from lint-staged command
    });

    it('Should extract used packages from stylelint, commitlint, jest, and postcss', async () => {
        const pkgJson = {
            name: "test-project-2",
            stylelint: {
                extends: ["stylelint-config-standard"]
            },
            commitlint: {
                extends: ["@commitlint/config-conventional"]
            },
            jest: {
                preset: "ts-jest"
            },
            postcss: {
                plugins: {
                    autoprefixer: {},
                    tailwindcss: {}
                }
            }
        };

        await fs.writeJson(path.join(tmpDir, 'package.json'), pkgJson);

        const result = await parsePackageJsonConfigDetailed(tmpDir);
        expect(result.packages.has('stylelint')).toBe(true);
        expect(result.packages.has('stylelint-config-standard')).toBe(true);
        expect(result.packages.has('@commitlint/cli')).toBe(true);
        expect(result.packages.has('commitlint')).toBe(true);
        expect(result.packages.has('@commitlint/config-conventional')).toBe(true);
        expect(result.packages.has('jest')).toBe(true);
        expect(result.packages.has('ts-jest')).toBe(true);
        expect(result.packages.has('postcss')).toBe(true);
        expect(result.packages.has('autoprefixer')).toBe(true);
        expect(result.packages.has('tailwindcss')).toBe(true);
    });

    it('Should return empty set when package.json does not exist', async () => {
        const result = await parsePackageJsonConfigDetailed(tmpDir);
        expect(result.packages.size).toBe(0);
        expect(result.complete).toBe(true);
    });

    it('Should be properly integrated into configParserRunner', async () => {
        const pkgJson = {
            name: "test-runner-integration",
            prettier: "@sxzz/prettier-config",
            "simple-git-hooks": {}
        };
        await fs.writeJson(path.join(tmpDir, 'package.json'), pkgJson);

        const runnerResult = await runConfigParsersDetailed(tmpDir);
        expect(runnerResult.usedPackages.has('prettier')).toBe(true);
        expect(runnerResult.usedPackages.has('@sxzz/prettier-config')).toBe(true);
        expect(runnerResult.usedPackages.has('simple-git-hooks')).toBe(true);
    });
});
