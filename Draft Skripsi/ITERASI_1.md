#### 4.4.1 Iterasi 1: Pembangunan *Core Parser*

Iterasi pertama berfokus pada pembangunan Modul Pengurai (*Core Parser*) — komponen yang mengubah kode sumber menjadi representasi *Abstract Syntax Tree* (AST) berformat ESTree. Modul ini menjadi prasyarat bagi seluruh proses analisis, sebab tanpa AST yang akurat, tidak ada satu pun proses deteksi *dead code* yang dapat dijalankan secara tepat.

---

##### A. Perencanaan Iterasi dan *TaskPriorityList*

Sebelum pengkodean dimulai, pengembangan *core parser* dipecah menjadi unit tugas teknis yang terukur berdasarkan spesifikasi *Component Diagram*. Tugas-tugas ini kemudian disusun ke dalam *TaskPriorityList* sebagai berikut:

| Prioritas | ID Task | Deskripsi Task                                                                                                               | *User Story* |
| --------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1         | T1-01   | Implementasi fungsi inti `parseCode()` yang menerima *string* kode sumber dan mengembalikan AST berformat ESTree             | US-02        |
| 2         | T1-02   | Konfigurasi opsi parser dengan mengaktifkan `loc: true` untuk menyimpan metadata posisi pada setiap *node* AST               | US-02        |
| 3         | T1-03   | Penyusunan dan pelaksanaan skenario pengujian parser terhadap konstruksi JavaScript dasar, TypeScript modern, JSX, dan TSX   | US-01, US-02 |
| 4         | T1-04   | Implementasi dasar mekanisme *caching* (`ParseCache`) berbasis `mtimeMs`                                                     | US-01, US-02 |
| 5         | T1-05   | Integrasi dan optimasi `ParseCache` dengan alur pemrosesan `parseCode()`                                                     | US-01, US-02 |

Rencana pengujian pada iterasi ini disusun untuk memvalidasi tiga aspek utama, yaitu kemampuan parser membentuk AST dari konstruksi JavaScript dasar, kompatibilitas terhadap sintaks TypeScript/JSX/TSX, serta kompatibilitas AST terhadap mekanisme traversal yang digunakan sistem. Skenario pengujian tersebut kemudian dijalankan pada tahap pengujian awal di *development baseline* sebelum hasilnya ditinjau melalui *self-review/code walkthrough*.

---

##### B. *Development Baseline*

Fase *development baseline* difokuskan pada pembangunan purwarupa awal modul pengurai (*core parser*) dan implementasi dasar *ParseCache*.

Sebagai *engine* parser awal, dipilih Acorn v8.15.0 dengan plugin `acorn-typescript` karena mampu menghasilkan AST berformat ESTree dan memiliki ukuran dependensi yang relatif ringan. Pemilihan ini didasarkan pada dokumentasi, dukungan terhadap standar ESTree, serta karakteristik AST yang dihasilkan yang dinilai sesuai dengan kebutuhan sistem. Oleh karena itu, Acorn digunakan sebagai purwarupa awal untuk memproses berkas JavaScript dan TypeScript sebelum dilakukan evaluasi melalui pengujian dan *self-review*.

Pada tahap ini, pengembangan difokuskan pada implementasi fungsi `parseCode()`, konfigurasi metadata posisi AST (`loc: true`), serta implementasi komponen dasar *ParseCache* sebagai mekanisme penyimpanan sementara hasil *parsing* agar berkas yang sama tidak perlu diurai ulang dalam satu sesi analisis.

---

##### C. Pengujian Awal

Pengujian modul *Core Parser* dirancang untuk memvalidasi tiga aspek utama: kemampuan pembentukan node AST untuk konstruksi JavaScript dasar, kompatibilitas terhadap sintaks modern TypeScript/JSX/TSX, serta kemampuan penelusuran (*traversal*) AST oleh pustaka `estraverse`. Secara keseluruhan, terdapat 22 skenario pengujian yang diringkas sebagai berikut:

| Kelompok Uji                      | Cakupan Skenario                                                                     | Jumlah Skenario | Tujuan                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------ | --------------: | --------------------------------------------------------------------------------------------------------------- |
| Konstruksi JavaScript Dasar       | `import`, variabel, `var`, `let`, parameter, dan *destructuring*                     |            8 TC | Memastikan parser mampu membentuk AST dari konstruksi JavaScript dasar.                                         |
| Kompatibilitas TypeScript/JSX/TSX | TS dasar, JSX, TSX, `export type`, `override`, `satisfies`, dan *non-null assertion* |           10 TC | Memastikan parser mampu memproses sintaks TypeScript/JSX/TSX dan menghasilkan AST secara utuh.                  |
| Kompatibilitas Traversal AST      | `TSInterfaceDeclaration`, `TSTypeAliasDeclaration`, `TSEnumDeclaration`, dan `TSModuleDeclaration` |            4 TC | Memverifikasi bahwa node-node khusus TypeScript yang dihasilkan sepenuhnya kompatibel dengan `estraverse`.        |

