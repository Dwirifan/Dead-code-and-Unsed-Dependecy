#### 4.4.4 Iterasi 4: Pengembangan Modul Antarmuka dan Pelaporan (CLI & Reporter)

Iterasi keempat merupakan tahap finalisasi sistem, di mana seluruh mesin inti yang telah dibangun pada iterasi-iterasi sebelumnya — yaitu *Analyzer*, *Graph Builder*, dan *Eliminator* — dibungkus ke dalam **Modul Antarmuka (*Command Line Interface* / CLI)** dan **Sistem Pelaporan (*Reporter*)**. Modul ini berperan sebagai jembatan antara pengguna akhir dengan kompleksitas mesin analisis statis yang bekerja di balik layar.

---

##### A. Tahap Perencanaan (Planning)

Pengembangan pada iterasi ini difokuskan pada peningkatan pengalaman pengguna (*User Experience* / UX) di lingkungan terminal, serta kemampuan menyajikan data analitik yang kompleks menjadi visualisasi yang intuitif dan mudah dipahami.

| Prioritas | ID Task | Deskripsi Task                                                                              | *User Story* |
| --------- | ------- | ------------------------------------------------------------------------------------------- | ------------ |
| 1         | T4-01   | Registrasi dan *routing* perintah CLI (`scan`, `fix`, `watch`, dll) menggunakan `commander` | US-06        |
| 2         | T4-02   | Pembangunan antarmuka panduan interaktif (*Wizard*) untuk pengguna baru                     | US-05, US-06 |
| 3         | T4-03   | Pembangunan Modul *Reporter* untuk merangkum hasil analisis dalam format JSON dan terminal  | US-06        |
| 4         | T4-04   | Pembangunan Modul Visualisasi HTML (*Dashboard* interaktif berbasis Cytoscape.js)           | US-06        |
| 5         | T4-05   | Pengujian unit dan integrasi antarmuka CLI serta Modul Reporter                             | US-05, US-06 |

Selain pembagian tugas, tahap perencanaan ini juga merumuskan **Kriteria Keberhasilan Iterasi**. Rencana pengujian disepakati di awal untuk memvalidasi empat aspek utama fungsionalitas CLI dan pelaporan:
1. Ketepatan registrasi dan *routing* perintah CLI, termasuk penanganan argumen yang tidak valid.
2. Kesesuaian keluaran Reporter dalam format terminal dan JSON.
3. Kesesuaian alur interaksi pengguna pada *Interactive Wizard*.
4. Keberhasilan pembentukan dan *rendering* visualisasi HTML.

Aspek-aspek tersebut kemudian dijabarkan ke dalam cakupan pengujian, sebagaimana ditunjukkan pada tabel berikut.

**Tabel 4.x Rencana Cakupan Pengujian Modul CLI dan Pelaporan**

| Kelompok Uji | Cakupan Skenario | Tujuan Pengujian |
| :--- | :--- | :--- |
| **CLI dan Routing** | Registrasi perintah, argumen, perintah tanpa argumen, dan input tidak valid. | Memvalidasi pengarahan setiap perintah dan mekanisme *fallback*. |
| **Reporter Terminal dan JSON** | Ringkasan terminal, status temuan, ANSI, dan struktur JSON. | Memastikan hasil analisis disajikan dalam format yang valid. |
| **Interactive Wizard** | Pemilihan aksi, direktori target, konfirmasi fix, dan input tidak valid. | Memvalidasi alur interaksi pengguna. |
| **Visualisasi HTML** | Injeksi *node*, *edge*, temuan, dependensi, tema, dan bahasa. | Memastikan laporan HTML dapat dibentuk sesuai rancangan. |

---

##### B. Tahap Perancangan (Design)

Fokus utama adalah merancang antarmuka sistem yang akan menjembatani pengguna dengan modul analitik. Perancangan dibagi menjadi dua komponen utama, yaitu antarmuka perintah CLI (*Command Line Interface*) dan dokumen visualisasi HTML interaktif.

**1. Perancangan Antarmuka CLI (*Command Line Interface*)**

Modul CLI dirancang sebagai antarmuka utama yang memungkinkan pengguna mengakses seluruh fungsionalitas sistem melalui terminal. Sistem menerapkan mekanisme *routing* otomatis: jika dijalankan tanpa argumen, antarmuka *Wizard* interaktif diluncurkan untuk memandu pengguna; jika disertai argumen, eksekusi langsung diteruskan ke perintah yang sesuai. Sistem mendefinisikan sembilan perintah yang mencakup siklus analisis, eliminasi, dan audit:

| Perintah | Fungsi |
| :--- | :--- |
| `scan [projectPath]` | Memindai direktori target untuk mendeteksi *dead code* dan dependensi tidak terpakai; menampilkan ringkasan statistik dan kategorisasi temuan (*safe*, *review*, *risky*). |
| `fix [projectPath]` | Mengeksekusi eliminasi kode mati secara fisik, didahului pratinjau perubahan, konfirmasi pengguna, dan pembuatan *snapshot* cadangan. |
| `show-deps [projectPath]` | Membandingkan dependensi yang dideklarasikan di `package.json` dengan yang benar-benar diimpor dalam kode sumber. |
| `visualize [projectPath]` | Menghasilkan *Dashboard* HTML interaktif berbasis Cytoscape.js dan membukanya di peramban. |
| `trace <fileName>` | Melacak rantai impor/ekspor dari satu berkas spesifik untuk audit kode terisolasi. |
| `watch [projectPath]` | Mengaktifkan *file watcher* yang menjalankan ulang analisis otomatis setiap ada perubahan berkas. |
| `report [projectPath]` | Mengekspor hasil analisis dalam format JSON untuk keperluan dokumentasi atau pemrosesan eksternal. |
| `history` | Menampilkan riwayat modifikasi dan daftar *snapshot* cadangan untuk keperluan *rollback*. |
| `init` | Menghasilkan berkas konfigurasi `deadkiller.config.js` untuk mendefinisikan aturan pengecualian analisis. |

