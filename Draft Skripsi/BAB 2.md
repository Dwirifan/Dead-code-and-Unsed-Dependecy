Berikut adalah teks yang Anda berikan, telah dirapikan ke dalam format Markdown tanpa menghapus satu kata pun. Bagian tabel juga telah disesuaikan agar tampil rapi sesuai standar Markdown.

---

## BAB II

### KAJIAN PUSTAKA

### 2.1 Tinjauan Pustaka

Penelitian mengenai optimasi kode dan manajemen dependensi terus berkembang seiring dengan meningkatnya kompleksitas ekosistem JavaScript. Berbagai pendekatan telah dikembangkan, mulai dari analisis dinamis, pemanfaatan kecerdasan buatan, hingga analisis statis, untuk mengatasi permasalahan efisiensi dan keamanan.

Dari sisi dampak inefisiensi, sebuah studi empiris pada lingkungan Continuous Integration (CI) menunjukkan bahwa 55,88% waktu komputasi pada proses build terbuang akibat pemrosesan dependensi yang tidak digunakan [3]. Temuan ini menegaskan bahwa permasalahan dependensi tidak hanya bersifat teknis, tetapi juga berdampak langsung terhadap biaya dan performa sistem. Namun, penelitian tersebut lebih berfokus pada analisis dampak ekonomi dan performa, tanpa menyediakan solusi berupa perkakas (tooling) yang dapat digunakan secara langsung oleh pengembang.

Permasalahan serupa juga ditemukan dalam studi terhadap ekosistem modul JavaScript, khususnya arsitektur CommonJS, di mana ditemukan bahwa 50,6% dependensi merupakan bloat atau tumpukan sampah yang tidak terpakai [2]. Untuk mengatasi hal ini, dikembangkan alat bernama DepPrune yang menggunakan pendekatan analisis dinamis (runtime) [2]. Pendekatan ini dipilih karena mekanisme pemanggilan fungsi `require()` pada CommonJS bersifat sangat fleksibel dan sulit dianalisis secara statis. Meskipun demikian, pendekatan dinamis memiliki keterbatasan, terutama dari sisi performa serta kebutuhan untuk mengeksekusi program selama proses analisis.

Di sisi lain, ekosistem JavaScript modern telah mengalami pergeseran signifikan dengan hadirnya standar ES6 (ECMAScript Modules) serta penggunaan TypeScript sebagai landasan arsitektur logika sistem yang tangguh. Berbeda dengan CommonJS, mekanisme `import` dan `export` pada ESM bersifat statis, sehingga memungkinkan analisis kode dilakukan tanpa perlu menjalankan program. Karakteristik ini membuka peluang untuk menerapkan pendekatan analisis statis yang lebih ringan dan efisien dibandingkan pendekatan dinamis yang digunakan sebelumnya [2]. Namun, hingga saat ini peluang tersebut belum dimanfaatkan secara optimal dalam pengembangan tooling yang tersedia.

Pendekatan lain yang juga dikembangkan adalah alat bernama Lacuna, yang menggunakan pendekatan analisis hibrida (statis dan dinamis) [4]. Meskipun metode ini mampu memetakan penggunaan kode dengan sangat akurat, kelemahan utamanya adalah ketergantungan pada eksekusi program (runtime) yang menyebabkan proses analisis menjadi lambat dan membebani sumber daya sistem. Pada ranah teknologi terkini, pendekatan berbasis kecerdasan buatan mulai dieksplorasi melalui proyek DCE-LLM yang menerapkan Large Language Models (LLM) untuk mengeliminasi kode mati [12]. Hasilnya menunjukkan pemahaman konteks kode yang baik, namun implementasinya membutuhkan daya komputasi masif dan integrasi yang kompleks sehingga belum efisien untuk penggunaan harian.

