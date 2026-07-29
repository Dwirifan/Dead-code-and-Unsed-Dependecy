import { describe, it, expect } from 'vitest';
import { removeDeadCode } from '../../src/eliminator/codeCleaner.js';

describe('Eliminator: Code Cleaner', () => {

    it('[TC-E1] Penghapusan Variabel & Pembersihan Koma Menggantung (Level 3)', () => {
        const code = "const a = 1, unusedVar = 2, b = 3;\nconsole.log(a, b);";
        // Simulasi koordinat posisi 'unusedVar = 2'
        const deadNodes = [{
            type: 'VariableDeclarator',
            node: { range: [13, 26] }
        }];

        // Level 3 = Aggressive Delete
        const result = removeDeadCode(code, deadNodes, null, 3);
        
        // Memastikan koma setelah '1' atau sebelum 'b' ditangani dengan benar
        expect(result).toBe("const a = 1, b = 3;\nconsole.log(a, b);");
    });

    it('[TC-E2] Refaktor Parameter Aman (_param) (Level 2)', () => {
        const code = "function test(usedParam, unusedParam) {\n  console.log(usedParam);\n}";
        const deadNodes = [{
            type: 'Parameter',
            node: { range: [25, 36] }
        }];
        
        // Simulasi RuleEngine yang mengizinkan auto-rename parameter
        const mockRuleEngine = {
            rules: { eliminator: { autoRenameUnusedParameters: true } }
        };

        // Level 2 = Safe Skip & Signature Preservation
        const result = removeDeadCode(code, deadNodes, mockRuleEngine, 2);
        
        // Parameter diubah menjadi _unusedParam, BUKAN dihapus utuh
        expect(result).toBe("function test(usedParam, _unusedParam) {\n  console.log(usedParam);\n}");
    });

    it('[TC-E3] Proteksi API: Pengosongan Body Kelas/Fungsi (Level 2)', () => {
        const code = "function unusedApi() {\n  const x = 1;\n  console.log(x);\n}";
        const deadNodes = [{
            type: 'FunctionDeclaration',
            node: { 
                range: [0, 57],
                value: { body: { range: [21, 57] } } 
            }
        }];

        // Level 2 = Safe Skip & Signature Preservation
        const result = removeDeadCode(code, deadNodes, null, 2);
        
        // Body fungsi dikosongkan, struktur API aman
        expect(result).toBe("function unusedApi() {}");
    });

    it('[TC-E4] Pembersihan Import Kosong (Level 3)', () => {
        const code = "import { unusedExport } from 'fs';\nconsole.log('hi');";
        // Koordinat "unusedExport"
        const deadNodes = [{
            type: 'ImportSpecifier',
            node: { range: [9, 21] }
        }];

        const result = removeDeadCode(code, deadNodes, null, 3);
        
        // Baris import terhapus seluruhnya karena tidak ada import specifier lain
        expect(result).toBe("console.log('hi');");
    });

    it('[TC-E5] Mekanisme Backup dan Rollback (Dry Run) (Level 0)', () => {
        const code = "const a = 1, unusedVar = 2, b = 3;\nconsole.log(a, b);";
        const deadNodes = [{
            type: 'VariableDeclarator',
            node: { range: [13, 26] }
        }];

        // Level 0 = Dry Run
        const result = removeDeadCode(code, deadNodes, null, 0);
        
        // Kode tidak berubah sama sekali
        expect(result).toBe(code);
    });

    it('[TC-E6] Penghapusan Kode Beserta JSDoc Comment Pendahulunya (Level 3)', () => {
        const code = "/**\n * Kelas tidak terpakai\n */\nclass UnusedClass {}\nconst a = 1;";
        const startIdx = code.indexOf("class UnusedClass");
        const endIdx = startIdx + "class UnusedClass {}".length;
        const deadNodes = [{
            type: 'ClassDeclaration',
            node: { range: [startIdx, endIdx] }
        }];

        const result = removeDeadCode(code, deadNodes, null, 3);
        expect(result.trim()).toBe("const a = 1;");
    });

    it('[TC-E7] Penghapusan Kode Beserta ESTree leadingComments (Level 3)', () => {
        const code = "// Komentar satu baris\nconst unusedVar = 123;\nconst active = true;";
        const startIdx = code.indexOf("const unusedVar");
        const endIdx = startIdx + "const unusedVar = 123;".length;
        const deadNodes = [{
            type: 'VariableDeclaration',
            node: { 
                range: [startIdx, endIdx],
                leadingComments: [{ range: [0, "// Komentar satu baris".length] }]
            }
        }];

        const result = removeDeadCode(code, deadNodes, null, 3);
        expect(result.trim()).toBe("const active = true;");
    });

    it('[TC-E8] Validasi AST Pasca-Transformasi (Menolak penghapusan yang merusak sintaks struktural)', () => {
        // Simulasi kasus di mana penghapusan node akan merusak sintaksis jika diterapkan
        const code = "if (true) { console.log('active'); } else { console.log('dead'); }";
        // Coba hapus secara paksa 'else {' sehingga merusak struktur block if-else
        const startIdx = code.indexOf("else");
        const endIdx = startIdx + 6; // "else {"
        const deadNodes = [{
            type: 'BrokenNode',
            node: { range: [startIdx, endIdx] }
        }];

        // Karena menghapus "else {" akan meninggalkan "} { console.log('dead'); }" yang tidak valid secara sintaksis,
        // AST validation akan menolak penghapusan dan mengembalikan kode asli atau melewati node tersebut.
        const result = removeDeadCode(code, deadNodes, null, 3);
        expect(result).toBe(code);
    });

    it('[TC-E9] Tidak menyisakan empty statement setelah beberapa node satu baris dihapus', () => {
        const code = [
            'function analyze(options) {',
            '  let count = 0; count = options.length;',
            '  const result = [];',
            '  return result;',
            '}',
        ].join('\n');
        const declaration = 'let count = 0';
        const assignment = 'count = options.length';
        const declarationStart = code.indexOf(declaration);
        const assignmentStart = code.indexOf(assignment);
        const deadNodes = [
            {
                type: 'WriteOnly',
                node: { range: [declarationStart, declarationStart + declaration.length] },
                relatedNodes: [{
                    range: [assignmentStart, assignmentStart + assignment.length],
                }],
            },
        ];

        const result = removeDeadCode(code, deadNodes, null, 2);

        expect(result).not.toMatch(/^\s*;\s*$/m);
        expect(result).toContain('const result = [];');
        expect(result).toContain('return result;');
    });
});
