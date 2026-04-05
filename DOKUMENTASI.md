# 📖 Dokumentasi Proyek: DeadKiller CLI

> Alat eliminasi dead code dan unused dependency otomatis untuk proyek JavaScript/TypeScript.
> Dibuat sebagai bagian dari Tugas Akhir menggunakan pendekatan **Graph-Based Reachability Analysis** + **Scope-Aware AST Analysis**.

---

## 📂 Struktur Direktori

```
.
├── bin/
│   └── dce-cli.js                    # Entry point CLI — mengatur semua command
├── src/
│   ├── parser/
│   │   └── astParser.js              # Konversi source code → AST (Acorn + TypeScript)
│   ├── analyzer/
│   │   ├── projectGraph.js           # BFS Graph builder — inti reachability analysis
│   │   ├── graphVisualizer.js        # Generator diagram Mermaid (.mmd)
│   │   ├── deadcode/
│   │   │   ├── deadCodeAnalyzer.js   # Detektor dead code utama (scope + branch analysis)
│   │   │   ├── scope.js              # Kelas Scope (Scope Tree chain)
│   │   │   └── utils.js              # Helper isReference()
│   │   └── dependency/
│   │       └── dependencyAnalyzer.js # Standalone detektor unused dependencies
│   └── eliminator/
│       ├── codeCleaner.js            # Hapus dead code dari AST → regenerasi kode
│       ├── dependencyCleaner.js      # Hapus entry dari package.json
│       └── diffGenerator.js          # Preview diff berwarna di terminal
├── test/
│   ├── run-tests.js                  # Automated test runner (7 test suites, 41 assertions)
│   ├── dead_branch.js                # File demo dead branch manual
│   ├── single_scan_test.js           # File dummy untuk uji single-file scan
│   ├── test-metrics/                 # Proyek dummy untuk uji mode fix & metrics
│   ├── test-destructuring/           # Test project: destructuring support
│   ├── test-var-scope/               # Test project: var vs let/const scope
│   └── test-typescript/              # Test project: TypeScript file support
├── test_scope/                       # Proyek dummy multi-file untuk uji graph analysis
│   ├── index.js                      # Entry point test_scope
│   ├── fileA.js, fileB.js            # File yang saling import
│   ├── logger.js                     # File dengan export used & unused
│   └── dynamic.js                    # File dengan dynamic import
├── index.js                          # Dummy manual test (bukan bagian CLI)
├── package.json
├── readme.md
└── DOKUMENTASI.md
```

---

## 🧠 Alur Kerja Keseluruhan

```
Pengguna → CLI (dce-cli.js)
              │
              ├──[scan/fix]──► buildProjectGraph() ──► BFS dari entry point
              │                      │
              │              ┌───────┴────────┐
              │              ▼                ▼
              │         Deteksi import    Bailout Heuristics
              │         (liveFiles,       (eval, with, obj[dynamicKey])
              │          usedPackages)
              │              │
              │    ┌─────────┴────────────┐
              │    ▼                      ▼
              │ deadCodeAnalyzer()   Inline dependency check
              │ (Scope Tree → DCE)   (graph.usedPackages vs package.json)
              │
              ├──[fix]──► diffGenerator() → Tampil diff berwarna
              │           · Konfirmasi user (Inquirer)
              │           · codeCleaner()       → Tulis file bersih ke disk
              │           · dependencyCleaner() → Update package.json
              │           · Cetak Impact Metrics (LOC, KB, ms)
              │
              └──[visualize]──► generateMermaidGraph() → project-graph.mmd
```

---

## 📋 Penjelasan Per File (Lengkap)

---

### `bin/dce-cli.js` — Entry Point CLI

**Kegunaan:** Titik masuk utama seluruh aplikasi. Mengatur semua perintah CLI menggunakan library `commander`. Setiap command memanggil fungsi-fungsi dari modul `src/`.

**Commands yang tersedia:**

| Command             | Deskripsi                                      |
| ------------------- | ---------------------------------------------- |
| `scan <path>`       | Pindai, tampilkan laporan, tanpa mengubah file |
| `fix <path>`        | Pindai → preview diff → konfirmasi → eksekusi  |
| `show-deps <path>`  | Tampilkan semua dependencies di `package.json` |
| `visualize <path>`  | Generate diagram Mermaid dependensi proyek     |

