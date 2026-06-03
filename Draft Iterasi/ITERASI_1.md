# Iterasi 1: Pengembangan Modul Pengurai (Core Parser)

Iterasi pertama dalam kerangka metodologi PXP berfokus pada pembangunan **Modul Pengurai (Core Parser)** — komponen yang bertanggung jawab atas transformasi kode sumber mentah menjadi representasi *Abstract Syntax Tree* (AST) yang dapat ditelusuri secara programatik. Modul ini menjadi prasyarat mutlak bagi seluruh kemampuan analisis sistem: tanpa pohon sintaksis yang akurat, tidak ada satu pun proses deteksi kode mati yang dapat dijalankan. Iterasi ini dieksekusi melalui tiga baseline PXP yang bersifat sekuensial dan saling bergantung.

## Perencanaan Iterasi (Iteration Planning)

Sebelum tahapan teknis dimulai, ditetapkan target penyelesaian (*User Stories/Tasks*) yang menjadi luaran dari Iterasi 1. Berikut adalah tabel perencanaannya:

| No. | Task / User Story | Komponen | Tujuan | Prioritas |
| :--- | :--- | :--- | :--- | :--- |
| 1 | Pembangunan Purwarupa Modul Pengurai | Core Parser | Menerjemahkan kode sumber JavaScript (`.js`) menjadi AST berformat ESTree-compatible. | Tinggi |
| 2 | Evaluasi Kegagalan Kritis Engine | Testing | Menganalisis batasan dan cacat parsing (terutama pada *visitor keys* TypeScript) menggunakan purwarupa awal. | Tinggi |
| 3 | Migrasi Arsitektur Engine Parser | Core Parser | Mengganti Acorn dengan `typescript-estree` untuk mendukung TypeScript dan JSX/TSX modern. | Tinggi |
| 4 | Implementasi Optimasi ParseCache | Parser Utility | Meningkatkan efisiensi komputasi dengan menyimpan AST berdasarkan `mtime` (waktu modifikasi file). | Menengah |

---

## 1. Baseline Development

Pada tahapan ini, fokus utama adalah membangun purwarupa (*prototype*) fungsi penguraian kode menjadi AST untuk membuktikan pemenuhan kebutuhan fungsional paling dasar: dapatkah sistem mengurai kode JavaScript dan menghasilkan representasi pohon sintaksis yang valid?

### A. Implementasi Logika dan Pemilihan Engine

Engine parser yang dipilih pada fase ini adalah **Acorn versi ^8.15.0** — sebuah JavaScript parser yang telah mapan, bersifat ringan (*lightweight*), dan menghasilkan AST berformat ESTree yang merupakan standar *de facto* ekosistem JavaScript. Acorn dipilih sebagai titik awal berdasarkan dua pertimbangan utama: 
1. Kompatibilitasnya yang penuh dengan spesifikasi ESTree menjamin interoperabilitas dengan pustaka-pustaka traversal seperti `estraverse`.
2. Ukurannya yang kecil meminimalkan *overhead* dependensi pada tahap eksperimentasi awal.

Untuk mengakomodasi proyek yang menggunakan anotasi tipe TypeScript dasar, ditambahkan plugin `acorn-typescript` versi `^1.4.13` sebagai ekstensi superset yang memungkinkan Acorn memproses konstruksi TypeScript sederhana seperti `: string`, `: number`, dan deklarasi tipe *inline*.

Implementasi diwujudkan dalam satu berkas tunggal `src/parser/astParser.js` pada cabang development:

