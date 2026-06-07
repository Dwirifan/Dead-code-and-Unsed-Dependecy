# 4.6.2.2 Iterasi 2 : Pengembangan Mesin Pemetaan & Analisis (Graph Builder & Analyzer)

Iterasi kedua membangun dua komponen analitik sentral: **Graph Builder** (Mesin Pemetaan) untuk melacak ketergantungan lintas-berkas membentuk *Directed Acyclic Graph* (DAG), dan **Analyzer** (Mesin Analisis) untuk menelusuri AST dan mengekstraksi entitas yang tidak tereferensi (*dead code*).

## Perencanaan Iterasi & TaskPriorityList

Untuk merealisasikan sistem analisis *dead code* yang terintegrasi, berikut adalah rincian perencanaan (*Task Priority List*) yang akan dieksekusi secara berurutan:

| Prioritas | ID Task | Deskripsi Task |
|-----------|---------|----------------|
| 1 | T2-01 | Implementasi algoritma *Lexical Scoping* dasar untuk *intra-file analysis* |
| 2 | T2-02 | Implementasi *traversal* AST menggunakan `estraverse` |
| 3 | T2-03 | Pengujian validasi purwarupa *analyzer* terhadap konstruksi kode JavaScript dasar |
| 4 | T2-04 | Implementasi *Graph Builder* (BFS) untuk menyusun *dependency graph* lintas berkas |
| 5 | T2-05 | Implementasi *Unused Dependency Analyzer* membandingkan manifes dengan graf pemanggilan |
| 6 | T2-06 | Pengujian integrasi lintas modul (*Graph* + *Analyzer*) |
| 7 | T2-07 | Pembangunan Mesin Aturan (*Rule Engine*) dan integrasi `.deadkillerrc.json` |

---

## 1. Baseline Development

Fase ini merealisasikan fungsionalitas inti T2-01 hingga T2-06, berawal dari skala *intra-file* hingga analisis *inter-file* (*Graph*).

### A. Algoritma Lexical Scoping & Analisis Anomali (T2-01 & T2-02)

Tahap awal pengembangan berfokus pada pembangunan mesin analisis tingkat berkas tunggal (intra-file) berbasis Lexical Scoping, yang memanfaatkan Tabel Simbol untuk mencatat siklus hidup entitas serta pustaka estraverse untuk menelusuri AST dalam mengumpulkan data deklarasi dan referensi. Melalui pelacakan siklus hidup variabel (Variable Lifecycle Tracking) ini, entitas yang terdeklarasi namun memiliki referensi nol langsung divonis sebagai kode mati berbasis referensi. Fondasi utama ini kemudian dilengkapi dengan modul sub-analisis tambahan yang bekerja secara paralel, sehingga pada akhir fase development, sistem dirancang modular untuk mampu mendeteksi 11 klasifikasi anomali kode mati yang dikelompokkan ke dalam empat kategori utama.

**Kategori 1 — Kode Mati Berbasis Referensi (*Lexical Scope Tracking*)**
Menganalisis siklus hidup entitas dalam Tabel Simbol (*Scope*). Entitas dengan referensi nol divonis usang. Mekanisme **Read/Write Differentiation** diterapkan untuk memisahkan variabel yang murni ditulis dari yang dibaca penggunaannya:

| Kode Klasifikasi | Contoh Pola | Mekanisme Deteksi |
|---|---|---|
| `Variable` | `const x = 5;` | Lexical Scope Check |
| `WriteOnly` | `let y; y = 10;` | Read/Write Differentiation |
| `Function` | `function foo() {}` | Reference Counting |
| `Parameter` | `function bar(unused) {}` | Signature Scope Check |
| `UnusedType` | `interface IUser {}` | Type Reference Tracking |
| `ClassMethod` | `class A { dead() {} }` | AST Method Traversal |
| `DuplicateImport` | `import {x} from 'm'; import {x} from 'm';` | Import Signature Equality |

```javascript
// Cuplikan: Read/Write Differentiation di core/scope.js
export class Scope {
    resolve() {
        for (const ref of this.readReferences) if (ref !== this.selfName) this.markRead(ref);
        for (const ref of this.writeReferences) this.markWrite(ref); // WRITE tidak menandai 'used'
    }
}
```