Activity Diagram Routing dan Eksekusi Perintah CLI

<mxGraphModel dx="1493" dy="277" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">
  <root>
    <mxCell id="0" />
    <mxCell id="1" parent="0" />

    <!-- Start Node -->
    <mxCell id="N-Start" parent="1" style="ellipse;whiteSpace=wrap;html=1;fillColor=#000000;strokeColor=#000000;" value="" vertex="1">
      <mxGeometry height="40" width="40" x="1140" y="1320" as="geometry" />
    </mxCell>

    <!-- Step 1: Run CLI -->
    <mxCell id="N-RunCLI" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=1.5;align=center;" value="Pengguna menjalankan&lt;br&gt;perintah CLI" vertex="1">
      <mxGeometry height="50" width="200" x="1060" y="1390" as="geometry" />
    </mxCell>
    <mxCell id="E-StartToRun" edge="1" parent="1" source="N-Start" target="N-RunCLI" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- Step 2: Decision -->
    <mxCell id="N-CheckArgs" parent="1" style="rhombus;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=1.5;fontStyle=1;" value="Perintah/Argumen&lt;br&gt;Tersedia?" vertex="1">
      <mxGeometry height="90" width="160" x="1080" y="1480" as="geometry" />
    </mxCell>
    <mxCell id="E-RunToCheck" edge="1" parent="1" source="N-RunCLI" target="N-CheckArgs" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <!-- RIGHT BRANCH: Direct Command -->
    <mxCell id="N-DirectParse" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=1.5;align=center;" value="Baca Perintah &amp;amp;&lt;br&gt;Validasi (Commander)" vertex="1">
      <mxGeometry height="55" width="200" x="1350" y="1497" as="geometry" />
    </mxCell>
    <mxCell id="E-CheckToDirect" edge="1" parent="1" source="N-CheckArgs" target="N-DirectParse" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;" value="Ya">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <mxCell id="N-DirectRouting" parent="1" style="rhombus;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=1.5;fontStyle=1;" value="Routing Perintah" vertex="1">
      <mxGeometry height="80" width="140" x="1380" y="1580" as="geometry" />
    </mxCell>
    <mxCell id="E-ParseToRouting" edge="1" parent="1" source="N-DirectParse" target="N-DirectRouting" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- Command Nodes: 8 nodes (scan,fix,visualize,report,show-deps,trace,history,watch/init) -->
    <mxCell id="N-CmdScan" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=1.5;align=center;" value="scan&lt;br&gt;(Analisis &amp;amp; Terminal)" vertex="1">
      <mxGeometry height="50" width="160" x="1600" y="1450" as="geometry" />
    </mxCell>
    <mxCell id="N-CmdFix" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=1.5;align=center;" value="fix&lt;br&gt;(Konfirmasi &amp;amp; Eliminasi)" vertex="1">
      <mxGeometry height="50" width="160" x="1600" y="1510" as="geometry" />
    </mxCell>
    <mxCell id="N-CmdVis" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=1.5;align=center;" value="visualize&lt;br&gt;(HTML Dashboard)" vertex="1">
      <mxGeometry height="50" width="160" x="1600" y="1570" as="geometry" />
    </mxCell>
    <mxCell id="N-CmdRep" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=1.5;align=center;" value="report&lt;br&gt;(JSON Export)" vertex="1">
      <mxGeometry height="50" width="160" x="1600" y="1630" as="geometry" />
    </mxCell>
    <mxCell id="N-CmdDeps" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=1.5;align=center;" value="show-deps&lt;br&gt;(Laporan NPM)" vertex="1">
      <mxGeometry height="50" width="160" x="1600" y="1690" as="geometry" />
    </mxCell>
    <mxCell id="N-CmdTrace" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=1.5;align=center;" value="trace&lt;br&gt;(Lacak Ketergantungan)" vertex="1">
      <mxGeometry height="50" width="160" x="1600" y="1750" as="geometry" />
    </mxCell>
    <mxCell id="N-CmdHistory" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=1.5;align=center;" value="history&lt;br&gt;(Riwayat &amp;amp; Rollback)" vertex="1">
      <mxGeometry height="50" width="160" x="1600" y="1810" as="geometry" />
    </mxCell>
    <mxCell id="N-CmdOther" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=1.5;align=center;" value="watch / init&lt;br&gt;(Modul Utilitas)" vertex="1">
      <mxGeometry height="50" width="160" x="1600" y="1870" as="geometry" />
    </mxCell>

    <!-- Edges: Routing → Commands (fork rail x=1560, routing center y=1620) -->
    <mxCell id="E-RouteScan" edge="1" parent="1" source="N-DirectRouting" target="N-CmdScan" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1560" y="1620" /><mxPoint x="1560" y="1475" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="E-RouteFix" edge="1" parent="1" source="N-DirectRouting" target="N-CmdFix" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1560" y="1620" /><mxPoint x="1560" y="1535" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="E-RouteVis" edge="1" parent="1" source="N-DirectRouting" target="N-CmdVis" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1560" y="1620" /><mxPoint x="1560" y="1595" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="E-RouteRep" edge="1" parent="1" source="N-DirectRouting" target="N-CmdRep" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1560" y="1620" /><mxPoint x="1560" y="1655" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="E-RouteDeps" edge="1" parent="1" source="N-DirectRouting" target="N-CmdDeps" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1560" y="1620" /><mxPoint x="1560" y="1715" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="E-RouteTrace" edge="1" parent="1" source="N-DirectRouting" target="N-CmdTrace" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1560" y="1620" /><mxPoint x="1560" y="1775" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="E-RouteHistory" edge="1" parent="1" source="N-DirectRouting" target="N-CmdHistory" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1560" y="1620" /><mxPoint x="1560" y="1835" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="E-RouteOther" edge="1" parent="1" source="N-DirectRouting" target="N-CmdOther" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1560" y="1620" /><mxPoint x="1560" y="1895" /></Array></mxGeometry>
    </mxCell>

    <!-- Output node -->
    <mxCell id="N-DirectOutput" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=1.5;align=center;" value="Tampilkan / Simpan&lt;br&gt;Keluaran" vertex="1">
      <mxGeometry height="50" width="200" x="1340" y="1980" as="geometry" />
    </mxCell>

    <!-- Edges: Commands → Output (merge rail x=1810) -->
    <mxCell id="E-ScanToOut" edge="1" parent="1" source="N-CmdScan" target="N-DirectOutput" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=1;entryY=0.5;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1810" y="1475" /><mxPoint x="1810" y="2005" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="E-FixToOut" edge="1" parent="1" source="N-CmdFix" target="N-DirectOutput" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=1;entryY=0.5;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1810" y="1535" /><mxPoint x="1810" y="2005" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="E-VisToOut" edge="1" parent="1" source="N-CmdVis" target="N-DirectOutput" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=1;entryY=0.5;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1810" y="1595" /><mxPoint x="1810" y="2005" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="E-RepToOut" edge="1" parent="1" source="N-CmdRep" target="N-DirectOutput" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=1;entryY=0.5;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1810" y="1655" /><mxPoint x="1810" y="2005" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="E-DepsToOut" edge="1" parent="1" source="N-CmdDeps" target="N-DirectOutput" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=1;entryY=0.5;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1810" y="1715" /><mxPoint x="1810" y="2005" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="E-TraceToOut" edge="1" parent="1" source="N-CmdTrace" target="N-DirectOutput" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=1;entryY=0.5;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1810" y="1775" /><mxPoint x="1810" y="2005" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="E-HistoryToOut" edge="1" parent="1" source="N-CmdHistory" target="N-DirectOutput" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=1;entryY=0.5;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1810" y="1835" /><mxPoint x="1810" y="2005" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="E-OtherToOut" edge="1" parent="1" source="N-CmdOther" target="N-DirectOutput" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=1;exitY=0.5;exitDx=0;exitDy=0;entryX=1;entryY=0.5;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1810" y="1895" /><mxPoint x="1810" y="2005" /></Array></mxGeometry>
    </mxCell>

    <!-- LEFT BRANCH: Wizard UI -->
    <mxCell id="N-WizardStart" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=1.5;align=center;" value="Tampilkan Wizard UI&lt;br&gt;(Pilih Aksi)" vertex="1">
      <mxGeometry height="55" width="200" x="780" y="1497" as="geometry" />
    </mxCell>
    <mxCell id="E-CheckToWizard" edge="1" parent="1" source="N-CheckArgs" target="N-WizardStart" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;" value="Tidak">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="N-WizRouting" parent="1" style="rhombus;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=1.5;fontStyle=1;" value="Routing Aksi" vertex="1">
      <mxGeometry height="80" width="130" x="815" y="1580" as="geometry" />
    </mxCell>
    <mxCell id="E-WizStartToRouting" edge="1" parent="1" source="N-WizardStart" target="N-WizRouting" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- Wizard Action Nodes: 6 nodes matching wizard.js choices exactly -->
    <mxCell id="N-WizScan" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=1.5;align=center;" value="scan &amp;amp; fix&lt;br&gt;(Pilih Dir)" vertex="1">
      <mxGeometry height="50" width="130" x="240" y="1690" as="geometry" />
    </mxCell>
    <mxCell id="N-WizShowDeps" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=1.5;align=center;" value="show-deps&lt;br&gt;(Pilih Dir)" vertex="1">
      <mxGeometry height="50" width="130" x="390" y="1690" as="geometry" />
    </mxCell>
    <mxCell id="N-WizVisualize" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=1.5;align=center;" value="visualize&lt;br&gt;(Pilih Dir)" vertex="1">
      <mxGeometry height="50" width="130" x="540" y="1690" as="geometry" />
    </mxCell>
    <mxCell id="N-WizTrace" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=1.5;align=center;" value="trace&lt;br&gt;(Pilih File)" vertex="1">
      <mxGeometry height="50" width="130" x="690" y="1690" as="geometry" />
    </mxCell>
    <mxCell id="N-WizHistory" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=1.5;align=center;" value="history&lt;br&gt;(Pilih Dir)" vertex="1">
      <mxGeometry height="50" width="130" x="840" y="1690" as="geometry" />
    </mxCell>
    <mxCell id="N-WizExit" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=1.5;align=center;" value="exit&lt;br&gt;(Keluar)" vertex="1">
      <mxGeometry height="50" width="100" x="1000" y="1690" as="geometry" />
    </mxCell>

    <!-- Edges: WizRouting → each Wizard action (fork bar y=1668, routing bottom x=880) -->
    <mxCell id="E-RouteToWizScan" edge="1" parent="1" source="N-WizRouting" target="N-WizScan" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="880" y="1668" /><mxPoint x="305" y="1668" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="E-RouteToWizShowDeps" edge="1" parent="1" source="N-WizRouting" target="N-WizShowDeps" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="880" y="1668" /><mxPoint x="455" y="1668" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="E-RouteToWizVis" edge="1" parent="1" source="N-WizRouting" target="N-WizVisualize" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="880" y="1668" /><mxPoint x="605" y="1668" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="E-RouteToWizTrace" edge="1" parent="1" source="N-WizRouting" target="N-WizTrace" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="880" y="1668" /><mxPoint x="755" y="1668" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="E-RouteToWizHistory" edge="1" parent="1" source="N-WizRouting" target="N-WizHistory" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="880" y="1668" /><mxPoint x="905" y="1668" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="E-RouteToWizExit" edge="1" parent="1" source="N-WizRouting" target="N-WizExit" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0.5;entryY=0;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="880" y="1668" /><mxPoint x="1050" y="1668" /></Array></mxGeometry>
    </mxCell>

    <!-- Wizard Scan Sub-flow: scan → ask fix → exec fix -->
    <mxCell id="N-WizardFixCheck" parent="1" style="rhombus;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=1.5;fontStyle=1;" value="Lanjut ke fix?&lt;br&gt;(Y/N)" vertex="1">
      <mxGeometry height="80" width="150" x="230" y="1780" as="geometry" />
    </mxCell>
    <mxCell id="E-WizScanToFixCheck" edge="1" parent="1" source="N-WizScan" target="N-WizardFixCheck" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="N-WizardFixExec" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=1.5;align=center;" value="Pilih Level &amp;amp; Eksekusi&lt;br&gt;Fix (Sub-process)" vertex="1">
      <mxGeometry height="50" width="175" x="218" y="1900" as="geometry" />
    </mxCell>
    <mxCell id="E-WizFixCheckToExec" edge="1" parent="1" source="N-WizardFixCheck" target="N-WizardFixExec" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;" value="Ya">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>

    <!-- End Node -->
    <mxCell id="N-End" parent="1" style="ellipse;shape=doubleEllipse;whiteSpace=wrap;html=1;fillColor=none;strokeColor=#000000;strokeWidth=2;" value="" vertex="1">
      <mxGeometry height="40" width="40" x="1140" y="2120" as="geometry" />
    </mxCell>
    <mxCell id="N-EndInner" parent="1" style="ellipse;whiteSpace=wrap;html=1;fillColor=#000000;strokeColor=#000000;" value="" vertex="1">
      <mxGeometry height="20" width="20" x="1150" y="2130" as="geometry" />
    </mxCell>

    <!-- Right branch → End -->
    <mxCell id="E-DirectOutputToEnd" edge="1" parent="1" source="N-DirectOutput" target="N-End" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=1;entryY=0.5;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1440" y="2140" /></Array></mxGeometry>
    </mxCell>

    <!-- Left branch nodes → End -->
    <mxCell id="E-WizFixExecToEnd" edge="1" parent="1" source="N-WizardFixExec" target="N-End" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="305" y="2140" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="E-WizFixCheckToEnd" edge="1" parent="1" source="N-WizardFixCheck" target="N-End" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=0;exitY=0.5;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;" value="Tidak">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="190" y="1820" /><mxPoint x="190" y="2140" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="E-WizShowDepsToEnd" edge="1" parent="1" source="N-WizShowDeps" target="N-End" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="455" y="2140" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="E-WizVisToEnd" edge="1" parent="1" source="N-WizVisualize" target="N-End" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="605" y="2140" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="E-WizTraceToEnd" edge="1" parent="1" source="N-WizTrace" target="N-End" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="755" y="2140" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="E-WizHistoryToEnd" edge="1" parent="1" source="N-WizHistory" target="N-End" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="905" y="2140" /></Array></mxGeometry>
    </mxCell>
    <mxCell id="E-WizExitToEnd" edge="1" parent="1" source="N-WizExit" target="N-End" style="edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;strokeColor=#000000;exitX=0.5;exitY=1;exitDx=0;exitDy=0;entryX=0;entryY=0.5;entryDx=0;entryDy=0;">
      <mxGeometry relative="1" as="geometry"><Array as="points"><mxPoint x="1050" y="2140" /></Array></mxGeometry>
    </mxCell>

  </root>
