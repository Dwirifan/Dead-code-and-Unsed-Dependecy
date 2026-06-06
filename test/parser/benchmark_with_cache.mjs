import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { parseCode } from '../../src/parser/astParser.js';
import { ParseCache } from '../../src/parser/parseCache.js';

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
    console.log("  BENCHMARK: DENGAN PARSE CACHE");
    console.log("=================================================================");

    console.log("\nMengumpulkan semua file di direktori src/...");
    const files = await getFiles(PROJECT_ROOT);
    console.log(`Ditemukan ${files.length} file untuk diuji.\n`);

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

    console.log("\n─────────────────────────────────────────────────────────────────");
    console.log("  HASIL BENCHMARK (DENGAN CACHE)");
    console.log("─────────────────────────────────────────────────────────────────");
    console.log(`Total File Unik     : ${files.length}`);
    console.log(`Operasi Miss (Baca) : ${stats.misses} kali`);
    console.log(`Operasi Hit (RAM)   : ${stats.hits} kali`);
    console.log(`Hit Rate Memori     : ${stats.hitRate}`);
    console.log(`Waktu Eksekusi      : ${duration} ms`);
    console.log("=================================================================\n");
}

runBenchmark().catch(console.error);
