import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCode } from '../../src/parser/astParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 1. Baca file contoh.js
const targetFile = path.join(__dirname, 'contoh.js');
const code = fs.readFileSync(targetFile, 'utf-8');

try {
    // 2. Eksekusi parser
    const ast = parseCode(code);

    // 3. Tulis hasil pohon/AST ke format JSON agar bisa dilihat dengan mudah
    const outPath = path.join(__dirname, 'contoh_ast.json');
    fs.writeFileSync(outPath, JSON.stringify(ast, null, 2));
    
    console.log('✅ BERHASIL!');
    console.log(`AST (Abstract Syntax Tree) berukuran besar telah di-generate.`);
    console.log(`Silakan buka file: ${outPath} untuk melihat hasil bedahan kode Anda.`);

} catch (err) {
    console.error('❌ GAGAL parsing:', err.message);
}
