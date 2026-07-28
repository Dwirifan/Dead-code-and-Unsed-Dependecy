/**
 * Konfigurasi DeadKiller
 * Anda bisa menggunakan logika JS dinamis dan sistem overrides di sini.
 */
export default {
    "mode": "vanilla",
    "ignorePrefixedVariables": "^_",
    "preserveExports": true,
    "preserveUnsafeFiles": true,
    "preserveFiles": [],
    "ignoreDependencies": [],
    "entryPoints": [
        "src/commands/scanCommand.js"
    ],
    "eliminator": {
        "autoRenameUnusedParameters": false,
        "autoRemoveEmptyBlocks": false
    },
    "globals": [],
    "overrides": [],
    "reactRuntime": "classic"
};