Cuplikan fungsi `resolve()` di atas merupakan inti algoritma dari kecerdasan **Read/Write Differentiation** dalam memproses *Tabel Simbol*. Berikut adalah alur kerjanya:
1. **Validasi Referensi Baca:** Sistem melakukan iterasi pada *array* `readReferences`. Jika sebuah variabel dibaca (misalnya di-*console.log* atau dimasukkan ke dalam rumus), sistem akan mengeksekusi `markRead(ref)` untuk menandai bahwa variabel tersebut berstatus aktif (*used*).
2. **Isolasi Referensi Tulis:** Di sinilah letak perbedaannya. Saat mengiterasi `writeReferences` (operasi *assignment* seperti `x = 10`), sistem hanya mencatatnya dengan `markWrite(ref)` **tanpa** memberikannya status *used*. 

Mekanisme pemisahan ini sangat krusial. Jika sebuah variabel hanya memiliki rekam jejak operasi *write* namun rekam jejak operasi *read*-nya kosong, maka *Analyzer* dapat memvonisnya sebagai anomali tipe `WriteOnly` (variabel dimodifikasi tetapi nilainya tidak pernah dipakai). Algoritma ini menutupi kelemahan *linter* konvensional yang sering kali terkecoh menganggap operasi inisialisasi/penugasan sebagai tanda bahwa variabel tersebut sedang digunakan.

**Kategori 2 — Kode Tak Terjangkau (*Unreachable Code*)**
Kategori ini berfokus pada analisis lintasan eksekusi (*execution path*) alih-alih siklus hidup variabel. Sistem menggunakan teknik **Constant Folding** dan pendeteksian penghenti aliran kontrol (*Terminator Scan*) untuk mengevaluasi *Control Flow Graph* (CFG) secara statis. Jika sebuah blok kode berada di bawah pernyataan *return*, *throw*, *break*, atau *continue* dalam *scope* yang sama, maka instruksi di bawahnya mustahil dieksekusi. Selain itu, sistem mengevaluasi ekspresi boolean statis (seperti `while (false)` atau `if (false)`) untuk mendeteksi cabang logika yang mati permanen.

| Kode Klasifikasi | Contoh Pola | Mekanisme Deteksi |
|---|---|---|
| `DeadBranch` | `if (false) { ... }` | Constant Folding |
| `DeadBranch` | `const FLAG=false; if(FLAG){...}` | Constant Propagation |
| `DeadCode` | `return; doSomething();` | Terminator Scan |
| `DeadBranch` | `while(false) { ... }` | Dead Loop Detection |
| `DeadCode` | `false && doSomething()` | Short-Circuit Analysis |
| `DeadCode` | `false ? dead : alive` | Ternary Analysis |
| `EmptyBlock` | `function foo() {}` | Empty Block Check |

**Kategori 3 — Logika Duplikat & Kontradiksi**
Pada kategori ini, *Analyzer* bertindak lebih cerdas dengan menganalisis semantik logika alih-alih sekadar membaca struktur dasar. Sistem menerapkan algoritma komparasi **Deep AST Equality** untuk membandingkan simpul-simpul pohon sintaks. Sebagai contoh, jika terdapat struktur `if (a)` yang diikuti dengan `else if (a)`, sistem akan mendeteksi redundansi tersebut. Selain itu, penganalisis memiliki heuristik pendeteksi kontradiksi matematis dan logika, seperti rentang yang mustahil (`x > 10 && x < 5`) atau negasi absolut (`x && !x`), yang secara otomatis membuat cabang logika di dalamnya menjadi kode mati.

| Kode Klasifikasi | Contoh Pola | Mekanisme Deteksi |
|---|---|---|
| `DuplicateCondition` | `if(a){} else if(a){}` | Deep AST Equality |
| `DuplicateCondition` | `case 'a': ... case 'a':` | Switch Case Scan |
| `DeadBranch` | `if (x && !x) {}` | Negation Detection |
| `DeadBranch` | `if (x === 'a' && x === 'b') {}` | Equality Contradiction |
| `DeadBranch` | `if (x > 10 && x < 5) {}` | Range Contradiction |

