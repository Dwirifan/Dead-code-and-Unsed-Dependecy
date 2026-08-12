<div align="center">
  <img src="./assets/logo.png" alt="DeadKiller Logo" width="150" style="margin-bottom: 20px;"/>
  <h1>🚀 DeadKiller CLI</h1>
  <p><b>Safety-first dead-code and unused-dependency analysis for modern JavaScript and TypeScript projects.</b></p>

  [![npm version](https://img.shields.io/npm/v/deadkiller-cli?style=for-the-badge&color=cb3837&logo=npm)](https://www.npmjs.com/package/deadkiller-cli)
  [![Node.js](https://img.shields.io/node/v/deadkiller-cli?style=for-the-badge&logo=nodedotjs)](https://www.npmjs.com/package/deadkiller-cli)
  [![License: MIT](https://img.shields.io/github/license/Dwirifan/Dead-code-and-Unsed-Dependecy?style=for-the-badge)](./LICENSE)
</div>

<br/>

DeadKiller builds a project-wide dependency graph, analyzes source-code usage, classifies findings by confidence and risk, and provides **guarded remediation** with diff previews, checkpoints, and restore support. 

Whether you're doing an interactive codebase cleanup or enforcing clean code in your CI/CD pipeline, DeadKiller has your back.

> [!IMPORTANT]
> **Static Analysis Disclaimer:** DeadKiller is a static-analysis tool. Dynamic imports, reflection, framework conventions, callbacks, generated code, and runtime dependency loading can limit what any static analyzer can prove. Review findings, inspect the diff, run your test suite, and keep source control enabled before applying changes.

## ✨ Highlights

- 🔍 **Project-wide reachability analysis** — Builds a graph from detected or configured entry points to identify live and unconnected files.
- ⚡ **JavaScript & TypeScript support** — Analyzes `.js`, `.jsx`, `.mjs`, `.cjs`, `.ts`, `.tsx`, `.mts`, and `.cts`.
- 🗑️ **Dead-code detection** — Reports unused bindings, functions, imports, types, classes, dead stores, and unreachable statements.
- 📦 **Direct dependency audit** — Analyzes runtime and development dependencies declared in the project-root `package.json`.
- 🛡️ **Confidence & safety classification** — Separates findings into `SAFE`, `REVIEW`, `RISKY`, and protected tiers.
- 🚦 **Guarded remediation** — Previews changes, requires confirmation, creates checkpoints, validates transformed syntax, and supports `undo`/`restore`.
- 🌐 **Interactive visualization** — Generates an HTML dashboard for dependency and dead-code exploration (`visualize` command).
- 🤖 **CI/CD ready** — Emits versioned JSON and supports strict category-based exit policies.

---

## 🚀 Quick Start

### Requirements
- Node.js **20 or newer**
- A JavaScript or TypeScript project
- A package manager (npm, Yarn, pnpm, Bun)

### Installation

Install globally for easy access:
```bash
npm install --global deadkiller-cli
```
*Or use `npx deadkiller-cli scan .` to run it without installing.*

### Basic Usage

1. **Read-only Scan** (Recommended first step)
   ```bash
   deadkiller scan .
   ```
2. **Interactive Remediation** (Preview and apply safe fixes)
   ```bash
   deadkiller fix .
   ```
3. **Visual Dashboard** (Explore your codebase visually)
   ```bash
   deadkiller visualize .
   ```

*(Just type `deadkiller` in your terminal to open the Interactive Wizard!)*

---

## 🛠️ Command Reference

| Command | Purpose |
| --- | --- |
| `deadkiller` | Open the interactive wizard. |
| `deadkiller init [path]` | Detect project profile & create `deadkiller.config.mjs`. |
| `deadkiller scan <path>` | Analyze a file/directory **without modifying** it. |
| `deadkiller fix <path>` | Preview and apply guarded source & file changes. |
| `deadkiller show-deps <path>` | Report unused runtime & dev dependencies. |
| `deadkiller visualize <path>` | Generate and open the HTML interactive dashboard. |
| `deadkiller report <path>` | Alias for `visualize`. |
| `deadkiller trace <file>` | Show reverse imports for a specific file. |
| `deadkiller watch <path>` | Re-run analysis on file changes. |
| `deadkiller history <path>` | Manage, restore, or delete backup checkpoints. |
| `deadkiller undo [path]` | Immediately restore the latest checkpoint. |

> Tip: Use `deadkiller <command> --help` for the complete option list.

---

## 🛡️ Safety & Remediation Model

DeadKiller separates **confidence** from **actionability**, ensuring you never accidentally break your app.

### Remediation Status

| Status | Automatic Action |
| --- | --- |
| 🟢 `SAFE` | Eligible for automated deletion. |
| 🟡 `REVIEW` | Requires explicit developer review. Not automatically fixed. |
| 🔴 `RISKY` | High risk of breaking changes. Not automatically fixed. |
| 🔒 `PROTECTED` | Found evidence of usage, or explicitly protected by config. |

### Elimination Levels (`fix` command)

You can control how aggressive DeadKiller is when running `fix`:

| Level | Behavior |
| ---: | --- |
| `0` | **Preview** (Dry-run) - Generate diffs without writing files. |
| `1` | **Safe Skip** - Most conservative transformation profile. |
| `2` | **Safe Refactor** - Apply safe structural refactoring (preserves signatures). |
| `3` | **Aggressive Delete** (Default) - Broadest transformation profile for eligible `SAFE` findings. |

---

## ⚙️ Configuration

DeadKiller works out-of-the-box using framework-aware heuristics. If you need custom rules, run:
```bash
deadkiller init
```

This generates a `deadkiller.config.mjs` file:
```javascript
export default {
    mode: 'react',
    entryPoints: ['src/main.tsx'],
    preserveFiles: ['examples/**', '**/fixtures/**'],
    ignoreFiles: ['**/dist/**', '**/build/**', '**/coverage/**'],
    eliminator: {
        autoRenameUnusedParameters: false,
        maxBackups: 20
    }
    // ...
};
```

---

## 🤖 CI / CD Integration

DeadKiller is built to enforce code cleanliness in your pipelines. 

```bash
# Generate a JSON report and fail if ANY 'safe' or 'dependency' findings exist
npx deadkiller scan . --json --fail-on safe,dependency > deadkiller-report.json
```

**Exit codes:**
- `0`: Analysis passed (no matching fail policy).
- `1`: Invalid input or analysis failure.
- `2`: At least one `--fail-on` category matched.

---

## 🤝 Contributing

We welcome issues and pull requests in our [GitHub tracker](https://github.com/Dwirifan/Dead-code-and-Unsed-Dependecy/issues).

```bash
git clone https://github.com/Dwirifan/Dead-code-and-Unsed-Dependecy.git
cd Dead-code-and-Unsed-Dependecy
npm install
npm test
```

## 📜 License
Released under the [MIT License](./LICENSE).
