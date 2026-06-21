#### 4.4.4 Iterasi 4 : Pengembangan Modul Antarmuka dan Pelaporan (CLI & Reporter)

Iterasi keempat adalah tahap finalisasi di mana seluruh mesin inti yang telah dibangun (Analyzer, Graph Builder, dan Eliminator) dibungkus ke dalam **Modul Antarmuka (*Command Line Interface* / CLI)** dan **Sistem Pelaporan (*Reporter*)**. Modul ini menjembatani interaksi antara pengguna dengan kompleksitas mesin analisis statis.

---

##### A. Perencanaan Iterasi dan *TaskPriorityList*

Pengembangan difokuskan pada *User Experience* (UX) di terminal serta kemampuan menyajikan data kompleks menjadi visualisasi yang intuitif.

| Prioritas | ID Task | Deskripsi Task                                                                         | *User Story* |
| --------- | ------- | -------------------------------------------------------------------------------------- | ------------ |
| 1         | T4-01   | Registrasi dan *routing* perintah CLI (`scan`, `fix`, `watch`, dll) menggunakan `commander`| US-01, US-02 |
| 2         | T4-02   | Pembuatan antarmuka panduan interaktif (*Wizard*) untuk pengguna baru                  | US-01        |
| 3         | T4-03   | Pembangunan Modul *Reporter* untuk merangkum hasil analisis dalam format JSON/Terminal | US-04        |
| 4         | T4-04   | Pembangunan Modul Visualisasi HTML (*Dashboard* interaktif berbasis `mermaid.js`)      | US-04        |
| 5         | T4-05   | Pengujian fungsional *End-to-End* (E2E) seluruh perintah CLI                           | US-01 - 07   |

---

##### B. *Development Baseline*

**1. Ekosistem Perintah Terintegrasi (*CLI Commands*)**
Modul dikembangkan menggunakan *library* `commander` untuk mendefinisikan arsitektur perintah yang terstruktur. Beberapa perintah utama yang diimplementasikan meliputi:
*   `scan`: Memicu eksekusi *Analyzer* dan *Graph Builder* untuk melaporkan *dead code* tanpa mutasi.
*   `fix`: Mengeksekusi *Eliminator* dengan tingkat agresi (*Elimination Level*) yang dapat diatur melalui argumen perintah.
*   `watch`: Mode observasi berkala (berjalan di latar belakang) yang akan memindai kode setiap kali terjadi perubahan (*file save*).
*   `init`: Memanggil panduan interaktif (*Wizard*) untuk menghasilkan berkas konfigurasi `.deadkillerrc.json`.

**2. Antarmuka Panduan Interaktif (*Interactive Wizard*)**
Untuk meminimalisir kesalahan konfigurasi awal, *Interactive Wizard* (`wizard.js`) dibangun menggunakan *prompt* interaktif. Fitur ini secara dinamis bertanya kepada pengguna mengenai titik masuk (*entry point*) spesifik, preferensi keagresifan *auto-fix*, serta direktori/berkas yang ingin diabaikan (*ignore list*).

**3. Visualisasi Graf dan *Dashboard* HTML (`graphVisualizer.js`)**
Sebuah inovasi utama di fase ini adalah perintah `visualize`. Modul ini tidak hanya mengeluarkan teks di terminal, melainkan **menghasilkan sebuah *Dashboard* HTML secara otomatis** (`code-structure-trace.html`). *Dashboard* ini memuat:
*   Visualisasi arsitektur proyek (DAG) dalam bentuk graf *Mermaid*.
*   Pemetaan status keamanan anomali (*Safe, Review, Risky*).
*   Daftar *Dead Files* dan *Unsafe Files* (file yang gagal dipindai).
Setelah digenerasi, CLI secara otomatis akan membuka berkas HTML tersebut di *browser* bawaan sistem operasi.

---

##### C. Pengujian Awal

Pengujian dilakukan secara *End-to-End* (E2E) mulai dari *input* terminal hingga eksekusi mesin analisis di belakang layar.

**Status Test Case Internal:**
*   [TC-R1] Eksekusi Flag Perintah (`--dry-run`, `--level`)           ✅ BERHASIL
*   [TC-R2] Validasi *Output* Teks Terminal Berbasis Tema (*Chalk*)   ✅ BERHASIL
*   [TC-R3] Generasi HTML *Dashboard* dan Pembukaan Otomatis Browser ✅ BERHASIL
*   [TC-R4] Pembuatan Konfigurasi via Interaksi *Wizard*              ✅ BERHASIL
─────────────────────────────────────────────────────────────────
Lulus : 4 dari 4 | Stabilitas CLI: 100%

---

##### D. *Self-Review* dan *Refactor Baseline*

Tahap *self-review* menitikberatkan pada perbaikan estetika (UX) dan informasi *error handling*. Terdapat penambahan *loading spinner* (`ora`) untuk memberikan umpan balik visual saat mesin analisis sedang menambang struktur *Dependecy Tree* yang berukuran masif. Selain itu, pesan-pesan *error* di terminal dipercantik menggunakan tata warna (`chalk`) yang terpusat di `theme.js` agar konsisten dan ramah pengguna.

---

##### E. *Production Baseline*

Dengan selesainya Modul CLI dan Pelaporan, siklus hidup aplikasi **secara resmi telah lengkap (*feature complete*)**. Pengguna kini dapat membedah anomali kode, melakukan penghapusan dengan jaring pengaman, serta melihat struktur keseluruhan arsitektur proyek melalui interaksi *Command Line* yang mulus dan interaktif. Proyek dinyatakan siap memasuki fase implementasi akhir dan pengujian fungsional keseluruhan.

---

##### F. Ringkasan Penyelesaian Task Iterasi 4

| ID Task | Deskripsi | Status | Baseline |
| :--- | :--- | :--- | :--- |
| T4-01 | Registrasi dan *routing* perintah CLI (`scan`, `fix`, `watch`) | Selesai | Development |
| T4-02 | Pembuatan antarmuka *Wizard* interaktif | Selesai | Development |
| T4-03 | Pembangunan Modul *Reporter* format terminal | Selesai | Development |
| T4-04 | Pembangunan Visualisasi Graf HTML (*Dashboard*) | Selesai | Development |
| T4-05 | Pengujian fungsional E2E struktur perintah | Selesai | Development |
