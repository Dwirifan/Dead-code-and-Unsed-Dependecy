#### 4.4.3 Iterasi 3 : Pengembangan Mekanisme Pembersihan (Modul Eliminator)

Iterasi ketiga difokuskan pada tahap eksekusi fisik, yaitu pembangunan **Modul Eliminator**. Modul ini bertugas menerima data analitik dari *Analyzer* dan secara otomatis (atau terpandu) menghapus *dead code* dari kode sumber dan `package.json` dengan tingkat keamanan mutlak (*zero-breakage guarantee*).

Iterasi ini merupakan lapisan eksekusi yang secara penuh bergantung pada hasil kedua iterasi sebelumnya dan tidak dapat berdiri sendiri. Dari **Iterasi 1**, Eliminator mewarisi `parseCode()` dan `ParseCache` — yang digunakan kembali pada fase analisis ulang sebelum mutasi untuk memastikan koordinat *range* AST yang presisi. Dari **Iterasi 2**, Eliminator menerima tiga artefak krusial: *dependency graph* (`liveFiles`) sebagai daftar berkas yang akan diperiksa, `globalRegistry` sebagai peta referensi lintas-berkas, dan `unusedDeps` sebagai daftar dependensi mubazir yang siap dihapus dari `package.json`. Dengan kata lain, Iterasi 3 adalah lapisan *executioner* yang mengeksekusi keputusan yang telah dirumuskan oleh Iterasi 1 dan Iterasi 2.

---

##### A. Perencanaan Iterasi dan *TaskPriorityList*

Pengembangan modul Eliminator menuntut kehati-hatian yang sangat tinggi karena melibatkan mutasi *source code* secara langsung. Tugas teknis dirinci dalam *TaskPriorityList* berikut:

| Prioritas | ID Task | Deskripsi Task                                                                         | *User Story* |
| --------- | ------- | -------------------------------------------------------------------------------------- | ------------ |
| 1         | T3-01   | Implementasi manipulasi AST presisi berbasis koordinat string (`magic-string`)         | US-05        |
| 2         | T3-02   | Pembangunan hierarki eksekusi berbasis *Confidence Score* dan *Elimination Level*      | US-05        |
| 3         | T3-03   | Implementasi proteksi struktural (mempertahankan API Signature: fungsi, kelas, parameter) | US-05        |
| 4         | T3-04   | Integrasi *Dependency Cleaner* untuk mengeksekusi `npm uninstall` atau `yarn remove`   | US-06        |
| 5         | T3-05   | Pembangunan fitur *Backup* dan *Restore Manager* sebagai jaring pengaman (Safety Net)  | US-07        |
| 6         | T3-06   | Pengujian mutasi kode (*Safe Deletion*) untuk memastikan integritas sintaks pasca-hapus | US-05, US-06 |

---

##### B. *Development Baseline*

Fokus *Development Baseline* adalah mengimplementasikan setiap komponen Modul Eliminator secara **mandiri dan terisolasi** (T3-01 hingga T3-05). Pada tahap ini, masing-masing komponen dibangun dan divalidasi secara tersendiri sebelum nantinya dirakit bersama di tahap *Refactor Baseline*. Terdapat empat komponen utama yang diimplementasikan:

**1. Mesin Pemotongan Presisi (*Code Cleaner*)** 
Sistem mengadaptasi librari `magic-string` untuk memotong kode mati berdasarkan indeks koordinat absolut `[start, end]` dari AST. Pendekatan ini dipilih dibandingkan *AST Regenerator* karena `magic-string` menjamin **100% format asli terjaga** (termasuk komentar, spasi, dan indentasi yang tidak terkait dengan node mati).