**Alur `scan`:**
1. Deteksi apakah path adalah file tunggal atau direktori
2. **Single file** → parse langsung → jalankan `findDeadCode()` → cetak laporan
3. **Direktori** → `buildProjectGraph()` → deteksi unused deps, dead files, dead code di live files
4. Cetak laporan + waktu analisis (`performance.now()`)

**Alur `fix`:**
1. `buildProjectGraph()` → analisis semua issue
2. Kalkulasi LOC & ukuran file di memori (sebelum & sesudah) menggunakan `Buffer.byteLength()`
3. Tampilkan diff berwarna via `generateDiff()` + warning untuk unsafe files
4. Prompt interaktif: checkbox untuk pilih deps yang dihapus (`inquirer`)
5. Prompt konfirmasi: `Are you sure you want to apply these physical changes?`
6. Eksekusi: `removeUnusedDependencies()` → `fs.remove()` → `fs.writeFile()`
7. Cetak `📊 Impact Metrics` (LOC removed, KB saved, execution time)

**Alur `show-deps`:**
- Baca `package.json` → cetak `dependencies` dan `devDependencies` dalam format berwarna

**Alur `visualize`:**
- `buildProjectGraph()` → `generateMermaidGraph()` → tulis ke `project-graph.mmd`

**Glob pattern yang digunakan:** `**/*.{js,mjs,cjs,ts,tsx,mts}` (mendukung TypeScript)

---

### `src/parser/astParser.js` — Parser AST

**Kegunaan:** Satu-satunya modul yang mengubah string source code (JS atau TS) menjadi Abstract Syntax Tree (AST). Dipanggil oleh hampir semua modul lain.

**Library:** `acorn` (parser JS) + `acorn-typescript` (plugin TypeScript)

**Functions:**

| Fungsi | Signature | Deskripsi |
|--------|-----------|-----------|
| `parseCode` | `parseCode(codeString: string): AST` | Parse string kode menjadi AST. Melempar `Error` jika gagal parse. |

**Konfigurasi Parser:**

| Opsi | Nilai | Efek |
|------|-------|------|
| `ecmaVersion` | `"latest"` | Mendukung sintaks ES2022+ termasuk `import()` dinamis |
| `sourceType` | `"module"` | Mendukung `import`/`export` ESM |
| `locations` | `true` | Setiap node AST menyimpan `.loc.start.line` untuk pelaporan baris |

**Dipanggil oleh:** `dce-cli.js`, `projectGraph.js`, `dependencyAnalyzer.js`, `test/run-tests.js`

---

### `src/analyzer/projectGraph.js` — Graph Builder (Inti BFS)

**Kegunaan:** Membangun peta ketergantungan seluruh proyek dari entry point menggunakan Breadth-First Search (BFS). Menentukan file mana yang "hidup" (live) dan mana yang tidak terjangkau (dead).

**Input:** `projectRoot: string` (path absolut root proyek)

**Output:** `{ liveFiles: Set, usedPackages: Set, edges: Array, unsafeFiles: Set, globalRegistry: Object }`

**Functions:**

| Fungsi | Signature | Deskripsi |
|--------|-----------|-----------|
| `resolvePath` *(private)* | `resolvePath(baseDir, relativeImport): Promise<string\|null>` | Resolusi path import ke path absolut. Mencoba ekstensi `.js`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, `.json`, lalu fallback ke `index.js` di dalam folder |
| `buildProjectGraph` | `buildProjectGraph(projectRoot): Promise<GraphResult>` | Fungsi utama: bangun seluruh graph dari entry point via BFS |

**Langkah-langkah `buildProjectGraph()`:**

1. **Deteksi Entry Point** → Baca `package.json` (field `main` & `bin`). Fallback ke `index.js`, `main.js`, `src/index.js`, `app.js`, `server.js`
2. **BFS Queue** → Mulai dari entry point, proses satu file, tambahkan file-file yang di-import ke antrian
3. **Single AST Pass** per file — satu traversal `estraverse` menangani 3 hal sekaligus:
   - 🚨 **Bailout Heuristics:** Tandai `unsafeFiles` jika ada `eval()`, `with`, atau `obj[dynamicKey]` (bukan `obj[0]` atau `obj['key']`)
   - 📦 **Import Tracking:** Pisahkan import lokal (relative `./`) → masuk BFS queue, vs package (npm) → masuk `usedPackages`
   - 📝 **Import variasi:** Mendukung `import`, `require()`, `export ... from`, dan `import()` dinamis (template literals statis)
