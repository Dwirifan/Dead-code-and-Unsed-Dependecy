#### 4.4.3 Iterasi 3 : Pengembangan Mekanisme Pembersihan (Modul Eliminator)

Iterasi ketiga difokuskan pada tahap eksekusi fisik, yaitu pembangunan **Modul Eliminator**. Modul ini bertugas menerima data analitik dari *Analyzer* dan secara otomatis (atau terpandu) menghapus *dead code* dari kode sumber dan *package.json* dengan tingkat keamanan mutlak (*zero-breakage guarantee*).

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

Fokus utama adalah merealisasikan fitur penghapusan yang cerdas dan berjenjang (T3-01 hingga T3-05).

**1. Mesin Pemotongan Presisi (*Code Cleaner*)** 
Sistem mengadaptasi librari `magic-string` untuk memotong kode mati berdasarkan indeks koordinat absolut `[start, end]` dari AST. Pendekatan ini dipilih dibandingkan *AST Regenerator* karena `magic-string` menjamin **100% format asli terjaga** (termasuk komentar, spasi, dan indentasi yang tidak terkait dengan node mati).

**2. Hierarki Eksekusi Bertingkat (*Elimination Level*)**
Untuk mencegah penghapusan yang sembrono, Eliminator mengadopsi tingkat agresi:
*   **Level 0 (*Dry-Run*):** Hanya menampilkan simulasi tanpa mengubah berkas fisik.
*   **Level 1 & 2 (*Safe Skip & Signature Preservation*):** Tidak menghapus utuh fungsi atau parameter (*Public API*). Sebaliknya, parameter yang tak terpakai direfaktor secara halus (misal: penambahan *underscore* awalan `_param`), dan badan fungsi dikosongkan (`{}`) agar struktur antarmuka tidak rusak.
*   **Level 3 (*Aggressive Delete*):** Penghapusan mutlak untuk variabel, blok kosong, atau *dead branch* berstatus `High + Safe`. Dilengkapi kemampuan pembersihan koma menggantung (*trailing comma*), pembersihan spasi, hingga penghapusan deklarasi/impor kosong (`import {} from 'x'`).

**3. Infrastruktur Keamanan Mutasi**
Sebelum mutasi dijalankan, *Backup Manager* membuat salinan sementara (*snapshot*) dari berkas yang diubah. Jika terdeteksi masalah pasca-eksekusi, *Restore Manager* dapat langsung membatalkan (*rollback*) seluruh perubahan secara atomik.

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

Berdasarkan hasil uji coba mutasi kode, *self-review* dilakukan pada logika penanganan baris (*line handling*). Evaluasi awal menemukan bahwa terkadang penghapusan baris menyisakan spasi putih (*whitespace*) yang kotor. 

Oleh karena itu, dilakukan refaktor pada fungsi pencarian indeks (`findLineStart` dan `findLineEnd`) di dalam Eliminator agar mampu mendeteksi letak pasti karakter *newline* (`\n` atau `\r\n`). Perbaikan ini memastikan bahwa ketika sebuah deklarasi dihapus seluruhnya, baris kosong tersebut ikut terhapus sehingga struktur kode tetap estetik dan padat.

---

##### E. *Production Baseline*

Modul Eliminator berhasil mencapai status *production-ready*. Kemampuannya membedah struktur AST menggunakan manipulasi *magic-string* terbukti sangat akurat, tangguh terhadap anomali sisa koma, dan mengutamakan keselamatan *API Signature* proyek pengguna. Modul ini dinyatakan siap untuk dihubungkan ke tahap akhir, yaitu Pelaporan dan CLI (*Command Line Interface*) di Iterasi 4.

---

##### F. Ringkasan Penyelesaian Task Iterasi 3

| ID Task | Deskripsi | Status | Baseline |
| :--- | :--- | :--- | :--- |
| T3-01 | Implementasi manipulasi AST presisi (`magic-string`) | Selesai | Development |
| T3-02 | Pembangunan hierarki eksekusi (*Elimination Level*) | Selesai | Development |
| T3-03 | Implementasi proteksi struktural (API Signature) | Selesai | Development |
| T3-04 | Integrasi *Dependency Cleaner* eksekutor manifes NPM | Selesai | Development |
| T3-05 | Pembangunan fitur *Backup* dan *Restore Manager* | Selesai | Development |
| T3-06 | Pengujian mutasi kode (*Safe Deletion*) integritas sintaks | Selesai | Development |
