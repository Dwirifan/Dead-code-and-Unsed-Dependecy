# DeadKiller CLI

DeadKiller is an advanced Command Line Interface (CLI) tool designed to perform deep static analysis on JavaScript and TypeScript source code. Developed as a final year thesis project, it leverages Graph-Based Reachability Analysis to accurately map project structures, detecting unreachable files, dead code (unused variables, functions, etc.), and unused dependencies.

It features a Confidence Scoring System and Safety Classification to ensure that all findings are accurately categorized, along with an HTML Dashboard and Git-style diff viewing for a secure and professional developer experience.

## Core Features

- **Graph-Based Reachability**: Constructs a dependency graph from entry points using Breadth-First Search (BFS) to distinguish between live and dead files.
- **Intra-procedural Dead Code Detection**: Detects unused variables, functions, parameters, and unreachable statements within their respective scopes.
- **Unused Dependency Detection**: Identifies libraries declared in `package.json` that are never imported.
- **Confidence & Safety System**: Automatically labels findings with confidence levels (High/Medium/Low) and safety statuses (Safe/Review/Risky).
- **Interactive Diff Preview**: Provides a Git-style before-and-after preview prior to any code deletion.
- **HTML Dashboard Visualization**: Generates an interactive graph using Cytoscape.js and Dagre layout for deep architectural inspection.
- **Safe Mode Execution**: Protected exports, automatic backups, and interactive confirmation. Only items marked as `safe` are eligible for auto-fix.
- **Framework-Aware**: Supports native detection for `vanilla`, `react`, and `next` frameworks, automatically protecting critical framework directories.

## Installation

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
Audits the project and outputs dead code and unused dependencies without modifying any files.
```bash
deadkiller scan <path>
# Output in JSON format for CI/CD integration:
deadkiller scan <path> --json
```

**2. Fix (Interactive Deletion)**
Detects dead code, displays a diff preview, and requests confirmation before deletion. Only `safe` items will be processed.
```bash
deadkiller fix <path>
```

**3. Show Dependencies**
Analyzes `package.json` to contrast used versus unused dependencies.
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

## Configuration

You can customize DeadKiller's behavior by creating a `.deadkillerrc.json` file in your project's root directory:

```json
{
  "mode": "vanilla",
  "ignorePrefixedVariables": "^_",
  "preserveExports": true,
  "preserveFiles": [],
  "ignoreDependencies": [],
  "entryPoints": []
}
```

- **mode**: Framework mode (`vanilla`, `react`, or `next`).
- **ignorePrefixedVariables**: Regex pattern to ignore specific variables (e.g., `^_` ignores `_unusedVar`).
- **preserveExports**: Protects all exported functions and variables from deletion.
- **preserveFiles**: Array of file paths to explicitly exclude from analysis.

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
