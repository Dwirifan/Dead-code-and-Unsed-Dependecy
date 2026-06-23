#### 4.4.1 Iterasi 1: Pembangunan *Core Parser*

Iterasi pertama berfokus pada pembangunan Modul Pengurai (*Core Parser*) — komponen yang mengubah kode sumber menjadi representasi *Abstract Syntax Tree* (AST) berformat ESTree. Modul ini menjadi prasyarat bagi seluruh proses analisis, sebab tanpa AST yang akurat, tidak ada satu pun proses deteksi *dead code* yang dapat dijalankan secara tepat.

---

##### A. Perencanaan Iterasi dan *TaskPriorityList*

Sebelum pengkodean dimulai, pengembangan *core parser* dipecah menjadi unit tugas teknis yang terukur berdasarkan spesifikasi *Component Diagram*. Tugas-tugas ini kemudian disusun ke dalam *TaskPriorityList* sebagai berikut:

| Prioritas | ID Task | Deskripsi Task                                                                                                               | *User Story* |
| --------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------ |
| 1         | T1-01   | Implementasi fungsi inti `parseCode()` yang menerima *string* kode sumber dan mengembalikan AST berformat ESTree             | US-02        |
| 2         | T1-02   | Konfigurasi opsi parser dengan mengaktifkan `loc: true` untuk menyimpan metadata posisi pada setiap *node* AST               | US-02        |
| 3         | T1-03   | Penyusunan dan pelaksanaan skenario pengujian parser terhadap sintaks JavaScript modern (ES6+) dan TypeScript lanjutan       | US-01, US-02 |
| 4         | T1-04   | Implementasi dasar mekanisme *caching* (`ParseCache`) berbasis `mtimeMs`                                                     | US-01, US-02 |
| 5         | T1-05   | Integrasi dan optimasi `ParseCache` dengan alur pemrosesan `parseCode()`                                                     | US-01, US-02 |

Rencana pengujian pada iterasi ini disusun untuk memvalidasi empat aspek utama, yaitu kemampuan parser membentuk AST dari sintaks JavaScript modern (ES6+), kompatibilitas terhadap sintaks TypeScript modern, kompatibilitas AST terhadap mekanisme traversal yang digunakan sistem, serta pengujian ketahanan parser terhadap skenario ekstrem (crash test). Skenario pengujian tersebut kemudian dijalankan pada tahap pengujian awal di *development baseline* sebelum hasilnya ditinjau melalui *self-review/code walkthrough*.

---

##### B. *Development Baseline*

Fase *development baseline* difokuskan pada pembangunan purwarupa awal modul pengurai (*core parser*) dan implementasi dasar *ParseCache*.

Sebagai *engine* parser awal, dipilih Acorn v8.15.0 dengan plugin `acorn-typescript` karena mampu menghasilkan AST berformat ESTree dan memiliki ukuran dependensi yang relatif ringan. Pemilihan ini didasarkan pada dokumentasi, dukungan terhadap standar ESTree, serta karakteristik AST yang dihasilkan yang dinilai sesuai dengan kebutuhan sistem. Oleh karena itu, Acorn digunakan sebagai purwarupa awal untuk memproses berkas JavaScript dan TypeScript sebelum dilakukan evaluasi melalui pengujian dan *self-review*.

Pada tahap ini, pengembangan difokuskan pada implementasi fungsi `parseCode()`, konfigurasi metadata posisi AST (`loc: true`), serta implementasi komponen dasar *ParseCache* sebagai mekanisme penyimpanan sementara hasil *parsing* agar berkas yang sama tidak perlu diurai ulang dalam satu sesi analisis.

---

##### C. Pengujian Awal

Pengujian modul *Core Parser* dirancang untuk memvalidasi empat aspek utama: kemampuan pembentukan node AST untuk sintaks JavaScript modern (ES6+), kompatibilitas terhadap sintaks modern TypeScript, kemampuan penelusuran (*traversal*) AST oleh pustaka `estraverse`, serta pengujian ketahanan (*crash test*) untuk melihat batas beban memori *engine*. Secara keseluruhan, terdapat 22 skenario pengujian yang diringkas sebagai berikut:

| Kelompok Uji                      | Cakupan Skenario                                                                     | Jumlah TC | Tujuan                                                                                                          |
| --------------------------------- | ------------------------------------------------------------------------------------ | --------: | --------------------------------------------------------------------------------------------------------------- |
| Sintaks JavaScript Modern (ES6+)  | `import`, variabel, `var`, `let`, parameter, dan *destructuring*                     |         8 | Memvalidasi pembentukan AST dari sintaks JavaScript modern (ES6+).                                              |
| Kompatibilitas TypeScript Modern  | TS dasar, `export type`, `override`, `satisfies`, dan *non-null assertion*           |         8 | Memvalidasi pemrosesan dan pembentukan AST untuk sintaks TypeScript modern.                                     |
| Kompatibilitas Traversal AST      | `TSInterfaceDeclaration`, `TSTypeAliasDeclaration`, `TSEnumDeclaration`, dan `TSModuleDeclaration` |         4 | Memverifikasi kompatibilitas penelusuran node khusus TypeScript menggunakan pustaka `estraverse`.               |
| Skenario Ekstrem (Crash Test)     | Deep nesting dan massive payload script                                              |         2 | Menguji ketahanan *parser* terhadap anomali *stack overflow* dan konsumsi memori berlebih.                      |

Detail skenario pengujian (TC-01 s.d. TC-24, *melewati TC-10 & TC-11 yang telah dihapus sesuai batasan sistem*) disajikan pada Lampiran.