Detail skenario pengujian (TC-01 s.d. TC-22) disajikan pada Lampiran.

Hasil pengujian awal menunjukkan bahwa *engine* Acorn berhasil membentuk AST untuk 12 skenario awal (TC-01 s.d. TC-12, meliputi konstruksi JavaScript dan TypeScript dasar). Namun, 6 skenario terkait sintaks TypeScript lanjutan (TC-13 s.d. TC-18) mengalami kegagalan *parsing* (*crash*). Selain itu, 4 skenario uji kompatibilitas traversal (TC-19 s.d. TC-22) juga dinyatakan gagal karena node TypeScript yang dihasilkan belum dapat ditelusuri secara lengkap menggunakan estraverse, sehingga beberapa deklarasi TypeScript-spesifik tidak berhasil teridentifikasi selama proses traversal. Tingkat keberhasilan (*success rate*) keseluruhan pada pengujian awal ini hanya mencapai 54,5% (12 dari 22 skenario lulus).

```text
[TC-01 — TC-08]  Konstruksi JavaScript Dasar        LULUS (8/8)
[TC-09 — TC-12]  JavaScript & TypeScript Dasar      BERHASIL
[TC-13 — TC-18]  Sintaks TypeScript Lanjutan        GAGAL
[TC-19 — TC-22]  Pengujian Kompatibilitas Traversal GAGAL
─────────────────────────────────────────────────────────────────
Lulus : 12 dari 22 | Success Rate: 54,5%
```

---

##### D. *Self-Review* dan Analisis Kegagalan

Hasil pengujian awal kemudian ditinjau melalui *self-review* dan *code walkthrough* mandiri. Proses tinjauan mencakup pemeriksaan kesesuaian implementasi dengan rancangan pada Subbab 4.3, evaluasi keterbacaan kode, serta analisis akar penyebab kegagalan pada TC-13 s.d. TC-22.

Selain menemukan kegagalan *parsing* pada beberapa sintaks TypeScript modern, proses *self-review* juga mengidentifikasi keterbatasan kompatibilitas AST terhadap mekanisme *traversal* yang digunakan pada sistem. Berdasarkan hasil pengujian dan pemeriksaan struktur node AST, diketahui bahwa AST yang dihasilkan oleh kombinasi Acorn dan `acorn-typescript` belum sepenuhnya kompatibel dengan proses *traversal* menggunakan `estraverse`, sehingga beberapa node TypeScript-spesifik tidak dapat ditelusuri secara konsisten selama proses traversal.

Investigasi mengidentifikasi dua kelemahan mendasar *engine* Acorn:

1. **AST Tidak Sepenuhnya Traversable.** Beberapa node TypeScript-spesifik tidak menyediakan informasi struktur penelusuran (visitor keys) yang sepenuhnya kompatibel dengan mekanisme traversal ESTree. Akibatnya, proses penelusuran AST menggunakan `estraverse` berpotensi melewatkan variabel, tipe, maupun deklarasi tertentu sehingga menimbulkan *false negative* pada tahap analisis.

2. **Kegagalan Parsing pada Sintaks TypeScript Modern.** Sintaks seperti `export type { ... }`, `override`, dan operator `satisfies` menghasilkan `SyntaxError` yang menghentikan proses *parsing*.

Berdasarkan temuan tersebut, diperlukan perubahan pada komponen parser untuk menjamin keberhasilan parsing sintaks TypeScript modern serta kompatibilitas AST terhadap mekanisme traversal yang digunakan sistem. Oleh karena itu ditambahkan dua task perbaikan berikut:

| ID Task Baru | Deskripsi                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| T1-06        | Migrasi *engine* ke `@typescript-eslint/typescript-estree` untuk memastikan kompatibilitas AST terhadap proses *traversal* node TypeScript. |
| T1-07        | Penghapusan `acorn-typescript` yang gagal menangani sintaks TypeScript lanjutan (TS 4.9+).                                                  |

---

##### E. Tindak Lanjut Hasil Self-Review dan Uji Ulang
Sesuai hasil *self-review*, *engine* Acorn diganti secara permanen dengan **@typescript-eslint/typescript-estree v8.58.2**. Fungsi inti `parseCode()` diimplementasikan ulang dengan pembungkus `try-catch` untuk menangkap `SyntaxError` bawaan dan mengubahnya menjadi `ParseError` kustom yang memuat detail presisi (`filePath`, `lineNumber`, dan `column`).

```javascript
export function parseCode(codeString, filePath = 'unknown', opts = {}) {
    try {
        return parse(codeString, { ...PARSER_OPTIONS, filePath, ...opts });
    } catch (e) {
        throw new ParseError(`Gagal: ${e.message}`, filePath, e.lineNumber, e.column);
    }
}
```

Selain migrasi *engine*, *ParseCache* divalidasi melalui *unit test* sederhana guna memastikan mekanisme simpan, ambil, dan invalidasi berbasis `mtimeMs` berjalan dengan benar.

