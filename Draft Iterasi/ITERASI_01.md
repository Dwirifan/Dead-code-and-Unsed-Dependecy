# 4.6.2.1 Iterasi 1 : Pembangunan Core Parser

Iterasi pertama berfokus pada pembangunan Modul Pengurai (*Core Parser*) — komponen yang mengubah kode sumber menjadi representasi *Abstract Syntax Tree* (AST) berformat ESTree. Modul ini menjadi prasyarat bagi seluruh proses analisis, sebab tanpa AST yang akurat, tidak ada satu pun deteksi *dead code* yang dapat dijalankan.

---

## Perencanaan Iterasi & TaskPriorityList

Sebelum pengkodean dimulai, pengembangan core parser  dipecah menjadi unit tugas teknis yang terukur berdasarkan spesifikasi *Component Diagram*. Tugas-tugas ini kemudian disusun ke dalam *TaskPriorityList* sebagai berikut:

| Prioritas | ID Task | Deskripsi Task |
|-----------|---------|----------------|
| 1 | T1-01 | Implementasi fungsi inti `parseCode()` yang menerima string kode sumber dan mengembalikan AST berformat ESTree |
| 2 | T1-02 | Konfigurasi opsi parser: mengaktifkan `loc: true` untuk menyimpan metadata posisi pada setiap node AST |
| 3 | T1-03 | Penyusunan berkas uji dan skenario pengujian untuk konstruksi JavaScript dasar |
| 4 | T1-04 | Pengujian validasi kemampuan parser terhadap sintaks TypeScript modern, JSX, dan TSX |
| 5 | T1-05 | Optimasi performa: implementasi mekanisme *caching* (ParseCache) berbasis `mtimeMs` |

---

## 1. Baseline Development

Fase ini membangun purwarupa awal modul pengurai dengan *engine* Acorn (T1-01, T1-02), serta menyusun dan menjalankan skenario pengujian untuk memvalidasi keluaran AST pada konstruksi JavaScript murni (T1-03) maupun sintaks TypeScript modern (T1-04).

### A. Implementasi Logika dan Pemilihan Engine

Engine parser yang dipilih pada fase ini adalah Acorn versi 8.15.0  sebuah JavaScript parser yang telah mapan, bersifat ringan (lightweight), dan menghasilkan AST berformat ESTree yang merupakan standar de facto ekosistem JavaScript. Acorn dipilih sebagai titik awal berdasarkan dua pertimbangan utama: 
1)	kompatibilitasnya yang penuh dengan spesifikasi ESTree menjamin interoperabilitas dengan pustaka-pustaka traversal seperti estraverse.
2)	ukurannya yang kecil meminimalkan overhead dependensi pada tahap eksperimentasi awal. 
Untuk mendukung analisis terhadap proyek berbasis TypeScript, ditambahkan plugin acorn-typescript versi 1.4.13 sebagai ekstensi superset yang memperluas kemampuan Acorn dalam mengenali dan mengurai sintaks TypeScript dasar, seperti anotasi tipe serta deklarasi tipe yang terintegrasi pada kode sumber. Implementasi fitur ini diwujudkan dalam modul astParser.js pada cabang development.

```javascript
// astParser.js — Development Baseline (Acorn + acorn-typescript)
import acorn from 'acorn';
import acornTypescript from 'acorn-typescript';

const ParserWithTS = acorn.Parser.extend(acornTypescript());

export function parseCode(codeString) {
    try {
        return ParserWithTS.parse(codeString, {
            ecmaVersion: 'latest',
            sourceType: 'module',
            locations: true  // Simpan metadata baris & kolom pada setiap node
        });
    } catch (error) {
        throw new Error(`failed to parse code: ${error.message}`);
    }
}
```

### B. Skenario dan Prosedur Pengujian

Pengujian dibagi menjadi dua kelompok skenario dengan fokus yang berbeda. Kelompok pertama memvalidasi akurasi pembentukan node AST untuk berbagai konstruksi *dead code* fundamental (seperti variabel yang tidak dibaca, impor redundan, atau *hoisting*). Pengujian ini memastikan bahwa *parser* mampu memetakan struktur logika inti tersebut dengan sempurna, yang mana akan menjadi basis utama bagi mesin analisis. Sementara itu, kelompok kedua dirancang khusus untuk mengevaluasi kompatibilitas dan ketahanan *parser* (*stress-test*) saat berhadapan dengan sintaks *superset* modern seperti TypeScript, JSX, dan TSX agar terhindar dari galat pemrosesan (*crash*).

**Kelompok 1 — Unit Test: Konstruksi Inti Dead Code (TC-01 hingga TC-10):**

