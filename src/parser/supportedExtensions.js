export const SCRIPT_EXTENSIONS = Object.freeze([
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.ts',
    '.tsx',
    '.mts',
    '.cts',
]);

export const SCRIPT_EXTENSION_SET = new Set(SCRIPT_EXTENSIONS);
export const SCRIPT_GLOB = `**/*.{${SCRIPT_EXTENSIONS.map(extension => extension.slice(1)).join(',')}}`;

export function isSupportedScript(filePath) {
    const normalized = String(filePath).toLowerCase();
    return SCRIPT_EXTENSIONS.some(extension => normalized.endsWith(extension));
}
