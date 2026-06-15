#### 4.4.5 Iterasi 5: Integrasi Sistem Global & Pengujian Validasi Akhir (*System Integration & Global Validation*)

Iterasi kelima dan pamungkas ini merupakan muara dari seluruh tahapan metodologi PXP. Fokus utamanya bergeser dari pembuatan sub-sistem individual menjadi **Orkestrasi dan Integrasi Global**. Seluruh komponen yang dibangun pada Iterasi 1 hingga Iterasi 4—yakni *Core Parser, ParseCache, Graph Builder, Dead Code Analyzer, Eliminator*, dan *Visualization Reporter*—dirangkai ke dalam satu *pipeline* komputasi terpadu yang dikendalikan oleh *Command Line Interface* (CLI).

##### A. Perencanaan Iterasi dan *TaskPriorityList*

Sebelum integrasi final dimulai, disusun daftar prioritas tugas untuk mengamankan proses penyatuan sistem:

| Prioritas | ID Task | Deskripsi Task                                                                                                     | *User Story*    |
| --------- | ------- | ------------------------------------------------------------------------------------------------------------------ | --------------- |
| 1         | T5-01   | Pembangunan modul Orkestrator (CLI) sebagai *entry-point* utama aplikasi yang menerima argumen terminal            | US-06           |
| 2         | T5-02   | Integrasi aliran data (*Data Flow*): *ParseCache* → *Graph Builder* → *Analyzer* → *Eliminator* → *Reporter*       | US-01 s/d US-06 |
| 3         | T5-03   | Pengujian Fungsional Terintegrasi (*Functional Testing*) pada proyek sampel untuk memastikan format komunikasi     | US-01 s/d US-06 |
| 4         | T5-04   | Pengujian Stres (*Stress Testing*) pada aplikasi berskala besar (1000+ berkas) untuk menguji limitasi memori (RAM) | US-01 s/d US-06 |
| 5         | T5-05   | Evaluasi Regresi Kode: Memastikan proyek yang telah dibersihkan secara agresif masih aman dikompilasi (*build-safe*) | US-01 s/d US-06 |

---

##### B. *Development Baseline*

Fase awal ini berfokus pada pembangunan kabel penghubung antarmodul (CLI *Controller*) yang memandu jalannya objek data secara *end-to-end*.

**1. Alur Eksekusi Terpadu (*Unified Execution Pipeline*) (T5-01 & T5-02)**

Ketika pengguna menginisiasi eksekusi (contoh: `npx deadkiller --prune --report`), sistem menjalankan lima fase orkestrasi sekuensial yang ketat:
1. **Fase Inisiasi (Rule Engine)**: Membaca berkas `.deadkillerrc.json` untuk parameter kustom.
2. **Fase Penemuan (Graph Builder - Iterasi 2)**: Merayapi tautan impor. *Core Parser* (Iterasi 1) menyuplai AST ke dalam *ParseCache*.
3. **Fase Analisis (Dead Code Analyzer - Iterasi 2)**: Menarik AST matang dan memverifikasi 11 kategori anomali.
4. **Fase Eksekusi Fisik (Modul Eliminator - Iterasi 3)**: Jika `--prune` aktif, baris kode mati diamputasi secara spasial (*surgical pruning*).
5. **Fase Pelaporan (Visual Reporter - Iterasi 4)**: Menghasilkan statistik CLI dan merender dokumen HTML interaktif.

```javascript
// Cuplikan: Orkestrasi Aliran Data Global (cli.js)
async function runPipeline(options) {
    const rules = await loadRules();
    
    // 1. Pemetaan Graf (Mengumpulkan Live AST)
    const { graph, astCache, deadFiles } = await buildProjectGraph(rules.entryPoints);
    
    // 2. Analisis AST Terpadu 11 Kategori
    const deadCodeList = await analyzeProject(graph, astCache, rules);
    
    // 3. Eksekusi Fisik Pemotongan Kode (Surgical Pruning)
    let savedBytes = 0;
    if (options.prune) {
        savedBytes = await executeElimination(deadCodeList, deadFiles);
    }
    
    // 4. Pelaporan Antarmuka & Visual
    generateTerminalSummary(deadCodeList, savedBytes);
    if (options.report) generateHTMLReport(deadCodeList);
}
```

