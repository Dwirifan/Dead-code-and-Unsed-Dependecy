#### 4.4.3 Iterasi 3: Pembangunan Eliminator dan Mekanisme Penghapusan Aman

Iterasi ketiga difokuskan pada tahap eksekusi fisik melalui pembangunan **Modul Eliminator**. Modul ini menerima hasil analisis dari *Analyzer*, kemudian melakukan mutasi terhadap kandidat *dead code* pada kode sumber serta kandidat dependensi yang telah dikonfirmasi pengguna.

Iterasi 3 menjadi lapisan eksekusi yang memanfaatkan keluaran Iterasi 1, yaitu Modul *Core Parser*, dan Iterasi 2, yaitu Modul *Graph Builder* dan *Analyzer*.

---

##### A. Tahap Perencanaan (Planning)

Pengembangan modul Eliminator menuntut kehati-hatian tinggi karena melibatkan mutasi *source code* secara langsung. Tugas-tugas disusun ke dalam *Task Priority List* sebagai berikut:

| Prioritas | ID Task | Deskripsi Task | *User Story* |
| --------- | ------- | -------------- | ------------ |
| 1 | T3-01 | Implementasi manipulasi kode sumber berbasis rentang AST menggunakan `magic-string` | US-05 |
| 2 | T3-02 | Pembangunan hierarki eksekusi (*Elimination Level*) | US-05 |
| 3 | T3-03 | Implementasi proteksi struktur fungsi, metode kelas, dan parameter | US-05 |
| 4 | T3-04 | Integrasi *Dependency Cleaner* (eksekusi CLI package manager) | US-05 |
| 5 | T3-05 | Pembangunan fitur *Backup* dan *Restore Manager* | US-05 |
| 6 | T3-06 | Pengujian mutasi kode (*Safe Deletion*) dan integritas sintaks | US-05 |
| 7 | T3-07 | Perakitan `EliminatorPipeline` terintegrasi | US-05 |

Selain pembagian tugas, tahap perencanaan ini juga merumuskan **Kriteria Keberhasilan Iterasi**. Rencana pengujian disepakati di awal untuk memvalidasi empat aspek utama keamanan mutasi:
1. Kesesuaian pemotongan menggunakan pustaka `magic-string` berdasarkan rentang AST.
2. Perlindungan struktur fungsi, metode kelas, dan parameter sesuai hierarki *Elimination Level*.
3. Stabilitas deteksi dan eksekusi penghapusan pustaka pada *package manager* (`npm`, `yarn`, `pnpm`, `bun`).
4. Integritas pencadangan berkas (*Backup Manager*) dan pemulihan (*Restore Manager*).

Keempat aspek tersebut kemudian dijabarkan ke dalam cakupan pengujian, sebagaimana ditunjukkan pada tabel berikut.

**Tabel 4.x Rencana Cakupan Pengujian Modul Eliminator**

| Kelompok Uji | Cakupan Skenario | Tujuan Pengujian |
| :--- | :--- | :--- |
| **Pemotongan Berbasis Koordinat (*Code Cleaner*)** | Penghapusan deklarasi variabel, *import*, dan pembersihan koma sisa (*dangling comma*). | Memvalidasi kemampuan `magic-string` dalam menghapus bagian spesifik teks sumber kode berdasarkan koordinat AST. |
| **Proteksi Struktural (*API Signature*)** | Pengosongan badan fungsi atau metode kelas dan proteksi posisi parameter. | Menguji mekanisme *safe refactor* pada struktur yang berpotensi memengaruhi antarmuka sistem apabila dihapus secara utuh. |
| **Pembersihan Dependensi (*Dependency Cleaner*)** | Deteksi dinamis berkas *lock* (`yarn.lock`, dll) dan eksekusi perintah terminal `uninstall`/`remove`. | Memastikan sistem dapat mencabut paket melalui *package manager* yang digunakan oleh proyek. |
| **Infrastruktur Pemulihan (*Backup & Restore*)** | Pembuatan arsip `.deadkiller_backup`, pelacakan *timestamp*, dan rekonstruksi ke direktori asli. | Memvalidasi bahwa proses mutasi dapat dibatalkan secara presisi kapan saja tanpa menyebabkan korupsi data proyek. |

---

##### B. Tahap Perancangan (Design)

