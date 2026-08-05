# DeadKiller CLI

[![npm version](https://img.shields.io/npm/v/deadkiller-cli?color=cb3837&logo=npm)](https://www.npmjs.com/package/deadkiller-cli)
[![npm downloads](https://img.shields.io/npm/dm/deadkiller-cli?color=blue)](https://www.npmjs.com/package/deadkiller-cli)
[![Node.js](https://img.shields.io/node/v/deadkiller-cli?logo=node.js)](https://www.npmjs.com/package/deadkiller-cli)
[![License: MIT](https://img.shields.io/github/license/Dwirifan/Dead-code-and-Unsed-Dependecy)](./LICENSE)

**Safety-first dead-code and unused-dependency analysis for JavaScript and TypeScript projects.**

DeadKiller builds a project dependency graph, analyzes source-code usage, classifies findings by confidence and risk, and provides guarded remediation with diff previews, checkpoints, and restore support.

It can be used interactively during development or as structured JSON analysis in CI.

> [!IMPORTANT]
> DeadKiller is a static-analysis tool. Dynamic imports, reflection, framework conventions, callbacks, generated code, and runtime dependency loading can limit what any static analyzer can prove. Review findings, inspect the diff, run your test suite, and keep source control enabled before applying changes.

## Highlights

- **Project-wide reachability analysis** — builds a graph from detected or configured entry points to identify live and unconnected files.
- **JavaScript and TypeScript analysis** — supports `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, and `.cts`.
- **Dead-code detection** — reports unused bindings, functions, imports, types, classes, dead stores, unreachable statements, and selected structural issues.
- **Direct dependency audit** — analyzes runtime and development dependencies declared in the project-root `package.json`.
- **Confidence and safety classification** — separates `SAFE`, `REVIEW`, `RISKY`, and protected findings.
- **Guarded remediation** — previews changes, requires confirmation, creates checkpoints, validates transformed syntax, and supports restore.
- **Framework-aware defaults** — detects project type, module system, JSX runtime, and common framework conventions.
- **CI-friendly output** — emits versioned JSON and supports category-based exit policies.
- **Interactive visualization** — generates an HTML dashboard for dependency and dead-code exploration.

## Requirements

- Node.js **20 or newer**
- A JavaScript or TypeScript project
- A supported package manager when removing dependencies: npm, Yarn, pnpm, or Bun

## Installation

Install DeadKiller globally:

```bash
npm install --global deadkiller-cli
```

Or install it as a development dependency:

```bash
npm install --save-dev deadkiller-cli
```

When installed locally, run the binary through `npx`:

```bash
npx deadkiller scan .
```

Verify the installation:

```bash
deadkiller --version
deadkiller --help
```

## Quick start

Start with a read-only scan:

```bash
deadkiller scan .
```

Show advanced `REVIEW` and `RISKY` findings:

```bash
deadkiller scan . --advanced
```

Preview remediation without writing files or creating a checkpoint:

```bash
deadkiller fix . --level 0
```

Apply reviewed changes interactively:

```bash
deadkiller fix .
```

Restore the latest checkpoint if necessary:

```bash
deadkiller undo . --latest
```

Running `deadkiller` without a command opens the interactive wizard.

## Commands

| Command | Purpose |
| --- | --- |
| `deadkiller` | Open the interactive wizard. |
| `deadkiller init [path]` | Detect the project profile and create a validated configuration. |
| `deadkiller scan <path>` | Analyze a file or directory without modifying it. |
| `deadkiller fix <path>` | Preview and apply guarded source, file, and selected dependency changes. |
| `deadkiller show-deps <path>` | Report direct runtime and development dependency status. |
| `deadkiller visualize <path>` | Generate and optionally open the HTML dashboard. |
| `deadkiller report <path>` | Alias for `visualize`. |
| `deadkiller trace <file>` | Show reverse imports for a file. |
| `deadkiller watch <path>` | Re-run source analysis when supported files change. |
| `deadkiller history <path>` | Inspect, restore, or delete stored checkpoints. |
| `deadkiller undo [path]` | Restore a checkpoint; alias: `restore`. |

Use `deadkiller <command> --help` for the complete option list.

### Initialize configuration

DeadKiller works without a configuration file. Use `init` when you need persistent entry points or customized safety rules.

```bash
deadkiller init
deadkiller init ./packages/api --yes --format json
deadkiller init --yes --entry src/worker.ts scripts/migrate.mts
deadkiller init --dry-run --yes
```

Common options:

| Option | Description |
| --- | --- |
| `-y, --yes` | Accept detected recommendations without prompts. |
| `-f, --force` | Replace an existing config after creating a backup. |
| `--format <mjs\|json>` | Choose `deadkiller.config.mjs` or `.deadkillerrc.json`. |
| `--mode <mode>` | Select `vanilla`, `react`, `next`, or `vue`. |
| `--project-type <type>` | Select `application`, `library`, `cli`, or `monorepo`. |
| `-e, --entry <paths...>` | Add one or more entry paths or globs. |
| `--no-entry-review` | Accept every detected entry point. |
| `--dry-run` | Print the generated config without writing it. |

### Scan

`scan` is read-only and is the recommended first step.

```bash
deadkiller scan .
deadkiller scan src/index.ts
deadkiller scan . --advanced
deadkiller scan . --json
deadkiller scan . --json --no-config
deadkiller scan . --json --fail-on safe,dependency
```

| Option | Description |
| --- | --- |
| `--json` | Write one structured JSON document to standard output. |
| `--no-config` | Ignore target-project config and use the in-memory automatic profile. |
| `-a, --advanced` | Display `REVIEW`, `RISKY`, and advanced AST findings. |
| `--fail-on <categories>` | Exit with code `2` when selected categories are found. |

Valid `--fail-on` categories are `safe`, `review`, `risky`, `dependency`, `dead-file`, and `any`.

### Fix

`fix` analyzes the target, displays proposed changes, and creates a checkpoint before writing. Runtime dependencies are never preselected: they require explicit selection and final confirmation. Development dependencies remain report-only.

```bash
deadkiller fix . --level 0
deadkiller fix . --level 2
deadkiller fix src/example.ts
```

| Option | Description |
| --- | --- |
| `-l, --level <number>` | Select elimination level `0` through `3`. Default: `3`. |
| `-y, --yes` | Skip confirmation for eligible source changes; dependency `REVIEW` items remain unselected. |

Elimination levels control the source transformation strategy:

| Level | Profile | Behavior |
| ---: | --- | --- |
| `0` | Preview | Generate the proposed diff without writing files or creating a checkpoint. |
| `1` | Safe Skip | Use the most conservative transformation profile. |
| `2` | Safe Refactor | Apply safe structural refactoring while preserving sensitive signatures. |
| `3` | Aggressive Delete | Use the broadest transformation profile for eligible findings. |

The elimination level does **not** promote `REVIEW` or `RISKY` source findings to automatic fixes. Only eligible `SAFE` findings are processed automatically; protected files and dynamic-code safeguards still take precedence.

### Dependency report

```bash
deadkiller show-deps .
```

The report distinguishes:

- `USED` — a reference was found;
- `REVIEW` — no supported reference was found, but manual review is required;
- `UNKNOWN` — analysis was incomplete or a dynamic/unsupported pattern prevented a reliable conclusion;
- `PROTECTED` — the dependency is excluded by configuration.

Only direct dependencies from the target project's root manifest are analyzed. Transitive dependency trees are outside the current scope.

### Dashboard and tracing

```bash
deadkiller visualize .
deadkiller visualize . --no-open
deadkiller report . --no-open
deadkiller trace src/services/userService.ts
```

`visualize` and `report` generate an HTML dashboard. `trace` reports files that import the selected target and the imports made by that target.

### Watch mode

```bash
deadkiller watch .
```

Watch mode performs an initial scan and re-analyzes supported source files after changes. It is intended for development feedback and does not modify files.

### Checkpoints and restore

Every non-dry-run fix requires a successful checkpoint before source changes are written.

```bash
deadkiller history .
deadkiller undo .
deadkiller undo . --latest
deadkiller restore . --latest --yes
```

Checkpoints are stored under `.deadkiller_backup`. `history` provides interactive management, while `undo`/`restore` performs recovery. A successfully restored checkpoint is removed after restoration.

## Safety model

DeadKiller separates confidence from actionability.

### Confidence

| Confidence | Meaning |
| --- | --- |
| `high` | Strong static evidence that the item is unused or unreachable. |
| `medium` | Likely unused, but side effects or incomplete context require review. |
| `low` | Runtime, framework, callback, inheritance, or API behavior may be involved. |

### Status

| Status | Automatic action |
| --- | --- |
| `SAFE` | Eligible for guarded remediation. |
| `REVIEW` | Reported for explicit developer review; not automatically fixed. |
| `RISKY` | Reported as high risk; not automatically fixed. |
| `PROTECTED` | Analyzed for evidence but blocked from remediation. |

Additional safeguards include:

- entry-point and cross-file reachability analysis;
- explicit module-graph completeness (`complete`, `partial`, or `unknown`) with fail-closed classification;
- positional-parameter anomaly reporting when an unused parameter must remain to preserve a later argument position;
- public export preservation based on project profile;
- conservative fallback for dynamic code;
- protected and ignored file policies;
- diff preview and final confirmation;
- AST syntax validation after transformation;
- checkpoint creation and rollback support;
- explicit dependency selection.

## Configuration

DeadKiller accepts one active configuration file in the project root:

- `deadkiller.config.mjs` — recommended dynamic ESM configuration;
- `deadkiller.config.js` — legacy JavaScript configuration;
- `.deadkillerrc.json` — static JSON configuration.

If more than one is present, validation stops with a conflict error. JavaScript configuration files execute as Node.js modules; use `.deadkillerrc.json` or `scan --no-config` when analyzing an untrusted repository.

Example:

```javascript
// deadkiller.config.mjs
export default {
    mode: 'react',
    framework: 'react',
    entryPoints: ['src/main.tsx'],
    reactRuntime: 'automatic',
    ignorePrefixedVariables: '^_',
    reportPositionalParameters: true,
    preserveExports: true,
    preserveUnsafeFiles: true,
    detectDeadStores: true,
    preserveFiles: ['examples/**', '**/fixtures/**'],
    ignoreFiles: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/coverage/**',
        '**/.deadkiller_backup/**'
    ],
    ignoreDependencies: [],
    globals: [],
    eliminator: {
        autoRenameUnusedParameters: false,
        autoRemoveEmptyBlocks: false,
        maxBackups: 20
    },
    overrides: [
        {
            files: ['**/*.{test,spec}.{js,jsx,ts,tsx}'],
            preserveExports: true
        }
    ]
};
```

### Core options

| Option | Purpose |
| --- | --- |
| `mode` | Analyzer mode: `vanilla`, `react`, `next`, or `vue`. |
| `framework` | Framework preset used for convention-aware protection. |
| `entryPoints` | Runtime roots or globs used to build the dependency graph. |
| `reactRuntime` | JSX runtime: `classic` or `automatic`. |
| `ignorePrefixedVariables` | Regex for intentionally unused names; set `false` or `null` to disable. |
| `reportPositionalParameters` | Report unused positional placeholders as `RISKY`; set `false` to suppress them. |
| `preserveExports` | Preserve public exports with `true`; use `false` or `strict` for cross-file checking. |
| `preserveUnsafeFiles` | Protect files affected by dynamic-analysis uncertainty. |
| `detectDeadStores` | Enable dead-store detection. |
| `preserveFiles` | Analyze files and use them as dependency evidence, but block remediation. |
| `ignoreFiles` | Exclude files entirely from analysis and dependency evidence. |
| `ignoreDependencies` | Exclude named packages from unused-dependency reporting. |
| `globals` | Declare project-specific global identifiers. |
| `eliminator` | Configure parameter renaming, empty-block handling, and checkpoint retention. |
| `overrides` | Apply ordered per-file rule overrides using glob patterns. |

`reportPositionalParameters` is enabled in zero-config mode and takes precedence over
`ignorePrefixedVariables` for positional placeholders. For example, `_` in
`(_, p1, p2) => p1 + p2` is still reported because removing it would shift both
capture-group arguments. The finding remains `RISKY`, appears in `--advanced` and
JSON output, and is not automatically deleted. Disable the report globally or in a
file override only when that convention is intentional.

Configuration precedence is:

```text
built-in defaults
  -> automatic project profile
  -> user configuration
  -> ordered per-file overrides
  -> command-line policy
```

Invalid types, regular expressions, globs, unknown keys, conflicting config files, and unsupported override fields stop analysis instead of silently falling back to unsafe defaults.

### Entry points, preserved files, and ignored files

```text
entryPoints   -> graph roots; files are analyzed as executable entry paths
preserveFiles -> files remain analysis evidence but cannot be remediated
ignoreFiles   -> files are excluded from analysis and dependency evidence
```

Use `preserveFiles` for examples, fixtures, and externally invoked source that should still contribute imports. Reserve `ignoreFiles` for generated output such as `dist`, `build`, and `coverage`.

## CI integration

Generate a stable, versioned JSON report:

```bash
deadkiller scan . --json > deadkiller-report.json
```

Enforce selected categories:

```bash
deadkiller scan . --json --fail-on safe,dependency
```

The JSON document includes `schemaVersion`, normalized portable paths, `summary`, configuration diagnostics, dependency-analysis completeness, dead files, source findings, import-resolution issues, cycles, and the applied CI policy.

Directory reports also expose `graphAnalysis`. If an import cannot be resolved, a
reachable file cannot be parsed, or dynamic code makes traversal incomplete, the
graph becomes `partial`. Findings that require cross-file proof are downgraded from
`SAFE` to `REVIEW`, and unreachable-file deletion is blocked. Local findings whose
proof is entirely intra-file may remain `SAFE`.

Module resolution is importer-aware. DeadKiller searches for the nearest
`tsconfig.json` or `jsconfig.json`, follows `extends` and project references, and
uses TypeScript-compatible `baseUrl`/`paths` matching. This supports wildcard
patterns with prefixes and suffixes, ordered fallback targets, implicit TypeScript
extensions, and output-to-source substitutions such as `.js` to `.ts` or `.tsx`.
Resolver instances are cached per effective configuration rather than globally per
project, which allows packages in a monorepo to use different aliases.

Each resolved graph edge records its module specifier, resolution strategy,
configuration source, and proof confidence. Unresolved imports contain stable
reason codes such as `RESOLVE_NOT_FOUND`, `PATHS_TARGET_NOT_FOUND`,
`CONFIG_INVALID`, and `OUTSIDE_PROJECT_ROOT`, together with attempted targets.
Framework virtual modules and Node built-ins are treated as explicit boundaries,
not broken local links.

Graph completeness is also calculated per weakly connected entry-point component.
A concrete missing target can therefore remain local to its component. Ambiguous
global hazards—including parse failures, dynamic resolution, and invalid resolver
configuration—still contaminate every component. File deletion remains governed
by project-wide completeness because an unreachable file may be hidden behind a
missing edge.

DeadKiller intentionally uses AST, lexical scope, and module-graph evidence rather
than the TypeScript Compiler API. Common TypeScript syntax, aliases, type-only
references, and JavaScript-to-TypeScript extension substitution are supported, but
semantic features such as declaration merging or exported enum-member references
remain conservative and are reported for review when proof is incomplete.

Exit codes:

| Code | Meaning |
| ---: | --- |
| `0` | Analysis completed and the fail policy did not match. |
| `1` | Invalid input, configuration, or analysis failure. |
| `2` | At least one `--fail-on` category matched. |

Example GitHub Actions step:

```yaml
- name: Audit dead code
  run: npx deadkiller scan . --json --fail-on safe,dependency
```

## Supported scope and known limitations

- Full AST analysis is available for `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, and `.cts`.
- Vue, Nuxt, and Svelte single-file components may be discovered as framework entries, but their component contents are not yet parsed as full JavaScript/TypeScript ASTs.
- Dynamic `require`, computed access, `eval`, reflection, dependency injection, generated modules, and runtime plugin discovery can reduce certainty. DeadKiller reports uncertainty conservatively.
- Dependency analysis covers direct `dependencies` and `devDependencies` from the target project's root `package.json`; transitive packages are not classified.
- Runtime dependency candidates require explicit review and selection. Development dependencies are report-only.
- A successful static result does not replace application tests, type checking, linting, or runtime verification.

## Development

Clone the repository and install dependencies:

```bash
git clone https://github.com/Dwirifan/Dead-code-and-Unsed-Dependecy.git
cd Dead-code-and-Unsed-Dependecy
npm install
```

Run project checks:

```bash
npm test
npm run lint
npm run check
```

To test the CLI globally from the repository:

```bash
npm link
deadkiller --help
```

Issues and reproducible bug reports are welcome in the [GitHub issue tracker](https://github.com/Dwirifan/Dead-code-and-Unsed-Dependecy/issues).

## License

Released under the [MIT License](./LICENSE).
