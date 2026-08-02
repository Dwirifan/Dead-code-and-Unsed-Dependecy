import fs from 'fs-extra';
import path from 'path';
import { pathToFileURL } from 'url';
import micromatch from 'micromatch';
import { validateAndNormalizeConfig } from './configValidator.js';
import { createRecommendedConfig, inspectProject } from '../commands/initProjectProfiler.js';

const DEFAULT_RULES = {
    mode: 'vanilla',
    ignorePrefixedVariables: '^_',
    preserveExports: true,
    preserveUnsafeFiles: true,
    preserveFiles: [],
    ignoreFiles: [],
    ignoreDependencies: [],
    entryPoints: [],
    eliminator: {
        autoRenameUnusedParameters: false,
        autoRemoveEmptyBlocks: false,
    },
    globals: [],
    overrides: [],
};

function freshDefaultRules() {
    return {
        ...DEFAULT_RULES,
        eliminator: { ...DEFAULT_RULES.eliminator },
        preserveFiles: [],
        ignoreFiles: [],
        ignoreDependencies: [],
        entryPoints: [],
        globals: [],
        overrides: [],
    };
}

async function importConfigModule(configPath, projectRoot) {
    const packageJsonPath = path.join(projectRoot, 'package.json');
    const pkg = await fs.pathExists(packageJsonPath)
        ? await fs.readJson(packageJsonPath)
        : {};

    // Konfigurasi lama yang dibuat sebagai `deadkiller.config.js` memakai
    // `export default`. Pada proyek CommonJS, import langsung memicu warning
    // MODULE_TYPELESS_PACKAGE_JSON dari Node. Config hasil generator hanya
    // berisi object literal, sehingga aman dimuat sebagai data URL.
    if (path.basename(configPath) === 'deadkiller.config.js' && pkg.type !== 'module') {
        const source = await fs.readFile(configPath, 'utf8');
        const isPlainGeneratedEsmConfig =
            /\bexport\s+default\b/.test(source) &&
            !/^\s*import\s/m.test(source) &&
            !/\bexport\s+(?!default\b)/.test(source);

        if (isPlainGeneratedEsmConfig) {
            const encoded = Buffer.from(source, 'utf8').toString('base64');
            return import(`data:text/javascript;base64,${encoded}`);
        }
    }

    const configUrl = pathToFileURL(configPath);
    const stat = await fs.stat(configPath);
    configUrl.searchParams.set('mtime', String(stat.mtimeMs));
    return import(configUrl.href);
}

/**
 * Mesin Aturan (Rule Engine) untuk memvalidasi apakah dead code
 * harus diselamatkan berdasarkan konfigurasi proyek.
 * Mendukung file konfigurasi statis (.json) maupun dinamis (.js).
 */
export class RuleEngine {
    constructor() {
        this.rules = freshDefaultRules();
        this.configDiagnostics = [];
        this.configPath = null;
        this.configLoaded = false;
        this.configValid = true;
        this.configSource = 'defaults';
        this.autoProfile = null;

        // Direktori yang dilindungi oleh framework mode
        this._frameworkPreservedPaths = {
            vanilla: [],
            react: ['public/'],
            next: ['pages/', 'app/', 'api/', 'public/', 'middleware.'],
            vue: ['pages/', 'layouts/', 'middleware/', 'plugins/', 'public/']
        };

        this.projectRoot = null;
    }