```javascript
// src/parser/astParser.js — Baseline: Development
// Engine  : Acorn v8.15.0 + acorn-typescript v1.4.13
// Commit  : 5006d40 s/d 99d0589
// Branch  : feature/1-modul-parser

import * as acorn from "acorn";
import tsPlugin from "acorn-typescript";

// Bangun instance parser dengan plugin TypeScript terpasang
const parser = acorn.Parser.extend(tsPlugin());

/**
 * Mengurai string kode sumber menjadi Abstract Syntax Tree (AST).
 * @param {string} codeString - Kode sumber yang akan diurai.
 * @returns {object} AST node root (Program) berformat ESTree.
 */
export function parseCode(codeString) {
  try {
    return parser.parse(codeString, {
      ecmaVersion: "latest",  // Dukung sintaks JavaScript modern
      sourceType: "module",   // Aktifkan sintaks import/export
      locations: true,        // Simpan info baris & kolom di setiap node
    });
  } catch (error) {
    throw new Error(`Failed to parse code: ${error.message}`);
  }
}
```

Desain ini bersifat minimalis dan prosedural: fungsi `parseCode` menerima satu argumen berupa string kode sumber, meneruskannya ke instance parser yang telah dikonfigurasi, dan mengembalikan objek AST. Opsi `locations: true` diaktifkan secara khusus untuk menyimpan informasi posisi (baris dan kolom) pada setiap node AST — informasi yang kelak menjadi kunci bagi modul-modul analyzer dalam melaporkan lokasi temuan kepada pengguna secara presisi.

### B. Skenario dan Prosedur Pengujian

Pengujian pada fase development dilakukan menggunakan berkas uji `test/parser/contoh.js` — sebuah berkas JavaScript yang dirancang untuk merepresentasikan kode moderat dengan beragam konstruksi yang relevan dengan deteksi dead code:

| No. | Konstruksi yang Diuji | Tujuan Validasi |
| :--- | :--- | :--- |
| 1 | `import { format } from 'date-fns'` | Impor yang tidak digunakan (*unused import*) |
| 2 | `import _, { cloneDeep } from 'lodash'` | Impor sebagian tidak digunakan (`_` adalah dead) |
| 3 | `import './global-style.css'` | Side-effect import (harus dipertahankan) |
| 4 | `const GLOBAL_UNUSED = "..."` | Variabel global tidak pernah dibaca |
| 5 | `var` bocor di dalam `if` | Perilaku hoisting variabel `var` |
| 6 | `let` tertahan di dalam blok | Variabel berlingkup blok tidak direferensikan |
| 7 | Deep destructuring | Ekstraksi identifier dari destrukturisasi bertingkat |
| 8 | Parameter `c` pada `function hitung(a, b, c)` | Parameter fungsi yang tidak dipakai |

Prosedur pengujian dijalankan melalui skrip `test/parser/test_parser.js` yang membaca berkas uji, mengeksekusi `parseCode()`, dan mendumpingkan hasil AST ke berkas `contoh_ast.json` untuk diperiksa secara manual:

```javascript
// test/parser/test_parser.js — Skrip Pengujian Fase Development
import fs from 'fs';
import path from 'path';
import { parseCode } from '../../src/parser/astParser.js';

const code = fs.readFileSync(targetFile, 'utf-8');

try {
    const ast = parseCode(code);
    fs.writeFileSync(outPath, JSON.stringify(ast, null, 2));
    console.log('✅ BERHASIL!');
    console.log(`AST telah di-generate. Silakan buka file: ${outPath}`);
} catch (err) {
    console.error('❌ GAGAL parsing:', err.message);
}
```

### C. Analisis Output Hasil Baseline

Eksekusi skrip terhadap berkas uji `.js` menghasilkan keluaran konsol berikut:

```text
✅ BERHASIL!
AST (Abstract Syntax Tree) berukuran besar telah di-generate.
Silakan buka file: .../test/parser/contoh_ast.json
```

Berkas `contoh_ast.json` yang dihasilkan berisi representasi pohon sintaksis yang valid dan sesuai dengan spesifikasi ESTree. Berikut cuplikan struktur data AST yang dihasilkan Acorn untuk dua konstruksi pertama pada berkas uji:

