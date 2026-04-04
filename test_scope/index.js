import { runA } from './fileA.js';
import { info } from './logger.js';

runA();

console.log(info());
// Notice: console.log is used. Under the old analyzer, `logger.js:log` would be marked as USED globally!

await import(`./dynamic.js`);