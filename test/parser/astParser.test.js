import { describe, test, expect, afterAll } from 'vitest';
import { parseCode } from '../../src/parser/astParser.js';
import { kasusUji } from '../parser/scenarios.mjs';
import estraverse from 'estraverse';
import { visitorKeys as tsVisitorKeys } from '@typescript-eslint/visitor-keys';

const visitorKeys = { ...estraverse.VisitorKeys, ...tsVisitorKeys };

describe('Iterasi 1: Pembangunan Core Parser (astParser)', () => {

    describe('Kelompok A: Sintaks Dasar (JavaScript)', () => {
        const dasarTests = kasusUji.filter(u => u.no <= 12);

        for (const uji of dasarTests) {
            const noStr = String(uji.no).padStart(2, '0');
            test(`[TC-${noStr}] ${uji.label}`, async () => {
                const ast = await parseCode(uji.kode, uji.file);
                expect(ast).toBeDefined();
                expect(ast.type).toBe('Program');
            });
        }
    });

    describe('Kelompok B: Uji Kompatibilitas (TypeScript)', () => {
        const lanjutTests = kasusUji.filter(u => u.no >= 13 && u.no <= 18);

        for (const uji of lanjutTests) {
            const noStr = String(uji.no).padStart(2, '0');
            test(`[TC-${noStr}] ${uji.label}`, async () => {
                const ast = await parseCode(uji.kode, uji.file);
                expect(ast).toBeDefined();
                expect(ast.type).toBe('Program');
            });
        }
    });
    describe('Kelompok C: Pengujian Kompatibilitas Traversal AST', () => {
        const traversalTests = kasusUji.filter(u => u.no >= 19 && u.no <= 22);

        for (const uji of traversalTests) {
            const noStr = String(uji.no).padStart(2, '0');
            test(`[TC-${noStr}] ${uji.label}`, async () => {
                const ast = await parseCode(uji.kode, uji.file);
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

    describe('Kelompok D: Skenario Kehancuran (Batas V8 Node.js & Lag Ekstrem)', () => {
        const edgeTests = kasusUji.filter(u => u.no >= 23);
        
        for (const uji of edgeTests) {
            const noStr = String(uji.no).padStart(2, '0');
            test(`[TC-${noStr}] ${uji.label}`, async () => {
                if (uji.isError) {
                    // Karena ini melempar RangeError (bukan sintaks biasa), kita ekspektasikan Error dilempar
                    await expect(parseCode(uji.kode, uji.file)).rejects.toThrow();
                } else {
                    const ast = await parseCode(uji.kode, uji.file);
                    expect(ast).toBeDefined();
                    expect(ast.type).toBe('Program');
                }
            }, 600000); // 10 menit timeout khusus untuk menguji ketahanan RAM & CPU murni
        }
    });

});