```json
{
  "type": "Program",
  "start": 0,
  "end": 1247,
  "sourceType": "module",
  "body": [
    {
      "type": "ImportDeclaration",
      "specifiers": [
        {
          "type": "ImportSpecifier",
          "local":    { "type": "Identifier", "name": "format" },
          "imported": { "type": "Identifier", "name": "format" },
          "start": 9, "end": 15
        }
      ],
      "source": { "type": "Literal", "value": "date-fns", "raw": "'date-fns'" },
      "loc": {
        "start": { "line": 1, "column": 0 },
        "end":   { "line": 1, "column": 38 }
      }
    },
    {
      "type": "VariableDeclaration",
      "kind": "const",
      "declarations": [
        {
          "type": "VariableDeclarator",
          "id":   { "type": "Identifier", "name": "GLOBAL_UNUSED" },
          "init": { "type": "Literal", "value": "Saya tidak berguna" },
          "loc":  { "start": { "line": 4, "column": 6 } }
        }
      ]
    }
  ]
}
```

**Evaluasi:** Untuk berkas JavaScript murni (`.js`), AST yang dihasilkan Acorn terbukti kompatibel penuh dengan spesifikasi ESTree: setiap node memiliki properti `type`, `loc` (lokasi baris/kolom), `start`/`end` (offset karakter), dan struktur hierarki yang benar. Keluaran ini menjadi bukti bahwa kebutuhan fungsional paling dasar pada fase development telah terpenuhi.

---

## 2. Baseline Refactor

Tahapan ini mengevaluasi kegagalan yang ditemukan pada fungsi dasar di baseline development, melakukan perbaikan arsitektur, dan memigrasikan teknologi core demi mendukung skala proyek JavaScript modern.

### A. Identifikasi Kegagalan Kritis (Blocking Errors)

Setelah pengujian terhadap proyek berbasis TypeScript modern, ditemukan dua kegagalan fundamental yang bersifat berlapis dan saling memperburuk satu sama lain:

#### Kegagalan Kritis 1 — AST Terisolasi (Un-traversable TS Nodes)
Acorn (beserta plugin `acorn-typescript`) memang dapat mem-parse sebagian besar berkas TypeScript dan menghasilkan node TypeScript-spesifik seperti `TSInterfaceDeclaration` atau `TSTypeAliasDeclaration`. Namun, AST yang dihasilkan **tidak dilengkapi dengan visitor keys standar ESLint/ESTree**.

Dampaknya langsung terasa pada tahap analisis: ketika pustaka `estraverse` mencoba menelusuri pohon sintaksis tersebut, ia tidak tahu properti mana yang berisi struktur child node. Akibatnya, traversal berhenti di permukaan node tipe tersebut, dan seluruh identifier di dalamnya sama sekali tidak pernah dikunjungi. Modul analyzer secara diam-diam melewatkan seluruh deklarasi dan referensi tipe TypeScript tanpa memberikan galat apa pun. Inilah yang disebut **false negative** — kondisi yang jauh lebih berbahaya dari error, karena sistem terkesan berjalan normal padahal kehilang puluhan variabel dan tipe.

#### Kegagalan Kritis 2 — Pengecekan Semantik Ilegal dan Gagal Membaca Sintaks Modern
Acorn (`acorn-typescript`) memiliki cacat arsitektural yang fatal: engine ini mencoba melakukan pengecekan semantik (seperti memastikan variabel eksis) pada fase parsing. Akibatnya, mengekspor tipe abstrak murni (`export type { UserProfile }`) langsung crash karena parser mengira itu adalah variabel normal yang tidak dideklarasikan.

Selain itu, sintaks TypeScript tingkat lanjut seperti `override` atau `satisfies` (TS 4.9+) menyebabkan proses berhenti total dengan membuang SyntaxError:

```text
[TC-05] Type-Only Export (TS 3.8+)
❌ GAGAL PARSING: Failed to parse code: Export 'UserProfile' is not defined (5:14)

[TC-09] Operator satisfies (TS 4.9+)
❌ GAGAL PARSING: Failed to parse code: Unexpected token (9:2)
```

