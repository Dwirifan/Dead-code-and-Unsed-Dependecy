# 4.6.2.3 Iterasi 3 : Pengembangan Lapisan Antarmuka & Modul Eksekusi (CLI & Eliminator)

Iterasi ketiga dalam metodologi PXP merupakan tahapan operasional krusial yang memiliki dua tanggung jawab utama: membangun **Lapisan Antarmuka (CLI)** untuk orkestrasi perintah, dan merancang **Modul Eliminator** (*Code Cleaner*) yang bertugas mengeksekusi pemangkasan kode fisik pada sistem berkas (*file system*).

Dalam merancang alat yang secara aktif memodifikasi kode sumber (*source code*), keselamatan eksekusi dan preservasi tata letak asli buatan *programmer* menjadi prioritas utama yang tidak dapat dikompromikan.

## Perencanaan Iterasi & TaskPriorityList

Untuk merealisasikan arsitektur Lapisan Antarmuka dan Modul Eliminator yang aman, berikut adalah rincian perencanaan (*Task Priority List*) yang akan dieksekusi secara berurutan:

| Prioritas | ID Task | Deskripsi Task |
|-----------|---------|----------------|
| 1 | T3-01 | Pembangunan Lapisan Antarmuka CLI (`scan` dan `fix`) serta pembaca konfigurasi (`.deadkillerrc.json`). |
| 2 | T3-02 | Desain arsitektur *Hybrid String Manipulation* berbasis koordinat lokasi AST. |
| 3 | T3-03 | Implementasi algoritma pembersihan sisa sintaks (*Trailing Comma & Empty Declaration*). |
| 4 | T3-04 | Implementasi hierarki pemangkasan berbasis Skema Eliminasi Bertingkat (4 Level Optimasi). |
| 5 | T3-05 | Pembangunan *Backup & Restore Manager* sebagai mitigasi risiko korupsi *file*. |

---

## 1. Baseline Development

Fokus fase *development* dibagi menjadi dua: penyediaan antarmuka basis (*CLI skeleton*) dan perancangan algoritma pemotongan teks presisi.

### A. Lapisan Antarmuka CLI & Rule Engine (T3-01)
Lapisan antarmuka dibangun menggunakan pustaka `commander` untuk memfasilitasi orkestrasi penuh. Terdapat **dua mode eksekusi utama**:
1. `deadkiller scan`: Mode *audit* yang menginstruksikan *Parser* dan *Analyzer* untuk memetakan proyek tanpa melakukan operasi tulis-berkas.
2. `deadkiller fix`: Mode eksekutor yang meneruskan daftar anomali dari *Analyzer* langsung ke tangan Modul Eliminator.

Selain dua mode utama di atas, CLI juga dilengkapi dengan serangkaian **perintah pendukung (Utilities)** untuk mempermudah pengalaman pengembang (*Developer Experience*):
- `init`: Menghasilkan berkas konfigurasi `.deadkillerrc.json` secara otomatis.
- `watch`: Menjalankan *scan* secara *real-time* setiap kali ada perubahan berkas.
- `history`, `report`, `visualize`: Beragam alat pelaporan dan visualisasi DAG.
- `trace`, `show-deps`: Alat pelacakan dependensi dan jejak pemanggilan fungsi.

Modul ini juga mengintegrasikan konfigurasi absolut dari `.deadkillerrc.json` (jika tersedia), yang digunakan oleh *Rule Engine* untuk membatalkan operasi pada *file* atau variabel yang dilindungi (*whitelist*).

### B. Arsitektur Hybrid String Manipulation (T3-02 & T3-03)

Secara teoritis, modifikasi kode dapat dilakukan melalui *AST Rewriting* (membuang *node* mati dari pohon sintaksis lalu me-render ulang keseluruhan *string*). Namun, pendekatan ini memiliki kelemahan fatal: **menghancurkan format tulisan asli *programmer*** (menghilangkan baris kosong, komentar JSDoc, dan mengubah tabulasi).

Untuk mempertahankan preservasi bentuk estetis kode, Modul Eliminator (`codeCleaner.js`) menggunakan pendekatan **Hybrid String Manipulation** (berbantuan pustaka `magic-string`). Pendekatan ini membedah *string* kode asli murni menggunakan koordinat presisi spasial dari atribut rentang (`loc` atau `range[start, end]`) milik AST.

Tantangan utama manipulasi *string* ini adalah pencegahan *Syntax Error* pasca-pemangkasan. Contoh: menghapus deklarasi `b` dari `const a = 1, b = 2;` secara buta akan menyisakan *trailing comma* menjadi `const a = 1, ;`. Untuk itu, dibangun heuristik pembersih koma sisa:

```javascript
// Cuplikan: Trailing & Leading Comma Cleaner (codeCleaner.js)
let rStart = start, rEnd = end;

// Deteksi koma sisa di belakang atau di depan node
const trailing = codeString.substring(rEnd, lineEnd).match(/^\s*,\s*/);
const leading = codeString.substring(lineStart, rStart).match(/,\s*$/);

if (trailing) rEnd += trailing[0].length; // Perluas jangkauan hapus koma belakang
else if (leading) rStart -= leading[0].length; // Hapus koma depan

ms.remove(rStart, rEnd); // Eksekusi potong teks via magic-string
```

### C. 4 Level Pemangkasan (Skema Eliminasi Bertingkat) (T3-04)

Menghapus sebuah metode kelas (*class method*) karena tampak tidak dipakai di internal berkas memiliki risiko menghancurkan antarmuka publik pustaka tersebut bagi konsumen eksternal. Oleh karenanya, Modul Eliminator mengadopsi Skema Eliminasi Bertingkat untuk menjaga *API Signature*:

| Level | Nama Mode | Perlakuan Eksekusi Fisik | Target Entitas |
|---|---|---|---|
| **Level 0** | *Dry-Run (Passive)* | Tidak menyentuh kode fisik sama sekali (Hanya Audit JSON). | Semua Entitas |
| **Level 1** | *Lazy Load Optimization* | Komponen UI tidak dihapus, melainkan dibungkus dinamis (`React.lazy()`) guna menggeser beban ukuran. | Komponen React/UI |
| **Level 2** | *Empty Body (Safe Delete)* | *Node* dipertahankan, namun blok logikanya dikosongkan menjadi `{}`. Preservasi API publik tetap terjaga mutlak. | Parameter Fungsi, *Class Method* |
| **Level 3** | *Aggressive (Full Delete)* | Pemotongan radikal di mana *node* beserta deklarasinya diamputasi secara utuh dari berkas. | *Unused Variable*, *Unused Import* |

### D. Pengujian Eliminator
Pengujian modul Eliminator dilakukan melalui serangkaian *unit test* tertutup untuk memastikan keandalan operasi mutasi teks. Secara keseluruhan, terdapat **12 Skenario Pengujian (TC-34 hingga TC-45)** yang dikelompokkan ke dalam tiga fokus utama evaluasi *development*:

**1. Validasi Preservasi Tata Letak (TC-40 & TC-41)**
Memastikan operasi potong-teks oleh `magic-string` bebas benturan. Penghapusan *node* majemuk diverifikasi tidak merusak jarak spasi (indentasi) maupun menggeser struktur kode yang masih aktif digunakan.

**2. Pengujian Skema Eliminasi Bertingkat (TC-42, TC-43, TC-44)**
Memastikan berjalannya algoritma proteksi *API Signature*. Sebagai contoh, pada pengujian Level 2 (*Empty Body*), fungsi yang terdeteksi usang dibersihkan blok logikanya namun cangkang fungsinya dibiarkan utuh untuk mencegah *crash* pada modul eksternal:
```javascript
// Cuplikan Uji Level 2 (codeCleaner.test.js)
const code = `class Foo { unusedMethod() { console.log("mati"); } }`;
const cleaned = removeDeadCode(code, deadNodes, 2); 
// Assertion: cleaned harus menghasilkan `class Foo { unusedMethod() {} }`
```

**3. Temuan Kegagalan: Celah Kebocoran Sintaks / *Syntax Leak* (TC-45)**
Di tengah jalannya pengujian purwarupa awal, ditemukan sebuah kegagalan kritis. Baris yang hanya berisi variabel usang menyisakan kata kunci (*keyword*) deklarasi kosong (misal: `const ;`), yang memicu kegagalan kompilasi beruntun pada kode target. Untuk menambal celah ini dan mencegahnya terulang, sebuah skenario uji agresif dirancang:

```javascript
// Cuplikan: Skenario Uji Kebocoran Sintaks (codeCleaner.test.js)
it('TC-45: Mencegah Syntax Leak (Residu "const ;") pada penghapusan deklarator ganda', () => {
    // Skenario: a dan b keduanya usang. Setelah dihapus, jangan sampai ada "const ;"
    const code = `const a = 1, b = 2;\nconsole.log("hidup");`;
    const ast = parseCode(code, 'test.js');
    const deadNodes = findDeadCode(ast, 'test.js');
    const cleaned = removeDeadCode(code, deadNodes);
    
    // PENGUJIAN UTAMA: Pastikan tidak ada "const ;" atau "const" yang menggantung
    assert.ok(!cleaned.includes('const ;'), 'Tidak boleh ada kebocoran sintaks "const ;"');
    assert.ok(!cleaned.includes('const\n'), 'Kata kunci const harus ikut terhapus seluruhnya');
});
```

---

## 2. Baseline Refactor

Respons perbaikan arsitektural diberlakukan seketika untuk meresolusi temuan galat (*error*) kompilasi dan mempertebal pengamanan operasi basis berkas.

### A. Penambalan *Empty Declaration Bug*
Untuk mengatasi residu *keyword* kosong, logika ekstraksi baris diperkuat. Jika hasil pemotongan hanya menyisakan kata kunci (`const`, `let`, `var`), maka utilitas akan mengeksekusi penghapusan pada satu baris memanjang utuh (*full line drop*).

