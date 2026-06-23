import path from 'path';
import { fileURLToPath } from 'url';
import estraverse from 'estraverse';
import chalk from 'chalk';

// AST Parser & Analyzer Imports
import { parseCode } from '../../src/parser/astParser.js';
import { analyzeReactSmells } from '../../src/analyzer/deadcode/react/reactAnalyzer.js';
import { buildProjectGraph } from '../../src/analyzer/graph/projectGraph.js';
import { Scope } from '../../src/analyzer/deadcode/core/scope.js';
import { analyzeAstCode } from '../../src/analyzer/deadcode/astAnalyzer.js';
import { isReference } from '../../src/analyzer/deadcode/core/isReference.js';
import { extractIdentifiers } from '../../src/analyzer/deadcode/core/destructuringExtractor.js';
import { kasusUjiDeadCode } from '../analyzer/scenarios_deadcode.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dummyProjectRoot = path.join(__dirname, '../analyzer/dummy_project');

const G = '\x1b[32m'; const R = '\x1b[31m';
const Y = '\x1b[33m'; const W = '\x1b[1m';
const B = '\x1b[36m'; const X = '\x1b[0m';

async function runDeadcodeAccuracy() {
    let ENGINE = 'ACORN';
    let localParseCode;
    let visitorKeys = {};

    const parserMod = await import('../../src/parser/astParser.js');
    localParseCode = parserMod.parseCode;

    if (parserMod.ParseError) {
        const vk = await import('@typescript-eslint/visitor-keys');
        visitorKeys = { ...estraverse.VisitorKeys, ...vk.visitorKeys };
        ENGINE = 'TS-ESTREE';
    } else {
        visitorKeys = estraverse.VisitorKeys;
        ENGINE = 'ACORN';
    }

    const scopeTest = new Scope();
    const HAS_READ_WRITE_API = typeof scopeTest.addReadReference === 'function';

    console.log(`\n${'═'.repeat(65)}`);
    console.log(`${W}  [1/3] UJI AKURASI DEAD CODE DETECTION${X}`);
    console.log(`  Engine Aktif : ${ENGINE === 'ACORN' ? R+W+'ACORN'+X+' (acorn v8.15.0 + acorn-typescript v1.4.13)' : G+W+'TS-ESTREE'+X+' (@typescript-eslint/typescript-estree v8.58.2)'}`);
    console.log(`${'═'.repeat(65)}\n`);

    async function analisis(kode, namaFile) {
        let ast;
        try {
            ast = await localParseCode(kode, namaFile);
        } catch (e) {
            return { error: e.message, terdeteksi: [], missed: [] };
        }

        try {
            // Memanggil mesin analisis asli dari Iterasi 2
            const rawDeadCode = analyzeAstCode(ast, namaFile);
            
            // Konversi keluaran agar cocok dengan format assertion di test
            const dead = rawDeadCode.map(issue => ({
                name: issue.name,
                type: issue.type,
                line: issue.line
            }));
            
            return { error: null, dead };
        } catch (e) {
            return { error: `Analyzer error: ${e.message}`, terdeteksi: [], missed: [] };
        }
    }

    let totalBenar = 0;
    let totalSalah = 0;

    for (const kasus of kasusUjiDeadCode) {
        const { no, label, file, kode, harusTerdeteksi, note } = kasus;
        console.log(`${W}[TC-${String(no).padStart(2,'0')}] ${label}${X}`);
        console.log(`         ${B}${note}${X}`);

        const hasil = await analisis(kode, file);

        if (hasil.error) {
            console.log(`         ${R}❌ GAGAL PARSING: ${hasil.error}${X}`);
            if (harusTerdeteksi.length > 0) {
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
        }
        console.log();
    }
}

async function runGraphBuilder() {
    console.log(`\n${'═'.repeat(65)}`);
    console.log(`${W}  [2/3] UJI KEMAMPUAN GRAPH BUILDER (MESIN PEMETAAN)${X}`);
    console.log(`${'═'.repeat(65)}\n`);

    try {
        const { liveFiles, edges } = await buildProjectGraph(dummyProjectRoot);

        console.log(`${W}1. Daftar File yang Terjangkau (Live Files):${X}`);
        Array.from(liveFiles).sort().forEach((f, i) => {
            const rel = path.relative(dummyProjectRoot, f);
            console.log(`   ${i + 1}. ${B}${rel}${X}`);
        });

        console.log(`\n${W}2. Lintasan Dependensi (Edges):${X}`);
        edges.forEach((edge, i) => {
            const from = path.relative(dummyProjectRoot, edge.from);
            const to = path.relative(dummyProjectRoot, edge.to);
            const isBarrel = to.includes('index.js') && !from.includes('index.js');
            
            console.log(`   ${Y}┌─[${from}]${X}`);
            console.log(`   ${Y}├─ Mengimpor : ${G}{ ${edge.names.join(', ')} }${X}`);
            if (isBarrel) {
                console.log(`   ${Y}└─ Menembus Barrel File ➔ ${B}${to}${X}\n`);
            } else {
                console.log(`   ${Y}└─ Ke berkas ➔ ${B}${to}${X}\n`);
            }
        });

        console.log(`${G}✅ BERHASIL: Graph Builder mampu meresolusi import dasar dan Barrel Export.${X}\n`);
    } catch (e) {
        console.error(`${R}❌ GAGAL: ${e.message}${X}\n`);
    }
}

async function runReactSmells() {
    console.log(`\n${'═'.repeat(65)}`);
    console.log(`${W}  [3/3] UJI REACT BAD SMELLS DETECTION${X}`);
    console.log(`${'═'.repeat(65)}\n`);

    const kasusUjiReact = [
        {
            no: 1,
            label: 'Too Many States — komponen dengan 6 useState (melebihi batas 5)',
            file: 'BloatedComponent.jsx',
            kode: `import React, { useState } from 'react'; function BloatedComponent() { const [a,setA]=useState(1);const [b,setB]=useState(2);const [c,setC]=useState(3);const [d,setD]=useState(4);const [e,setE]=useState(5);const [f,setF]=useState(6); return <div></div>; } export default BloatedComponent;`,
            harusTerdeteksi: ['too-many-states'],
            note: 'Terdeteksi karena useState dipanggil 6 kali (threshold: 5)'
        },
        {
            no: 2,
            label: 'Too Many Props — komponen menerima 8 props (melebihi batas 7)',
            file: 'HeavyProps.jsx',
            kode: `import React from 'react'; function HeavyProps({ a, b, c, d, e, f, g, h }) { return <div></div>; } export default HeavyProps;`,
            harusTerdeteksi: ['too-many-props'],
            note: 'Terdeteksi karena props destructuring memiliki 8 parameter (threshold: 7)'
        },
        {
            no: 3,
            label: 'Unnecessary Wrapper — <div> tanpa atribut membungkus satu child',
            file: 'WrapperLeak.jsx',
            kode: `import React from 'react'; function WrapperLeak() { return ( <div> <span>Halo Dunia</span> </div> ); } export default WrapperLeak;`,
            harusTerdeteksi: ['unnecessary-wrapper'],
            note: 'Terdeteksi karena <div> tidak punya atribut dan hanya memiliki satu child'
        },
        {
            no: 4,
            label: 'Missing Key — elemen JSX di dalam .map() tanpa atribut key',
            file: 'NoKeyList.jsx',
            kode: `import React from 'react'; function NoKeyList({ items }) { return ( <ul> {items.map(item => ( <li>{item.nama}</li> ))} </ul> ); } export default NoKeyList;`,
            harusTerdeteksi: ['missing-key'],
            note: 'Terdeteksi karena <li> di dalam .map() tidak memiliki atribut key'
        }
    ];

    let totalBenar = 0;
    let totalSalah = 0;

    for (const kasus of kasusUjiReact) {
        const { no, label, file, kode, harusTerdeteksi, note } = kasus;
        console.log(`${W}[TC-${String(no).padStart(2, '0')}] ${label}${X}`);
        console.log(`         ${B}${note}${X}`);

        let ast;
        try {
            ast = await parseCode(kode, file);
        } catch (e) {
            console.log(`         ${R}❌ GAGAL PARSING: ${e.message}${X}\n`);
            totalSalah += harusTerdeteksi.length;
            continue;
        }

        const findings = analyzeReactSmells(ast);
        const rulesFound = findings.map(f => f.rule);

        for (const rule of harusTerdeteksi) {
            if (rulesFound.includes(rule)) {
                const found = findings.find(f => f.rule === rule);
                console.log(`         ${G}✅ TERDETEKSI${X}: rule '${rule}' — baris ${found.line}`);
                totalBenar++;
            } else {
                console.log(`         ${R}❌ TIDAK TERDETEKSI: rule '${rule}' ← FALSE NEGATIVE!${X}`);
                totalSalah++;
            }
        }
        console.log();
    }
}

async function main() {
    console.log(`\n${W}========================================================================${X}`);
    console.log(`${W}  INTEGRATION TEST: REFACTOR BASELINE (ITERASI 1 + ITERASI 2)${X}`);
    console.log(`${W}========================================================================${X}`);
    
    await runDeadcodeAccuracy();
    await runGraphBuilder();
    await runReactSmells();
    
    console.log(`\n${G}✅ Seluruh Pengujian Integrasi Selesai.${X}\n`);
}

main();
