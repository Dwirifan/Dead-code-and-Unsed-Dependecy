# Iterasi 2: Pengembangan Mesin Pemetaan & Analisis (Graph Builder & Analyzer)

Iterasi kedua dalam metodologi PXP berfokus pada pembangunan dua otak utama dari sistem pelacak kode mati: **Graph Builder** (Mesin Pemetaan) dan **Analyzer** (Mesin Analisis). Jika Modul Pengurai di Iterasi 1 berfungsi sebagai "mata" yang membaca kode tunggal menjadi AST, maka iterasi ini membangun "peta navigasi" lintas berkas dan "detektif" yang menginvestigasi setiap variabel di dalamnya.

## Perencanaan Iterasi (Iteration Planning)

Sebelum tahapan *development* dimulai, disusun daftar kebutuhan (*User Stories/Tasks*) yang menjadi target luaran dari iterasi ini. Berikut adalah tabel perencanaan iterasi untuk Modul Analisis:

| No. | Task / User Story | Komponen | Tujuan | Prioritas |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Pembangunan Project Graph Analyzer | Graph Builder | Memetakan ketergantungan lintas-berkas secara menyeluruh menggunakan BFS, menembus alias dan *barrel file*. | Tinggi |
| 2 | Pembangunan Dead Code Analyzer | Analyzer | Melacak deklarasi dan referensi variabel/fungsi pada cakupan lokal dan lintas modul menggunakan *Lexical Scoping*. | Tinggi |
| 3 | Pembangunan Unused Dependency Analyzer | Analyzer | Memindai berkas `package.json` dan membandingkannya dengan jejak pemanggilan (*imports*) di AST. | Menengah |
| 4 | Validasi Akurasi Engine Lintas Modul | Testing | Menguji kemampuan TS-Estree melawan kegagalan Acorn dalam menangkap *dead code* TypeScript/JSX. | Tinggi |

---

## 1. Baseline Development

Pada fase *development*, fokus utama adalah membangun purwarupa algoritma untuk mendeteksi variabel dan fungsi yang tidak digunakan secara statis, namun masih terbatas dalam lingkup satu berkas tunggal (*Intra-file Analysis*).

### A. Implementasi Scope & Traversal Dasar
Algoritma deteksi diwujudkan melalui penggabungan *Abstract Syntax Tree* (AST) dengan konsep *Lexical Scoping*. Komponen inti yang dibangun adalah **Scope**, sebuah struktur data hierarkis yang mencatat:

- **Deklarasi (Declaration)**: Variabel, fungsi, class, atau type yang diciptakan.
- **Referensi (Reference)**: Kapan dan di mana nama-nama tersebut digunakan atau dipanggil.

```javascript
// Cuplikan Logika Baseline Development
estraverse.traverse(ast, {
    enter(node) {
        if (node.type === 'VariableDeclarator') {
            currentScope.addDeclaration(node.id.name);
        }
        if (node.type === 'Identifier') {
            if (isReference(node)) currentScope.addReference(node.name);
        }
    }
});
```

Pustaka `estraverse` digunakan untuk menelusuri AST secara mendalam (*Deep Traversal*). Setiap kali algoritma menemukan deklarasi, sistem akan memasukkannya ke dalam objek `Scope` saat ini. Ketika `Identifier` ditemukan, ia ditandai sebagai "terbaca" (*used*). Di akhir traversal, semua variabel yang ada di dalam kumpulan deklarasi namun memiliki jumlah referensi nol (0) akan langsung divonis sebagai **Dead Code**.

> [!WARNING]
> **Keterbatasan Baseline**: Purwarupa ini berhasil dengan sangat baik pada kode sederhana di dalam satu file. Namun, ia gagal total ketika dihadapkan pada arsitektur perangkat lunak modern yang membagi kodenya ke ratusan berkas dengan pola *import/export*. Variabel yang diekspor (`export const config`) divonis sebagai Dead Code karena tidak dipanggil di file yang sama, mengabaikan fakta bahwa variabel tersebut mungkin diimpor oleh file lain.

---

## 2. Baseline Refactor

Untuk mengatasi kegagalan analisis lintas berkas (*Cross-file Analysis*), arsitektur direfaktor secara radikal dengan menambahkan entitas baru: **Graph Builder**.

### A. Membangun Project Graph
**Graph Builder** bertugas menelusuri proyek secara menyeluruh dimulai dari *Entry Point* (misalnya `src/index.js`), kemudian merayapi pohon *import* menggunakan algoritma *Breadth-First Search* (BFS) untuk membangun Graf Ketergantungan (*Dependency Graph*).

Untuk mendemonstrasikan kapabilitas mesin pemetaan ini, dibuat skenario uji simulasi proyek (`test/analyzer/uji_graph_builder.mjs`) dengan struktur berlapis:

```text
dummy_project/
├── index.js                  (Entry Point)
├── components/Button.jsx     (Komponen UI)
└── utils/
    ├── index.js              (Barrel File)
    └── math.js               (Utilitas Logika)
```

Eksekusi algoritma Graph Builder pada proyek tiruan tersebut menghasilkan struktur lintasan (*edges*) berikut di terminal:

```text
1. Daftar File yang Terjangkau (Live Files):
   1. components\Button.jsx
   2. index.js
   3. utils\index.js
   4. utils\math.js
2. Lintasan Dependensi (Edges):
   ┌─[index.js]
   ├─ Mengimpor : { add }
   └─ Ke berkas ➔ utils\index.js
   ┌─[index.js]
   ├─ Mengimpor : { Button }
   └─ Ke berkas ➔ components\Button.jsx
   ┌─[utils\index.js]
   ├─ Mengimpor : { add, subtract }
   └─ Ke berkas ➔ utils\math.js
```

### B. Resolusi Barrel File
Output di atas membuktikan bahwa Graph Builder tidak hanya memetakan tautan dasar, tetapi juga berhasil menangani **Barrel Export**—sebuah pola arsitektural yang rumit di mana sebuah berkas (`utils/index.js`) bertindak murni sebagai "makelar" yang mengekspor ulang (*re-export*) fungsi dari berkas lain di bawahnya (`utils/math.js`). Graf berhasil menembus lapisan makelar tersebut untuk merekatkan dependensi langsung ke sumber aslinya.

---

## 3. Baseline Production

Setelah komponen Analyzer diintegrasikan dengan Graph Builder, keseluruhan sistem telah siap untuk menangani proyek nyata. Pada tahap ini, pengujian difokuskan pada keakuratan sistem dalam menemukan kode mati, terutama yang menggunakan sintaksis TypeScript kompleks (berkaitan langsung dengan resolusi bug Parser dari Iterasi 1).

### A. Uji Akurasi Dead Code (Empiris)
Skrip `test/analyzer/uji_akurasi_deadcode.mjs` dibuat dengan memuat 10 Skenario Kode Mati (*Dead Code Scenarios*) yang beragam—mulai dari *unused import* standar hingga ekspor tipe abstrak.

Sistem diuji coba pada dua *engine* parser yang berbeda untuk memvalidasi hipotesis dari Iterasi 1: **Apakah Acorn benar-benar memicu False Negative pada deteksi Dead Code?**

**Hasil Eksekusi Menggunakan Acorn:**
```text
[TC-01] Unused import JavaScript biasa (.js)
✅ TERDETEKSI: 'format' (Variable, baris 1)
[TC-04] Unused TypeScript interface
❌ TIDAK TERDETEKSI: 'UserProfile' ← FALSE NEGATIVE!
[TC-10] Operator satisfies (TypeScript 4.9+)
❌ GAGAL PARSING: Failed to parse code: Unexpected token (2:2)
─────────────────────────────────────────────────────────────────
  RINGKASAN AKURASI DETEKSI — Engine: ACORN
─────────────────────────────────────────────────────────────────
  Terdeteksi benar  : 3 item
  Tidak terdeteksi  : 7 item (false negative)
  Akurasi deteksi   : 30.0%
```

**Hasil Eksekusi Menggunakan TS-Estree:**
```text
[TC-01] Unused import JavaScript biasa (.js)
✅ TERDETEKSI: 'format' (Variable, baris 1)
[TC-04] Unused TypeScript interface
✅ TERDETEKSI: 'UserProfile' (UnusedType, baris 1)
[TC-10] Operator satisfies (TypeScript 4.9+)
✅ PARSING BERHASIL — 0 dead code ditemukan
─────────────────────────────────────────────────────────────────
  RINGKASAN AKURASI DETEKSI — Engine: TS-ESTREE
─────────────────────────────────────────────────────────────────
  Terdeteksi benar  : 10 item
  Tidak terdeteksi  : 0 item (false negative)
  Akurasi deteksi   : 100.0%
```

### B. Kesimpulan Iterasi 2
Hasil Production Baseline mengunci validasi teknis yang membuktikan bahwa:

1. **Graph Builder** telah sukses meresolusi kompleksitas arsitektur lintas berkas (termasuk *Barrel File* dan resolusi *Alias*).
2. **Analyzer** mencapai tingkat **Akurasi Deteksi 100%** berkat dukungan node TypeScript penuh dari `TS-Estree` dan peta *visitor-keys* yang sempurna, menggugurkan 70% kecacatan siluman (*False Negative*) yang sempat dialami saat masih menggunakan Acorn.
3. Kombinasi Graph Builder dan Analyzer pada iterasi ini mengokohkan fondasi sistem untuk berlanjut ke tahap ekskusi fisik (**Eliminator**) pada iterasi berikutnya.