4. **Resolusi Path** via `resolvePath()` untuk tiap import lokal
5. **`globalRegistry`** → Rekam `usedExports` per file (nama export mana yang digunakan file lain)
6. **Sweep Phase** → Rekonsiliasi `exports` vs `usages` untuk update `isUnused`

**Output penting:**

| Field | Tipe | Isi |
|-------|------|-----|
| `liveFiles` | `Set<string>` | Path absolut semua file yang bisa dicapai dari entry |
| `usedPackages` | `Set<string>` | Nama paket npm yang di-import dalam graph |
| `edges` | `Array<{from, to}>` | Semua relasi impor antar file |
| `unsafeFiles` | `Set<string>` | File yang mengandung kode dinamis |
| `globalRegistry` | `Object` | `{ usedExports: Map, exports: Map, usages: Set }` untuk cross-file DCE |

**File yang TIDAK masuk `liveFiles` = Dead Files (file sampah/yatim)**

---

### `src/analyzer/deadcode/scope.js` — Kelas Scope

**Kegunaan:** Implementasi **Scope Tree** yang merepresentasikan hierarki cakupan variabel JavaScript. Setiap block, function, atau global memiliki instance Scope tersendiri yang terhubung ke parent-nya.

```
Global Scope
  └── Function Scope   (function foo() → scope baru)
        └── Block Scope  (if/for/while dengan let/const → scope baru)
```

**Class: `Scope`**

| Method | Signature | Deskripsi |
|--------|-----------|-----------|
| `constructor` | `new Scope(parent?)` | Buat scope baru. `parent` adalah scope induk (null untuk global scope) |
| `addDeclaration` | `addDeclaration(name, type, line, node)` | Daftarkan variabel/fungsi/parameter ke scope ini. Hanya tambah jika belum ada (mencegah duplikat) |
| `addReference` | `addReference(name)` | Catat bahwa identifier `name` digunakan di scope ini (dicatat ke array `references`) |
| `resolve` | `resolve()` | Jalankan `markUsed()` untuk semua referensi yang sudah dicatat. Dipanggil di akhir analisis |
| `markUsed` | `markUsed(name)` | Tandai deklarasi `name` sebagai `used: true`. Jika tidak ada di scope ini, **naik ke parent** (implementasi scope chain JavaScript!) |

**Properti:**

| Properti | Tipe | Isi |
|----------|------|-----|
| `parent` | `Scope \| null` | Referensi ke scope induk |
| `declarations` | `Map<string, {type, line, node, used}>` | Semua deklarasi di scope ini |
| `references` | `Array<string>` | Nama identifier yang digunakan di scope ini |

---

### `src/analyzer/deadcode/utils.js` — Helper `isReference()`

**Kegunaan:** Menjawab satu pertanyaan kritis saat traversal AST: **"Apakah kemunculan identifier ini adalah penggunaan (referensi), atau sekadar nama deklarasi?"**

Tanpa ini, nama fungsi saat dideklarasikan `function foo() {}` akan salah dihitung sebagai "terpakai sekaligus", dan destructuring `const { a, b } = obj` akan menganggap `a` dan `b` sudah "dipakai" saat dideklarasikan.

**Functions:**

| Fungsi | Signature | Deskripsi |
|--------|-----------|-----------|
| `isReference` | `isReference(node, parent, grandParent?): boolean` | Kembalikan `true` jika node Identifier ini adalah referensi (penggunaan), bukan deklarasi |

**Kasus yang difilter (bukan referensi = return `false`):**

