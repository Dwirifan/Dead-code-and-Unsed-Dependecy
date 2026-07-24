/**
 * Konfigurasi DeadKiller - FIXED VERSION
 * 
 * Project: deadkiller-cli (CLI Application)
 * Struktur: bin/ → src/ → test/
 * 
 * Key fixes:
 * 1. preserveExports: true (exports digunakan oleh test dan modules lain)
 * 2. preserveFiles: Pattern sesuai dengan test/analyzer/, test/commands/, dll
 * 3. ignoreDependencies: Tools yang digunakan via config files
 * 4. overrides: Test files diproteksi dengan preserveExports: true
 */
export default {
    "mode": "vanilla",
    "entryPoints": [
        "bin/dce-cli.js",
        "vitest.config.js"
    ],
    "ignorePrefixedVariables": "^_|dummy",
    "preserveExports": true,  // ✅ FIXED: true untuk protect exports
    "preserveFiles": [
        "test/**/*.js",       // ✅ FIXED: Match actual test structure
        "**/*.test.js",
        "**/*.spec.js"
    ],
    // ✅ FIXED: Ignore dependencies yang digunakan via config files
    "ignoreDependencies": [
        "size-limit",                    // .size-limit.json config
        "@size-limit/preset-small-lib",  // size-limit preset
        "@size-limit/time"               // size-limit plugin
    ],
    "globals": [],
    "overrides": [
        {
            // ✅ FIXED: Match actual test structure (test/, not tests/)
            "files": [
                "test/**/*.js",
                "**/*.test.js",
                "**/*.spec.js"
            ],
            "ignorePrefixedVariables": ".*",
            "preserveExports": true  // Test files jangan hapus exports
        }
    ]
};
