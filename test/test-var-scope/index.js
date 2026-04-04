// TEST CASE: var vs let/const scope behavior

// Case 1: var inside if block, used outside — should NOT be dead code
function testVarHoisting() {
    if (true) {
        var hoistedResult = 42;
    }
    console.log(hoistedResult); // Valid! var is function-scoped
}
testVarHoisting();

// Case 2: let inside if block, NOT used outside — SHOULD be dead code
function testLetBlock() {
    if (true) {
        let blockScopedUnused = 99; // DEAD CODE — never used
    }
    // blockScopedUnused is not accessible here
    console.log('done');
}
testLetBlock();

// Case 3: var inside for loop, used after loop — should NOT be dead code
function testVarInLoop() {
    for (var i = 0; i < 5; i++) {
        var lastValue = i;
    }
    console.log(i, lastValue); // Valid! both are function-scoped via var
}
testVarInLoop();

// Case 4: var in nested block, used in function scope — should NOT be dead code
function testNestedVar() {
    if (true) {
        if (true) {
            var deepVar = 'deep';
        }
    }
    console.log(deepVar); // Valid! var hoists to function scope
}
testNestedVar();

// Case 5: const unused inside function — SHOULD be dead code
function testConstUnused() {
    const neverUsed = 'waste'; // DEAD CODE
    console.log('hello');
}
testConstUnused();
