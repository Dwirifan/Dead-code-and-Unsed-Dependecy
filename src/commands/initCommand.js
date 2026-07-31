import fs from 'fs-extra';
import path from 'node:path';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { classifyEntryPoint, findEntryPoints } from '../analyzer/graph/entryPointFinder.js';
import { createRecommendedConfig, inspectProject } from './initProjectProfiler.js';

const CONFIG_NAMES = [
    'deadkiller.config.mjs',
    'deadkiller.config.js',
    '.deadkillerrc.json',
];

const PROJECT_TYPE_CHOICES = [
    { name: 'Application / service', value: 'application' },
    { name: 'Library / package publik', value: 'library' },
    { name: 'CLI application', value: 'cli' },
    { name: 'Monorepo / workspace', value: 'monorepo' },
];

const MODE_CHOICES = [
    { name: 'Vanilla JS/TS, Node.js, Angular, Svelte, atau backend', value: 'vanilla' },
    { name: 'React / Remix / React Native', value: 'react' },
    { name: 'Next.js', value: 'next' },
    { name: 'Vue / Nuxt', value: 'vue' },
];

const VALID_MODES = new Set(MODE_CHOICES.map(choice => choice.value));
const VALID_PROJECT_TYPES = new Set(PROJECT_TYPE_CHOICES.map(choice => choice.value));

function normalizeInvocation(targetPathOrOptions, maybeOptions) {
    if (targetPathOrOptions && typeof targetPathOrOptions === 'object') {
        return { targetPath: '.', options: targetPathOrOptions };
    }
    return {
        targetPath: targetPathOrOptions || '.',
        options: maybeOptions || {},
    };
}

function normalizeFormat(format) {
    if (!format) return 'mjs';
    const normalized = String(format).toLowerCase();
    if (normalized === 'js') return 'mjs';
    if (!['mjs', 'json'].includes(normalized)) {
        throw new Error(`Format '${format}' tidak didukung. Gunakan 'mjs' atau 'json'.`);
    }
    return normalized;
}

function normalizeEntries(entries) {
    const values = Array.isArray(entries) ? entries : (entries ? [entries] : []);
    return [...new Set(values.flatMap(value => String(value).split(',')).map(value => value.trim()).filter(Boolean))];
}

function printProfile(profile, projectRoot) {
    console.log(chalk.bold.cyan('\n=== DeadKiller Project Setup ===\n'));
    console.log(chalk.gray(`Root            : ${projectRoot}`));
    console.log(`Project         : ${chalk.bold(profile.packageName)}`);
    console.log(`Language        : ${chalk.cyan(profile.language)}`);
    console.log(`Module system   : ${chalk.cyan(profile.moduleSystem)}`);
    console.log(`Framework       : ${chalk.cyan(profile.frameworkLabel)}`);
    console.log(`Project type    : ${chalk.cyan(profile.projectType)}`);
    console.log(`Package manager : ${chalk.cyan(profile.packageManager)}`);
    console.log(`Source files    : ${chalk.cyan(profile.sourceFileCount)}`);
    console.log();
}

function summarizeEntryKinds(entries) {
    const counts = new Map();
    entries.forEach(entry => counts.set(entry.kind, (counts.get(entry.kind) || 0) + 1));
    return [...counts.entries()].map(([kind, count]) => `${kind}: ${count}`).join(', ');
}

async function discoverEntries(projectRoot, config, additionalEntries) {
    try {
        const discoveryRules = {
            rules: {
                entryPoints: additionalEntries,
                ignoreFiles: config.ignoreFiles,
            },
        };
        const detected = await findEntryPoints(projectRoot, discoveryRules);
        return detected.map(entry => ({
            kind: classifyEntryPoint(entry, projectRoot),
            relativePath: path.relative(projectRoot, entry).replace(/\\/g, '/'),
        }));
    } catch (_error) {
        return [];
    }
}

async function promptForManualEntries() {
    const { manualEntries } = await inquirer.prompt([{
        type: 'input',
        name: 'manualEntries',
        message: 'Entry point tidak terdeteksi. Masukkan file/glob entry (pisahkan koma):',
        validate: value => normalizeEntries(value).length > 0 || 'Masukkan minimal satu file atau glob entry point.',
    }]);
    return normalizeEntries(manualEntries);
}

async function selectDetectedEntries(detectedEntries) {
    const { entryPoints } = await inquirer.prompt([{
        type: 'checkbox',
        name: 'entryPoints',
        message: 'Pilih root graph yang akan dianalisis:',
        choices: detectedEntries.map(entry => ({
            checked: true,
            name: `[${entry.kind}] ${entry.relativePath}`,
            value: entry.relativePath,
        })),
        pageSize: 20,
        loop: false,
        validate: selected => selected.length > 0 || 'Pilih minimal satu entry point.',
    }]);
    return entryPoints;
}