**Kategori 4 — Kode Redundan (*Redundant Code*)**
Berbeda dengan kategori sebelumnya di mana kode sama sekali tidak bisa dieksekusi, *Redundant Code* adalah instruksi yang **bisa dieksekusi, namun tidak memiliki nilai semantis atau tidak mengubah status/state program**. Sistem memindai pola-pola nirguna seperti penugasan mandiri (*self-assignment* seperti `x = x;`), penugasan beruntun tanpa pembacaan jeda (`x = 1; x = 2;`), pernyataan nilai yang berdiri sendiri tanpa penampung (misal: `42;`), hingga pengembalian kosong `return;` yang diletakkan di baris paling akhir dari sebuah fungsi secara mubazir.

| Kode Klasifikasi | Contoh Pola | Mekanisme Deteksi |
|---|---|---|
| `RedundantCode` | `x = 1; x = 2;` | Consecutive Assignment Scan |
| `RedundantCode` | `x = x;` | Self-Assignment Check |
| `RedundantCode` | `return;` di akhir fungsi | Redundant Return Check |
| `RedundantCode` | `42;` (statement mandiri) | Useless Expression Check |

### B. Rule Engine & Konfigurasi (T2-07)

Sebagai filter perlindungan (*safeguard*), sistem mengimplementasikan *Rule Engine* yang bertugas membatalkan vonis *dead code* pada entitas tertentu. Secara algoritmik, mesin membaca skema JSON dari `.deadkillerrc.json` dan melakukan penggabungan (*merge*) dengan konfigurasi *default*. Untuk pengecualian variabel, mesin menggunakan kompilasi *Regular Expression* (RegExp) guna mencocokkan nama variabel (misalnya pola `^_` untuk variabel internal). Sedangkan untuk pengecualian berkas, mesin melakukan komputasi resolusi *path* absolut (*absolute path resolution*) lalu membandingkannya dengan senarai direktori yang dilindungi (seperti `node_modules/` atau `pages/`).

```javascript
// Cuplikan: Pembacaan Konfigurasi dan Penyatuan Aturan
const userConfig = await fs.readJson(configPath);
this.rules = { ...this.rules, ...userConfig }; // Timpa aturan default dengan preferensi user
```

### C. Mesin Pemetaan / Graph Builder (T2-04)

Pembentukan hierarki kelembagaan proyek diimplementasikan dalam bentuk *Directed Acyclic Graph* (DAG) menggunakan algoritma pencarian melebar (*Breadth-First Search* / BFS) dengan metode satu-lintasan (*single-pass traversal*).
1. **Inisialisasi Antrean (Queue):** Algoritma dimulai dengan mendeteksi *Entry Point* utama proyek (seperti `index.js`) dan memasukkannya ke dalam memori antrean evaluasi.
2. **Ekstraksi Node (Parsing):** Untuk setiap berkas yang dievaluasi, sistem mem-parsing teks menjadi pohon AST. Modul penelusur memindai 5 jenis simpul impor: `ImportDeclaration` (ESM), `require` (CommonJS), `ExportNamed/ExportAll` (*Barrel*), dan `import()` (Dinamis).
3. **Resolusi dan Pemetaan Relasi:** Nilai teks impor diekstraksi. Jika berupa path lokal (relatif), sistem meresolusinya menjadi path absolut OS dan memasukkannya ke antrean BFS baru (`liveFiles`). Jika berupa pustaka eksternal, nama paket direkam ke dalam himpunan memori `Set(usedPackages)`.
4. **Pencegahan Siklus (Cycle Prevention):** Untuk mencegah *infinite loop* pada *circular dependency*, setiap berkas yang selesai dipindai dimasukkan ke dalam himpunan `visitedFiles`.
5. **Bailout Heuristics:** Jika saat penelusuran AST ditemukan simpul eksekusi dinamis tak terprediksi (seperti pemanggilan `eval()`), berkas tersebut dilabeli *unsafe* dan analisis statis dihentikan secara prematur guna mencegah *False Positive*.

```javascript
// Cuplikan: Ekstraksi Simpul Impor dan Resolusi di dalam BFS
if (node.type === 'ImportDeclaration' && node.source?.value) {
    const importPath = node.source.value;
    if (importPath.startsWith('.')) importsToResolve.push(importPath); // File lokal diteruskan ke Queue
    else usedPackages.add(importPath); // NPM package dicatat di himpunan DAG
}
```