**Konsekuensi strategis:** Sistem menghadapi dua masalah sekaligus — pada sintaks TS lama ia diam-diam tidak akurat, dan pada sintaks TS tingkat lanjut ia gagal total. Ini menjadikan Acorn tidak layak sebagai fondasi modul pengurai untuk proyek TypeScript kelas production, sehingga keputusan diambil untuk melakukan migrasi penuh terhadap engine parser.

### B. Justifikasi Migrasi dan Perubahan Dependensi

Engine parser diganti menjadi `@typescript-eslint/typescript-estree` versi `^8.58.2` — parser resmi dari ekosistem TypeScript-ESLint yang mendukung secara *native*: seluruh sintaks TypeScript termasuk fitur lanjutan, JSX dan TSX secara penuh, serta berkas `.js`, `.jsx`, `.ts`, `.tsx`, `.mjs`, dan `.cjs`.

Perubahan dependensi ini terdokumentasi secara eksplisit pada commit `f86458b` melalui diff berkas `package.json`:

```diff
 "dependencies": {
-   "acorn": "^8.15.0",
-   "acorn-typescript": "^1.4.13",
+   "@typescript-eslint/typescript-estree": "^8.58.2",
    "chalk": "^5.6.2",
    "commander": "^14.0.2",
    "diff": "^8.0.3",
    "escodegen": "^2.1.0",
    "estraverse": "^5.3.0",
    "fast-glob": "^3.3.3",
    "fs-extra": "^11.3.3",
    "inquirer": "^12.11.1"
  }
```

Penghapusan `acorn` dan `acorn-typescript` bersifat permanen — keduanya tidak lagi dibutuhkan karena `@typescript-eslint/typescript-estree` menyediakan seluruh kapabilitasnya sekaligus dengan dukungan yang jauh lebih komprehensif.

### C. Implementasi Perbaikan Kode (Refactored Code)

Migrasi engine membawa perombakan arsitektur substansial pada `src/parser/astParser.js`. Tiga peningkatan struktural utama diimplementasikan:

1. **Konstanta PARSER_OPTIONS** — konfigurasi parser diekstrak ke objek terpisah, memisahkan konfigurasi dari logika fungsi demi keterbacaan dan kemudahan perawatan.
2. **Kelas ParseError khusus** — menggantikan Error generik, menyimpan konteks galat yang kaya: path berkas, nomor baris, dan nomor kolom sumber galat.
3. **Parameter filePath** — diteruskan ke parser untuk resolusi konteks TypeScript yang lebih akurat dan pesan galat yang lebih informatif.

```javascript
// src/parser/astParser.js — Baseline: Refactor
// Engine  : @typescript-eslint/typescript-estree v8.58.2
// Commit  : f86458b s/d fd56937
// Branch  : feature/1-modul-parser

import { parse } from '@typescript-eslint/typescript-estree';

// Konfigurasi parser yang dipisahkan dari logika fungsi
const PARSER_OPTIONS = {
    loc: true,
    range: true,
    jsx: true,                    // ← Aktifkan dukungan JSX/TSX secara native
    comment: true,
    errorOnUnknownASTType: false,
    allowHashBang: true,          // ← Shebang (#!/usr/bin/env node) tidak error
};

/**
 * Kelas galat khusus dengan konteks lokasi yang kaya.
 * Menggantikan Error generik untuk pesan yang lebih informatif.
 */
export class ParseError extends Error {
    constructor(message, filePath, line, column) {
        super(message);
        this.name = 'ParseError';
        this.filePath = filePath;  // ← Path berkas sumber galat
        this.line = line;          // ← Baris tempat galat terjadi
        this.column = column;      // ← Kolom tempat galat terjadi
    }
}

/**
 * Mengurai string kode sumber menjadi AST berformat ESTree-compatible.
 * @param {string} codeString - Kode sumber yang akan diurai.
 * @param {string} [filePath]  - Path berkas (untuk konteks TypeScript & error).
 * @param {object} [options]   - Opsi tambahan untuk menimpa konfigurasi default.
 * @returns {object} AST node root (Program).
 * @throws {ParseError} Jika parsing gagal karena sintaks tidak valid.
 */
export function parseCode(codeString, filePath = 'unknown', options = {}) {
    if (typeof codeString !== 'string') {
        throw new Error(
            `[Internal Error] parseCode: input harus string. Path: ${filePath}`
        );
    }

    try {
        return parse(codeString, { ...PARSER_OPTIONS, filePath, ...options });
    } catch (error) {
        throw new ParseError(
            `Gagal parsing kode: ${error.message}`,
            filePath,
            error.lineNumber || null,
            error.column    || null
        );
    }
}
```

