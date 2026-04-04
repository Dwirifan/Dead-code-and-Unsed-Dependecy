import { parseCode } from './src/parser/astParser.js';
import { findDeadCode } from './src/analyzer/deadcode/deadCodeAnalyzer.js';
import { removeDeadCode } from './src/eliminator/codeCleaner.js';

const codeWithDeadStuff = `
    const x = 10; // Used
    const unusedVar = 20; // DEAD
    
    function useful() {
        console.log(x);
    }
    
    function deadFunc() { // DEAD
        const innerUnused = 5; // DEAD
    }
    
    useful();
    
    export const publicApi = 100; // Should be USED/Live
`;

console.log('--- Original Code ---');
console.log(codeWithDeadStuff);

try {
    const ast = parseCode(codeWithDeadStuff);
    
    // 1. Analyze
    const deadNodes = findDeadCode(ast);
    
    if (deadNodes.length === 0) {
        console.log('✅ Clean! No dead code.');
    } else {
        console.log('\n⚠️  Dead Code Detected:');
        deadNodes.forEach(item => {
            console.log(`   [Line ${item.line}] ${item.type} '${item.name}'`);
        });

        // 2. Eliminate
        console.log('\n--- Eliminating Dead Code ---');
        const cleanedCode = removeDeadCode(ast, deadNodes);
        
        console.log('\n--- Result Code ---');
        console.log(cleanedCode);
    }

} catch (err) {
    console.error(err);
}
