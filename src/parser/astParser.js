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
export class ParseError extends Error {
    constructor(message, filePath, line, column) {
        super(message);
        this.name = 'ParseError';
        this.filePath = filePath;
        this.line = line;
        this.column = column;
    }
}

/**
 * Mem-parsing string kode JavaScript atau TypeScript menjadi Abstract Syntax Tree (AST)
 * berformat ESTree yang kompatibel dengan estraverse.
 *
 * @param {string} codeString - Kode sumber yang akan di-parse.
 * @param {string} [filePath] - Path file (untuk error reporting dan resolusi TypeScript).
 * @param {object} [options] - Opsi tambahan untuk menimpa konfigurasi default parser.
 * @returns {object} AST node root (Program) berformat ESTree-compatible.
 * @throws {ParseError} Jika parsing gagal karena sintaks tidak valid.
 */
export function parseCode(codeString, filePath = 'unknown', options = {}) {
    if (typeof codeString !== 'string') {
        throw new Error(`[Internal Error] parseCode: input harus berupa string kode sumber. Path: ${filePath}`);
    }

    try {
        return parse(codeString, { 
            ...PARSER_OPTIONS, 
            filePath, // Mengirim filePath ke parser untuk konteks yang lebih baik
            ...options 
        });
    } catch (error) {
        throw new ParseError(
            `Gagal parsing kode: ${error.message}`,
            filePath,
            error.lineNumber || null,
            error.column || null
        );
    }
}
