#### 4.4.2 Iterasi 2: Pengembangan Mesin Pemetaan & Analisis (Graph Builder & Analyzer)

Iterasi kedua berfokus pada pembangunan *Graph Builder* untuk memetakan hubungan dependensi lintas berkas dan *Analyzer* untuk menganalisis AST pada tingkat intra-file dan lintas berkas. Kedua modul tersebut digunakan untuk mendeteksi *dead code*, anomali alur data dan kontrol, serta masalah dependensi lintas berkas berdasarkan hasil analisis statis.

Tahap ini bergantung penuh pada Modul *Core Parser* (Iterasi 1). *Graph Builder* memperoleh AST melalui fungsi `parseCode()` dari modul parser. Pada fase analisis AST yang dijalankan setelahnya, `ParseCache` digunakan untuk menghindari pembacaan dan *parsing* ulang berkas yang sama apabila berkas tersebut diminta kembali dalam satu sesi pemindaian.

---

##### A. Tahap Perencanaan (Planning)

Pengembangan mesin pemetaan dan analisis dipecah menjadi unit tugas teknis berdasarkan spesifikasi *Component Diagram*. Tugas-tugas disusun ke dalam *Task Priority List* sebagai berikut:

| Prioritas | ID Task | Deskripsi Task                                                                         | *User Story* |
| --------- | ------- | -------------------------------------------------------------------------------------- | ------------ |
| 1         | T2-01   | Implementasi algoritma pengelolaan lingkup leksikal untuk analisis intra-berkas        | US-04        |
| 2         | T2-02   | Implementasi traversal AST menggunakan estraverse                                      | US-04        |
| 3         | T2-03   | Pengujian validasi purwarupa analyzer terhadap konstruksi kode JavaScript              | US-04        |
| 4         | T2-04   | Implementasi *Graph Builder* berbasis BFS untuk menyusun graf dependensi lintas berkas | US-03        |
| 5         | T2-05   | Implementasi Unused Dependency Analyzer untuk membandingkan manifes proyek dengan himpunan paket yang digunakan  | US-04        |
| 6         | T2-06   | Pengujian integrasi lintas modul (Graph + Analyzer)                                    | US-03, US-04 |
| 7         | T2-07   | Pembangunan Mesin Aturan (Rule Engine) dan integrasi `deadkiller.config.js`            | US-04        |

Selain pembagian tugas, tahap perencanaan ini juga merumuskan **Kriteria Keberhasilan Iterasi**. Rencana pengujian disusun pada awal iterasi untuk memvalidasi kesesuaian keluaran Graph Builder dan Analyzer terhadap hasil yang diharapkan pada berbagai konstruksi kode dan struktur berkas.

Cakupan pengujian tersebut dikelompokkan berdasarkan aspek anomali yang akan divalidasi, sebagaimana ditunjukkan pada tabel berikut.

**Tabel 4.x Rencana Cakupan Pengujian Modul *Graph Builder*, *Analyzer*, *Dependency Analyzer*, dan *Rule Engine***

| Kelompok Uji | Cakupan Analisis | Tujuan Pengujian |
| :--- | :--- | :--- |
| **AST Dasar & Deklarasi** | Variabel tak terbaca, fungsi tak terpanggil, *import* mubazir, dan *destructuring*. | Memvalidasi pendeteksian entitas dasar yang tidak digunakan di tingkat sintaks. |
| **Percabangan Statis** | *Constant Folding* (`if (1+1===3)`) dan perulangan statis (`while(false)`). | Menguji kemampuan evaluasi *analyzer* pada lintasan eksekusi yang mustahil. |
| **Lingkup Leksikal dan Deklarasi TypeScript** | Lexical scope, closure, interface, dan type. | Memvalidasi resolusi deklarasi dan referensi pada lingkup yang saling bertingkat. |
| **Analisis Alur Kontrol** | *Unreachable code* setelah pernyataan terminator seperti `return`, `throw`, dan `break`. | Memvalidasi kemampuan analisis alur kontrol statis dalam mendeteksi kode yang tidak dapat dijangkau. |
| **Logika Kontradiktif** | Ekspresi mustahil (`x > 10 && x < 5`). | Menguji ketajaman evaluasi matematis pada operator logika. |
| **Redundansi Operasi** | *Self-assignment* dan penugasan variabel berulang yang ditimpa seketika. | Mendeteksi instruksi yang tereksekusi namun tidak memberikan dampak perubahan *state*. |
| **Pengecualian Analisis** | Prefiks variabel, daftar berkas yang dipertahankan, serta pola direktori yang ditentukan melalui konfigurasi. | Memvalidasi kemampuan Rule Engine dalam mengecualikan entitas atau berkas tertentu dari kandidat temuan. |
| **Arsitektur Lintas-Berkas** | Algoritma *Breadth-First Search* (BFS), pemetaan *barrel file*, dan *unused dependency*. | Menguji *Graph Builder* dalam mengkonstruksi relasi graf dependensi berarah antar berkas yang kompleks. |

---

##### B. Tahap Perancangan (Design)

Fokus utama adalah merealisasikan Task T2-01 hingga T2-07. Secara modular, sistem dirancang untuk mendeteksi sejumlah klasifikasi anomali yang dikelompokkan ke dalam lima kategori utama:
*   **Kode Mati Berbasis Referensi:** Melacak siklus hidup variabel (*Read/Write Differentiation*).
*   **Kode Tak Terjangkau:** Mengevaluasi lintasan eksekusi statis (*Terminator Scan*: `return`, `break`).
*   **Logika Duplikat & Kontradiksi:** Menganalisis semantik dengan algoritma komparasi *Deep AST Equality*.
*   **Kode Redundan:** Mendeteksi instruksi tereksekusi yang tidak mengubah *state* program (penugasan mandiri).
*   **Anomali Lintas-Berkas:** Mengidentifikasi berkas yang tidak terjangkau dari *entry point* serta anomali hubungan dependensi antarmodul.

