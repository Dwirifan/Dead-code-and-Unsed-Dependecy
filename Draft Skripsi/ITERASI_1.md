#### 4.4.1 Iterasi 1: Pembangunan *Core Parser*

Iterasi pertama berfokus pada pembangunan Modul Pengurai (*Core Parser*) — komponen yang mengubah kode sumber menjadi representasi *Abstract Syntax Tree* (AST) berformat ESTree. Modul ini menjadi prasyarat bagi seluruh proses analisis, sebab tanpa AST yang akurat, tidak ada satu pun proses deteksi *dead code* yang dapat dijalankan secara tepat.

---

##### A. Tahap Perencanaan (Planning)

Dalam kerangka kerja *Extreme Programming* (XP), tahap perencanaan difokuskan pada penerjemahan *user story* menjadi daftar tugas teknis yang terukur, penentuan prioritas, serta penyusunan kriteria keberhasilan iterasi.

Berdasarkan *User Story* US-01 dan US-02 yang ditetapkan pada Subbab 4.1, tujuan utama iterasi pertama ini adalah membangun fondasi pengurai (*Core Parser*) yang mampu membaca teks kode sumber dan merangkainya menjadi *Abstract Syntax Tree* (AST). 

Tugas-tugas teknis dijabarkan dan diberikan prioritas eksekusi ke dalam tabel berikut:

| Prioritas | ID Task | Deskripsi Task | *User Story* |
| :---: | :--- | :--- | :---: |
| 1 | T1-01 | Implementasi fungsi `parseCode()` untuk mengekstraksi AST berformat ESTree dari kode sumber. | US-02 |
| 2 | T1-02 | Konfigurasi opsi parser (`loc: true`) untuk merekam metadata posisi baris pada setiap *node* AST. | US-02 |
| 3 | T1-03 | Implementasi dasar mekanisme penyimpanan sementara (*in-memory caching*) berbasis `mtimeMs`. | US-01 |
| 4 | T1-04 | Integrasi dan optimasi `ParseCache` dengan alur `parseCode()` guna mencegah penguraian berulang. | US-01 |
| 5 | T1-05 | Penyusunan skenario pengujian parser terhadap sintaks JavaScript modern dan TypeScript. | US-02 |

Selain pembagian tugas, tahap perencanaan ini juga merumuskan **Kriteria Keberhasilan Iterasi**. Rencana pengujian (*Test Plan*) disepakati di awal untuk memvalidasi empat aspek utama:
1. Kemampuan parser membedah sintaks JavaScript modern (ES6+).
2. Kompatibilitas parser terhadap sintaks TypeScript modern (`enum`, `interface`, `type`).
3. Kompatibilitas AST terhadap standar struktur penelusuran (*ESTree format*).
4. Ketahanan parser terhadap skenario kode yang ekstrem (pencegahan *crash*).

Keempat aspek tersebut kemudian dijabarkan ke dalam cakupan pengujian, sebagaimana ditunjukkan pada tabel berikut.

**Tabel 4.x Rencana Cakupan Pengujian Modul *Core Parser***

| Kelompok Uji | Cakupan Sintaks / Kondisi | Tujuan Pengujian |
| :--- | :--- | :--- |
| **Sintaks JavaScript Modern (ES6+)** | `import`, variabel, `var`, `let`, parameter, dan *destructuring* | Memvalidasi pembentukan AST dari sintaks JavaScript modern (ES6+). |
| **Kompatibilitas TypeScript Modern** | TS dasar, `export type`, `override`, `satisfies`, dan *non-null assertion* | Memvalidasi pemrosesan dan pembentukan AST untuk sintaks TypeScript modern. |
| **Kompatibilitas Traversal AST** | `TSInterfaceDeclaration`, `TSTypeAliasDeclaration`, `TSEnumDeclaration`, `TSModuleDeclaration` | Memverifikasi kompatibilitas penelusuran *node* khusus TypeScript menggunakan pustaka `estraverse`. |
| **Skenario Ekstrem (*Crash Test*)** | *Deep nesting* dan *massive payload script* | Menguji ketahanan parser terhadap anomali *stack overflow* dan konsumsi memori berlebih. |

---

##### B. Tahap Perancangan (Design)

Perancangan pada iterasi ini merupakan desain mikro yang mengacu pada arsitektur makro sistem pada Subbab 4.3.1. Fokus perancangan meliputi struktur internal Modul *Core Parser*, pemilihan *parser engine*, format keluaran AST, penanganan galat, serta mekanisme penyimpanan sementara hasil *parsing*.

Modul dirancang menggunakan `@typescript-eslint/typescript-estree` karena mampu memproses sintaks JavaScript dan TypeScript serta menghasilkan AST yang kompatibel dengan format ESTree. Fungsi `parseCode()` dirancang menerima teks kode sumber dan identitas berkas, kemudian menghasilkan AST dengan metadata `loc` untuk posisi baris dan kolom serta `range` untuk indeks awal dan akhir setiap *node*. Metadata tersebut digunakan oleh modul analisis, pelaporan, dan eliminasi pada iterasi berikutnya.

Untuk menangani kegagalan *parsing*, sistem dirancang menggunakan `ParseError` yang menyimpan informasi berkas, baris, kolom, dan pesan kesalahan. Galat pada satu berkas dicatat tanpa menghentikan pemrosesan berkas lainnya. Selain itu, komponen *ParseCache* dirancang sebagai penyimpanan sementara dalam memori dengan menggunakan jalur berkas dan nilai `mtimeMs` sebagai dasar validasi. AST digunakan kembali apabila waktu modifikasi berkas belum berubah, sedangkan perubahan nilai `mtimeMs` menyebabkan berkas diuraikan kembali dan data *cache* diperbarui.

