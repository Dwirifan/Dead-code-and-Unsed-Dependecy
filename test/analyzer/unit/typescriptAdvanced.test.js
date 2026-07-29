import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { parseCode } from '../../../src/parser/astParser.js';
import { findDeadCode } from '../../../src/analyzer/deadcode/index.js';
import { RuleEngine } from '../../../src/analyzer/ruleEngine.js';

describe('TypeScript Advanced Syntax Analysis', () => {
    it('reports an unused private method even when the same method name is called elsewhere', async () => {
        const code = `
            class CAC {
                private logExecutionTrace(): void {}
                run(): void {}
            }
            class Logger {
                logExecutionTrace(): void {}
            }
            const cac = new CAC();
            cac.run();
            const logger = new Logger();
            console.log(cac, logger);
        `;
        const ast = await parseCode(code, 'cac.ts');
        const globalRegistry = {
            calledMethods: new Set(['logExecutionTrace']),
            usedExports: new Map(),
            unsafeFiles: new Set()
        };
        const results = findDeadCode(ast, 'cac.ts', globalRegistry, new RuleEngine());
        const finding = results.find(result => result.name === 'CAC.logExecutionTrace');

        assert.ok(finding, 'private CAC method must not be hidden by an unrelated global call');
        assert.equal(finding.confidence, 'high');
        assert.equal(finding.status, 'safe');
    });

    it('resolves literal computed access and downgrades unresolved computed access per class', async () => {
        const code = `
            class A {
                private used(): void {}
                private possiblyUsed(): void {}
                run(name: string): void {
                    this['used']();
                    this[name]();
                }
            }
            class B {
                private definitelyUnused(): void {}
            }
            const a = new A();
            a.run('possiblyUsed');
            const b = new B();
            console.log(a, b);
        `;
        const ast = await parseCode(code, 'computed.ts');
        const results = findDeadCode(ast, 'computed.ts', null, new RuleEngine());

        assert.ok(!results.some(result => result.name === 'A.used'));
        const ambiguous = results.find(result => result.name === 'A.possiblyUsed');
        assert.ok(ambiguous);
        assert.equal(ambiguous.status, 'review');
        assert.equal(ambiguous.info.dynamicRiskScope, 'class A');

        const unrelated = results.find(result => result.name === 'B.definitelyUnused');
        assert.ok(unrelated);
        assert.equal(unrelated.status, 'safe');
    });

    it('Should correctly analyze TSImportEqualsDeclaration (import X = require("x") and import X = Y.Z)', async () => {
        const code = `
            import fs = require('fs');
            import Path = require('path');
            import myAlias = fs.existsSync;
            
            export function checkFile(p: string) {
                return fs.existsSync(p);
            }
        `;
        const ast = await parseCode(code, 'advanced.ts');
        const ruleEngine = new RuleEngine();
        const results = await findDeadCode(ast, 'advanced.ts', null, ruleEngine);
        const unusedNames = results.map(r => r.name);

        assert.ok(!unusedNames.includes('fs'), 'fs should be marked as used');
        assert.ok(unusedNames.includes('Path'), 'Path should be detected as unused');
        assert.ok(unusedNames.includes('myAlias'), 'myAlias should be detected as unused');
    });

    it('Should correctly handle exported TSImportEqualsDeclaration and namespaces when preserveExports is true', async () => {
        const code = `
            export import Lib = require('some-lib');
            export namespace Config {
                export const PORT = 3000;
                export function init() {}
            }
            namespace UnusedLocalNamespace {
                export const DATA = 123;
            }
        `;
        const ast = await parseCode(code, 'config.ts');
        const ruleEngine = new RuleEngine(); // preserveExports default is true
        const results = await findDeadCode(ast, 'config.ts', null, ruleEngine);
        const unusedNames = results.map(r => r.name);

        assert.ok(!unusedNames.includes('Lib'), 'Lib should be preserved because it is exported');
        assert.ok(!unusedNames.includes('Config'), 'Config should be preserved because it is exported');
        assert.ok(!unusedNames.includes('PORT'), 'PORT inside exported namespace should be preserved');
        assert.ok(!unusedNames.includes('init'), 'init inside exported namespace should be preserved');
        assert.ok(unusedNames.includes('UnusedLocalNamespace'), 'UnusedLocalNamespace should be detected as unused');
    });
});