Setiap temuan dilengkapi dua atribut, yaitu tingkat keyakinan (*confidence*) dan status penanganan. Tingkat keyakinan menunjukkan kekuatan bukti hasil analisis statis, sedangkan status *safe*, *review*, atau *risky* menentukan perlakuan temuan pada Modul Eliminator.

Untuk mendeteksi kelima kategori anomali di atas, arsitektur Modul *Analyzer* dan *Graph Builder* dirancang melalui lima pendekatan komputasional inti. Setiap pendekatan dibangun untuk memecahkan klasifikasi anomali yang spesifik, yang dijabarkan sebagai berikut:

**1. Perancangan Scope & Traversal AST**

Analisis pada tingkat sintaksis dilakukan untuk mendeteksi variabel, fungsi, parameter, impor, dan metode kelas yang tidak memiliki referensi penggunaan di dalam satu berkas (*intra-file dead code*). Proses ini dilakukan melalui penelusuran *Abstract Syntax Tree* (AST), yaitu dengan mengunjungi simpul-simpul AST secara rekursif tanpa menjalankan kode sumber.

Pada tahap awal, sistem memperoleh AST dan menginisialisasi lingkup global. Selama penelusuran, setiap deklarasi dicatat ke dalam tabel lingkup, sedangkan penggunaan *identifier* direkam sebagai referensi `read` atau `write`. Setelah seluruh simpul selesai ditelusuri, sistem mencocokkan setiap referensi dengan deklarasi pada lingkup yang sesuai. Deklarasi yang tidak memiliki referensi baca atau hanya mengalami operasi penulisan kemudian dihasilkan sebagai kandidat *dead code*.

Analisis juga mencakup pendeteksian metode kelas yang tidak memiliki pemanggilan statis. Temuan ini bersifat heuristik karena metode dapat digunakan melalui pewarisan, refleksi, *dependency injection*, akses properti terkomputasi, atau pemanggilan dinamis. Oleh karena itu, temuan *unused class method* diberi status *review* dan tidak diperlakukan sebagai kandidat penghapusan otomatis.

Mekanisme penelusuran AST dan resolusi lingkup tersebut ditunjukkan pada diagram aktivitas berikut.