---

##### C. Tahap Pengkodean (Coding)

Dalam pelaksanaannya, tahap pengkodean dan pengujian dilakukan secara berulang. Pemisahan keduanya dalam penulisan subbab ini hanya bertujuan mempermudah penyajian proses pengembangan.

Proses pengkodean dimulai dengan implementasi fungsi inti `parseCode()` menggunakan `@typescript-eslint/typescript-estree`. Konfigurasi metadata posisi AST (`loc: true`) dipasang guna melacak nomor baris dan kolom yang esensial untuk tahap pelaporan nantinya. Fungsi tersebut dilengkapi dengan blok `try-catch` untuk menangkap galat bawaan parser dan mengubahnya menjadi `ParseError` kustom yang memuat informasi berkas, baris, dan kolom. Pada tingkat pemrosesan berkas, `ParseError` dicatat sehingga kegagalan pada satu berkas tidak menghentikan analisis terhadap berkas lainnya.

```javascript
export function parseCode(codeString, filePath = 'unknown', opts = {}) {
    try {
        return parse(codeString, { ...PARSER_OPTIONS, filePath, ...opts });
    } catch (e) {
        throw new ParseError(`Gagal: ${e.message}`, filePath, e.lineNumber, e.column);
    }
}
```

Pada tahap akhir pengkodean, *ParseCache* diintegrasikan ke dalam alur pemrosesan parser. Sebelum berkas diuraikan, sistem membandingkan nilai `mtimeMs` terbaru dengan metadata yang tersimpan. Jika nilainya identik, AST diambil dari *cache* tanpa melakukan *parsing* ulang.

---

##### D. Tahap Pengujian (Testing)

Berdasarkan cakupan pengujian yang telah ditetapkan pada tahap perencanaan, disusun dan dijalankan sebanyak 24 skenario pengujian pada Modul *Core Parser*. Skenario tersebut terdiri atas delapan pengujian sintaks JavaScript modern, sepuluh pengujian sintaks TypeScript, empat pengujian kompatibilitas penelusuran AST, dan dua pengujian skenario ekstrem.

Hasil pengujian menunjukkan bahwa seluruh skenario sintaks JavaScript, TypeScript, kompatibilitas penelusuran AST, dan skenario ekstrem yang telah didefinisikan berhasil dilalui. Pada skenario *deep nesting* dan *massive payload script* yang digunakan, parser dapat menyelesaikan proses tanpa mengalami kegagalan yang menghentikan pengujian.

```text
[TC-01 — TC-08]  Sintaks JavaScript Modern        BERHASIL
[TC-09 — TC-18]  Sintaks TypeScript Modern        BERHASIL
[TC-19 — TC-22]  Kompatibilitas Traversal AST     BERHASIL
[TC-23 — TC-24]  Skenario Ekstrem                 BERHASIL
─────────────────────────────────────────────────────────────────
Total: 24 dari 24 skenario berhasil dilalui.
```

Selanjutnya, *integration test* dilakukan dengan membandingkan skenario *parsing* tanpa dan dengan *ParseCache* pada proyek uji berisikan 38 berkas JavaScript/TypeScript.

Dalam skenario pengujian, setiap berkas diakses sebanyak tiga kali oleh tahapan pemrosesan yang berbeda. Oleh karena itu, tanpa mekanisme *cache*, 38 berkas unik menghasilkan 114 operasi *parsing*.

**Tabel 4.1 Perbandingan *Benchmark* Parser Tanpa dan dengan *ParseCache***

| Kondisi Pengujian   | Jumlah File Unik | Operasi *Parsing* Aktual | *Cache Hit* | Waktu Eksekusi |
| ------------------- | ---------------: | -----------------------: | ----------: | -------------: |
| Tanpa *ParseCache*  |               38 |                 114 kali |           - |         417 ms |
| Dengan *ParseCache* |               38 |                  38 kali |     76 kali |         212 ms |

Penerapan *ParseCache* mengurangi operasi *parsing* aktual dari 114 menjadi 38 operasi, dengan 76 *cache hit* atau *hit rate* sebesar 66,7%. Pada skenario pengujian yang digunakan, waktu pemrosesan tercatat menurun dari 417 ms menjadi 212 ms atau sebesar 49,2%. Hasil tersebut menunjukkan bahwa mekanisme *cache* dapat mengurangi pemrosesan berulang.

---

##### E. Evaluasi Iterasi

Setelah seluruh tugas dan skenario pengujian selesai dilaksanakan, Modul *Core Parser* dinyatakan selesai dan terintegrasi pada Iterasi 1. Hasil validasi menunjukkan bahwa kriteria penerimaan US-01 dan US-02 telah terpenuhi. Modul mampu memproses berkas `.js` dan `.ts` dalam cakupan pengujian, menghasilkan AST yang dapat ditelusuri menggunakan `estraverse`, serta menggunakan `ParseCache` tanpa mengubah keluaran AST. Modul ini selanjutnya digunakan secara langsung oleh modul pemetaan dan analisis pada iterasi berikutnya.

| ID Task | Deskripsi | Status | Keterangan |
| :--- | :--- | :--- | :--- |
| T1-01 | Implementasi fungsi `parseCode()` | Selesai | Terintegrasi |
| T1-02 | Konfigurasi opsi parser (`loc: true`) | Selesai | Terintegrasi |
| T1-03 | Implementasi dasar `ParseCache` | Selesai | Terintegrasi |
| T1-04 | Integrasi dan optimasi `ParseCache` | Selesai | Terintegrasi |
| T1-05 | Penyusunan dan pelaksanaan skenario pengujian parser terhadap sintaks JavaScript modern dan TypeScript. | Selesai | Lulus Uji |