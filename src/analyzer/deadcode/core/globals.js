import globals from 'globals';

/**
 * Daftar variabel bawaan JavaScript, Node.js, Browser, dan Testing (diambil dari modul 'globals' standar ESLint)
 * agar tidak dilaporkan sebagai Undeclared Variable (no-undef).
 */
export const BUILTIN_GLOBALS = new Set([
    ...Object.keys(globals.builtin || {}),
    ...Object.keys(globals.browser || {}),
    ...Object.keys(globals.node || {}),
    ...Object.keys(globals.jest || {}),
    ...Object.keys(globals.vitest || {}) // Vitest jika ada
]);
