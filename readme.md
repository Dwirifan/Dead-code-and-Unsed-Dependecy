# Rancang Bangun Alat Eliminasi Dead Code dan Unused Dependency Otomatis untuk Proyek JavaScript

## 📄 Abstrak

Proyek Tugas Akhir ini bertujuan untuk mengembangkan alat bantu (tool) berbasis _Command Line Interface_ (CLI) yang mampu melakukan _static analysis_ pada kode sumber JavaScript. Alat ini secara otomatis mendeteksi dan menghapus variabel atau fungsi yang tidak digunakan (_dead code_), serta membersihkan dependensi yang tidak terpakai dalam `package.json`, guna meningkatkan efisiensi dan kebersihan kode.

## 🚀 Fitur Utama

- **Unused Dependency Detection**: Menganalisis `package.json` dan memindai seluruh file proyek untuk menemukan library yang diinstal tetapi tidak pernah di-import.
- **Dead Code Elimination**: Menggunakan **Abstract Syntax Tree (AST)** untuk mendeteksi variabel dan fungsi yang dideklarasikan namun tidak memiliki referensi (usage) di dalam scope-nya.
- **Safe Logic**: Melindungi kode publik (`module.exports`, `export`) agar tidak terhapus.
- **Interactive Safety**: Konfirmasi interaktif sebelum melakukan penghapusan fisik untuk mencegah kesalahan.

## 🛠️ Teknologi yang Digunakan

- **Runtime**: Node.js
- **Parser**: `acorn` (Konversi kode ke AST)
- **Traverser**: `estraverse` (Penelusuran node AST)
- **Generator**: `escodegen` (Konversi balik AST ke kode)
- **CLI Framework**: `commander`
- **Interaction**: `inquirer`

## 📦 Instalasi & Persiapan

1.  Clone repositori ini atau copy ke direktori lokal.
2.  Install dependensi proyek:
    ```bash
    npm install
    ```
3.  Link command `dce-cli` (opsional) atau jalankan langsung via Node.js.

## 📖 Panduan Penggunaan

Tool ini memiliki dua mode utama: **Scan** dan **Fix**.

### 1. Mode Scan (Laporan)

Hanya menampilkan laporan _dead code_ dan _unused dependency_ tanpa mengubah file apapun.

```bash
node bin/dce-cli.js scan <path_project>
```

**Contoh:**

```bash
node bin/dce-cli.js scan .
```

### 2. Mode Fix (Pembersihan)

Melakukan scanning, menampilkan laporan, dan meminta konfirmasi pengguna untuk menghapus kode sampah.

```bash
node bin/dce-cli.js fix <path_project>
```

**Contoh Output Interaksi:**

```text
🔍 Analyzing project at: ...

📦 [Unused Dependencies to be REMOVED]:
   - unused-lib

💻 [Dead Code to be REMOVED]:
   📄 src/utils.js
      Line 45: Function 'deprecatedHelper'

⚠️  SUMMARY: 1 dependencies and 1 code segments will be PERMANENTLY deleted.
? Are you sure you want to proceed with the deletion? (This cannot be undone) (y/N)
```

## 🧪 Hasil Pengujian (Self-Scan)

Pengujian dilakukan dengan menjalankan tool ini terhadap _source code_ dirinya sendiri (Self-Testing).

### Skenario Uji

1.  **Input**:
    - File `index.js` dimodifikasi dengan menambahkan variabel `unusedVar` dan fungsi `deadFunc` yang tidak dipanggil.
    - `package.json` memiliki dependensi namun semua digunakan.

2.  **Proses**:
    - Jalankan: `node bin/dce-cli.js scan .`

3.  **Hasil Analisis**:

    ```text
    🔍 Scanning project at: D:\materi kuliah\Tugas Akhir

    📦 [Dependencies]: Clean

    💻 [Dead Code Scanning]:
       📄 index.js
          Line 4: Variable 'unusedVar'
          Line 12: Function 'deadFunc'
          Line 13: Variable 'innerUnused'
    ```

4.  **Kesimpulan**:
    - Algoritma berhasil membedakan antara kode yang dipakai (`useful()`, `publicApi`) dan yang mati.
    - Scope analysis berjalan dengan benar (mengetahui `innerUnused` ada di dalam fungsi mati).

## 📂 Struktur Direktori

```
.
├── bin/
│   └── dce-cli.js          # Entry point aplikasi CLI
├── src/
│   ├── analyzer/
│   │   ├── deadCodeAnalyzer.js    # Logika deteksi dead code (AST & Scope)
│   │   └── dependencyAnalyzer.js  # Logika deteksi dependensi
│   ├── eliminator/
│   │   ├── codeCleaner.js         # Logika regenerasi kode (Escodegen)
│   │   └── dependencyCleaner.js   # Logika hapus dari package.json
│   └── parser/
│       └── astParser.js           # Wrapper konfigurasi Acorn
└── index.js                # File dummy untuk pengujian manual
```