Mekanisme keamanan pada Modul *Eliminator* dirancang menggunakan perlindungan berlapis yang menggabungkan pendekatan prosedural (*user-in-the-loop*) dan perlindungan integritas struktural kode.

**1. Keamanan Prosedural (*User-in-the-Loop*)**
Mekanisme ini dirancang sebagai lapisan pengaman sebelum proses penghapusan dilakukan. Pendekatan ini diterapkan karena sistem bekerja dengan metode analisis statis yang memiliki keterbatasan dalam mengenali pola dinamis (seperti `eval()`, *dynamic imports*, *callback*, atau manipulasi objek global saat *runtime*). Oleh karena itu, sistem tidak langsung menghapus kode yang terindikasi mati secara otomatis, melainkan melibatkan validasi pengguna melalui tiga prinsip:
*   **Pencegahan Kesalahan Positif (*False-Positive Prevention*):** Sistem menampilkan ringkasan metrik temuan sebelum Modul Eliminator dijalankan, memberikan kesempatan bagi pengguna untuk membatalkan proses apabila terdapat berkas dinamis yang terdeteksi sebagai *dead code*.
*   **Pemaparan Status Risiko (*Risk Status Exposure*):** Sistem memanfaatkan data *unsafeFiles* dan atribut status pada objek AST untuk menampilkan kategori risiko (*safe*, *review*, *risky*). Kategori ini membantu pengguna membedakan temuan yang aman dihapus dan yang perlu ditinjau manual.
*   **Integritas Pemulihan (*Rollback Integrity*):** Sebelum eksekusi penghapusan, sistem membuat cadangan (*backup*). Mekanisme ini memungkinkan pengembalian proyek ke kondisi semula apabila terjadi anomali fungsional pascapembersihan.

**2. Proteksi Integritas Struktural**
Setelah pengguna memberikan konfirmasi, sistem mengeksekusi mutasi fisik dengan prinsip perlindungan struktur kode. Berbeda dari pendekatan yang menghasilkan ulang seluruh kode sumber dari AST, sistem membatasi mutasi menggunakan:
*   **Mutasi Berbasis Koordinat:** Modul *Code Cleaner* menggunakan indeks rentang (*range*) awal dan akhir dari setiap *node* AST untuk menghapus teks, meminimalkan perubahan format pada karakter di sekitarnya.
*   **Proteksi Struktur Antarmuka (*API Signature Protection*):** Sistem mempertimbangkan hierarki fungsi, metode kelas, dan parameter. Parameter yang tidak digunakan tidak langsung dihapus (karena merusak urutan argumen), melainkan ditangani sesuai *Elimination Level* (misalnya disamarkan dengan prefiks `_`).


##### C. Tahap Pengkodean (Coding)

Pada tahap ini, komponen utama diimplementasikan secara terisolasi dan dirakit menjadi pipeline:

**1. Mesin Pemotongan (*Code Cleaner*) & *Elimination Level***
Sistem menggunakan pustaka `magic-string` untuk memodifikasi kode sumber berdasarkan rentang indeks yang diperoleh dari node AST. Pendekatan ini memungkinkan perubahan difokuskan pada bagian kode yang menjadi target dan meminimalkan perubahan format pada bagian lainnya.

```javascript
// src/eliminator/codeCleaner.js
export function removeDeadCode(codeString, deadNodes, ruleEngine, eliminationLevel = 3) {
  if (eliminationLevel === 0 || !deadNodes?.length) return codeString;

  const ms = new MagicString(codeString);
  const sortedNodes = [...deadNodes].sort((a, b) => b.node.range[0] - a.node.range[0]);

  for (const dead of sortedNodes) {
    const [start, end] = dead.node.range;

    // Perlindungan API Signature berdasarkan Elimination Level
    if (['ClassMethod', 'Parameter', 'Function'].includes(dead.type)) {
      if (eliminationLevel >= 2) {
        if (dead.type === 'Function' && dead.node.body?.range) {
          ms.overwrite(dead.node.body.range[0], dead.node.body.range[1], '{}');
        } else if (dead.type === 'ClassMethod' && dead.node.value?.body?.range) {
          ms.overwrite(dead.node.value.body.range[0], dead.node.value.body.range[1], '{}');
        } else if (dead.type === 'Parameter') {
          ms.prependRight(start, '_');
        }
      }
      continue;
    }

    // Mutasi agresif untuk temuan non-API (misal: variabel, import)
    ms.remove(start, end);
  }
  return ms.toString();
}
```

