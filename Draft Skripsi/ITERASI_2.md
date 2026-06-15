#### 4.4.2 Iterasi 2: Pengembangan Mesin Pemetaan & Analisis (Graph Builder & Analyzer)

Iterasi kedua membangun dua komponen analitik sentral: **Graph Builder** (Mesin Pemetaan) untuk melacak ketergantungan lintas-berkas membentuk *dependency graph*, dan **Analyzer** (Mesin Analisis) untuk menelusuri AST dan mengekstraksi entitas yang tidak tereferensi (*dead code*).

##### A. Perencanaan Iterasi dan *TaskPriorityList*

Untuk merealisasikan sistem analisis *dead code* yang terintegrasi, berikut adalah rincian perencanaan (*Task Priority List*) yang akan dieksekusi secara berurutan:

| Prioritas | ID Task | Deskripsi Task                                                                               | *User Story* |
| --------- | ------- | -------------------------------------------------------------------------------------------- | ------------ |
| 1         | T2-01   | Implementasi algoritma *Lexical Scoping* dasar untuk *intra-file analysis*                   | US-04        |
| 2         | T2-02   | Implementasi *traversal* AST menggunakan `estraverse`                                        | US-04        |
| 3         | T2-03   | Pengujian fungsional (*unit test*) terhadap seluruh arsitektur komponen modul *Analyzer*     | US-04        |
| 4         | T2-04   | Implementasi *Graph Builder* (BFS) untuk menyusun *dependency graph* lintas berkas           | US-03        |
| 5         | T2-05   | Implementasi *Unused Dependency Analyzer* membandingkan manifes dengan graf pemanggilan      | US-04        |
| 6         | T2-06   | *Integration test* lintas modul (*Graph* + *Analyzer*)                                       | US-03, US-04 |
| 7         | T2-07   | Pembangunan Mesin Aturan (*Rule Engine*) dan integrasi `.deadkillerrc.json`                  | US-04        |
| 8         | T2-08   | Integrasi *Parser*, *ParseCache*, *Graph Builder*, dan *Analyzer* menjadi satu alur utuh     | US-03, US-04 |

---

##### B. *Development Baseline*

Fase *development baseline* merealisasikan fungsionalitas inti T2-01 hingga T2-07. Sesuai dengan prinsip *Single Responsibility Principle* (SRP), arsitektur analisis dibangun secara terdekupel (*decoupled*) ke dalam empat komponen utama yang masing-masing membawahi tugas spesifik:

**1. Rule Engine (`ruleEngine.js`)**
Merupakan komponen tunggal yang bertugas membaca, memvalidasi, dan menerapkan konfigurasi aturan dari pengguna (membaca file `.deadkillerrc.json`). Mesin ini yang bertugas sebagai penentu akhir atau filter (*gatekeeper*) anomali apa saja yang boleh dilaporkan atau harus diabaikan.

**2. Graph Builder (`graph/`)**
Komponen ini bertugas memetakan struktur keseluruhan proyek ke dalam *Dependency Graph* sebelum kode dianalisis secara mendalam. Komponen pembentuknya meliputi:
*   `projectGraph.js`: Otak utama pembentuk graf berarah lintas-file.
*   `entryPointFinder.js`: Algoritma untuk mencari "akar" atau *entry point* aplikasi secara otomatis.
*   `pathResolver.js`: Modul untuk menerjemahkan jalur *import* (termasuk *alias path*).

**3. Dependency Analyzer (`dependency/`)**
Modul ini dikendalikan oleh `dependencyAnalyzer.js`. Ini adalah komponen yang bertugas melakukan analisis tingkat lintas-berkas (*inter-file analysis*), terutama melacak apakah sebuah variabel, fungsi, atau pustaka eksternal yang diekspor dari sebuah file benar-benar digunakan di file lain.

**4. Intra-file Dead Code Analyzer (`deadcode/`)**
Ini adalah penganalisis paling masif di dalam sistem yang bertugas membedah logika di dalam satu file. Intinya dikendalikan oleh `deadCodeAnalyzer.js`, yang mendelegasikan tugas ke sub-komponen di dalam folder `core/`:
*   **Manajemen Scope:** `scope.js` (Tabel Simbol & *Lexical Scoping*).
*   **Analisis Alur Eksekusi:** `flowAnalyzer.js` (Mendeteksi *Post-Terminator Code*).
*   **Analisis Percabangan:** `branchAnalyzer.js` (Mendeteksi *Dead Logic Branch* atau percabangan mati).
*   **Analisis Logika:** `logicAnalyzer.js` (Mendeteksi *Contradictory Logic* atau logika membantah).
*   **Analisis Redundansi:** `redundancyAnalyzer.js` (Mendeteksi *Duplicate Condition*).
*   **Helper & Ekstensi:** `barrelResolver.js` untuk resolusi re-export, serta ekstensi khusus `react/` (untuk mendeteksi *React Smells*) dan `typescript/`.

