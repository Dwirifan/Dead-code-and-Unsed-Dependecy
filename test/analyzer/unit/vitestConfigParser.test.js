import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'node:os';
import path from 'node:path';
import { parseVitestConfigDetailed } from '../../../src/analyzer/dependency/configParsers/vitestParser.js';

describe('vitestConfigParser', () => {
    let projectRoot;

    beforeEach(async () => {
        projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'deadkiller-vitest-config-'));
    });

    afterEach(async () => {
        await fs.remove(projectRoot);
    });

    it('mengenali coverage provider dan test environment implisit', async () => {
        await fs.writeFile(path.join(projectRoot, 'vitest.config.js'), `
            import { defineConfig } from 'vitest/config';
            export default defineConfig({
                test: {
                    environment: 'jsdom',
                    coverage: { provider: 'v8' }
                }
            });
        `);

        const result = await parseVitestConfigDetailed(projectRoot);

        expect(result.complete).toBe(true);
        expect(result.packages).toEqual(new Set([
            'vitest',
            '@vitest/coverage-v8',
            'jsdom',
        ]));
    });

    it('mengenali provider Istanbul dan custom provider module', async () => {
        await fs.writeFile(path.join(projectRoot, 'vitest.config.mjs'), `
            export default {
                test: {
                    coverage: {
                        provider: 'istanbul',
                        customProviderModule: '@scope/custom-coverage/provider'
                    }
                }
            };
        `);

        const result = await parseVitestConfigDetailed(projectRoot);

        expect(result.packages.has('@vitest/coverage-istanbul')).toBe(true);
        expect(result.packages.has('@scope/custom-coverage')).toBe(true);
    });
});
