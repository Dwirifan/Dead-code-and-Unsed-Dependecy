import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCode } from '../../src/parser/astParser.js';
import { ParseCache } from '../../src/parser/parseCache.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '../../src');

const G = '\x1b[32m'; const R = '\x1b[31m';
const Y = '\x1b[33m'; const W = '\x1b[1m';
const B = '\x1b[36m'; const X = '\x1b[0m';

// Fungsi pembantu untuk mencari semua file .js/.mjs secara rekursif
async function getFiles(dir) {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(dirents.map((dirent) => {
        const res = path.resolve(dir, dirent.name);
        return dirent.isDirectory() ? getFiles(res) : res;
    }));
    return Array.prototype.concat(...files).filter(file => file.endsWith('.js') || file.endsWith('.mjs'));
}

async function runBenchmarkNoCache(files) {
    console.log(`\n${'═'.repeat(65)}`);
    console.log(`${W}  [1/2] BENCHMARK: TANPA PARSE CACHE${X}`);
    console.log(`${'═'.repeat(65)}\n`);

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

    console.log(`\n${Y}Total Operasi Parse : ${totalParseCalls} kali${X}`);
    console.log(`${Y}Waktu Eksekusi      : ${duration} ms${X}`);
    
    return duration;
}

async function runBenchmarkWithCache(files) {
    console.log(`\n${'═'.repeat(65)}`);
    console.log(`${W}  [2/2] BENCHMARK: DENGAN PARSE CACHE${X}`);
    console.log(`${'═'.repeat(65)}\n`);

    const cache = new ParseCache();
    const start = Date.now();

    async function processFile(file) {
        let cached = await cache.get(file);
        if (!cached) {
            const code = await fs.readFile(file, 'utf8');
            const ast = parseCode(code, file);
            await cache.set(file, ast, code);
            return ast;
        }
        return cached.ast;
    }

    // Simulasi Modul 1: Dead Code Analyzer
    console.log("[Analyzer 1] Memparsing semua file (Mengisi cache)...");
    for (const file of files) {
        await processFile(file);
    }

    // Simulasi Modul 2: Dependency Graph Builder
    console.log("[Analyzer 2] Memparsing semua file (Membaca dari cache)...");
    for (const file of files) {
        await processFile(file);
    }

    // Simulasi Modul 3: Metrics Analyzer
    console.log("[Analyzer 3] Memparsing semua file (Membaca dari cache)...");
    for (const file of files) {
        await processFile(file);
    }

    const duration = Date.now() - start;
    const stats = cache.getStats();

    console.log(`\n${G}Operasi Miss (Baca) : ${stats.misses} kali${X}`);
    console.log(`${G}Operasi Hit (RAM)   : ${stats.hits} kali${X}`);
    console.log(`${G}Hit Rate Memori     : ${stats.hitRate}${X}`);
    console.log(`${G}Waktu Eksekusi      : ${duration} ms${X}`);

    return duration;
}

async function main() {
    console.log(`\n${W}========================================================================${X}`);
    console.log(`${W}  INTEGRATION TEST: PARSE CACHE BENCHMARK (REFACTOR BASELINE)${X}`);
    console.log(`${W}========================================================================${X}`);
    
    console.log("\nMengumpulkan semua file di direktori src/...");
    const files = await getFiles(PROJECT_ROOT);
    console.log(`Ditemukan ${B}${files.length}${X} file untuk diuji.\n`);

    const timeNoCache = await runBenchmarkNoCache(files);
    const timeWithCache = await runBenchmarkWithCache(files);

    const improvement = (((timeNoCache - timeWithCache) / timeNoCache) * 100).toFixed(1);

    console.log(`\n${'─'.repeat(65)}`);
    console.log(`${W}  KESIMPULAN BENCHMARK${X}`);
    console.log(`${'─'.repeat(65)}`);
    console.log(`  Waktu Tanpa Cache  : ${Y}${timeNoCache} ms${X}`);
    console.log(`  Waktu Dengan Cache : ${G}${timeWithCache} ms${X}`);
    console.log(`  Peningkatan        : ${G}Lebih cepat ${improvement}%${X}`);
    console.log(`${'═'.repeat(65)}\n`);
}

main().catch(console.error);