```text
ALGORITMA CodeCleaner_RemoveDeadCode
MASUKAN: codeString (teks sumber), deadNodes (daftar node mati), ruleEngine, eliminationLevel
KELUARAN: cleanedCode (teks sumber yang telah dibersihkan)

1.  JIKA eliminationLevel = 0 (Dry-Run) ATAU deadNodes kosong MAKA
2.      KEMBALIKAN codeString tanpa perubahan  // Simulasi saja, tidak ada mutasi
3.  AKHIR JIKA
4.
5.  INISIALISASI MagicString(codeString) sebagai ms
6.  URUTKAN deadNodes dari indeks TERBESAR ke TERKECIL  // Cegah pergeseran indeks
7.
8.  UNTUK SETIAP deadNode DALAM deadNodes LAKUKAN
9.      [start, end] = deadNode.node.range
10.
11.     // Level 2 & 3: Proteksi API Signature
12.     JIKA tipe adalah ClassMethod, Parameter, atau FunctionDeclaration MAKA
13.         JIKA eliminationLevel >= 2 MAKA
14.             ms.overwrite(bodyStart, bodyEnd, '{}')  // Kosongkan badan fungsi
15.         AKHIR JIKA
16.         LANJUT ke node berikutnya  // TIDAK pernah hapus utuh API Signature
17.     AKHIR JIKA
18.
19.     // Level 3: Penghapusan Agresif
20.     lineStart = PANGGIL findLineStart(codeString, start)
21.     lineEnd   = PANGGIL findLineEnd(codeString, end)
22.
23.     JIKA node menempati SELURUH baris (satu-satunya konten bermakna) MAKA
24.         ms.remove(lineStart, consumeNewline(lineEnd))  // Hapus baris + newline
25.     JIKA TIDAK MAKA
26.         BERSIHKAN koma menggantung (trailing/leading comma) di sekitar node
27.         JIKA sisa baris hanya keyword kosong ("const ;") atau impor kosong ("import {} from") MAKA
28.             ms.remove(lineStart, consumeNewline(lineEnd))  // Hapus baris penuh
29.         JIKA TIDAK MAKA
30.             ms.remove(start, end)  // Hapus hanya node-nya
31.         AKHIR JIKA
32.     AKHIR JIKA
33. AKHIR UNTUK
34.
35. KEMBALIKAN ms.toString()
```

**2. Hierarki Eksekusi Bertingkat (*Elimination Level*)**
Untuk mencegah penghapusan yang sembrono, Eliminator mengadopsi tingkat agresi:
*   **Level 0 (*Dry-Run*):** Hanya menampilkan simulasi tanpa mengubah berkas fisik.
*   **Level 1 & 2 (*Safe Skip & Signature Preservation*):** Tidak menghapus utuh fungsi atau parameter (*Public API*). Sebaliknya, parameter yang tak terpakai direfaktor secara halus (misal: penambahan *underscore* awalan `_param`), dan badan fungsi dikosongkan (`{}`) agar struktur antarmuka tidak rusak.
*   **Level 3 (*Aggressive Delete*):** Penghapusan mutlak untuk variabel, blok kosong, atau *dead branch* berstatus `High + Safe`. Dilengkapi kemampuan pembersihan koma menggantung (*trailing comma*), pembersihan spasi, hingga penghapusan deklarasi/impor kosong (`import {} from 'x'`).

**3. Infrastruktur Keamanan Mutasi**
Sebelum mutasi dijalankan, *Backup Manager* membuat salinan sementara (*snapshot*) dari berkas yang diubah. Jika terdeteksi masalah pasca-eksekusi, *Restore Manager* dapat langsung membatalkan (*rollback*) seluruh perubahan secara atomik.

```text
ALGORITMA BackupManager_CreateBackup
MASUKAN: projectRoot, filesToBackup (daftar berkas), backupPackageJson (opsional)
KELUARAN: backupDir (lokasi direktori pencadangan)

1.  timestamp = AMBIL waktu Unix saat ini
2.  backupDir = projectRoot + "/.deadkiller_backup/backup_" + timestamp
3.  BUAT direktori backupDir
4.
5.  UNTUK SETIAP file DALAM filesToBackup LAKUKAN
6.      JIKA file ada di sistem MAKA
7.          relativePath = PATH.relative(projectRoot, file)
8.          SALIN file ke backupDir/relativePath  // Pertahankan struktur direktori
9.      AKHIR JIKA
10. AKHIR UNTUK
11.
12. JIKA backupPackageJson = True MAKA
13.     SALIN package.json ke backupDir
14. AKHIR JIKA
15.
16. // Rotasi: Hapus sesi backup terlama jika melebihi batas maksimum
17. JIKA jumlah folder backup > maxBackups MAKA
18.     URUTKAN folder dari terlama ke terbaru
19.     HAPUS folder-folder terlama hingga jumlah = maxBackups
20. AKHIR JIKA
21.
22. KEMBALIKAN backupDir
```

