import { parseCode } from '../src/parser/astParser.js';
import { findDeadCode } from '../src/analyzer/deadcode/deadCodeAnalyzer.js';
const code = `
function Header() { return null; }
function App() { return <Header />; }
`;
const ast = parseCode(code);
const results = findDeadCode(ast);
console.log(results);
