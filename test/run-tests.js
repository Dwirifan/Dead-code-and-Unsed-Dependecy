/**
 * Automated Test Runner for DeadKiller Tool
 * Runs without external test frameworks — pure Node.js
 * 
 * Usage: node test/run-tests.js
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { parseCode } from '../src/parser/astParser.js';
import { findDeadCode } from '../src/analyzer/deadcode/deadCodeAnalyzer.js';
import { buildProjectGraph } from '../src/analyzer/projectGraph.js';
import fs from 'fs-extra';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── Test Utilities ───────────────────────────────────────────────

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failures = [];

function assert(condition, testName, details = '') {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`   ✅ ${testName}`);
    } else {
        failedTests++;
        console.log(`   ❌ ${testName}${details ? ' — ' + details : ''}`);
        failures.push({ testName, details });
    }
}

function getDeadNames(deadNodes) {
    return deadNodes.map(d => d.name);
}

// ─── Test Suite 1: Destructuring Support ──────────────────────────

async function testDestructuring() {
    console.log('\n📦 Test Suite: Destructuring Support');
    console.log('─'.repeat(50));

    const filePath = path.join(__dirname, 'test-destructuring', 'index.js');
    const code = await fs.readFile(filePath, 'utf-8');
    const ast = parseCode(code);
    const deadNodes = findDeadCode(ast);
    const deadNames = getDeadNames(deadNodes);

    // Expected dead: age, third, zip, fallback, unusedRegular
    assert(deadNames.includes('age'), 'Detects unused destructured object property (age)');
    assert(deadNames.includes('third'), 'Detects unused destructured array element (third)');
    assert(deadNames.includes('zip'), 'Detects unused nested destructured property (zip)');
    assert(deadNames.includes('fallback'), 'Detects unused default value destructuring (fallback)');
    assert(deadNames.includes('unusedRegular'), 'Detects regular unused variable (unusedRegular)');

    // Expected LIVE (should NOT be in dead list):
    assert(!deadNames.includes('name'), 'Object destructured "name" is NOT false positive');
    assert(!deadNames.includes('first'), 'Array destructured "first" is NOT false positive');
    assert(!deadNames.includes('second'), 'Array destructured "second" is NOT false positive');
    assert(!deadNames.includes('city'), 'Nested destructured "city" is NOT false positive');
    assert(!deadNames.includes('userName'), 'Renamed destructured "userName" is NOT false positive');
    assert(!deadNames.includes('rest'), 'Rest element "rest" is NOT false positive');
}

// ─── Test Suite 2: Var vs Let/Const Scope ─────────────────────────

async function testVarScope() {
    console.log('\n📦 Test Suite: Var vs Let/Const Scope');
    console.log('─'.repeat(50));

    const filePath = path.join(__dirname, 'test-var-scope', 'index.js');
    const code = await fs.readFile(filePath, 'utf-8');
    const ast = parseCode(code);
    const deadNodes = findDeadCode(ast);
    const deadNames = getDeadNames(deadNodes);

    // var inside block used outside → should NOT be dead
    assert(!deadNames.includes('hoistedResult'), 'var "hoistedResult" inside if block is NOT false positive (hoisted)');
    
    // let inside block unused → SHOULD be dead
    assert(deadNames.includes('blockScopedUnused'), 'let "blockScopedUnused" inside block IS detected as dead');

    // var in for loop used after → should NOT be dead
    assert(!deadNames.includes('lastValue'), 'var "lastValue" in for loop is NOT false positive (hoisted)');
    assert(!deadNames.includes('i'), 'var "i" in for loop is NOT false positive (hoisted)');

    // var in nested blocks → should NOT be dead
    assert(!deadNames.includes('deepVar'), 'var "deepVar" in nested blocks is NOT false positive (hoisted)');

    // const unused → SHOULD be dead
    assert(deadNames.includes('neverUsed'), 'const "neverUsed" IS detected as dead');
}

// ─── Test Suite 3: TypeScript File Support ────────────────────────

async function testTypeScript() {
    console.log('\n📦 Test Suite: TypeScript File Support');
    console.log('─'.repeat(50));

    // Test 1: Parser can handle TypeScript syntax
    const filePath = path.join(__dirname, 'test-typescript', 'index.ts');
    let parsed = false;
    let deadNodes = [];
    try {
        const code = await fs.readFile(filePath, 'utf-8');
        const ast = parseCode(code);
        parsed = true;
        deadNodes = findDeadCode(ast);
    } catch (err) {
        // parse failed
    }

    assert(parsed, 'TypeScript file parses without error');

    if (parsed) {
        const deadNames = getDeadNames(deadNodes);
        assert(deadNames.includes('unusedTyped'), 'Detects unused typed variable (unusedTyped) in .ts file');
        assert(deadNames.includes('unusedHelper'), 'Detects unused typed function (unusedHelper) in .ts file');
        assert(!deadNames.includes('user'), 'Used typed variable "user" is NOT false positive');
    }

    // Test 2: Graph traversal picks up .ts files
    const projectDir = path.join(__dirname, 'test-typescript');
    try {
        const graph = await buildProjectGraph(projectDir);
        const liveFileNames = [...graph.liveFiles].map(f => path.basename(f));
        assert(liveFileNames.includes('index.ts'), 'Graph includes index.ts as live file');
        assert(liveFileNames.includes('helper.ts'), 'Graph includes helper.ts as live file (imported by index.ts)');
    } catch (err) {
        assert(false, 'Graph builds successfully for TypeScript project', err.message);
    }
}

// ─── Test Suite 4: isReference Accuracy ───────────────────────────

async function testIsReference() {
    console.log('\n📦 Test Suite: isReference Accuracy');
    console.log('─'.repeat(50));

    // Test that import names don't count as references
    const importCode = `
        import { usedFunc } from './module.js';
        import unusedDefault from './other.js';
        const result = usedFunc();
        console.log(result);
    `;
    const ast = parseCode(importCode);
    const deadNodes = findDeadCode(ast);
    const deadNames = getDeadNames(deadNodes);

    assert(!deadNames.includes('usedFunc'), 'Imported and called function is NOT dead');
    assert(deadNames.includes('unusedDefault'), 'Imported but unused default is detected as dead');
    assert(!deadNames.includes('result'), 'Variable "result" that is used (via console.log) is NOT dead');
}

// ─── Test Suite 5: Dead Branch Detection ──────────────────────────

async function testDeadBranch() {
    console.log('\n📦 Test Suite: Dead Branch Detection');
    console.log('─'.repeat(50));

    const branchCode = `
        if (false) {
            console.log('unreachable');
        }
        
        if (true) {
            console.log('reachable');
        } else {
            console.log('dead else');
        }
        
        const x = 10;
        console.log(x);
    `;
    const ast = parseCode(branchCode);
    const deadNodes = findDeadCode(ast);
    const deadBranches = deadNodes.filter(d => d.type === 'DeadBranch');

    assert(deadBranches.length === 2, `Detects 2 dead branches (found ${deadBranches.length})`);
    assert(!getDeadNames(deadNodes).includes('x'), 'Variable "x" used after branches is NOT dead');
}

// ─── Test Suite 6: Project Graph (Existing test_scope) ────────────

async function testProjectGraph() {
    console.log('\n📦 Test Suite: Project Graph (test_scope)');
    console.log('─'.repeat(50));

    const projectDir = path.join(__dirname, '..', 'test_scope');
    
    try {
        const graph = await buildProjectGraph(projectDir);
        const liveBasenames = [...graph.liveFiles].map(f => path.basename(f));
        
        assert(liveBasenames.includes('index.js'), 'Entry point index.js is live');
        assert(liveBasenames.includes('fileA.js'), 'Imported fileA.js is live');
        assert(liveBasenames.includes('fileB.js'), 'Imported fileB.js is live');
        assert(liveBasenames.includes('logger.js'), 'Imported logger.js is live');
        assert(liveBasenames.includes('dynamic.js'), 'Dynamically imported dynamic.js is live');
        
        assert(graph.edges.length > 0, 'Graph has edges');
    } catch (err) {
        assert(false, 'Project graph builds successfully', err.message);
    }
}

// ─── Run All Tests ────────────────────────────────────────────────

async function main() {
    console.log('╔══════════════════════════════════════════════════╗');
    console.log('║    🧪 DeadKiller — Automated Test Suite         ║');
    console.log('╚══════════════════════════════════════════════════╝');

    await testDestructuring();
    await testVarScope();
    await testTypeScript();
    await testIsReference();
    await testDeadBranch();
    await testProjectGraph();

    // Summary
    console.log('\n' + '═'.repeat(50));
    console.log(`📊 Results: ${passedTests}/${totalTests} passed, ${failedTests} failed`);
    
    if (failedTests > 0) {
        console.log('\n❌ Failed Tests:');
        failures.forEach(f => {
            console.log(`   - ${f.testName}${f.details ? ': ' + f.details : ''}`);
        });
        process.exit(1);
    } else {
        console.log('\n✅ All tests passed!');
        process.exit(0);
    }
}

main().catch(err => {
    console.error('💥 Test runner crashed:', err);
    process.exit(1);
});
