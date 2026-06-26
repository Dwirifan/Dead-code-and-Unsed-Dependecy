#### 4.4.4 Iterasi 4 : Pengembangan Modul Antarmuka dan Pelaporan (CLI & Reporter)

Iterasi keempat merupakan tahap finalisasi sistem, di mana seluruh mesin inti yang telah dibangun pada iterasi-iterasi sebelumnya — yaitu *Analyzer*, *Graph Builder*, dan *Eliminator* — dibungkus ke dalam **Modul Antarmuka (*Command Line Interface* / CLI)** dan **Sistem Pelaporan (*Reporter*)**. Modul ini berperan sebagai jembatan antara pengguna akhir dengan kompleksitas mesin analisis statis yang bekerja di balik layar.

---

##### A. Perencanaan Iterasi dan *TaskPriorityList*

Pengembangan pada iterasi ini difokuskan pada peningkatan pengalaman pengguna (*User Experience* / UX) di lingkungan terminal, serta kemampuan menyajikan data analitik yang kompleks menjadi visualisasi yang intuitif dan mudah dipahami.

| Prioritas | ID Task | Deskripsi Task                                                                              | *User Story* |
| --------- | ------- | ------------------------------------------------------------------------------------------- | ------------ |
| 1         | T4-01   | Registrasi dan *routing* perintah CLI (`scan`, `fix`, `watch`, dll) menggunakan `commander` | US-01, US-02 |
| 2         | T4-02   | Pembangunan antarmuka panduan interaktif (*Wizard*) untuk pengguna baru                     | US-01        |
| 3         | T4-03   | Pembangunan Modul *Reporter* untuk merangkum hasil analisis dalam format JSON dan terminal  | US-04        |
| 4         | T4-04   | Pembangunan Modul Visualisasi HTML (*Dashboard* interaktif berbasis Cytoscape.js)           | US-04        |
| 5         | T4-05   | Pengujian fungsional *End-to-End* (E2E) terhadap seluruh perintah CLI                      | US-01 – 07   |

---

##### B. *Development Baseline*

Fokus utama iterasi ini adalah merealisasikan T4-01 hingga T4-05, mencakup tiga komponen utama: ekosistem perintah CLI, antarmuka wizard interaktif, dan sistem visualisasi berbasis HTML.

**1. Ekosistem Perintah Terintegrasi (*CLI Commands*)**

Modul antarmuka dikembangkan menggunakan *library* `commander` untuk mendefinisikan arsitektur perintah yang terstruktur dan konsisten. Sistem menerapkan mekanisme *routing* otomatis: apabila CLI dijalankan **tanpa argumen**, *Wizard* interaktif akan langsung diluncurkan; sebaliknya, jika disertai argumen, `commander` akan meneruskan eksekusi ke modul perintah yang sesuai.

```text
ALGORITMA CLIRouter (bin/dce-cli.js)
MASUKAN: process.argv (argumen baris perintah dari pengguna)
KELUARAN: Eksekusi modul perintah yang sesuai

1.  INISIALISASI program Commander
    - name    = 'deadkiller'
    - version = '1.0.0'
2.
3.  DAFTARKAN semua perintah ke program:
    - scan      : Pindai dead code (dry-run, tanpa mutasi berkas)
    - fix       : Eksekusi penghapusan dengan konfirmasi interaktif
    - show-deps : Analisis dependensi NPM
    - visualize : Hasilkan HTML Dashboard interaktif
    - trace     : Lacak rantai impor suatu berkas
    - watch     : Mode pemantauan real-time (file watcher)
    - report    : Alias dari perintah visualize
    - history   : Tampilkan riwayat sesi backup & restore
    - init      : Panduan pembuatan berkas konfigurasi awal
4.
5.  JIKA panjang process.argv = 2 (tidak ada argumen) MAKA
6.      PANGGIL launchWizard()    // Luncurkan Interactive Wizard
7.  JIKA TIDAK MAKA
8.      program.parse(process.argv) // Teruskan ke perintah yang sesuai
9.  AKHIR JIKA
```

**2. Antarmuka Panduan Interaktif (*Interactive Wizard*)**

