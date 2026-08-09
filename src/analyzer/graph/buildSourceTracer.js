/**
 * buildSourceTracer.js
 *
 * Modul safeguard untuk mendeteksi file sumber asli ketika pkg.main / pkg.exports
 * mengarah ke folder build artifact (dist/, build/, out/, dll.).
 *
 * Menjalankan 3 layer deteksi secara berurutan:
 *   Layer 1 — Build Tool Config Parser  (paling akurat, berbasis konfigurasi nyata)
 *   Layer 2 — TypeScript tsconfig Mapping (kebalikan outDir → rootDir)
 *   Layer 3 — Heuristic Source Inference  (exhaustive combination fallback)
 */

import fs from 'fs-extra';
import path from 'path';
import glob from 'fast-glob';

// ─────────────────────────────────────────────────────────────────────────────
// Konstanta Global
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Direktori yang dikenali sebagai output folder dari proses build/kompilasi.
 * Tambahkan entri baru di sini untuk mendukung konvensi baru.
 */
export const BUILD_ARTIFACT_DIRS = new Set([
    'dist', 'build', 'out', 'output', 'lib-cov', 'compiled',
    'release', 'bundles', 'esm', 'cjs', 'umd', 'amd',
    '.output', '.nuxt', '.next', '.svelte-kit', '.cache',
]);

/**
 * Direktori yang biasanya menjadi asal file sumber.
 * Urutan menentukan prioritas saat heuristic mencari.
 */
const SOURCE_DIRS = ['src', 'lib', 'source', 'app', 'packages', 'core', ''];

/**
 * Nama dasar file yang paling sering menjadi entry point library/CLI.
 */
const ENTRY_BASENAMES = [
    'index', 'main', 'cli', 'server', 'app',
    'mod', 'entry', 'run', 'start', 'init',
];

/**
 * Ekstensi file sumber yang didukung (TypeScript diutamakan).
 */
const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs'];

// ─────────────────────────────────────────────────────────────────────────────
// Utilitas Deteksi
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mendeteksi apakah sebuah path string mengarah ke folder build artifact.
 * @param {string} value - Nilai dari field pkg.main, pkg.module, atau pkg.exports
 * @returns {boolean}
 */
