
## BAB III

### METODE PENGEMBANGAN SISTEM

### 3.1 Metode Pengembangan Sistem

Penelitian ini menggunakan kerangka kerja Software Development Life Cycle (SDLC) dengan mengadopsi model Extreme Programming (XP) sebagai payung metodologi utama. Sebagai salah satu kerangka kerja Agile, XP berfokus pada peningkatan kualitas sistem dan responsivitas terhadap dinamika perubahan kebutuhan pengguna [19]. Metodologi ini dikembangkan dengan berlandaskan pada lima nilai inti fundamental, yakni komunikasi (*communication*), kesederhanaan (*simplicity*), umpan balik (*feedback*), keberanian (*courage*), dan rasa saling menghormati (*respect*) antar pengembang [20],[22].

Model Extreme Programming dipilih secara khusus karena metodologi ini secara empiris terbukti mampu menyederhanakan kompleksitas tahapan pengembangan sistem konvensional demi mencapai tingkat efisiensi, adaptabilitas, dan fleksibilitas yang jauh lebih tinggi dalam mengakomodasi perubahan [17], [18]. Pendekatan ini dinilai sangat relevan dengan karakteristik proyek pengembangan utilitas analisis statis berbasis Abstract Syntax Tree (AST), di mana pengerjaannya menuntut rilis yang cepat, iterasi eksperimental, serta penyesuaian fungsionalitas yang terus berkembang [23].

Dalam ekosistem pengembangan aplikasi modern yang berjalan di lingkungan runtime Node.js, tuntutan kecepatan rilis sering kali terhambat oleh birokrasi penyusunan dokumen administratif yang berlebihan [21]. Pendekatan XP menjawab tantangan tersebut secara pragmatis dengan memangkas beban dokumentasi yang kaku dan mengalihkan fokus pengembang secara penuh pada pembentukan instruksi kode tereksekusi (*executable code*) serta penyusunan skrip uji otomatis sebagai standar dokumentasi sistem yang nyata dan tervalidasi [21].

Gambar 3. 1Alur Pengembangan Sistem Extreme Programming [17].

### 3.2 Tahapan Pelaksanaan Rekayasa Sistem

Sebagaimana yang diterapkan pada paradigma XP modern, siklus rekayasa perangkat lunak utilitas analisis statis ini tidak dilakukan secara linear, melainkan dijalankan melalui empat fase utama yang saling terhubung secara iteratif, yaitu perencanaan (*planning*), perancangan (*design*), pengkodean (*coding*), dan pengujian (*testing*) [17], [24].

#### 3.2.1 Tahap Perencanaan (planning)

Fase perencanaan dalam kerangka XP dijalankan menggunakan pendekatan adaptif yang tidak dikunci secara kaku di awal, melainkan dirancang untuk terus berevolusi seiring ditemukannya kendala teknis baru di lapangan [20]. Kebutuhan sistem tidak didokumentasikan dalam bentuk spesifikasi yang tebal, melainkan dirumuskan melalui cerita pengguna (*user stories*) [21]. Pada penelitian ini, tahap perencanaan dieksekusi melalui dua tingkat aktivitas utama [19]:

1. **Perencanaan Rilis:** Menentukan ruang lingkup proyek, mengumpulkan *user stories*, menyusun prioritas, dan menetapkan kriteria penerimaan fitur (seperti akurasi deteksi dependensi tak terpakai).
2. **Perencanaan Iterasi:** Memecah *user stories* menjadi unit-unit tugas teknis berskala kecil yang terukur pada setiap awal siklus pengembangan.

#### 3.2.2 Tahap Perancangan (Design)

Tahap perancangan berfungsi menerjemahkan spesifikasi kebutuhan ke dalam bentuk rancangan teknis sebelum instruksi kode mulai ditulis. Dalam metodologi XP, perancangan tidak dilakukan secara masif dan kaku di awal proyek (Big Design Up Front), melainkan berjalan secara inkremental [19]. Tahap perancangan dalam penelitian ini diklasifikasikan ke dalam dua tingkatan cakupan:

1. **Perancangan Makro:** Difokuskan pada pembentukan arsitektur sistem tingkat tinggi (*system metaphor*) untuk memberikan gambaran alur komponen utama tanpa mengunci detail teknis [20].
2. **Perancangan Iteratif (Simple Design):** Desain teknis dikonstruksi secara minimalis untuk menyelesaikan masalah fungsional spesifik pada iterasi berjalan agar terhindar dari arsitektur yang spekulatif (*over-engineering*) [20]. Konsep purwarupa eksperimental (*spike solution*) kerap dimanfaatkan di sini untuk memvalidasi algoritma pelacakan struktur AST.

#### 3.2.3 Tahap Pengkodean (coding)

Tahap pengkodean adalah proses penerjemahan rancangan teknis ke dalam instruksi sintaksis JavaScript dan TypeScript yang dieksekusi di atas lingkungan runtime Node.js. Dalam metodologi XP, proses pengkodean tidak dilakukan secara serentak di akhir proyek, melainkan dieksekusi secara iteratif dan inkremental berdasarkan prioritas unit tugas teknis yang telah disepakati pada tahap perencanaan [19].

Mengacu pada disiplin kerja XP, stabilitas pengembangan dijaga secara ketat melalui mekanisme integrasi berkelanjutan (Continuous Integration). Setiap modul fungsional yang selesai dibangun dalam sebuah iterasi akan langsung diintegrasikan ke basis kode utama untuk mencegah terjadinya penumpukan konflik arsitektur di akhir proyek [21]. Proses penulisan instruksi kode ini senantiasa berjalan berdampingan dengan aktivitas penataan ulang arsitektur internal (*refactoring*). Langkah *refactoring* ini sangat krusial dalam paradigma XP untuk mengeliminasi duplikasi logika, membersihkan struktur komponen, dan meningkatkan keterbacaan kode (*readability*) tanpa mengubah perilaku eksternal dari sistem itu sendiri [20].