</mxGraphModel>


**Gambar 4.6 Activity Diagram Routing dan Eksekusi Perintah CLI**

**2. Perancangan Visualisasi HTML Interaktif (*Dashboard*)**

*Dashboard* HTML dihasilkan oleh perintah `visualize` sebagai laporan baca-saja (*read-only*) untuk validasi hasil analisis secara visual. *Dashboard* terdiri dari enam elemen utama:

1. **Header:** Identitas perangkat lunak dan ringkasan jumlah berkas aktif serta dependensi.
2. **Statistics Strip:** Kartu metrik utama (total berkas, koneksi graf, total dependensi).
3. **Panel Graf Interaktif:** Graf ketergantungan antarberkas dengan dukungan *zoom*, *drag*, dan penyorotan *node*.
4. **Sidebar:** Legenda direktori, daftar dependensi terpakai, dan dependensi tidak terpakai.
5. **Laporan Kode Mati:** Tabel temuan berdasarkan kategori *safe*, *review*, dan *risky* beserta detail lokasi, entitas, dan tingkat keyakinan.
6. **Aksesibilitas:** Dukungan dua bahasa (Indonesia/Inggris) dan *dark/light mode*.

Rancangan antarmuka *Dashboard* HTML tersebut ditunjukkan pada *mockup* Gambar 4.7.

