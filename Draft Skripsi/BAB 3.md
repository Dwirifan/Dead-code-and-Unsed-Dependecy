# METODE PENGEMBANGAN SISTEM

## Metode Pengembangan Sistem

Penelitian ini menggunakan kerangka kerja Software Development Life Cycle (SDLC) dengan mengadopsi model Extreme Programming (XP) sebagai payung metodologi utama. Pemilihan model ini didasarkan pada karakteristik pengembangan perangkat lunak utilitas analisis statis yang menuntut responsivitas tinggi, siklus pengembangan yang pendek (short development cycles), serta penyediaan umpan balik secara konkret dan berkelanjutan (early, concrete, and continuing feedback). Karakteristik tersebut relevan dengan kebutuhan pengembangan utilitas analisis statis, di mana terdapat banyak fase eksperimen fitur, proses validasi representasi Abstract Syntax Tree (AST), dan minimalisasi dokumentasi formal yang beralih fokus pada pengkodean serta pengujian yang berjalan secara simultan [22].

Dalam konteks pengembangan aplikasi modern, khususnya yang bersentuhan dengan lingkungan web dan utilitas berbasis Node.js, tuntutan akan waktu rilis yang cepat (time-to-market) serta integrasi kebutuhan fungsional yang berubah secara dinamis menjadi kendala utama. Metodologi XP menjawab tantangan tersebut dengan menekan beban dokumentasi yang tidak diperlukan dan mengalihkannya pada pembentukan kode tereksekusi secara inkremental serta penyusunan penggerak uji otomatis (automated test drivers) [23]. Model operasional ini berakar kuat pada lima nilai fundamental XP yang digagas oleh Kent Beck, yaitu komunikasi (communication), umpan balik (feedback), kesederhanaan (simplicity), keberanian (courage), dan rasa hormat (respect) [22].

Berdasarkan kerangka makro metodologi XP tersebut, seluruh tahapan rekayasa perangkat lunak dalam penelitian ini dijalankan secara terstruktur melalui empat fase utama yang saling terhubung secara iteratif, yaitu: planning, design, coding, dan testing [19]. Alur prosedur pengembangan sistem tersebut disajikan secara visual pada Gambar 3.1.

**Gambar 3.1 Alur Pengembangan Sistem Extreme Programming dengan Penyesuaian Praktik Coding untuk Pengembang Tunggal.**

Pada Gambar 3.1, praktik pair programming pada tahap coding disesuaikan menjadi self-review/code walkthrough karena penelitian ini dilakukan oleh satu pengembang. Penyesuaian tersebut tidak mengubah XP sebagai metode pengembangan utama, melainkan hanya menyesuaikan praktik peninjauan kode agar tetap relevan dengan kondisi pengembangan individu. Uraian lebih lanjut mengenai penerapan penyesuaian tersebut dijelaskan pada tahap pengkodean.

## Tahapan Pelaksanaan Rekayasa Sistem

Berdasarkan alur pengembangan yang telah ditunjukkan pada Gambar 3.1, subbab ini menguraikan pelaksanaan setiap tahapan rekayasa sistem dalam penelitian. Uraian dilakukan mulai dari tahap perencanaan, perancangan, pengkodean, hingga pengujian yang dijalankan secara iteratif sesuai karakteristik Extreme Programming (XP).

### Perencanaan (planning)

Tahap perencanaan dalam metode Extreme Programming (XP) dilakukan secara adaptif dan bertahap. Secara filosofis, pendekatan ini menghindari penyusunan rencana yang kaku pada awal proyek, dan lebih memilih agar rancangan awal dibiarkan terus berevolusi seiring dengan dinamika penemuan kebutuhan baru, perubahan prioritas, atau kendala teknis selama proses pengembangan [22]. Sesuai dengan alur XP pada Gambar 3.1, tahap perencanaan dalam penelitian ini menghasilkan beberapa komponen utama, yaitu:

#### Perencanaan Global

Perencanaan global dilakukan pada awal proyek untuk menentukan ruang lingkup penelitian, gambaran umum sistem, serta kebutuhan fungsional dan non-fungsional. Kebutuhan tersebut kemudian dirumuskan ke dalam bentuk user stories agar fitur yang dikembangkan dapat dipetakan sesuai kebutuhan pengguna.

#### Penentuan Nilai dan Kriteria Penerimaan

Setelah user stories disusun, setiap kebutuhan diberi nilai atau prioritas berdasarkan urgensi dan kontribusinya terhadap tujuan sistem. Selain itu, ditentukan kriteria penerimaan (acceptance test criteria) sebagai acuan untuk menilai keberhasilan fitur, seperti kemampuan membaca proyek JavaScript/TypeScript, membentuk graf ketergantungan, mendeteksi kode atau dependensi yang berpotensi tidak digunakan, serta menampilkan hasil analisis melalui CLI dan laporan HTML.

#### Perencanaan Iterasi

