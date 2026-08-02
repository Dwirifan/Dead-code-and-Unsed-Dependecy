import fs from 'fs-extra';
import path from 'node:path';

/**
 * Pemeriksaan containment leksikal yang juga aman untuk path yang belum ada.
 */
export function isPathInsideRoot(projectRoot, candidatePath) {
    const absoluteRoot = path.resolve(projectRoot);
    const absoluteCandidate = path.resolve(candidatePath);
    const relativePath = path.relative(absoluteRoot, absoluteCandidate);
    return relativePath === '' || (
        relativePath !== '..' &&
        !relativePath.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relativePath)
    );
}

/**
 * Pemeriksaan untuk path yang sudah ada. Realpath mencegah symlink di dalam
 * proyek menunjuk ke file di luar root. Error filesystem selalu fail-closed.
 */
export function isExistingPathInsideRoot(projectRoot, candidatePath) {
    if (!isPathInsideRoot(projectRoot, candidatePath)) return false;
    try {
        const realRoot = fs.realpathSync(path.resolve(projectRoot));
        const realCandidate = fs.realpathSync(path.resolve(candidatePath));
        return isPathInsideRoot(realRoot, realCandidate);
    } catch (_error) {
        return false;
    }
}

export function assertExistingPathInsideRoot(projectRoot, candidatePath, operation = 'mengakses') {
    if (isExistingPathInsideRoot(projectRoot, candidatePath)) return;
    const error = new Error(
        `DeadKiller menolak ${operation} path di luar root proyek: ${candidatePath}`,
    );
    error.code = 'DEADKILLER_PATH_OUTSIDE_PROJECT';
    error.path = candidatePath;
    error.projectRoot = projectRoot;
    throw error;
}
