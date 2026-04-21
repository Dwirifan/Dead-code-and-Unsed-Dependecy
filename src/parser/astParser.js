import { parse } from '@typescript-eslint/typescript-estree';

const PARSER_OPTIONS = {
    loc: true,
    range: true,
    jsx: true,
    comment: true,
    errorOnUnknownASTType: false,
    allowHashBang: true, // agar shebang (#!/usr/bin/env node) tidak menyebabkan parse error
};

/**
 * Mem-parsing string kode JavaScript atau TypeScript menjadi Abstract Syntax Tree (AST)
 * berformat ESTree yang kompatibel dengan estraverse.
 *
 * @param {string} codeString - Kode sumber yang akan di-parse.
 * @param {object} [options] - Opsi tambahan untuk menimpa konfigurasi default parser.
 * @returns {object} AST node root (Program) berformat ESTree-compatible.
 * @throws {Error} Jika parsing gagal karena sintaks tidak valid.
 */
export function parseCode(codeString, options = {}) {
    if (typeof codeString !== 'string') {
        throw new Error('parseCode: input harus berupa string kode sumber.');
    }

    try {
        return parse(codeString, { ...PARSER_OPTIONS, ...options });
    } catch (error) {
        const location = error.lineNumber
            ? ` (baris ${error.lineNumber}, kolom ${error.column})`
            : '';
        throw new Error(`Gagal parsing kode${location}: ${error.message}`);
    }
}
