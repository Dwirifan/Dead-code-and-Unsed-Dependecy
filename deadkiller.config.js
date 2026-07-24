/**
 * Konfigurasi DeadKiller
 * Anda bisa menggunakan logika JS dinamis dan sistem overrides di sini.
 */
export default {
    "mode": "vanilla",
    "entryPoints": [
        "bin/dce-cli.js",
        "vitest.config.js"
    ],
    "ignorePrefixedVariables": "^_|dummy",
    "preserveExports": false,
    "preserveFiles": [
        "*.test.js",
        "__tests__"
    ],
    "ignoreDependencies": [],
    "globals": [],
    "overrides": [
        {
            "files": [
                "**/*.test.js",
                "tests/**/*.js"
            ],
            "ignorePrefixedVariables": ".*",
            "preserveExports": true
        }
    ]
};