### D. Unused Dependency Analyzer (T2-05)

Algoritma deteksi dependensi usang diimplementasikan secara langsung menggunakan komputasi selisih himpunan (*Set Difference*).
1. **Ekstraksi Manifes:** Sistem mem-parsing daftar dependensi murni dari berkas `package.json` dan menyimpannya ke dalam struktur *Array* (`runtimeDeps`).
2. **Operasi Selisih:** Sistem melakukan pemotongan array dengan mengevaluasi setiap item di `runtimeDeps` terhadap himpunan paket yang berhasil dikumpulkan oleh BFS (`usedPackages`). Rumus komputasinya berbunyi: `unusedDependencies = runtimeDeps - usedPackages`. Jika paket tidak ditemukan di dalam graf DAG pemanggilan, ia divonis usang.
3. **Injeksi Implisit:** Algoritma dibekali pengecualian otomatis untuk dependensi yang cara kerjanya diinjeksi oleh arsitektur *framework* saat proses *build* (misal: `react` pada Next.js), serta mengecualikan *DevDependencies* yang dipanggil oleh CLI agar tidak memicu deteksi palsu.

### E. Validasi Arsitektur & Pengujian Terpadu (T2-03 s.d. T2-07)

Berbeda dengan Iterasi 1 yang murni menguji ketahanan membaca sintaks (*Parsing Capability*), evaluasi di Iterasi 2 dirancang secara komprehensif untuk memvalidasi akurasi logika skala kecil (*intra-file*), pemetaan lintas-berkas, serta kepatuhan terhadap aturan (*Rule Engine*). Seluruh pengujian diotomatisasi secara terpusat menggunakan utilitas *Native Test Runner* dari Node.js (`node --test`).

**1. Unit Test: Validasi Akurasi Logika Analyzer (TC-49 hingga TC-130)**
Pengujian dilakukan dengan mem-parsing puluhan skenario kode statis menjadi AST, lalu mencocokkan hasil deteksi Tabel Simbol dengan luaran yang diekspektasikan (*expected output*). Proses ini menguji ketajaman ruang lingkup (*scope*) pada resolusi Import, antarmuka TypeScript, dan deklarasi JSX. Sistem mencatat akurasi **87.5%**, yang secara transparan membuktikan adanya dua anomali semantik (*edge cases*) yang terekam jelas pada *log* terminal:
  ```text
  [TC-03] React JSX False Positive (Bug)
           ✅ PARSING BERHASIL — 3 dead code ditemukan (False Positive)
  [TC-08] Unused namespace
           ❌ TIDAK TERDETEKSI: 'Utility' ← FALSE NEGATIVE!
  ─────────────────────────────────────────────────────────────────
    Akurasi deteksi   : 87.5%
  ```
*(Catatan: Anomali pada komponen JSX dan TS Namespace di atas menuntut dilakukannya penambalan arsitektur pada tahap Refactor).*

Kegagalan deteksi pada dua anomali semantik tersebut memicu pencatatan dua task perbaikan prioritas baru:

| Prioritas | ID Task | Deskripsi Task |
|---|---|---|
| 1. (Baru) | T2-08 | fix analyzer : sesuaikan `isReference.js` untuk mengecualikan konteks `JSXIdentifier` dan integrasikan `reactAnalyzer.js` guna mengatasi *False Positive* pada komponen React |
| 1. (Baru) | T2-09 | fix analyzer : luaskan isolasi referensi `TSModuleDeclaration` sebagai ruang lingkup mandiri guna menyelesaikan *bug False Negative* pada namespace TypeScript |

**2. Validasi Mesin Pemetaan (Graph Builder) & Dependensi Usang**
Skrip mengeksekusi algoritma *Graph Builder* (BFS) pada direktori *dummy project* untuk menguji kemampuan penelusuran impor lintas-berkas, pola *Barrel Export* (`index.js`), dan pemisahan pustaka NPM. Mesin beroperasi dengan **stabilitas 100% presisi** sejak fase purwarupa, di mana himpunan paket NPM murni sukses diumpankan ke komputasi silang (*Set Difference*) terhadap `package.json` untuk mencari dependensi usang. Output terminal membuktikan mesin memetakan relasi tanpa cacat:
  ```text
  1. Daftar File yang Terjangkau (Live Files):
     1. components\Button.jsx
     2. index.js
     3. utils\index.js

  2. Lintasan Dependensi (Edges):
     ┌─[index.js]
     ├─ Mengimpor : { add }
     └─ Ke berkas ➔ utils\index.js
  ✅ BERHASIL: Graph Builder mampu meresolusi import dasar maupun Barrel Export.
  ```

