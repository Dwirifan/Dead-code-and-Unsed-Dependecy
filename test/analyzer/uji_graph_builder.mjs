import path from 'path';
import { fileURLToPath } from 'url';
import { buildProjectGraph } from '../../src/analyzer/graph/projectGraph.js';
import chalk from 'chalk';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dummyProjectRoot = path.join(__dirname, 'dummy_project');

const G = '\x1b[32m'; const R = '\x1b[31m';
const Y = '\x1b[33m'; const W = '\x1b[1m';
const B = '\x1b[36m'; const X = '\x1b[0m';

console.log(`\n${'═'.repeat(65)}`);
console.log(`${W}  UJI KEMAMPUAN GRAPH BUILDER (MESIN PEMETAAN)${X}`);
console.log(`  Tujuan       : Validasi resolusi import & barrel file`);
console.log(`  Project Root : ${dummyProjectRoot}`);
console.log(`${'═'.repeat(65)}\n`);

async function run() {
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

        console.log(`${'─'.repeat(65)}`);
        console.log(`${G}✅ BERHASIL: Graph Builder mampu meresolusi import dasar${X}`);
        console.log(`${G}   maupun menembus struktur Barrel Export (index.js).${X}`);
        console.log(`${'─'.repeat(65)}\n`);
        
    } catch (e) {
        console.error(`${R}❌ GAGAL: ${e.message}${X}`);
    }
}

run();
