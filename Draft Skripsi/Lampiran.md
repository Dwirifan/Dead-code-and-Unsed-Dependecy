# Lampiran

## Lampiran A: Skenario Pengujian Iterasi 1 (Core Parser)

Tabel berikut menyajikan rincian skenario pengujian yang digunakan untuk memvalidasi kemampuan *Core Parser* pada Iterasi 1, baik untuk konstruksi dasar JavaScript maupun kompatibilitas sintaks modern (khususnya TypeScript).

| ID | Skenario yang Diuji | Tujuan Validasi |
|---|---|---|
| TC-01 | `import { format } from 'date-fns'` | Parser mampu membentuk AST dari impor *default* dan terkonstruksi. |
| TC-02 | `import _, { cloneDeep } from 'lodash'` | Parser mampu membaca impor campuran (*default* dan spesifik). |
| TC-03 | `import './global-style.css'` | Parser mampu membaca *side-effect import*. |
| TC-04 | `const GLOBAL_UNUSED = "..."` | Parser mengenali deklarasi variabel global (`const`). |
| TC-05 | `var bocor` di dalam blok `if` | Parser membaca *hoisting* deklarasi `var` di dalam blok. |
| TC-06 | `let tertahan` di dalam blok `if` | Parser membaca deklarasi blok `let`. |
| TC-07 | `const { profil: { nama, umur }, skill: [skillUtama, ...sisaSkill] }` | Parser memecah ekspresi *deep destructuring* dan *spread operator* dengan benar. |
| TC-08 | Parameter `c` pada `function hitung(a, b, c)` | Parser memetakan parameter fungsi ke dalam node `Identifier`. |
| TC-09 | JavaScript & TypeScript Dasar | Parser mampu membaca sintaks JS dan TS dasar tanpa galat. |
| TC-10 | TypeScript 4.1 Template Literal | Parser memproses sintaks *template literal types* pada TypeScript 4.1. |
| TC-11 | Type-Only Export (TS 3.8+) | Parser mampu membaca `export type { ... }` tanpa melemparkan *SyntaxError*. |
| TC-12 | Inline Type Export (TS 4.5+) | Parser memproses sintaks *inline type* seperti `export { type A, B }`. |
| TC-13 | Export Type Star (TS 3.8+) | Parser memproses ekspor tipe bintang seperti `export type * from '...'`. |
| TC-14 | Override keyword (Polymorphism) | Parser membaca kata kunci `override` di depan nama metode kelas. |
| TC-15 | Operator satisfies (TS 4.9+) | Parser membaca dan membentuk AST dari ekspresi `satisfies`. |
| TC-16 | Assignment Non-Null Assertion | Parser memproses penugasan dengan asersi tipe (misalnya `a!.b = c`). |

---

## Lampiran B: Implementasi Penuh `astParser.js` Pasca Perbaikan

Kode berikut merupakan implementasi lengkap dari modul `astParser.js` setelah dilakukannya penambalan (*bug fix*) pada Iterasi 1 yang bermigrasi ke antarmuka `@typescript-eslint/typescript-estree`.

```javascript
import { parse } from '@typescript-eslint/typescript-estree';

/**
 * Konfigurasi standar untuk parser ts-estree.
 * loc, range: menyimpan posisi baris/kolom node.
 * comment: menyimpan node komentar.
 */
const PARSER_OPTIONS = {
    loc: true, 
    range: true, 
    comment: true,
    errorOnUnknownASTType: false, 
    allowHashBang: true
};

/**
 * Kelas error spesifik untuk kegagalan proses parsing.
 */
export class ParseError extends Error {
    constructor(msg, filePath, line, column) {
        super(msg);
        Object.assign(this, { name: 'ParseError', filePath, line, column });
    }
}

/**
 * Membaca kode sumber berupa string dan mengubahnya menjadi bentuk Abstract Syntax Tree (AST).
 *
 * @param {string} codeString Kode sumber JS/TS yang akan di-parse.
 * @param {string} filePath Jalur absolut berkas untuk pencatatan error (opsional).
 * @param {Object} opts Opsi tambahan (opsional).
 * @returns {Object} Node AST dengan root bertipe Program.
 */
export function parseCode(codeString, filePath = 'unknown', opts = {}) {
    try {
        return parse(codeString, { ...PARSER_OPTIONS, filePath, ...opts });
    } catch (e) {
        throw new ParseError(`Gagal mem-parse berkas: ${e.message}`, filePath, e.lineNumber, e.column);
    }
}
```
