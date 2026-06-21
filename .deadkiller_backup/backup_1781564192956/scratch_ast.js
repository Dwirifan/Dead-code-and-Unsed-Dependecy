import { parse } from '@typescript-eslint/typescript-estree';
import util from 'util';

const code = `
function foo<T>(val: T) {
    return val;
}
`;
const ast = parse(code, { loc: true, range: true });
console.log(util.inspect(ast, { depth: null, colors: true }));
