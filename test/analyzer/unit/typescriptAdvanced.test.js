import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { parseCode } from '../../../src/parser/astParser.js';
import { findDeadCode } from '../../../src/analyzer/deadcode/index.js';
import { RuleEngine } from '../../../src/analyzer/ruleEngine.js';

describe('TypeScript Advanced Syntax Analysis', () => {
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