### D. Komparasi Kompatibilitas AST

Perbedaan paling signifikan antara keluaran kedua engine terlihat pada kemampuan merepresentasikan node TypeScript dan kompabilitasnya dengan pustaka analyzer. Pada implementasi Acorn, tidak terdapat dukungan `@typescript-eslint/visitor-keys`.

- **Dampak pada Acorn (Engine Lama):** Ketika `estraverse` mencoba menelusuri node seperti `TSInterfaceDeclaration`, ia tidak tahu properti mana yang berisi child nodes (karena ketiadaan visitor keys). Akibatnya, traversal berhenti di permukaan node tersebut, dan identifier di dalamnya tidak pernah dievaluasi. Modul analyzer mengabaikan keberadaan tipe tersebut, yang berujung pada lolosnya dead code (False Negative).

- **Solusi pada @typescript-eslint/typescript-estree (Engine Baru):** Engine baru terintegrasi secara native dengan pustaka `estraverse` melalui visitor-keys bawaan ekosistem ESLint. AST yang dihasilkan kaya akan struktur spesifik seperti `TSTypeAnnotation`, `TSInterfaceDeclaration`, dan `TSEnumDeclaration`, yang mana seluruh child nodes-nya dapat ditelusuri dengan sempurna. Kehadiran struktur inilah yang memungkinkan analyzer mendeteksi referensi tipe dengan tingkat kepercayaan (*confidence*) tinggi.

---

## 3. Baseline Production

Tahapan akhir ini berfokus pada stabilisasi komponen, pengujian integrasi fungsional menyeluruh, dan penambahan fitur optimasi performa sebelum kode dikunci untuk rilis stabil.

### A. Matriks Validasi Kemampuan Parser

Setelah migrasi ke `@typescript-eslint/typescript-estree`, dilakukan dua jenis pengujian untuk memvalidasi keberhasilan secara komprehensif:

#### Uji 1 — Kemampuan Parsing Sintaks Lanjutan (Success Rate)
Memvalidasi apakah engine mampu menghasilkan AST dari berbagai jenis sintaks tanpa error. Pengujian ini difokuskan pada 10 skenario stress-test yang merepresentasikan struktur kode aplikasi production:

| Skenario | Fokus Pengujian | Acorn (Development) | TS-Estree (Production) |
| :--- | :--- | :--- | :--- |
| TC-01 | JavaScript & TypeScript Dasar | ✅ Berhasil | ✅ Berhasil |
| TC-02 | JSX — React Components | ✅ Berhasil | ✅ Berhasil |
| TC-03 | TSX — React Component dengan Generic Props | ✅ Berhasil | ✅ Berhasil |
| TC-04 | TypeScript 4.1 — Template Literal Types | ✅ Berhasil | ✅ Berhasil |
| TC-05 | Type-Only Export (TS 3.8+) | ❌ Gagal (Export undefined) | ✅ Berhasil |
| TC-06 | Inline Type Export (TS 4.5+) | ❌ Gagal (Export undefined) | ✅ Berhasil |
| TC-07 | Export Type Star (TS 3.8+) | ❌ Gagal (Unexpected token) | ✅ Berhasil |
| TC-08 | Override keyword pada Polymorphism | ❌ Gagal (Extends error) | ✅ Berhasil |
| TC-09 | Operator satisfies (TS 4.9+) | ❌ Gagal (Unexpected token) | ✅ Berhasil |
| TC-10 | Assignment ke Non-Null Assertion | ❌ Gagal (Assign to rvalue) | ✅ Berhasil |
| - | **Success Rate Parsing Keseluruhan** | **40.0%** | **100.0%** |

