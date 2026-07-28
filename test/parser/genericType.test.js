import { describe, it, expect } from 'vitest';
import { findDeadCode } from '../../src/analyzer/deadcode/index.js';
import { parse } from '@typescript-eslint/typescript-estree';

describe('Unused Generic Type Parameter', () => {
    it('Should detect unused generic type parameter', () => {
        const code = `
            function foo<T, U>(val: T) {
                return val;
            }
        `;
        const ast = parse(code, { loc: true, range: true });
        const issues = findDeadCode(ast);
        const unused = issues.find(i => i.name === 'U');
        expect(unused).toBeDefined();
        expect(unused.type).toBe('UnusedType');

        const used = issues.find(i => i.name === 'T');
        expect(used).toBeUndefined(); // T is used
    });
});