<mxGraphModel dx="123" dy="582" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">
  <root>
    <mxCell id="0" />
    <mxCell id="1" parent="0" />
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-49" connectable="0" parent="1" style="group" value="" vertex="1">
      <mxGeometry height="1470" width="640" x="990" y="730" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-50" parent="8_Jw-E5cd3tC5uKqgBw4-49" style="ellipse;whiteSpace=wrap;html=1;fillColor=#000000;strokeColor=#000000;" value="" vertex="1">
      <mxGeometry height="40" width="40" x="300" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-51" parent="8_Jw-E5cd3tC5uKqgBw4-49" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;fontStyle=0;align=center;strokeWidth=1.5;" value="Baca Kode Sumber File" vertex="1">
      <mxGeometry height="60" width="160" x="240" y="100" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-52" parent="8_Jw-E5cd3tC5uKqgBw4-49" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;align=center;strokeWidth=1.5;" value="Peroleh AST dari&lt;br&gt;Core Parser atau ParseCache" vertex="1">
      <mxGeometry height="60" width="160" x="240" y="200" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-53" parent="8_Jw-E5cd3tC5uKqgBw4-49" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;align=center;strokeWidth=1.5;" value="Inisialisasi Scope&lt;br&gt;dan Tabel Deklarasi" vertex="1">
      <mxGeometry height="60" width="160" x="240" y="300" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-54" parent="8_Jw-E5cd3tC5uKqgBw4-49" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;align=center;strokeWidth=1.5;" value="Mulai Penelusuran&lt;br&gt;dari Root Node" vertex="1">
      <mxGeometry height="60" width="160" x="240" y="400" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-55" parent="8_Jw-E5cd3tC5uKqgBw4-49" style="rhombus;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;fontStyle=1;align=center;strokeWidth=1.5;" value="Evaluasi Tipe Node" vertex="1">
      <mxGeometry height="80" width="160" x="240" y="500" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-56" parent="8_Jw-E5cd3tC5uKqgBw4-49" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;align=center;strokeWidth=1.5;" value="Catat Deklarasi&lt;br&gt;pada Lingkup yang Sesuai" vertex="1">
      <mxGeometry height="60" width="160" y="640" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-57" parent="8_Jw-E5cd3tC5uKqgBw4-49" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;align=center;strokeWidth=1.5;" value="Catat Referensi&lt;br&gt;Read atau Write" vertex="1">
      <mxGeometry height="60" width="160" x="480" y="640" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-58" parent="8_Jw-E5cd3tC5uKqgBw4-49" style="rhombus;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;fontStyle=1;align=center;strokeWidth=1.5;" value="Apakah Node Memiliki&lt;br&gt;Node Anak?" vertex="1">
      <mxGeometry height="80" width="160" x="240" y="740" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-59" parent="8_Jw-E5cd3tC5uKqgBw4-49" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;align=center;strokeWidth=1.5;" value="Kunjungi Child Node&lt;br&gt;secara Rekursif" vertex="1">
      <mxGeometry height="60" width="160" y="860" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-60" parent="8_Jw-E5cd3tC5uKqgBw4-49" style="rhombus;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;fontStyle=1;align=center;strokeWidth=1.5;" value="Apakah Seluruh Node&lt;br&gt;Telah Ditelusuri?" vertex="1">
      <mxGeometry height="80" width="160" x="240" y="980" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-61" parent="8_Jw-E5cd3tC5uKqgBw4-49" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;align=center;strokeWidth=1.5;" value="Pindah ke Node Induk /&lt;br&gt;Node Berikutnya" vertex="1">
      <mxGeometry height="60" width="160" x="480" y="860" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-62" parent="8_Jw-E5cd3tC5uKqgBw4-49" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;align=center;strokeWidth=1.5;" value="Resolusikan Referensi&lt;br&gt;terhadap Deklarasi" vertex="1">
      <mxGeometry height="60" width="160" x="240" y="1120" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-63" parent="8_Jw-E5cd3tC5uKqgBw4-49" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;align=center;strokeWidth=1.5;" value="Saring Deklarasi&lt;br&gt;Tanpa Referensi Baca" vertex="1">
      <mxGeometry height="60" width="160" x="240" y="1220" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-64" parent="8_Jw-E5cd3tC5uKqgBw4-49" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;align=center;strokeWidth=1.5;" value="Hasilkan Daftar Temuan Dead Code Intra-file" vertex="1">
      <mxGeometry height="60" width="160" x="240" y="1320" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-65" parent="8_Jw-E5cd3tC5uKqgBw4-49" style="ellipse;shape=doubleEllipse;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=2;" value="" vertex="1">
      <mxGeometry height="40" width="40" x="300" y="1430" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-66" parent="8_Jw-E5cd3tC5uKqgBw4-49" style="ellipse;whiteSpace=wrap;html=1;fillColor=#000000;strokeColor=#000000;" value="" vertex="1">
      <mxGeometry height="20" width="20" x="310" y="1440" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-67" edge="1" parent="8_Jw-E5cd3tC5uKqgBw4-49" source="8_Jw-E5cd3tC5uKqgBw4-50" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;" target="8_Jw-E5cd3tC5uKqgBw4-51">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-68" edge="1" parent="8_Jw-E5cd3tC5uKqgBw4-49" source="8_Jw-E5cd3tC5uKqgBw4-51" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;" target="8_Jw-E5cd3tC5uKqgBw4-52">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-69" edge="1" parent="8_Jw-E5cd3tC5uKqgBw4-49" source="8_Jw-E5cd3tC5uKqgBw4-52" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;" target="8_Jw-E5cd3tC5uKqgBw4-53">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-70" edge="1" parent="8_Jw-E5cd3tC5uKqgBw4-49" source="8_Jw-E5cd3tC5uKqgBw4-53" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;" target="8_Jw-E5cd3tC5uKqgBw4-54">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-71" edge="1" parent="8_Jw-E5cd3tC5uKqgBw4-49" source="8_Jw-E5cd3tC5uKqgBw4-54" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;" target="8_Jw-E5cd3tC5uKqgBw4-55">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-72" edge="1" parent="8_Jw-E5cd3tC5uKqgBw4-49" source="8_Jw-E5cd3tC5uKqgBw4-55" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;" target="8_Jw-E5cd3tC5uKqgBw4-56" value="Node Deklarasi">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-73" edge="1" parent="8_Jw-E5cd3tC5uKqgBw4-49" source="8_Jw-E5cd3tC5uKqgBw4-55" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;" target="8_Jw-E5cd3tC5uKqgBw4-57" value="Node Penggunaan">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-74" edge="1" parent="8_Jw-E5cd3tC5uKqgBw4-49" source="8_Jw-E5cd3tC5uKqgBw4-55" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;" target="8_Jw-E5cd3tC5uKqgBw4-58" value="Tipe Lainnya">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-75" edge="1" parent="8_Jw-E5cd3tC5uKqgBw4-49" source="8_Jw-E5cd3tC5uKqgBw4-56" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;" target="8_Jw-E5cd3tC5uKqgBw4-58">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-76" edge="1" parent="8_Jw-E5cd3tC5uKqgBw4-49" source="8_Jw-E5cd3tC5uKqgBw4-57" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;" target="8_Jw-E5cd3tC5uKqgBw4-58">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-77" edge="1" parent="8_Jw-E5cd3tC5uKqgBw4-49" source="8_Jw-E5cd3tC5uKqgBw4-58" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;" target="8_Jw-E5cd3tC5uKqgBw4-59" value="Ya">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-78" edge="1" parent="8_Jw-E5cd3tC5uKqgBw4-49" source="8_Jw-E5cd3tC5uKqgBw4-58" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;" target="8_Jw-E5cd3tC5uKqgBw4-60" value="Tidak">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-79" edge="1" parent="8_Jw-E5cd3tC5uKqgBw4-49" source="8_Jw-E5cd3tC5uKqgBw4-60" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;" target="8_Jw-E5cd3tC5uKqgBw4-61" value="Belum">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-80" edge="1" parent="8_Jw-E5cd3tC5uKqgBw4-49" source="8_Jw-E5cd3tC5uKqgBw4-60" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;" target="8_Jw-E5cd3tC5uKqgBw4-62" value="Sudah">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-81" edge="1" parent="8_Jw-E5cd3tC5uKqgBw4-49" source="8_Jw-E5cd3tC5uKqgBw4-62" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;" target="8_Jw-E5cd3tC5uKqgBw4-63">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-82" edge="1" parent="8_Jw-E5cd3tC5uKqgBw4-49" source="8_Jw-E5cd3tC5uKqgBw4-63" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jetty.height=auto;html=1;strokeColor=#000000;" target="8_Jw-E5cd3tC5uKqgBw4-64">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-83" edge="1" parent="8_Jw-E5cd3tC5uKqgBw4-49" source="8_Jw-E5cd3tC5uKqgBw4-64" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;" target="8_Jw-E5cd3tC5uKqgBw4-65">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-84" edge="1" parent="8_Jw-E5cd3tC5uKqgBw4-49" source="8_Jw-E5cd3tC5uKqgBw4-59" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=0;exitY=0.5;exitDx=0;exitDy=0;entryX=0.194;entryY=0.729;entryDx=0;entryDy=0;entryPerimeter=0;" target="8_Jw-E5cd3tC5uKqgBw4-55">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="8_Jw-E5cd3tC5uKqgBw4-85" edge="1" parent="8_Jw-E5cd3tC5uKqgBw4-49" source="8_Jw-E5cd3tC5uKqgBw4-61" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0.802;entryY=0.704;entryDx=0;entryDy=0;entryPerimeter=0;" target="8_Jw-E5cd3tC5uKqgBw4-55">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
  </root>