<mxGraphModel dx="3142" dy="1740" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">
  <root>
    <mxCell id="0" />
    <mxCell id="1" parent="0" />
    <mxCell id="Bmgpohvmm5VKlapb3zCL-268" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#333333;strokeWidth=2;" value="" vertex="1">
      <mxGeometry height="1560" width="1160" x="760" y="730" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-269" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#e0e0e0;strokeColor=#333333;strokeWidth=2;align=left;spacingLeft=15;fontStyle=1" value="Dashboard DeadKiller - Code Traceability" vertex="1">
      <mxGeometry height="40" width="1160" x="760" y="730" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-270" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#333333;" value="ID | EN" vertex="1">
      <mxGeometry height="20" width="60" x="1780" y="740" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-271" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#333333;" value="Theme" vertex="1">
      <mxGeometry height="20" width="50" x="1850" y="740" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-272" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#999999;strokeWidth=2;" value="" vertex="1">
      <mxGeometry height="100" width="1120" x="780" y="790" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-273" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#e0e0e0;strokeColor=#666666;" value="LOGO" vertex="1">
      <mxGeometry height="70" width="70" x="800" y="805" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-274" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;fontStyle=1;fontSize=20;" value="Keterlacakan Struktur Kode" vertex="1">
      <mxGeometry height="30" width="400" x="890" y="805" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-275" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;fontSize=14;fontColor=#666666;" value="Hasil analisis struktur kode oleh DeadKiller CLI" vertex="1">
      <mxGeometry height="20" width="400" x="890" y="835" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-276" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f0f0f0;strokeColor=#999999;fontColor=#333333;fontSize=11;" value="XX File Aktif" vertex="1">
      <mxGeometry height="20" width="100" x="890" y="860" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-277" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f0f0f0;strokeColor=#999999;fontColor=#333333;fontSize=11;" value="XX Dep. Terpakai" vertex="1">
      <mxGeometry height="20" width="120" x="1000" y="860" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-278" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f0f0f0;strokeColor=#999999;fontColor=#333333;fontSize=11;" value="XX Dep. Mati" vertex="1">
      <mxGeometry height="20" width="100" x="1130" y="860" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-279" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#999999;strokeWidth=2;" value="" vertex="1">
      <mxGeometry height="80" width="360" x="780" y="910" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-280" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;fontSize=28;fontStyle=1;fontColor=#333333;" value="XX" vertex="1">
      <mxGeometry height="40" width="100" x="800" y="925" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-281" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;fontSize=12;fontColor=#666666;" value="FILE AKTIF" vertex="1">
      <mxGeometry height="20" width="150" x="800" y="965" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-282" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#999999;strokeWidth=2;" value="" vertex="1">
      <mxGeometry height="80" width="360" x="1160" y="910" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-283" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;fontSize=28;fontStyle=1;fontColor=#333333;" value="XX" vertex="1">
      <mxGeometry height="40" width="100" x="1180" y="925" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-284" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;fontSize=12;fontColor=#666666;" value="KONEKSI EDGE" vertex="1">
      <mxGeometry height="20" width="150" x="1180" y="965" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-285" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#999999;strokeWidth=2;" value="" vertex="1">
      <mxGeometry height="80" width="360" x="1540" y="910" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-286" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;fontSize=28;fontStyle=1;fontColor=#333333;" value="XX" vertex="1">
      <mxGeometry height="40" width="100" x="1560" y="925" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-287" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;fontSize=12;fontColor=#666666;" value="TOTAL DEPENDENSI" vertex="1">
      <mxGeometry height="20" width="150" x="1560" y="965" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-288" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#999999;strokeWidth=2;" value="" vertex="1">
      <mxGeometry height="560" width="740" x="780" y="1010" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-289" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#999999;strokeWidth=1;align=left;spacingLeft=15;fontStyle=1;fontColor=#333333;" value="Graf Keterlacakan Kode" vertex="1">
      <mxGeometry height="40" width="740" x="780" y="1010" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-290" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#cccccc;strokeWidth=1;" value="" vertex="1">
      <mxGeometry height="35" width="740" x="780" y="1050" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-291" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;fontSize=11;fontStyle=2;fontColor=#666666;" value="Toolbar Graf (Zoom, Drag, Fit)" vertex="1">
      <mxGeometry height="25" width="300" x="790" y="1055" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-292" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f0f0f0;strokeColor=#999999;" value="+" vertex="1">
      <mxGeometry height="25" width="30" x="1360" y="1055" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-293" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f0f0f0;strokeColor=#999999;" value="-" vertex="1">
      <mxGeometry height="25" width="30" x="1400" y="1055" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-294" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f0f0f0;strokeColor=#999999;" value="Fit" vertex="1">
      <mxGeometry height="25" width="60" x="1440" y="1055" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-295" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#333333;strokeWidth=2;fontColor=#000;" value="Node File 1" vertex="1">
      <mxGeometry height="40" width="120" x="1090" y="1110" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-296" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#333333;strokeWidth=2;fontColor=#000;" value="Node File 2" vertex="1">
      <mxGeometry height="40" width="120" x="920" y="1210" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-297" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#333333;strokeWidth=2;fontColor=#000;" value="Node File 3" vertex="1">
      <mxGeometry height="40" width="120" x="1260" y="1210" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-298" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#333333;strokeWidth=2;fontColor=#000;" value="Node File 4" vertex="1">
      <mxGeometry height="40" width="120" x="840" y="1330" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-299" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#333333;strokeWidth=2;fontColor=#000;" value="Node File 5" vertex="1">
      <mxGeometry height="40" width="120" x="1000" y="1330" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-300" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#333333;strokeWidth=2;fontColor=#000;" value="Node File 6" vertex="1">
      <mxGeometry height="40" width="120" x="1180" y="1330" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-301" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#333333;strokeWidth=2;fontColor=#000;" value="Node File 7" vertex="1">
      <mxGeometry height="40" width="120" x="1340" y="1330" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-302" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#999999;strokeWidth=2;" value="" vertex="1">
      <mxGeometry height="180" width="360" x="1540" y="1010" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-303" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#999999;strokeWidth=1;align=left;spacingLeft=15;fontStyle=1" value="Direktori (Legend)" vertex="1">
      <mxGeometry height="40" width="360" x="1540" y="1010" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-304" parent="1" style="html=1;fillColor=#e0e0e0;strokeColor=#333333;" value="" vertex="1">
      <mxGeometry height="15" width="15" x="1560" y="1065" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-305" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;" value="Kategori Direktori A" vertex="1">
      <mxGeometry height="25" width="200" x="1585" y="1060" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-306" parent="1" style="html=1;fillColor=#cccccc;strokeColor=#333333;" value="" vertex="1">
      <mxGeometry height="15" width="15" x="1560" y="1095" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-307" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;" value="Kategori Direktori B" vertex="1">
      <mxGeometry height="25" width="200" x="1585" y="1090" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-308" parent="1" style="html=1;fillColor=#999999;strokeColor=#333333;" value="" vertex="1">
      <mxGeometry height="15" width="15" x="1560" y="1125" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-309" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;" value="Kategori Direktori C" vertex="1">
      <mxGeometry height="25" width="200" x="1585" y="1120" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-310" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#999999;strokeWidth=2;" value="" vertex="1">
      <mxGeometry height="200" width="360" x="1540" y="1210" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-311" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#999999;strokeWidth=1;align=left;spacingLeft=15;fontStyle=1;fontColor=#333333;" value="Dep. Terpakai (X)" vertex="1">
      <mxGeometry height="40" width="360" x="1540" y="1210" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-312" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=top;lineHeight=1.5;" value="â€¢ Nama Package A&#xa;â€¢ Nama Package B&#xa;â€¢ Nama Package C&#xa;â€¢ Nama Package D" vertex="1">
      <mxGeometry height="120" width="300" x="1555" y="1260" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-313" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#999999;strokeWidth=2;" value="" vertex="1">
      <mxGeometry height="140" width="360" x="1540" y="1430" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-314" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#999999;strokeWidth=1;align=left;spacingLeft=15;fontStyle=1;fontColor=#333333;" value="Dep. Mati (Y)" vertex="1">
      <mxGeometry height="40" width="360" x="1540" y="1430" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-315" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=top;lineHeight=1.5;" value="â€¢ Nama Package Mati 1&#xa;â€¢ Nama Package Mati 2" vertex="1">
      <mxGeometry height="80" width="300" x="1555" y="1480" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-316" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=middle;fontStyle=1;fontSize=18;" value="Laporan Dead Code" vertex="1">
      <mxGeometry height="30" width="400" x="780" y="1600" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-317" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#999999;strokeColor=none;" value="" vertex="1">
      <mxGeometry height="2" width="1120" x="780" y="1635" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-318" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#999999;strokeWidth=2;" value="" vertex="1">
      <mxGeometry height="80" width="265" x="780" y="1650" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-319" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;fontSize=24;fontStyle=1;fontColor=#333333;" value="XX" vertex="1">
      <mxGeometry height="40" width="265" x="780" y="1665" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-320" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;fontSize=12;fontColor=#666666;" value="SAFE TO REMOVE" vertex="1">
      <mxGeometry height="20" width="265" x="780" y="1705" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-321" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#999999;strokeWidth=2;" value="" vertex="1">
      <mxGeometry height="80" width="265" x="1065" y="1650" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-322" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;fontSize=24;fontStyle=1;fontColor=#333333;" value="YY" vertex="1">
      <mxGeometry height="40" width="265" x="1065" y="1665" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-323" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;fontSize=12;fontColor=#666666;" value="NEEDS REVIEW" vertex="1">
      <mxGeometry height="20" width="265" x="1065" y="1705" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-324" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#999999;strokeWidth=2;" value="" vertex="1">
      <mxGeometry height="80" width="265" x="1350" y="1650" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-325" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;fontSize=24;fontStyle=1;fontColor=#333333;" value="ZZ" vertex="1">
      <mxGeometry height="40" width="265" x="1350" y="1665" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-326" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;fontSize=12;fontColor=#666666;" value="RISKY" vertex="1">
      <mxGeometry height="20" width="265" x="1350" y="1705" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-327" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#999999;strokeWidth=2;" value="" vertex="1">
      <mxGeometry height="80" width="265" x="1635" y="1650" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-328" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;fontSize=24;fontStyle=1;fontColor=#333333;" value="WW" vertex="1">
      <mxGeometry height="40" width="265" x="1635" y="1665" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-329" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=center;verticalAlign=middle;fontSize=12;fontColor=#666666;" value="DEAD FILES" vertex="1">
      <mxGeometry height="20" width="265" x="1635" y="1705" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-330" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#999999;strokeWidth=2;" value="" vertex="1">
      <mxGeometry height="140" width="1120" x="780" y="1750" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-331" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#999999;strokeWidth=1;align=left;spacingLeft=15;fontStyle=1;fontColor=#333333;" value="Safe to Remove (X)" vertex="1">
      <mxGeometry height="40" width="1120" x="780" y="1750" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-332" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#cccccc;strokeWidth=1;align=left;spacingLeft=15;fontStyle=1;fontSize=11;fontColor=#666;" value="  FILE PATH                       BARIS   NAMA ITEM          TIPE         STATUS" vertex="1">
      <mxGeometry height="30" width="1120" x="780" y="1790" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-333" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=none;align=left;spacingLeft=15;fontFamily=monospace;" value="  path/to/file_1                  00      Item Name 1        Type         [ SAFE ]" vertex="1">
      <mxGeometry height="35" width="1120" x="780" y="1820" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-334" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#f9f9f9;strokeColor=none;align=left;spacingLeft=15;fontFamily=monospace;" value="  path/to/file_2                  00      Item Name 2        Type         [ SAFE ]" vertex="1">
      <mxGeometry height="35" width="1120" x="780" y="1855" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-335" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#999999;strokeWidth=2;" value="" vertex="1">
      <mxGeometry height="105" width="1120" x="780" y="1920" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-336" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#999999;strokeWidth=1;align=left;spacingLeft=15;fontStyle=1;fontColor=#333333;" value="Needs Review (Y)" vertex="1">
      <mxGeometry height="40" width="1120" x="780" y="1920" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-337" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#cccccc;strokeWidth=1;align=left;spacingLeft=15;fontStyle=1;fontSize=11;fontColor=#666;" value="  FILE PATH                       BARIS   NAMA ITEM          TIPE         STATUS" vertex="1">
      <mxGeometry height="30" width="1120" x="780" y="1960" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-338" parent="1" style="rounded=0;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=none;align=left;spacingLeft=15;fontFamily=monospace;" value="  path/to/file_3                  00      Item Name 3        Type         [ REVIEW ]" vertex="1">
      <mxGeometry height="35" width="1120" x="780" y="1990" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-339" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#999999;strokeWidth=2;" value="" vertex="1">
      <mxGeometry height="105" width="1120" x="780" y="2055" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-340" parent="1" style="rounded=1;whiteSpace=wrap;html=1;fillColor=#f5f5f5;strokeColor=#999999;strokeWidth=1;align=left;spacingLeft=15;fontStyle=1;fontColor=#333333;" value="File Tidak Terjangkau (Z)" vertex="1">
      <mxGeometry height="40" width="1120" x="780" y="2055" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-341" parent="1" style="text;html=1;strokeColor=none;fillColor=none;align=left;verticalAlign=top;fontFamily=monospace;lineHeight=1.5;" value="ðŸ“„ path/to/unreachable_file_1&#xa;ðŸ“„ path/to/unreachable_file_2" vertex="1">
      <mxGeometry height="50" width="1000" x="795" y="2105" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-342" edge="1" parent="1" source="Bmgpohvmm5VKlapb3zCL-295" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;entryX=0.5;entryY=0;entryDx=0;entryDy=0;strokeColor=#666666;strokeWidth=2;" target="Bmgpohvmm5VKlapb3zCL-296">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-343" edge="1" parent="1" source="Bmgpohvmm5VKlapb3zCL-295" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;entryX=0.5;entryY=0;entryDx=0;entryDy=0;strokeColor=#666666;strokeWidth=2;" target="Bmgpohvmm5VKlapb3zCL-297">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-344" edge="1" parent="1" source="Bmgpohvmm5VKlapb3zCL-296" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;entryX=0.5;entryY=0;entryDx=0;entryDy=0;strokeColor=#666666;strokeWidth=2;" target="Bmgpohvmm5VKlapb3zCL-298">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-345" edge="1" parent="1" source="Bmgpohvmm5VKlapb3zCL-296" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;entryX=0.5;entryY=0;entryDx=0;entryDy=0;strokeColor=#666666;strokeWidth=2;" target="Bmgpohvmm5VKlapb3zCL-299">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-346" edge="1" parent="1" source="Bmgpohvmm5VKlapb3zCL-297" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;entryX=0.5;entryY=0;entryDx=0;entryDy=0;strokeColor=#666666;strokeWidth=2;" target="Bmgpohvmm5VKlapb3zCL-300">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
    <mxCell id="Bmgpohvmm5VKlapb3zCL-347" edge="1" parent="1" source="Bmgpohvmm5VKlapb3zCL-297" style="edgeStyle=orthogonalEdgeStyle;rounded=1;orthogonalLoop=1;jettySize=auto;html=1;entryX=0.5;entryY=0;entryDx=0;entryDy=0;strokeColor=#666666;strokeWidth=2;" target="Bmgpohvmm5VKlapb3zCL-301">
      <mxGeometry relative="1" as="geometry" />
    </mxCell>
  </root>