async function backupExistingConfigs(projectRoot, existingPaths) {
    if (existingPaths.length === 0) return null;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backupDirectory = path.join(projectRoot, '.deadkiller_backup', 'config-init', stamp);
    await fs.ensureDir(backupDirectory);
    for (const configPath of existingPaths) {
        await fs.copy(configPath, path.join(backupDirectory, path.basename(configPath)));
    }
    return backupDirectory;
}

function serializeConfig(config, format, profile) {
    if (format === 'json') return `${JSON.stringify(config, null, 4)}\n`;
    return `/**
 * Konfigurasi DeadKiller
 * Terdeteksi: ${profile.language}, ${profile.moduleSystem}, ${profile.frameworkLabel}, ${profile.projectType}
 * File .mjs bekerja konsisten pada proyek ESM maupun CommonJS.
 */
export default ${JSON.stringify(config, null, 4)};
`;
}

async function writeConfig(projectRoot, format, config, profile, existingPaths, force) {
    const fileName = format === 'json' ? '.deadkillerrc.json' : 'deadkiller.config.mjs';
    const targetPath = path.join(projectRoot, fileName);
    const temporaryPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`;
    let backupDirectory = null;

    try {
        if (force) backupDirectory = await backupExistingConfigs(projectRoot, existingPaths);
        await fs.writeFile(temporaryPath, serializeConfig(config, format, profile), 'utf8');
        await fs.move(temporaryPath, targetPath, { overwrite: true });

        // Hindari dua konfigurasi aktif dengan precedence berbeda. Semua versi lama
        // sudah disalin ke backup yang dapat dipulihkan sebelum dipindahkan.
        if (force) {
            for (const existingPath of existingPaths) {
                if (path.resolve(existingPath) !== path.resolve(targetPath)) {
                    await fs.remove(existingPath);
                }
            }
        }
        return { targetPath, backupDirectory };
    } catch (error) {
        await fs.remove(temporaryPath);
        throw error;
    }
}

export function registerInitCommand(program) {
    program
        .command('init [path]')
        .description('Deteksi proyek dan buat konfigurasi DeadKiller yang siap digunakan')
        .option('-y, --yes', 'Gunakan seluruh rekomendasi tanpa prompt')
        .option('-f, --force', 'Timpa konfigurasi lama setelah membuat backup')
        .option('--format <format>', 'Format konfigurasi: mjs atau json')
        .option('--mode <mode>', 'Mode analyzer: vanilla, react, next, atau vue')
        .option('--project-type <type>', 'Jenis proyek: application, library, cli, atau monorepo')
        .option('-e, --entry <paths...>', 'Entry point tambahan (mendukung banyak path/glob)')
        .option('--no-entry-review', 'Terima semua entry point hasil deteksi')
        .option('--dry-run', 'Tampilkan konfigurasi tanpa menulis file')
        .action((targetPath, options) => initCommand(targetPath, options));
}

/**
 * Mendeteksi profil proyek dan menghasilkan konfigurasi dengan satu alur untuk
 * JavaScript, TypeScript, ESM, CommonJS, framework, CLI, dan workspace.
 */
export async function initCommand(targetPathOrOptions = '.', maybeOptions = {}) {
    const { targetPath, options } = normalizeInvocation(targetPathOrOptions, maybeOptions);
    const projectRoot = path.resolve(process.cwd(), targetPath);

    if (options.mode && !VALID_MODES.has(options.mode)) {
        throw new Error(`Mode '${options.mode}' tidak didukung. Gunakan vanilla, react, next, atau vue.`);
    }
    if (options.projectType && !VALID_PROJECT_TYPES.has(options.projectType)) {
        throw new Error(`Project type '${options.projectType}' tidak didukung. Gunakan application, library, cli, atau monorepo.`);
    }

    if (!await fs.pathExists(projectRoot) || !(await fs.stat(projectRoot)).isDirectory()) {
        throw new Error(`Direktori proyek tidak ditemukan: ${projectRoot}`);
    }

    const existingPaths = (await Promise.all(CONFIG_NAMES.map(async name => {
        const configPath = path.join(projectRoot, name);
        return await fs.pathExists(configPath) ? configPath : null;
    }))).filter(Boolean);

    if (existingPaths.length > 0 && !options.force && !options.dryRun) {
        console.log(chalk.yellow('\n[!] Konfigurasi DeadKiller sudah ada:'));
        existingPaths.forEach(configPath => console.log(chalk.gray(`    - ${path.basename(configPath)}`)));
        console.log(chalk.gray('Gunakan --force untuk membuat backup dan menggantinya.'));
        return { skipped: true, existingPaths };
    }

    const profile = await inspectProject(projectRoot);
    printProfile(profile, projectRoot);

    let useRecommended = Boolean(options.yes);
    if (!options.yes) {
        const answer = await inquirer.prompt([{
            type: 'confirm',
            name: 'useRecommended',
            message: 'Gunakan konfigurasi rekomendasi di atas?',
            default: true,
        }]);
        useRecommended = answer.useRecommended;
    }

    if (options.mode) profile.mode = options.mode;
    if (options.projectType) profile.projectType = options.projectType;
    if (options.projectType) profile.preserveExports = ['library', 'cli', 'monorepo'].includes(options.projectType);

    let additionalEntries = normalizeEntries(options.entry);
    let format = normalizeFormat(options.format);
    let config = createRecommendedConfig(profile);

    if (!useRecommended) {
        const custom = await inquirer.prompt([
            {
                type: 'list',
                name: 'mode',
                message: 'Mode analisis:',
                choices: MODE_CHOICES,
                default: profile.mode,
            },
            {
                type: 'list',
                name: 'projectType',
                message: 'Jenis proyek:',
                choices: PROJECT_TYPE_CHOICES,
                default: profile.projectType,
            },
            {
                type: 'input',
                name: 'additionalEntries',
                message: 'Entry point tambahan (opsional, pisahkan koma):',
                default: additionalEntries.join(', '),
            },
            {
                type: 'list',
                name: 'format',
                message: 'Format konfigurasi:',
                choices: [
                    { name: 'deadkiller.config.mjs (disarankan untuk ESM dan CommonJS)', value: 'mjs' },
                    { name: '.deadkillerrc.json (statis)', value: 'json' },
                ],
                default: format,
            },
        ]);
        profile.mode = options.mode || custom.mode;
        profile.projectType = options.projectType || custom.projectType;
        profile.preserveExports = ['library', 'cli', 'monorepo'].includes(profile.projectType);
        additionalEntries = normalizeEntries([options.entry || [], custom.additionalEntries].flat());
        format = normalizeFormat(options.format || custom.format);
        config = createRecommendedConfig(profile);
    }

    console.log(chalk.gray('[>] Mendeteksi runtime, test, config, workspace, dan entry tambahan...'));
    const detectedEntries = await discoverEntries(projectRoot, config, additionalEntries);
    let entryPoints;

    if (detectedEntries.length === 0) {
        console.log(chalk.yellow('    [!] Entry point belum dapat dideteksi.'));
        if (options.yes) {
            throw new Error('Entry point tidak ditemukan. Jalankan kembali dengan --entry <path/glob> atau tanpa --yes untuk mengisinya secara interaktif.');
        }
        entryPoints = await promptForManualEntries();
    } else if (!useRecommended && options.entryReview !== false) {
        console.log(chalk.green(`    [v] ${detectedEntries.length} entry point ditemukan (${summarizeEntryKinds(detectedEntries)}).`));
        entryPoints = await selectDetectedEntries(detectedEntries);
    } else if (!useRecommended) {
        entryPoints = detectedEntries.map(entry => entry.relativePath);
        console.log(chalk.green(`    [v] ${entryPoints.length} entry point dipilih otomatis (${summarizeEntryKinds(detectedEntries)}).`));
    } else {
        // Entry hasil konvensi tidak dipersistenkan satu per satu. Scan berikutnya
        // mendeteksinya kembali agar config tetap kecil dan tidak cepat basi.
        entryPoints = additionalEntries;
        console.log(chalk.green(`    [v] Auto-discovery terverifikasi: ${detectedEntries.length} entry (${summarizeEntryKinds(detectedEntries)}).`));
    }

    config.entryPoints = [...new Set(entryPoints)];

    if (options.dryRun) {
        console.log(chalk.bold('\n--- Preview konfigurasi ---'));
        console.log(serializeConfig(config, format, profile));
        return { dryRun: true, config, profile, format, projectRoot, detectedEntries };
    }

    const { targetPath: configPath, backupDirectory } = await writeConfig(
        projectRoot,
        format,
        config,
        profile,
        existingPaths,
        Boolean(options.force),
    );

    console.log(chalk.green(`\n[ok] Konfigurasi dibuat: ${path.basename(configPath)}`));
    if (backupDirectory) {
        console.log(chalk.gray(`     Backup konfigurasi lama: ${path.relative(projectRoot, backupDirectory)}`));
    }
    const entrySummary = config.entryPoints.length > 0
        ? `${config.entryPoints.length} entry eksplisit`
        : `${detectedEntries.length} entry via auto-discovery`;
    console.log(chalk.gray(`     Mode ${profile.mode} | ${profile.language} | ${profile.moduleSystem} | ${entrySummary}`));
    const scanTarget = path.relative(process.cwd(), projectRoot) || '.';
    console.log(`\nJalankan ${chalk.cyan(`deadkiller scan "${scanTarget}"`)} untuk audit pertama.\n`);

    return { configPath, config, profile, format, projectRoot, backupDirectory, detectedEntries };
}