</mxGraphModel>



**Gambar 4.3 Activity Diagram Penelusuran AST dan Resolusi Lingkup**


**2. Perancangan Analisis Alur Data dan Kontrol**

Untuk mendeteksi *dead code* yang tidak dapat ditemukan hanya melalui pencatatan deklarasi dan referensi, komponen *Analyzer* menerapkan analisis alur data dan kontrol dalam cakupan statis terbatas. Sistem memindai struktur blok, percabangan, perulangan, serta pernyataan terminator seperti `return`, `throw`, dan `break` untuk membentuk representasi alur kontrol sederhana dan mengidentifikasi kode yang tidak dapat dijangkau.

Selain itu, sistem menelusuri urutan penugasan dalam setiap blok untuk mendeteksi pola *write-write*, yaitu ketika suatu nilai ditimpa sebelum sempat dibaca, sehingga diklasifikasikan sebagai *dead store*. Penelusuran graf pemanggilan fungsi internal juga dilakukan menggunakan DFS untuk mengidentifikasi fungsi atau kelompok fungsi yang tidak terhubung dengan alur pemanggilan utama (*orphan function*).

Mekanisme analisis alur data dan kontrol tersebut ditunjukkan pada diagram aktivitas berikut.

<mxGraphModel dx="2009" dy="1180" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">
  <root>
    <mxCell id="0" />
    <mxCell id="1" parent="0" />
    <mxCell id="PnpFMgiFixlFpZrYTwUK-1" parent="1" style="ellipse;whiteSpace=wrap;html=1;fillColor=#000000;strokeColor=#000000;" value="" vertex="1">
      <mxGeometry height="40" width="40" x="290" y="490" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-2" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;align=center;strokeWidth=1.5;" value="Memindai Struktur Blok dan Pernyataan Terminator" vertex="1">
      <mxGeometry height="60" width="160" x="230" y="570" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-3" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;align=center;strokeWidth=1.5;" value="Identifikasi Unreachable&lt;br&gt;Blocks" vertex="1">
      <mxGeometry height="60" width="160" x="230" y="670" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-4" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;align=center;strokeWidth=1.5;" value="Iterasi BlockStatement&lt;br&gt;(Pelacakan Penugasan)" vertex="1">
      <mxGeometry height="60" width="160" x="230" y="770" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-5" parent="1" style="rhombus;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;fontStyle=1;align=center;strokeWidth=1.5;" value="Pola Write-Write&lt;br&gt;tanpa Read?" vertex="1">
      <mxGeometry height="80" width="160" x="230" y="870" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-6" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;align=center;strokeWidth=1.5;" value="Tandai sebagai&lt;br&gt;Dead Store" vertex="1">
      <mxGeometry height="60" width="160" x="430" y="880" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-7" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;align=center;strokeWidth=1.5;" value="Penelusuran Pemanggilan Fungsi Internal" vertex="1">
      <mxGeometry height="60" width="160" x="230" y="990" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-8" parent="1" style="rhombus;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;fontStyle=1;align=center;strokeWidth=1.5;" value="Fungsi Tidak&lt;br&gt;Pernah Dipanggil?" vertex="1">
      <mxGeometry height="80" width="160" x="230" y="1090" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-9" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;align=center;strokeWidth=1.5;" value="Tandai sebagai&lt;br&gt;Orphan Function" vertex="1">
      <mxGeometry height="60" width="160" x="430" y="1100" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-10" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;align=center;strokeWidth=1.5;" value="Hasilkan Daftar Temuan Analisis Alur Data dan Kontrol" vertex="1">
      <mxGeometry height="60" width="160" x="230" y="1210" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-11" parent="1" style="ellipse;shape=doubleEllipse;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=2;" value="" vertex="1">
      <mxGeometry height="40" width="40" x="290" y="1310" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-12" parent="1" style="ellipse;whiteSpace=wrap;html=1;fillColor=#000000;strokeColor=#000000;" value="" vertex="1">
      <mxGeometry height="20" width="20" x="300" y="1320" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-13" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-1" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;" target="PnpFMgiFixlFpZrYTwUK-2">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-14" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-2" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;" target="PnpFMgiFixlFpZrYTwUK-3">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-15" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-3" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;" target="PnpFMgiFixlFpZrYTwUK-4">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-16" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-4" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;" target="PnpFMgiFixlFpZrYTwUK-5">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-17" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-5" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;" target="PnpFMgiFixlFpZrYTwUK-6" value="Ya">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-18" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-5" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;" target="PnpFMgiFixlFpZrYTwUK-7" value="Tidak">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-19" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-6" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;exitX=0.5;exitY=1;entryX=1;entryY=0.5;" target="PnpFMgiFixlFpZrYTwUK-7">
      <mxGeometry relative="1" as="geometry">
        <Array as="points">
          <mxPoint x="510" y="1020" />
        </Array>
      </mxGeometry>
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-20" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-7" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;" target="PnpFMgiFixlFpZrYTwUK-8">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-21" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-8" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;" target="PnpFMgiFixlFpZrYTwUK-9" value="Ya">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-22" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-8" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;" target="PnpFMgiFixlFpZrYTwUK-10" value="Tidak">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-23" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-9" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;exitX=0.5;exitY=1;entryX=1;entryY=0.5;" target="PnpFMgiFixlFpZrYTwUK-10">
      <mxGeometry relative="1" as="geometry">
        <Array as="points">
          <mxPoint x="510" y="1240" />
        </Array>
      </mxGeometry>
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-24" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-10" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;" target="PnpFMgiFixlFpZrYTwUK-11">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
  </root>