Mekanisme dasar mutasi berdasarkan rentang node. Pemeriksaan status risiko, aturan `autoRenameUnusedParameters`, penanganan token sisa, dan perbedaan perilaku setiap *Elimination Level* ditangani pada implementasi lengkap.

**2. Infrastruktur Keamanan Mutasi (*Backup Manager* & *Dependency Cleaner*)**
Sebelum mutasi dijalankan, `BackupManager` membuat salinan sementara (*snapshot*). Selain itu, `DependencyCleaner` diimplementasikan untuk mendeteksi *package manager* (`npm`, `yarn`, `pnpm`, `bun`) secara otomatis dan mengeksekusi penghapusan secara sinkron.

```javascript
// src/eliminator/dependencyCleaner.js
export async function removeUnusedDependencies(projectRoot, unusedDeps) {
  const validDeps = unusedDeps?.filter(dep => /^[a-zA-Z0-9\-_.@/]+$/.test(dep));
  if (!validDeps?.length) return 0;

  // Resolusi perintah secara dinamis (npm, yarn, pnpm, bun) berdasarkan lockfile
  const { cmd, args } = await resolvePackageManagerCommand(projectRoot, 'remove');
  
  const result = spawnSync(cmd, [...args, ...validDeps], { cwd: projectRoot, stdio: 'ignore' });
  if (result.error || result.status !== 0) {
    throw new Error(`Penghapusan dependensi gagal dijalankan.`);
  }

  return validDeps.length;
}
```

Modul `BackupManager` (diimplementasikan pada `src/eliminator/backupManager.js`) bertugas memelihara stabilitas eksekusi dengan menyalin berkas asli ke dalam brankas terisolasi (`.deadkiller_backup`) beserta atribut *timestamp* sesinya sebelum mutasi fisik dipanggil.

Untuk melengkapi siklus perlindungan data ini, Modul Eliminator terintegrasi dengan `RestoreManager` (`src/eliminator/restoreManager.js`) dan antarmuka perintah riwayat (`historyCommand.js`). Mekanisme tersebut mendelegasikan wewenang pemulihan secara penuh kepada pengguna, memungkinkan pengembalian (*rollback*) proyek secara presisi ke kondisi *checkpoint* sebelumnya apabila ditemukan anomali fungsional pascapembersihan.

**3. Perakitan Pipa Eliminasi (*Eliminator Pipeline*)**
Tahap ini merakit komponen-komponen ke dalam modul orkestrator `fixCommand.js`, sekaligus melakukan integrasi sistem secara menyeluruh dengan hasil luaran dari fase analisis.

```javascript
// src/commands/fixCommand.js
// 1. Fase Analisis (Integrasi Iterasi 2)
const graph = await buildProjectGraph(absolutePath, ruleEngine);
const issues = await runStaticAnalysis(graph, ruleEngine); // Menelusuri seluruh liveFiles
const depReport = await findUnusedDependencies(absolutePath, graph.usedPackages, ruleEngine);

// 2. Fase Konfirmasi Pengguna
const { confirm } = await promptUserForApproval(issues, depReport);
if (!confirm) return;

// 3. Fase Mutasi (Iterasi 3)
const filesToBackup = [...new Set(issues.map(i => i.file))];
await createBackup(absolutePath, filesToBackup, true); // True: sertakan manifes proyek

const issuesByFile = groupIssuesByFile(issues);
for (const [file, fileIssues] of issuesByFile) {
  const code = await fs.readFile(file, 'utf-8');
  const cleanedCode = removeDeadCode(code, fileIssues, ruleEngine, eliminationLevel);
  await fs.writeFile(file, cleanedCode, 'utf-8');
}

await removeUnusedDependencies(absolutePath, depReport.unusedDevelopment);
```

Orkestrasi utama memastikan bahwa proses mutasi fisik tidak akan pernah dieksekusi sebelum seluruh rantai analisis AST dan pemetaan graf selesai, serta mendapatkan persetujuan eksplisit dari pengguna. Pada cuplikan tersebut, penghapusan otomatis dibatasi pada kandidat `unusedDevelopment`. Kandidat `unusedRuntime` tetap disajikan sebagai temuan untuk ditinjau pengguna karena penghapusan dependensi produksi memiliki risiko lebih tinggi terhadap fungsionalitas aplikasi.

---

##### D. Tahap Pengujian (Testing)

