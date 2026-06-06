const fs = require('fs-extra');
const path = require('path');

const runTestsPath = path.join(__dirname, 'test', 'run-tests.js');
const sourceCode = fs.readFileSync(runTestsPath, 'utf8');

// The header that will be injected to every test file
const testHeader = `import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// === Module Under Test ===
import { parseCode, ParseError } from '../../src/parser/astParser.js';
import { findDeadCode } from '../../src/analyzer/deadcode/deadCodeAnalyzer.js';
import { removeDeadCode } from '../../src/eliminator/codeCleaner.js';
import { RuleEngine } from '../../src/analyzer/ruleEngine.js';
import { Scope } from '../../src/analyzer/deadcode/scope.js';
import { buildCFG, buildCallGraph, analyzePathSensitive } from '../../src/analyzer/deadcode/flowAnalyzer.js';

// ─── Helper ─────────────────────────────────────────────────────────────
function analyze(code, ruleEngine = null) {
    const ast = parseCode(code, 'test.js');
    return findDeadCode(ast, 'test.js', null, ruleEngine);
}

function findByName(results, name) {
    return results.find(r => r.name === name);
}

function hasResult(results, name) {
    return results.some(r => r.name === name);
}

function hasType(results, type) {
    return results.some(r => r.type === type);
}

`;

const mapping = {
    'astParser.test.js': { dir: 'parser', patterns: ['AST Parser — Parsing'] },
    'codeCleaner.test.js': { dir: 'eliminator', patterns: ['Code Cleaner — Penghapusan Dead Code'] },
    'ruleEngine.test.js': { dir: 'analyzer', patterns: ['Rule Engine — Konfigurasi & Filter'] },
    'scope.test.js': { dir: 'analyzer', patterns: ['Scope System — Lexical Environment', 'Scope Analyzer — Callback & Higher-Order Functions', 'Scope Analyzer — JSX/TSX Awareness', 'Scope Analyzer — TypeScript-Specific Types', 'Scope Analyzer — Cross-File Export (Strict Mode)'] },
    'flowAnalyzer.test.js': { dir: 'analyzer', patterns: ['Flow Analyzer — Control Flow Graph', 'Flow Analyzer — Function Call Graph', 'Flow Analyzer — Path-Sensitive Analysis'] },
    'logicAnalyzer.test.js': { dir: 'analyzer', patterns: ['Logic Analyzer — Condition Contradiction', 'Logic Analyzer — Switch-Case Advanced'] },
    'redundancyAnalyzer.test.js': { dir: 'analyzer', patterns: ['Redundancy Analyzer — Redundant Patterns'] },
    'branchAnalyzer.test.js': { dir: 'analyzer', patterns: ['Branch Analyzer — Enhanced Constant Folding', 'Branch Analyzer — Negasi Operator', 'Branch Analyzer — Redundant Boolean Logic', 'Branch Analyzer — Dead Loop', 'Branch Analyzer — Short-Circuit & Ternary', 'Branch Analyzer — Constant Propagation', 'Branch Analyzer — Empty Block Detection', 'Branch Analyzer — Loop Always-Break', 'Branch Analyzer — Constant Propagation Advanced'] },
    'deadCodeAnalyzer.test.js': { dir: 'analyzer', patterns: ['Dead Code Analyzer — Unused Variables', 'Dead Code Analyzer — Unused Functions', 'Dead Code Analyzer — Unused Imports', 'Dead Code Analyzer — Unreachable Code', 'Dead Code Analyzer — Write-Only Variables', 'Dead Code Analyzer — Confidence & Status', 'Dead Code Analyzer — Destructuring', 'Dead Code Analyzer — Scope & Block', 'Dead Code Analyzer — Side-Effect Imports', 'Dead Code Analyzer — Duplicate Imports'] }
};

// Create dirs
['parser', 'analyzer', 'eliminator', 'commands', 'ui'].forEach(dir => {
    fs.ensureDirSync(path.join(__dirname, 'test', dir));
});

// Extract all describes
// We use a simple regex but considering blocks can have nested {} we should use a balance counter or split by describe.
// Looking at the code, every top level describe starts with `describe('Title', () => {` and ends with `});\n\n` or similar.
const blockSplits = sourceCode.split(/^describe\(/m);
const describeBlocks = {};

// Skip index 0 because it's the header
for (let i = 1; i < blockSplits.length; i++) {
    const block = 'describe(' + blockSplits[i];
    const titleMatch = block.match(/^describe\('([^']+)'/);
    if (titleMatch) {
        describeBlocks[titleMatch[1]] = block;
    }
}

// Write files
for (const [filename, config] of Object.entries(mapping)) {
    let content = testHeader;
    for (const pattern of config.patterns) {
        if (describeBlocks[pattern]) {
            content += describeBlocks[pattern] + '\n';
        } else {
            console.warn("MISSING BLOCK:", pattern);
        }
    }
    fs.writeFileSync(path.join(__dirname, 'test', config.dir, filename), content);
}

// Package.json update
const pkgPath = path.join(__dirname, 'package.json');
let pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
pkg.scripts.test = "node --test test/**/*.test.js";
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));

// Delete old file
fs.unlinkSync(runTestsPath);
console.log('Split completed successfully.');