</mxGraphModel>




**Gambar 4.4 Activity Diagram Analisis Alur Data dan Kontrol**

**3. Perancangan Mesin Pemetaan (*Graph Builder*)**

Modul *Graph Builder* dirancang untuk memetakan hubungan antarmodul ke dalam graf dependensi berarah menggunakan algoritma *Breadth-First Search* (BFS). Proses dimulai dengan menentukan *entry point* berdasarkan konfigurasi dan metadata proyek, kemudian menyelesaikan jalur impor relatif, ekstensi berkas, serta alias yang didukung melalui `enhanced-resolve`.

Selama penelusuran, sistem mengekstrak deklarasi impor, mencatat hubungan antarberkas, dan menyimpan paket eksternal ke dalam himpunan `usedPackages`. Himpunan `visitedFiles` digunakan untuk mencegah pemrosesan berulang dan perulangan tanpa akhir ketika graf mengandung siklus. Setelah graf terbentuk, DFS dengan pewarnaan simpul digunakan untuk mendeteksi *circular dependency*.

Alur pembentukan dan analisis graf dependensi tersebut ditunjukkan pada diagram aktivitas berikut.

<mxGraphModel dx="2812" dy="1652" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">
  <root>
    <mxCell id="0" />
    <mxCell id="1" parent="0" />
    <mxCell id="PnpFMgiFixlFpZrYTwUK-52" parent="1" style="ellipse;whiteSpace=wrap;html=1;fillColor=#000000;strokeColor=#000000;" value="" vertex="1">
      <mxGeometry height="40" width="40" x="695" y="470" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-53" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;align=center;strokeWidth=1.5;" value="Inisialisasi Antrean BFS&lt;br&gt;dan Himpunan Visited&lt;br&gt;(Entry Point)" vertex="1">
      <mxGeometry height="70" width="190" x="620" y="550" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-54" parent="1" style="rhombus;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;fontStyle=1;align=center;strokeWidth=1.5;" value="Antrean Kosong?" vertex="1">
      <mxGeometry height="80" width="170" x="630" y="660" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-55" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;align=center;strokeWidth=1.5;" value="Ambil Berkas dari Antrean&lt;br&gt;(Current File)" vertex="1">
      <mxGeometry height="60" width="190" x="620" y="780" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-56" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;align=center;strokeWidth=1.5;" value="Ekstrak Deklarasi&lt;br&gt;import dan require" vertex="1">
      <mxGeometry height="60" width="190" x="620" y="880" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-57" parent="1" style="rhombus;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;fontStyle=1;align=center;strokeWidth=1.5;" value="Ada Dependensi Lokal&lt;br&gt;yang Belum Dikunjungi?" vertex="1">
      <mxGeometry height="90" width="190" x="620" y="980" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-58" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;align=center;strokeWidth=1.5;" value="Tandai sebagai Visited&lt;br&gt;dan Masukkan ke Antrean" vertex="1">
      <mxGeometry height="60" width="190" x="910" y="995" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-59" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;align=center;strokeWidth=1.5;" value="Graf Dependensi&lt;br&gt;Selesai Dibentuk" vertex="1">
      <mxGeometry height="60" width="190" x="620" y="1150" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-60" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;align=center;strokeWidth=1.5;" value="Jalankan DFS Pewarnaan&lt;br&gt;untuk Mendeteksi&lt;br&gt;Circular Dependency" vertex="1">
      <mxGeometry height="80" width="210" x="440" y="1270" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-61" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;align=center;strokeWidth=1.5;" value="Bandingkan Seluruh Berkas&lt;br&gt;dengan liveFiles untuk&lt;br&gt;Mendeteksi Dead Files" vertex="1">
      <mxGeometry height="80" width="210" x="780" y="1270" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-62" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;align=center;strokeWidth=1.5;" value="Gabungkan Hasil&lt;br&gt;Analisis Graf" vertex="1">
      <mxGeometry height="60" width="190" x="620" y="1410" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-63" parent="1" style="ellipse;shape=doubleEllipse;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=2;" value="" vertex="1">
      <mxGeometry height="40" width="40" x="695" y="1520" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-64" parent="1" style="ellipse;whiteSpace=wrap;html=1;fillColor=#000000;strokeColor=#000000;" value="" vertex="1">
      <mxGeometry height="20" width="20" x="705" y="1530" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-65" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-52" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;" target="PnpFMgiFixlFpZrYTwUK-53">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-66" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-53" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;" target="PnpFMgiFixlFpZrYTwUK-54">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-67" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-54" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;" target="PnpFMgiFixlFpZrYTwUK-55" value="Tidak">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-68" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-55" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;" target="PnpFMgiFixlFpZrYTwUK-56">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-69" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-56" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;" target="PnpFMgiFixlFpZrYTwUK-57">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-70" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-57" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;" target="PnpFMgiFixlFpZrYTwUK-58" value="Ya">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-71" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-58" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;entryX=0.5;entryY=1;exitX=0.5;exitY=1;" target="PnpFMgiFixlFpZrYTwUK-57">
      <mxGeometry relative="1" as="geometry">
        <Array as="points">
          <mxPoint x="935" y="1100" />
          <mxPoint x="715" y="1100" />
        </Array>
      </mxGeometry>
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-72" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-57" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;exitX=0;exitY=0.5;entryX=0;entryY=0.5;" target="PnpFMgiFixlFpZrYTwUK-54" value="Tidak">
      <mxGeometry relative="1" as="geometry">
        <Array as="points">
          <mxPoint x="570" y="1025" />
          <mxPoint x="570" y="700" />
        </Array>
      </mxGeometry>
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-73" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-54" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;exitX=1;exitY=0.5;entryX=0.5;entryY=0;" target="PnpFMgiFixlFpZrYTwUK-59" value="Ya">
      <mxGeometry relative="1" as="geometry">
        <Array as="points">
          <mxPoint x="840" y="700" />
          <mxPoint x="840" y="1120" />
          <mxPoint x="715" y="1120" />
        </Array>
      </mxGeometry>
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-74" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-59" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;exitX=0.25;exitY=1;entryX=0.5;entryY=0;" target="PnpFMgiFixlFpZrYTwUK-60">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-75" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-59" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;exitX=0.75;exitY=1;entryX=0.5;entryY=0;" target="PnpFMgiFixlFpZrYTwUK-61">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-76" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-60" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;exitX=0.5;exitY=1;entryX=0.25;entryY=0;" target="PnpFMgiFixlFpZrYTwUK-62">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-77" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-61" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;exitX=0.5;exitY=1;entryX=0.75;entryY=0;" target="PnpFMgiFixlFpZrYTwUK-62">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="PnpFMgiFixlFpZrYTwUK-78" edge="1" parent="1" source="PnpFMgiFixlFpZrYTwUK-62" style="edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;strokeColor=#000000;" target="PnpFMgiFixlFpZrYTwUK-63">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
  </root>
