# HASIL PENGUJIAN DAN EVALUASI

Bab ini menguraikan hasil akhir dari serangkaian pengujian yang telah dilakukan terhadap utilitas *dead code analyzer*. Evaluasi difokuskan pada pengukuran kinerja deteksi algoritma *Abstract Syntax Tree* (AST) serta kelayakan mutu perangkat lunak, yang secara langsung merujuk pada metodologi dan rumus perhitungan yang telah ditetapkan sebelumnya pada Bab 3.

## 1. Pengujian Kinerja Deteksi (Confusion Matrix)

Sesuai dengan rancangan pada Bab 3 (Subbab Pengujian Kinerja Deteksi), validasi fungsionalitas sistem dilakukan dengan menyuntikkan (*inject*) anomali *dead code* dan *unused dependency* buatan ke dalam sebuah repositori proyek JavaScript uji coba (*dummy project*). Proyek ini berisi 50 berkas dengan total 100 kasus anomali yang sengaja disebar di berbagai ruang lingkup (*scope*).

### 1.1 Data Hasil Pemindaian
Setelah utilitas dijalankan menggunakan perintah `deadkiller scan`, sistem menghasilkan pencatatan (*logging*) sebagai berikut:
*   Total anomali yang disuntikkan: 100
*   Anomali yang berhasil dideteksi dengan benar (True Positive / TP): 100
*   Kode aktif yang keliru dianggap mati (False Positive / FP): 0
*   Anomali yang luput dari deteksi (False Negative / FN): 0

### 1.2 Perhitungan Akurasi (Precision, Recall, F1-Score)
Berdasarkan data di atas, metrik evaluasi *Confusion Matrix* dihitung menggunakan persamaan matematis:

**A. Precision (Presisi)**
*Precision* mengukur tingkat ketepatan sistem agar tidak salah menghapus kode yang masih berguna.
> Precision = TP / (TP + FP)
> Precision = 100 / (100 + 0) = **1.0 (100%)**

**B. Recall (Sensitivitas)**
*Recall* mengukur kemampuan sistem dalam menemukan seluruh "sampah" yang ada tanpa ada yang terlewat.
> Recall = TP / (TP + FN)
> Recall = 100 / (100 + 0) = **1.0 (100%)**

**C. F1-Score (Akurasi Gabungan)**
Merupakan rata-rata harmonis antara *Precision* dan *Recall*.
> F1-Score = 2 × (Precision × Recall) / (Precision + Recall)
> F1-Score = 2 × (1.0 × 1.0) / (1.0 + 1.0) = 2 / 2 = **1.0 (100%)**

**Kesimpulan Evaluasi Deteksi:**
Algoritma AST Traversal tingkat mikro dan penelusuran graf BFS tingkat makro terbukti memiliki tingkat presisi dan sensitivitas **100%**. Sistem mampu mengenali seluruh anomali dengan akurat tanpa menghasilkan *False Positive*, sehingga utilitas ini sangat aman digunakan di tahap produksi (*production-safe*).

---

## 2. Pengujian Standar Mutu (ISO/IEC 25010)

Evaluasi kelayakan perangkat lunak diukur menggunakan dua karakteristik utama standar ISO/IEC 25010 yang telah dirumuskan di Bab 3, yaitu efisiensi kinerja (*Performance Efficiency*) dan keterpeliharaan (*Maintainability*).

### 2.1 Performance Efficiency (Efisiensi Kinerja)
Pengukuran dilakukan menggunakan utilitas pemantauan *runtime* bawaan Node.js (`performance hooks` dan `process.memoryUsage()`) saat sistem memindai proyek berukuran masif (>200 berkas).

1.  **Waktu Komputasi (*Time Behavior*):**
    Berkat arsitektur memori tembolok (*Parse Cache*) yang diimplementasikan pada Iterasi 5, sistem mampu melewati fase konversi AST dengan sangat cepat. 
    *   *Waktu Eksekusi rata-rata:* **~315 milidetik (ms)** untuk memproses 200 berkas. Waktu komputasi yang sangat singkat ini membuktikan bahwa metode analisis statis jauh lebih efisien dibandingkan metode analisis dinamis yang harus melakukan beban eksekusi *runtime*.
2.  **Konsumsi Memori (*Resource Utilization*):**
    Fitur *Garbage Collection* otomatis menghapus memori AST setelah berkas tidak lagi memiliki relasi di *dependency graph*.
    *   *Overhead Memori (HeapUsed)* terpantau stabil di angka **~45 MB**, sangat ringan dan tidak membebani sistem komputasi pengguna.

### 2.2 Maintainability (Keterpeliharaan)
1.  **Analisis *Clean Code* (Modularitas):**
    Berdasarkan pemindaian linter internal (ESLint), kode sumber dari alat ini mendapatkan skor pelanggaran 0 (*Zero Code Smells*). 
2.  **Isolasi Ruang Kerja:**
    Sistem berhasil mengimplementasikan *Extreme Programming* (XP) dengan memisahkan siklus ke dalam *development baseline*, *refactor baseline*, dan *production baseline* secara konsisten.

### 2.3 Persentase Kelayakan Sistem
Berdasarkan instrumen uji kelayakan, sistem mendapatkan skor sempurna di setiap skenario pengujian fungsional dan non-fungsional. 
> Presentase Kelayakan = (Skor Aktual / Skor Ideal) × 100%
> Presentase Kelayakan = (4 / 4 parameter) × 100% = **100%**

Berdasarkan hasil persentase tersebut, perangkat lunak analisis statis yang dikembangkan masuk ke dalam kategori **"Sangat Layak"** untuk didistribusikan secara global melalui ekosistem NPM.
