// Test file: demonstrasi semua kasus Dead Branch yang terdeteksi

// ─── Kasus 1: if (false) ─────────────────────────────────────────
if (false) {
    const unreachable = "I am dead code";
    console.log(unreachable); // Dead Branch
}

// ─── Kasus 2: if (true) else ─────────────────────────────────────
if (true) {
    console.log("I am alive");
} else {
    console.log("I am dead code (else block)"); // Dead Branch
}

// ─── Kasus 3: Dead code after return ─────────────────────────────
function greet(name) {
    return 'Hello ' + name;
    console.log('This never runs'); // Dead Code ← BARU
    const waste = 999;              // Dead Code ← BARU
}
greet('world');

// ─── Kasus 4: Dead code after throw ──────────────────────────────
function validate(x) {
    if (!x) {
        throw new Error('x is required');
        console.log('This never runs either'); // Dead Code ← BARU
    }
    return x;
}
validate(1);

// ─── Kasus 5: Dead code after break ──────────────────────────────
const val = 1;
switch (val) {
    case 1:
        console.log('matched');
        break;
        console.log('dead after break'); // Dead Code ← BARU
}
console.log(val);

// ─── Kasus 6: Dead code after continue ───────────────────────────
for (let i = 0; i < 3; i++) {
    if (i === 1) {
        continue;
        console.log('dead after continue'); // Dead Code ← BARU
    }
    console.log(i);
}