    /**
     * Membaca konfigurasi `deadkiller.config.js` atau `.deadkillerrc.json` dari root project.
     * @param {string} projectRoot Lokasi root project
     */
    async loadConfig(projectRoot) {
        this.projectRoot = projectRoot;
        this.rules = freshDefaultRules();
        this.configDiagnostics = [];
        this.configPath = null;
        this.configLoaded = false;
        this.configValid = true;
        this.configSource = 'defaults';
        this.autoProfile = null;

        const jsConfigPath = path.join(projectRoot, 'deadkiller.config.js');
        const mjsConfigPath = path.join(projectRoot, 'deadkiller.config.mjs');
        const jsonConfigPath = path.join(projectRoot, '.deadkillerrc.json');

        try {
            let userConfig = null;
            const existingConfigs = [];
            for (const candidate of [mjsConfigPath, jsConfigPath, jsonConfigPath]) {
                if (await fs.pathExists(candidate)) existingConfigs.push(candidate);
            }
            if (existingConfigs.length > 1) {
                const conflictError = new Error(
                    `Ditemukan beberapa file konfigurasi aktif: ${existingConfigs.map(file => path.basename(file)).join(', ')}. Sisakan satu file saja.`,
                );
                conflictError.code = 'CONFIG_CONFLICTING_FILES';
                conflictError.diagnostics = [{
                    level: 'error',
                    code: conflictError.code,
                    path: projectRoot,
                    message: conflictError.message,
                    files: existingConfigs,
                }];
                throw conflictError;
            }

            if (existingConfigs[0] === mjsConfigPath) {
                this.configPath = mjsConfigPath;
                const configModule = await importConfigModule(mjsConfigPath, projectRoot);
                userConfig = configModule.default || configModule;
            } else if (existingConfigs[0] === jsConfigPath) {
                this.configPath = jsConfigPath;
                const configModule = await importConfigModule(jsConfigPath, projectRoot);
                userConfig = configModule.default || configModule;
            } else if (existingConfigs[0] === jsonConfigPath) {
                this.configPath = jsonConfigPath;
                userConfig = await fs.readJson(jsonConfigPath);
            }

            if (userConfig) {
                const validated = validateAndNormalizeConfig(userConfig, freshDefaultRules());
                this.rules = validated.config;
                this.configDiagnostics = validated.diagnostics.map(item => ({
                    ...item,
                    file: this.configPath,
                }));
                this.configLoaded = true;
                this.configSource = 'file';
            } else {
                // Zero-config memakai rekomendasi yang sama dengan `deadkiller init`,
                // tetapi hanya di memori. Tidak ada file yang dibuat atau diubah.
                this.autoProfile = await inspectProject(projectRoot);
                const recommended = createRecommendedConfig(this.autoProfile);
                const validated = validateAndNormalizeConfig(recommended, freshDefaultRules());
                this.rules = validated.config;
                this.configDiagnostics = validated.diagnostics.map(item => ({
                    ...item,
                    file: null,
                }));
                this.configSource = 'auto';
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

            return {
                loaded: this.configLoaded,
                path: this.configPath,
                source: this.configSource,
                profile: this.autoProfile,
                diagnostics: [...this.configDiagnostics],
            };
        } catch (err) {
            this.configValid = false;
            const diagnostics = err.diagnostics || [{
                level: 'error',
                code: err.code || 'CONFIG_LOAD_FAILED',
                path: this.configPath || projectRoot,
                message: err.message,
                file: this.configPath,
            }];
            this.configDiagnostics = diagnostics;

            const loadError = new Error(
                `Gagal memuat konfigurasi DeadKiller${this.configPath ? ` '${path.basename(this.configPath)}'` : ''}: ${err.message}`,
                { cause: err },
            );
            loadError.name = 'ConfigLoadError';
            loadError.code = 'DEADKILLER_CONFIG_LOAD_FAILED';
            loadError.diagnostics = diagnostics;
            throw loadError;
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
     * Mengecek apakah file dikeluarkan sepenuhnya dari analisis.
     * `preserveFiles` sengaja tidak diperiksa di sini: file preserved tetap
     * dibaca dan dilaporkan, tetapi tidak boleh dieliminasi.
     */
    isIgnoredFile(absolutePath, projectRoot) {
        this.projectRoot = projectRoot || this.projectRoot;
        const relativePath = path.relative(this.projectRoot, absolutePath).replace(/\\/g, '/');

        const rules = this._resolveConfigForFile(absolutePath);
        if (rules.ignoreFiles && rules.ignoreFiles.length > 0) {
            const isIgnoredDir = rules.ignoreFiles.some(pattern => {
                if (micromatch.isMatch(relativePath, pattern, { dot: true })) return true;

                // Backward compatibility untuk config lama yang memakai nama
                // direktori polos seperti "dist" alih-alih glob "**/dist/**".
                const hasGlobSyntax = ['*', '!', '?', '[', ']', '{', '}', '(', ')']
                    .some(character => pattern.includes(character));
                if (!hasGlobSyntax) {
                    const directory = pattern.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/+$/, '');
                    return relativePath === directory ||
                        relativePath.startsWith(`${directory}/`) ||
                        relativePath.includes(`/${directory}/`);
                }
                return false;
            });
            if (isIgnoredDir) return true;
        }

        return false;
    }

    /**
     * Mengecek apakah file tetap dianalisis, tetapi dilindungi dari seluruh
     * tindakan eliminasi otomatis dan kandidat penghapusan file.
     */
    isPreservedFile(absolutePath, projectRoot) {
        this.projectRoot = projectRoot || this.projectRoot;
        const relativePath = path.relative(this.projectRoot, absolutePath).replace(/\\/g, '/');
        const rules = this._resolveConfigForFile(absolutePath);

        if (rules.preserveFiles && rules.preserveFiles.length > 0) {
            const matchManual = micromatch.isMatch(relativePath, rules.preserveFiles, {
                dot: true,
            });
            if (matchManual) return true;
        }

        // Convention-based framework files tetap dianalisis agar temuan dapat
        // ditinjau, tetapi tidak pernah diubah otomatis.
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
     * Menyimpan konfigurasi ke file JSON yang aktif atau deadkiller.config.mjs.
     * @param {string} projectRoot Lokasi root project
     */
    async saveConfig(projectRoot) {
        const jsConfigPath = path.join(projectRoot, 'deadkiller.config.js');
        const mjsConfigPath = path.join(projectRoot, 'deadkiller.config.mjs');
        const jsonConfigPath = path.join(projectRoot, '.deadkillerrc.json');
        
        try {
            const validated = validateAndNormalizeConfig(this.rules, freshDefaultRules());
            this.rules = validated.config;
            if (await fs.pathExists(jsonConfigPath)) {
                await fs.writeJson(jsonConfigPath, this.rules, { spaces: 4 });
            } else {
                const jsContent = `/**
 * Konfigurasi DeadKiller
 * Anda bisa menggunakan logika JS dinamis dan sistem overrides di sini.
 */
export default ${JSON.stringify(this.rules, null, 4)};
`;
                const targetPath = await fs.pathExists(jsConfigPath)
                    ? jsConfigPath
                    : mjsConfigPath;
                await fs.writeFile(targetPath, jsContent, 'utf-8');
            }
        } catch (err) {
            const saveError = new Error(`Gagal menyimpan konfigurasi DeadKiller: ${err.message}`, { cause: err });
            saveError.code = 'DEADKILLER_CONFIG_SAVE_FAILED';
            throw saveError;
        }
    }
}
