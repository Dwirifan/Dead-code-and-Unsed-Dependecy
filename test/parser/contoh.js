import { format } from 'date-fns'; // [TEST 1] Dipanggil di dalam fungsi
import _, { cloneDeep } from 'lodash'; // [TEST 2] _ tidak dipakai (Dead), cloneDeep dipakai
import './global-style.css'; // [TEST 3] Side-effect import (Harus dipertahankan!)

// [TEST 4] Variabel global statis (TIDAK DIPAKAI -> DEAD CODE)
const GLOBAL_UNUSED = "Saya tidak berguna";

// [TEST 5] Variabel global dipakai
const GLOBAL_USED = "Saya terpakai";

function main() {
    console.log(GLOBAL_USED);

    // [TEST 6] Hoisting & Block Scope
    if (true) {
        var bocor = "Saya bocor ke luar block"; // var tembus ke scope fungsi main
        let tertahan = "Saya aman"; // let mati di sini jika tidak dipanggil di dalam if
    }
    console.log(bocor); // 'bocor' tervalidasi sebagai terpakai. 'tertahan' adalah Dead Code.

    // [TEST 7] Shadowing (Nama variabel sama dengan scope luar)
    const GLOBAL_USED = "Saya kloningan"; 
    console.log(GLOBAL_USED); // Ini memanggil GLOBAL_USED lokal, BUKAN yang di atas fungsi.

    // [TEST 8] Deep Destructuring (Ujian berat untuk Tukang Urai)
    const dataPegawai = {
        id: 1,
        profil: { nama: "Dwi", umur: 22 },
        skill: ["JS", "TS", "Node"]
    };

    // 'umur' dan 'skillUtama' dipakai. 'nama' dan 'sisaSkill' adalah Dead Code.
    const { 
        profil: { nama, umur }, 
        skill: [skillUtama, ...sisaSkill] 
    } = dataPegawai;

    console.log(umur, skillUtama);
}

// [TEST 9] Pemanggilan fungsi yang membuat parameter menjadi valid
function hitung(a, b, c) { // 'c' adalah parameter tak terpakai (Dead Code)
    const hasil = a + b;
    return cloneDeep(hasil);
}

// Eksekusi
main();
hitung(10, 20, 30);