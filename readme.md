# DeadKiller CLI

DeadKiller is an advanced Command Line Interface (CLI) tool designed to perform deep static analysis on JavaScript and TypeScript source code. Developed as a final year thesis project, it leverages Graph-Based Reachability Analysis to accurately map project structures, detecting unreachable files, dead code (unused variables, functions, etc.), and unused direct dependencies.

It features a Confidence Scoring System and Safety Classification to ensure that all findings are accurately categorized, along with an HTML Dashboard and Git-style diff viewing for a secure and professional developer experience.

## Core Features

- **Graph-Based Reachability**: Constructs a dependency graph from entry points using Breadth-First Search (BFS) to distinguish between live and dead files.
- **Intra-procedural Dead Code Detection**: Detects unused variables, functions, parameters, and unreachable statements within their respective scopes.
- **Unused Direct Dependency Detection**: Reports direct packages declared in the target project's root `package.json` that are not detected in source code, scripts, or supported configuration files. Transitive dependency trees are outside the analysis scope.
- **Confidence & Safety System**: Automatically labels source-code findings with confidence levels (High/Medium/Low) and safety statuses (Safe/Review/Risky). Dependency findings remain review candidates.
- **Interactive Diff Preview**: Provides a Git-style before-and-after preview prior to any code deletion.
- **HTML Dashboard Visualization**: Generates an interactive graph using Cytoscape.js and Dagre layout for deep architectural inspection.
- **Safe Mode Execution**: Protected exports, automatic backups, and interactive confirmation. Only source-code items marked as `safe` are eligible for automatic remediation. Runtime dependency candidates are unselected by default and require explicit review, selection, and final confirmation; development dependency findings are report-only.
- **Framework-Aware**: Supports native detection for `vanilla`, `react`, and `next` frameworks, automatically protecting critical framework directories.

## Installation

Requires Node.js 20 or newer.

Clone this repository and install dependencies:

```bash
git clone https://github.com/Dwirifan/Dead-code-and-Unsed-Dependecy.git
cd Dead-code-and-Unsed-Dependecy
npm install
```

To install the CLI globally on your system:
```bash
npm install -g deadkiller-cli
```
*Note: If installed locally, you can use `npm link` to make the `deadkiller` command available globally.*

## Usage

DeadKiller provides both an Interactive Wizard and direct CLI commands.

### Interactive Wizard (Recommended)
Launch the interactive menu to be guided through all available features:
```bash
deadkiller
```

### Direct CLI Commands

**1. Scan (Dry Run)**
Audits the project and outputs dead code plus findings for direct runtime and development dependencies without modifying any files. Development dependency findings are report-only.
```bash
deadkiller scan <path>
# Output in JSON format for CI/CD integration:
deadkiller scan <path> --json
```

**2. Fix (Interactive Deletion)**
Detects dead code, displays a diff preview, and requests confirmation before deletion. Only `safe` source-code items are processed automatically. A direct runtime dependency is never preselected for removal: it must be reviewed, explicitly selected, and approved in the final confirmation. Development dependencies are not removed by this command.
```bash
deadkiller fix <path>
```

**3. Show Dependencies**
Analyzes direct runtime and development dependencies declared in the target project's root `package.json`, including `USED`, `REVIEW`, and `UNKNOWN` states. `devDependencies` are report-only and are never offered for removal; transitive dependencies are not analyzed.
```bash
deadkiller show-deps <path>
```

**4. Visualize / Report**
Generates an interactive HTML dashboard containing the dependency graph and the complete dead code report.
```bash
deadkiller visualize <path>
# or
deadkiller report <path>
```

**5. Trace (Reverse Import)**
Traces module imports to answer which files depend on a specific target file.
```bash
deadkiller trace <file_path>
```

**6. Watch Mode**
Monitors the directory for file changes and automatically triggers a scan upon saving.
```bash
deadkiller watch <path>
```

**7. History**
Displays backup history created by the `fix` command and allows restoration of previous states.
```bash
deadkiller history <path>
```

## Setup & Configuration

The easiest way to set up DeadKiller in your project is by using the interactive initialization command. It will scan your project and generate the appropriate configuration file.

```bash
deadkiller init
```

`init` mendeteksi bahasa (JavaScript/TypeScript/campuran), module system
(ESM/CommonJS/campuran), framework, jenis proyek, package manager, workspace,
serta entry runtime/test/config. Tekan Enter sekali untuk memakai rekomendasi.

Untuk setup otomatis tanpa prompt (cocok untuk CI, template, dan monorepo):

```bash
deadkiller init --yes
deadkiller init ./packages/api --yes --format json
deadkiller init --yes --entry src/worker.ts scripts/migrate.mts
deadkiller init --dry-run --yes
```