Hasil pengujian awal menunjukkan bahwa *engine* Acorn memiliki performa yang cukup baik dalam memproses mayoritas skenario. Acorn berhasil memproses sintaks JavaScript modern, TypeScript dasar, dan bahkan terbukti kompatibel dengan proses *traversal* (TC-19 s.d. TC-22 Lulus). Selain itu, Acorn juga berhasil melewati skenario pengujian ekstrem (*Crash Test*) tanpa hambatan. Namun, terdapat 4 skenario uji yang gagal dilewati oleh Acorn, sehingga tingkat keberhasilan (*success rate*) secara keseluruhan hanya mencapai 81,8% (18 dari 22 skenario lulus).

```text
[TC-01 — TC-08]  Sintaks JavaScript Modern (ES6+)   LULUS (8/8)
[TC-09 — TC-18]  Kompatibilitas TypeScript Modern   GAGAL (Lulus: 4/8)
[TC-19 — TC-22]  Kompatibilitas Traversal AST       BERHASIL
[TC-23 — TC-24]  Skenario Ekstrem (Crash Test)      BERHASIL
─────────────────────────────────────────────────────────────────
Lulus : 18 dari 22 | Success Rate: 81,8%
```

---

##### D. *Self-Review* dan Analisis Kegagalan

Hasil pengujian awal kemudian ditinjau melalui *self-review* dan *code walkthrough* mandiri. Proses tinjauan difokuskan pada analisis akar penyebab kegagalan yang terjadi pada kelompok uji kompatibilitas TypeScript modern (TC-15 s.d. TC-18).

Pengujian mengungkap **kelemahan fatal** pada Acorn, yaitu ketidakmampuannya mem-parsing sintaks TypeScript lanjutan. Keempat skenario tersebut mengalami kegagalan *parsing* secara mutlak (*crash* akibat `SyntaxError`) ketika berhadapan dengan sintaks seperti `export type *`, `override`, `satisfies`, dan *non-null assertion*. Karena modul analisis *dead code* membutuhkan akurasi *parsing* 100% dan tidak boleh *crash* pada berkas apapun, tingkat keberhasilan (*success rate*) Acorn yang hanya mencapai 81,8% dinyatakan tidak memenuhi kriteria kelayakan produksi.

Investigasi menyimpulkan bahwa kelemahan mendasar *engine* Acorn terletak pada **Keterbatasan Dukungan Sintaks TypeScript Modern**. Kombinasi parser `acorn` dan plugin `acorn-typescript` terbukti sudah tertinggal dari spesifikasi TypeScript terbaru. Sintaks-sintaks modern tersebut memicu `SyntaxError` internal pada *engine* yang menghentikan seluruh rantai proses *parsing*. 

Kegagalan *parsing* ini bersifat *blocking*, artinya jika *analyzer* menemukan satu saja berkas dengan sintaks tersebut di dalam proyek pengguna, seluruh proses analisis akan terhenti (*crash*).

Berdasarkan temuan tersebut, diputuskan bahwa purwarupa Acorn tidak dapat dipertahankan. Diperlukan perubahan komponen *parser* utama untuk menjamin keberhasilan pemrosesan seluruh varian sintaks TypeScript tanpa terkecuali. Oleh karena itu ditambahkan dua task perbaikan berikut:

| Prioritas | ID Task | Deskripsi Task                                                                                                                              |
| --------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| 1 (Baru)  | T1-06   | Migrasi *engine* secara permanen ke `@typescript-eslint/typescript-estree` untuk menjamin dukungan 100% terhadap sintaks TypeScript modern. |
| 2 (Baru)  | T1-07   | Penghapusan dependensi `acorn` dan `acorn-typescript` dari sistem.                                                                          |

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

Seluruh 22 skenario uji awal kemudian dijalankan kembali (*regression test*). Hasilnya, *engine* baru sukses memproses secara sempurna keempat skenario sintaks TypeScript lanjutan (TC-15 s.d. TC-18) yang sebelumnya menyebabkan *crash* pada Acorn. Selain itu, *engine* `@typescript-eslint/typescript-estree` juga terbukti secara formal mempertahankan tingkat kelulusan 100% pada pengujian JavaScript modern (TC-01 s.d. TC-08), kompatibilitas traversal `estraverse` (TC-19 s.d. TC-22), serta pengujian ekstrem (TC-23 s.d. TC-24).

Dengan keberhasilan memulihkan *test case* yang gagal tanpa merusak skenario lain, tingkat keberhasilan (*success rate*) *parser* kini mencapai 100%. Modul *parser* dinyatakan sangat stabil untuk diteruskan ke tahap *refactor baseline*.

| Kelompok Uji | Hasil |
| :--- | :--- |
| JavaScript Dasar | 8/8 |
| TypeScript | 8/8 |
| Kompatibilitas Traversal AST | 4/4 |
| Skenario Ekstrem (Crash Test) | 2/2 |
| Total | 22 (100%) |

```text
[TC-01 — TC-08]  Sintaks JavaScript Modern (ES6+)   BERHASIL
[TC-09 — TC-18]  Kompatibilitas TypeScript Modern   BERHASIL
[TC-19 — TC-22]  Kompatibilitas Traversal AST       BERHASIL
[TC-23 — TC-24]  Skenario Ekstrem (Crash Test)      BERHASIL
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

Validasi akhir menunjukkan bahwa seluruh kriteria penerimaan US-01 dan US-02 telah terpenuhi. Sistem berhasil memproses berkas `.js` dan `.ts`, menghasilkan AST yang dapat ditelusuri, serta memanfaatkan `ParseCache` tanpa mengubah struktur AST yang dihasilkan. Dengan demikian, modul dinyatakan stabil dan siap digunakan pada iterasi berikutnya.

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