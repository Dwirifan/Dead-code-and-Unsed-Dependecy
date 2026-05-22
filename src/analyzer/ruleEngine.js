import fs from 'fs-extra';
import path from 'path';

/**
 * Mesin Aturan (Rule Engine) untuk memvalidasi apakah dead code
 * harus diselamatkan berdasarkan konfigurasi `.deadkillerrc.json`.
 */
export class RuleEngine {
    constructor() {
        // Konfigurasi standar (Default Rules)
        this.rules = {
            mode: 'vanilla',               // Mode framework: 'vanilla' | 'react' | 'next'
            ignorePrefixedVariables: "^_", // Abaikan variabel berawalan '_'
            preserveExports: true,         // Lindungi fungsi/variabel yg di-export
            preserveFiles: [],             // Lindungi file dari penghapusan
            ignoreDependencies: [],        // Dependensi yang tidak dianggap unused
            entryPoints: []                // Entry points khusus tambahan
        };

        // Direktori yang dilindungi oleh framework mode
        this._frameworkPreservedPaths = {
            vanilla: [],
            react:   ['public/'],
            next:    ['pages/', 'app/', 'api/', 'public/', 'middleware.']
        };
    }

    /**
     * Membaca file `.deadkillerrc.json` dari root project jika ada.
     * @param {string} projectRoot Lokasi root project
     */
    async loadConfig(projectRoot) {
        const configPath = path.join(projectRoot, '.deadkillerrc.json');
        if (await fs.pathExists(configPath)) {
            try {
                const userConfig = await fs.readJson(configPath);
                
                // Menimpa aturan default dengan aturan yang disediakan pengguna
                this.rules = { ...this.rules, ...userConfig };
            } catch (err) {
                console.warn(`[RuleEngine] Gagal mem-parsing ${configPath}: ${err.message}. Menggunakan default.`);
            }
        }
    }

    /**
     * Mengecek apakah sebuah instan kode harus kebal dari vonis "dead code"
     * 
     * @param {string} name Nama variabel / fungsi
     * @returns {boolean} True jika diselamatkan, False jika tetap divonis mati
     */
    isIgnoredVariable(name) {
        if (!this.rules.ignorePrefixedVariables || !name) return false;
        
        try {
            const regex = new RegExp(this.rules.ignorePrefixedVariables);
            return regex.test(name);
        } catch (e) {
            return false; // Gagal compile regex
        }
    }

    /**
     * Mengecek apakah file masuk dalam target perlindungan (preserveFiles)
     * 
     * @param {string} absolutePath Path file absolut
     * @param {string} projectRoot Lokasi root project
     * @returns {boolean} True jika file dilindungi
     */
    isIgnoredFile(absolutePath, projectRoot) {
        const relativePath = path.relative(projectRoot, absolutePath).replace(/\\/g, '/');

        // 1. Cek preserveFiles manual dari config
        if (this.rules.preserveFiles && this.rules.preserveFiles.length > 0) {
            const matchManual = this.rules.preserveFiles.some(pattern => {
                return relativePath.includes(pattern);
            });
            if (matchManual) return true;
        }

        // 2. Framework-aware auto-protection
        const mode = this.rules.mode || 'vanilla';
        const protectedPaths = this._frameworkPreservedPaths[mode] || [];
        return protectedPaths.some(p => relativePath.startsWith(p) || relativePath.includes('/' + p));
    }

    /**
     * Mengecek apakah dependensi masuk dalam daftar ignoreDependencies
     * @param {string} depName Nama package
     * @returns {boolean} True jika dilindungi
     */
    isIgnoredDependency(depName) {
        if (!this.rules.ignoreDependencies || this.rules.ignoreDependencies.length === 0) return false;
        return this.rules.ignoreDependencies.includes(depName);
    }

    /**
     * Menyimpan konfigurasi ke file `.deadkillerrc.json` di root project.
     * @param {string} projectRoot Lokasi root project
     */
    async saveConfig(projectRoot) {
        const configPath = path.join(projectRoot, '.deadkillerrc.json');
        try {
            await fs.writeJson(configPath, this.rules, { spaces: 2 });
        } catch (err) {
            console.error(`[RuleEngine] Gagal menyimpan konfigurasi: ${err.message}`);
        }
    }
}

// PXP: Pengembangan Mesin Analisis dan Penelusuran (Analyzer)