Perencanaan iterasi dilakukan pada awal setiap siklus pengembangan dengan memecah user stories menjadi tugas teknis (tasks/backlog) yang lebih kecil dan terukur. Contoh tugas teknis meliputi pembuatan modul pembaca package.json, parser berbasis Abstract Syntax Tree (AST), logika pelacakan graf relasi, serta antarmuka Command Line Interface (CLI). Hasil dari tahap ini adalah rencana iterasi (iteration plan) sebagai acuan pada tahap perancangan dan pengkodean.

### Tahap Perancangan (Design)

Tahap perancangan dalam metode Extreme Programming (XP) berfungsi untuk menerjemahkan kebutuhan yang telah dirumuskan pada tahap perencanaan ke dalam rancangan teknis sederhana sebelum fitur diimplementasikan pada setiap iterasi. Sesuai dengan alur XP pada Gambar 3.1, tahap ini menekankan prinsip kesederhanaan desain (simple design) serta penggunaan spike solution atau prototipe sederhana untuk membantu memvalidasi kemungkinan solusi teknis sebelum diterapkan ke dalam kode utama [22]. Dengan demikian, rancangan sistem dalam penelitian ini disusun secara minimal dan berfokus pada kebutuhan fungsional utama pada iterasi berjalan, tanpa melakukan spekulasi berlebihan terhadap kebutuhan masa depan (over-engineering).

Dalam penelitian ini, prinsip simple design diterapkan melalui penyusunan rancangan teknis yang langsung berkaitan dengan kebutuhan sistem. Sementara itu, konsep spike solution atau prototipe digunakan untuk menguji kelayakan pendekatan teknis tertentu, seperti pembacaan struktur proyek, pembentukan Abstract Syntax Tree (AST), pelacakan relasi antarmodul, dan penyajian hasil analisis melalui CLI maupun laporan HTML.

Secara umum, tahap perancangan dalam penelitian ini mencakup rancangan arsitektur sistem, struktur data, algoritma inti, alur kerja sistem, antarmuka pengguna, serta mekanisme keamanan prosedural. Rancangan tersebut digunakan sebagai acuan awal pada tahap pengkodean, sedangkan uraian teknis mengenai komponen sistem, alur proses, dan implementasi setiap modul dijelaskan lebih lanjut pada Bab 4.

### Tahap Pengkodean (coding)

Tahap pengkodean merupakan proses implementasi rancangan teknis ke dalam JavaScript dan TypeScript pada lingkungan runtime Node.js. Dalam XP, pengkodean dilakukan secara iteratif dan berjalan beriringan dengan unit testing, refactoring, serta integrasi kode secara berkala. Refactoring dilakukan untuk merapikan struktur kode, mengurangi duplikasi, meningkatkan keterbacaan, dan menjaga kemudahan pemeliharaan tanpa mengubah perilaku utama sistem [22], [23].

Sebagaimana telah dijelaskan pada Gambar 3.1, praktik pair programming pada penelitian ini disesuaikan menjadi self-review/code walkthrough mandiri karena sistem dikembangkan oleh satu pengembang. Aktivitas tersebut didukung oleh ESLint, unit testing, dan refactoring untuk menjaga kualitas kode selama proses implementasi.

Untuk menjaga stabilitas kode, penelitian ini juga menerapkan tiga ruang kerja, yaitu development baseline, refactor baseline, dan production baseline sebagaimana dijelaskan oleh Agarwal dan Umphress Secara umum, development baseline digunakan untuk implementasi dan pengujian awal, refactor baseline digunakan untuk perbaikan struktur kode dan pengujian integrasi internal, sedangkan production baseline digunakan untuk menyimpan versi kode yang telah stabil dan siap dirilis.

### Tahap Pengujian (Testing)

Tahap pengujian dalam penelitian ini berfungsi sebagai evaluasi akhir terhadap sistem setelah proses implementasi, unit testing, self-review, refactoring, dan pengujian integrasi internal dilakukan pada tahap pengkodean. Dengan demikian, pengujian pada tahap ini tidak mengulang proses pengujian unit maupun pengujian integrasi internal yang telah berjalan selama implementasi, melainkan difokuskan pada validasi sistem secara menyeluruh sebelum versi kode dinyatakan stabil.

Pada tahap ini, sistem diuji menggunakan skenario pengujian yang merepresentasikan penggunaan nyata terhadap utilitas analisis statis. Pengujian dilakukan untuk memastikan bahwa alur kerja sistem secara keseluruhan, mulai dari pembacaan proyek, pemrosesan Parser, pembentukan graf melalui Graph Builder, proses eliminasi oleh Eliminator, keluaran antarmuka CLI, hingga generator laporan HTML dapat berjalan sesuai kebutuhan. Apabila hasil pengujian menunjukkan adanya kesalahan atau ketidaksesuaian, proses pengembangan dapat kembali ke tahap pengkodean atau perancangan untuk dilakukan perbaikan.

