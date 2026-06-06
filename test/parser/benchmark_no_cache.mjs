import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCode } from '../../src/parser/astParser.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../src');

// Fungsi pembantu untuk mencari semua file .js/.mjs secara rekursif
async function getFiles(dir) {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(dirents.map((dirent) => {
        const res = path.resolve(dir, dirent.name);
        return dirent.isDirectory() ? getFiles(res) : res;
    }));
    return Array.prototype.concat(...files).filter(file => file.endsWith('.js') || file.endsWith('.mjs'));
}

async function runBenchmark() {
    console.log("=================================================================");
    console.log("  BENCHMARK: TANPA PARSE CACHE");
    console.log("=================================================================");

    console.log("\nMengumpulkan semua file di direktori src/...");
    const files = await getFiles(PROJECT_ROOT);
    console.log(`Ditemukan ${files.length} file untuk diuji.\n`);

    const start = Date.now();
    let totalParseCalls = 0;

    // Simulasi Modul 1: Dead Code Analyzer
    console.log("[Analyzer 1] Memparsing semua file...");
    for (const file of files) {
        const code = await fs.readFile(file, 'utf8');
        parseCode(code, file);
        totalParseCalls++;
    }

    // Simulasi Modul 2: Dependency Graph Builder
    console.log("[Analyzer 2] Memparsing semua file (DUPLIKASI KERJA)...");
    for (const file of files) {
        const code = await fs.readFile(file, 'utf8');
        parseCode(code, file);
        totalParseCalls++;
    }

    // Simulasi Modul 3: Metrics Analyzer
    console.log("[Analyzer 3] Memparsing semua file (DUPLIKASI KERJA)...");
    for (const file of files) {
        const code = await fs.readFile(file, 'utf8');
        parseCode(code, file);
        totalParseCalls++;
    }

    const duration = Date.now() - start;

    console.log("\n─────────────────────────────────────────────────────────────────");
    console.log("  HASIL BENCHMARK (TANPA CACHE)");
    console.log("─────────────────────────────────────────────────────────────────");
    console.log(`Total File Unik     : ${files.length}`);
    console.log(`Total Operasi Parse : ${totalParseCalls} kali`);
    console.log(`Waktu Eksekusi      : ${duration} ms`);
    console.log("=================================================================\n");
}

runBenchmark().catch(console.error);