Keempat komponen independen ini baru akan diuji secara fungsional pada tahap pengujian menggunakan pendekatan *unit test* yang dipisahkan berdasarkan masing-masing kelompok arsitekturnya.

##### C. Pengujian Awal

Pengujian purwarupa pada tahap ini didesain untuk memvalidasi fungsionalitas keempat komponen utama secara terisolasi melalui *unit test* maupun *integration test* awal (T2-03, T2-06). Secara fungsional, pengujian pada **Rule Engine** menunjukkan keberhasilan penuh dalam membaca dan menerapkan aturan dari konfigurasi pengguna. Begitu pula pada komponen **Graph Builder** dan **Dependency Analyzer** yang dievaluasi melalui simulasi lingkungan proyek utuh; keduanya terbukti mampu meresolusi lintasan impor dan melacak penggunaan dependensi antar-file tanpa cacat.

Namun, pengujian pada komponen inti yang paling kompleks, yaitu **Intra-file Dead Code Analyzer**, mengungkap adanya celah logika. Dari serangkaian skenario uji yang melibatkan berbagai sintaks modern, sistem mencatat tingkat keberhasilan awal **87.5%**. Terdapat dua kegagalan deteksi (*false positive* dan *false negative*) yang terekam secara eksplisit pada keluaran *terminal* pengujian:

```text
[TC-03] React JSX False Positive (Bug)
         ✅ PARSING BERHASIL — 3 dead code ditemukan (False Positive)
[TC-08] Unused namespace
         ❌ TIDAK TERDETEKSI: 'Utility' ← FALSE NEGATIVE!
─────────────────────────────────────────────────────────────────
  Tingkat keberhasilan awal : 87.5%
```

##### D. *Self-Review* dan Analisis Kegagalan

Berdasarkan kegagalan pada pengujian awal, dilakukan *self-review* dan *code walkthrough* mandiri untuk menginvestigasi akar permasalahan. Hasil investigasi menemukan:
1. ***False Positive* pada JSX:** Komponen penelusur mengklasifikasikan nama komponen React (misalnya `const MyComponent`) sebagai *dead code* karena komponen tersebut dipanggil dalam bentuk tag JSX (`<MyComponent />`), yang mana node ekspresinya (`JSXIdentifier`) belum dikenali oleh aturan dasar pelacakan referensi.
2. ***False Negative* pada TS Namespace:** Deklarasi *namespace* pada TypeScript (`TSModuleDeclaration`) dilewati begitu saja oleh sistem *scoping*, sehingga tidak tercatat di dalam simbol aktif dan gagal ditandai sebagai entitas mandiri.

Kegagalan ini memicu pencatatan dua *task* perbaikan prioritas baru yang wajib dieksekusi sebelum modul dipindahkan ke tahapan *refactor*:

| ID Task Baru | Deskripsi Task                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------ |
| T2-09        | *Bug fix*: sesuaikan aturan pelacakan referensi mengecualikan `JSXIdentifier` (solusi komponen React)  |
| T2-10        | *Bug fix*: isolasi referensi `TSModuleDeclaration` sebagai ruang lingkup mandiri (solusi TS Namespace) |

##### E. Penyesuaian Implementasi dan Uji Ulang

Sesuai catatan hasil *self-review*, penyesuaian dilakukan langsung pada *development baseline*.
1. **Solusi JSX False Positive (T2-09):** Aturan pengecualian ditambahkan agar properti React JSX tidak divonis mati. Dilakukan penyesuaian pelacakan referensi pada node JSX agar properti yang dipanggil di dalam tag dapat dikenali sebagai penggunaan aktif.
2. **Solusi TS Namespace False Negative (T2-10):** `TSModuleDeclaration` secara eksplisit dikecualikan dari status referensi aktif agar dapat dianalisis sebagai ruang lingkup terpisah secara presisi.

Setelah perbaikan selesai, skrip pengujian dijalankan kembali (*regression test*). Hasil validasi membuktikan mesin analisis berhasil menavigasi kedua kasus sudut (*edge cases*) tersebut dan sukses mencapai tingkat keberhasilan 100% pada skenario pengujian yang disusun:

```text
[TC-03] Unused variable di komponen React (.jsx)
         ✅ TERDETEKSI: 'unusedVar' (Variable, baris 2)
[TC-08] Unused namespace
         ✅ TERDETEKSI: 'Utility' (Variable, baris 1)
─────────────────────────────────────────────────────────────────
  RINGKASAN TINGKAT KEBERHASILAN — Engine: TS-ESTREE
─────────────────────────────────────────────────────────────────
  Terdeteksi benar  : 9 item
  Tingkat keberhasilan: 100.0%
```