Guna meminimalkan potensi kesalahan konfigurasi pada penggunaan pertama, sebuah *Interactive Wizard* (`wizard.js`) dibangun menggunakan *library* `inquirer`. *Wizard* menampilkan *banner* visual ASCII terlebih dahulu, kemudian memandu pengguna secara bertahap untuk memilih aksi yang diinginkan dan direktori target, lalu meneruskan eksekusi tersebut ke modul CLI inti. Khusus setelah perintah `scan` selesai dieksekusi, *Wizard* secara proaktif menawarkan opsi untuk langsung menjalankan perintah `fix`.

```text
ALGORITMA InteractiveWizard (wizard.js)
MASUKAN: -
KELUARAN: Eksekusi perintah yang dipilih pengguna

1.  TAMPILKAN Banner ASCII (DEADKILLER WIZARD)
    // ╔══════════════════════════════════════╗
    // ║         DEADKILLER WIZARD            ║
    // ╚══════════════════════════════════════╝
2.
3.  // LANGKAH 1: Pilih Aksi
4.  TAMPILKAN menu pilihan interaktif:
    - [>] Analisis & Eksekusi       (scan & fix)
    - [+] Lihat Dependensi          (show-deps)
    - [~] Buat Diagram Visualisasi  (visualize)
    - [T] Lacak Ketergantungan File (trace)
    - [H] Riwayat & Restore Backup  (history)
    - [x] Keluar
5.  action = TUNGGU pilihan pengguna
6.
7.  // LANGKAH 2: Pilih Target
8.  JIKA action = 'trace' MAKA
9.      files = PINDAI semua berkas .js/.ts di direktori kerja saat ini
10.     targetFile = TAMPILKAN daftar berkas dan tunggu satu pilihan
11. JIKA TIDAK MAKA
12.     targetDirectory = MINTA masukan path direktori (default: "./")
13.     VALIDASI bahwa direktori tersebut benar-benar ada di sistem berkas
14. AKHIR JIKA
15.
16. // LANGKAH 3: Eksekusi (Pass-through ke CLI inti)
17. PANGGIL execSync("node dce-cli.js [action] [target]", { stdio: 'inherit' })
18.
19. // LANGKAH 4: Tawaran Eksekusi Fix (khusus setelah scan)
20. JIKA action = 'scan' MAKA
21.     wantFix = TANYA "Mau langsung menjalankan fix?"
22.     JIKA wantFix = True MAKA
23.         PANGGIL execSync("node dce-cli.js fix [target]", { stdio: 'inherit' })
24.     AKHIR JIKA
25. AKHIR JIKA
```

**3. Visualisasi Graf dan *Dashboard* HTML (`graphVisualizer.js`)**

Inovasi utama pada iterasi ini adalah perintah `visualize`. Modul ini tidak sekadar mencetak teks di terminal, melainkan **menghasilkan sebuah *Dashboard* HTML secara otomatis** dalam berkas `code-structure-trace.html`. *Dashboard* tersebut memuat komponen-komponen berikut:

*   Visualisasi arsitektur proyek dalam bentuk *Directed Acyclic Graph* (DAG) yang interaktif, dirender menggunakan **Cytoscape.js** dengan tata letak **Dagre Layout** dan *edge routing* ortogonal.
*   Laporan anomali *dead code* yang dikategorikan berdasarkan tingkat keamanan (*Safe*, *Review*, *Risky*) dalam bentuk tabel terstruktur.
*   Daftar dependensi aktif dan dependensi yang tidak terpakai (*unused dependencies*) yang disajikan dalam kartu *sidebar*.
*   Dukungan penuh terhadap **Dark Mode** serta antarmuka **bilingual** (Bahasa Indonesia / Bahasa Inggris).

Setelah berkas HTML selesai digenerate, CLI secara otomatis membukanya di peramban (*browser*) bawaan sistem operasi pengguna.

---

##### C. Pengujian Awal

Pengujian dilakukan secara *End-to-End* (E2E), yaitu mulai dari masukan (*input*) perintah di terminal hingga eksekusi seluruh mesin analisis di balik layar, guna memastikan integrasi antarkomponen berjalan dengan benar.

**Status Test Case Internal:**
*   [TC-R1] Eksekusi flag perintah (`--dry-run`, `--level`)              ✅ BERHASIL
*   [TC-R2] Validasi keluaran teks terminal berbasis tema (*chalk*)      ✅ BERHASIL
*   [TC-R3] Pembuatan HTML *Dashboard* dan pembukaan otomatis di browser ✅ BERHASIL
*   [TC-R4] Pembuatan berkas konfigurasi melalui interaksi *Wizard*      ✅ BERHASIL
─────────────────────────────────────────────────────────────────
Lulus : 4 dari 4 | Stabilitas CLI: 100%

