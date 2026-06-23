#### 4.4.2 Iterasi 2 : Pengembangan Mesin Pemetaan & Analisis (Graph Builder & Analyzer)

Iterasi kedua berfokus pada pembangunan dua komponen analitik sentral: Graph Builder (memetakan dependensi DAG lintas-berkas) dan Analyzer (menginspeksi AST per berkas). Keduanya bekerja sinergis untuk mengekstraksi entitas yang tidak tereferensi secara statis maupun dinamis.

---

##### A. Perencanaan Iterasi dan *TaskPriorityList*

Pengembangan mesin pemetaan dan analisis dipecah menjadi unit tugas teknis berdasarkan spesifikasi *Component Diagram*. Tugas-tugas disusun ke dalam *TaskPriorityList* sebagai berikut:

| Prioritas | ID Task | Deskripsi Task                                                                         | *User Story* |
| --------- | ------- | -------------------------------------------------------------------------------------- | ------------ |
| 1         | T2-01   | Implementasi algoritma Lexical Scoping untuk intra-file analysis                       | US-04        |
| 2         | T2-02   | Implementasi traversal AST menggunakan estraverse                                      | US-04        |
| 3         | T2-03   | Pengujian validasi purwarupa analyzer terhadap konstruksi kode JavaScript              | US-04        |
| 4         | T2-04   | Implementasi Graph Builder (BFS) untuk menyusun dependency graph lintas berkas         | US-03        |
| 5         | T2-05   | Implementasi Unused Dependency Analyzer membandingkan manifes dengan graf pemanggilan  | US-04        |
| 6         | T2-06   | Pengujian integrasi lintas modul (Graph + Analyzer)                                    | US-03, US-04 |
| 7         | T2-07   | Pembangunan Mesin Aturan (Rule Engine) dan integrasi `deadkiller.config.js`            | US-04        |

---

##### B. *Development Baseline*

Fokus utama adalah merealisasikan Task T2-01 hingga T2-07.

**1. Implementasi Scope & Traversal AST** 
Sistem dirancang modular untuk merangkum 15 klasifikasi anomali inti yang dikelompokkan ke dalam 5 kategori utama:
*   **Kode Mati Berbasis Referensi:** Melacak siklus hidup variabel (*Read/Write Differentiation*).
*   **Kode Tak Terjangkau:** Mengevaluasi lintasan eksekusi statis (*Terminator Scan*: `return`, `break`).
*   **Logika Duplikat & Kontradiksi:** Menganalisis semantik dengan algoritma komparasi *Deep AST Equality*.
*   **Kode Redundan:** Mendeteksi instruksi tereksekusi yang tidak mengubah *state* program (penugasan mandiri).
*   **Anomali Lintas-Berkas:** Melacak anomali arsitektural berskala makro (*dead files* atau *unused exports*).

Sistem menerapkan metrik risiko (*Confidence Scoring*) ganda berupa *Confidence* dan *Status* eksekusi (High+Safe, Medium+Review, Low+Risky) yang akan digunakan oleh Modul Eliminator.

Logika traversal untuk mengekstrak anomali variabel dan fungsi lokal dirumuskan dalam algoritma *pseudocode* berikut:

```text
ALGORITMA AST_Analyzer
MASUKAN: ASTNode (Akar dari pohon sintaksis)
KELUARAN: deadCodeList (Daftar anomali kode mati yang ditemukan)

1.  INISIALISASI ScopeManager (pelacak lingkup leksikal)
2.  INISIALISASI deadCodeList
3.
4.  FUNGSI Traverse(node)
5.      JIKA node adalah Deklarasi (Variabel/Fungsi/Parameter) MAKA
6.          ScopeManager.Register(node.identifier)
7.      AKHIR JIKA
8.
9.      JIKA node adalah Pemanggilan (Identifier/MemberExpression) MAKA
10.         ScopeManager.MarkAsRead(node.identifier)
11.     AKHIR JIKA
12.
13.     UNTUK SETIAP childNode DALAM node.children LAKUKAN
14.         Traverse(childNode) // Rekursi menelusuri anak node
15.     AKHIR UNTUK
16. AKHIR FUNGSI
17.
18. Traverse(ASTNode)
19. 
20. UNTUK SETIAP scope DALAM ScopeManager LAKUKAN
21.     UNTUK SETIAP variable DALAM scope LAKUKAN
22.         JIKA variable TIDAK PERNAH DIBACA (Unread) MAKA
23.             TAMBAHKAN variable ke deadCodeList dengan label "Unused Variable"
24.         AKHIR JIKA
25.     AKHIR UNTUK
26. AKHIR UNTUK
27.
28. KEMBALIKAN deadCodeList
```