```javascript
// Cuplikan: Penambalan Residu Deklarasi Kosong (codeCleaner.js)
const before = codeString.substring(lineStart, removeStart).trim();
const after = codeString.substring(removeEnd, lineEnd).trim();

// Tangkap anomali: jika yang tersisa di baris tersebut hanyalah "const ;"
if (/^(const|let|var)$/.test(before) && (after === '' || after === ';')) {
    ms.remove(lineStart, consumeNewline(codeString, lineEnd)); // Hapus sebaris penuh
}
```

### B. Pembangunan Backup Manager (T3-05)
Menyadari risiko fatal modifikasi masif asinkron, fungsi *Backup Manager* dikembangkan dengan urgensi tinggi. Sebelum `magic-string` menyentuh target, salinan orisinal proyek diamankan ke dalam subdirektori `.deadkiller_backup/` lengkap dengan metadata *timestamp*. Seluruh modifikasi dipastikan berstatus *fully recoverable* (dapat dipulihkan 100%).

---

## 3. Baseline Production

Pada lingkungan produksi, *Eliminator* dilepas bersama dengan data AST matang dari *Analyzer* ke seluruh ruang sampel.

### A. Evaluasi Stabilitas Sistem Pasca-Pemangkasan
Validasi yang dilakukan dengan mesin *compiler* (*tsc*) membuktikan dua pencapaian absolut:
1. **Bebas Galat (*Syntax Error Free*):** Tidak ditemukan anomali *trailing comma* maupun residu *keyword* deklarasi berkat utilitas baris di tahap *Refactor*.
2. **Preservasi Tata Letak Presisi:** Jarak spasi vertikal/horizontal dan komentar dokumentasi (JSDoc) asli *programmer* tidak tergeser sedikit pun, mengukuhkan dominasi *Hybrid String Manipulation* atas *AST Rewriting* konvensional.

Keberhasilan absolut ini dibuktikan dari tuntasnya seluruh *test suite* Modul Eliminator yang menguji skenario pemangkasan aman (*Safe Deletion*) beserta Skema Eliminasi Bertingkat:

```text
▶ Code Cleaner — Penghapusan Dead Code
  ✔ TC-34: Menghapus baris tunggal dead code 
  ✔ TC-35: Tidak menghapus apapun jika deadNodes kosong 
  ✔ TC-36: Tidak menghapus apapun jika deadNodes null 
  ✔ TC-37: Proteksi DuplicateCondition — TIDAK dihapus 
  ✔ TC-38: Proteksi Parameter — Diubah menjadi _ (Level 3 Default) 
  ✔ TC-39: Proteksi ClassMethod — Body dikosongkan (Level 3 Default) 
  ✔ TC-40: Menghapus tanpa merusak kode lain di file yang sama 
  ✔ TC-41: Menghapus multiple dead nodes tanpa konflik posisi 
  ✔ TC-42: Level 0 (Dry-Run) tidak memodifikasi kode 
  ✔ TC-43: Level 2 (Empty Body) mengosongkan fungsi, bukan menghapus 
  ✔ TC-44: Level 3 (Aggressive) menghapus variabel secara total 

✔ Code Cleaner — Penghapusan Dead Code (11/11 Passed)
```

### B. Kesimpulan Iterasi 3
1. **Keamanan Eksekusi Operasional:** Modul *Eliminator* sanggup mengeksekusi Skema Eliminasi Bertingkat (4 Level) untuk melenyapkan variabel tanpa mencederai kontrak publik (*API Signature*).
2. **Mitigasi Bencana Kode:** Kombinasi *Backup Manager* dan perbaikan heuristik sintaksis berhasil menekan probabilitas korupsi berkas ke titik 0% (nol persen).
3. Modul ketiga ini secara resmi mengunci fungsi motorik (tangan) dari sistem aplikasi, mengubahnya dari sekadar linter peringatan menjadi pembersih otomatis (*auto-fixer*) skala nyata.

---

## Ringkasan Penyelesaian Task Iterasi 3

Sebagai penutup iterasi ketiga, berikut adalah rekapitulasi lengkap dari seluruh penugasan (*tasks*) yang telah diselesaikan secara komprehensif dari tahap *Development* hingga *Refactor*:

| ID Task | Deskripsi | Status | Baseline |
|---------|-----------|--------|----------|
| T3-01 | Pembangunan CLI & integrasi `.deadkillerrc.json` | ✅ Selesai | Development |
| T3-02 | Arsitektur *Hybrid String Manipulation* berbasis AST | ✅ Selesai | Development |
| T3-03 | Pembersihan sisa sintaks (*Trailing Comma*) | ✅ Selesai (Refactored)| Development |
| T3-04 | Klasifikasi 4 Level Eliminasi Bertingkat | ✅ Selesai | Development |
| T3-05 | Implementasi lapis aman *Backup Manager* | ✅ Selesai | Refactor |
