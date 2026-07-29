import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';

vi.mock('inquirer', () => ({
    default: {
        prompt: vi.fn(),
    },
}));

import inquirer from 'inquirer';
import { initCommand } from '../../src/commands/initCommand.js';

describe('init command entry-point UX', () => {
    let tempDir;

    afterEach(async () => {
        vi.restoreAllMocks();
        inquirer.prompt.mockReset();
        if (tempDir) await fs.remove(tempDir);
        tempDir = undefined;
    });

    it('menampilkan checklist entry hasil deteksi sebelum pilihan format', async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deadkiller-init-'));
        await fs.writeJson(path.join(tempDir, 'package.json'), {
            name: 'mocha-project',
            main: 'server.js',
            scripts: { test: 'mocha' },
            devDependencies: { mocha: '*', 'chai-http': '*' },
        });
        await fs.writeFile(path.join(tempDir, 'server.js'), `module.exports = {};\n`);
        await fs.outputFile(
            path.join(tempDir, 'test', 'products.js'),
            `require('chai-http');\n`,
        );

        vi.spyOn(process, 'cwd').mockReturnValue(tempDir);
        inquirer.prompt
            .mockResolvedValueOnce({
                frameworkMode: 'vanilla',
                ignoreVariables: '^_',
                preserveFiles: 'test/**',
                ignoreFiles: 'dist/**, build/**, coverage/**',
                preserveExports: false,
                entryPoints: '',
            })
            .mockImplementationOnce(async questions => {
                expect(questions[0].type).toBe('checkbox');
                expect(questions[0].choices).toEqual(expect.arrayContaining([
                    expect.objectContaining({ name: '[runtime] server.js', checked: true }),
                    expect.objectContaining({ name: '[test] test/products.js', checked: true }),
                ]));
                return {
                    entryPoints: questions[0].choices.map(choice => choice.value),
                };
            })
            .mockImplementationOnce(async questions => {
                expect(questions[0].name).toBe('configFormat');
                return { configFormat: 'json' };
            });

        await initCommand({ force: false });

        expect(inquirer.prompt).toHaveBeenCalledTimes(3);
        const config = await fs.readJson(path.join(tempDir, '.deadkillerrc.json'));
        expect(config.entryPoints).toEqual([
            'server.js',
            'test/products.js',
        ]);
        expect(config.overrides[0]).not.toHaveProperty('ignorePrefixedVariables');
    });
});
