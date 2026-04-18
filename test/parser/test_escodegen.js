import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCode } from '../../src/parser/astParser.js';
import * as escodegen from 'escodegen';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const targetFile = path.join(__dirname, 'contoh.ts');

try {
    // Buat file contoh TS jika tidak ada (meski sepertinya ada di memori IDE user)
    // Jika ada, kita baca saja, jika tidak kita string literalkan.
    let code = `
        function sapa(nama: string): void {
            console.log("Halo " + nama);
        }
        let arr: number[] = [1, 2, 3];
    `;

    console.log('1. Parsing dengan Acorn...');
    const ast = parseCode(code);
    console.log('AST berhasil dibuat (Node Type FunctionDeclaration ada).');

    console.log('\n2. Mencoba merakit kembali dengan Escodegen...');
    const generatedCode = escodegen.generate(ast);
    console.log('✅ BERHASIL MERAKIT:');
    console.log(generatedCode);

} catch (err) {
    console.error('❌ CRASH Escodegen:');
    console.error(err.message);
}