</mxGraphModel>


**Gambar 4.5 Activity Diagram Pembentukan dan Analisis Graf Dependensi**


**4. Perancangan Unused Dependency Analyzer**
Modul ini bertugas untuk mendeteksi pustaka eksternal (NPM *packages*) yang terinstal di dalam proyek namun tidak pernah dipanggil di dalam *source code*. Implementasinya bekerja dengan membaca daftar *dependencies* dari berkas `package.json` milik pengguna. Sistem kemudian melakukan komparasi himpunan matematika (*set difference*) dengan membandingkan daftar dependensi tersebut terhadap himpunan `usedPackages` (daftar *package* yang dipanggil via sintaks `import`/`require`) yang telah dikumpulkan selama proses pemetaan statis oleh *Graph Builder*. Dependensi yang tidak ditemukan pada himpunan `usedPackages` ditandai sebagai kandidat *unused dependency*. Temuan tersebut tetap memerlukan validasi karena sebagian dependensi dapat digunakan melalui skrip, konfigurasi, pemuatan dinamis, atau mekanisme lain yang tidak direpresentasikan sebagai deklarasi `import` atau `require`.


**5. Perancangan Mesin Aturan (*Rule Engine*)**
Mesin aturan dirancang sebagai lapisan penyaring untuk mencegah entitas atau berkas tertentu diklasifikasikan sebagai kandidat eliminasi. Aturan dimuat dari `deadkiller.config.js` dan diterapkan sebelum temuan diteruskan kepada Modul Eliminator. Mekanisme pengecualian mencakup pola nama entitas berbasis Regex (misalnya variabel berawalan `_`), daftar `preserveFiles`, serta pola direktori yang ditentukan dalam konfigurasi.


---

##### C. Tahap Pengkodean (Coding)
Tahap pengkodean menerjemahkan rancangan Modul Analyzer, Graph Builder, Dependency Analyzer, dan Rule Engine ke dalam komponen JavaScript yang saling terintegrasi. Setiap komponen dikembangkan berdasarkan tanggung jawabnya, kemudian dihubungkan melalui modul orkestrator untuk membentuk pipa analisis proyek secara menyeluruh.

Cuplikan kode pada bagian ini telah disederhanakan untuk menampilkan mekanisme utama setiap modul, sedangkan detail fungsi pendukung terdapat pada implementasi lengkap sistem.

**1. Analisis AST (*AST Analyzer*)**
Penelusuran pohon sintaks dieksekusi dengan mendelegasikan iterasi pada pustaka `estraverse`. Implementasi utama mencatat deklarasi dan meresolusi pembacaan (read) serta penulisan (write) ke dalam `ScopeManager`.


```javascript
// src/analyzer/deadcode/astAnalyzer.js
estraverse.traverse(ast, {
  enter(node, parent) {
    if (node.type === 'VariableDeclarator') {
      for (const identifier of extractIdentifiers(node.id)) {
        currentScope.addDeclaration(
          identifier.name,
          'Variable',
          node.loc.start.line,
          node
        );
      }
    }

    if (node.type === 'Identifier' && isReference(node, parent)) {
      const isWrite =
        parent.type === 'AssignmentExpression' &&
        parent.left === node;

      isWrite
        ? currentScope.addWriteReference(node.name)
        : currentScope.addReadReference(node.name);
    }
  }
});

allScopes.forEach(scope => scope.resolve());
return allScopes.flatMap(scope => scope.extractUnused());
```

