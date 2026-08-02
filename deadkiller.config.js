/**
 * Konfigurasi self-scan DeadKiller CLI.
 * Test, example, dan fixture tetap dianalisis, tetapi tidak boleh diubah oleh fix.
 */
export default {
    mode: 'vanilla',
    entryPoints: [
        'bin/dce-cli.js',
        'vitest.config.js',
    ],
    ignorePrefixedVariables: '^_',
    preserveExports: true,
    preserveUnsafeFiles: true,
    preserveFiles: [
        'test/**',
        'tests/**',
        '__tests__/**',
        '**/test/**',
        '**/tests/**',
        '**/__tests__/**',
        '**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
        'e2e/**',
        '**/e2e/**',
        'examples/**',
        '**/examples/**',
        '**/fixtures/**',
        '**/__fixtures__/**',
    ],
    ignoreFiles: [
        '**/node_modules/**',
        '**/dist/**',
        '**/build/**',
        '**/coverage/**',
        '**/.next/**',
        '**/.nuxt/**',
        '**/.svelte-kit/**',
        '**/.turbo/**',
        '**/.cache/**',
        '**/out/**',
        '**/storybook-static/**',
        '**/.deadkiller_backup/**',
    ],
    ignoreDependencies: [],
    globals: [],
    overrides: [
        {
            files: [
                'test/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
                'tests/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
                '__tests__/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
                '**/test/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
                '**/tests/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
                '**/__tests__/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
                '**/*.{test,spec}.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
                'e2e/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
                '**/e2e/**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}',
            ],
            preserveExports: true,
        },
    ],
};
