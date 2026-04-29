import { unusedImport } from './lib.js'; // Category: Import

const usedVar = 10;
const unusedVar = 20; // Category: Variable

function test(a, b) { // Category: Parameter (b is unused)
    console.log(a);
    return;
    console.log("unreachable"); // Category: Unreachable
}

console.log(usedVar);
test(1);
