// stringUtils.js — export beberapa fungsi

export function formatNama(depan, belakang) {
    return `${depan} ${belakang}`;
}

// SEHARUSNYA DEAD: tidak ada file lain yang import 'formatTanggal'
export function formatTanggal(tanggal) {
    return tanggal.toISOString();
}