#### 3.2.4 Tahap Pengujian (Testing)

Pengujian dalam paradigma XP terbagi menjadi dua tingkatan utama untuk memastikan kualitas perangkat lunak tetap terjaga [19]:

1. **Pengujian Unit (Unit Testing):** Pengujian ini berjalan simultan mendampingi penulisan kode di setiap iterasi (*continuous testing*), bukan sekadar validasi di akhir proyek [21]. Melalui mekanisme Continuous Integration (CI), setiap penambahan kode baru ke repositori utama akan otomatis divalidasi oleh instrumen uji. Skrip uji otomatis ini berfungsi sebagai jaring pengaman fundamental yang memberikan pengembang keberanian (*courage*) untuk merestrukturisasi kode (*refactoring*) tanpa takut memicu galat tersembunyi [19].
2. **Pengujian Sistem (System Testing):** Setelah seluruh komponen yang lulus uji unit dirakit secara utuh, utilitas akan memasuki fase evaluasi akhir. Fase ini bertujuan untuk memvalidasi kelayakan produk secara empiris baik dari segi akurasi deteksi maupun evaluasi mutu standar internasional sebelum perangkat lunak dinyatakan stabil untuk dirilis.

### 3.3 Metode Pengujian dan Evaluasi Kualitas Produk

Untuk mengukur tingkat keberhasilan dan kelayakan utilitas analisis statis yang dibangun, penelitian ini menggunakan pendekatan kuantitatif terstruktur yang difokuskan pada dua instrumen pengujian utama:

#### 3.3.1 Pengujian Kinerja Deteksi (Detection Performance)

Pengujian ini berfokus pada validasi fungsionalitas sistem dalam mendeteksi dan mengeliminasi ketergantungan modul. Pengujian dilakukan pada dataset proyek JavaScript nyata yang disuntikkan (*injection*) blok *dead code* dan pustaka *unused dependency* buatan secara sengaja. Tingkat akurasi deteksi dievaluasi menggunakan instrumen Confusion Matrix dengan rumus matematis sebagai berikut [4]:

1. **Precision (Presisi):** Digunakan untuk mengukur rasio elemen yang diklasifikasikan dengan benar terhadap semua elemen yang terdeteksi positif, guna mencegah kesalahan penghapusan kode aktif (*false positive*).

$$Precision = \frac{TP}{TP + FP}$$

(Keterangan: TP = True Positive (*dead code* yang dideteksi benar); FP = False Positive (kode aktif yang keliru dianggap *dead code*)).

2. **Recall (Sensitivitas):** Digunakan untuk mengukur rasio elemen yang dikenali dengan benar terhadap semua elemen yang seharusnya diklasifikasikan sebagai *dead code* untuk mencegah *false negative*.

$$Recall = \frac{TP}{TP + FN}$$

(Keterangan: FN = False Negative (*dead code* yang gagal dideteksi oleh sistem)).

3. **F1-Score (Akurasi Gabungan):** Digunakan sebagai nilai rata-rata harmonis (*trade-off*) antara Precision dan Recall untuk merepresentasikan tingkat akurasi atau kinerja sistem secara keseluruhan secara berimbang [15].

$$F1\text{-}Score = 2 \times \frac{Precision \times Recall}{Precision + Recall}$$

Secara teknis, pengukuran dan pencatatan hasil (TP, FP, FN) dilakukan melalui pemantauan *logging* internal, skrip evaluasi terintegrasi, serta verifikasi manual (*manual verification*).

#### 3.3.2 Pengujian Standar Mutu (ISO/IEC 25010)

Merujuk pada karakteristik standar kualitas ISO/IEC 25010, utilitas juga diukur kelayakan teknisnya melalui dua parameter berikut:

1. **Performance Efficiency**
Bertujuan untuk memastikan proses pemindaian struktur pohon AST berjalan secara optimal, ringan, dan tidak membebani komputasi pengguna. Pengukuran efisiensi ini diturunkan ke dalam dua metrik pemantauan runtime Node.js:
1. **Waktu Komputasi (Time Behavior):** Pemantauan durasi eksekusi diukur menggunakan *performance hooks* dan `console.time()`. Rumus komputasi yang dihitung adalah selisih waktu penyelesaian:


$$\Delta t = Waktu_{selesai} - Waktu_{mulai}$$


2. **Konsumsi Memori (Resource Utilization):** Tingkat alokasi memori dipantau menggunakan fungsi `process.memoryUsage()`. Beban overhead memori dihitung dengan membandingkan memori sebelum dan sesudah pohon AST diproses:


$$\Delta M = Memori_{sesudah} - Memori_{sebelum}$$


2. **Pengujian Maintainability**
Pengujian ini difokuskan pada tingkat modularitas struktur arsitektur perangkat lunak dan kemampuan sistem untuk dikembangkan di masa mendatang. Keterpeliharaan ini dijaga secara konsisten melalui kepatuhan terhadap prinsip Clean Code [16] . Kepatuhan ini divalidasi secara statis menggunakan alat analisis linter (ESLint) guna mendeteksi adanya *code smells* atau penulisan sintaksis yang merugikan.

Untuk menarik kesimpulan akhir mengenai persentase pemenuhan kelayakan perangkat lunak dari seluruh skenario pengujian yang dilakukan berdasarkan standar ISO/IEC 25010, digunakan persamaan matematis sebagai berikut [8]:

$$Persentase\ Kelayakan = \left( \frac{Total\ Skor\ Aktual}{Total\ Skor\ Maksimal} \right) \times 100\%$$