| Konteks | Contoh | Alasan |
|---------|--------|--------|
| Sisi kiri `VariableDeclarator` | `const x = 1` → `x` | Deklarasi, bukan pemakaian |
| Nama `FunctionDeclaration` | `function foo() {}` → `foo` | Deklarasi fungsi |
| Key `Property` (non-computed) | `{ key: val }` → `key` | Nama properti objek literal |
| Property dalam `ObjectPattern` | `const { age } = obj` → `age` sbg value | Deklarasi destructuring (butuh `grandParent` context) |
| Elemen `ArrayPattern` | `const [a, b] = arr` → `a`, `b` | Deklarasi destructuring array |
| `RestElement` | `const { ...rest } = obj` → `rest` | Deklarasi rest |
| `AssignmentPattern` kiri | `const { x = 10 } = obj` → `x` | Deklarasi default value |
| Import specifier | `import { foo } from '...'` → `foo` | Deklarasi import |
| Export specifier | `export { foo }` → `foo` (exported name) | Nama re-export |
| Nama class | `class Foo {}` → `Foo` | Deklarasi class |
| Catch clause param | `catch (e)` → `e` | Deklarasi parameter catch |
| Sisi kiri `for...in/of` | `for (x of arr)` → `x` | Deklarasi loop variable |
| Label statement | `label:` / `break label` | Label bukan variabel |
| Method key | `{ method() {} }` → `method` | Nama method |
| Property statis `MemberExpression` | `obj.prop` → `prop` | Properti statis objek |

---

### `src/analyzer/deadcode/deadCodeAnalyzer.js` — Detektor Dead Code Utama

**Kegunaan:** Menganalisis AST satu file untuk menemukan semua dead code: variabel/fungsi tidak dipakai, branch yang tidak bisa dicapai, dan statement setelah terminator.

**Dependencies:** `Scope` (scope.js), `isReference` (utils.js), `estraverse`

**Functions (internal):**

| Fungsi | Signature | Deskripsi |
|--------|-----------|-----------|
| `extractIdentifiers` *(private)* | `extractIdentifiers(pattern): Array<{name, node}>` | Rekursif ekstrak semua nama dari pattern destructuring. Mendukung `Identifier`, `ObjectPattern`, `ArrayPattern`, `RestElement`, `AssignmentPattern` |
| `findFunctionScope` *(private)* | `findFunctionScope(scopeStack, scopeTypeStack): Scope` | Cari scope function atau global terdekat dalam stack. Digunakan untuk registrasi `var` yang harus function-scoped, bukan block-scoped |
| `analyzeDeadCodeRevised` *(private, diekspor sebagai `findDeadCode`)* | `analyzeDeadCodeRevised(ast, fileName?, globalRegistry?): Array<DeadNode>` | Fungsi analisis utama — 3 fase traversal |

**Export:**

| Nama Export | Mapped To | Signature |
|-------------|-----------|-----------|
| `findDeadCode` | `analyzeDeadCodeRevised` | `findDeadCode(ast, fileName?, globalRegistry?): DeadNode[]` |

**3 Fase Analisis dalam `findDeadCode()`:**

**Fase 1 — Traversal AST (Scope Building + Dead Branch Detection):**

Satu pass `estraverse.traverse` dengan `fallback: 'iteration'` (agar TypeScript nodes tidak crash):

- **Dead Branch Analysis 1 — Constant Folding:**
  - `if (false) { ... }` → body consequent ditandai `DeadBranch`
  - `if (true) { ... } else { ... }` → body alternate ditandai `DeadBranch`

- **Dead Branch Analysis 2 — After Terminator:**
  - Scan `BlockStatement.body` dan `SwitchCase.consequent`
  - Jika ada `ReturnStatement` / `ThrowStatement` / `BreakStatement` / `ContinueStatement`, semua statement sesudahnya ditandai `DeadCode`

- **Scope Management:**
  - `Function*` nodes → buat scope baru dengan type `'function'`
  - `BlockStatement` (bukan function body) → buat scope baru dengan type `'block'`
  - `leave` callback → pop scope dari stack

- **Registrasi Deklarasi:**
  - `VariableDeclarator` → ekstrak via `extractIdentifiers()`, daftarkan ke scope yang tepat (`var` → function scope, `let/const` → block scope)
  - `FunctionDeclaration` → daftarkan nama ke scope parent
  - Function params → daftarkan via `extractIdentifiers()` ke scope function
  - `ImportDeclaration` → daftarkan setiap `.local` name sebagai variabel