Setelah tingkat keberhasilan mencapai target 100% pada skenario pengujian yang disusun, seluruh fungsionalitas analisis dasar dinyatakan stabil dan siap dipindahkan ke *refactor baseline* untuk integrasi skala penuh.

---

##### F. *Refactor Baseline*

Setelah modul analisis tingkat individu mencapai tingkat keberhasilan 100% pada seluruh *test case* di *development baseline*, tahap *refactoring* ini difokuskan pada penggabungan alur secara menyeluruh, serta optimasi performa komputasi tanpa mengubah fungsionalitas deteksi yang sudah stabil.

Tahap ini mengeksekusi integrasi secara komprehensif (T2-08) dengan menyambungkan fungsi **Parser** (dari Iterasi 1), **Graph Builder**, dan **Analyzer** ke dalam satu alur eksekusi sekuensial yang saling berkesinambungan:

```text
Algorithm AnalyzeProject
Begin
    files ← ScanDirectory(projectPath)
    astMap ← ParseFiles(files) // Memanggil modul parser (termasuk ParseCache)
    graph ← BuildProjectGraph(astMap)
    findings ← AnalyzeAST(astMap, graph) // Mengeksekusi ekstraksi dead code
    dependencies ← AnalyzeDependencies(graph, packageJson)
    Return findings, dependencies
End
```

Pada alur sekuensial tersebut, **ParseCache** yang telah dirancang sebelumnya terintegrasi secara alamiah. Sinergi ini menciptakan efisiensi komputasi yang sangat ekstrem: saat tahap *parsing* berjalan, mekanisme *cache* menangkap berkas yang belum dimodifikasi dari RAM (*Cache HIT*), membypass keharusan *engine* `ts-estree` untuk membaca ulang teks kode.

Penyambungan yang sukses ini kemudian diuji ulang melalui *integration test* lintas komponen. Hasilnya membuktikan bahwa implementasi *ParseCache* tidak merusak keluaran pohon sintaks, dan beban komputasi penelusuran berulang dapat dipangkas secara masif sebagai persiapan menuju lingkungan *production*.

---

##### G. *Production Baseline*

Tahapan akhir ini memvalidasi kelulusan arsitektur final untuk dikunci menjadi versi stabil *production*. Sistem melakukan evaluasi silang terhadap kegagalan masa lalu dan performa fungsional saat ini:

| *Test Case*            | Evaluasi Awal       | Evaluasi Produksi (Final) | Keterangan       |
| ---------------------- | ------------------- | ------------------------- | ---------------- |
| Komponen React JSX     | ❌ *False Positive* | ✅ Terbaca Penuh          | Telah diperbaiki |
| TS Namespace (`TC-08`) | ❌ *False Negative* | ✅ Terdeteksi Akurat      | Telah diperbaiki |
| *Lexical Scoping*      | ✅ Berhasil         | ✅ Berhasil               | Performa Stabil  |

Karena seluruh modul analitik kini berfungsi sempurna, beroperasi dalam satu alur terpadu dengan *Parser*, dan teroptimasi melalui sistem *caching*, modul **Graph Builder** dan **Analyzer** secara resmi ditetapkan ke *production baseline*.

---

##### H. Ringkasan Penyelesaian Task Iterasi 2

Berdasarkan keseluruhan rangkaian iterasi, *Graph Builder* dan *Analyzer* sukses merealisasikan cakupan ekstraksi anomali kode secara andal. Fase *development* berhasil menuntaskan masalah *false positives* dengan presisi tinggi, sedangkan fase *refactor* sukses memfasilitasi penyambungan modul pengurai Iterasi 1 ke dalam mesin pemetaan dan analisis Iterasi 2.

| ID Task | Deskripsi                                            | Status  | Baseline    |
| ------- | ---------------------------------------------------- | ------- | ----------- |
| T2-01   | Implementasi algoritma *Lexical Scoping* dasar       | Selesai | Development |
| T2-02   | Implementasi *traversal* AST dengan `estraverse`     | Selesai | Development |
| T2-03   | *Unit test* purwarupa analyzer (*intra-file*)        | Selesai | Development |
| T2-04   | Implementasi *Graph Builder* (Algoritma BFS)         | Selesai | Development |
| T2-05   | Implementasi *Unused Dependency Analyzer*            | Selesai | Development |
| T2-06   | *Integration test* lintas modul (*inter-file*)       | Selesai | Development |
| T2-07   | Pembangunan *Rule Engine* & Konfigurasi              | Selesai | Development |
| T2-08   | Integrasi *Parser*, *Graph*, dan *Analyzer*          | Selesai | Refactor    |
| T2-09   | *Bug Fix*: Pembangunan Penganalisis Khusus React     | Selesai | Development |
| T2-10   | *Bug Fix*: Penyelesaian Anomali TS Namespace         | Selesai | Development |