Sementara itu, efektivitas metode analisis statis dibuktikan melalui penelitian penggunaan Abstract Syntax Tree (AST). Metode ini terbukti mampu membedah struktur kode program dan mengekstrak informasi struktur data sintaksis dengan presisi tinggi tanpa perlu mengeksekusi program pada level teks [13]. Selain itu, pengurangan dependensi tak terpakai secara langsung membantu mengurangi permukaan serangan (*attack surface*) pada aplikasi Node.js (melalui alat Mininode), yang meminimalisir ancaman eksploitasi keamanan secara signifikan [6].

Meskipun demikian, sebagian besar alat deteksi statis konvensional yang menganalisis ekosistem besar seperti Maven umumnya mengandalkan pencocokan teks dasar atau *call graph* konvensional [11], [10]. Pendekatan ini memiliki keterbatasan karena rentan menghasilkan *false positive* (peringatan palsu) jika tidak divalidasi dengan bedah sintaksis yang mendalam. Di sisi lain, visualisasi kode secara interaktif (*code visualization*) terbukti sangat krusial dalam membantu pengembang memahami struktur proyek yang kompleks guna mengambil keputusan optimasi tanpa keraguan [14].

Berdasarkan tinjauan berbagai literatur di atas, terlihat jelas adanya kesenjangan (*research gap*) pada pendekatan deteksi *dead code* dan *unused dependencies* saat ini. Pendekatan dinamis (seperti alat Lacuna dan DepPrune) terbukti memberatkan kinerja runtime dan kesulitan memproses TypeScript secara mulus. Pendekatan statis konvensional rentan memicu *false positive*, sedangkan adopsi AI (seperti DCE-LLM) masih terbentur masalah efisiensi komputasi. Oleh karena itu, penelitian ini hadir untuk menjembatani kesenjangan tersebut dengan merancang utilitas CLI berbasis Abstract Syntax Tree (AST) statis. Metode ini mengeliminasi kebutuhan eksekusi runtime sehingga prosesnya sangat ringan, serta terbukti secara literatur sangat tangguh untuk membedah ekosistem pengembangan modern yang kompleks seperti JavaScript (ES6+) dan TypeScript. Dengan tambahan fitur antarmuka visualisasi interaktif berupa peta relasi proyek (*project map*), alat ini diharapkan dapat mereduksi ukuran aplikasi, mempercepat waktu build CI, sekaligus menutup celah keamanan (*attack surface*) secara aman dan terkendali.

**Tabel 2. 1 Ringkasan Tinjauan Pustaka**

| Peneliti (tahun) | Topik | Metode | Hasil |
| --- | --- | --- | --- |
| Weeraddana et al. (2024) | Analisis pemborosan (waste) dependensi pada sistem CI. | Studi Empiris & Analisis Log Build. | Hasil: Menemukan 55,88% waktu build terbuang. Gap: Fokus pada analisis dampak ekonomi/performa, belum menyediakan tool eliminasi otomatis. |
| Liu et al. (2025) | Deteksi dan eliminasi bloated dependencies pada paket NPM (CommonJS). | Analisis Dinamis (Trace-based monitoring). | Hasil: Mengidentifikasi 50,6% dependensi yang terinstal sebenarnya adalah bloat (sampah). Gap: Metode dinamis sangat berat dan dirancang khusus untuk CommonJS, bukan untuk ekosistem ESM/TypeScript modern yang statis. |
| Chen et al. (2024) | Eliminasi dead code menggunakan AI Generatif (DCE-LLM). | Large Language Models (LLM) & Prompting. | Hasil: Model AI mampu memahami konteks semantik kode dengan sangat baik. Gap: Membutuhkan biaya komputasi tinggi dan lambat sehingga belum efisien untuk utilitas penggunaan berulang harian. |
| Mustamiin et al. (2022) | Analisis struktur kode sumber program. | Abstract Syntax Tree (AST). | Hasil: Metode AST terbukti sangat representatif dan akurat dalam memetakan struktur sintaksis tanpa eksekusi. Gap: Implementasi belum spesifik pada kasus unused dependency Node.js. |
| Koishybayev & Kapravelos (2020) | Pengurangan permukaan serangan (Attack Surface) Node.js. | Debloating & Analisis Keamanan (mininode). | Hasil: Menghapus kode tak terpakai meningkatkan keamanan signifikan. Gap: Metode debloating yang digunakan masih kompleks bagi pemula. |
| Malavolta et al. (2018) | Deteksi dead code pada aplikasi web (Lacuna). | Hibrida (Statis & Dinamis). | Hasil: Memiliki tingkat akurasi pemetaan deteksi yang sangat tinggi. Gap: Kinerja karena tingginya beban komputasi dari eksekusi runtime aplikasi. |
| Chuang dkk. (2022) & Soto-Valero dkk. (2024) | Deteksi bloated dependencies pada proyek perangkat lunak berskala besar. | Analisis Statis Konvensional / Call Graph. | Hasil: Eksekusi berlangsung sangat cepat dalam memetakan dependensi tingkat dasar. Gap: Keterbatasan presisi karena analisis tanpa bedah sintaksis mendalam rentan memicu false positive. |
| Cholke dkk. (2025) | Visualisasi JavaScript Dead Code Optimization. | Analisis Visualisasi dan Performance. | Hasil: Visualisasi sangat krusial dalam membantu pengembang mengambil keputusan optimasi. Gap: Alat analisis murni (berbasis teks) sering membingungkan jika tidak dibantu peta relasi struktur secara visual. |

