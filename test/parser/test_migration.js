import { parseCode } from '../../src/parser/astParser.js';
import { findDeadCode } from '../../src/analyzer/deadcode/deadCodeAnalyzer.js';
import { removeDeadCode } from '../../src/eliminator/codeCleaner.js';

// ============ TEST 1: JavaScript biasa ============
const jsCode = `
const x = 10;
const unusedVar = 20;

function useful() {
    console.log(x);
}

function deadFunc() {
    const innerUnused = 5;
}

useful();
`;

console.log('========================================');
console.log('TEST 1: JavaScript (contoh.js style)');
console.log('========================================');

try {
    const ast = parseCode(jsCode);
    console.log('✅ Parser JS berhasil.');

    const deadNodes = findDeadCode(ast);
    console.log(`   Dead nodes ditemukan: ${deadNodes.length}`);
    deadNodes.forEach(d => console.log(`   - [Line ${d.line}] ${d.type} '${d.name}'`));

    const cleanedCode = removeDeadCode(jsCode, deadNodes);
    console.log('\n--- Hasil setelah eliminasi (JS) ---');
    console.log(cleanedCode);
} catch (err) {
    console.error('❌ TEST 1 GAGAL:', err.message);
}

// ============ TEST 2: TypeScript ============
const tsCode = `
function sapa(nama: string): void {
    console.log("Halo " + nama);
}

const unusedNumber: number = 42;
const usedArray: number[] = [1, 2, 3];

interface User {
    id: number;
    name: string;
}

function processUser(user: User): string {
    return user.name;
}

sapa("Dwi");
console.log(usedArray);
`;

console.log('\n========================================');
console.log('TEST 2: TypeScript (Tipe data harus UTUH!)');
console.log('========================================');

try {
    const ast2 = parseCode(tsCode);
    console.log('✅ Parser TS berhasil.');

    const deadNodes2 = findDeadCode(ast2);
    console.log(`   Dead nodes ditemukan: ${deadNodes2.length}`);
    deadNodes2.forEach(d => console.log(`   - [Line ${d.line}] ${d.type} '${d.name}'`));

    const cleanedTS = removeDeadCode(tsCode, deadNodes2);
    console.log('\n--- Hasil setelah eliminasi (TS) ---');
    console.log(cleanedTS);

    // VALIDASI KRITIS: pastikan tipe TypeScript masih ada
    if (cleanedTS.includes(': string') && cleanedTS.includes(': void') && cleanedTS.includes(': number[]')) {
        console.log('\n🎉 SUKSES! Tipe TypeScript (: string, : void, : number[]) tetap UTUH!');
    } else {
        console.log('\n❌ GAGAL! Tipe TypeScript hilang!');
    }
} catch (err) {
    console.error('❌ TEST 2 GAGAL:', err.message);
}