**3. Validasi Integrasi Rule Engine**
Skrip *unit test* menyuntikkan konfigurasi *Rule Engine* (seperti *whitelist* variabel, mode *framework*, dan pengabaian dependensi) langsung ke dalam modul utama *Analyzer* untuk menguji tingkat kepatuhannya. *Analyzer* mencatat tingkat **presisi 100%**, terbukti secara otomatis membebaskan variabel berawalan *underscore* (misal: `_unused`), mengamankan rute spesifik Next.js (`/pages/index.js`), dan mengabaikan pustaka `dotenv` dari vonis *dead code* sesuai instruksi pengguna. Hal ini dibuktikan dari seluruh *test suite* yang berstatus hijau (*Passed*):
  ```text
  ▶ Rule Engine — Konfigurasi & Filter
    ✔ TC-42: Variabel berawalan _ di-skip oleh RuleEngine
    ✔ TC-46: isIgnoredFile mengenali framework mode next
    ✔ TC-48: isIgnoredDependency bekerja sesuai daftar
  ```
---

## 2. Baseline Refactor

Berdasarkan temuan anomali pada evaluasi *development* di atas, arsitektur ditambal dan disempurnakan (melahirkan tugas baru T2-08, T2-09).

### A. Penganalisis React & Solusi JSX False Positive

Aturan pengecualian ditambahkan ke utilitas `isReference.js` agar pembacaan antarmuka React dan propertinya menjadi valid. Bersamaan dengan itu, dikembangkan modul ekstensif `reactAnalyzer.js` yang didedikasikan untuk mendeteksi *React Bad Smells* (Too Many States, Too Many Props, Missing Key, Unnecessary Wrapper).

```javascript
// Cuplikan: Pengecualian Konteks JSX di isReference.js
if (parent.type === 'JSXAttribute' && parent.name === node) return false;
if (parent.type === 'JSXMemberExpression' && parent.property === node) return false;
```

### B. Penyelesaian Bug Namespace TS False Negative

Namespace TypeScript yang sebelumnya dianggap "dipanggil" oleh *parser* kini diisolasi:
```javascript
// TSModuleDeclaration secara eksplisit dikecualikan dari status referensi aktif
if (parent.type === 'TSModuleDeclaration' && parent.id === node) return false;
```

### C. Validasi Pasca-Refactor

Setelah perbaikan arsitektur diimplementasikan, skrip pengujian komparatif `uji_akurasi_deadcode.mjs` dieksekusi kembali (*regression test*). Hasilnya membuktikan bahwa mesin berhasil menavigasi kedua anomali semantik (*edge cases*) yang sebelumnya gagal, dan secara absolut mencapai **Akurasi 100%**:

```text
[TC-03] Unused variable di komponen React (.jsx)
         Variabel tidak terpakai di dalam file JSX murni
         ✅ TERDETEKSI: 'unusedVar' (Variable, baris 2)

[TC-08] Unused namespace
         Hanya terdeteksi jika engine menelusuri TSModuleDeclaration
         ✅ TERDETEKSI: 'Utility' (Variable, baris 1)

─────────────────────────────────────────────────────────────────
  RINGKASAN AKURASI DETEKSI — Engine: TS-ESTREE
─────────────────────────────────────────────────────────────────
  Terdeteksi benar  : 9 item
  Tidak terdeteksi  : 0 item (false negative)
  Akurasi deteksi   : 100.0%
```

---

## 3. Baseline Production

Tahap akhir memvalidasi kelulusan arsitektur final, efisiensi eksekusi memori, dan penyatuan keluaran output.

### A. Uji Akurasi Akhir

