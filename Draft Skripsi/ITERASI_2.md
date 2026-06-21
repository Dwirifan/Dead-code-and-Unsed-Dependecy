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
| 7         | T2-07   | Pembangunan Mesin Aturan (Rule Engine) dan integrasi `.deadkillerrc.json`              | US-04        |

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

**2. Mesin Pemetaan (Graph Builder)**
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

**3. Unused Dependensi Analyzer & Rule Engine**
Sistem membandingkan array dependensi `package.json` dengan himpunan `usedPackages` hasil pemetaan graf. *Rule Engine* dibangun untuk mengecualikan direktori spesifik (seperti `node_modules/`) atau variabel yang dilindungi (*framework mode*).

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

Integrasi arsitektural ini memastikan parser yang memakan memori intensif hanya dieksekusi satu kali per berkas, sehingga mampu memangkas beban komputasi secara maksimal.

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