</mxGraphModel>

**Gambar 4.7 Wireframe Visualisasi HTML**

---

##### C. Tahap Pengkodean (Coding)

Fokus utama tahap pengkodean adalah merealisasikan T4-01 hingga T4-04, mencakup tiga komponen utama: ekosistem perintah CLI, antarmuka wizard interaktif, dan sistem visualisasi berbasis HTML.

**1. Ekosistem Perintah Terintegrasi (*CLI Commands*)**

Modul antarmuka dikembangkan menggunakan pustaka `commander` untuk mendefinisikan arsitektur perintah yang terstruktur dan konsisten. Sistem menerapkan mekanisme *routing* otomatis: apabila CLI dijalankan tanpa argumen, *Wizard* interaktif akan langsung diluncurkan; sebaliknya, jika disertai argumen, `commander` akan meneruskan eksekusi ke modul perintah yang bersangkutan.

Cuplikan kode pada bagian ini disederhanakan untuk menampilkan mekanisme utama Modul CLI dan Reporter. Detail impor, validasi argumen, penanganan galat, dan fungsi pendukung terdapat pada implementasi lengkap sistem.

```javascript
// bin/dce-cli.js
import { Command } from 'commander';
import { launchWizard } from '../src/cli/wizard.js';

const program = new Command();

// Registrasi modul perintah (contoh: scan, fix, visualize)
program.command('scan [projectPath]').action(runScanCommand);
program.command('fix [projectPath]').action(runFixCommand);
program.command('visualize [projectPath]').action(runVisualizeCommand);

// Routing dinamis: jika tanpa argumen, luncurkan Wizard
process.argv.length === 2 ? launchWizard() : program.parse(process.argv);
```