**2. Implementasi Mesin Pemetaan (Graph Builder)**
Memetakan struktur proyek ke dalam *Directed Acyclic Graph* (DAG) via algoritma *Breadth-First Search* (BFS). Subsistem ini dibekali kecerdasan:
*   **Entry Point Finder:** Mendeteksi kerangka kerja proyek secara otomatis.
*   **Path Resolver:** Mengadaptasi algoritma `enhanced-resolve` untuk menerjemahkan matriks impor kompleks.
*   **Pemetaan BFS:** Mengekstrak impor, merekam pustaka NPM ke himpunan `usedPackages`, dan mencegah *circular dependency*.

Untuk memvalidasi perancangan ini secara akademis, alur kerja pemetaan graf dirumuskan ke dalam algoritma *pseudocode* berikut:

```text
ALGORITMA GraphBuilderBFS
MASUKAN: entryPoint (jalur berkas utama)
KELUARAN: dependencyGraph (Graf relasi proyek), usedPackages (himpunan pustaka NPM)

1.  INISIALISASI antrean (queue) Q
2.  INISIALISASI himpunan visitedFiles
3.  INISIALISASI himpunan usedPackages
4.  TAMBAHKAN entryPoint ke dalam Q dan visitedFiles
5.
6.  SELAMA Q tidak kosong, LAKUKAN:
7.      currentFile = DEQUEUE(Q)
8.      AST = ParseAST(currentFile)
9.      imports = ExtractImports(AST)
10.
11.     UNTUK SETIAP importItem DALAM imports:
12.         JIKA importItem adalah Pustaka NPM MAKA
13.             TAMBAHKAN importItem ke usedPackages
14.         TETAPI JIKA importItem adalah Berkas Lokal MAKA
15.             resolvedPath = ResolvePath(currentFile, importItem)
16.             TAMBAHKAN edge(currentFile -> resolvedPath) ke dependencyGraph
17.             JIKA resolvedPath BELUM ADA DI visitedFiles MAKA
18.                 TAMBAHKAN resolvedPath ke visitedFiles
19.                 ENQUEUE(Q, resolvedPath)
20.             AKHIR JIKA
21.         AKHIR JIKA
22.     AKHIR UNTUK
23. AKHIR SELAMA
24.
25. KEMBALIKAN dependencyGraph, usedPackages
```

**3. Implementasi Unused Dependency Analyzer**
Modul ini bertugas untuk mendeteksi pustaka eksternal (NPM *packages*) yang terinstal di dalam proyek namun tidak pernah dipanggil di dalam *source code*. Implementasinya bekerja dengan membaca daftar *dependencies* dari berkas `package.json` milik pengguna. Sistem kemudian melakukan komparasi himpunan matematika (*set difference*) dengan membandingkan daftar dependensi tersebut terhadap himpunan `usedPackages` (daftar *package* yang dipanggil via sintaks `import`/`require`) yang telah dikumpulkan secara dinamis oleh *Graph Builder*. Dependensi yang tidak beririsan akan langsung ditandai sebagai *unused dependency*.

```text
ALGORITMA UnusedDependencyAnalysis
MASUKAN: packageJson, usedPackages (Himpunan package yang di-import)
KELUARAN: unusedDependencies (Daftar dependensi mubazir)

1. allDependencies = GABUNGKAN(packageJson.dependencies, packageJson.devDependencies)
2. unusedDependencies = Himpunan Kosong
3. UNTUK SETIAP dep DI DALAM allDependencies LAKUKAN
4.     JIKA dep TIDAK ADA DI DALAM usedPackages MAKA
5.         TAMBAHKAN dep KE unusedDependencies
6.     AKHIR JIKA
7. AKHIR UNTUK
8. KEMBALIKAN unusedDependencies
```

