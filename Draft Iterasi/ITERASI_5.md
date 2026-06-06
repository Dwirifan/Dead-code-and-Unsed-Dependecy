# 4.6.5 Iterasi 5 : Integrasi Sistem Global & Pengujian Validasi Akhir (System Integration & Global Validation)

Iterasi kelima dan pamungkas ini merupakan muara dari seluruh tahapan metodologi PXP (Prototyping, eXecution, Production). Fokus utamanya bergeser dari pembuatan sub-sistem individual menjadi **Orkestrasi dan Integrasi Global**. Seluruh komponen "otak" dan "otot" yang dibangun pada Iterasi 1 hingga Iterasi 4—yakni *Core Parser, ParseCache, Graph Builder, Dead Code Analyzer, Eliminator*, dan *Visualization Reporter*—dirangkai ke dalam satu *pipeline* komputasi terpadu yang dikendalikan oleh sebuah *Command Line Interface* (CLI).

## Perencanaan Iterasi & TaskPriorityList

Sebelum integrasi final dimulai, disusun daftar prioritas tugas untuk mengamankan proses penyatuan sistem:

| Prioritas | ID Task | Deskripsi Task |
|-----------|---------|----------------|
| 1 | T5-01 | Pembangunan modul Orkestrator (CLI) sebagai *entry-point* utama aplikasi yang menerima argumen/parameter terminal. |
| 2 | T5-02 | Integrasi aliran data (*Data Flow*): *ParseCache* → *Graph Builder* → *Analyzer* → *Eliminator* → *Reporter*. |
| 3 | T5-03 | Pengujian Fungsional Terintegrasi (*Functional Testing*) pada proyek sampel untuk memastikan format komunikasi antar-modul stabil. |
| 4 | T5-04 | Pengujian Stres (*Stress Testing*) pada aplikasi berskala besar (1000+ berkas) untuk menguji limitasi memori (RAM) sistem. |
| 5 | T5-05 | Evaluasi Regresi Kode: Memastikan proyek yang telah dibersihkan sistem secara agresif (*pruned*) masih terjamin keamanan kompilasinya (*build-safe*). |

---

## 1. Baseline Development: Orkestrasi Pipeline Terpadu

Fase awal ini berfokus pada pembangunan kabel penghubung antarmodul (CLI *Controller*) yang memandu jalannya objek data (seperti AST dan kumpulan *array* anomali) dari awal hingga akhir tanpa kehilangan konteks.

### A. Alur Eksekusi Terpadu (*Unified Execution Pipeline*)

Ketika pengguna menginisiasi eksekusi (contoh: `npx deadkiller --prune --report`), sistem menjalankan lima fase orkestrasi sekuensial yang ketat:

1. **Fase Inisiasi (Rule Engine)**: Sistem membaca berkas `.deadkillerrc.json` untuk menyerap parameter *whitelist* kustom dari pengguna.
2. **Fase Penemuan (Graph Builder - Iterasi 2)**: Menggunakan algoritma *Breadth-First Search* (BFS), modul merayapi tautan *import/require*. *Core Parser* (Iterasi 1) dipanggil secara agresif untuk menyuplai struktur AST ke dalam memori sentral (*ParseCache*). Berkas yang terisolasi langsung divonis sebagai *Dead Files*.
3. **Fase Analisis (Dead Code Analyzer - Iterasi 2)**: Modul analisis utama mengambil alih, menarik AST matang dari *ParseCache*. Sebanyak 11 kategori anomali (termasuk *Lexical Scope*, CFG *Unreachable*, dan *React Smells*) diinspeksi. Outputnya digabungkan menjadi satu larik (Array) JSON berstandar mutlak.
4. **Fase Eksekusi Fisik (Modul Eliminator - Iterasi 3)**: Jika parameter `--prune` aktif, larik JSON diserahkan ke *Eliminator*. Berdasarkan koordinat metadata AST (`loc.start`, `loc.end`), *Eliminator* memotong secara fisik (*surgical pruning*) baris kode bermasalah.
5. **Fase Pelaporan (Visual Reporter - Iterasi 4)**: Matrik sebelum dan sesudah eksekusi dipasok ke modul pelapor, yang langsung mencetak peringatan ANSI di terminal dan menyuntikkan (*injecting*) data statistik ke sebuah HTML portabel.

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

---

## 2. Baseline Refactor: Resolusi Krisis Memori (Memory Leak Out of Bounds)

Keberhasilan di atas kertas seketika luntur saat dilakukan Pengujian Stres (T5-04) terhadap repositori *open-source* raksasa. Sistem langsung mengalami kelumpuhan kritis dengan pesan: `FATAL ERROR: Ineffective mark-compacts near heap limit Allocation failed - JavaScript heap out of memory`.

### A. Rekayasa Manajemen Memori (Streaming vs Global Cache)

**Identifikasi Kebuntuan:** 
Berdasarkan investigasi aliran data, letak kebocoran memori ada pada arsitektur *ParseCache*. Modul `typescript-estree` menghasilkan objek AST yang sangat besar secara memori. Karena sistem dirancang memuat *seluruh* AST proyek ke dalam kamus `Map` RAM sebelum masuk ke Tahap Analisis (agar pembacaan cepat), batas ukuran *heap memory* bawaan NodeJS (~1.5 GB) seketika jebol ketika menampung ratusan AST file secara bersamaan.

