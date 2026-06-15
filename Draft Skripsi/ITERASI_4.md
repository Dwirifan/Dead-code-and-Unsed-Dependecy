#### 4.4.4 Iterasi 4: Pengembangan Generator Pelaporan Visual (*Visualization Reporter*)

Iterasi keempat dalam metodologi PXP ini berfokus pada pembangunan **Visualization Reporter** (Generator Pelaporan Visual). Setelah kode dianalisis (Iterasi 2) dan dipangkas (Iterasi 3), sistem membutuhkan mekanisme untuk menyajikan metrik dan detail tindakan tersebut kepada pengguna (*developer*). Modul ini bertugas mengubah data mentah JSON hasil analisis menjadi laporan HTML interaktif yang *standalone* (mandiri) serta ringkasan CLI di terminal.

##### A. Perencanaan Iterasi dan *TaskPriorityList*

Sebelum tahapan *development* dimulai, tugas-tugas pelaporan disusun ke dalam *TaskPriorityList* sebagai berikut:

| Prioritas | ID Task | Deskripsi Task                                                                                            | *User Story* |
| --------- | ------- | --------------------------------------------------------------------------------------------------------- | ------------ |
| 1         | T4-01   | Pembuatan modul agregasi data untuk menghitung metrik (total temuan, file terdampak, rasio *dead code*)   | US-06        |
| 2         | T4-02   | Implementasi antarmuka Command Line Interface (CLI) menggunakan warna (ANSI) untuk umpan balik instan     | US-06        |
| 3         | T4-03   | Perancangan struktur HTML *Single-Page* dan injeksi CSS/JS bawaan (*embedded*)                            | US-06        |
| 4         | T4-04   | Implementasi fitur interaktif pada HTML (*Filtering* Kategori, *Sorting*, dan *Search*)                   | US-06        |
| 5         | T4-05   | Pengujian integrasi modul *Reporter* dengan alur (*pipeline*) utama aplikasi                              | US-06        |

---

##### B. *Development Baseline*

Fase ini merealisasikan alur kerja (*flow*) dari data mentah hingga menjadi visualisasi laporan yang siap dibaca oleh pengguna.

**1. Alur Kerja Pembangkitan Laporan HTML (T4-01 & T4-03)**

Sistem pelaporan dibangun dengan pendekatan *Single-File Portable Report*, di mana seluruh aset (CSS, JavaScript, dan Data) disuntikkan secara *inline* ke dalam satu berkas HTML. Hal ini memastikan laporan dapat dibuka di *browser* manapun tanpa memerlukan *web server* atau koneksi internet.

Alur pembangkitan HTML bekerja melalui tiga tahapan sekuensial:
1. **Data Aggregation (Agregasi Metrik):** Sistem mengumpulkan keluaran dari *Analyzer* dan *Eliminator*, lalu menghitung statistik utama.
2. **Template Interpolation (Injeksi Data ke Templat):** Data yang sudah diagregasi diubah menjadi format string JSON statis dan disuntikkan ke dalam kerangka HTML dasar (`template.html`).
3. **Client-Side Hydration (Render Dinamis):** *Vanilla JavaScript* me-render tabel temuan, grafik (Chart.js), dan kartu metrik ke dalam DOM.

```javascript
// Cuplikan: Logika Pembangkitan Laporan HTML (htmlReporter.js)
export function generateHTMLReport(analysisData, outputPath) {
    const template = fs.readFileSync('./templates/report.html', 'utf8');
    
    // Injeksi data analisis sebagai variabel global di dalam HTML
    const injectedHTML = template.replace(
        '/*__DATA_PLACEHOLDER__*/', 
        `window.__REPORT_DATA__ = ${JSON.stringify(analysisData)};`
    );

    fs.writeFileSync(outputPath, injectedHTML);
    console.log(`Laporan visual berhasil digenerate di: ${outputPath}`);
}
```

**2. Implementasi Pelaporan Terminal (T4-02)**

Untuk memfasilitasi lingkungan CI/CD dan umpan balik cepat, dibangun juga *reporter* berbasis terminal yang memanfaatkan kode *escape* ANSI untuk mencetak metrik berwarna, memberikan peringatan (*warning*), dan status pembersihan.

##### C. Pengujian Awal

Pada pengujian awal (T4-05) dengan himpunan proyek berskala besar (1000+ temuan *dead code*), ditemukan kegagalan performa (*UI Freezing*) pada laporan HTML yang dihasilkan.
Ketika sistem mencoba menyuntikkan ribuan baris temuan ke dalam tabel HTML sekaligus, *browser* mengalami pembekuan sesaat karena beban *reflow* dan *repaint* DOM yang terlalu masif. Laporan menjadi tidak responsif saat pengguna mencoba melakukan *scrolling*.

##### D. *Self-Review* dan Analisis Kegagalan