**4. Implementasi Mesin Aturan (*Rule Engine*)**
Mesin aturan dibangun sebagai lapisan pelindung (*safeguard*) agar analisis kode tidak menghapus entitas yang krusial secara tidak sengaja. *Rule Engine* bekerja dengan memuat konfigurasi dari berkas `deadkiller.config.js`. Implementasi utamanya mencakup tiga logika pengecualian: 1) Perlindungan variabel berdasarkan pola Regex (misalnya menahan variabel berawalan `_`), 2) Pengecualian berkas secara manual melalui array `preserveFiles`, dan 3) *Framework Mode Aware*, yakni kemampuan mesin untuk mengenali proyek berbasis *framework* (seperti React/Next.js) lalu secara otomatis kebal terhadap folder-folder sensitif seperti `pages/`, `app/`, maupun `public/` tanpa mengharuskan pengguna melakukan konfigurasi manual yang rumit.

```text
ALGORITMA RuleEngine_IsIgnored
MASUKAN: entityName (Nama variabel/fungsi), filePath (Lokasi berkas), rules (Objek konfigurasi)
KELUARAN: Boolean (True jika diselamatkan, False jika dieksekusi mati)

1. // Cek Pengecualian Framework (Framework-aware protection)
2. JIKA filePath COCOK DENGAN pola direktori bawaan framework (rules.mode) MAKA
3.     KEMBALIKAN True
4. AKHIR JIKA
5. 
6. // Cek Pengecualian Berkas Manual
7. JIKA filePath ADA DI DALAM rules.preserveFiles MAKA
8.     KEMBALIKAN True
9. AKHIR JIKA
10. 
11. // Cek Perlindungan Variabel Berbasis Pola (Regex)
12. JIKA Regex(rules.ignorePrefixedVariables) COCOK DENGAN entityName MAKA
13.    KEMBALIKAN True
14. AKHIR JIKA
15. 
16. KEMBALIKAN False
```

---

##### C. Pengujian Awal

Pengujian komprehensif diotomatisasi melalui Native Test Runner Node.js (`node --test`). Karena implementasi difokuskan pada keandalan logika sejak awal, hasil pengujian langsung menunjukkan performa yang stabil.

**1. Validasi Akurasi Logika Analyzer (Intra-file)**
Proses mencocokkan hasil deteksi Tabel Simbol dengan *expected output* mencatat akurasi 100%, termasuk pada penanganan *edge cases* seperti *hoisting* dan antarmuka TypeScript. Modul *Confidence Scoring* juga terverifikasi sukses memberikan atribusi tingkat keamanan secara presisi.

**Status Test Case Internal:**
*   [TC-A1 — TC-A4] Deklarasi Dasar & Penugasan Buntu  ✅ BERHASIL
*   [TC-A5 — TC-A8] Penelusuran Scope Bercabang         ✅ BERHASIL
*   [TC-A9 — TC-A10] Edge Case (TS Namespace & Enum)    ✅ BERHASIL
─────────────────────────────────────────────────────────────────
Lulus : 10 dari 10 | Akurasi: 100%

**2. Validasi Mesin Pemetaan & Dependensi Usang**
Algoritma BFS dan komputasi silang manifes beroperasi dengan presisi pemetaan relasi 100%.

```text
[TC-G1] BFS Traversal & Entry Point Finder        BERHASIL
[TC-G2] Barrel Export (index.js) Resolver         BERHASIL
[TC-G3] Set Difference: Unused Dependencies       BERHASIL
─────────────────────────────────────────────────────────────────
Pemetaan Graf 100% Presisi (Tidak ada relasi terputus)
```

---

##### D. *Self-Review* dan *Refactor Baseline*

Berdasarkan hasil pengujian awal yang lulus 100%, tahap *self-review* hanya berfokus pada pembersihan kode (*Clean Code*) untuk memastikan modularitas arsitektur, tanpa perlu melakukan perbaikan *bug*.

Selanjutnya, tahap *Refactor Baseline* difokuskan pada penyatuan fase pemetaan dan analisis ke dalam satu pipa eksekusi terpadu (*Integration Pipeline*):