- **Tracking Referensi:**
  - Setiap `Identifier` node → cek via `isReference(node, parent, grandParent)` → jika ya, `addReference()`
  - `grandParent` diambil dari `parentStack[]` untuk konteks destructuring

**Fase 2 — Export Safety Check:**

Pass `estraverse.traverse` kedua, deteksi export dan tandai sebagai `used` jika dipakai di file lain (via `globalRegistry.usedExports`) atau konservatif jika tanpa registry:

- `ExportNamedDeclaration` → variabel/fungsi yang di-export
- `ExportDefaultDeclaration` → default export
- CommonJS `module.exports.foo = foo` pattern

**Fase 3 — Resolve & Collect:**

- `scope.resolve()` di semua scope → jalankan `markUsed()` untuk semua referensi
- Kumpulkan semua deklarasi dengan `used === false` → masuk array `deadCode`
- Merge dengan `unreachableNodes` (dead branches & after-terminator)
- Return array `DeadNode[]`

**Format `DeadNode`:**

```javascript
{
    name: string,     // Nama variabel/fungsi, atau 'Unreachable Branch'/'Unreachable Statement'
    type: string,     // 'Variable' | 'Function' | 'Parameter' | 'DeadBranch' | 'DeadCode'
    line: number,     // Nomor baris di source code
    node: ASTNode     // Referensi langsung ke node AST (digunakan oleh codeCleaner)
}
```

---

### `src/analyzer/dependency/dependencyAnalyzer.js` — Standalone Detektor Unused Dependencies

**Kegunaan:** Menemukan package di `package.json` yang tidak pernah di-import dalam kode. Berjalan sebagai standalone — memindai **semua file** (tidak bergantung pada graph). Berbeda dengan dependency check di `dce-cli.js` yang hanya memeriksa live files via `graph.usedPackages`.

**Dependencies:** `fs-extra`, `path`, `fast-glob`, `estraverse`, `astParser`

**Functions:**

| Fungsi | Signature | Deskripsi |
|--------|-----------|-----------|
| `getPackageDependencies` *(private)* | `getPackageDependencies(projectRoot): Promise<Set<string>>` | Baca `package.json`, gabungkan `dependencies` dan `devDependencies`, return sebagai `Set` nama package |
| `getPackageName` *(private)* | `getPackageName(importPath): string \| null` | Ekstrak base package name dari string import. Handle scoped package `@scope/pkg/sub` → `@scope/pkg`, dan regular `pkg/sub` → `pkg`. Return `null` untuk path relatif/absolut |
| `getUsedDependencies` *(private)* | `getUsedDependencies(projectRoot): Promise<Set<string>>` | Scan semua file JS via `fast-glob`, parse setiap file, traversal AST dengan `estraverse` untuk deteksi `ImportDeclaration`, `require()` CallExpression, dan `ImportExpression` (dynamic import) |
| `findUnusedDependencies` | `findUnusedDependencies(projectRoot): Promise<string[]>` | **Fungsi utama:** Panggil `getPackageDependencies()` dan `getUsedDependencies()`, return selisihnya (package yang dideklarasikan tapi tidak digunakan) |

**Logika:**
```
Set(package.json deps) - Set(import yang ditemukan di semua file) = Unused Dependencies
```

**Catatan:** Di `dce-cli.js`, dependency check dilakukan inline menggunakan `graph.usedPackages` dari `buildProjectGraph()` karena lebih efisien (scan sudah dilakukan bersamaan dengan graph building). File ini tetap berfungsi sebagai utility standalone yang bisa digunakan independen.

---

### `src/analyzer/graphVisualizer.js` — Generator Diagram Mermaid

**Kegunaan:** Mengubah objek graph (`liveFiles`, `edges`) menjadi teks diagram Mermaid yang bisa divisualisasikan.

**Functions:**

| Fungsi | Signature | Deskripsi |
|--------|-----------|-----------|
| `generateMermaidGraph` | `generateMermaidGraph(graph, rootDir): string` | Buat definisi Mermaid `graph TD` dari live files dan edges. Setiap node diberi ID unik `N0`, `N1`, dst. Label menggunakan path relatif terhadap rootDir |