Cuplikan tersebut menunjukkan mekanisme inti pencatatan deklarasi dan referensi. Pembentukan serta perpindahan lingkup, penanganan destructuring, parameter fungsi, dan deklarasi TypeScript ditangani oleh fungsi pendukung pada implementasi lengkap.

**2. Pemetaan Dependensi (*Graph Builder BFS*)**
Algoritma BFS diimplementasikan untuk melintasi seluruh file dalam proyek, membangun himpunan `liveFiles` dan melacak impor paket pihak ketiga (`usedPackages`).

```javascript
// src/analyzer/graph/projectGraph.js
while (queue.length > 0) {
  const currentFile = queue.shift();
  const ast = await parseFile(currentFile);

  for (const imp of extractImports(ast)) {
    if (isNpmPackage(imp.source)) {
      usedPackages.add(normalizePackageName(imp.source));
      continue;
    }

    const resolved = await resolveImport(currentFile, imp.source);
    if (!resolved) continue;

    edges.push({
      from: currentFile,
      to: resolved,
      names: imp.names
    });

    liveFiles.add(resolved);

    if (!visited.has(resolved)) {
      visited.add(resolved);
      queue.push(resolved);
    }
  }
}
```

Variabel `unresolvedImports`, `fileDir`, serta mekanisme rinci mengenai pembacaan berkas (*file reading*) disederhanakan dalam cuplikan ini dan dijelaskan lebih terperinci pada fungsi utilitas dalam implementasi nyata.

**3. Evaluasi Ketergantungan Eksternal (*Dependency Analyzer*)**
Untuk mendeteksi pustaka NPM yang diinstal namun tidak dipanggil di kode sumber, himpunan `usedPackages` dari hasil BFS dikomparasi (operasi *Set Difference*) terhadap data dari `package.json`.

```javascript
// src/analyzer/dependency/dependencyAnalyzer.js
const { runtimeDeps, devDeps, pkg } =
  await getDeclaredDependencies(projectRoot);

const usedViaCli = extractBinFromScripts(pkg, devDeps);
const configUsed = await runConfigParsers(projectRoot);

const unusedRuntime = runtimeDeps.filter(
  dep => !usedPackages.has(dep)
);

const unusedDevelopment = devDeps.filter(
  dep =>
    !usedPackages.has(dep) &&
    !usedViaCli.has(dep) &&
    !configUsed.has(dep)
);

return { unusedRuntime, unusedDevelopment };
```

Fungsi `getDeclaredDependencies()` mengembalikan objek manifes beserta dependensinya. Bagian terpenting dari analisis ini adalah perlindungan terhadap **dependensi implisit** (seperti `vitest`, `eslint`, atau `husky`). Dependensi jenis ini seringkali digunakan pada saat eksekusi proyek namun hampir tidak pernah diimpor langsung ke dalam *source code*. Untuk mencegah dependensi ini terhapus, sistem memanggil dua mekanisme pengecualian: `extractBinFromScripts` (memindai blok `scripts` di `package.json` untuk menemukan pemanggilan perintah CLI) dan `runConfigParsers` (mengevaluasi berkas konfigurasi proyek). Himpunan `usedViaCli` dan `configUsed` yang dihasilkan kemudian digunakan sebagai perlindungan ganda sebelum suatu `devDependency` diklasifikasikan sebagai kandidat mati.

Selain perlindungan otomatis tersebut, pengguna tetap memegang kendali mutlak melalui *Rule Engine*. Apabila pengguna mendaftarkan suatu dependensi (misalnya `vitest`) ke dalam aturan *ignore* di `deadkiller.config.js`, *Rule Engine* akan memveto hasil analisis dan memastikan dependensi tersebut tidak akan pernah disentuh.

**4. Mesin Penyaring (*Rule Engine*)**
Aturan pengecualian dari `deadkiller.config.js` dibaca dan dievaluasi secara statis untuk menyaring temuan *dead code* yang tidak boleh dieliminasi.

```javascript
// src/analyzer/ruleEngine.js
isIgnoredFile(filePath, projectRoot) {
  const relativePath = path
    .relative(projectRoot, filePath)
    .replace(/\\/g, '/');

  const rules = this._resolveConfigForFile(filePath);
  const excludedPaths = [
    ...(rules.preserveFiles ?? []),
    ...(rules.ignorePaths ?? [])
  ];

  return excludedPaths.some(
    pattern => relativePath.includes(pattern)
  );
}
```

Fungsi `isIgnoredFile()` memeriksa jalur relatif berkas terhadap gabungan konfigurasi `preserveFiles` dan `ignorePaths`. Pencocokan dilakukan melalui pemeriksaan potongan jalur berkas (*substring match*), sehingga nilai konfigurasi seperti `src/utils` akan mencocokkan semua berkas yang mengandung potongan jalur tersebut. Pengecualian nama variabel melalui ekspresi reguler serta aturan *overrides* diselesaikan pada fungsi terpisah dalam implementasi lengkap.

**5. Pipa Integrasi Terpadu (*Integration Pipeline*)**
Seluruh modul dirangkai dalam satu orkestrator yang memanfaatkan *ParseCache* dari Iterasi 1 guna menekan beban komputasi.

