function unusedHelper() { return 1; }
const used = 10;
console.log(used);
const unusedVar = 20;

if (false) {
    console.log("Dead branch");
}
