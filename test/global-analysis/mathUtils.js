// mathUtils.js — export beberapa fungsi, tapi tidak semuanya dipakai

export function tambah(a, b) {
    return a + b;
}

// SEHARUSNYA DEAD: tidak ada file lain yang import 'kurang'
export function kurang(a, b) {
    return a - b;
}

// SEHARUSNYA DEAD: tidak ada file lain yang import 'kali'
export function kali(a, b) {
    return a * b;
}

// Variabel internal yang tidak dipakai siapapun
const VERSI_INTERNAL = "1.0.0";