Seluruh 22 skenario uji awal kemudian dijalankan kembali (*regression test*). Hasilnya, *engine* baru sukses memproses keseluruhan sintaks TypeScript lanjutan (TC-13 s.d. TC-18) yang sebelumnya menyebabkan *crash*. Begitu pula dengan pengujian kompatibilitas traversal (TC-19 s.d. TC-22), di mana seluruh node TypeScript-spesifik (`TSInterfaceDeclaration`, `TSTypeAliasDeclaration`, `TSEnumDeclaration`, dan `TSModuleDeclaration`) berhasil dikunjungi oleh `estraverse` tanpa kehilangan informasi deklarasi.

Dengan keberhasilan memulihkan *test case* yang gagal, tingkat keberhasilan (*success rate*) mencapai 100%. AST yang dihasilkan oleh `@typescript-eslint/typescript-estree` terbukti secara formal kompatibel, dan modul *parser* dinyatakan stabil untuk diteruskan ke tahap *refactor baseline*.

| Kelompok Uji | Hasil |
| :--- | :--- |
| JavaScript Dasar | 8/8 |
| TypeScript/JSX/TSX | 10/10 |
| Kompatibilitas Traversal AST | 4/4 |
| Total | 22/22 (100%) |

```text
[TC-01 — TC-18]  Sintaks Dasar & Lanjutan           BERHASIL
[TC-19 — TC-22]  Kompatibilitas Traversal AST       BERHASIL
─────────────────────────────────────────────────────────────────
Lulus : 22 dari 22 | Success Rate: 100%
```

---

##### F. *Refactor Baseline*

Pada tahap ini, *ParseCache* diintegrasikan ke dalam `parseCode()` menggunakan validasi `fs.stat().mtimeMs`. Jika stempel waktu berkas identik, AST diambil dari *cache* tanpa *re-parsing*. Jika berbeda, *cache* dihapus dan berkas diurai ulang.

```javascript
// Cuplikan inti: logika cache hit/miss
if (cached.mtime === mtime) return { ast: cached.ast, code: cached.code }; // HIT
this._cache.delete(filePath);
return null; // MISS → re-parsing
```

Setelah integrasi selesai, *integration test* dilakukan dengan membandingkan skenario *parsing* tanpa dan dengan *ParseCache* pada proyek uji berisikan 38 berkas JavaScript/TypeScript.

**Tabel 4.1 Perbandingan Benchmark Parser Tanpa dan Dengan *ParseCache***

| Kondisi Pengujian   | Jumlah File Unik | Operasi *Parsing* Aktual | *Cache Hit* | Waktu Eksekusi |
| ------------------- | ---------------: | -----------------------: | ----------: | -------------: |
| Tanpa *ParseCache*  |               38 |                 114 kali |           - |         417 ms |
| Dengan *ParseCache* |               38 |                  38 kali |     76 kali |         212 ms |

Hasil *benchmark* membuktikan efektivitas *cache*, di mana operasi *parsing* aktual berhasil ditekan dengan *hit rate* 66,7%. Waktu eksekusi keseluruhan juga terpangkas secara masif dari 417 ms menjadi 212 ms (penurunan **49,2%**). 

Tahap *refactor* ini berhasil meningkatkan efisiensi komputasi secara signifikan tanpa merusak keluaran fungsional parser, menjadikannya siap untuk dipindahkan ke *production baseline*.

---

##### G. *Production Baseline*

Setelah seluruh task selesai dan seluruh pengujian berhasil dilalui, modul *Core Parser* ditetapkan sebagai *Production Baseline* Iterasi 1. Baseline ini mencakup fungsi `parseCode()`, kelas `ParseError`, mekanisme `ParseCache`, dan keluaran AST berformat ESTree yang kompatibel dengan `estraverse`.

Validasi akhir menunjukkan bahwa seluruh kriteria penerimaan US-01 dan US-02 telah terpenuhi. Sistem berhasil memproses berkas `.js`, `.ts`, `.jsx`, dan `.tsx`, menghasilkan AST yang dapat ditelusuri, serta memanfaatkan `ParseCache` tanpa mengubah struktur AST yang dihasilkan. Dengan demikian, modul dinyatakan stabil dan siap digunakan pada iterasi berikutnya.

---

##### H. Ringkasan Penyelesaian Task Iterasi 1

| ID Task | Deskripsi                                                  | Status  | Baseline                                  |
| ------- | ---------------------------------------------------------- | ------- | ----------------------------------------- |
| T1-01   | Implementasi fungsi `parseCode()`                          | Selesai | Development                               |
| T1-02   | Konfigurasi opsi parser (`loc: true`)                      | Selesai | Development                               |
| T1-03   | Penyusunan dan pelaksanaan skenario pengujian parser       | Selesai | Development                               |
| T1-04   | Implementasi dasar `ParseCache`                            | Selesai | Development                               |
| T1-05   | Integrasi dan optimasi `ParseCache`                        | Selesai | Refactor                                  |
| T1-06   | Migrasi *engine* ke `@typescript-eslint/typescript-estree` | Selesai | Development (Perbaikan hasil self-review) |
| T1-07   | Penghapusan `acorn-typescript`                             | Selesai | Development (Perbaikan hasil self-review) |