| Kasus Uji | Baseline Development | Baseline Production (Post-Refactor) | Keterangan |
|---|---|---|---|
| Komponen React JSX | ❌ *False Positive* | ✅ Terbaca Penuh | Diperbaiki `isReference.js` |
| TS Namespace (`TC-08`) | ❌ *False Negative* | ✅ Terdeteksi Akurat | Diperbaiki pelacakan modul |
| Heuristik React Smells | *Belum Ada* | ✅ Tervalidasi 5 skenario | Fitur Baru Terintegrasi |
| *Lexical Scoping* Lintas Modul | ✅ Berhasil | ✅ Berhasil | Performa Stabil |

<!-- Sisipkan gambar/ilustrasi cuplikan terminal hasil uji akurasi di sini -->

### B. Kinerja Arsitektur Final (*Robustness Integration*)

Integrasi *ParseCache* (warisan Iterasi 1) dengan Graph Builder dan Analyzer di iterasi ini menciptakan sinergi komputasi yang sangat efisien:
1. **Tahap 1 (Graph Builder)**: Eksekusi *single-pass* pertama. Mengubah teks ke AST dan melemparnya ke RAM memori (*Cache*).
2. **Tahap 2 (Dead Code Analyzer)**: Menginspeksi anomali di level berkas dengan mengambil AST matang langsung dari RAM (*Cache HIT*).
3. **Tahap 3 (Dependency Analyzer)**: Membandingkan manifes berdasarkan data set yang terkumpul tanpa iterasi ulang.

Sinergi arsitektural ini menjamin bahwa beban komputasi *parsing* yang intensif **hanya dieksekusi satu kali** per berkas, memangkas latensi latensi eksekusi secara masif pada skala proyek raksasa.

### C. Penyatuan Komponen Analisis (*Integration*)

Seluruh sub-modul analisis diintegrasikan melalui 11 tahapan berurutan (*sequential phases*) untuk menyatukan temuannya menjadi satu luaran laporan (*output array*) yang terstandarisasi.

```text
Algorithm AnalyzeProject

Input  : projectPath
Output : analysisResult

Begin
    files ← ScanDirectory(projectPath)

    For each file in files do
        ast ← Parse(file)
        graph ← BuildGraph(ast)
        
        // Mengeksekusi 11 tahapan analisis secara sekuensial
        result ← Analyze(graph) 
    End For

    Return result
End
```

---

## Kesimpulan & Ringkasan Task Iterasi 2

Berdasarkan keseluruhan rangkaian tahap pengembangan, pengujian, hingga penyempurnaan arsitektur di Iterasi 2, dapat ditarik tiga kesimpulan utama:
1. **Graph Builder** & **Analyzer** sukses merealisasikan cakupan ekstraksi 11 klasifikasi anomali yang andal.
2. Respons metodologis pada fase *Refactor* sukses mengatasi kelemahan *False Positives* JSX, bahkan melahirkan fitur eksklusif modul deteksi **React Smells**.
3. Stabilisasi modul "otak" ini mengunci landasan teknis yang sangat kokoh untuk menuju fase Skema Pemangkasan Kode Fisik (*Modul Eliminator*) di Iterasi 3.

Sebagai penutup iterasi, berikut adalah rekapitulasi lengkap dari seluruh penugasan (*tasks*) yang telah diselesaikan secara komprehensif dari tahap *Development* hingga *Refactor*:

**Tabel Penyelesaian Task:**

| ID Task | Deskripsi | Status | Baseline |
|---------|-----------|--------|----------|
| T2-01 | Implementasi algoritma Lexical Scoping dasar | ✅ Selesai | Development |
| T2-02 | Implementasi traversal AST dengan estraverse | ✅ Selesai | Development |
| T2-03 | Pengujian purwarupa analyzer (intra-file) | ✅ Selesai | Development |
| T2-04 | Implementasi Graph Builder (Algoritma BFS) | ✅ Selesai | Development |
| T2-05 | Implementasi Unused Dependency Analyzer | ✅ Selesai | Development |
| T2-06 | Pengujian integrasi lintas modul (TS/JSX) | ✅ Selesai (memicu T2-08, T2-09) | Development |
| T2-07 | Pembangunan Rule Engine & Konfigurasi | ✅ Selesai | Development |
| T2-08 | Pembangunan Penganalisis Khusus React | ✅ Selesai | Refactor |
| T2-09 | Penyelesaian Bug TC-08 Namespace | ✅ Selesai | Refactor |