#### Uji 2 — Keterbacaan Traversal AST oleh Estraverse (Dampak ke Analyzer)
Memvalidasi apakah node TypeScript yang dihasilkan parser dapat ditelusuri (di-traverse) hingga ke child-node terdalam oleh modul analyzer menggunakan `estraverse`:

| No. | Skenario | Acorn | TS-Estree | Ket. |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `TSInterfaceDeclaration` (interface) | ❌ Skipped (Terisolasi) | ✅ Terbaca Penuh | 🔧 Diperbaiki |
| 2 | `TSTypeAliasDeclaration` (type alias) | ❌ Skipped (Terisolasi) | ✅ Terbaca Penuh | 🔧 Diperbaiki |
| 3 | `TSEnumDeclaration` (enum) | ❌ Skipped (Terisolasi) | ✅ Terbaca Penuh | 🔧 Diperbaiki |
| 4 | `TSModuleDeclaration` (namespace) | ❌ Skipped (Terisolasi) | ✅ Terbaca Penuh | 🔧 Diperbaiki |
| 5 | Node JS biasa (identifier, variable) | ✅ Terbaca Penuh | ✅ Terbaca Penuh | ✅ Lulus |
| - | **Keterbacaan Traversal Analyzer** | **20.0%** | **100.0%** | 🚀 Optimal |

Hasil Uji 1 membuktikan bahwa Acorn gagal total pada sintaks TS tingkat lanjut. Uji 2 mengungkap masalah arsitektural yang lebih sunyi: bahkan ketika parsing berhasil (seperti pada TS dasar), node TypeScript yang dihasilkan tidak dapat ditelusuri oleh analyzer karena ketiadaan peta visitor-keys. Akibatnya, modul analisis pada iterasi berikutnya akan menderita false negative jika tetap menggunakan Acorn.

### B. Optimasi Arsitektur (Performance Enhancement)

Pengujian terhadap proyek berskala nyata mengungkap inefisiensi yang sebelumnya tidak tampak pada pengujian berkas tunggal: dalam satu sesi analisis proyek dengan banyak berkas, modul-modul analyzer yang berbeda berpotensi meminta parsing berkas yang sama secara berulang — sebuah pemborosan komputasi yang tumbuh secara linier seiring jumlah berkas.

Sebagai respons, komponen `ParseCache` dibangun dan ditambahkan ke modul parser pada transisi menuju production. `ParseCache` menggunakan strategi validasi berbasis `fs.stat().mtimeMs` (modified time dalam milidetik): alih-alih membaca ulang isi berkas untuk mendeteksi perubahan, sistem hanya memeriksa stempel waktu modifikasi berkas — operasi yang secara signifikan lebih ringan. Jika `mtimeMs` tidak berubah sejak terakhir di-cache, AST yang tersimpan dikembalikan langsung tanpa proses re-parsing.