---

##### D. *Self-Review* dan *Refactor Baseline*

Tahap *self-review* menitikberatkan pada peningkatan estetika antarmuka (UX) dan kualitas penanganan galat (*error handling*). Penyempurnaan pertama adalah penambahan *loading spinner* dari *library* `ora` untuk memberikan umpan balik visual yang responsif kepada pengguna selama mesin analisis sedang membangun *Dependency Graph* yang berukuran besar. Penyempurnaan kedua adalah penataan pesan galat di terminal menggunakan sistem pewarnaan `chalk` yang dipusatkan di `theme.js`, guna memastikan tampilan keluaran yang konsisten dan mudah dibaca.

Sebagai puncak integrasi seluruh sistem dari Iterasi 1 hingga Iterasi 4, alur eksekusi perintah `scan` secara menyeluruh dapat dirangkum dalam algoritma berikut:

```text
ALGORITMA ScanPipeline (Orkestrasi End-to-End)
MASUKAN: projectPath (direktori target pengguna)
KELUARAN: Laporan dead code di terminal (dan opsional format JSON)

1.  // FASE PERSIAPAN
2.  AKTIFKAN spinner ora: "Membangun Dependency Graph..."
3.  ruleEngine ← InitializeRuleEngine(projectPath)
4.
5.  // FASE PEMETAAN (Iterasi 2 — Graph Builder)
6.  graph ← BuildProjectGraph(projectPath, ruleEngine)
7.  deadFiles ← IdentifikasiDeadFiles(graph.liveFiles, projectPath)
8.
9.  // FASE ANALISIS (Iterasi 2 — Dead Code Analyzer)
10. NONAKTIFKAN spinner
11. AKTIFKAN spinner ora: "Menganalisis dead code per berkas..."
12. allIssues ← Daftar Kosong
13. UNTUK SETIAP file DALAM graph.liveFiles LAKUKAN
14.     ast ← ParseFileWithCache(file)
15.     issues ← FindDeadCode(ast, file, graph.globalRegistry, ruleEngine)
16.     allIssues.tambahkan(issues)
17. AKHIR UNTUK
18.
19. // FASE BEDAH MANIFES (Iterasi 2 — Dependency Analyzer)
20. NONAKTIFKAN spinner
21. unusedDeps ← AnalyzeDependencies(projectPath, graph.usedPackages)
22.
23. // FASE PELAPORAN (Iterasi 4 — Reporter)
24. JIKA flag --json aktif MAKA
25.     CETAK keluaran JSON terstruktur ke stdout
26. JIKA TIDAK MAKA
27.     KELOMPOKKAN allIssues berdasarkan status: safe / review / risky
28.     TAMPILKAN laporan terminal berwarna menggunakan chalk dan tema uiColors
29.     TAMPILKAN ringkasan: total berkas, total anomali, waktu analisis
30. AKHIR JIKA
```

---

##### E. *Production Baseline*

Dengan tuntasnya pembangunan Modul CLI dan Pelaporan, siklus pengembangan sistem **secara resmi telah mencapai status *feature complete***. Pengguna kini dapat mendeteksi anomali kode, melakukan penghapusan secara terbimbing dengan jaring pengaman otomatis, serta memvisualisasikan keseluruhan arsitektur ketergantungan proyek melalui antarmuka baris perintah yang mulus dan responsif. Sistem dinyatakan siap untuk memasuki tahap pengujian fungsional menyeluruh.

---

##### F. Ringkasan Penyelesaian Task Iterasi 4

| ID Task | Deskripsi | Status | Baseline |
| :--- | :--- | :--- | :--- |
| T4-01 | Registrasi dan *routing* perintah CLI (`scan`, `fix`, `show-deps`, `visualize`, `trace`, `watch`, `report`, `history`, `init`) | Selesai | Development |
| T4-02 | Pembangunan antarmuka *Wizard* interaktif berbasis `inquirer` | Selesai | Development |
| T4-03 | Pembangunan Modul *Reporter* format terminal dan JSON | Selesai | Development |
| T4-04 | Pembangunan Visualisasi Graf HTML (*Dashboard* Cytoscape.js + Dagre) | Selesai | Development |
| T4-05 | Pengujian fungsional E2E seluruh perintah CLI | Selesai | Development |