| ID | Konstruksi yang Diuji | Tujuan Validasi |
|---|---|---|
| TC-P1 | `import { format } from 'date-fns'` | Impor yang dipanggil dalam fungsi (harus dianggap *live*) |
| TC-P2 | `import _, { cloneDeep } from 'lodash'` | Impor sebagian: `_` tidak dipakai (*dead*), `cloneDeep` dipakai |
| TC-P3 | `import './global-style.css'` | *Side-effect import* (harus dipertahankan meski tanpa referensi) |
| TC-P4 | `const GLOBAL_UNUSED = "..."` | Variabel global tidak pernah dibaca (*dead code*) |
| TC-P5 | `var bocor` di dalam blok `if` | Perilaku *hoisting* `var` yang bocor ke luar blok |
| TC-P6 | `let tertahan` di dalam blok `if` | Variabel blok tidak direferensikan di luar (*dead code*) |
| TC-P7 | `const { profil: { nama, umur }, skill: [skillUtama, ...sisaSkill] }` | *Deep destructuring*: `nama` dan `sisaSkill` adalah *dead* |
| TC-P8 | Parameter `c` pada `function hitung(a, b, c)` | Parameter fungsi yang tidak dipakai (*dead parameter*) |

**Kelompok 2 — Kompatibilitas TypeScript/JSX/TSX (TC-01 s.d. TC-10):**
Skenario TC-01 s.d. TC-04 menguji sintaks *baseline* (JS/TS dasar, JSX, TSX); TC-05 s.d. TC-10 menguji fitur TypeScript lanjutan seperti `type-only export`, `override`, dan operator `satisfies`.

### C. Analisis dan Output Hasil Pengujian

**Kelompok 1 (T1-01 s.d. T1-03) — Lulus:** Pengujian dilakukan dengan memverifikasi bahwa setiap konstruksi *dead code* yang didefinisikan dalam berkas uji—mulai dari *unused variable*, *dead parameter*, *side-effect import*, hingga *deep destructuring*—berhasil diurai menjadi node AST dengan tipe dan metadata lokasi yang benar. Seluruh 8 konstruksi lulus validasi. Berikut cuplikan AST untuk instruksi `import { format } from 'date-fns'`:

```json
{
  "type": "ImportDeclaration",
  "loc": {
    "start": { "line": 1, "column": 0 },
    "end":   { "line": 1, "column": 34 }
  },
  "specifiers": [
    {
      "type": "ImportSpecifier",
      "imported": { "type": "Identifier", "name": "format" },
      "local":    { "type": "Identifier", "name": "format" }
    }
  ],
  "source": { "type": "Literal", "value": "date-fns" }
}
```

**Kelompok 2 (T1-04) — Gagal:** Engine Acorn hanya mampu mem-*parse* 4 dari 10 skenario (*success rate* 40%). TC-05 s.d. TC-10 gagal total karena keterbatasan dukungan terhadap sintaks TypeScript tingkat lanjut.

```
[TC-01] JavaScript & TypeScript Dasar    ✅ BERHASIL
[TC-02] JSX — React Components           ✅ BERHASIL
[TC-03] TSX — React + Generic Props      ✅ BERHASIL
[TC-04] TypeScript 4.1 Template Literal  ✅ BERHASIL
[TC-05] Type-Only Export (TS 3.8+)       ❌ GAGAL
[TC-06] Inline Type Export (TS 4.5+)     ❌ GAGAL
[TC-07] Export Type Star (TS 3.8+)       ❌ GAGAL
[TC-08] Override keyword (Polymorphism)  ❌ GAGAL
[TC-09] Operator satisfies (TS 4.9+)     ❌ GAGAL
[TC-10] Assignment Non-Null Assertion    ❌ GAGAL
─────────────────────────────────────────
  Berhasil di-parse : 4 dari 10  |  Success Rate: 40.0%
```

Kegagalan ini memicu pencatatan dua task perbaikan baru:

| ID Task Baru | Deskripsi |
|---|---|
| T1-06 | Migrasi *engine* ke `@typescript-eslint/typescript-estree` untuk menangani *false negative* pada *traversal* node TypeScript |
| T1-07 | Penghapusan `acorn-typescript` yang *crash* pada sintaks TypeScript lanjutan (TS 4.9+) |

---

## 2. Baseline Refactor

Fase ini mengeksekusi task perbaikan (T1-06, T1-07) dengan memigrasikan *engine* parser ke `@typescript-eslint/typescript-estree` untuk mengatasi kegagalan Acorn dalam mengurai sintaks TypeScript lanjutan dan memastikan seluruh node AST dapat ditelusuri (*traversable*).

### A. Identifikasi Kegagalan Kritis

Investigasi mengungkap dua kegagalan yang berlapis:

