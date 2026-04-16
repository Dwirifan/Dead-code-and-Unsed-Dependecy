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
            ignorePrefixedVariables: "^_", // Abaikan variabel berewalan '_'
            preserveExports: true,         // Lindungi fungsi/variabel yg di-export
            preserveFiles: []              // Lindungi file dari penghapusan
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
        if (!this.rules.preserveFiles || this.rules.preserveFiles.length === 0) return false;

        const relativePath = path.relative(projectRoot, absolutePath).replace(/\\/g, '/');
        
        return this.rules.preserveFiles.some(pattern => {
            // Bisa menggunakan simple string match (atau minimatch untuk wildcard ke depan)
            return relativePath.includes(pattern);
        });
    }
}
