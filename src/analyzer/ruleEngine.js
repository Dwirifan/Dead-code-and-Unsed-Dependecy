import fs from 'fs-extra';
import path from 'path';
import { pathToFileURL } from 'url';
import { validateAndNormalizeConfig } from './configValidator.js';
import { matchesOrderedPatterns } from './globMatcher.js';
import { createRecommendedConfig, inspectProject } from '../commands/initProjectProfiler.js';
import { NEXT_PRESERVE_GLOBS } from './frameworkConventions.js';

const DEFAULT_RULES = {
    mode: 'vanilla',
    framework: 'vanilla',
    ignorePrefixedVariables: '^_',
    reportPositionalParameters: true,
    preserveExports: true,
    preserveUnsafeFiles: true,
    detectDeadStores: true,
    preserveFiles: [],
    ignoreFiles: [],
    ignoreDependencies: [],
    entryPoints: [],
    eliminator: {
        autoRenameUnusedParameters: false,
        autoRemoveEmptyBlocks: false,
        maxBackups: 20,
    },
    globals: [],
    overrides: [],
};

const FRAMEWORK_MODES = Object.freeze({
    vanilla: 'vanilla',
    next: 'next',
    nuxt: 'vue',
    vue: 'vue',
    remix: 'react',
    'react-native': 'react',
    react: 'react',
    preact: 'react',
    angular: 'vanilla',
    svelte: 'vanilla',
    solid: 'vanilla',
    astro: 'vanilla',
    nestjs: 'vanilla',
    express: 'vanilla',
});

function modeForFramework(framework, fallback = 'vanilla') {
    return FRAMEWORK_MODES[framework] || fallback;
}

function frameworkForMode(mode, currentFramework = null) {
    if (currentFramework && modeForFramework(currentFramework, null) === mode) {
        return currentFramework;
    }
    return {
        vanilla: 'vanilla',
        react: 'react',
        next: 'next',
        vue: 'vue',
    }[mode] || currentFramework || 'vanilla';
}