**Output format:**

```
graph TD
    N0["📄 bin/dce-cli.js"]
    N1["📄 src/analyzer/projectGraph.js"]
    N0 --> N1
    ...
```

Bisa divisualisasikan di VSCode (ekstensi **Mermaid Preview**) atau [mermaid.live](https://mermaid.live)

---

### `src/eliminator/codeCleaner.js` — Pembersih Dead Code Level AST

**Kegunaan:** Menghapus node dead code dari AST lalu meng-generate ulang source code yang bersih. Bekerja di level AST (bukan manipulasi string) untuk keamanan maksimal.

**Dependencies:** `estraverse`, `escodegen`

**Functions:**

| Fungsi | Signature | Deskripsi |
|--------|-----------|-----------|
| `removeDeadCode` | `removeDeadCode(ast, deadNodes): string` | Hapus node-node yang teridentifikasi sebagai dead code dari AST, lalu regenerasi source code |

**Logika `removeDeadCode()`:**

1. Buat `Set<ASTNode>` dari `deadNodes.map(d => d.node)` — pakai referensi objek langsung
2. `estraverse.replace()` traversal:
   - `enter`: jika node ada di Set → `return VisitorOption.Remove`
   - Khusus `VariableDeclarator` dan `FunctionDeclaration` yang ada di Set → remove
3. `leave`: jika `VariableDeclaration` kosong (semua declarator-nya sudah dihapus) → hapus wrapper-nya juga (mencegah `const ;` yang invalid)
4. `escodegen.generate(cleanedAST, options)` → ubah AST kembali ke string kode

**Opsi output `escodegen`:**

| Opsi | Nilai |
|------|-------|
| Indent | 4 spasi |
| Quotes | Single quotes (`'`) |
| Comments | Dipertahankan (`comment: true`) |
| Blank lines | Dipertahankan |

---

### `src/eliminator/dependencyCleaner.js` — Pembersih `package.json`

**Kegunaan:** Menghapus entry unused dependencies dari `package.json` secara aman.

**Dependencies:** `fs-extra`, `path`

**Functions:**

| Fungsi | Signature | Deskripsi |
|--------|-----------|-----------|
| `removeUnusedDependencies` | `removeUnusedDependencies(projectRoot, unusedDeps: string[]): Promise<number>` | Baca `package.json`, hapus setiap nama di `unusedDeps` dari `dependencies` dan `devDependencies`, tulis kembali ke disk. Return jumlah entry yang berhasil dihapus |

**Logika:**

1. Baca `package.json` via `fs.readJson()`
2. Loop `unusedDeps`: hapus key dari `pkg.dependencies` jika ada, lalu dari `pkg.devDependencies`
3. Tulis kembali via `fs.writeJson(packageJsonPath, pkg, { spaces: 2 })` (format 2 spasi)
4. Return `removedCount` (jumlah deps yang benar-benar dihapus)

---

### `src/eliminator/diffGenerator.js` — Generator Diff Berwarna

**Kegunaan:** Menampilkan perbandingan kode "sebelum vs sesudah" di terminal dengan pewarnaan, sebelum perubahan dieksekusi ke disk.

**Dependencies:** `diff` (unified diff), `chalk` (pewarnaan terminal)

**Functions:**

| Fungsi | Signature | Deskripsi |
|--------|-----------|-----------|
| `generateDiff` | `generateDiff(oldCode, newCode, fileName): string` | Buat unified diff string yang sudah diwarnai antara `oldCode` dan `newCode`, dengan label `fileName` |

**Skema warna output:**

| Warna | Prefix | Arti |
|-------|--------|------|
| 🔴 Merah (`chalk.red`) | `-` | Baris yang dihapus |
| 🟢 Hijau (`chalk.green`) | `+` | Baris yang ditambahkan |
| 🔵 Cyan (`chalk.cyan`) | `@@` | Header hunk `@@ -x,y +x,y @@` |
| ⚫ Abu-abu (`chalk.gray`) | `---`/`+++` | Nama file |
| 🔅 Dim (`chalk.dim`) | ` ` | Baris konteks (tidak berubah) |

---

## 🧪 Test Suite

**Test runner:** `test/run-tests.js`
**Cara menjalankan:** `npm test` atau `node test/run-tests.js`

| Suite | Test Project | Assertions | Yang Diuji |
|-------|-------------|-----------|-----------|
| 1 | `test-destructuring/` | 11 | `{a,b}`, `[x,y]`, `...rest`, nested, default value |
| 2 | `test-var-scope/` | 6 | `var` hoisting vs `let/const` block scope |
| 3 | `test-typescript/` | 6 | Parse `.ts`, graph resolve, dead code di TS |
| 4 | Inline code | 3 | `isReference()` accuracy untuk imports |
| 5 | Inline code | 2 | `if(false)` / `if(true) else` constant folding |
| 6 | `test_scope/` | 6 | BFS graph dengan multi-file project |
| 7 | Inline code | 9 | Dead code setelah `return`, `throw`, `break`, `continue` |
| **Total** | | **43 assertions** | |

---

## 🔬 Algoritma Utama yang Diimplementasikan

| Algoritma | Diimplementasikan Di | Deskripsi |
|-----------|---------------------|-----------|
| **Breadth-First Search (BFS)** | `projectGraph.js` | Traversal dari entry point untuk membuat peta file yang live |
| **Scope Chain Analysis** | `scope.js`, `deadCodeAnalyzer.js` | Resolusi variabel dengan naik ke parent scope |
| **Mark-and-Sweep (DCE)** | `deadCodeAnalyzer.js`, `codeCleaner.js` | Tandai deklarasi → tandai yang terpakai → sisanya dead code |
| **Constant Folding Detection** | `deadCodeAnalyzer.js` | Deteksi `if(false)` / `if(true) else` untuk dead branch elimination |
| **After-Terminator Detection** | `deadCodeAnalyzer.js` | Deteksi dead code setelah `return`/`throw`/`break`/`continue` |
| **Bailout Heuristics** | `projectGraph.js` | Deteksi `eval`, `with`, `obj[dynamicKey]` → tandai unsafe |
| **Pattern Extraction** | `deadCodeAnalyzer.js` | Rekursif ekstrak identifier dari destructuring pattern |
| **Var Hoisting Simulation** | `deadCodeAnalyzer.js` | `var` → function scope, `let/const` → block scope |
| **Cross-file Export Tracking** | `projectGraph.js`, `deadCodeAnalyzer.js` | `globalRegistry.usedExports` per file |

---

## 🔗 Dependensi & Fungsinya

| Package | Versi | Fungsi |
|---------|-------|--------|
| `acorn` | ^8.15.0 | Parser JavaScript → AST |
| `acorn-typescript` | ^1.4.13 | Plugin Acorn untuk TypeScript syntax |
| `estraverse` | ^5.3.0 | Traversal & replace node AST |
| `escodegen` | ^2.1.0 | Regenerasi source code dari AST |
| `commander` | ^14.0.2 | Framework CLI (argument parsing) |
| `fast-glob` | ^3.3.3 | Scanning file secara efisien |
| `diff` | ^8.0.3 | Generate unified diff string |
| `chalk` | ^5.6.2 | Pewarnaan output terminal |
| `inquirer` | ^12.11.1 | Input interaktif (checkbox, confirm) |
| `fs-extra` | ^11.3.3 | Operasi file system yang lebih kaya dari `fs` bawaan |

---

## 💡 Tips Penggunaan

```bash
# Jalankan automated test suite
npm test

# Scan single file
node bin/dce-cli.js scan test/single_scan_test.js

# Scan seluruh proyek (directory mode)
node bin/dce-cli.js scan ./

# Fix dengan preview diff & konfirmasi interaktif
node bin/dce-cli.js fix ./path/to/project

# Lihat semua dependencies terdaftar
node bin/dce-cli.js show-deps ./

# Generate diagram ketergantungan antar file
node bin/dce-cli.js visualize ./
# → Hasilnya: project-graph.mmd (buka di mermaid.live atau VSCode)

# Scan proyek TypeScript
node bin/dce-cli.js scan ./my-ts-project
```

---

_Dokumentasi diperbarui pada 2026-04-04 mencakup semua perubahan: destructuring support, var scope fix, TypeScript support, dead branch after-terminator, dan automated test suite (41 assertions)._
