import { describe, test, expect } from 'vitest';
import { parseCode } from '../../src/parser/astParser.js';
import { kasusUji } from '../parser/scenarios.mjs';
import estraverse from 'estraverse';
import { visitorKeys as tsVisitorKeys } from '@typescript-eslint/visitor-keys';

const visitorKeys = { ...estraverse.VisitorKeys, ...tsVisitorKeys };

describe('Iterasi 1: Pembangunan Core Parser (astParser)', () => {
    
    describe('Kelompok A: Sintaks Dasar (JavaScript & JSX)', () => {
        const dasarTests = kasusUji.filter(u => u.no <= 12);
        
        for (const uji of dasarTests) {
            const noStr = String(uji.no).padStart(2, '0');
            test(`[TC-${noStr}] ${uji.label}`, () => {
                const ast = parseCode(uji.kode, uji.file);
                expect(ast).toBeDefined();
                expect(ast.type).toBe('Program');
            });
        }
    });

    describe('Kelompok B: Uji Kompatibilitas (TypeScript & TSX)', () => {
        const lanjutTests = kasusUji.filter(u => u.no >= 13 && u.no <= 18);
        
        for (const uji of lanjutTests) {
            const noStr = String(uji.no).padStart(2, '0');
            test(`[TC-${noStr}] ${uji.label}`, () => {
                const ast = parseCode(uji.kode, uji.file);
                expect(ast).toBeDefined();
                expect(ast.type).toBe('Program');
            });
        }
    });
    describe('Kelompok C: Pengujian Kompatibilitas Traversal AST', () => {
        const traversalTests = kasusUji.filter(u => u.no >= 19 && u.no <= 22);

        for (const uji of traversalTests) {
            const noStr = String(uji.no).padStart(2, '0');
            test(`[TC-${noStr}] ${uji.label}`, () => {
                const ast = parseCode(uji.kode, uji.file);
                const visitedNodes = new Set();
                
                estraverse.traverse(ast, {
                    keys: visitorKeys,
                    enter(node) {
                        visitedNodes.add(node.type);
                    }
                });

                expect(visitedNodes.has(uji.expectedNodeType)).toBe(true);
            });
        }
    });

});
