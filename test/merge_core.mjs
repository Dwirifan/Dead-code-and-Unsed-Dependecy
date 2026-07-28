import fs from 'fs';
import path from 'path';

const files = [
    'test/analyzer/unit/deadcode/core/scope.test.js',
    'test/analyzer/unit/deadcode/core/branchAnalyzer.test.js',
    'test/analyzer/unit/deadcode/core/logicAnalyzer.test.js',
    'test/analyzer/unit/deadcode/core/redundancyAnalyzer.test.js',
    'test/analyzer/unit/deadcode/core/flowAnalyzer.test.js'
];

let appendedContent = '\n// ' + '═'.repeat(70) + '\n// MERGED CORE TESTS\n// ' + '═'.repeat(70) + '\n\n';

for (const file of files) {
    const content = fs.readFileSync(file, 'utf-8');
    const describeIndex = content.indexOf('describe(');
    if (describeIndex !== -1) {
        let tests = content.substring(describeIndex);
        
        // Replace analyze(...) with await analisis(...)
        tests = tests.replace(/analyze\(/g, 'await analisis(');
        
        // Replace parseCode(...) with await parseCode(...)
        // Need to be careful not to replace it if it's already awaited, but they aren't.
        tests = tests.replace(/parseCode\(/g, 'await parseCode(');
        
        // Change it(...) to async
        tests = tests.replace(/it\((['`"].*?['`"]),\s*\(\)\s*=>\s*\{/g, 'it($1, async () => {');
        
        // Change it.skip(...) to async
        tests = tests.replace(/it\.skip\((['`"].*?['`"]),\s*\(\)\s*=>\s*\{/g, 'it.skip($1, async () => {');

        appendedContent += `// ─── From: ${path.basename(file)} ───\n` + tests + '\n\n';
    }
}

const targetFile = 'test/analyzer/pengujian_iterasi_2.test.js';
let targetContent = fs.readFileSync(targetFile, 'utf-8');
targetContent += appendedContent;
fs.writeFileSync(targetFile, targetContent, 'utf-8');
console.log('Merged successfully.');