```javascript
// src/parser/parseCache.js — Baseline: Production
import fs from 'fs-extra';

/**
 * Sistem Cache AST Berbasis Modified Time (mtime).
 *
 * Menyimpan hasil parsing AST di memori selama satu sesi scan/fix.
 * Jika file belum berubah sejak terakhir kali di-cache (berdasarkan mtime),
 * AST yang sudah di-parse sebelumnya akan digunakan kembali.
 *
 * Keuntungan:
 *   - Menghindari parsing ulang file yang sama di satu sesi
 *   - Mempercepat analisis pada proyek besar (>100 file)
 *   - Overhead memori minimal (AST disimpan per sesi, bukan ke disk)
 *
 * Keterbatasan:
 *   - Cache hanya berlaku dalam satu sesi (tidak persisten ke disk)
 *   - Cocok untuk mode scan dan fix yang membaca banyak file sekaligus
 */
export class ParseCache {
    constructor() {
        /**
         * Map dari filePath -> { mtime: number, ast: object, code: string }
         * @type {Map<string, { mtime: number, ast: object, code: string }>}
         */
        this._cache = new Map();
        this._hits = 0;
        this._misses = 0;
    }

    /**
     * Mengambil AST dan kode dari cache jika file belum berubah.
     *
     * @param {string} filePath - Path absolut file
     * @returns {Promise<{ ast: object, code: string } | null>} Cache hit atau null
     */
    async get(filePath) {
        if (!this._cache.has(filePath)) {
            this._misses++;
            return null;
        }

        try {
            const stat = await fs.stat(filePath);
            const currentMtime = stat.mtimeMs;
            const cached = this._cache.get(filePath);

            if (cached.mtime === currentMtime) {
                this._hits++;
                return { ast: cached.ast, code: cached.code };
            }
        } catch (_) {
            // File mungkin sudah dihapus
        }

        // File berubah — invalidasi cache
        this._cache.delete(filePath);
        this._misses++;
        return null;
    }

    /**
     * Menyimpan AST dan kode ke cache.
     *
     * @param {string} filePath - Path absolut file
     * @param {object} ast - Abstract Syntax Tree hasil parsing
     * @param {string} code - Source code string
     */
    async set(filePath, ast, code) {
        try {
            const stat = await fs.stat(filePath);
            this._cache.set(filePath, {
                mtime: stat.mtimeMs,
                ast,
                code
            });
        } catch (_) {
            // Gagal baca stat — skip caching
        }
    }

    /**
     * Mengembalikan statistik penggunaan cache.
     * @returns {{ hits: number, misses: number, size: number, hitRate: string }}
     */
    getStats() {
        const total = this._hits + this._misses;
        const hitRate = total > 0 ? ((this._hits / total) * 100).toFixed(1) : '0.0';
        
        return {
            hits: this._hits,
            misses: this._misses,
            size: this._cache.size,
            hitRate: `${hitRate}%`
        };
    }

    /**
     * Mengosongkan seluruh cache.
     */
    clear() {
        this._cache.clear();
        this._hits = 0;
        this._misses = 0;
    }
}
```

### C. Cuplikan Kode Final Stabil

Berikut adalah bentuk akhir yang stabil dari `src/parser/astParser.js` setelah seluruh proses development dan refactor selesai dijalani. Berkas ini merupakan entry point tunggal Modul Pengurai yang dikunci pada fase production:

```javascript
// src/parser/astParser.js — Baseline: Production (Versi Final Stabil)
// Engine  : @typescript-eslint/typescript-estree v8.58.2
// Commit  : fd56937 (Pengembangan Modul Pengurai)
// Branch  : feature/1-modul-parser → production

import { parse } from '@typescript-eslint/typescript-estree';

/**
 * Konfigurasi parser yang dipisahkan dari logika fungsi.
 * Mendukung penuh: JS, TS, JSX, TSX, Shebang.
 */
const PARSER_OPTIONS = {
    loc: true,                    // Simpan posisi baris & kolom tiap node
    range: true,                  // Simpan offset karakter start/end
    jsx: true,                    // Aktifkan parsing JSX dan TSX
    comment: true,                // Sertakan komentar dalam AST
    errorOnUnknownASTType: false, // Toleran terhadap node TypeScript baru
    allowHashBang: true,          // Izinkan shebang #!/usr/bin/env node
};

/**
 * Kelas galat khusus parser dengan konteks lokasi yang kaya.
 * Menggantikan Error generik agar debugging lebih informatif.
 */
export class ParseError extends Error {
    constructor(message, filePath, line, column) {
        super(message);
        this.name     = 'ParseError';
        this.filePath = filePath;  // Path berkas sumber galat
        this.line     = line;      // Baris tempat galat terjadi
        this.column   = column;    // Kolom tempat galat terjadi
    }
}

/**
 * Mengurai string kode sumber menjadi AST berformat ESTree-compatible.
 *
 * @param {string} codeString       - Kode sumber yang akan diurai.
 * @param {string} [filePath]       - Path berkas (untuk konteks TS & pesan error).
 * @param {object} [options]        - Opsi tambahan untuk menimpa konfigurasi default.
 * @returns {object}                  AST node root (Program).
 * @throws {ParseError}               Jika parsing gagal karena sintaks tidak valid.
 */
export function parseCode(codeString, filePath = 'unknown', options = {}) {
    if (typeof codeString !== 'string') {
        throw new Error(
            `[Internal Error] parseCode: input harus string kode sumber. Path: ${filePath}`
        );
    }

    try {
        return parse(codeString, { ...PARSER_OPTIONS, filePath, ...options });
    } catch (error) {
        throw new ParseError(
            `Gagal parsing kode: ${error.message}`,
            filePath,
            error.lineNumber || null,
            error.column     || null
        );
    }
}
```

