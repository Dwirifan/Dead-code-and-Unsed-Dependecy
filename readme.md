# Rancang Bangun Alat Eliminasi Dead Code dan Unused Dependency Otomatis untuk Proyek JavaScript

## 📄 Abstrak

Proyek Tugas Akhir ini mengembangkan alat bantu (tool) berbasis _Command Line Interface_ (CLI) untuk melakukan _static analysis_ mendalam pada kode sumber JavaScript. Alat ini menggunakan pendekatan **Graph-Based Reachability Analysis** untuk memetakan struktur proyek secara akurat, mendeteksi file yang tidak terjangkau (_unreachable files_), variabel mati (_dead code_), serta dependensi yang tidak terpakai (_unused dependencies_). Dilengkapi dengan fitur **Diff View** untuk memvisualisasikan perubahan sebelum dieksekusi demi keamanan kode.

## 🚀 Fitur Utama

- **Deep Graph Analysis**: Membangun graf ketergantungan dari _entry point_ (misal `index.js`) untuk membedakan antara file yang _live_ dan file sampah (_dead files_).
- **Unused Dependency Detection**: Mendeteksi library di `package.json` yang tidak pernah dipanggil di file manapun dalam graf proyek.
- **Intra-procedural Dead Code Elimination**: Mendeteksi deklarasi variabel/fungsi yang tidak digunakan di dalam file yang aktif (Scope-Aware Analysis).
- **Interactive Diff Preview**: Menampilkan perbandingan kode **Before vs After** (seperti Github Diff) di terminal sebelum melakukan penghapusan.
- **Auto-Detection Entry Point**: Otomatis mendeteksi file utama proyek dari `package.json` atau standar umum.
- **Safe Mode**: Public API (`export`) dilindungi, dan konfirmasi interaktif diwajibkan sebelum perubahan fisik.

## 🛠️ Teknologi yang Digunakan

- **Node.js**: Runtime environment.
- **Acorn & Estraverse**: Parser AST dan penelusuran kode.
- **Escodegen**: Code generator untuk menyusun ulang AST.
- **Commander**: Framework CLI.
- **Fast-Glob**: Scanning file sistem.
- **Diff & Chalk**: Visualisasi perbedaan kode berwarna.
- **Inquirer**: Interaksi antarmuka pengguna CLI.

## 📦 Instalasi

1.  Clone repositori ini.
2.  Install dependensi:
    ```bash
    npm install
    ```

## 📖 Cara Penggunaan

### 1. Mode Scan (Analisis & Laporan)

Menampilkan laporan lengkap kesehatan kode tanpa mengubah apapun.

```bash
node bin/dce-cli.js scan <path_project>
```

**Output mencakup:**

- Daftar Dependensi Tidak Terpakai.
- Daftar File Mati (Tidak Pernah Di-import).
- Daftar Kode Mati (Variabel/Fungsi Unused) di dalam file aktif.

### 2. Mode Fix (Pembersihan Cerdas)

Melakukan analisis, menampilkan preview perubahan, dan mengeksekusi pembersihan.

```bash
node bin/dce-cli.js fix <path_project>
```

**Alur Interaksi:**

1.  **Analisis**: Tool memindai proyek.
2.  **Laporan**: Menampilkan ringkasan isu.
3.  **Diff Preview**: Menampilkan kode asli vs kode baru (berwarna merah/hijau).
4.  **Konfirmasi**: `Are you sure you want to apply these changes? (y/N)`.

## 🧠 Logika Internal (Algoritma)

1.  **Fase 1: Graph Construction**
    - Mencari _Entry Point_ (misal `index.js`).
    - Menelusuri semua `import` / `require` secara rekursif (Breadth-First Search).
    - Menghasilkan daftar **Live Files**. File di folder proyek yang tidak masuk daftar ini dianggap **Dead Files**.

2.  **Fase 2: Dependency Check**
    - Mencatat semua paket eksternal yang di-import dalam Graph.
    - Membandingkan dengan `package.json`. Sisa yang tidak ada di Graph adalah **Unused Dependencies**.

3.  **Fase 3: Local Dead Code Analysis**
    - Hanya memindai **Live Files**.
    - Membangun **Scope Tree** (Global -> Function -> Block).
    - Menandai deklarasi yang _Reference Count_-nya 0 sebagai **Dead Code**.

4.  **Fase 4: Diff & Execution**
    - Simulasi penghapusan di memori.
    - Generate _Unified Diff_ string.
    - Tulis ke disk hanya jika dikonfirmasi user.

### Alur Kerja (Flowchart)