1. **AST Tidak *Traversable*:** Meskipun Acorn berhasil mem-*parse* sintaks TS dasar, node TypeScript-spesifik (seperti `TSInterfaceDeclaration`) tidak dilengkapi *visitor keys* ESTree. Akibatnya, `estraverse` tidak dapat menelusuri *child nodes*-nya, sehingga *analyzer* diam-diam melewatkan seluruh deklarasi tipe — kondisi *false negative* yang berbahaya dari error, karena sistem terkesan berjalan normal padahal kehilang puluhan variabel dan tipe..

2. **Crash pada Sintaks TS Modern:** Acorn melakukan pengecekan semantik saat *parsing*, sehingga sintaks seperti `export type { ... }` atau operator `satisfies` (TS 4.9+) langsung membuang `SyntaxError`.

### B. Justifikasi Migrasi dan Perubahan Dependensi

*Engine* acorn diganti menjadi **@typescript-eslint/typescript-estree v^8.58.2** yang mendukung secara *native*: seluruh sintaks TypeScript termasuk fitur lanjutan, JSX/TSX, serta berbagai ekstensi berkas (`.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, `.cjs`). Dependensi `acorn` dan `acorn-typescript` dihapus permanen.

### C. Implementasi Perbaikan Kode

 Tiga peningkatan struktural utama diimplementasikan:
1.	Konstanta PARSER_OPTIONS : konfigurasi parser diekstrak ke objek terpisah, memisahkan konfigurasi dari logika fungsi demi keterbacaan dan kemudahan perawatan.
2.	Kelas ParseError khusus : menggantikan Error generik, menyimpan konteks galat yang kaya: path berkas, nomor baris, dan nomor kolom sumber galat.
3.	Parameter filePath : diteruskan ke parser untuk resolusi konteks TypeScript yang lebih akurat dan pesan galat yang lebih informatif.


```javascript
// astParser.js — Pasca-Refactor (@typescript-eslint/typescript-estree)
import { parse } from '@typescript-eslint/typescript-estree';

const PARSER_OPTIONS = {
    loc: true, range: true, jsx: true, comment: true,
    errorOnUnknownASTType: false, allowHashBang: true
};

export class ParseError extends Error {
    constructor(msg, filePath, line, column) {
        super(msg);
        Object.assign(this, { name: 'ParseError', filePath, line, column });
    }
}

export function parseCode(codeString, filePath = 'unknown', opts = {}) {
    try {
        return parse(codeString, { ...PARSER_OPTIONS, filePath, ...opts });
    } catch (e) {
        throw new ParseError(`Gagal: ${e.message}`, filePath, e.lineNumber, e.column);
    }
}
```

---

## 3. Baseline Production

Tahapan akhir ini berfokus pada stabilisasi komponen, pengujian integrasi fungsional menyeluruh, dan penambahan fitur optimasi performa sebelum kode dikunci untuk rilis stabil.

### A. Matriks Validasi Pemecahan Masalah

Setelah migrasi ke `@typescript-eslint/typescript-estree`, dilakukan dua jenis pengujian untuk memvalidasi keberhasilan secara komprehensif:

**1. Uji 1 : Kemampuan Parsing Sintaks Lanjutan (Success Rate)**
Memvalidasi apakah *engine* mampu menghasilkan AST dari berbagai jenis sintaks tanpa *error*. Pengujian ini difokuskan pada 10 skenario *stress-test* yang merepresentasikan struktur kode aplikasi *production*:

| ID | Skenario Uji | Acorn (Development) | TS-Estree (Production) |
|---|---|---|---|
| TP-01 | JavaScript & TypeScript Dasar | Berhasil | Berhasil |
| TP-02 | JSX (React Components) | Berhasil | Berhasil |
| TP-03 | TSX React Component dengan Generic Props | Berhasil | Berhasil |
| TP-04 | TypeScript 4.1 (Template Literal Types) | Berhasil | Berhasil |
| TP-05 | Type-Only Export (TS 3.8+) | Gagal *(Export undefined)* | Berhasil |
| TP-06 | Inline Type Export (TS 4.5+) | Gagal *(Export undefined)* | Berhasil |
| TP-07 | Export Type Star (TS 3.8+) | Gagal *(Unexpected token)* | Berhasil |
| TP-08 | Override keyword pada Polymorphism | Gagal *(Extends error)* | Berhasil |
| TP-09 | Operator satisfies (TS 4.9+) | Gagal *(Unexpected token)* | Berhasil |
| TP-10 | Assignment ke Non-Null Assertion | Gagal *(Assign to rvalue)* | Berhasil |
| — | **Success Rate Parsing Keseluruhan** | **40.0%** | **100.0%** |

**2. Uji 2 : Kelengkapan Node TypeScript dalam AST (Dampak ke Analyzer)**
Memvalidasi apakah node TypeScript yang dihasilkan *parser* dapat ditelusuri (*di-traverse*) hingga ke *child-node* terdalam oleh modul *analyzer* menggunakan `estraverse`:

| ID | Skenario | Acorn | TS-Estree | Keterangan |
|---|---|---|---|---|
| TP-U1 | TSInterfaceDeclaration (interface) | Skipped *(Terisolasi)* | Terbaca Penuh | Diperbaiki |
| TP-U2 | TSTypeAliasDeclaration (type alias) | Skipped *(Terisolasi)* | Terbaca Penuh | Diperbaiki |
| TP-U3 | TSEnumDeclaration (enum) | Skipped *(Terisolasi)* | Terbaca Penuh | Diperbaiki |
| TP-U4 | TSModuleDeclaration (namespace) | Skipped *(Terisolasi)* | Terbaca Penuh | Diperbaiki |
| TP-U5 | Node JS biasa (identifier, variable) | Terbaca Penuh | Terbaca Penuh | Lulus |
| — | **Keterbacaan Traversal Analyzer** | **20.0%** | **100.0%** | **Optimal** |

Hasil Uji 1 membuktikan bahwa Acorn gagal total pada sintaks TS tingkat lanjut. Uji 2 mengungkap masalah arsitektural yang lebih sunyi: bahkan ketika *parsing* berhasil (seperti pada TS dasar), node TypeScript yang dihasilkan tidak dapat ditelusuri oleh *analyzer* karena ketiadaan peta *visitor-keys*. Akibatnya, Mesin Analisis pada Iterasi 2 akan menderita *false negative* jika tetap menggunakan Acorn.

### B. Optimasi Performa — ParseCache (T1-05)

Komponen **ParseCache** diimplementasikan untuk menghindari penguraian ulang berkas yang sama dalam satu sesi analisis. Strategi validasi menggunakan `fs.stat().mtimeMs`: jika stempel waktu modifikasi berkas tidak berubah, AST dikembalikan langsung dari *cache* tanpa *re-parsing*.

```javascript
async get(filePath) {
    if (!this._cache.has(filePath)) return null;
    const { mtime } = await fs.stat(filePath);
    const cached = this._cache.get(filePath);
    if (cached.mtime === mtime) return { ast: cached.ast, code: cached.code }; // HIT
    this._cache.delete(filePath);
    return null; // MISS → re-parsing
}
```

Pada skenario pengujian terhadap proyek skala besar dengan 100+ berkas yang dianalisis dalam satu sesi, ParseCache memberikan dampak yang terukur. Ilustrasi alur kerja dengan dan tanpa *cache*:

1. **Tanpa ParseCache (Baseline Development):**
   <!-- Sisipkan gambar/ilustrasi di sini -->
   
2. **Dengan ParseCache (Baseline Production):**
   <!-- Sisipkan gambar/ilustrasi di sini -->

Dengan *hit rate* sebesar 66,7% pada skenario tiga modul per berkas, sistem menghindari dua pertiga total operasi *parsing* yang seharusnya dilakukan. Hal ini berdampak langsung pada pengurangan latensi eksekusi secara proporsional terhadap kompleksitas proyek yang dianalisis.

### C. Kontrak Antarmuka Final

Modul pengurai dikunci untuk fase *production* dengan tiga kontrak antarmuka yang menjadi fondasi bagi Iterasi 2:

1. Fungsi `parseCode(codeString, filePath, options)` sebagai *entry point* tunggal
2. Kelas `ParseError` sebagai tipe galat yang wajib ditangkap oleh pemanggil
3. Format keluaran AST *ESTree-compatible* yang dapat ditelusuri oleh `estraverse`

---

## Ringkasan Penyelesaian Task Iterasi 1

| ID Task | Deskripsi | Status | Baseline |
|---------|-----------|--------|----------|
| T1-01 | Implementasi fungsi `parseCode()` | ✅ Selesai | Development |
| T1-02 | Konfigurasi opsi parser (`loc: true`) | ✅ Selesai | Development |
| T1-03 | Skenario pengujian JavaScript dasar | ✅ Selesai | Development |
| T1-04 | Pengujian validasi TypeScript/JSX/TSX | ✅ Selesai (memicu T1-06, T1-07) | Development |
| T1-06 | Migrasi engine ke ts-estree | ✅ Selesai | Refactor |
| T1-07 | Penghapusan acorn-typescript | ✅ Selesai | Refactor |
| T1-05 | Implementasi ParseCache | ✅ Selesai | Production |