```text
ALGORITMA DependencyCleaner_RemoveUnused
MASUKAN: projectRoot, unusedDeps (daftar nama paket NPM yang tidak terpakai)
KELUARAN: removedCount (jumlah dependensi yang berhasil dihapus)

1.  pkg = BACA dan PARSE file package.json dari projectRoot
2.  removedCount = 0
3.
4.  UNTUK SETIAP dep DALAM unusedDeps LAKUKAN
5.      JIKA dep ada di pkg.dependencies MAKA
6.          HAPUS dep dari pkg.dependencies
7.          removedCount = removedCount + 1
8.      AKHIR JIKA
9.      JIKA dep ada di pkg.devDependencies MAKA
10.         HAPUS dep dari pkg.devDependencies
11.         removedCount = removedCount + 1
12.     AKHIR JIKA
13. AKHIR UNTUK
14.
15. JIKA removedCount > 0 MAKA
16.     TULIS pkg yang telah diperbarui kembali ke package.json
17. AKHIR JIKA
18.
19. KEMBALIKAN removedCount
```

---

##### C. Pengujian Awal

Pengujian difokuskan pada stabilitas *source code* pasca-eliminasi. Eliminator diuji untuk memastikan tidak ada *SyntaxError* (seperti koma berlebih atau kurung kurawal yang hilang) yang tertinggal.

**Status Test Case Internal:**
*   [TC-E1] Penghapusan Variabel & Pembersihan Koma Menggantung      ✅ BERHASIL
*   [TC-E2] Refaktor Parameter Aman (*Underscore Prefix*)             ✅ BERHASIL
*   [TC-E3] Proteksi API: Pengosongan *Body* Kelas/Fungsi             ✅ BERHASIL
*   [TC-E4] Pembersihan *Import* Kosong (`import {} from 'lib'`)      ✅ BERHASIL
*   [TC-E5] Mekanisme Backup dan Rollback (*Dry Run*)                 ✅ BERHASIL
─────────────────────────────────────────────────────────────────
Lulus : 5 dari 5 | Integritas Sintaks Pasca-Hapus: 100%

---

##### D. *Self-Review* dan *Refactor Baseline*

Berdasarkan hasil uji coba mutasi kode, *self-review* difokuskan pada dua hal: perbaikan minor dan perakitan seluruh komponen ke dalam satu pipa eksekusi terpadu.

Dari sisi perbaikan, evaluasi menemukan bahwa terkadang penghapusan baris menyisakan spasi putih (*whitespace*) yang kotor. Oleh karena itu, dilakukan refaktor pada fungsi pencarian indeks (`findLineStart` dan `findLineEnd`) agar mampu mendeteksi letak pasti karakter *newline* (`\n` atau `\r\n`), sehingga ketika sebuah deklarasi dihapus seluruhnya, baris kosong tersebut ikut terhapus dan struktur kode tetap estetik.

Selanjutnya, sebagai **titik puncak integrasi Iterasi 3**, tahap *Refactor Baseline* berfokus pada perakitan keempat komponen mandiri yang telah dibangun di tahap *Development Baseline* — *Code Cleaner*, *Elimination Level*, *Backup Manager*, dan *Dependency Cleaner* — ke dalam satu pipa eksekusi `fix` yang kohesif. Tidak berhenti di situ, pipa ini juga diintegrasikan secara langsung dengan komponen dari iterasi-iterasi sebelumnya: **pipeline analisis dari Iterasi 2** (`BuildProjectGraph` dan `FindDeadCode`) digunakan sebagai FASE 1 untuk menyusun daftar anomali, sementara di baliknya, `parseCode()` dan `ParseCache` dari **Iterasi 1** tetap beroperasi secara transparan untuk menjamin *zero re-parsing* selama proses berlangsung.