Versi final ini menetapkan tiga kontrak antarmuka yang dipatuhi oleh seluruh modul pada iterasi berikutnya: (1) fungsi `parseCode(codeString, filePath, options)` sebagai entry point tunggal, (2) kelas `ParseError` sebagai tipe galat yang wajib ditangkap (catch) oleh pemanggil, dan (3) format keluaran AST berformat ESTree-compatible yang kompatibel dengan pustaka traversal `estraverse`.

### D. Dampak Performansi Akhir

Pada skenario pengujian terhadap proyek skala besar dengan 100+ berkas yang dianalisis dalam satu sesi, ParseCache memberikan dampak yang terukur. Ilustrasi alur kerja dengan dan tanpa cache:

**Tanpa ParseCache (Baseline Development):**
```text
Sesi analisis 100 berkas:
  Berkas A.js di-parse oleh: deadCodeAnalyzer, graphBuilder, dependencyAnalyzer
  → 3× parse untuk berkas yang sama
  Total parse calls: 100 berkas × 3 modul = 300 operasi parsing
```

**Dengan ParseCache (Baseline Production):**
```text
Sesi analisis 100 berkas:
  Berkas A.js di-parse pertama kali → disimpan ke cache
  Modul ke-2 dan ke-3 → cache hit, langsung dikembalikan
  Total parse calls: 100 berkas × 1 = 100 operasi parsing

Statistik cache akhir sesi (getStats()):
  {
    hits   : 200,        ← Parsing yang berhasil dihemat
    misses : 100,        ← Parsing pertama untuk setiap berkas
    size   : 100,        ← Jumlah berkas unik dalam cache
    hitRate: "66.7%"     ← Dua pertiga operasi parsing dihemat
  }
```

Dengan *hit rate* sebesar 66,7% pada skenario tiga modul per berkas, sistem menghindari dua pertiga total operasi parsing yang seharusnya dilakukan — berdampak langsung pada pengurangan latensi eksekusi yang proporsional terhadap kompleksitas proyek yang dianalisis.

---

## Ringkasan Iterasi 1

| Baseline | Aktivitas Utama | Hasil yang Dicapai |
| :--- | :--- | :--- |
| **Development** | Implementasi parser Acorn; pengujian berkas `.js`; validasi format AST ESTree | Parser fungsional; AST valid untuk JavaScript murni |
| **Refactor** | Identifikasi kegagalan parsing (*blocking error*) pada JSX, TSX, dan TS Modern; migrasi ke `ts-estree`; penambahan `ParseError` | Parsing berhasil 100% pada semua varian sintaks modern dan JSX |
| **Production** | Validasi kemampuan parsing dengan 6 skenario murni; pembangunan `ParseCache` berbasis `mtime` | *Success rate* parsing 100%; *hit rate* cache 66,7% pada pengujian skala besar |

Modul Pengurai yang dihasilkan pada iterasi ini — `astParser.js` dan `parseCache.js` — menjadi kontrak antarmuka bersama yang digunakan oleh semua modul pada iterasi berikutnya: setiap analyzer, graph builder, dan eliminator bergantung pada keluaran `parseCode()` sebagai titik masuk tunggal untuk seluruh operasi analisis kode.