```mermaid
flowchart TD
    classDef cli fill:#2b2b2b,stroke:#00ffcc,stroke-width:2px,color:#fff
    classDef analyzer fill:#1b3b5c,stroke:#4da6ff,stroke-width:2px,color:#fff
    classDef process fill:#4a4a4a,stroke:#ddd,color:#fff
    classDef decision fill:#6b3e1b,stroke:#ffa500,shape:rhombus,color:#fff
    classDef action fill:#1b5c20,stroke:#66ff66,stroke-width:2px,color:#fff
    classDef warning fill:#5c1b1b,stroke:#ff4d4d,stroke-width:2px,color:#fff
    classDef output fill:#2d1b5c,stroke:#b366ff,stroke-dasharray: 5 5,color:#fff

    A(["User Input: node bin/dce-cli.js [command] [path]"]):::cli --> B{"Apakah command scan atau fix?"}:::decision

    B -- "Ya (Scan/Fix)" --> C["projectGraph.js: Mulai Graph Construction"]:::process
    B -- show-deps --> SD["Tampilkan depencencies dari package.json"]:::output
    B -- visualize --> VZ["Generate Graph Mermaid project-graph.mmd"]:::output

    subgraph Graph Phase ["Fase 1: Peta Ketergantungan (Reachability)"]
        direction TB
        C --> D["Cari Entry Point (package.json main / index.js)"]:::process
        D --> E["astParser.js: Parse file menjadi AST (Acorn + TS Plugin)"]:::process
        E --> F["BFS Traversal AST Cari import/require"]:::process
        F --> G{"Semua file yang bisa dicapai?"}:::decision
        G -- Belum --> E
        G -- Selesai --> H[("Daftar Live Files & Used Packages")]:::analyzer
    end

    H --> I["Cari File Yatim (Dead Files): Semua file di disk (-) Live Files"]:::process
    H --> J["dependencyAnalyzer.js: Cari Unused Deps"]:::process

    subgraph Analysis Phase ["Fase 2: Analisis Dead Code (Live Files)"]
        H -- Looping per Live File --> K["deadCodeAnalyzer.js: Analisis Scope & Referensi"]:::analyzer
        K --> L["Bangun Scope Tree (Global -> Function -> Block)"]:::process
        L --> M["Deteksi isReference() & Constant Folding (if false)"]:::process
        M --> N[("Kumpulkan Dead Nodes (Variabel/Fungsi Unused)")]:::analyzer
    end

    N --> O{Mode Command?}:::decision
    I --> O
    J --> O

    O -- Command 'scan' --> P[/"Cetak Laporan ke Terminal (Unused Deps, Dead Files, Dead Code)"/]:::output
    O -- Command 'fix' --> Q["Simulasi Penghapusan & Kalkulasi Metrik (LOC & KB)"]:::process

    subgraph Fix Phase ["Fase 3: Visualisasi & Eksekusi"]
        Q --> R["diffGenerator.js: Tampilkan Colored Diff Preview"]:::process
        R --> S{"User konfirmasi hapus? (Inquirer)"}:::decision
        S -- No --> T[/"Batalkan Eksekusi"/]:::warning
        S -- Yes --> U["dependencyCleaner.js: Hapus dari package.json"]:::action
        U --> V["Hapus Dead Files dari sistem"]:::action
        V --> W["codeCleaner.js: Hapus Dead Node dari AST & Generate ulang kode (Escodegen)"]:::action
        W --> X[/"Tulis kode bersih ke Disk & Tampilkan Impact Metrics"/]:::output
    end
```

## 📂 Struktur Direktori

```
.
├── bin/
│   └── dce-cli.js           # Main CLI Logic (Graph + Diff Integration)
├── src/
│   ├── analyzer/
│   │   ├── projectGraph.js        # Logika Reachability Graph
│   │   ├── deadCodeAnalyzer.js    # Logika Scope & AST Analysis
│   │   └── dependencyAnalyzer.js  # Helper Dependency Check
│   ├── eliminator/
│   │   ├── diffGenerator.js       # Logika Visualisasi Diff
│   │   ├── codeCleaner.js         # Regenerasi Kode (Escodegen)
│   │   └── dependencyCleaner.js   # Update package.json
│   └── parser/
│       └── astParser.js           # Konfigurasi Parser
└── index.js                 # Dummy file untuk pengujian
```

## 🧪 Hasil Pengujian (Validasi)

Tool ini telah diuji pada dirinya sendiri (_Self-Analysis_) dan berhasil:

1.  Mendeteksi file-file sisa pengembangan yang tidak terhubung ke `dce-cli.js`.
2.  Mendeteksi dependensi dev yang tidak terpakai (jika ada).
3.  Mendeteksi variabel dummy seperti `unusedVar` dengan tepat tanpa merusak kode di sekitarnya.
