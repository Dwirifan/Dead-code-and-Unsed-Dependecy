import micromatch from 'micromatch';

const GLOB_CHARACTERS = new Set(['*', '?', '[', ']', '{', '}', '(', ')']);
const KNOWN_DOT_DIRECTORIES = new Set([
    '.cache', '.deadkiller_backup', '.git', '.next', '.nuxt', '.svelte-kit', '.turbo',
]);

function hasGlobSyntax(pattern) {
    return [...pattern].some(character => GLOB_CHARACTERS.has(character));
}

function expandLegacyPattern(rawPattern) {
    const negative = rawPattern.startsWith('!') && !rawPattern.startsWith('!(');
    const prefix = negative ? '!' : '';
    const unnormalizedPattern = negative ? rawPattern.slice(1) : rawPattern;
    const explicitDirectory = /[\\/]$/.test(unnormalizedPattern);
    const pattern = unnormalizedPattern
        .replace(/\\/g, '/')
        .replace(/^\.\//, '')
        .replace(/\/+$/, '');

    if (!pattern || hasGlobSyntax(pattern)) return [`${prefix}${pattern}`];

    const basename = pattern.split('/').at(-1);
    const directoryLike = explicitDirectory ||
        !basename.includes('.') ||
        KNOWN_DOT_DIRECTORIES.has(basename);

    // File literal seperti `src/index.js` hanya cocok pada path tersebut. Ini
    // mempertahankan semantik lama dan mencegah file bernama sama di workspace
    // lain ikut diabaikan.
    if (!directoryLike) return [`${prefix}${pattern}`];

    // Konfigurasi lama menerima nama direktori polos seperti `dist` atau
    // `src/generated`. Normalisasikan ke glob berbasis segmen agar tidak lagi
    // memakai pencocokan substring yang dapat mengenai path seperti `distinct`.
    return [
        `${prefix}**/${pattern}`,
        `${prefix}**/${pattern}/**`,
    ];
}

export function normalizeOrderedPatterns(patterns, { legacyDirectories = false } = {}) {
    if (!Array.isArray(patterns)) return [];
    return patterns.flatMap(pattern => (
        legacyDirectories ? expandLegacyPattern(pattern) : [pattern.replace(/\\/g, '/')]
    ));
}

/**
 * Mencocokkan satu path terhadap daftar glob berurutan. Pola negasi hanya
 * membatalkan pola positif sebelumnya dan tidak membuat semua file lain cocok.
 */
export function matchesOrderedPatterns(
    relativePath,
    patterns,
    { dot = true, legacyDirectories = false } = {},
) {
    const normalizedPatterns = normalizeOrderedPatterns(patterns, { legacyDirectories });
    if (!normalizedPatterns.some(pattern => !pattern.startsWith('!') || pattern.startsWith('!('))) {
        return false;
    }

    const normalizedPath = String(relativePath).replace(/\\/g, '/').replace(/^\.\//, '');
    return micromatch([normalizedPath], normalizedPatterns, { dot }).length > 0;
}
