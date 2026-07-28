import fs from 'fs-extra';
import path from 'path';
import { spawnSync } from 'child_process';

const COMMAND_TIMEOUT_MS = 120_000;
const SUPPORTED_PACKAGE_MANAGERS = new Set(['npm', 'yarn', 'pnpm', 'bun']);

function parsePackageManagerField(value) {
    if (typeof value !== 'string') return null;

    const match = /^(npm|yarn|pnpm|bun)(?:@.+)?$/i.exec(value.trim());
    if (!match) return null;

    const manager = match[1].toLowerCase();
    return SUPPORTED_PACKAGE_MANAGERS.has(manager) ? manager : null;
}

async function detectPackageManager(projectRoot, pkg) {
    const declaredManager = parsePackageManagerField(pkg?.packageManager);
    if (declaredManager) return declaredManager;

    const lockfileCandidates = [
        ['yarn', 'yarn.lock'],
        ['pnpm', 'pnpm-lock.yaml'],
        ['bun', 'bun.lock'],
        ['bun', 'bun.lockb'],
        ['npm', 'package-lock.json'],
        ['npm', 'npm-shrinkwrap.json']
    ];

    const detectedManagers = new Set();
    for (const [manager, lockfile] of lockfileCandidates) {
        if (await fs.pathExists(path.join(projectRoot, lockfile))) {
            detectedManagers.add(manager);
        }
    }

    if (detectedManagers.size > 1) {
        throw new Error(
            `Beberapa package manager terdeteksi (${[...detectedManagers].join(', ')}). ` +
            'Tetapkan field packageManager di package.json atau hapus lockfile yang sudah tidak digunakan.'
        );
    }
    if (detectedManagers.size === 1) return [...detectedManagers][0];

    return 'npm';
}

function isValidPackageName(dep) {
    if (typeof dep !== 'string' || dep.length === 0 || dep.length > 214) return false;
    if (dep !== dep.toLowerCase()) return false;

    // Tepat satu slash hanya diizinkan untuk scoped package: @scope/name.
    // Awalan "." / "-" / "_" ditolak agar nilai tidak dapat menjadi path atau CLI option.
    return /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(dep);
}

function getManagerCommand(manager) {
    if (manager === 'npm') return ['uninstall'];
    return ['remove'];
}

function buildSpawnInvocation(manager, managerArgs) {
    if (process.platform !== 'win32') {
        return { executable: manager, args: managerArgs };
    }

    // File .cmd tidak dapat dieksekusi langsung oleh Node.js dengan shell:false.
    // Jalankan shim package manager melalui cmd.exe secara eksplisit, sambil tetap
    // mempertahankan shell:false pada spawnSync dan hanya meneruskan nama paket tervalidasi.
    const commandProcessor = process.env.ComSpec || process.env.COMSPEC || 'cmd.exe';
    return {
        executable: commandProcessor,
        args: ['/d', '/s', '/c', `${manager}.cmd`, ...managerArgs]
    };
}

function outputText(value) {
    if (value === undefined || value === null) return '';
    return Buffer.isBuffer(value) ? value.toString('utf8').trim() : String(value).trim();
}

/**
 * Membersihkan dan menghapus daftar dependensi yang tidak terpakai
 * secara langsung hingga ke folder node_modules dengan mengeksekusi
 * package manager bawaan (npm/yarn/pnpm/bun).
 * @param {string} projectRoot - Path direktori akar proyek
 * @param {string[]} unusedDeps - Array berisi nama-nama dependensi NPM yang akan dihapus
 * @returns {Promise<number>} Jumlah total dependensi yang berhasil dihapus
 */
export async function removeUnusedDependencies(projectRoot, unusedDeps) {
    if (!unusedDeps || unusedDeps.length === 0) return 0;
    if (!Array.isArray(unusedDeps)) {
        throw new TypeError('unusedDeps harus berupa array nama package');
    }

    const packageJsonPath = path.join(projectRoot, 'package.json');
    if (!await fs.pathExists(packageJsonPath)) {
        throw new Error('package.json not found');
    }

    const uniqueDeps = [...new Set(unusedDeps)];
    const invalidDeps = uniqueDeps.filter(dep => !isValidPackageName(dep));
    if (invalidDeps.length > 0) {
        const invalidList = invalidDeps.map(dep => JSON.stringify(dep)).join(', ');
        throw new Error(`Nama dependensi tidak valid: ${invalidList}`);
    }

    let pkg;
    try {
        pkg = await fs.readJson(packageJsonPath);
    } catch (err) {
        throw new Error(`Gagal membaca package.json: ${err.message}`, { cause: err });
    }

    const manager = await detectPackageManager(projectRoot, pkg);
    const managerArgs = [...getManagerCommand(manager), ...uniqueDeps];
    const invocation = buildSpawnInvocation(manager, managerArgs);
    const displayCommand = `${manager} ${managerArgs.join(' ')}`;

    try {
        if (process.env.DEBUG) console.log(`[DependencyCleaner] Executing: ${displayCommand}`);
        
        const result = spawnSync(invocation.executable, invocation.args, {
            cwd: projectRoot, 
            stdio: ['ignore', 'pipe', 'pipe'],
            encoding: 'utf8',
            shell: false,
            timeout: COMMAND_TIMEOUT_MS,
            windowsHide: true
        });

        const stderr = outputText(result.stderr);
        const stdout = outputText(result.stdout);
        const diagnostic = stderr || stdout;

        if (result.error) {
            const detail = diagnostic ? `${result.error.message}: ${diagnostic}` : result.error.message;
            throw new Error(detail, { cause: result.error });
        }
        if (result.status !== 0) {
            const signalDetail = result.signal ? ` (signal ${result.signal})` : '';
            const outputDetail = diagnostic ? `: ${diagnostic}` : '';
            throw new Error(`Exited with code ${result.status}${signalDetail}${outputDetail}`);
        }

        return { removed: uniqueDeps };
    } catch (err) {
        throw new Error(`Gagal menghapus dependensi. Perintah '${displayCommand}' gagal: ${err.message}`, { cause: err });
    }
}