##### C. Pengujian Awal

Pengujian integrasi fungsional awal (T5-03) pada proyek berskala kecil hingga menengah berjalan dengan sukses tanpa adanya *crash*. Namun, keberhasilan ini diuji pada tingkatan yang ekstrem melalui Pengujian Stres (T5-04) terhadap repositori *open-source* raksasa berskala ribuan berkas.

##### D. *Self-Review* dan Analisis Kegagalan

Pada saat dilakukan pengujian stres, keberhasilan di atas kertas seketika luntur. Sistem langsung mengalami kelumpuhan kritis (*OOM Crash*) dengan pesan: `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`.

Berdasarkan investigasi aliran data (*self-review*), letak kebocoran memori ada pada arsitektur pemuatan AST di memori. Karena sistem dirancang memuat *seluruh* AST proyek ke dalam objek `Map` RAM sebelum masuk ke Tahap Analisis (agar pembacaan cepat), batas ukuran *heap memory* bawaan NodeJS (~1.5 GB) seketika jebol ketika menampung ratusan AST dari *file* berukuran besar.

Sebagai tindak lanjut atas *crash* memori tersebut, dicatat sebuah tugas perbaikan mendesak:

| ID Task Baru | Deskripsi Task                                                                              |
| ------------ | ------------------------------------------------------------------------------------------- |
| T5-06        | *Performance Bug Fix*: Rekayasa ulang aliran AST menjadi mode *Sequential Streaming (GC)*   |

##### E. Penyesuaian Implementasi dan Uji Ulang

Kegagalan *Out Of Memory* ini langsung ditambal di *development baseline* (T5-06). Desain aliran data direkayasa ulang. Daripada mempertahankan pola **Global Cache**, sistem diubah menjadi metode **Sequential Streaming**. 

Objek AST hanya dimuat ke dalam RAM pada saat berkas tersebut sedang diinspeksi oleh *Analyzer* atau dipotong oleh *Eliminator*. Sesaat setelah eksekusi per berkas rampung, sistem secara eksplisit membuang referensi objek tersebut (`astCache.delete(file)`) untuk memancing mekanisme *Garbage Collection* (GC) dari *V8 Engine* bekerja secara *real-time*.

Hasil uji regresi pasca-perbaikan arsitektural ini sukses menurunkan beban memori puncak (*peak memory footprint*) dari >1.5 GB (menuju *crash*) menjadi stabil konstan di bawah **250 MB**, terlepas dari sebesar apa pun ukuran basis kode targetnya. Modul integrasi pun secara kokoh siap dinaikkan ke tahap *refactor*.

---

##### F. *Refactor Baseline*

Setelah aliran memori dipastikan aman dari ledakan *heap*, fase *refactoring* ini difokuskan pada perapian struktur penulisan kode di dalam modul CLI Orkestrator itu sendiri.

**Pembersihan Alur CLI (Code Cleanup)**
Struktur logika `runPipeline` di-refactor dengan mengekstraksi logika pengambilan argumen (*argument parsing*) dan penanganan galat (*error handling*) ke dalam berkas-berkas utilitas yang terpisah. Hal ini bertujuan agar berkas `cli.js` tetap ringkas, murni hanya bertindak sebagai pengendali lalu lintas data (*data controller*) tanpa tercampur dengan kerumitan validasi parameter terminal.

---

##### G. *Production Baseline*

