import { parseCode } from '../src/parser/astParser.js';
import { findDeadCode } from '../src/analyzer/deadcode/deadCodeAnalyzer.js';
const code = `
function A() {} 
function B() {} 
function App(isAdmin) { const C = isAdmin ? A : B; return <C />; }
App();
`;
const ast = parseCode(code);
const results = findDeadCode(ast);
console.log(results);
