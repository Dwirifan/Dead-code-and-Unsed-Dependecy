import { somethingElse } from './fileB.js';

function calculate() {
    return "This is a LOCAL calculate and it is used LOCALLY.";
}

export function runA() {
    console.log(calculate());
    console.log(somethingElse());
}