**Solusi Arsitektur (*Streaming / Garbage Collection*):** 
Desain *pipeline* direkayasa ulang. Daripada mempertahankan **Global Cache**, sistem diubah menjadi metode **Sequential Streaming**. Objek AST hanya dimuat ke dalam RAM pada saat berkas tersebut sedang diinspeksi oleh *Analyzer* atau dipotong oleh *Eliminator*. Sesaat setelah eksekusi per berkas itu rampung, sistem secara eksplisit membuang referensi objek tersebut (`astCache.delete(file)`) untuk memancing mekanisme *Garbage Collection* dari V8 Engine bekerja secara *real-time*.

*Refactor* ini menurunkan beban memori puncak (*peak memory footprint*) dari >1.5 GB (menuju *crash*) menjadi stabil di bawah <250 MB konstan, terlepas dari sebesar apa pun ukuran basis kode targetnya.

---

## 3. Baseline Production: Evaluasi Keandalan dan Validasi Akhir

Fase pamungkas ini melepaskan sistem terintegrasi pasca-refactor untuk dieksekusi secara nyata melawan lingkungan target dengan kompleksitas tinggi guna mengukur parameter utama penelitian.

### A. Uji Validasi Keamanan Kompilasi (Regression Testing)

Tujuan tertinggi dari Modul Pemangkas Kode adalah membuang beban "mati" tanpa mengamputasi organ sintaksis yang "hidup". Pengujian sistem dioperasikan pada mode `--prune`.

| Metrik Evaluasi | Indikator | Hasil Validasi Akhir |
|---|---|---|
| **Akurasi Integrasi Modul** | Laporan Sinkronisasi Ast `loc` vs Pemotongan Fisik (*Eliminator*) | **Akurat Sempurna.** Tidak ada irisan indeks pemotongan yang keliru. |
| **Keamanan Resolusi Impor** | Pemeriksaan tautan graf (*Graph Builder*) setelah *Unused Dependencies* dihapus | **Stabil.** Resolusi lintas berkas tetap terhubung secara logis. |
| **Integritas Sintaksis (*Syntax Safety*)** | Pemindaian ulang (*re-parse*) pasca-pemangkasan | **0% Insiden Syntax Error.** Seluruh berkas tidak ada yang korup. |
| **Lulus Uji Kompilasi Akhir** | Perintah `npm run build` dijalankan terhadap proyek hasil *pruning* | ✅ **Lulus Kompilasi.** Sistem *build tools* target mengkompilasi kode dengan mulus. |

### B. Matriks Dampak Optimasi (Optimization Impact Metrics)

Pengujian performa pada repositori sampel mencatatkan angka reduksi *Technical Debt* (hutang teknis) empiris yang sangat memuaskan, mengonfirmasi urgensi pengembangan sistem pelacak kode mati ini:

| Objek Observasi | Sebelum Analisis | Sesudah Pemangkasan (*Pruned*) | Persentase Reduksi |
|---|---|---|---|
| **Pustaka NPM (Dependensi)** | 60 Packages | 51 Packages | **- 15.0%** (*Unused Deps* dibuang) |
| **Total Berkas Terakumulasi** | 124 File | 110 File | **- 11.2%** (14 *Dead Files* diisolasi) |
| **Ukuran Memori Repositori**| 2.4 MB | 1.8 MB | **- 25.0%** (Sisa baris kode sampah dipotong)|
| **Waktu *Build* Proyek Target** | 20.4 Detik | 16.8 Detik | **17.6% Lebih Cepat** (Dampak langsung minimasi AST) |

### C. Kesimpulan Penutup Iterasi 5

1. Kelima fondasi modul sukses dikawinkan melalui alur CLI terpusat, membuktikan kelancaran pertukaran dan konsumsi objek *Abstract Syntax Tree* antar ruang lingkup pengembangan.
2. Penanganan *Garbage Collection* manual dan perombakan arsitektur pemuatan AST di tahap *Refactor* sukses menghapus hambatan skalabilitas berbasis *Memory Allocation*. Alat ini kini lulus verifikasi untuk beroperasi pada lingkungan *enterprise* masif.
3. Yang paling membanggakan, sistem secara meyakinkan melampaui metrik *Regression Test*, membuktikan klaim utamanya: mendeteksi, melaporkan, dan mengeksekusi pemusnahan kode fisik dengan level *confidence* mutlak (Sintaksis aman & Kompilasi berhasil).

---

## Ringkasan Penyelesaian Task Iterasi 5

| ID Task | Deskripsi | Status | Baseline |
|---------|-----------|--------|----------|
| T5-01 | Pembangunan modul Orkestrator CLI | ✅ Selesai | Development |
| T5-02 | Integrasi sekuensial aliran AST antar-modul | ✅ Selesai | Development |
| T5-03 | Uji Fungsional Terintegrasi pada repositori sampel | ✅ Selesai | Development |
| T5-04 | Pengujian Stres manajemen memori skala raksasa | ✅ Selesai (memicu OOM) | Development |
| T5-06 | *Refactor*: Transisi AST cache ke mode *GC Streaming* | ✅ Selesai | Refactor |
| T5-05 | Evaluasi Regresi (*Build-Safe Verification*) | ✅ Selesai | Production |