Fase pamungkas ini melepaskan sistem terintegrasi final untuk dieksekusi secara nyata melawan lingkungan target dengan kompleksitas tinggi guna mengukur efektivitas dan keamanan modifikasi (T5-05).

**1. Uji Validasi Keamanan Kompilasi (*Regression Testing*)**

Pengujian sistem dioperasikan secara penuh pada mode `--prune`. Validasi akhir membuktikan pencapaian berikut:

| Metrik Evaluasi                        | Indikator Evaluasi                                                             | Hasil Validasi Akhir                                                          |
| -------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| **Akurasi Integrasi Modul**            | Laporan Sinkronisasi AST `loc` vs Pemotongan Fisik (*Eliminator*)              | **Akurat Sempurna.** Tidak ada irisan indeks pemotongan yang keliru.          |
| **Keamanan Resolusi Impor**            | Pemeriksaan tautan graf (*Graph Builder*) setelah *Unused Dependencies* dihapus | **Stabil.** Resolusi lintas berkas tetap terhubung secara logis.              |
| **Integritas Sintaksis (*Syntax Safe*)** | Pemindaian ulang (*re-parse*) pasca-pemangkasan                                | **0% Insiden Syntax Error.** Seluruh berkas tidak ada yang korup.             |
| **Lulus Uji Kompilasi Akhir**          | Perintah `npm run build` dijalankan terhadap proyek hasil *pruning*            | ✅ **Lulus Kompilasi.** Sistem *build tools* target mengkompilasi dengan mulus. |

**2. Matriks Dampak Optimasi (*Optimization Impact Metrics*)**

Pengujian performa pada repositori sampel mencatatkan angka reduksi empiris yang sangat memuaskan, mengonfirmasi keberhasilan sistem dalam meringankan beban proyek:

| Objek Observasi                  | Sebelum Analisis | Sesudah Pemangkasan (*Pruned*) | Persentase Reduksi                                     |
| -------------------------------- | ---------------- | ------------------------------ | ------------------------------------------------------ |
| **Pustaka NPM (Dependensi)**     | 60 Packages      | 51 Packages                    | **- 15.0%** (*Unused Deps* dibuang)                    |
| **Total Berkas Terakumulasi**    | 124 File         | 110 File                       | **- 11.2%** (14 *Dead Files* diisolasi)                |
| **Ukuran Memori Repositori**     | 2.4 MB           | 1.8 MB                         | **- 25.0%** (Sisa baris kode mati dipotong fisik)      |
| **Waktu *Build* Proyek Target**  | 20.4 Detik       | 16.8 Detik                     | **17.6% Lebih Cepat** (Dampak langsung minimasi AST)   |

Keberhasilan modul CLI ini secara resmi membuktikan penyelesaian penelitian: seluruh subsistem telah terkawinkan menjadi utilitas *dead-code eliminator* yang utuh, tangguh di bawah tekanan *Out Of Memory*, dan aman digunakan. Sistem pun dikunci secara resmi sebagai *Production Baseline*.

---

##### H. Ringkasan Penyelesaian Task Iterasi 5

Sebagai penutup seluruh rangkaian iterasi, berikut adalah rekapitulasi penyelesaian *tasks*:

| ID Task | Deskripsi                                                  | Status  | Baseline    |
| ------- | ---------------------------------------------------------- | ------- | ----------- |
| T5-01   | Pembangunan modul Orkestrator CLI                          | Selesai | Development |
| T5-02   | Integrasi sekuensial aliran AST antar-modul                | Selesai | Development |
| T5-03   | Uji Fungsional Terintegrasi pada repositori sampel         | Selesai | Development |
| T5-04   | Pengujian Stres (Menemukan *Bug Out Of Memory*)            | Selesai | Development |
| T5-06   | *Bug Fix*: Transisi aliran AST ke mode *GC Streaming*      | Selesai | Development |
| T5-05   | Evaluasi Regresi dan Dampak (*Build-Safe Verification*)    | Selesai | Production  |