**2. Antarmuka Panduan Interaktif (*Interactive Wizard*)**

Guna meminimalkan potensi kesalahan konfigurasi pada penggunaan pertama, sebuah *Interactive Wizard* dibangun menggunakan pustaka antarmuka baris perintah interaktif. *Wizard* menampilkan *banner* visual terlebih dahulu, lalu memandu pengguna secara bertahap untuk memilih aksi utama (seperti *scan*, *visualize*, atau *show-deps*) dan menentukan direktori target. 

Khusus setelah proses *scan* selesai, program dirancang agar secara otomatis mengenali status alur dan menampilkan *prompt* konfirmasi tambahan. *Prompt* ini akan proaktif menanyakan apakah pengguna ingin langsung melanjutkan ke proses eksekusi penghapusan (*fix*) atau tidak, sehingga menciptakan alur penyelesaian anomali yang mulus.

*(Tampilan antarmuka Interactive Wizard saat dijalankan di terminal dapat dilihat pada Gambar berikut)*

**[MASUKKAN SCREENSHOT TAMPILAN TERMINAL SAAT MENGETIK `dce-cli` (YANG ADA MENU PILIHANNYA) DI SINI]**

**3. Visualisasi Graf dan *Dashboard* HTML**

Inovasi utama pada iterasi ini adalah perintah visualisasi. Modul ini tidak sekadar mencetak teks di terminal, melainkan **menghasilkan sebuah *Dashboard* HTML secara otomatis**. *Dashboard* tersebut memuat komponen-komponen berikut:

*   Visualisasi arsitektur proyek dalam bentuk graf dependensi berarah yang interaktif, dirender dengan tata letak visual khusus (*Dagre*).
*   Laporan anomali *dead code* yang dikategorikan berdasarkan tingkat keamanan (*Safe*, *Review*, *Risky*) dalam bentuk tabel terstruktur.
*   Daftar dependensi aktif dan dependensi yang tidak terpakai (*unused dependencies*) yang disajikan dalam kartu samping.
*   Dukungan penuh terhadap mode gelap (*Dark Mode*) serta antarmuka dua bahasa (Bahasa Indonesia dan Bahasa Inggris).

Setelah berkas HTML selesai dibentuk, sistem secara otomatis akan meluncurkan peramban (*browser*) bawaan pengguna dan menampilkan *Dashboard* tersebut sebagai media pelaporan interaktif.

*(Tampilan hasil akhir Dashboard HTML dapat dilihat pada Gambar berikut)*

**[MASUKKAN SCREENSHOT TAMPILAN DASHBOARD HTML DI BROWSER DI SINI]**

**4. Perakitan ScanPipeline**
Sebagai puncak integrasi seluruh sistem dari Iterasi 1 hingga Iterasi 4, alur eksekusi perintah `scan` secara menyeluruh dirakit menjadi satu pipeline utama:

```javascript
// src/commands/scanCommand.js
export async function runScanCommand(projectPath, opts) {
  // 1. Persiapan & Pemetaan Graf
  const ruleEngine = await loadRuleEngine(projectPath);
  const graph = await buildProjectGraph(projectPath, ruleEngine);
  
  // 2. Analisis Anomali per Berkas
  const allIssues = [];
  for (const file of graph.liveFiles) {
    allIssues.push(...findDeadCode(await getCachedAst(file), file, graph.registry, ruleEngine));
  }
  
  // 3. Analisis Dependensi & 4. Pelaporan
  const depReport = await analyzeDependencies(projectPath, graph.usedPackages);
  opts.json ? process.stdout.write(JSON.stringify({ issues: allIssues, depReport })) 
            : renderTerminalReport(allIssues, depReport, graph);
}
```

---

##### D. Tahap Pengujian (Testing)

Pengujian unit dan integrasi dilakukan untuk memvalidasi logika antarmuka CLI, struktur keluaran Reporter, alur *Interactive Wizard*, dan pembentukan dokumen HTML. Pengujian pada Iterasi 4 terdiri atas 13 skenario, yaitu empat pengujian Visualisasi HTML, tiga pengujian *Interactive Wizard*, tiga pengujian Reporter terminal dan JSON, serta tiga pengujian *routing* CLI.

Hasil pengujian menunjukkan bahwa seluruh 13 skenario yang didefinisikan berhasil dilalui. Hasil tersebut menunjukkan bahwa komponen CLI dan Reporter menghasilkan keluaran sesuai dengan skenario pengujian yang ditetapkan, tetapi belum menunjukkan ketahanan sistem terhadap seluruh variasi proyek JavaScript dan TypeScript.

**[MASUKKAN SCREENSHOT HASIL VITEST DI SINI]**

---

##### E. Evaluasi dan Rilis Iterasi (*Iteration Review*)

Modul CLI dan Reporter berhasil diimplementasikan sebagai lapisan interaksi antara pengguna dan modul inti sistem. Antarmuka CLI menyediakan akses terhadap proses pemindaian, eliminasi, pemeriksaan dependensi, dan visualisasi, sedangkan Modul Reporter menyajikan hasil analisis melalui terminal, JSON, dan dokumen HTML interaktif.

Dengan selesainya Iterasi 4, seluruh fitur utama sistem telah terintegrasi dalam satu antarmuka CLI. Sistem dinyatakan siap untuk memasuki tahap pengujian fungsional secara menyeluruh.

| ID Task | Deskripsi | Status | Keterangan |
| :--- | :--- | :--- | :--- |
| T4-01 | Registrasi dan *routing* perintah CLI (`scan`, `fix`, `show-deps`, `visualize`, `trace`, `watch`, `report`, `history`, `init`) | Selesai | Terintegrasi |
| T4-02 | Pembangunan antarmuka *Wizard* interaktif berbasis `inquirer` | Selesai | Terintegrasi |
| T4-03 | Pembangunan Modul *Reporter* format terminal dan JSON | Selesai | Terintegrasi |
| T4-04 | Pembangunan Visualisasi Graf HTML (*Dashboard* Cytoscape.js + Dagre) | Selesai | Terintegrasi |
| T4-05 | Pengujian unit dan integrasi antarmuka CLI serta Modul Reporter | Selesai | Lulus Uji |
