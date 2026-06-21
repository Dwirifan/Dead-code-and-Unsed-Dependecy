/**
 * Konfigurasi DeadKiller Dinamis
 */
export default {
    mode: 'vanilla',
    ignorePrefixedVariables: '^_',
    preserveExports: false,
    preserveFiles: [],
    ignoreDependencies: [],
    
    // Konfigurasi Modul Eliminator (Auto-Refactoring)
    eliminator: {
        autoRenameUnusedParameters: false,
        autoRemoveEmptyBlocks: false
    },

    // Sistem overrides: Terapkan aturan berbeda untuk file spesifik
    overrides: [
        {
            files: ['test/dirty.js'],
            ignorePrefixedVariables: 'forgottenFunction' // Abaikan fungsi ini khusus di file test/dirty.js
        }
    ]
};