Berdasarkan tinjauan di atas, belum ada penelitian yang menggabungkan analisis statis AST murni pada ekosistem ESM/TypeScript dengan output visualisasi CLI secara ringan, sehingga penelitian ini berfokus mengisi celah tersebut.

### 2.2 Landasan Teori

#### 2.2.1 Ekosistem Node.js, Manajemen Dependensi, dan Software bloat

Dalam rekayasa perangkat lunak modern, penggunaan modul atau pustaka siap pakai sudah menjadi praktik umum untuk mempercepat proses pengembangan aplikasi. Melalui ekosistem Node.js dan dukungan Node Package Manager (NPM), pengembang dapat dengan mudah memanfaatkan ribuan pustaka pihak ketiga. Namun, kemudahan tersebut juga menyebabkan terbentuknya jaringan dependensi (*dependency network*) yang semakin kompleks dan saling terhubung [1].

Jaringan dependensi (*dependency network*) yang kompleks tersebut sering kali memunculkan fenomena *software bloat*, yaitu kondisi ketika berbagai dependensi ikut dikemas ke dalam aplikasi sehingga ukuran biner menjadi lebih besar, meskipun sebagian dependensi sebenarnya tidak dibutuhkan dalam proses build maupun saat aplikasi dijalankan [2].

Kondisi ini tidak hanya menyebabkan penggunaan ruang menjadi kurang efisien, tetapi juga meningkatkan risiko pada keamanan rantai pasok perangkat lunak (*software supply chain*). Semakin banyak dependensi yang terlibat, semakin luas pula permukaan serangan (*attack surface*) yang dapat dimanfaatkan oleh pihak tidak bertanggung jawab [6].

#### 2.2.2 Dead Code, Unused Dependencies, dan Inefisiensi Continuous Integration (CI)

Dalam literatur analisis program, *dead code* didefinisikan sebagai bagian dari instruksi kode sumber yang secara teknis dapat dieksekusi, namun pada praktiknya tidak pernah dipanggil atau dicapai selama alur operasi sistem berjalan [7]. Dalam konteks proyek berbasis modul NPM, *dead code* ini terwujud sebagai dependensi tak terpakai (*unused dependencies*). Sebuah dependensi diklasifikasikan sebagai bloated atau tidak terpakai apabila tidak ada satupun elemen antarmuka pemrograman aplikasi (API) dari dependensi tersebut yang direferensikan atau diakses, baik secara langsung maupun tidak langsung, oleh aplikasi utama. Penumpukan dependensi yang tidak terpakai ini secara empiris telah terbukti menciptakan pemborosan (*waste*) yang masif pada lingkungan Continuous Integration (CI), di mana siklus komputasi server terbuang sia-sia hanya untuk mengunduh, menginstal, dan memvalidasi paket-paket yang berstatus *unused* [3].

