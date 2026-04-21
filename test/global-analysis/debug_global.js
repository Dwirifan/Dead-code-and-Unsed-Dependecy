import { buildProjectGraph } from '../../src/analyzer/projectGraph.js';
import { findDeadCode } from '../../src/analyzer/deadcode/deadCodeAnalyzer.js';
import { parseCode } from '../../src/parser/astParser.js';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = __dirname;

async function debugGlobalAnalysis() {
    console.log('=== DEBUG: Global Analysis ===\n');

    // 1. Build Graph
    const graph = await buildProjectGraph(projectRoot);

    console.log('--- Live Files ---');
    for (const f of graph.liveFiles) {
        console.log(`  ✅ ${path.relative(projectRoot, f)}`);
    }

    console.log('\n--- Global Registry: usedExports ---');
    for (const [file, names] of graph.globalRegistry.usedExports) {
        console.log(`  📄 ${path.relative(projectRoot, file)} → dipakai: [${[...names].join(', ')}]`);
    }

    console.log('\n--- Dead Code per Live File ---');
    for (const file of graph.liveFiles) {
        const code = await fs.readFile(file, 'utf-8');
        const ast = parseCode(code);
        const deadNodes = findDeadCode(ast, file, graph.globalRegistry, null);

        const relPath = path.relative(projectRoot, file);
        if (deadNodes.length > 0) {
            console.log(`\n  📄 ${relPath}:`);
            deadNodes.forEach(d => {
                console.log(`     [Line ${d.line}] ${d.type} '${d.name}' (range: ${d.node.range})`);
            });
        } else {
            console.log(`  📄 ${relPath}: ✅ Clean`);
        }
    }
}

debugGlobalAnalysis().catch(console.error);