```text
Algorithm CodeAnalysisPipeline
Begin
    // FASE 1: PEMETAAN (GRAPH BUILDER)
    ruleEngine ← InitializeRuleEngine(projectPath)
    graph ← BuildProjectGraph(projectPath, ruleEngine)
    deadFiles ← FindUnreachableFiles(projectPath, graph.liveFiles)
    
    // FASE 2: BEDAH MANIFES (DEPENDENCY ANALYZER)
    unusedDeps ← AnalyzeDependencies(projectPath, graph.usedPackages)
    
    // FASE 3: BEDAH INTERNAL KODE (DEAD CODE ANALYZER)
    issues ← EmptyList()
    For Each file in graph.liveFiles Do
        ast ← ParseFileWithCache(file) 
        fileIssues ← AnalyzeDeadCode(ast, file)
        issues.add(fileIssues)
    End For
    
    Return { deadFiles, unusedDeps, issues }
End
```

Integrasi arsitektural (*Integration Pipeline*) ini merupakan titik puncak bertemunya seluruh komponen yang telah kita bangun. Pipa eksekusi ini berhasil menyatukan **keempat komponen utama Iterasi 2** (AST Traversal, *Graph Builder*, *Dependency Analyzer*, dan *Rule Engine*) ke dalam satu alur yang kohesif. 

Tidak hanya itu, pipa ini juga diintegrasikan langsung dengan **Core Parser dan ParseCache dari Iterasi 1** (pada pemanggilan fungsi `ParseFileWithCache`). Sinergi ini memastikan bahwa tugas *parsing* AST yang memakan memori sangat intensif hanya perlu dieksekusi satu kali per berkas, sehingga mampu memangkas beban komputasi secara maksimal dan mencegah terjadinya kelebihan beban (*memory overhead*).

Secara teknis, implementasi penyatuan ini dieksekusi di dalam modul orkestrator utama (yakni `deadCodeAnalyzer.js`). Alur kerja *Single-Pass Parsing* tersebut dirancang sebagai berikut:

```text
ALGORITMA SinglePassAnalyzer
MASUKAN: liveFiles (Daftar berkas aktif dari Graph Builder), ruleEngine
KELUARAN: deadCodeIssues (Himpunan anomali dead code)

1. deadCodeIssues = Himpunan Kosong
2. UNTUK SETIAP filePath DI DALAM liveFiles LAKUKAN SECARA ASINKRON
3.     // Integrasi Iterasi 1: Memanggil parser dengan dukungan cache
4.     astObjek = PANGGIL parseCode(filePath)
5.     
6.     JIKA astObjek DIAMBIL DARI cache MAKA
7.         LEWATI proses re-parsing (Hemat Memori CPU)
8.     AKHIR JIKA
9.     
10.    // Integrasi Iterasi 2: Menganalisis AST
11.    fileIssues = PANGGIL analyzeAstCode(astObjek, ruleEngine)
12.    
13.    TAMBAHKAN fileIssues KE deadCodeIssues
14. AKHIR UNTUK
15. KEMBALIKAN deadCodeIssues
```

Penerapan *Single-Pass Parsing Architecture* ini terbukti sukses menjembatani *parser* (Iterasi 1) dengan *analyzer* (Iterasi 2) secara mulus dan sangat efisien.

---

##### E. *Production Baseline*

Arsitektur akhir beroperasi secara optimal dan stabil. *Graph Builder* dan *Analyzer* sukses mengekstraksi seluruh 15 klasifikasi anomali secara presisi. Modul pemetaan dan analisis ini dinyatakan siap sebagai bekal menuju tahap eksekusi fisik penghapusan (*Modul Eliminator*) di Iterasi 3.

---

##### F. Ringkasan Penyelesaian Task Iterasi 2

| ID Task | Deskripsi | Status | Baseline |
| :--- | :--- | :--- | :--- |
| T2-01 | Implementasi algoritma Lexical Scoping untuk intra-file analysis | Selesai | Development |
| T2-02 | Implementasi traversal AST menggunakan estraverse | Selesai | Development |
| T2-03 | Pengujian validasi purwarupa analyzer terhadap konstruksi kode JavaScript | Selesai | Development |
| T2-04 | Implementasi Graph Builder (BFS) untuk menyusun dependency graph lintas berkas | Selesai | Development |
| T2-05 | Implementasi Unused Dependency Analyzer membandingkan manifes dengan graf | Selesai | Development |
| T2-06 | Pengujian integrasi lintas modul (Graph + Analyzer) | Selesai | Development |
| T2-07 | Pembangunan Mesin Aturan (Rule Engine) | Selesai | Development |