function comparablePath(filePath) {
    const resolved = path.resolve(filePath);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

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
    // MODULE_TYPELESS_PACKAGE_JSON dari Node. Config hasil generator dapat
    // dimuat melalui data URL untuk kompatibilitas module system. Mekanisme ini
    // bukan sandbox; gunakan `scan --no-config` untuk repo yang tidak dipercaya.
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
        this.configPolicy = 'auto';
        this.ignoredConfigPaths = [];

        // Direktori yang dilindungi oleh framework mode
        this._frameworkPreservedPaths = {
            vanilla: [],
            react: ['public/'],
            next: [],
            vue: ['pages/', 'layouts/', 'middleware/', 'plugins/', 'public/']
        };

        this.projectRoot = null;
    }

    /**
     * Membaca konfigurasi `deadkiller.config.js` atau `.deadkillerrc.json` dari root project.
     * @param {string} projectRoot Lokasi root project
     */
    async loadConfig(projectRoot, { ignoreConfig = false } = {}) {
        this.projectRoot = projectRoot;
        this.rules = freshDefaultRules();
        this.configDiagnostics = [];
        this.configPath = null;
        this.configLoaded = false;
        this.configValid = true;
        this.configSource = 'defaults';
        this.autoProfile = null;
        this.configPolicy = ignoreConfig ? 'none' : 'auto';
        this.ignoredConfigPaths = [];

        const jsConfigPath = path.join(projectRoot, 'deadkiller.config.js');
        const mjsConfigPath = path.join(projectRoot, 'deadkiller.config.mjs');
        const jsonConfigPath = path.join(projectRoot, '.deadkillerrc.json');

        try {
            // Profil selalu menjadi base konfigurasi, termasuk ketika pengguna
            // hanya menyediakan beberapa override. Ini mencegah config parsial
            // mematikan deteksi framework dan perlindungan zero-config.
            this.autoProfile = await inspectProject(projectRoot);
            const recommended = createRecommendedConfig(this.autoProfile);
            const autoValidated = validateAndNormalizeConfig(recommended, freshDefaultRules());
            const baseRules = autoValidated.config;

            let userConfig = null;
            const existingConfigs = [];
            for (const candidate of [mjsConfigPath, jsConfigPath, jsonConfigPath]) {
                if (await fs.pathExists(candidate)) existingConfigs.push(candidate);
            }
            if (ignoreConfig) {
                this.ignoredConfigPaths = [...existingConfigs];
            } else if (existingConfigs.length > 1) {
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

            if (!ignoreConfig && existingConfigs[0] === mjsConfigPath) {
                this.configPath = mjsConfigPath;
                const configModule = await importConfigModule(mjsConfigPath, projectRoot);
                userConfig = configModule.default || configModule;
            } else if (!ignoreConfig && existingConfigs[0] === jsConfigPath) {
                this.configPath = jsConfigPath;
                const configModule = await importConfigModule(jsConfigPath, projectRoot);
                userConfig = configModule.default || configModule;
            } else if (!ignoreConfig && existingConfigs[0] === jsonConfigPath) {
                this.configPath = jsonConfigPath;
                userConfig = await fs.readJson(jsonConfigPath);
            }

            if (userConfig) {
                const validated = validateAndNormalizeConfig(userConfig, baseRules);
                this.rules = validated.config;
                const hasUserMode = Object.hasOwn(userConfig, 'mode');
                const hasUserFramework = Object.hasOwn(userConfig, 'framework');
                if (hasUserMode && !hasUserFramework) {
                    this.rules.framework = frameworkForMode(
                        this.rules.mode,
                        this.autoProfile.framework,
                    );
                } else if (hasUserFramework && !hasUserMode) {
                    this.rules.mode = modeForFramework(this.rules.framework, this.rules.mode);
                }
                this.configDiagnostics = validated.diagnostics.map(item => ({
                    ...item,
                    file: this.configPath,
                }));
                this.configLoaded = true;
                this.configSource = 'file';
            } else {
                // Zero-config memakai rekomendasi yang sama dengan `deadkiller init`,
                // tetapi hanya di memori. Tidak ada file yang dibuat atau diubah.
                this.rules = baseRules;
                this.configDiagnostics = autoValidated.diagnostics.map(item => ({
                    ...item,
                    file: null,
                }));
                this.configSource = 'auto';
            }
            
            // Set default reactRuntime jika belum diatur
            if (!this.rules.reactRuntime) {
                this.rules.reactRuntime = 'classic'; // Default fallback untuk React < 17
            }

            return {
                loaded: this.configLoaded,
                path: this.configPath,
                source: this.configSource,
                policy: this.configPolicy,
                profile: this.autoProfile,
                ignoredPaths: [...this.ignoredConfigPaths],
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
    effectiveRulesFor(absolutePath) {
        if (!absolutePath || !this.projectRoot) return this.rules;

        const relativePath = path.relative(this.projectRoot, absolutePath).replace(/\\/g, '/');
        let resolvedRules = { ...this.rules };

        if (this.rules.overrides && Array.isArray(this.rules.overrides)) {
            for (const override of this.rules.overrides) {
                if (override.files && Array.isArray(override.files)) {
                    // Evaluasi kecocokan file terhadap glob berurutan, termasuk negasi.
                    const isMatch = matchesOrderedPatterns(relativePath, override.files, {
                        legacyDirectories: true,
                    });

                    if (isMatch) {
                        const { files: _files, ...overrideRules } = override;
                        if (Object.hasOwn(overrideRules, 'mode') && !Object.hasOwn(overrideRules, 'framework')) {
                            overrideRules.framework = frameworkForMode(
                                overrideRules.mode,
                                resolvedRules.framework,
                            );
                        } else if (Object.hasOwn(overrideRules, 'framework') && !Object.hasOwn(overrideRules, 'mode')) {
                            overrideRules.mode = modeForFramework(
                                overrideRules.framework,
                                resolvedRules.mode,
                            );
                        }
                        resolvedRules = {
                            ...resolvedRules,
                            ...overrideRules,
                            eliminator: overrideRules.eliminator
                                ? { ...(resolvedRules.eliminator || {}), ...overrideRules.eliminator }
                                : resolvedRules.eliminator,
                        };
                    }
                }
            }
        }
        return resolvedRules;
    }

    // Alias kompatibilitas untuk integrasi lama. Kode baru harus memakai API
    // publik `effectiveRulesFor()` agar seluruh analyzer konsisten.
    _resolveConfigForFile(absolutePath) {
        return this.effectiveRulesFor(absolutePath);
    }

    /**
     * Mengecek apakah sebuah instan kode harus kebal dari vonis "dead code"
     * 
     * @param {string} name Nama variabel / fungsi
     * @param {string} [absolutePath] Opsional: Path file (untuk aturan overrides)
     * @returns {boolean} True jika diselamatkan, False jika tetap divonis mati
     */
    isIgnoredVariable(name, absolutePath) {
        const rules = this.effectiveRulesFor(absolutePath);
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

        // `--no-config` bukan sekadar mencegah eksekusi config. Berkas config
        // target juga harus keluar dari graph agar import di dalamnya tidak
        // mencemari bukti penggunaan dependency pada arm zero-config.
        if (
            this.configPolicy === 'none' &&
            this.ignoredConfigPaths.some(configPath => (
                comparablePath(configPath) === comparablePath(absolutePath)
            ))
        ) {
            return true;
        }

        const rules = this.effectiveRulesFor(absolutePath);
        if (rules.ignoreFiles && rules.ignoreFiles.length > 0) {
            const isIgnoredDir = matchesOrderedPatterns(relativePath, rules.ignoreFiles, {
                legacyDirectories: true,
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
        const rules = this.effectiveRulesFor(absolutePath);

        if (rules.preserveFiles && rules.preserveFiles.length > 0) {
            const matchManual = matchesOrderedPatterns(relativePath, rules.preserveFiles, {
                legacyDirectories: true,
            });
            if (matchManual) return true;
        }

        // Convention-based framework files tetap dianalisis agar temuan dapat
        // ditinjau, tetapi tidak pernah diubah otomatis.
        const mode = rules.mode || 'vanilla';
        if (rules.framework === 'next' || mode === 'next') {
            return matchesOrderedPatterns(relativePath, NEXT_PRESERVE_GLOBS);
        }
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