#### 2.2.3 Analisis Kode Statis (Static Code Analysis)

Analisis statis adalah metode evaluasi perangkat lunak yang dilakukan dengan memeriksa kode sumber tanpa perlu mengeksekusi program tersebut. Berbeda dengan analisis dinamis yang memerlukan lingkungan runtime aktif dan skenario pengujian (*test cases*), analisis statis bekerja dengan memindai struktur teks kode untuk menemukan pola tertentu [9]. Keunggulan utama metode ini adalah kecepatan dan kemampuan untuk mencakup seluruh bagian kode (*code coverage*) yang mungkin tidak terjangkau oleh eksekusi normal.

#### 2.2.4 Abstract Syntax Tree (AST)

Abstract Syntax Tree (AST) adalah representasi struktur sintaksis dari kode sumber program dalam bentuk pohon hierarkis. Setiap simpul (node) dalam pohon mewakili konstruksi kode seperti deklarasi variabel, fungsi, atau pernyataan impor.

Menurut Mustamiin et al., AST memungkinkan analisis mendalam terhadap logika program karena mengubah teks mentah menjadi struktur data yang dapat ditelusuri (*traversable*) [9]. Dalam penelitian ini, AST digunakan untuk memetakan grafik ketergantungan (*dependency graph*). Dengan menelusuri simpul `ImportDeclaration` dan `CallExpression` pada AST, alat dapat menentukan secara pasti apakah sebuah dependensi sedang digunakan atau tidak tanpa risiko kesalahan interpretasi teks (seperti pada metode Regex).

#### 2.2.5 Peta Ketergantungan (Dependency Graph)

Relasi logis antar-modul di dalam suatu repositori dapat dipetakan secara utuh melalui pembentukan grafik ketergantungan (*dependency graph*). Peta arsitektur ini disusun sebagai grafik berarah (*directed graph*), di mana setiap berkas kode internal maupun pustaka eksternal bertindak sebagai simpul (node), sementara hubungan impor-ekspor bertindak sebagai sisi penyambungnya (edge) [15].

Melalui pembongkaran struktur pohon kode, relasi pemanggilan antar-fungsi dapat ditelusuri untuk melihat apakah suatu modul masih terikat dengan titik masuk utama (*entry point*) aplikasi atau sudah terisolasi. Peta ketergantungan ini memegang peranan krusial bagi alat deteksi otomatis untuk mengidentifikasi keberadaan komponen-komponen pasif yang masih tercatat di manifes proyek namun talinya sudah terputus dari jaringan eksekusi program.

#### 2.2.6 Visualisasi Kode (Code Visualization)

Analisis tekstual atau terminal baris perintah sering kali kurang memadai bagi pengembang untuk memahami arsitektur proyek yang berskala besar. Oleh karena itu, penerapan visualisasi kode menjadi krusial. Representasi berbasis grafik memungkinkan pengembang untuk melihat topologi proyek secara komprehensif, menyoroti relasi dan aliran eksekusi antar-modul [14]. Dengan adanya visualisasi yang interaktif, pengembang dapat menelaah basis kode yang rumit secara intuitif, sehingga mempermudah proses pengambilan keputusan untuk melakukan perombakan atau optimasi tanpa risiko merusak fungsionalitas aplikasi.

#### 2.2.7 Standar Kualitas ISO/IEC 25010

Penelitian ini menggunakan standar internasional ISO/IEC 25010 sebagai acuan evaluasi kualitas perangkat lunak. Dari delapan karakteristik yang ada, penelitian berfokus pada dua aspek utama :