Gunakan `--force` untuk mengganti konfigurasi lama. DeadKiller membuat backup di
`.deadkiller_backup/config-init/` dan memastikan hanya satu format konfigurasi
yang aktif agar tidak terjadi konflik precedence.

This command allows you to choose between two configuration formats:
- **JavaScript Dinamis (`deadkiller.config.mjs`)** - Mendukung konfigurasi dinamis tanpa bergantung pada tipe modul proyek (opsi disarankan).
- **JSON Statis (`.deadkillerrc.json`)**

### Configuration Options

Berikut adalah contoh konfigurasi penuh yang dihasilkan:

```javascript
// deadkiller.config.mjs
export default {
    mode: "react",
    entryPoints: [], // Disarankan: runtime, test runner, dan config dideteksi otomatis
    ignorePrefixedVariables: "^_",
    preserveExports: true,
    preserveFiles: ["test/**", "tests/**", "__tests__/**", "**/*.test.*", "**/*.spec.*"],
    ignoreFiles: ["**/dist/**", "**/build/**", "**/coverage/**"],
    ignoreDependencies: [],
    globals: [],
    overrides: [
        {
            files: ["**/*.test.js", "tests/**/*.js"],
            preserveExports: true
        }
    ]
};
```

- **mode**: Framework mode (`vanilla`, `react`, `next`, `vue`).
- **entryPoints**: Root untuk membangun graph. **Secara default, DeadKiller mendeteksi entry point secara otomatis** dari `package.json` (`main`, `module`, `exports`, `bin`, `workspaces`), struktur framework, file konfigurasi, dan pola test ketika test runner seperti Mocha, Vitest, atau Jest terdeteksi. Isi manual hanya untuk root khusus yang tidak mengikuti konvensi.
- **ignorePrefixedVariables**: Regex untuk mengabaikan variabel tak terpakai spesifik (contoh: `^_` mengabaikan `_unusedVar`).
- **preserveExports**: Atur ke `true` jika proyek adalah Library/NPM Package publik agar semua exported functions aman dari penghapusan. Atur ke `false` untuk aplikasi web biasa.
- **preserveFiles**: File tetap dibaca untuk graph dan bukti dependency, tetapi dilindungi dari penghapusan. Gunakan ini untuk test dan example.
- **ignoreFiles**: File tidak dibaca sama sekali, termasuk import dependency di dalamnya. Gunakan hanya untuk output generator seperti `dist`, `build`, dan `coverage`; jangan menaruh folder test di sini.
- **overrides**: Aturan khusus untuk pola file tertentu. Setup default hanya melindungi export test; unused variable di dalam test tetap dianalisis. Tambahkan `ignorePrefixedVariables` sendiri hanya jika proyek memang membutuhkannya.

DeadKiller memvalidasi konfigurasi sebelum analisis. Tipe, regex, mode, glob,
opsi tak dikenal, konflik beberapa file config, atau override yang invalid akan
menghentikan `scan`/`fix` dengan error yang jelas;
DeadKiller tidak diam-diam kembali ke default karena itu dapat menonaktifkan aturan
perlindungan. Warning normalisasi tersedia pada output manusia dan pada field
`config.diagnostics` di output `scan --json`.

Ekstensi script yang dianalisis secara konsisten adalah `.js`, `.jsx`, `.mjs`,
`.cjs`, `.ts`, `.tsx`, `.mts`, dan `.cts`.

### Entry Point, Preserve, dan Ignore

```text
entryPoints    -> membuat file menjadi root graph dan membaca dependency
preserveFiles  -> tetap dianalisis, tetapi tidak boleh dieliminasi
ignoreFiles    -> dikeluarkan sepenuhnya dari analisis
```

Contoh: test Mocha tidak diimpor oleh aplikasi, tetapi merupakan root eksekusi
tersendiri. Ketika `mocha` terdeteksi dari dependency atau script `test`,
DeadKiller otomatis memasukkan `test/**/*` ke graph. Dengan demikian package
seperti `chai-http` yang hanya digunakan oleh test tidak salah dilaporkan mati.

## Confidence and Safety Classification

To ensure code stability, DeadKiller categorizes all findings into two dimensions:

**Confidence Level:**
- **High**: >99% certainty of being unused (e.g., unused local variables, unreachable statements).
- **Medium**: High probability of being unused, but may have side effects.
- **Low**: Potential false positives (e.g., unused class methods, parameters).

**Safety Status:**
- **Safe**: Completely safe to remove. Eligible for auto-fix.
- **Review**: Requires manual developer review. Will not be auto-fixed.
- **Risky**: High risk of breaking changes (e.g., callbacks, polymorphic methods). Will not be auto-fixed.

## License

MIT License
