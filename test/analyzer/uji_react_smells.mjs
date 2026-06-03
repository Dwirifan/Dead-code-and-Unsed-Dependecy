/**
 * ================================================================
 * UJI REACT BAD SMELLS DETECTION
 * ================================================================
 * 
 * Membuktikan bahwa reactAnalyzer.js dapat mendeteksi 4 anti-pattern
 * spesifik ekosistem React:
 *   Rule 1 — Too Many States
 *   Rule 2 — Too Many Props
 *   Rule 3 — Unnecessary Wrapper
 *   Rule 4 — Missing Key
 * 
 * Jalankan: node test/analyzer/uji_react_smells.mjs
 * ================================================================
 */

import { parseCode } from '../../src/parser/astParser.js';
import { analyzeReactSmells } from '../../src/analyzer/deadcode/react/reactAnalyzer.js';

const G = '\x1b[32m'; const R = '\x1b[31m';
const Y = '\x1b[33m'; const W = '\x1b[1m';
const B = '\x1b[36m'; const X = '\x1b[0m';

console.log(`\n${'═'.repeat(65)}`);
console.log(`${W}  UJI REACT BAD SMELLS DETECTION${X}`);
console.log(`  Modul   : src/analyzer/deadcode/react/reactAnalyzer.js`);
console.log(`  Tujuan  : Validasi 4 aturan deteksi anti-pattern React`);
console.log(`${'═'.repeat(65)}\n`);

// ── Skenario Uji ──────────────────────────────────────────────────
const kasusUji = [
    {
        no: 1,
        label: 'Too Many States — komponen dengan 6 useState (melebihi batas 5)',
        file: 'BloatedComponent.jsx',
        kode: `
import React, { useState } from 'react';

function BloatedComponent() {
    const [nama, setNama]         = useState('');
    const [umur, setUmur]         = useState(0);
    const [email, setEmail]       = useState('');
    const [aktif, setAktif]       = useState(false);
    const [peran, setPeran]       = useState('user');
    const [token, setToken]       = useState(null);

    return <div>{nama}</div>;
}
export default BloatedComponent;
`.trim(),
        harusTerdeteksi: ['too-many-states'],
        note: 'Terdeteksi karena useState dipanggil 6 kali (threshold: 5)'
    },
    {
        no: 2,
        label: 'Too Many Props — komponen menerima 8 props (melebihi batas 7)',
        file: 'HeavyProps.jsx',
        kode: `
import React from 'react';

function HeavyProps({ a, b, c, d, e, f, g, h }) {
    return <div>{a}</div>;
}
export default HeavyProps;
`.trim(),
        harusTerdeteksi: ['too-many-props'],
        note: 'Terdeteksi karena props destructuring memiliki 8 parameter (threshold: 7)'
    },
    {
        no: 3,
        label: 'Unnecessary Wrapper — <div> tanpa atribut membungkus satu child',
        file: 'WrapperLeak.jsx',
        kode: `
import React from 'react';

function WrapperLeak() {
    return (
        <div>
            <span>Halo Dunia</span>
        </div>
    );
}
export default WrapperLeak;
`.trim(),
        harusTerdeteksi: ['unnecessary-wrapper'],
        note: 'Terdeteksi karena <div> tidak punya atribut dan hanya memiliki satu child'
    },
    {
        no: 4,
        label: 'Missing Key — elemen JSX di dalam .map() tanpa atribut key',
        file: 'NoKeyList.jsx',
        kode: `
import React from 'react';

function NoKeyList({ items }) {
    return (
        <ul>
            {items.map(item => (
                <li>{item.nama}</li>
            ))}
        </ul>
    );
}
export default NoKeyList;
`.trim(),
        harusTerdeteksi: ['missing-key'],
        note: 'Terdeteksi karena <li> di dalam .map() tidak memiliki atribut key'
    },
    {
        no: 5,
        label: 'Komponen bersih — tidak ada anti-pattern (harus LOLOS)',
        file: 'CleanComponent.jsx',
        kode: `
import React, { useState } from 'react';

function CleanComponent({ items }) {
    const [aktif, setAktif] = useState(false);

    return (
        <>
            {items.map(item => (
                <li key={item.id}>{item.nama}</li>
            ))}
        </>
    );
}
export default CleanComponent;
`.trim(),
        harusTerdeteksi: [],
        note: 'Komponen ini bersih — tidak ada bad smell yang harus terdeteksi'
    }
];

// ── Runner ────────────────────────────────────────────────────────
let totalBenar = 0;
let totalSalah = 0;

for (const kasus of kasusUji) {
    const { no, label, file, kode, harusTerdeteksi, note } = kasus;
    console.log(`${W}[TC-${String(no).padStart(2, '0')}] ${label}${X}`);
    console.log(`         ${B}${note}${X}`);

    let ast;
    try {
        ast = parseCode(kode, file);
    } catch (e) {
        console.log(`         ${R}❌ GAGAL PARSING: ${e.message}${X}\n`);
        totalSalah += harusTerdeteksi.length;
        continue;
    }

    const findings = analyzeReactSmells(ast);
    const rulesFound = findings.map(f => f.rule);

    if (harusTerdeteksi.length === 0) {
        // Komponen bersih — tidak boleh ada findings
        if (findings.length === 0) {
            console.log(`         ${G}✅ BERSIH — tidak ada bad smell terdeteksi${X}`);
            totalBenar++;
        } else {
            console.log(`         ${R}❌ FALSE POSITIVE: terdeteksi ${findings.length} bad smell yang tidak seharusnya ada${X}`);
            findings.forEach(f => console.log(`            - ${f.rule}: ${f.name}`));
            totalSalah++;
        }
    } else {
        for (const rule of harusTerdeteksi) {
            if (rulesFound.includes(rule)) {
                const found = findings.find(f => f.rule === rule);
                console.log(`         ${G}✅ TERDETEKSI${X}: rule '${rule}' — baris ${found.line}`);
                console.log(`            ${Y}${found.name}${X}`);
                totalBenar++;
            } else {
                console.log(`         ${R}❌ TIDAK TERDETEKSI: rule '${rule}' ← FALSE NEGATIVE!${X}`);
                totalSalah++;
            }
        }
    }
    console.log();
}

// ── Ringkasan ─────────────────────────────────────────────────────
const akurasi = totalBenar + totalSalah > 0
    ? ((totalBenar / (totalBenar + totalSalah)) * 100).toFixed(1)
    : '100.0';

console.log(`${'─'.repeat(65)}`);
console.log(`${W}  RINGKASAN — Uji React Bad Smells${X}`);
console.log(`${'─'.repeat(65)}`);
console.log(`  Terdeteksi benar   : ${G}${totalBenar} aturan${X}`);
console.log(`  Tidak terdeteksi   : ${totalSalah > 0 ? R : G}${totalSalah} aturan${X}`);
console.log(`  Akurasi deteksi    : ${parseFloat(akurasi) >= 100 ? G : Y}${W}${akurasi}%${X}`);
console.log(`${'═'.repeat(65)}\n`);
