import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Menghasilkan Dashboard HTML interaktif dengan vis.js Network, kartu dependensi,
 * dukungan bilingual (Indonesia / English), dan logo terintegrasi Base64.
 * @param {object} graph   - { liveFiles: Set<string>, usedPackages: Set<string>, edges: Array }
 * @param {string} rootDir - Direktori akar proyek untuk path relatif
 * @param {object} pkgData - Data package.json (dependencies, devDependencies)
 * @returns {string} String HTML siap buka di browser
 */
export function generateMermaidGraph(graph, rootDir, pkgData = { dependencies: {}, devDependencies: {} }) {

    // === Baca Logo (encode Base64 agar HTML mandiri) ===
    let logoImgHtml = '';
    const logoPath = path.resolve(__dirname, '../ui/Logo.png');
    if (fs.existsSync(logoPath)) {
        try {
            const logoBase64 = `data:image/png;base64,${fs.readFileSync(logoPath).toString('base64')}`;
            logoImgHtml = `<img src="${logoBase64}" alt="Logo" class="header-logo">`;
        } catch(e) { /* fallback tanpa logo */ }
    }

    // === 1. Siapkan Data untuk vis.js ===
    const validFiles = Array.from(graph.liveFiles)
        .filter(f => !f.includes('node_modules'))
        .sort();

    // Tentukan warna unik per direktori
    const PALETTE = [
        '#3B82F6', '#8B5CF6', '#059669', '#DC2626', '#D97706',
        '#0891B2', '#BE185D', '#65A30D', '#7C3AED', '#0284C7'
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

    // Build nodes array
    const nodeIndex = new Map(); // filePath -> id
    const visNodes = validFiles.map((file, i) => {
        nodeIndex.set(file, i);
        const dir = getDirName(file);
        const color = dirColorMap[dir];
        const label = getFileName(file);
        const relPath = getRelPath(file);

        return {
            id: i,
            label,
            title: relPath, // tooltip
            group: dir,
            color: {
                background: color + '18', // 10% opacity fill
                border: color,
                highlight: { background: color + '30', border: color },
                hover: { background: color + '25', border: color }
            },
            font: { color: '#0F172A', size: 13, face: 'Inter, system-ui, sans-serif', bold: { vadjust: 0 } },
            borderWidth: 2,
            borderWidthSelected: 3,
            shape: 'box',
            margin: { top: 8, right: 14, bottom: 8, left: 14 },
            shadow: { enabled: true, color: 'rgba(0,0,0,0.08)', size: 6, x: 0, y: 2 }
        };
    });

    // Build edges array
    const visEdges = [];
    if (graph.edges) {
        graph.edges.forEach(edge => {
            if (edge.from.includes('node_modules') || edge.to.includes('node_modules')) return;
            const fromId = nodeIndex.get(edge.from);
            const toId   = nodeIndex.get(edge.to);
            if (fromId === undefined || toId === undefined) return;

            const names = (edge.names || []).filter(n => n && n !== '*');
            const labelText = names.slice(0, 2).join(', ');

            visEdges.push({
                from: fromId,
                to: toId,
                label: labelText || undefined,
                font: { size: 11, color: '#64748B', face: 'Inter, monospace', align: 'middle', background: '#FFFFFF' },
                arrows: { to: { enabled: true, scaleFactor: 0.7, type: 'arrow' } },
                color: { color: '#94A3B8', highlight: '#3B82F6', hover: '#3B82F6', opacity: 0.85 },
                width: 1.5,
                smooth: { type: 'cubicBezier', forceDirection: 'vertical', roundness: 0.4 },
                shadow: false
            });
        });
    }

    // === 2. Statistik ===
    const totalEdges  = visEdges.length;
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
            tipZoom:     'Scroll untuk zoom · Drag node untuk pindah · Klik untuk sorot'
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
            tipZoom:     'Scroll to zoom · Drag nodes to move · Click to highlight'
        }
    });

    // === 6. Data JSON untuk vis.js ===
    const nodesJson = JSON.stringify(visNodes);
    const edgesJson = JSON.stringify(visEdges);

    return `<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Code Structure Traceability | DeadKiller</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">

    <!-- vis.js Network -->
    <script src="https://cdn.jsdelivr.net/npm/vis-network@9.1.9/standalone/umd/vis-network.min.js"></script>

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

        window.addEventListener('DOMContentLoaded', () => {
            applyLang(currentLang);
            initGraph();
        });

        function initGraph() {
            const container = document.getElementById('vis-network');
            const nodes = new vis.DataSet(${nodesJson});
            const edges = new vis.DataSet(${edgesJson});

            const options = {
                layout: {
                    hierarchical: {
                        enabled: true,
                        direction: 'UD',           // Up-Down (lebih rapi untuk dep graph)
                        sortMethod: 'directed',    // Ikuti arah panah
                        levelSeparation: 90,       // Jarak antar tingkat
                        nodeSpacing: 160,          // Jarak antar node (cegah tabrakan)
                        treeSpacing: 200,          // Jarak antar pohon terpisah
                        blockShifting: true,
                        edgeMinimization: true,
                        parentCentralization: true
                    }
                },
                physics: { enabled: false }, // Matikan fisika saat pakai hierarchical
                interaction: {
                    hover: true,
                    tooltipDelay: 100,
                    navigationButtons: true,
                    keyboard: { enabled: true },
                    zoomView: true,
                    dragView: true,
                    dragNodes: false // Matikan drag node agar layout tetap rapi
                },
                nodes: {
                    widthConstraint: { minimum: 80, maximum: 200 },
                    heightConstraint: { minimum: 32 }
                },
                edges: {
                    smooth: { type: 'cubicBezier', forceDirection: 'vertical', roundness: 0.35 }
                }
            };

            const network = new vis.Network(container, { nodes, edges }, options);

            // Highlight tetangga saat klik node
            network.on('click', function(params) {
                if (params.nodes.length === 0) {
                    nodes.forEach(n => nodes.update({ id: n.id, opacity: 1 }));
                    edges.forEach(e => edges.update({ id: e.id, color: { opacity: 0.85 } }));
                    return;
                }
                const selectedId = params.nodes[0];
                const connected  = new Set(network.getConnectedNodes(selectedId));
                connected.add(selectedId);
                nodes.forEach(n => nodes.update({ id: n.id, opacity: connected.has(n.id) ? 1 : 0.15 }));
                edges.forEach(e => {
                    const active = connected.has(e.from) && connected.has(e.to);
                    edges.update({ id: e.id, color: { opacity: active ? 1 : 0.05 } });
                });
            });

            // Tombol kontrol
            document.getElementById('btn-fit').addEventListener('click', () => network.fit({ animation: { duration: 400, easingFunction: 'easeInOutQuad' } }));
            document.getElementById('btn-zoom-in').addEventListener('click',  () => network.moveTo({ scale: network.getScale() * 1.25, animation: true }));
            document.getElementById('btn-zoom-out').addEventListener('click', () => network.moveTo({ scale: network.getScale() * 0.8,  animation: true }));
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

        /* vis.js Network Panel */
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

        #vis-network {
            width: 100%; height: 550px;
            background: var(--surface-2);
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

        /* vis.js navigation button override */
        .vis-navigation .vis-button { background-color: var(--surface) !important; border: 1px solid var(--border) !important; border-radius: 6px !important; box-shadow: var(--shadow) !important; }
    </style>
</head>
<body>

    <!-- Language Switcher -->
    <div class="topbar">
        <div class="lang-switcher">
            <button class="lang-btn" data-lang="id" onclick="applyLang('id')">ID</button>
            <button class="lang-btn" data-lang="en" onclick="applyLang('en')">EN</button>
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
            <div id="vis-network"></div>
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

</body>
</html>
`;
}