```text
ALGORITMA EliminatorPipeline (Perintah `fix`)
MASUKAN: projectPath, selectedItems (daftar dead code yang dipilih pengguna)
KELUARAN: Berkas sumber yang telah bersih dari dead code

1.  // FASE 1: Analisis (Memanggil ulang pipeline Iterasi 2, yang di dalamnya menggunakan Core Parser Iterasi 1)
2.  ruleEngine  ← InitializeRuleEngine(projectPath)
3.  graph       ← BuildProjectGraph(projectPath, ruleEngine)  // ← Graph Builder dari Iterasi 2
4.  allIssues   ← FindDeadCode setiap berkas dalam graph.liveFiles  // ← Analyzer dari Iterasi 2; AST-nya di-cache oleh ParseCache Iterasi 1
5.
6.  // FASE 2: Konfirmasi Interaktif (Diff Preview)
7.  TAMPILKAN diff preview (Before vs After) untuk setiap item mati
8.  selectedItems ← TUNGGU konfirmasi pilihan dari pengguna
9.
10. // FASE 3: Backup (Safety Net)
11. affectedFiles ← KUMPULKAN semua berkas unik dari selectedItems
12. backupDir     ← PANGGIL createBackup(projectPath, affectedFiles, backupPackageJson=True)
13.
14. // FASE 4: Eksekusi Mutasi (Code Cleaner)
15. KELOMPOKKAN selectedItems berdasarkan berkas (filePath)
16. UNTUK SETIAP filePath DALAM kelompok LAKUKAN
17.     codeString   ← BACA isi berkas filePath
18.     deadNodes    ← ambil item mati milik filePath
19.     cleanedCode  ← PANGGIL removeDeadCode(codeString, deadNodes, ruleEngine, level=3)
20.     TULIS cleanedCode kembali ke filePath
21. AKHIR UNTUK
22.
23. // FASE 5: Pembersihan Dependensi (Dependency Cleaner)
24. JIKA ada unusedDeps yang dipilih MAKA
25.     PANGGIL removeUnusedDependencies(projectPath, unusedDeps)
26. AKHIR JIKA
27.
28. KEMBALIKAN laporan jumlah berkas yang dimodifikasi
```

Dengan demikian, `EliminatorPipeline` ini adalah wujud nyata dari integrasi tiga iterasi: AST yang diurai oleh *Core Parser* (Iterasi 1), peta dependensi dan daftar anomali yang dihasilkan *Graph Builder* & *Analyzer* (Iterasi 2), serta eksekusi fisik penghapusan yang dilakukan oleh keempat komponen Eliminator (Iterasi 3) — semuanya terhubung dalam satu alur yang berurutan dan terkendali.

---

##### E. *Production Baseline*

Modul Eliminator berhasil mencapai status *production-ready*. Kemampuannya membedah struktur AST menggunakan manipulasi `magic-string` terbukti sangat akurat, tangguh terhadap anomali sisa koma, dan mengutamakan keselamatan *API Signature* proyek pengguna.

Secara arsitektural, Iterasi 3 menandai titik penyempurnaan tiga lapis: **Iterasi 1** menyediakan fondasi *parsing* yang stabil, **Iterasi 2** menghasilkan peta dan daftar anomali yang akurat, dan **Iterasi 3** mengeksekusi keputusan tersebut secara fisik dengan keamanan penuh. Modul ini dinyatakan siap untuk dihubungkan ke tahap akhir, yaitu Pelaporan dan CLI (*Command Line Interface*) di Iterasi 4.

---

##### F. Ringkasan Penyelesaian Task Iterasi 3

| ID Task | Deskripsi | Status | Baseline |
| :--- | :--- | :--- | :--- |
| T3-01 | Implementasi manipulasi AST presisi (`magic-string`) | Selesai | Development |
| T3-02 | Pembangunan hierarki eksekusi (*Elimination Level*) | Selesai | Development |
| T3-03 | Implementasi proteksi struktural (API Signature) | Selesai | Development |
| T3-04 | Implementasi *Dependency Cleaner* (pembersih manifes NPM) | Selesai | Development |
| T3-05 | Pembangunan *Backup* dan *Restore Manager* (Safety Net) | Selesai | Development |
| T3-06 | Pengujian mutasi kode (*Safe Deletion*) integritas sintaks | Selesai | Development |
| T3-07 | Perakitan `EliminatorPipeline` dan integrasi dengan Iterasi 1 & 2 | Selesai | Refactor |
