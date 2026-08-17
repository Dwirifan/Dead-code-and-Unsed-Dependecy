// ============================================================================
// FILE PENGUJIAN: dirty.js
// Berisi kumpulan "Dead Code" dan "Code Smell" untuk mendemonstrasikan
// kecanggihan fitur DeadKiller.
// ============================================================================

// [Duplicate Import]

// 1. Unused Variable (SAFE)

// 2. Unused Function (REVIEW)
function forgottenFunction() {
    console.log("Fungsi ini kesepian...");
}

// 3. Unused Parameter (RISKY)
function calculateTotal(price, tax, discount) {
    // Parameter 'discount' tidak pernah dipakai
    return price + tax;
}

// 4. Unreachable Code (SAFE)
function processPayment() {
    return "SUCCESS";
    // Kode di bawah return tidak akan pernah tereksekusi
}

// 5. Empty Catch Block (REVIEW)
try {
} catch (error) {
    // Blok ini kosong, menelan error diam-diam
}

// 6. Redundant Code (REVIEW)
function mathLogic() {
    let x = 10;
    x = x; // Self assignment redundant

    42; // Standalone literal tanpa tujuan
}

// 7. Unused Class Method (RISKY)
class UserAuth {
    login() {
        return true;
    }

    // Method ini tidak pernah dipanggil
    logoutUnused() {
        return false;
    }
}

// Penggunaan (Agar file ini tidak dianggap sepenuhnya Dead File)
calculateTotal(100, 10, 5);
processPayment();
mathLogic();
const auth = new UserAuth();
auth.login();

// [Auto-Trigger] Komentar ini ditambahkan untuk memicu Watch Mode.
// Perhatikan apakah fungsi 'forgottenFunction' masih dilaporkan!