export function isBuildArtifactPath(value) {
    if (typeof value !== 'string' || !value.trim()) return false;
    const normalized = value.replace(/\\/g, '/').replace(/^\.\//, '');
    const firstSegment = normalized.split('/')[0];
    return BUILD_ARTIFACT_DIRS.has(firstSegment);
}

/**
 * Memeriksa secara rekursif apakah pkg memiliki setidaknya satu manifest field
 * yang mengarah ke build artifact folder.
 * @param {object} pkg - Objek package.json
 * @returns {boolean}
 */
export function pkgPointsToBuildArtifact(pkg) {
    const checkValue = (v) => {
        if (typeof v === 'string') return isBuildArtifactPath(v);
        if (v && typeof v === 'object') return Object.values(v).some(checkValue);
        return false;
    };
    return checkValue(pkg.main) || checkValue(pkg.module) || checkValue(pkg.exports);
}

/**
 * Mengumpulkan semua string path dari manifest fields (main, module, bin, exports).
 * @param {object} pkg
 * @returns {string[]}
 */
function collectAllManifestStringValues(pkg) {
    const values = [];
    const collect = (v) => {
        if (typeof v === 'string') { values.push(v); return; }
        if (v && typeof v === 'object') Object.values(v).forEach(collect);
    };
    if (pkg.main) collect(pkg.main);
    if (pkg.module) collect(pkg.module);
    if (pkg.exports) collect(pkg.exports);
    if (pkg.bin) collect(pkg.bin);
    return values;
}

/**
 * Me-resolve semua string manifest ke absolute path yang ada di disk.
 * @param {object} pkg
 * @param {string} projectRoot
 * @returns {string[]}
 */
function resolveAllManifestPaths(pkg, projectRoot) {
    return collectAllManifestStringValues(pkg)
        .map(v => path.resolve(projectRoot, v))
        .filter(p => {
            try { return fs.statSync(p).isFile(); } catch (_e) { return false; }
        });
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 1: Build Tool Config Parsers
// ─────────────────────────────────────────────────────────────────────────────

/** Mengekstrak string literal yang diduga merupakan path file sumber. */
function extractPathLiterals(content, projectRoot, keywords) {
    const results = new Set();
    // Cocokkan: keyword: 'value' atau keyword: "value"
    const pattern = new RegExp(
        `\\b(?:${keywords.join('|')})\\s*:\\s*['"\`]([^'"\`]+\\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs))['"\`]`,
        'gi'
    );
    for (const m of content.matchAll(pattern)) {
        const resolved = path.resolve(projectRoot, m[1]);
        if (fs.existsSync(resolved)) results.add(resolved);
    }
    // Cocokkan nilai relatif dalam object/array: { main: './src/index.ts' }
    const valueLiteralPattern = /:\s*['"`](\.{1,2}\/[^'"`\s]+\.(?:ts|tsx|mts|cts|js|jsx|mjs|cjs))['"`]/g;
    for (const m of content.matchAll(valueLiteralPattern)) {
        const resolved = path.resolve(projectRoot, m[1]);
        if (fs.existsSync(resolved)) results.add(resolved);
    }
    return [...results];
}

function parseRollupConfig(content, projectRoot) {
    return extractPathLiterals(content, projectRoot, ['input', 'entry']);
}

function parseViteConfig(content, projectRoot) {
    // Vite library mode: build.lib.entry
    return extractPathLiterals(content, projectRoot, ['entry', 'input']);
}

function parseTsupConfig(content, projectRoot) {
    return extractPathLiterals(content, projectRoot, ['entry']);
}

function parseTsdownConfig(content, projectRoot) {
    return extractPathLiterals(content, projectRoot, ['entry']);
}

function parseUnbuildConfig(content, projectRoot) {
    // unbuild: { entries: ['src/index'] }
    const results = new Set();
    const arrayPattern = /entries\s*:\s*\[([^\]]+)\]/g;
    for (const m of content.matchAll(arrayPattern)) {
        const inner = m[1];
        for (const strMatch of inner.matchAll(/['"`]([^'"`]+)['"`]/g)) {
            const candidate = strMatch[1];
            for (const ext of SOURCE_EXTENSIONS) {
                const resolved = path.resolve(projectRoot, candidate.replace(/\.[^.]+$/, '') + ext);
                if (fs.existsSync(resolved)) results.add(resolved);
            }
        }
    }
    extractPathLiterals(content, projectRoot, ['entry', 'input']).forEach(p => results.add(p));
    return [...results];
}

function parseEsbuildConfig(content, projectRoot) {
    return extractPathLiterals(content, projectRoot, ['entryPoints', 'entry', 'stdin']);
}

function parseWebpackConfig(content, projectRoot) {
    return extractPathLiterals(content, projectRoot, ['entry', 'main']);
}

/**
 * Microbundle & Parcel: membaca field "source" di package.json.
 */
function parseMicrobundleConfig(_content, projectRoot, pkg) {
    const results = [];
    const sourceField = pkg?.source;
    if (typeof sourceField === 'string') {
        const resolved = path.resolve(projectRoot, sourceField);
        if (fs.existsSync(resolved)) results.push(resolved);
    }
    return results;
}

/**
 * Registry build tool parsers.
 * Untuk menambah dukungan tool baru:
 *   1. Tambahkan entri { name, globs, parser } di sini.
 *   2. Implementasikan fungsi parser di atas.
 */
const BUILD_TOOL_PARSERS = [
    { name: 'rollup',      globs: ['rollup.config.{js,mjs,cjs,ts,mts}'],                                                   parser: parseRollupConfig      },
    { name: 'vite',        globs: ['vite.config.{js,mjs,cjs,ts,mts}'],                                                     parser: parseViteConfig        },
    { name: 'tsup',        globs: ['tsup.config.{js,mjs,cjs,ts,mts}'],                                                     parser: parseTsupConfig        },
    { name: 'tsdown',      globs: ['tsdown.config.{js,mjs,cjs,ts,mts}'],                                                   parser: parseTsdownConfig      },
    { name: 'unbuild',     globs: ['build.config.{js,mjs,ts}'],                                                            parser: parseUnbuildConfig     },
    { name: 'esbuild',     globs: ['esbuild.config.{js,mjs,ts}', 'scripts/build.{js,mjs,ts,cjs}', 'scripts/bundle.{js,mjs,ts,cjs}', 'build.{js,mjs,cjs}'], parser: parseEsbuildConfig },
    { name: 'webpack',     globs: ['webpack.config.{js,mjs,cjs,ts}', 'webpack.common.js', 'webpack.prod.js', 'webpack.dev.js'], parser: parseWebpackConfig },
    { name: 'microbundle', globs: ['package.json'],                                                                        parser: parseMicrobundleConfig },
];

/**
 * Menjalankan semua parser build tool yang relevan untuk proyek ini.
 * @param {string} projectRoot
 * @param {object} pkg
 * @returns {Promise<string[]>}
 */
async function traceViaBuildToolConfigs(projectRoot, pkg) {
    const found = new Set();

    for (const { name, globs, parser } of BUILD_TOOL_PARSERS) {
        for (const pattern of globs) {
            const matches = glob.sync(pattern, {
                cwd: projectRoot,
                absolute: true,
                onlyFiles: true,
                followSymbolicLinks: false,
            });
            for (const filePath of matches) {
                try {
                    const content = await fs.readFile(filePath, 'utf-8');
                    const sources = parser(content, projectRoot, pkg);
                    sources.forEach(s => found.add(s));
                    if (process.env.DEBUG && sources.length > 0) {
                        console.log(`[buildSourceTracer] Layer 1 (${name}): ${sources.join(', ')}`);
                    }
                } catch (_e) { /* Abaikan file yang gagal dibaca */ }
            }
        }
    }

    return [...found];
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 2: TypeScript tsconfig.json Reverse Mapping
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Menggunakan outDir dan rootDir dari tsconfig untuk menghitung kebalikan path:
 * dist/index.js → src/index.ts
 * @param {string} projectRoot
 * @param {string[]} artifactPaths - Absolute paths ke file artifact
 * @returns {Promise<string[]>}
 */
async function traceViaTypescript(projectRoot, artifactPaths) {
    const tsconfigCandidates = [
        'tsconfig.json',
        'tsconfig.build.json',
        'tsconfig.app.json',
        'tsconfig.lib.json',
    ];

    for (const name of tsconfigCandidates) {
        const cfgPath = path.join(projectRoot, name);
        if (!await fs.pathExists(cfgPath)) continue;

        let cfg;
        try {
            cfg = await fs.readJson(cfgPath);
        } catch (_e) { continue; }

        const rawOutDir = cfg?.compilerOptions?.outDir;
        const rawRootDir = cfg?.compilerOptions?.rootDir || 'src';
        if (!rawOutDir) continue;

        // Normalisasi: hapus ./ dan trailing slash
        const outDir = rawOutDir.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
        const rootDir = rawRootDir.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');

        const results = new Set();
        for (const artifactPath of artifactPaths) {
            const relative = path.relative(projectRoot, artifactPath).replace(/\\/g, '/');
            if (!relative.startsWith(outDir + '/') && relative !== outDir) continue;

            const withinOut = relative.slice(outDir.length + 1);
            const baseName = withinOut.replace(/\.[^.]+$/, ''); // buang ekstensi

            for (const ext of SOURCE_EXTENSIONS) {
                const candidate = path.join(projectRoot, rootDir, baseName + ext);
                if (fs.existsSync(candidate)) {
                    results.add(candidate);
                    if (process.env.DEBUG) {
                        console.log(`[buildSourceTracer] Layer 2 (tsconfig ${name}): ${relative} → ${path.relative(projectRoot, candidate)}`);
                    }
                }
            }
        }

        if (results.size > 0) return [...results];
    }

    return [];
}

// ─────────────────────────────────────────────────────────────────────────────
// Layer 3: Heuristic Source Inference
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mencari semua kandidat file sumber berdasarkan kombinasi exhaustive dari:
 * nama file artifact × source dir × ekstensi.
 * @param {string} projectRoot
 * @param {object} pkg
 * @returns {string[]}
 */
function traceViaHeuristics(projectRoot, pkg) {
    const results = new Set();
    const manifestValues = collectAllManifestStringValues(pkg)
        .filter(isBuildArtifactPath);

    for (const val of manifestValues) {
        const rawPath = val.replace(/\\/g, '/').replace(/^\.\//, '');
        const parts = rawPath.split('/');
        // Buang folder artifact pertama (dist/, build/, dll.)
        const restPath = parts.slice(1).join('/');
        const baseName = path.basename(restPath, path.extname(restPath));

        for (const sourceDir of SOURCE_DIRS) {
            const candidates = new Set();

            // Kandidat 1: pertahankan struktur subdirektori lengkap dari artifact
            if (restPath) {
                const noExt = restPath.replace(/\.[^.]+$/, '');
                candidates.add(sourceDir ? `${sourceDir}/${noExt}` : noExt);
            }
            // Kandidat 2: hanya nama file (tanpa subdir dari artifact)
            if (baseName) {
                candidates.add(sourceDir ? `${sourceDir}/${baseName}` : baseName);
            }
            // Kandidat 3: nama file konvensional umum
            for (const base of ENTRY_BASENAMES) {
                candidates.add(sourceDir ? `${sourceDir}/${base}` : base);
            }

            for (const candidate of candidates) {
                for (const ext of SOURCE_EXTENSIONS) {
                    const filePath = path.resolve(projectRoot, candidate + ext);
                    if (fs.existsSync(filePath)) {
                        results.add(filePath);
                        if (process.env.DEBUG) {
                            console.log(`[buildSourceTracer] Layer 3 (heuristic): ${val} → ${path.relative(projectRoot, filePath)}`);
                        }
                    }
                }
            }
        }
    }

    return [...results];
}

// ─────────────────────────────────────────────────────────────────────────────
// Fungsi Utama yang Diekspor
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mencari semua file sumber asli dari proyek yang manifest-nya mengarah ke
 * build artifact. Menjalankan 3 layer deteksi secara berurutan dan mengembalikan
 * hasil dari layer pertama yang berhasil menemukan file.
 *
 * Jika pkg tidak mengarah ke build artifact, langsung mengembalikan { sources: [], layer: 'none' }.
 *
 * @param {string} projectRoot - Absolute path root proyek
 * @param {object} pkg - Parsed package.json object
 * @returns {Promise<{ sources: string[], layer: string }>}
 */
export async function traceBuildSources(projectRoot, pkg) {
    if (!pkgPointsToBuildArtifact(pkg)) {
        return { sources: [], layer: 'none' };
    }

    const artifactPaths = resolveAllManifestPaths(pkg, projectRoot)
        .filter(p => isBuildArtifactPath(path.relative(projectRoot, p).replace(/\\/g, '/')));

    // Layer 1: Build tool config — paling akurat
    const fromBuildTool = await traceViaBuildToolConfigs(projectRoot, pkg);
    if (fromBuildTool.length > 0) {
        return { sources: fromBuildTool, layer: 'build-tool-config' };
    }

    // Layer 2: TypeScript reverse mapping
    const fromTypescript = await traceViaTypescript(projectRoot, artifactPaths);
    if (fromTypescript.length > 0) {
        return { sources: fromTypescript, layer: 'tsconfig-mapping' };
    }

    // Layer 3: Heuristic exhaustive
    const fromHeuristic = traceViaHeuristics(projectRoot, pkg);
    return {
        sources: fromHeuristic,
        layer: fromHeuristic.length > 0 ? 'heuristic' : 'none',
    };
}
