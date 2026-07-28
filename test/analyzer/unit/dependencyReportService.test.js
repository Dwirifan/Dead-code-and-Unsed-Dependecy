import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs-extra';
import os from 'os';
import path from 'path';
import { analyzeProjectDependencies } from '../../../src/analyzer/dependency/dependencyReportService.js';

describe('Dependency Report Service safety policy', () => {
    let projectRoot;

    beforeEach(async () => {
        projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'deadkiller-dep-report-'));
        await fs.writeJson(path.join(projectRoot, 'package.json'), {
            name: 'fixture',
            dependencies: { axios: '1.0.0' }
        });
    });

    afterEach(async () => {
        await fs.remove(projectRoot);
    });

    function graph(overrides = {}) {
        return {
            liveFiles: new Set([path.join(projectRoot, 'index.js')]),
            usedPackages: new Set(),
            unsafeFiles: new Set(),
            globalRegistry: { unresolvedImports: [] },
            ...overrides
        };
    }

    it('keeps a high-confidence candidate removable when analysis is complete', async () => {
        const report = await analyzeProjectDependencies(projectRoot, graph());

        expect(report.analysisComplete).toBe(true);
        expect(report.unused).toContain('axios');
        expect(report.uncertain).not.toContain('axios');
    });

    it('moves all unused candidates to UNKNOWN for dynamic code', async () => {
        const unsafeFile = path.join(projectRoot, 'index.js');
        await fs.writeJson(path.join(projectRoot, 'package.json'), {
            name: 'fixture',
            dependencies: { axios: '1.0.0' },
            devDependencies: { 'custom-dev-tool': '1.0.0' }
        });
        const report = await analyzeProjectDependencies(projectRoot, graph({
            unsafeFiles: new Set([unsafeFile])
        }));

        expect(report.analysisComplete).toBe(false);
        expect(report.unused).toEqual([]);
        expect(report.uncertain).toContain('axios');
        expect(report.deadDevDeps).toEqual([]);
        expect(report.uncertainDevDeps).toContain('custom-dev-tool');
        expect(report.safety.reasons.join(' ')).toMatch(/pola dinamis/);
    });

    it('moves candidates to UNKNOWN for unsupported component sources', async () => {
        const report = await analyzeProjectDependencies(projectRoot, graph({
            liveFiles: new Set([path.join(projectRoot, 'app.vue')])
        }));

        expect(report.analysisComplete).toBe(false);
        expect(report.unused).toEqual([]);
        expect(report.uncertain).toContain('axios');
        expect(report.safety.unsupportedFiles[0]).toMatch(/app\.vue$/);
    });

    it('does not block dependency cleanup for generic computed properties alone', async () => {
        const computedFile = path.join(projectRoot, 'index.js');
        const report = await analyzeProjectDependencies(projectRoot, graph({
            unsafeFiles: new Set([computedFile]),
            dynamicDependencyFiles: new Set()
        }));

        expect(report.analysisComplete).toBe(true);
        expect(report.unused).toContain('axios');
        expect(report.uncertain).not.toContain('axios');
    });
});
