import { parse } from '@typescript-eslint/typescript-estree';
import { parseCode, parserCache } from '../src/parser/astParser.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function getTestFiles(dir, fileList = []) {
    const files = await fs.readdir(dir);
    for (const file of files) {
        const filePath = path.join(dir, file);
        if (filePath.includes('node_modules') || filePath.includes('.git') || filePath.includes('dist')) continue;
        const stat = await fs.stat(filePath);
        if (stat.isDirectory()) {
            await getTestFiles(filePath, fileList);
        } else if (file.endsWith('.js') || file.endsWith('.ts') || file.endsWith('.mjs')) {
            fileList.push(filePath);
        }
    }
    return fileList;
}

const ITERATIONS = 10;
const WARMUP = 3;

function calculateStats(times) {
    times.sort((a, b) => a - b);
    const sum = times.reduce((a, b) => a + b, 0);
    const avg = sum / times.length;
    const median = times.length % 2 === 0 
        ? (times[times.length / 2 - 1] + times[times.length / 2]) / 2 
        : times[Math.floor(times.length / 2)];
    return { avg, median, raw: times };
}

async function runBenchmark() {
    console.log('Gathering files for benchmark...');
    const projectRoot = path.join(__dirname, '..');
    const allFiles = await getTestFiles(projectRoot);
    const filesToTest = allFiles.slice(0, 38); // We will test 38 files as the doc says 38 files.
    
    console.log(`Found ${filesToTest.length} files to test.`);
    
    // Pre-read files
    const fileContents = [];
    for (const file of filesToTest) {
        const content = await fs.readFile(file, 'utf-8');
        fileContents.push({ file, content });
    }

    const PARSER_OPTIONS = {
        loc: true,
        range: true,
        jsx: true,
        comment: true,
        errorOnUnknownASTType: false,
        allowHashBang: true,
    };

    console.log('--- WARMUP ---');
    for (let i = 0; i < WARMUP; i++) {
        for (const { file, content } of fileContents) {
            parse(content, { ...PARSER_OPTIONS, filePath: file });
        }
    }
    console.log('Warmup complete.');

    // 1. Raw parser (No Cache) - Using pure `parse`
    console.log('\n--- RAW PARSER (NO CACHE) ---');
    const rawTimes = [];
    for (let i = 0; i < ITERATIONS; i++) {
        const start = performance.now();
        for (const { file, content } of fileContents) {
            // We simulate 3 accesses per file (as described in the document)
            for (let j = 0; j < 3; j++) {
                parse(content, { ...PARSER_OPTIONS, filePath: file });
            }
        }
        const end = performance.now();
        rawTimes.push(end - start);
    }
    const rawStats = calculateStats(rawTimes);

    // 2. Parser with Cache - Using `parseCode`
    console.log('\n--- PARSER WITH CACHE ---');
    const cacheTimes = [];
    for (let i = 0; i < ITERATIONS; i++) {
        parserCache.clear(); // Clear cache between benchmark iterations to be fair
        const start = performance.now();
        for (const { file, content } of fileContents) {
            // We simulate 3 accesses per file
            for (let j = 0; j < 3; j++) {
                await parseCode(content, file);
            }
        }
        const end = performance.now();
        cacheTimes.push(end - start);
    }
    const cacheStats = calculateStats(cacheTimes);

    const report = {
        filesTested: filesToTest.length,
        iterations: ITERATIONS,
        rawParser: rawStats,
        cachedParser: cacheStats
    };

    console.log('\n--- RESULTS ---');
    console.log(`Raw Parser (No Cache) -> Avg: ${rawStats.avg.toFixed(2)}ms, Median: ${rawStats.median.toFixed(2)}ms`);
    console.log(`Parser with Cache     -> Avg: ${cacheStats.avg.toFixed(2)}ms, Median: ${cacheStats.median.toFixed(2)}ms`);
    
    await fs.writeFile(path.join(__dirname, 'benchmark_results.json'), JSON.stringify(report, null, 2));
    console.log('\nRaw output saved to benchmark_results.json');
}

runBenchmark().catch(console.error);
