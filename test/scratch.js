import { parseCode } from '../src/parser/astParser.js';
import { findDeadCode } from '../src/analyzer/deadcode/deadCodeAnalyzer.js';
const code = `
function transform(x) { return x * 2; }
const arr = [1, 2, 3];
arr.map(transform);
`;
const ast = parseCode(code);
const results = findDeadCode(ast);
console.log(results);
