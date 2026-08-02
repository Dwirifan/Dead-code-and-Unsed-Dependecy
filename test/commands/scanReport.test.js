import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
    createDirectoryScanReport,
    createSingleFileScanReport,
    matchingFailCategories,
    parseFailOn,
} from '../../src/commands/scanReport.js';

const projectRoot = path.resolve('virtual-project');

function ruleEngineFixture() {
    return {
        configLoaded: false,
        configPath: null,
        configSource: 'auto',
        autoProfile: { projectType: 'application' },
        configDiagnostics: [],
    };
}

describe('scanReport', () => {
    it('membangun laporan deterministik dengan count yang berasal dari detail', () => {
        const runtimeCycle = [
            path.join(projectRoot, 'src', 'b.js'),
            path.join(projectRoot, 'src', 'a.js'),
        ];
        const report = createDirectoryScanReport({
            projectRoot,
            ruleEngine: ruleEngineFixture(),
            graph: {
                liveFiles: new Set(['a', 'b']),
                unsafeFiles: new Set([path.join(projectRoot, 'src', 'dynamic.js')]),
                globalRegistry: {
                    unresolvedImports: [{
                        file: path.join(projectRoot, 'src', 'index.js'),
                        importPath: './missing.js',
                    }],
                },
            },
            deadFiles: [path.join(projectRoot, 'src', 'unused.js')],
            deadNodes: [
                { file: path.join(projectRoot, 'test', 'x.test.js'), name: 'protected', type: 'Variable', line: 2, status: 'safe', protected: true },
                { file: path.join(projectRoot, 'src', 'index.js'), name: 'unused', type: 'Variable', line: 1, status: 'safe' },
                { file: path.join(projectRoot, 'src', 'index.js'), name: 'smell', type: 'EmptyBlock', line: 3, status: 'review' },
            ],
            duplicateExports: [{
                name: 'duplicate',
                files: [path.join(projectRoot, 'src', 'z.js'), path.join(projectRoot, 'src', 'a.js')],
            }],
            runtimeCycles: [runtimeCycle],
            typeOnlyCycles: [],
            dependencyReport: {
                unused: ['unused-package'],
                uncertain: ['unknown-package'],
                missing: [],
                missingBinaries: [],
                deadDevDeps: [],
                uncertainDevDeps: [],
                analysisComplete: false,
                safety: { reasons: ['dynamic import'] },
                diagnostics: [],
            },
            dependencyAnalysisError: null,
            analysisTimeMs: 12.345,
        });

        expect(report.schemaVersion).toBe(1);
        expect(report.deadCode.map(item => item.file)).toEqual([
            'src/index.js',
            'src/index.js',
            'test/x.test.js',
        ]);
        expect(report.duplicateExports[0].files).toEqual(['src/a.js', 'src/z.js']);
        expect(report.summary.astFindings).toBe(report.deadCode.length);
        expect(report.summary.codeFindings).toBe(7);
        expect(report.summary.dependencyFindings).toBe(2);
        expect(report.summary.totalFindings).toBe(9);
        expect(report.summary).toEqual(expect.objectContaining({
            safe: 1,
            review: 1,
            protected: 1,
            actionableCodeFindings: 1,
            actionableDependencyFindings: 1,
        }));
        expect(report.unsafeFiles).toEqual(['src/dynamic.js']);
        expect(report.summary.analysisTimeMs).toBe(12.345);
    });

    it('membangun laporan single-file dan mengecualikan protected dari actionable', () => {
        const report = createSingleFileScanReport({
            file: path.join(projectRoot, 'test', 'x.test.js'),
            ruleEngine: ruleEngineFixture(),
            protectedFile: true,
            deadNodes: [{ name: 'unused', type: 'Variable', line: 1, status: 'safe' }],
            analysisTimeMs: 1,
        });

        expect(report.summary.protected).toBe(1);
        expect(report.summary.safe).toBe(0);
        expect(report.summary.actionableFindings).toBe(0);
    });

    it('memvalidasi dan mencocokkan kebijakan fail-on', () => {
        expect(parseFailOn('review,safe,review')).toEqual(['review', 'safe']);
        expect(() => parseFailOn('critical')).toThrowError(/tidak valid/);

        const report = {
            summary: {
                totalFindings: 3,
                actionableCodeFindings: 1,
                review: 1,
                risky: 0,
                dependencyFindings: 1,
                deadFiles: 0,
            },
        };
        expect(matchingFailCategories(report, ['safe', 'risky', 'dependency'])).toEqual([
            'safe',
            'dependency',
        ]);
        expect(matchingFailCategories(report, ['any'])).toEqual(['any']);
    });
});
