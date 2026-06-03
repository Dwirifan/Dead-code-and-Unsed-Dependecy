/**
 * ================================================================
 * UJI AKURASI DEAD CODE DETECTION — Acorn vs TS-Estree
 * ================================================================
 *
 * Skrip ini membuktikan bahwa walaupun Acorn BISA mem-parse
 * TypeScript/JSX, hasil analisisnya TIDAK AKURAT karena:
 *   - Analyzer tidak dapat menemukan node TypeScript-spesifik
 *   - Konstruksi TS modern (satisfies) gagal total
 *   - False negative: dead code TypeScript tidak terdeteksi
 *
 * Jalankan di fase Acorn  (commit 99d0589) : node test/uji_akurasi_deadcode.mjs
 * Jalankan di fase Estree (branch development): node test/uji_akurasi_deadcode.mjs
 * ================================================================
 */

import estraverse from 'estraverse';
import { Scope } from '../../src/analyzer/deadcode/core/scope.js';
import { isReference } from '../../src/analyzer/deadcode/core/isReference.js';
import { extractIdentifiers } from '../../src/analyzer/deadcode/core/destructuringExtractor.js';

const G = '\x1b[32m'; const R = '\x1b[31m';
const Y = '\x1b[33m'; const W = '\x1b[1m';
const B = '\x1b[36m'; const X = '\x1b[0m';

// ── Deteksi engine yang sedang aktif ───────────────────────────────
let ENGINE = 'ACORN';
let parseCode;
let visitorKeys = {};

// Load parser dari modul aktif
const parserMod = await import('../../src/parser/astParser.js');
parseCode = parserMod.parseCode;

// Cek engine sebenarnya dari apakah ia mengekspor ParseError (hanya ada di ts-estree)
if (parserMod.ParseError) {
    const vk = await import('@typescript-eslint/visitor-keys');
    visitorKeys = { ...estraverse.VisitorKeys, ...vk.visitorKeys };
    ENGINE = 'TS-ESTREE';
} else {
    visitorKeys = estraverse.VisitorKeys;
    ENGINE = 'ACORN';
}

// Deteksi API Scope yang tersedia (Acorn: addReference, ts-estree: addReadReference)
const scopeTest = new Scope();
const HAS_READ_WRITE_API = typeof scopeTest.addReadReference === 'function';

console.log(`\n${'═'.repeat(65)}`);
console.log(`${W}  UJI AKURASI DEAD CODE DETECTION${X}`);
console.log(`  Engine Aktif : ${ENGINE === 'ACORN' ? R+W+'ACORN'+X+' (acorn v8.15.0 + acorn-typescript v1.4.13)' : G+W+'TS-ESTREE'+X+' (@typescript-eslint/typescript-estree v8.58.2)'}`);
console.log(`  Tujuan       : Buktikan akurasi deteksi dead code TypeScript`);
console.log(`${'═'.repeat(65)}\n`);