Evaluasi akhir difokuskan pada pengukuran akurasi deteksi dan kelayakan mutu perangkat lunak. Pengukuran akurasi deteksi dilakukan menggunakan instrumen Confusion Matrix untuk menilai kemampuan sistem dalam mengidentifikasi kode atau dependensi yang berpotensi tidak digunakan. Selain itu, kelayakan mutu perangkat lunak dievaluasi dengan mengacu pada parameter ISO/IEC 25010, khususnya pada aspek performance efficiency dan maintainability. Hasil dari tahap pengujian ini menjadi dasar untuk menentukan apakah sistem layak ditempatkan pada production baseline sebagai versi yang siap dirilis.

## Metode Pengujian dan Evaluasi Kualitas Produk

Untuk mengukur tingkat keberhasilan dan kelayakan utilitas analisis statis yang dibangun, penelitian ini menggunakan pendekatan kuantitatif terstruktur yang difokuskan pada dua instrumen pengujian utama:

### Pengujian Kinerja Deteksi (Detection Performance)

Pengujian ini berfokus pada validasi fungsionalitas sistem dalam mendeteksi dan mengeliminasi ketergantungan modul. Pengujian dilakukan pada dataset proyek JavaScript nyata yang disuntikkan (injection) blok dead code dan pustaka unused dependency buatan secara sengaja. Tingkat akurasi deteksi dievaluasi menggunakan instrumen Confusion Matrix dengan rumus matematis sebagai berikut [4]:

#### Precision (Presisi)

Digunakan untuk mengukur rasio elemen yang diklasifikasikan dengan benar terhadap semua elemen yang terdeteksi positif, guna mencegah kesalahan penghapusan kode aktif (false positive).

```text
Precision = TP / (TP + FP)
```

Keterangan:

- TP = True Positive (dead code yang dideteksi benar)
- FP = False Positive (kode aktif yang keliru dianggap dead code)

#### Recall (Sensitivitas)

Digunakan untuk mengukur rasio elemen yang dikenali dengan benar terhadap semua elemen yang seharusnya diklasifikasikan sebagai dead code untuk mencegah false negative.

```text
Recall = TP / (TP + FN)
```

Keterangan:

- FN = False Negative (dead code yang gagal dideteksi oleh sistem)

#### F1-Score (Akurasi Gabungan)

Digunakan sebagai nilai rata-rata harmonis (trade-off) antara Precision dan Recall untuk merepresentasikan tingkat akurasi atau kinerja sistem secara keseluruhan secara berimbang [13].

```text
F1-Score = 2 × (Precision × Recall) / (Precision + Recall)
```

Secara teknis, pengukuran dan pencatatan hasil (TP, FP, FN) dilakukan melalui pemantauan logging internal, skrip evaluasi terintegrasi, serta verifikasi manual (manual verification).

### Pengujian Standar Mutu (ISO/IEC 25010)

Merujuk pada karakteristik standar kualitas ISO/IEC 25010, utilitas juga diukur kelayakan teknisnya melalui dua parameter berikut:

#### Performance Efficiency

Bertujuan untuk memastikan utilitas pemindaian AST berjalan dengan cepat tanpa membebani sistem komputasi pengguna. Pengukuran performa dilakukan menggunakan utilitas pemantauan runtime bawaan Node.js dengan metrik perhitungan matematis sebagai berikut:

##### Waktu Komputasi (Time Behavior)

Pemantauan durasi eksekusi diukur menggunakan performance hooks dan console.time(). Rumus komputasi yang dihitung adalah selisih waktu penyelesaian:

```text
WaktuEksekusi = WaktuSelesai (EndTime) - WaktuMulai (StartTime)
```

##### Konsumsi Memori (Resource Utilization)

Tingkat alokasi memori dipantau menggunakan fungsi process.memoryUsage(). Beban overhead memori dihitung dengan membandingkan memori sebelum dan sesudah pohon AST diproses:

```text
OverheadMemori = MemoriAkhir (HeapUsed) - MemoriAwal (HeapUsed)
```

#### Pengujian Maintainability

Pengujian keterpeliharaan difokuskan pada tingkat modularitas arsitektur dan keterbacaan kode (readability). Keterpeliharaan utilitas dijaga melalui kepatuhan terhadap prinsip Clean Code yang divalidasi menggunakan alat analisis statis internal, yaitu ESLint, untuk mendeteksi code smells [9]. Selain itu, kualitas struktur perangkat lunak dikelola melalui mekanisme evaluasi mandiri (continuous self-review) dan isolasi tiga ruang kerja (development, refactor, production), mengacu pada pendekatan XP untuk pengembang tunggal.

Untuk mengukur persentase kelayakan mutu sistem secara keseluruhan berdasarkan standar ISO/IEC 25010 (sebagai akumulasi validasi dari ahli atau uji kelayakan), digunakan persamaan matematis baku berikut:

```text
PresentaseKelayakan = (SkorAktual / SkorIdeal) × 100%
```