```javascript
// src/commands/scanCommand.js
const ruleEngine = await loadRuleEngine(absolutePath);
const graph = await buildProjectGraph(absolutePath, ruleEngine);

const issues = [];
for (const file of graph.liveFiles) {
  const ast = await getCachedAst(file);

  issues.push(
    ...findDeadCode(
      ast,
      file,
      graph.globalRegistry,
      ruleEngine
    )
  );
}

return {
  issues,
  dependencyReport: await findUnusedDependencies(
    absolutePath,
    graph.usedPackages,
    ruleEngine
  ),
  deadFiles: findDeadFiles(graph),
  circularDependencies:
    graph.globalRegistry.circularDependencies
};
```

Orkestrasi utama proses pemindaian ditempatkan pada `src/commands/scanCommand.js`. Modul tersebut menginisialisasi *Rule Engine*, membentuk graf dependensi, menjalankan analisis AST, memeriksa dependensi eksternal, serta menggabungkan seluruh hasil analisis ke dalam satu objek keluaran. Fungsi `getCachedAst()` mengabstraksi mekanisme *ParseCache* untuk menghindari pembacaan ulang berkas yang sama, sebagaimana telah dirancang pada Iterasi 1. Temuan *circular dependency* dilaporkan sebagai diagnostik struktur graf dan tidak dihitung sebagai tipe *dead code* dalam 17 tipe temuan analisis.

---

##### D. Tahap Pengujian (Testing)

Berdasarkan cakupan yang ditetapkan pada tahap perencanaan, sebanyak 124 kasus uji pada delapan berkas pengujian dijalankan untuk memvalidasi Modul *Graph Builder*, *Analyzer*, *Unused Dependency Analyzer*, dan *Rule Engine*. Setiap kasus uji membandingkan keluaran aktual dengan keluaran yang diharapkan.

Hasil pengujian menunjukkan bahwa seluruh kasus uji yang didefinisikan berhasil dilalui.

```text
 Test Files  8 passed (8)
      Tests  124 passed (124)
─────────────────────────────────────────────────────────────────
Total: 124 dari 124 kasus uji berhasil dilalui.
```

---


##### E. Evaluasi Iterasi

Setelah seluruh tugas pengembangan dan pengujian selesai dilaksanakan, Modul *Graph Builder*, *Analyzer*, *Dependency Analyzer*, dan *Rule Engine* dinyatakan selesai serta berhasil diintegrasikan pada Iterasi 2. Integrasi tersebut memungkinkan hasil pemetaan dependensi, analisis AST, pemeriksaan paket eksternal, dan penerapan aturan pengecualian digabungkan dalam satu proses pemindaian. Hasil analisis pada iterasi ini selanjutnya digunakan sebagai masukan bagi Modul *Eliminator* yang dikembangkan pada iterasi berikutnya.

Berdasarkan pengujian yang telah didefinisikan, sistem berhasil mengimplementasikan 17 tipe temuan analisis, yaitu `Variable`, `WriteOnly`, `Function`, `Parameter`, `UnusedType`, `UnusedEnumMember`, `DuplicateImport`, `DeadCode`, `DeadBranch`, `DeadStore`, `DuplicateCondition`, `EmptyBlock`, `RedundantCode`, `PathWarning`, `ClassMethod`, `UnusedFunction`, dan `DeadFiles`. Tipe-tipe tersebut mencakup variabel dan fungsi tidak terpakai, parameter tanpa penggunaan, deklarasi TypeScript yang tidak digunakan, impor duplikat, kode tidak terjangkau, cabang statis yang mustahil dicapai, penugasan sia-sia, kondisi duplikat, blok kosong, kode redundan, peringatan terkait keterbatasan analisis jalur, metode kelas tanpa pemanggilan statis, fungsi internal terisolasi, serta berkas yang tidak terjangkau dari *entry point*. Di luar 17 tipe tersebut, Modul *Dependency Analyzer* juga menghasilkan kandidat `UnusedDependency` berdasarkan perbandingan antara manifes proyek dan himpunan `usedPackages`.

Keberhasilan seluruh kasus uji menunjukkan bahwa modul telah menghasilkan keluaran yang sesuai dengan hasil yang diharapkan pada skenario pengujian yang ditetapkan. Namun, hasil tersebut belum secara langsung menunjukkan tingkat ketepatan sistem ketika diterapkan pada kode nyata yang lebih kompleks. Oleh karena itu, efektivitas deteksi akan dievaluasi lebih lanjut pada tahap pengujian akhir sistem menggunakan *confusion matrix* serta metrik *precision*, *recall*, dan *F1-score* terhadap dataset proyek nyata yang telah dilengkapi label acuan.

| ID Task | Deskripsi | Status | Keterangan |
| :--- | :--- | :--- | :--- |
| T2-01 | Implementasi algoritma pengelolaan lingkup leksikal untuk analisis intra-berkas | Selesai | Terintegrasi |
| T2-02 | Implementasi traversal AST menggunakan estraverse | Selesai | Terintegrasi |
| T2-03 | Pengujian validasi purwarupa analyzer terhadap konstruksi kode JavaScript | Selesai | Lulus Uji |
| T2-04 | Implementasi *Graph Builder* berbasis BFS untuk menyusun graf dependensi lintas berkas | Selesai | Terintegrasi |
| T2-05 | Implementasi Unused Dependency Analyzer untuk membandingkan manifes proyek dengan himpunan paket yang digunakan | Selesai | Terintegrasi |
| T2-06 | Pengujian integrasi lintas modul (Graph + Analyzer) | Selesai | Lulus Uji |
| T2-07 | Pembangunan Mesin Aturan (Rule Engine) | Selesai | Terintegrasi |