1. **Performance Efficiency (Efisiensi Kinerja):** Berkaitan dengan penggunaan sumber daya (ukuran fail) dan efisiensi waktu (waktu build).
2. **Maintainability (Kemudahan Pemeliharaan):** Berkaitan dengan tingkat kemudahan kode untuk dimodifikasi. Eliminasi kode mati meningkatkan nilai *modularity* dan *analyzability* sistem.

#### 2.2.8 Prinsip Clean Code

Dalam disiplin rekayasa perangkat lunak, Clean Code merupakan sebuah filosofi pengembangan yang digagas secara komprehensif oleh Robert C. Martin. Prinsip ini menegaskan bahwa basis kode tidak hanya sekadar harus berfungsi dan dapat dieksekusi oleh mesin, melainkan juga harus lugas, sederhana, dan mudah dibaca layaknya sebuah prosa yang ditulis dengan baik. Kualitas kode yang bersih ditandai dengan kemudahannya untuk dipahami, diuji, dan dipelihara oleh pengembang lain di luar penulis aslinya. Salah satu tantangan utama dalam mempertahankan kualitas *clean code* ini adalah munculnya "Code Smells", yaitu sekumpulan indikator atau karakteristik visual pada level sintaksis yang mengisyaratkan adanya kecacatan, redundansi, atau kelemahan pada desain arsitektur program [16].

Sebagai turunan langsung dari masalah tersebut, Martin secara spesifik mengklasifikasikan instruksi yang tidak pernah dieksekusi (*dead code*) sebagai salah satu bentuk *code smells* yang berbahaya, karena kode tersebut akan kehilangan relevansinya dan "membusuk" seiring berjalannya waktu jika dibiarkan menumpuk [16]. Lebih lanjut, dalam konteks analisis perangkat lunak web modern, kajian dari Malavolta et al. juga menegaskan prinsip yang selaras, bahwa akumulasi instruksi tak terpakai pada JavaScript merupakan smells yang membebani kinerja aplikasi. Oleh karena itu, pengembang diwajibkan untuk melakukan eliminasi sedini mungkin terhadap dependensi mati tersebut guna mencegah kerumitan logika yang sia-sia, sekaligus menjaga tingkat keterpeliharaan (maintainability) sistem dalam jangka panjang [4].

#### 2.2.9 Software Development Life Cycle (SDLC)

Dalam disiplin ilmu rekayasa perangkat lunak, Software Development Life Cycle (SDLC) didefinisikan sebagai suatu pendekatan atau kerangka kerja terstruktur yang digunakan untuk mengorganisir proses pengembangan sistem dari tahap awal hingga akhir [17]. Tujuan utama dari penerapan metode ini adalah untuk memastikan bahwa produk perangkat lunak dibangun melalui proses yang sistematis, terukur, dan menghasilkan kualitas akhir yang tinggi.

Secara operasional, kajian dari Paksi dkk. menegaskan bahwa SDLC memegang peranan krusial dalam memperjelas alur input dan output pada setiap transisi fase, sekaligus memfasilitasi pembagian peran dan tanggung jawab teknis secara terstruktur [18]. Pada umumnya, siklus dasar dalam model SDLC ini mencakup enam tahapan utama, yakni perencanaan sistem, analisis, perancangan, implementasi (pengkodean), pengujian, hingga tahap pemeliharaan sistem [18].

#### 2.2.10 Extreme Programming (XP)

Sebagai salah satu metode dalam pendekatan Agile, Extreme Programming (XP) dirancang untuk meningkatkan kualitas perangkat lunak sekaligus memberikan kemampuan adaptasi yang tinggi terhadap perubahan kebutuhan pengguna selama proses pengembangan [19]. Berbeda dengan pendekatan tradisional seperti Waterfall yang menerapkan tahapan pengembangan secara berurutan dan relatif sulit diubah, XP menempatkan proses pengkodean (coding) dan pengujian berkelanjutan (*continuous testing*) sebagai aktivitas utama dalam siklus pengembangan [20]. Selain itu, penerapan siklus rilis yang singkat (*short releases*) memungkinkan perangkat lunak dikembangkan secara bertahap sehingga risiko kegagalan proyek dapat ditekan, sementara fitur yang dihasilkan tetap selaras dengan kebutuhan dan prioritas bisnis yang terus berkembang [19].

