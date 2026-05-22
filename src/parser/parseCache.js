import fs from 'fs-extra';

/**
 * Sistem Cache AST Sederhana Berbasis Modified Time (mtime).
 * 
 * Menyimpan hasil parsing AST di memori selama satu sesi scan/fix.
 * Jika file belum berubah sejak terakhir kali di-cache (berdasarkan mtime),
 * AST yang sudah di-parse sebelumnya akan digunakan kembali.
 * 
 * Keuntungan:
 *   - Menghindari parsing ulang file yang sama di satu sesi
 *   - Mempercepat analisis pada proyek besar (>100 file)
 *   - Overhead memori minimal (AST disimpan per sesi, bukan ke disk)
 * 
 * Keterbatasan:
 *   - Cache hanya berlaku dalam satu sesi (tidak persisten ke disk)
 *   - Cocok untuk mode scan dan fix yang membaca banyak file sekaligus
 * 
 * @module parseCache
 */
export class ParseCache {
    constructor() {
        /**
         * Map dari filePath -> { mtime: number, ast: object, code: string }
         * @type {Map<string, { mtime: number, ast: object, code: string }>}
         */
        this._cache = new Map();
        this._hits = 0;
        this._misses = 0;
    }

    /**
     * Mengambil AST dan kode dari cache jika file belum berubah.
     * 
     * @param {string} filePath - Path absolut file
     * @returns {Promise<{ ast: object, code: string } | null>} Cache hit atau null
     */
    async get(filePath) {
        if (!this._cache.has(filePath)) {
            this._misses++;
            return null;
        }

        try {
            const stat = await fs.stat(filePath);
            const currentMtime = stat.mtimeMs;
            const cached = this._cache.get(filePath);

            if (cached.mtime === currentMtime) {
                this._hits++;
                return { ast: cached.ast, code: cached.code };
            }
        } catch (_) {
            // File mungkin sudah dihapus
        }

        // File berubah — invalidasi cache
        this._cache.delete(filePath);
        this._misses++;
        return null;
    }

    /**
     * Menyimpan AST dan kode ke cache.
     * 
     * @param {string} filePath - Path absolut file
     * @param {object} ast - Abstract Syntax Tree hasil parsing
     * @param {string} code - Source code string
     */
    async set(filePath, ast, code) {
        try {
            const stat = await fs.stat(filePath);
            this._cache.set(filePath, {
                mtime: stat.mtimeMs,
                ast,
                code
            });
        } catch (_) {
            // Gagal baca stat — skip caching
        }
    }

    /**
     * Mengembalikan statistik penggunaan cache.
     * @returns {{ hits: number, misses: number, size: number, hitRate: string }}
     */
    getStats() {
        const total = this._hits + this._misses;
        const hitRate = total > 0 ? ((this._hits / total) * 100).toFixed(1) : '0.0';
        return {
            hits: this._hits,
            misses: this._misses,
            size: this._cache.size,
            hitRate: `${hitRate}%`
        };
    }

    /**
     * Mengosongkan seluruh cache.
     */
    clear() {
        this._cache.clear();
        this._hits = 0;
        this._misses = 0;
    }
}

// PXP: Pengembangan Modul Pengurai (Parser)
