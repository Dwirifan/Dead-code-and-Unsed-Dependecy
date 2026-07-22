const fs = require('fs');
const file = 'd:\\Materi Kuliah\\Tugas Akhir\\Tugas Akhir\\Draft Skripsi\\ITERASI_4.md';
const text = fs.readFileSync(file, 'utf8');
const lines = text.split('\n');

const patchText = `3. **Dialog Persetujuan Interaktif:** Pada mode penindakan, sistem menampilkan pratinjau perubahan dan meminta konfirmasi pengguna sebelum modifikasi berkas dilakukan.
4. **Laporan Dependensi:** Menampilkan daftar dependensi NPM yang terdeteksi tidak digunakan, termasuk perbandingan antara dependensi yang dideklarasikan dan dependensi yang benar-benar digunakan.

**B.    Dokumen Visualisasi HTML Interaktif (Dashboard)**
Dokumen HTML interaktif dirancang sebagai luaran baca-saja (read-only) untuk membantu pengguna memahami struktur proyek secara visual. Luaran ini tidak digunakan untuk mengeksekusi penghapusan kode, tetapi berfungsi sebagai media pelaporan dan validasi hasil analisis. Melalui visualisasi ini, pengguna dapat melihat hubungan antarberkas, dependensi aktif, dependensi tidak terpakai, serta temuan kode mati dalam bentuk yang lebih terstruktur.

Secara umum, dokumen visualisasi HTML terdiri dari beberapa elemen utama:
1. **Kepala Halaman (Header):** Menampilkan identitas perangkat lunak dan ringkasan utama, seperti jumlah berkas aktif, dependensi terpakai, dan dependensi tidak terpakai.
2. **Bilah Statistik (Statistics Strip):** Menyajikan metrik utama dalam bentuk kartu statistik, seperti total berkas aktif, jumlah koneksi graf, dan total dependensi proyek.
3. **Panel Graf Interaktif:** Menampilkan graf ketergantungan antarberkas dengan dukungan interaksi seperti zoom, drag, dan penyorotan hubungan antar-node.
4. **Panel Samping (Sidebar):** Menyediakan legenda direktori, daftar dependensi yang digunakan, dan daftar dependensi yang tidak digunakan.
5. **Bagian Laporan Kode Mati:** Menampilkan tabel temuan berdasarkan kategori safe, review, dan risky. Setiap temuan memuat informasi nama berkas, nomor baris, nama entitas, tipe anomali, tingkat keyakinan, dan status keamanan.
6. **Fitur Pendukung Aksesibilitas:** Menyediakan dukungan dua bahasa serta mode tampilan gelap dan terang (dark/light mode) untuk menyesuaikan preferensi pengguna.

**3. Arsitektur dan Cakupan Perintah CLI**
Sebagai utilitas berbasis terminal, Modul CLI dirancang memiliki ekosistem perintah yang komprehensif untuk mendukung seluruh siklus analisis, eliminasi, dan audit. Sistem mendefinisikan sembilan perintah eksplisit yang dapat dipanggil langsung oleh pengguna:
*   \`scan [projectPath]\`: Menjalankan pemindaian statis pada direktori target untuk mendeteksi *dead code* dan dependensi yang tidak terpakai, lalu mencetak ringkasannya di terminal.
*   \`fix [projectPath]\`: Mengeksekusi proses modifikasi (penghapusan atau perlindungan level) secara fisik pada berkas sumber berdasarkan hasil pemindaian terakhir, diawali dengan pembuatan cadangan.
*   \`show-deps [projectPath]\`: Menampilkan laporan khusus mengenai perbandingan antara dependensi proyek (NPM) yang dideklarasikan dengan yang benar-benar diimpor dalam kode.
*   \`visualize [projectPath]\`: Menghasilkan berkas *Dashboard HTML* interaktif dan membukanya di peramban untuk menyajikan graf arsitektur Cytoscape.js.
*   \`trace <fileName>\`: Melacak jejak ketergantungan (rantai impor/ekspor) dari satu berkas spesifik guna membantu pengguna melakukan audit kode secara terisolasi.
*   \`watch [projectPath]\`: Mengaktifkan pemantauan berkelanjutan (*file watcher*), di mana analisis akan dijalankan ulang secara otomatis setiap kali mendeteksi perubahan pada berkas kode sumber.
*   \`report [projectPath]\`: Menghasilkan dan mengekspor dokumen laporan statis (format JSON) untuk keperluan integrasi dengan sistem *Continuous Integration* (CI/CD).
*   \`history\`: Menampilkan riwayat modifikasi dan daftar *snapshot* cadangan yang pernah dibuat oleh sistem, berguna untuk skenario pemulihan proyek (*rollback*).
*   \`init\`: Menghasilkan berkas konfigurasi bawaan (\`deadkiller.config.js\`) pada direktori target, memungkinkan pengguna mendefinisikan aturan pengecualian (seperti berkas atau fungsi yang dilarang dihapus).

Rancangan antarmuka visualisasi HTML tersebut ditunjukkan pada Gambar 4.7.

<mxGraphModel dx="3142" dy="1740" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">
  <root>
    <mxCell id="0" />
    <mxCell id="1" parent="0" />
    <mxCell id="Bmgpohvmm5VKlapb3zCL-268" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#333333;strokeWidth=2;" value="" vertex="1">
      <mxGeometry height="1560" width="1160" x="760" y="730" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-269" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#e0e0e0;strokeColor=#333333;strokeWidth=2;align=left;spacingLeft=15;fontStyle=1" value="Dashboard DeadKiller - Code Traceability" vertex="1">
      <mxGeometry height="40" width="1160" x="760" y="730" as="geometry" />
    </mxCell>`;

lines.splice(80, 0, patchText);
fs.writeFileSync(file, lines.join('\n'));
console.log('Fixed successfully.');