Pengujian difokuskan pada empat aspek utama sesuai dengan rencana uji: 
1. **Pemotongan Berbasis Koordinat (*Code Cleaner* - 5 Test Cases):** Memastikan proses pemotongan teks tidak meninggalkan koma menggantung (*dangling comma*) dan membersihkan sisa deklarasi kosong tanpa merusak format asli.
2. **Proteksi Struktural (*API Signature* - Terintegrasi di *Code Cleaner*):** Memastikan pergantian nama parameter dengan prefiks `_` berjalan aman dan pengosongan badan fungsi tidak memicu galat sintaks (*SyntaxError*).
3. **Ketahanan Modul Eksternal (*Dependency Cleaner* - 7 Test Cases):** Memastikan sistem mampu mendeteksi berbagai jenis *lockfile* secara dinamis dan meluncurkan perintah eksekusi yang tepat (NPM, Yarn, PNPM, atau Bun) tanpa menyebabkan korupsi pada berkas `package.json`.
4. **Infrastruktur Pemulihan (*Backup & Restore* - 6 Test Cases):** Memvalidasi pembentukan brankas isolasi `.deadkiller_backup`, pelacakan *timestamp*, fitur rotasi pencadangan (*rolling cleanup*), dan pengembalian (*rollback*) proyek secara presisi.

Hasil pengujian menggunakan *Vitest* menunjukkan bahwa seluruh 18 skenario yang didefinisikan berhasil dilalui. Hasil tersebut menunjukkan bahwa Modul Eliminator menghasilkan keluaran sesuai dengan skenario pengujian unit yang ditetapkan, tetapi belum cukup untuk menyatakan bahwa seluruh proses eliminasi bebas dari kegagalan pada proyek nyata.

*(Bukti eksekusi unit test pada modul Eliminator dapat dilihat pada gambar di bawah ini)*

**[MASUKKAN SCREENSHOT HASIL VITEST `npx vitest run test/eliminator/` DI SINI]**

---

##### E. Evaluasi Iterasi
Modul *Eliminator* berhasil diimplementasikan melalui komponen *Code Cleaner*, *Dependency Cleaner*, *Backup Manager*, dan *Restore Manager*. Komponen tersebut dirangkai menjadi pipa eliminasi yang menerima hasil analisis dari iterasi sebelumnya, menampilkan kandidat perubahan, dan menjalankan mutasi setelah memperoleh persetujuan pengguna.

Seluruh 18 skenario unit yang didefinisikan berhasil dilalui. Hasil tersebut menunjukkan bahwa pemotongan kode berbasis rentang AST, proteksi struktur tertentu, pemilihan perintah *package manager*, serta mekanisme pencadangan dan pemulihan telah menghasilkan keluaran sesuai dengan skenario pengujian. Namun, hasil pengujian unit belum cukup untuk menyatakan bahwa seluruh proses eliminasi bebas dari kegagalan pada proyek nyata yang lebih kompleks.

Pencapaian Iterasi 3 menunjukkan bahwa sistem telah berkembang dari tahap analisis menuju mekanisme remediasi semi-otomatis. Dengan demikian, Modul *Eliminator* dinyatakan selesai dalam cakupan iterasi ini dan siap dilanjutkan dengan penyempurnaan antarmuka CLI serta pengembangan Modul Reporter pada Iterasi 4. Kelayakan penggunaan secara lebih luas tetap ditentukan melalui pengujian integrasi dan pengujian akhir sistem.

| ID Task | Deskripsi | Status | Keterangan |
| :--- | :--- | :--- | :--- |
| T3-01 | Implementasi manipulasi kode sumber berbasis rentang AST menggunakan `magic-string` | Selesai | Terintegrasi |
| T3-02 | Pembangunan hierarki eksekusi (*Elimination Level*) | Selesai | Terintegrasi |
| T3-03 | Implementasi proteksi struktur fungsi, metode kelas, dan parameter | Selesai | Terintegrasi |
| T3-04 | Implementasi *Dependency Cleaner* & Auto-Detection | Selesai | Terintegrasi |
| T3-05 | Pembangunan *Backup* & *Restore Manager* (Safety Net) | Selesai | Terintegrasi |
| T3-06 | Pengujian mutasi kode dan integritas sintaks | Selesai | Lulus Uji |
| T3-07 | Perakitan `EliminatorPipeline` terintegrasi | Selesai | Terintegrasi |
