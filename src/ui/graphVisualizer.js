import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Menghasilkan Dashboard HTML interaktif dengan vis.js Network, kartu dependensi,
 * dukungan bilingual (Indonesia / English), laporan Dead Code, dan logo terintegrasi Base64.
 * @param {object} graph      - { liveFiles: Set<string>, usedPackages: Set<string>, edges: Array }
 * @param {string} rootDir    - Direktori akar proyek untuk path relatif
 * @param {object} pkgData    - Data package.json (dependencies, devDependencies)
 * @param {object} reportData - Data laporan dead code (opsional)
 * @returns {string} String HTML siap buka di browser
 */
export function generateMermaidGraph(graph, rootDir, pkgData = { dependencies: {}, devDependencies: {} }, reportData = null) {

    // === Baca Logo (encode Base64 agar HTML mandiri) ===
    let logoImgHtml = '';
    const logoPath = path.resolve(__dirname, 'Logo.png');
    if (fs.existsSync(logoPath)) {
        try {
            const logoBase64 = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`;
            logoImgHtml = `<img src="${logoBase64}" alt="Logo" class="header-logo">`;
        } catch(e) { 
            /* fallback tanpa logo */ 
            if (process.env.DEBUG) console.warn(e);
        }
    }

    // === 1. Siapkan Data untuk vis.js ===
    const validFiles = Array.from(graph.liveFiles)
        .filter(f => !f.includes('node_modules'))
        .sort();

    // Tentukan warna unik per direktori — palet yang lebih halus dan harmonis
    const PALETTE = [
        '#3B82F6', '#8B5CF6', '#059669', '#E11D48', '#D97706',
        '#0891B2', '#DB2777', '#65A30D', '#7C3AED', '#0284C7',
        '#EA580C', '#4F46E5', '#0D9488', '#C026D3'
    ];
    const dirColorMap = {};
    let colorIdx = 0;

    const getRelPath = (f) => path.relative(rootDir, f).replace(/\\/g, '/');
    const getDirName = (f) => path.dirname(getRelPath(f));
    const getFileName = (f) => path.basename(getRelPath(f));

    // Kumpulkan semua direktori unik dan warnanya
    validFiles.forEach(file => {
        const dir = getDirName(file);
        if (!dirColorMap[dir]) {
            dirColorMap[dir] = PALETTE[colorIdx % PALETTE.length];
            colorIdx++;
        }
    });

    // Build nodes array — format Cytoscape.js
    const nodeIndex = new Map();
    const cyNodes = validFiles.map((file, i) => {
        nodeIndex.set(file, i);
        const dir = getDirName(file);
        const color = dirColorMap[dir];
        const label = getFileName(file);
        const relPath = getRelPath(file);

        return {
            data: {
                id: String(i),
                label,
                tooltip: relPath,
                dir,
                color,
                bgColor: color + '18',
                borderColor: color
            }
        };
    });

    // Build edges array — format Cytoscape.js
    const cyEdges = [];
    if (graph.edges) {
        let edgeIdx = 0;
        graph.edges.forEach(edge => {
            if (edge.from.includes('node_modules') || edge.to.includes('node_modules')) return;
            const fromId = nodeIndex.get(edge.from);
            const toId   = nodeIndex.get(edge.to);
            if (fromId === undefined || toId === undefined) return;

            const names = (edge.names || []).filter(n => n && n !== '*');
            const labelText = names.length > 0 ? names.slice(0, 2).join(', ') : '';

            cyEdges.push({
                data: {
                    id: 'e' + edgeIdx++,
                    source: String(fromId),
                    target: String(toId),
                    label: labelText
                }
            });
        });
    }

    // === 2. Statistik ===
    const totalEdges  = cyEdges.length;
    const allDeps     = new Set(Object.keys({ ...pkgData.dependencies, ...pkgData.devDependencies }));
    const usedDeps    = [...allDeps].filter(d =>  graph.usedPackages.has(d)).sort();
    const unusedDeps  = [...allDeps].filter(d => !graph.usedPackages.has(d)).sort();

    // === 3. Legend per direktori ===
    const legendItems = Object.entries(dirColorMap)
        .map(([dir, color]) => `<div class="legend-item"><span class="legend-dot" style="background:${color}"></span><code>${dir === '.' ? 'root' : dir}</code></div>`)
        .join('');

    // === 4. Daftar Dependensi ===
    const buildDepList = (deps, emptyKey) => {
        if (deps.length === 0)
            return `<li class="empty-msg" data-i18n="${emptyKey}"></li>`;
        return deps.map(d => `<li><span class="dep-dot"></span>${d}</li>`).join('');
    };

    // === 5. Kamus Bilingual ===
    const i18n = JSON.stringify({
        id: {
            title:       'Keterlacakan Struktur Kode',
            subtitle:    'Hasil analisis struktur kode oleh DeadKiller CLI',
            filesActive: 'File Aktif',
            connections: 'Koneksi Edge',
            totalDep:    'Total Dependensi',
            graphTitle:  'Graf Keterlacakan Kode',
            usedTitle:   'Dep. Terpakai',
            unusedTitle: 'Dep. Mati',
            emptyUsed:   'Tidak ada dependensi terpakai.',
            emptyUnused: 'Proyek sangat bersih!',
            legendTitle: 'Direktori',
            tipZoom:     'Scroll untuk zoom · Drag node untuk pindah · Klik untuk sorot',
            reportTitle: 'Laporan Dead Code',
            safeTitle:   'Aman Dihapus (Safe)',
            reviewTitle: 'Butuh Peninjauan (Review)',
            riskyTitle:  'Berisiko Tinggi (Risky)',
            deadFilesTitle: 'File Tidak Terjangkau',
            unsafeTitle: 'File Dinamis (Akurasi Terbatas)',
            colFile:     'File',
            colLine:     'Baris',
            colName:     'Nama',
            colType:     'Tipe',
            colConfidence:'Kepercayaan',
            colStatus:   'Status',
            noIssues:    'Proyek bersih! Tidak ada dead code ditemukan.'
        },
        en: {
            title:       'Code Structure Traceability',
            subtitle:    'Code structure analysis result by DeadKiller CLI',
            filesActive: 'Active Files',
            connections: 'Edge Connections',
            totalDep:    'Total Dependencies',
            graphTitle:  'Code Traceability Graph',
            usedTitle:   'Used Deps.',
            unusedTitle: 'Dead Deps.',
            emptyUsed:   'No dependencies found in use.',
            emptyUnused: 'Project is perfectly clean!',
            legendTitle: 'Directories',
            tipZoom:     'Scroll to zoom · Drag nodes to move · Click to highlight',
            reportTitle: 'Dead Code Report',
            safeTitle:   'Safe to Remove',
            reviewTitle: 'Needs Review',
            riskyTitle:  'High Risk (Risky)',
            deadFilesTitle: 'Unreachable Files',
            unsafeTitle: 'Dynamic Files (Limited Accuracy)',
            colFile:     'File',
            colLine:     'Line',
            colName:     'Name',
            colType:     'Type',
            colConfidence:'Confidence',
            colStatus:   'Status',
            noIssues:    'Project is clean! No dead code found.'
        }
    });

    // === 6. Data JSON untuk Cytoscape.js ===
    const elementsJson = JSON.stringify([...cyNodes, ...cyEdges]);

    return `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Code Structure Traceability | DeadKiller</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">

    <!-- Cytoscape.js + dagre layout -->
    <script src="https://cdn.jsdelivr.net/npm/cytoscape@3.30.4/dist/cytoscape.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/dagre@0.8.5/dist/dagre.min.js"></script>
    <script src="https://cdn.jsdelivr.net/npm/cytoscape-dagre@2.5.0/cytoscape-dagre.js"></script>

    <script>
        // === Bilingual i18n ===
        const DICT = ${i18n};
        let currentLang = localStorage.getItem('dk-lang') || 'id';

        function applyLang(lang) {
            currentLang = lang;
            localStorage.setItem('dk-lang', lang);
            const t = DICT[lang];
            document.querySelectorAll('[data-i18n]').forEach(el => {
                const key = el.dataset.i18n;
                if (t[key] !== undefined) el.textContent = t[key];
            });
            document.querySelectorAll('.lang-btn').forEach(btn => {
                btn.classList.toggle('active', btn.dataset.lang === lang);
            });
            document.documentElement.lang = lang;
        }

        let cy = null; // referensi global Cytoscape instance

        window.addEventListener('DOMContentLoaded', () => {
            if (localStorage.getItem('dk-theme') === 'dark') {
                document.body.classList.add('dark');
            }
            applyLang(currentLang);
            initGraph();
        });

        function toggleDark() {
            document.body.classList.toggle('dark');
            const dark = document.body.classList.contains('dark');
            localStorage.setItem('dk-theme', dark ? 'dark' : 'light');
            if (cy) updateGraphColors(dark);
        }

        function updateGraphColors(dark) {
            cy.nodes().forEach(n => {
                n.style('color', dark ? '#c9d1d9' : '#1E293B');
            });
            cy.edges().forEach(e => {
                e.style({
                    'line-color': dark ? '#30363d' : '#CBD5E1',
                    'target-arrow-color': dark ? '#484f58' : '#94A3B8',
                    'color': dark ? '#6e7681' : '#94A3B8',
                    'text-background-color': dark ? '#161b22' : '#ffffff'
                });
            });
        }

        function initGraph() {
            const container = document.getElementById('cy-graph');
            const dark = document.body.classList.contains('dark');

            cy = cytoscape({
                container,
                elements: ${elementsJson},
                layout: {
                    name: 'dagre',
                    rankDir: 'TB',
                    nodeSep: 80,
                    rankSep: 100,
                    edgeSep: 40,
                    ranker: 'network-simplex',
                    padding: 40
                },
                style: [
                    {
                        selector: 'node',
                        style: {
                            'label': 'data(label)',
                            'text-valign': 'center',
                            'text-halign': 'center',
                            'font-family': "'Inter', system-ui, sans-serif",
                            'font-size': '11px',
                            'font-weight': 500,
                            'color': dark ? '#c9d1d9' : '#1E293B',
                            'background-color': 'data(bgColor)',
                            'border-color': 'data(borderColor)',
                            'border-width': 1.5,
                            'shape': 'round-rectangle',
                            'width': 'label',
                            'height': 32,
                            'padding': '12px',
                            'text-wrap': 'none',
                            'shadow-blur': 6,
                            'shadow-color': 'rgba(0,0,0,0.08)',
                            'shadow-offset-x': 0,
                            'shadow-offset-y': 2,
                            'shadow-opacity': 0.5,
                            'transition-property': 'opacity, border-width',
                            'transition-duration': '0.2s'
                        }
                    },
                    {
                        selector: 'node:selected',
                        style: {
                            'border-width': 2.5,
                            'border-color': '#3B82F6',
                            'shadow-color': 'rgba(59,130,246,0.3)',
                            'shadow-blur': 12
                        }
                    },
                    {
                        selector: 'edge',
                        style: {
                            'curve-style': 'taxi',
                            'taxi-direction': 'downward',
                            'taxi-turn': '60px',
                            'taxi-turn-min-distance': '10px',
                            'target-arrow-shape': 'triangle',
                            'target-arrow-color': dark ? '#484f58' : '#94A3B8',
                            'arrow-scale': 0.7,
                            'line-color': dark ? '#30363d' : '#CBD5E1',
                            'width': 1.3,
                            'opacity': 0.75,
                            'label': 'data(label)',
                            'font-size': '9px',
                            'font-family': "'Inter', monospace",
                            'color': dark ? '#6e7681' : '#94A3B8',
                            'text-rotation': 'autorotate',
                            'text-background-opacity': 0.9,
                            'text-background-color': dark ? '#161b22' : '#ffffff',
                            'text-background-padding': '3px',
                            'text-background-shape': 'roundrectangle',
                            'transition-property': 'opacity, width, line-color',
                            'transition-duration': '0.2s'
                        }
                    },
                    {
                        selector: 'edge:selected',
                        style: {
                            'line-color': '#3B82F6',
                            'target-arrow-color': '#3B82F6',
                            'width': 2.5
                        }
                    },
                    {
                        selector: '.dimmed',
                        style: { 'opacity': 0.1 }
                    },
                    {
                        selector: '.highlighted',
                        style: {
                            'opacity': 1,
                            'border-width': 2.5
                        }
                    },
                    {
                        selector: 'edge.highlighted',
                        style: {
                            'opacity': 1,
                            'width': 2.2,
                            'line-color': '#3B82F6',
                            'target-arrow-color': '#3B82F6'
                        }
                    }
                ],
                minZoom: 0.15,
                maxZoom: 3,
                wheelSensitivity: 0.3,
                boxSelectionEnabled: false
            });

            // Klik node → highlight tetangga (orthogonal edges tetap rapi)
            cy.on('tap', 'node', function(evt) {
                const node = evt.target;
                const neighborhood = node.closedNeighborhood();

                cy.elements().addClass('dimmed').removeClass('highlighted');
                neighborhood.removeClass('dimmed').addClass('highlighted');
            });

            // Klik background → reset
            cy.on('tap', function(evt) {
                if (evt.target === cy) {
                    cy.elements().removeClass('dimmed highlighted');
                }
            });

            // Tooltip on hover
            cy.on('mouseover', 'node', function(evt) {
                const tooltip = evt.target.data('tooltip');
                if (tooltip) {
                    container.title = tooltip;
                }
            });
            cy.on('mouseout', 'node', function() {
                container.title = '';
            });

            // Tombol kontrol
            document.getElementById('btn-fit').addEventListener('click', () => cy.fit(null, 40));
            document.getElementById('btn-zoom-in').addEventListener('click',  () => cy.zoom({ level: cy.zoom() * 1.3, renderedPosition: { x: container.offsetWidth / 2, y: container.offsetHeight / 2 } }));
            document.getElementById('btn-zoom-out').addEventListener('click', () => cy.zoom({ level: cy.zoom() * 0.75, renderedPosition: { x: container.offsetWidth / 2, y: container.offsetHeight / 2 } }));
        }
    </script>

    <style>
        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
        :root {
            --bg:        #F1F5F9;
            --surface:   #FFFFFF;
            --surface-2: #F8FAFC;
            --border:    #E2E8F0;
            --text-1:    #0F172A;
            --text-2:    #475569;
            --text-3:    #94A3B8;
            --accent:    #3B82F6;
            --accent-bg: #EFF6FF;
            --green:     #059669;
            --green-bg:  #ECFDF5;
            --red:       #DC2626;
            --red-bg:    #FFF1F2;
            --radius:    12px;
            --shadow:    0 1px 3px rgba(0,0,0,0.06);
        }
        body {
            font-family: 'Inter', system-ui, sans-serif;
            background: var(--bg);
            color: var(--text-1);
            min-height: 100vh;
            padding: 1.5rem;
        }

        /* Topbar */
        .topbar {
            display: flex; justify-content: flex-end;
            max-width: 1280px; margin: 0 auto 1rem;
        }
        .lang-switcher {
            display: flex; background: var(--surface);
            border: 1px solid var(--border); border-radius: 99px;
            padding: 3px; gap: 2px; box-shadow: var(--shadow);
        }
        .lang-btn {
            padding: 0.28rem 0.85rem; border-radius: 99px;
            font-size: 0.75rem; font-weight: 700; border: none;
            cursor: pointer; background: transparent; color: var(--text-3);
            transition: all 0.2s; letter-spacing: 0.04em;
        }
        .lang-btn.active { background: var(--accent); color: #fff; }
        .lang-btn:not(.active):hover { color: var(--text-1); background: var(--surface-2); }

        /* Header */
        .page-header {
            display: flex; align-items: center; gap: 1.5rem;
            max-width: 1280px; margin: 0 auto 1.25rem;
            padding: 1.5rem 2rem;
            background: var(--surface); border: 1px solid var(--border);
            border-radius: var(--radius); box-shadow: var(--shadow);
        }
        .header-logo {
            width: 96px; height: 96px; object-fit: contain; flex-shrink: 0;
            filter: drop-shadow(0 2px 8px rgba(0,0,0,0.10));
        }
        .header-text h1 {
            font-size: 1.6rem; font-weight: 800;
            letter-spacing: -0.5px; color: var(--text-1);
        }
        .header-text p { font-size: 0.875rem; color: var(--text-2); margin-top: 0.25rem; }
        .badge-row { display: flex; gap: 0.5rem; margin-top: 0.6rem; flex-wrap: wrap; }
        .badge {
            font-size: 0.72rem; font-weight: 600;
            padding: 0.22rem 0.65rem; border-radius: 99px;
            background: var(--accent-bg); color: var(--accent); border: 1px solid #BFDBFE;
        }
        .badge.green { background: var(--green-bg); color: var(--green); border-color: #A7F3D0; }
        .badge.red   { background: var(--red-bg);   color: var(--red);   border-color: #FECACA; }

        /* Stats strip */
        .stats-strip {
            display: grid; grid-template-columns: repeat(3, 1fr);
            gap: 1px; background: var(--border); border-radius: var(--radius);
            overflow: hidden; border: 1px solid var(--border);
            max-width: 1280px; margin: 0 auto 1.25rem;
        }
        .stat-item { background: var(--surface); padding: 0.9rem 1.5rem; }
        .stat-num  { display: block; font-size: 1.6rem; font-weight: 800; color: var(--accent); line-height: 1; }
        .stat-label{ display: block; font-size: 0.68rem; color: var(--text-3); font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 3px; }

        /* Main Layout */
        .main-layout {
            display: grid; grid-template-columns: 1fr 280px;
            gap: 1.25rem; max-width: 1280px; margin: 0 auto;
            align-items: start;
        }
        @media (max-width: 1024px) { .main-layout { grid-template-columns: 1fr; } }

        /* Card */
        .card {
            background: var(--surface); border: 1px solid var(--border);
            border-radius: var(--radius); box-shadow: var(--shadow); overflow: hidden;
        }
        .card-header {
            display: flex; align-items: center; gap: 0.6rem;
            padding: 0.75rem 1.1rem; border-bottom: 1px solid var(--border);
            background: var(--surface-2);
        }
        .card-header h2 {
            font-size: 0.75rem; font-weight: 700; color: var(--text-2);
            text-transform: uppercase; letter-spacing: 0.07em;
        }
        .card-icon { width: 15px; height: 15px; color: var(--text-3); flex-shrink: 0; }

        /* vis.js → Cytoscape graph panel */
        .graph-panel .graph-toolbar {
            display: flex; align-items: center; justify-content: space-between;
            padding: 0.6rem 1.1rem; border-bottom: 1px solid var(--border);
            background: var(--surface-2);
        }
        .graph-panel .tip {
            font-size: 0.7rem; color: var(--text-3); font-style: italic;
        }
        .graph-panel .ctrl-btns { display: flex; gap: 4px; }
        .ctrl-btn {
            padding: 0.3rem 0.65rem; border: 1px solid var(--border);
            border-radius: 6px; background: var(--surface); color: var(--text-2);
            font-size: 0.78rem; font-weight: 600; cursor: pointer;
            transition: all 0.15s;
        }
        .ctrl-btn:hover { background: var(--accent-bg); color: var(--accent); border-color: #BFDBFE; }

        #cy-graph {
            width: 100%; height: 600px;
            background: linear-gradient(135deg, var(--surface-2) 0%, var(--surface) 100%);
            border-top: 1px solid var(--border);
        }

        /* Legend */
        .legend-panel .legend-body {
            padding: 0.75rem 1.1rem;
            display: flex; flex-direction: column; gap: 6px;
        }
        .legend-item { display: flex; align-items: center; gap: 8px; font-size: 0.75rem; color: var(--text-2); }
        .legend-dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
        .legend-item code { font-size: 0.7rem; color: var(--text-1); }

        /* Dep Cards */
        .dep-list { list-style: none; }
        .dep-list li {
            display: flex; align-items: center; gap: 0.6rem;
            padding: 0.55rem 1.1rem; font-size: 0.78rem; font-weight: 500;
            color: var(--text-1); border-bottom: 1px solid var(--border);
            transition: background 0.12s; font-family: 'Inter', monospace;
        }
        .dep-list li:last-child { border-bottom: none; }
        .dep-list li:hover { background: var(--surface-2); }
        .dep-dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
        .used   .dep-dot { background: var(--green); }
        .unused .dep-dot { background: var(--red); }
        .empty-msg { color: var(--text-3) !important; font-style: italic; }
        .card.used   .card-header h2 { color: var(--green); }
        .card.unused .card-header h2 { color: var(--red); }




        /* === DEAD CODE REPORT SECTION === */
        .report-section {
            max-width: 1280px; margin: 1.25rem auto 0;
        }
        .report-section .section-title {
            display: flex; align-items: center; gap: 0.6rem;
            font-size: 1.1rem; font-weight: 700; color: var(--text-1);
            margin-bottom: 1rem; padding-bottom: 0.6rem;
            border-bottom: 2px solid var(--border);
        }
        .report-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
            gap: 12px; margin-bottom: 1.25rem;
        }
        .report-stat {
            background: var(--surface); border: 1px solid var(--border);
            border-radius: 10px; padding: 16px; text-align: center;
        }
        .report-stat .num {
            font-size: 1.8rem; font-weight: 800; line-height: 1;
        }
        .report-stat .lbl {
            font-size: 0.68rem; color: var(--text-3); font-weight: 600;
            text-transform: uppercase; margin-top: 4px;
        }
        .report-stat.safe .num   { color: var(--green); }
        .report-stat.review .num { color: #D97706; }
        .report-stat.risky .num  { color: var(--red); }
        .report-stat.dead .num   { color: #7C3AED; }

        /* Report Table */
        .report-table {
            width: 100%; border-collapse: collapse; font-size: 0.78rem;
        }
        .report-table th {
            text-align: left; padding: 8px 12px;
            border-bottom: 2px solid var(--border);
            color: var(--text-3); font-weight: 600;
            font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.05em;
        }
        .report-table td {
            padding: 7px 12px; border-bottom: 1px solid var(--border);
            color: var(--text-1); font-family: 'Inter', monospace;
        }
        .report-table tr:hover td { background: var(--surface-2); }
        .report-table code { font-size: 0.72rem; color: var(--text-2); }

        /* Report Badges */
        .rbadge {
            display: inline-block; padding: 2px 8px;
            border-radius: 99px; font-size: 0.65rem; font-weight: 700;
            text-transform: uppercase; letter-spacing: 0.04em;
        }
        .rbadge-high   { background: #FEE2E2; color: #DC2626; }
        .rbadge-medium { background: #FEF3C7; color: #D97706; }
        .rbadge-low    { background: #F1F5F9; color: #64748B; }
        .rbadge-safe   { background: #ECFDF5; color: #059669; }
        .rbadge-review { background: #FEF3C7; color: #D97706; }
        .rbadge-risky  { background: #FEE2E2; color: #DC2626; }

        /* File list in report */
        .report-file-list { list-style: none; }
        .report-file-list li {
            padding: 6px 12px; border-bottom: 1px solid var(--border);
            font-family: 'Inter', monospace; font-size: 0.78rem; color: var(--text-2);
        }
        .report-file-list li:last-child { border-bottom: none; }

        .report-empty {
            padding: 20px; text-align: center;
            color: var(--green); font-weight: 600; font-style: italic;
        }

        /* === DARK MODE === */
        body.dark {
            --bg:        #0d1117;
            --surface:   #161b22;
            --surface-2: #1c2333;
            --border:    #30363d;
            --text-1:    #c9d1d9;
            --text-2:    #8b949e;
            --text-3:    #484f58;
            --accent:    #58a6ff;
            --accent-bg: #0d419d20;
            --green:     #3fb950;
            --green-bg:  #3fb95015;
            --red:       #f85149;
            --red-bg:    #f8514915;
            --shadow:    0 1px 3px rgba(0,0,0,0.3);
        }
        body.dark .rbadge-high   { background: #f8514920; color: #f85149; }
        body.dark .rbadge-medium { background: #d2992220; color: #d29922; }
        body.dark .rbadge-low    { background: #8b949e20; color: #8b949e; }
        body.dark .rbadge-safe   { background: #3fb95020; color: #3fb950; }
        body.dark .rbadge-review { background: #d2992220; color: #d29922; }
        body.dark .rbadge-risky  { background: #f8514920; color: #f85149; }
        body.dark .badge         { background: #0d419d30; color: var(--accent); border-color: #1f3a6e; }
        body.dark .badge.green   { background: var(--green-bg); color: var(--green); border-color: #1a472a; }
        body.dark .badge.red     { background: var(--red-bg);   color: var(--red);   border-color: #5c1f1f; }
        body.dark #cy-graph       { background: linear-gradient(135deg, #0d1117 0%, #161b22 100%); }
        body.dark .ctrl-btn       { background: #161b22; color: #8b949e; border-color: #30363d; }
        body.dark .ctrl-btn:hover { background: #1c2333; color: #58a6ff; border-color: #1f3a6e; }
        body.dark .graph-panel .tip { color: #484f58; }

        /* Theme toggle */
        .theme-toggle {
            padding: 0.28rem 0.85rem; border-radius: 99px;
            font-size: 0.75rem; font-weight: 700; border: 1px solid var(--border);
            cursor: pointer; background: var(--surface); color: var(--text-2);
            transition: all 0.2s; margin-left: 8px;
        }
        .theme-toggle:hover { background: var(--accent-bg); color: var(--accent); }
    </style>
</head>
<body>

    <!-- Language + Theme Switcher -->
    <div class="topbar">
        <div class="lang-switcher">
            <button class="lang-btn" data-lang="id" onclick="applyLang('id')">ID</button>
            <button class="lang-btn" data-lang="en" onclick="applyLang('en')">EN</button>
            <button class="theme-toggle" onclick="toggleDark()" title="Toggle Dark Mode">🌓</button>
        </div>
    </div>

    <!-- Header -->
    <header class="page-header">
        ${logoImgHtml}
        <div class="header-text">
            <h1 data-i18n="title">Code Structure Traceability</h1>
            <p data-i18n="subtitle">Code structure analysis result by DeadKiller CLI</p>
            <div class="badge-row">
                <span class="badge">${validFiles.length} <span data-i18n="filesActive">Active Files</span></span>
                <span class="badge green">${usedDeps.length} <span data-i18n="usedTitle">Used Deps.</span></span>
                <span class="badge red">${unusedDeps.length} <span data-i18n="unusedTitle">Dead Deps.</span></span>
            </div>
        </div>
    </header>

    <!-- Stats -->
    <div class="stats-strip">
        <div class="stat-item">
            <span class="stat-num">${validFiles.length}</span>
            <span class="stat-label" data-i18n="filesActive">Active Files</span>
        </div>
        <div class="stat-item">
            <span class="stat-num">${totalEdges}</span>
            <span class="stat-label" data-i18n="connections">Edge Connections</span>
        </div>
        <div class="stat-item">
            <span class="stat-num">${allDeps.size}</span>
            <span class="stat-label" data-i18n="totalDep">Total Dependencies</span>
        </div>
    </div>

    <!-- Main Layout -->
    <div class="main-layout">

        <!-- Graph Panel (Left) -->
        <div class="card graph-panel">
            <div class="card-header">
                <svg class="card-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
                </svg>
                <h2 data-i18n="graphTitle">Code Traceability Graph</h2>
            </div>
            <div class="graph-toolbar">
                <span class="tip" data-i18n="tipZoom">Scroll to zoom · Drag to pan · Click node to highlight</span>
                <div class="ctrl-btns">
                    <button class="ctrl-btn" id="btn-zoom-in">＋</button>
                    <button class="ctrl-btn" id="btn-zoom-out">－</button>
                    <button class="ctrl-btn" id="btn-fit">⊡ Fit</button>
                </div>
            </div>
            <div id="cy-graph"></div>
        </div>

        <!-- Sidebar (Right) -->
        <aside class="sidebar" style="display:flex; flex-direction:column; gap:1.25rem;">

            <!-- Legend Direktori -->
            <div class="card legend-panel">
                <div class="card-header">
                    <svg class="card-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
                    </svg>
                    <h2 data-i18n="legendTitle">Directories</h2>
                </div>
                <div class="legend-body">
                    ${legendItems}
                </div>
            </div>

            <!-- Used Deps -->
            <div class="card used">
                <div class="card-header">
                    <svg class="card-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <h2><span data-i18n="usedTitle">Used Deps.</span> (${usedDeps.length})</h2>
                </div>
                <ul class="dep-list used">
                    ${buildDepList(usedDeps, 'emptyUsed')}
                </ul>
            </div>

            <!-- Dead Deps -->
            <div class="card unused">
                <div class="card-header">
                    <svg class="card-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">
                        <path stroke-linecap="round" stroke-linejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                    </svg>
                    <h2><span data-i18n="unusedTitle">Dead Deps.</span> (${unusedDeps.length})</h2>
                </div>
                <ul class="dep-list unused">
                    ${buildDepList(unusedDeps, 'emptyUnused')}
                </ul>
            </div>

        </aside>
    </div>

    ${_buildReportSection(reportData)}

</body>
</html>
`;
}

/**
 * Helper: escape HTML entities
 */
function _escapeHtml(str) {
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Helper: Membangun baris tabel untuk dead code nodes
 */
function _renderTableRows(nodes, statusLabel) {
    if (!nodes || nodes.length === 0) return '';
    return nodes.map(n => `
        <tr>
            <td><code>${_escapeHtml(n.file)}</code></td>
            <td>${n.line}</td>
            <td>${_escapeHtml(n.name)}</td>
            <td>${n.type}</td>
            <td><span class="rbadge rbadge-${n.confidence || 'medium'}">${(n.confidence || 'medium').toUpperCase()}</span></td>
            <td><span class="rbadge rbadge-${n.status || 'review'}">${statusLabel}</span></td>
        </tr>
    `).join('');
}

/**
 * Membangun section HTML laporan Dead Code untuk dashboard.
 * @param {object|null} reportData - { safeNodes, reviewNodes, riskyNodes, deadFiles, unsafeFiles }
 * @returns {string} HTML string
 */
function _buildReportSection(reportData) {
    if (!reportData) return '<!-- No report data -->';

    const { safeNodes = [], reviewNodes = [], riskyNodes = [], deadFiles = [], unsafeFiles = [] } = reportData;
    const totalIssues = safeNodes.length + reviewNodes.length + riskyNodes.length;

    if (totalIssues === 0 && deadFiles.length === 0 && unsafeFiles.length === 0) {
        return `
    <div class="report-section">
        <div class="section-title">\u2620\uFE0F <span data-i18n="reportTitle">Dead Code Report</span></div>
        <div class="card"><div class="report-empty" data-i18n="noIssues">Proyek bersih! Tidak ada dead code ditemukan.</div></div>
    </div>`;
    }

    const tableHeader = `
        <thead><tr>
            <th data-i18n="colFile">File</th>
            <th data-i18n="colLine">Line</th>
            <th data-i18n="colName">Name</th>
            <th data-i18n="colType">Type</th>
            <th data-i18n="colConfidence">Confidence</th>
            <th data-i18n="colStatus">Status</th>
        </tr></thead>`;

    let html = `
    <div class="report-section">
        <div class="section-title">\u2620\uFE0F <span data-i18n="reportTitle">Dead Code Report</span></div>

        <div class="report-grid">
            <div class="report-stat safe">
                <div class="num">${safeNodes.length}</div>
                <div class="lbl" data-i18n="safeTitle">Safe</div>
            </div>
            <div class="report-stat review">
                <div class="num">${reviewNodes.length}</div>
                <div class="lbl" data-i18n="reviewTitle">Review</div>
            </div>
            <div class="report-stat risky">
                <div class="num">${riskyNodes.length}</div>
                <div class="lbl" data-i18n="riskyTitle">Risky</div>
            </div>
            <div class="report-stat dead">
                <div class="num">${deadFiles.length}</div>
                <div class="lbl" data-i18n="deadFilesTitle">Dead Files</div>
            </div>
        </div>`;

    if (safeNodes.length > 0) {
        html += `
        <div class="card" style="margin-bottom:1.25rem">
            <div class="card-header">
                <svg class="card-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <h2 style="color:var(--green)"><span data-i18n="safeTitle">Safe to Remove</span> (${safeNodes.length})</h2>
            </div>
            <div style="overflow-x:auto; padding:0 0.5rem">
                <table class="report-table">${tableHeader}<tbody>${_renderTableRows(safeNodes, 'SAFE')}</tbody></table>
            </div>
        </div>`;
    }

    if (reviewNodes.length > 0) {
        html += `
        <div class="card" style="margin-bottom:1.25rem">
            <div class="card-header">
                <svg class="card-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" /></svg>
                <h2 style="color:#D97706"><span data-i18n="reviewTitle">Needs Review</span> (${reviewNodes.length})</h2>
            </div>
            <div style="overflow-x:auto; padding:0 0.5rem">
                <table class="report-table">${tableHeader}<tbody>${_renderTableRows(reviewNodes, 'REVIEW')}</tbody></table>
            </div>
        </div>`;
    }

    if (riskyNodes.length > 0) {
        html += `
        <div class="card" style="margin-bottom:1.25rem">
            <div class="card-header">
                <svg class="card-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" /></svg>
                <h2 style="color:var(--red)"><span data-i18n="riskyTitle">Risky</span> (${riskyNodes.length})</h2>
            </div>
            <div style="overflow-x:auto; padding:0 0.5rem">
                <table class="report-table">${tableHeader}<tbody>${_renderTableRows(riskyNodes, 'RISKY')}</tbody></table>
            </div>
        </div>`;
    }

    if (deadFiles.length > 0) {
        html += `
        <div class="card" style="margin-bottom:1.25rem">
            <div class="card-header">
                <svg class="card-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" /></svg>
                <h2 style="color:#7C3AED"><span data-i18n="deadFilesTitle">Dead Files</span> (${deadFiles.length})</h2>
            </div>
            <ul class="report-file-list">
                ${deadFiles.map(f => '<li>\uD83D\uDCC4 ' + _escapeHtml(f) + '</li>').join('')}
            </ul>
        </div>`;
    }

    if (unsafeFiles.length > 0) {
        html += `
        <div class="card" style="margin-bottom:1.25rem">
            <div class="card-header">
                <svg class="card-icon" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" /></svg>
                <h2 style="color:#D97706"><span data-i18n="unsafeTitle">Dynamic Files</span> (${unsafeFiles.length})</h2>
            </div>
            <ul class="report-file-list">
                ${unsafeFiles.map(f => '<li>\u26A0\uFE0F ' + _escapeHtml(f) + '</li>').join('')}
            </ul>
        </div>`;
    }

    html += `\n    </div>`;
    return html;
}

// PXP: Pengembangan Mesin Pemetaan (Graph Builder)