Dalam pengembangan aplikasi web modern, khususnya yang memanfaatkan ekosistem JavaScript, kebutuhan akan proses rilis yang cepat (*time-to-market*) sering kali terkendala oleh banyaknya dokumentasi yang harus disusun selama proses pengembangan [21]. XP mengatasi permasalahan tersebut dengan mengurangi aktivitas dokumentasi yang tidak memberikan nilai tambah secara langsung, sehingga pengembang dapat lebih berfokus pada implementasi kode yang dapat dijalankan (*executable code*) serta penyusunan pengujian otomatis (*automated test drivers*) sebagai bentuk dokumentasi yang mampu merepresentasikan perilaku sistem secara nyata [21].

Keberhasilan penerapan XP didukung oleh lima nilai utama, yaitu komunikasi, umpan balik, kesederhanaan, keberanian, dan rasa hormat [20]. Komunikasi yang efektif antar anggota tim mempercepat pertukaran informasi dan mengurangi ketergantungan pada dokumentasi yang berlebihan [20]. Sementara itu, umpan balik yang diperoleh melalui pengujian otomatis memberikan keyakinan kepada pengembang untuk melakukan *refactoring* tanpa mengkhawatirkan terganggunya fungsi sistem yang telah berjalan [20]. Di sisi lain, prinsip kesederhanaan mendorong pengembang untuk membangun solusi yang benar-benar diperlukan pada saat itu, sehingga struktur sistem tetap mudah dipahami, mudah dipelihara, dan terhindar dari kompleksitas yang tidak diperlukan [20].

#### 2.2.11 Pengujian Akurasi Klasifikasi (*Confusion Matrix*)

Dalam evaluasi perangkat lunak analitik, mengukur seberapa akurat sebuah sistem dalam mendeteksi objek sasaran (*target object*) merupakan tolok ukur fundamental. Salah satu instrumen standar yang digunakan secara luas dalam evaluasi model klasifikasi adalah *Confusion Matrix*. Instrumen ini menyajikan tabel matriks yang memetakan prediksi sistem berhadapan dengan kondisi aktual yang sebenarnya [4].

Dalam konteks alat deteksi *dead code* atau *unused dependency*, sistem dituntut untuk bisa membedakan mana kode yang benar-benar mati (kelas positif) dan mana kode yang masih aktif digunakan (kelas negatif). Kesalahan dalam mengklasifikasikan kode aktif sebagai *dead code* (*false positive*) sangat fatal, karena dapat menyebabkan fungsi sistem terhapus secara tidak sengaja dan merusak aplikasi utama. Sebaliknya, kegagalan dalam mendeteksi *dead code* yang sebenarnya (*false negative*) akan mengurangi efisiensi ruang dan kinerja.

*Confusion Matrix* mendefinisikan empat skenario keluaran:
1. **True Positive (TP):** Sistem dengan benar mendeteksi *dead code* yang memang tidak terpakai.
2. **True Negative (TN):** Sistem dengan benar mengenali kode aktif dan membiarkannya (tidak menghapusnya).
3. **False Positive (FP):** Sistem keliru menandai kode yang sedang aktif sebagai *dead code*.
4. **False Negative (FN):** Sistem gagal mendeteksi keberadaan *dead code* yang ada di dalam aplikasi.

Berdasarkan empat skenario tersebut, efektivitas sistem dievaluasi secara komprehensif melalui metrik turunan berupa nilai *Precision* (tingkat ketepatan deteksi positif), *Recall* (tingkat kepekaan sistem menangkap seluruh kelas positif), dan *F1-Score* (rata-rata harmonis yang menyeimbangkan *Precision* dan *Recall* untuk mencegah hasil yang bias) [15].