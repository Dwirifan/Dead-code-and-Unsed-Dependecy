import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { parseCode } from '../../../src/parser/astParser.js';
import { findDeadCode } from '../../../src/analyzer/deadcode/index.js';
import { RuleEngine } from '../../../src/analyzer/ruleEngine.js';

describe('Simple Import/Export & Unresolved Import Analysis', () => {
    it('Should detect simple unused imports and simple unused variables with correct reasons and status', async () => {
        const code = `
            import { usedFunc, unusedFunc } from './utils';
            import nonExistentModule from 'non-existent-package-x-12345';
            
            const localUsed = 10;
            const localUnused = 20;
            
            export function main() {
                return usedFunc() + localUsed;
            }
        `;
        const ast = await parseCode(code, 'app.js');
        const ruleEngine = new RuleEngine();
        const results = await findDeadCode(ast, 'app.js', null, ruleEngine);

        const unusedNames = results.map(r => r.name);
        assert.ok(unusedNames.includes('unusedFunc'), 'Should detect unusedFunc import');
        assert.ok(unusedNames.includes('nonExistentModule'), 'Should detect unused import from unresolved/non-existent module');
        assert.ok(unusedNames.includes('localUnused'), 'Should detect unused local variable');
        assert.ok(!unusedNames.includes('usedFunc'), 'Should NOT mark used import as dead');
        assert.ok(!unusedNames.includes('localUsed'), 'Should NOT mark used local variable as dead');

        const unusedFuncNode = results.find(r => r.name === 'unusedFunc');
        assert.equal(unusedFuncNode.confidence, 'high');
        assert.equal(unusedFuncNode.status, 'safe');
        assert.ok(unusedFuncNode.reason.includes('diimpor'), 'Reason should explain import unused');
    });
});
