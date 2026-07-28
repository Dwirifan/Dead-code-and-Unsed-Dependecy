import fs from 'fs-extra';
import path from 'path';
import { pathToFileURL } from 'url';
import micromatch from 'micromatch';

/**
 * Mesin Aturan (Rule Engine) untuk memvalidasi apakah dead code
 * harus diselamatkan berdasarkan konfigurasi proyek.
 * Mendukung file konfigurasi statis (.json) maupun dinamis (.js).
 */
export class RuleEngine {
    constructor() {
        // Konfigurasi standar (Default Rules)
        this.rules = {
            mode: 'vanilla',               // Mode framework: 'vanilla' | 'react' | 'next'
            ignorePrefixedVariables: "^_", // Abaikan variabel berawalan '_'
            preserveExports: true,         // Lindungi fungsi/variabel yg di-export
            preserveUnsafeFiles: true,     // Lindungi file dinamis (Conservative Safety Fallback)
            preserveFiles: [],             // Lindungi file dari penghapusan
            ignoreFiles: [],               // Abaikan file/folder dari pemindaian (contoh: 'dist')
            ignoreDependencies: [],        // Dependensi yang tidak dianggap unused
            entryPoints: [],               // Entry points khusus tambahan
            eliminator: {
                autoRenameUnusedParameters: false,
                autoRemoveEmptyBlocks: false
            },
            globals: [],                   // Variabel global tambahan dari pengguna
            overrides: []                  // Aturan spesifik per-file
        };

        // Direktori yang dilindungi oleh framework mode
        this._frameworkPreservedPaths = {
            vanilla: [],
            react: ['public/'],
            next: ['pages/', 'app/', 'api/', 'public/', 'middleware.']
        };

        this.projectRoot = null;
    }

    /**
     * Membaca konfigurasi `deadkiller.config.js` atau `.deadkillerrc.json` dari root project.
     * @param {string} projectRoot Lokasi root project
     */
    async loadConfig(projectRoot) {
        this.projectRoot = projectRoot;

        const jsConfigPath = path.join(projectRoot, 'deadkiller.config.js');
        const mjsConfigPath = path.join(projectRoot, 'deadkiller.config.mjs');
        const jsonConfigPath = path.join(projectRoot, '.deadkillerrc.json');

        try {
            let userConfig = null;

            if (await fs.pathExists(jsConfigPath)) {
                const configModule = await import(pathToFileURL(jsConfigPath).href);
                userConfig = configModule.default || configModule;
            } else if (await fs.pathExists(mjsConfigPath)) {
                const configModule = await import(pathToFileURL(mjsConfigPath).href);
                userConfig = configModule.default || configModule;
            } else if (await fs.pathExists(jsonConfigPath)) {
                userConfig = await fs.readJson(jsonConfigPath);
            }

            if (userConfig) {
                // Menimpa aturan default dengan aturan yang disediakan pengguna
                this.rules = { ...this.rules, ...userConfig };
            }

            // --- AUTO DETECT REACT RUNTIME ---
            // Baca package.json untuk melihat versi React
            const pkgJsonPath = path.join(projectRoot, 'package.json');
            if (await fs.pathExists(pkgJsonPath)) {
                const pkg = await fs.readJson(pkgJsonPath);
                const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
                const reactVersion = deps['react'];
                
                if (reactVersion) {
                    // Cek apakah versinya >= 17
                    // Menghapus karakter khusus seperti ^, ~, >=, dll.
                    const cleanVersion = reactVersion.replace(/[^0-9.]/g, '');
                    const majorVersion = parseInt(cleanVersion.split('.')[0], 10);
                    
                    if (!isNaN(majorVersion) && majorVersion >= 17) {
                        // Jika tidak disetel secara manual, aktifkan runtime automatic
                        if (!this.rules.reactRuntime) {
                            this.rules.reactRuntime = 'automatic';
                        }
                    }
                }
            }
            
            // Set default reactRuntime jika belum diatur
            if (!this.rules.reactRuntime) {
                this.rules.reactRuntime = 'classic'; // Default fallback untuk React < 17
            }

        } catch (err) {
            console.warn(`[RuleEngine] Gagal mem-parsing konfigurasi: ${err.message}. Menggunakan default.`);
            if (!this.rules.reactRuntime) this.rules.reactRuntime = 'classic';
        }
    }

    /**
     * Internal: Menggabungkan aturan global dengan aturan overrides jika file cocok
     * @param {string} absolutePath Path absolut file yang sedang dianalisis
     * @returns {Object} Aturan yang telah digabungkan untuk file tersebut
     */
    _resolveConfigForFile(absolutePath) {
        if (!absolutePath || !this.projectRoot) return this.rules;

        const relativePath = path.relative(this.projectRoot, absolutePath).replace(/\\/g, '/');
        let resolvedRules = { ...this.rules };

        if (this.rules.overrides && Array.isArray(this.rules.overrides)) {
            for (const override of this.rules.overrides) {
                if (override.files && Array.isArray(override.files)) {
                    // Evaluasi kecocokan file terhadap target overrides menggunakan micromatch (dukung negasi & array)
                    const isMatch = micromatch([relativePath], override.files).length > 0 ||
                                    override.files.some(pattern => !pattern.startsWith('!') && !pattern.includes('*') && relativePath.includes(pattern));

                    if (isMatch) {
                        resolvedRules = { ...resolvedRules, ...override };
                    }
                }
            }
        }
        return resolvedRules;
    }

    /**
     * Mengecek apakah sebuah instan kode harus kebal dari vonis "dead code"
     * 
     * @param {string} name Nama variabel / fungsi
     * @param {string} [absolutePath] Opsional: Path file (untuk aturan overrides)
     * @returns {boolean} True jika diselamatkan, False jika tetap divonis mati
     */
    isIgnoredVariable(name, absolutePath) {
        const rules = this._resolveConfigForFile(absolutePath);
        if (!rules.ignorePrefixedVariables || !name) return false;

        try {
            const regex = new RegExp(rules.ignorePrefixedVariables);
            return regex.test(name);
        } catch (_e) {
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
        this.projectRoot = projectRoot || this.projectRoot;
        const relativePath = path.relative(this.projectRoot, absolutePath).replace(/\\/g, '/');

        const rules = this._resolveConfigForFile(absolutePath);

        // 1. Cek preserveFiles manual dari config
        if (rules.preserveFiles && rules.preserveFiles.length > 0) {
            const matchManual = micromatch.isMatch(relativePath, rules.preserveFiles, {
                dot: true,
            });
            if (matchManual) return true;
        }

        // 2. Framework-aware auto-protection
        const mode = rules.mode || 'vanilla';
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
     * Menyimpan konfigurasi ke file statis (deadkiller.config.js).
     * @param {string} projectRoot Lokasi root project
     */
    async saveConfig(projectRoot) {
        const jsConfigPath = path.join(projectRoot, 'deadkiller.config.js');
        const jsonConfigPath = path.join(projectRoot, '.deadkillerrc.json');
        
        try {
            if (await fs.pathExists(jsonConfigPath)) {
                await fs.writeJson(jsonConfigPath, this.rules, { spaces: 4 });
            } else {
                const jsContent = `/**
 * Konfigurasi DeadKiller
 * Anda bisa menggunakan logika JS dinamis dan sistem overrides di sini.
 */
export default ${JSON.stringify(this.rules, null, 4)};
`;
                await fs.writeFile(jsConfigPath, jsContent, 'utf-8');
            }
        } catch (err) {
            console.error(`[RuleEngine] Gagal menyimpan konfigurasi: ${err.message}`);
        }
    }
}