Berdasarkan kegagalan performa tersebut, dilakukan evaluasi teknis. Penyebab utama *freeze* adalah perenderan seluruh baris data ke dalam struktur DOM secara bersamaan. Untuk mengatasi ini, sistem membutuhkan penanganan virtualisasi atau paginasi di sisi klien (*client-side*).

Sebagai tindak lanjut, dicatat satu kebutuhan perbaikan performa:

| ID Task Baru | Deskripsi Task                                                            |
| ------------ | ------------------------------------------------------------------------- |
| T4-06        | *Performance Bug Fix*: Implementasi Paginasi *Client-Side* pada HTML Report |

##### E. Penyesuaian Implementasi dan Uji Ulang

Sesuai metodologi PXP, kegagalan performa ini langsung ditindaklanjuti di *development baseline* (T4-06). Diterapkan teknik **DOM Virtualization** (Paginasi *Client-Side*) pada logika JavaScript di dalam berkas HTML. Daripada me-render 1000 baris tabel secara bersamaan, tabel hanya menampilkan 50 baris pertama. Elemen navigasi paginasi (*Next/Prev*) ditambahkan untuk memuat sisa data sesuai permintaan pengguna.

```javascript
// Cuplikan: Logika Paginasi di dalam HTML Report untuk mencegah DOM Freeze
function renderTable(data, page = 1, limit = 50) {
    const start = (page - 1) * limit;
    const paginatedData = data.slice(start, start + limit);
    
    tbody.innerHTML = paginatedData.map(item => `
        <tr>
            <td><span class="badge ${item.type}">${item.type}</span></td>
            <td>${item.name}</td>
            <td>${item.file}:${item.line}</td>
        </tr>
    `).join('');
}
```
Hasil uji regresi pasca-perbaikan ini secara instan menurunkan waktu *render* awal dari ~3.2 detik menjadi kurang dari 0.1 detik pada proyek berskala besar, memastikan UI tetap stabil dan fungsionalitas pelaporan siap dinaikkan ke tahap *refactor*.

---

##### F. *Refactor Baseline*

Setelah masalah *DOM Bottleneck* teratasi, fase *refactoring* ini difokuskan untuk merapikan struktur injeksi *template* HTML agar lebih modular dan mudah dikelola (*maintainable*).

**Perapian Logika Injeksi (Template Refactoring)**
Logika penyatuan *string* HTML yang sebelumnya tertumpuk dalam satu berkas dipisahkan ke dalam beberapa modul kecil. Penyematan gaya (CSS) dan eksekusi skrip (*Vanilla JS*) dirapikan menggunakan blok *minify* pada tahap *build* internal agar *output* laporan *single-file* yang dihasilkan memiliki ukuran dokumen (*file size*) yang jauh lebih ringan, padat, dan ringkas.

---

##### G. *Production Baseline*

Tahapan akhir ini mengunci antarmuka pelaporan (*Reporter*) setelah terbukti stabil menangani data masif dan memberikan *User Experience* (UX) yang optimal tanpa mengalami *freeze*.

Laporan Visual akhir divalidasi memiliki kapabilitas utuh berikut:
1. **Executive Dashboard**: Menampilkan diagram lingkaran (Kategori *Dead Code*) dan metrik reduksi.
2. **Interactive Data Table**: Tabel temuan yang dilengkapi fitur pencarian (*Search*), pengurutan (*Sort*), dan Paginasi *Client-Side*.
3. **Filter Berbasis Kepercayaan (*Confidence*)**: Pengguna dapat menyaring temuan berdasarkan label `High Confidence` (aman dihapus) atau `Low Confidence` (butuh tinjauan manual).

Modul keempat ini secara remi diintegrasikan sebagai penutup siklus audit sistem. Pembuatan laporan *single-file* yang portabel terbukti sangat memfasilitasi komunikasi kualitas kode antarpengembang tanpa kerumitan instalasi dependensi tambahan.

---

##### H. Ringkasan Penyelesaian Task Iterasi 4

Sebagai penutup iterasi keempat, berikut adalah rekapitulasi penyelesaian *tasks*:

| ID Task | Deskripsi                                              | Status  | Baseline    |
| ------- | ------------------------------------------------------ | ------- | ----------- |
| T4-01   | Pembuatan modul agregasi metrik                        | Selesai | Development |
| T4-02   | Implementasi antarmuka terminal (CLI)                  | Selesai | Development |
| T4-03   | Injeksi Data ke Struktur HTML *Single-Page*            | Selesai | Development |
| T4-04   | Implementasi fitur interaktif (*Filtering*, *Sorting*) | Selesai | Development |
| T4-05   | Pengujian Integrasi (Menemukan *DOM Bottleneck*)       | Selesai | Development |
| T4-06   | *Bug Fix*: Implementasi Paginasi *Client-Side*         | Selesai | Development |