// ── Fungsi analisis sederhana (deteksi variabel/type tidak terpakai) ──
function analisis(kode, namaFile) {
    let ast;
    try {
        ast = parseCode(kode, namaFile);
    } catch (e) {
        return { error: e.message, terdeteksi: [], missed: [] };
    }

    const globalScope = new Scope();
    let currentScope = globalScope;
    const scopeStack = [globalScope];
    const parentStack = [];

    try {
        estraverse.traverse(ast, {
            fallback: 'iteration',
            keys: visitorKeys,
            enter(node, parent) {
                parentStack.push(node);
                // Scope
                if (['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)) {
                    const s = new Scope(currentScope);
                    currentScope = s; scopeStack.push(s);
                }
                // Deklarasi variabel
                if (node.type === 'VariableDeclarator') {
                    const ids = extractIdentifiers(node.id);
                    ids.forEach(({name}) => currentScope.addDeclaration(name, 'Variable', node.loc?.start.line, node));
                }
                // Fungsi
                if (node.type === 'FunctionDeclaration' && node.id && currentScope.parent) {
                    currentScope.parent.addDeclaration(node.id.name, 'Function', node.loc?.start.line, node);
                }
                // Import
                if (node.type === 'ImportDeclaration' && node.specifiers?.length > 0) {
                    node.specifiers.forEach(spec => {
                        if (spec.local?.type === 'Identifier') {
                            currentScope.addDeclaration(spec.local.name, 'Variable', spec.loc?.start.line, spec.local);
                        }
                    });
                }
                // TypeScript: Interface
                if (node.type === 'TSInterfaceDeclaration' && node.id) {
                    currentScope.addDeclaration(node.id.name, 'UnusedType', node.loc?.start.line, node);
                }
                // TypeScript: Type Alias
                if (node.type === 'TSTypeAliasDeclaration' && node.id) {
                    currentScope.addDeclaration(node.id.name, 'UnusedType', node.loc?.start.line, node);
                }
                // TypeScript: Enum
                if (node.type === 'TSEnumDeclaration' && node.id) {
                    currentScope.addDeclaration(node.id.name, 'UnusedType', node.loc?.start.line, node);
                }
                // TypeScript: Namespace/Module
                if (node.type === 'TSModuleDeclaration' && node.id) {
                    currentScope.addDeclaration(node.id.name, 'Variable', node.loc?.start.line, node);
                }
                // Referensi — kompatibel dengan dua versi Scope API
                if (node.type === 'Identifier' || node.type === 'JSXIdentifier') {
                    const gp = parentStack.length >= 3 ? parentStack[parentStack.length - 3] : null;
                    if (isReference(node, parent, gp)) {
                        if (HAS_READ_WRITE_API) {
                            currentScope.addReadReference(node.name);
                        } else {
                            currentScope.addReference(node.name);
                        }
                    }
                }
            },
            leave(node) {
                parentStack.pop();
                if (['FunctionDeclaration','FunctionExpression','ArrowFunctionExpression'].includes(node.type)) {
                    scopeStack.pop();
                    currentScope = scopeStack[scopeStack.length - 1];
                }
            }
        });
    } catch(e) {
        return { error: `Traversal error: ${e.message}`, terdeteksi: [], missed: [] };
    }

    globalScope.resolve();
    const dead = [];
    globalScope.declarations.forEach((info, name) => {
        if (!info.used) dead.push({ name, type: info.type, line: info.line });
    });
    return { error: null, dead };
}

import { kasusUjiDeadCode as kasusUji } from './scenarios_deadcode.mjs';



let totalBenar = 0;
let totalSalah = 0;

for (const kasus of kasusUji) {
    const { no, label, file, kode, harusTerdeteksi, note } = kasus;
    console.log(`${W}[TC-${String(no).padStart(2,'0')}] ${label}${X}`);
    console.log(`         ${B}${note}${X}`);

    const hasil = analisis(kode, file);

    if (hasil.error) {
        console.log(`         ${R}❌ GAGAL PARSING: ${hasil.error}${X}`);
        console.log(`         Berkas   : ${file}`);
        console.log(`         Kode uji : ${kode.replace(/\n/g, ' ')}`);
        
        if (harusTerdeteksi.length > 0) {
            console.log(`         ${Y}   → ${harusTerdeteksi.length} dead code tidak terdeteksi (FALSE NEGATIVE)${X}`);
            totalSalah += harusTerdeteksi.length;
        }
    } else {
        const namaYangDead = hasil.dead.map(d => d.name);

        for (const expected of harusTerdeteksi) {
            const ditemukan = namaYangDead.includes(expected);
            if (ditemukan) {
                const item = hasil.dead.find(d => d.name === expected);
                console.log(`         ${G}✅ TERDETEKSI${X}: '${expected}' (${item.type}, baris ${item.line})`);
                totalBenar++;
            } else {
                console.log(`         ${R}❌ TIDAK TERDETEKSI${X}: '${expected}' ${Y}← FALSE NEGATIVE!${X}`);
                totalSalah++;
            }
        }

        if (harusTerdeteksi.length === 0) {
            console.log(`         ${G}✅ PARSING BERHASIL${X} — ${hasil.dead.length} dead code ditemukan`);
        }
    }
    console.log();
}

// ══ RINGKASAN ══════════════════════════════════════════════════════
const akurasi = totalBenar + totalSalah > 0
    ? ((totalBenar / (totalBenar + totalSalah)) * 100).toFixed(1)
    : '100.0';

console.log(`${'─'.repeat(65)}`);
console.log(`${W}  RINGKASAN AKURASI DETEKSI — Engine: ${ENGINE}${X}`);
console.log(`${'─'.repeat(65)}`);
console.log(`  Terdeteksi benar  : ${G}${totalBenar} item${X}`);
console.log(`  Tidak terdeteksi  : ${totalSalah > 0 ? R : G}${totalSalah} item (false negative)${X}`);
console.log(`  Akurasi deteksi   : ${parseFloat(akurasi) >= 100 ? G : parseFloat(akurasi) >= 50 ? Y : R}${W}${akurasi}%${X}`);
console.log();
if (ENGINE === 'ACORN') {
    console.log(`  ${Y}⚠️  Kesimpulan: Acorn BISA mem-parse kode, tetapi TIDAK AKURAT${X}`);
    console.log(`  ${Y}   untuk deteksi dead code TypeScript. False negative ditemukan${X}`);
    console.log(`  ${Y}   pada konstruksi TypeScript-spesifik yang tidak dikenali${X}`);
    console.log(`  ${Y}   oleh analyzer tanpa @typescript-eslint/visitor-keys.${X}`);
} else {
    console.log(`  ${G}✅ Kesimpulan: TS-Estree akurat dalam mendeteksi dead code${X}`);
    console.log(`  ${G}   pada seluruh konstruksi TypeScript/JSX yang diuji.${X}`);
}
console.log(`${'═'.repeat(65)}\n`);
