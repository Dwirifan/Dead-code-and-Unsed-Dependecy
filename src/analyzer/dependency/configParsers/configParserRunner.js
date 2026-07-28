import { parseEslintConfigDetailed } from './eslintParser.js';
import { parseBabelConfigDetailed } from './babelParser.js';
import { parsePackageJsonConfigDetailed } from './packageJsonConfigParser.js';

const PARSERS = [
    { name: 'eslint', run: parseEslintConfigDetailed },
    { name: 'babel', run: parseBabelConfigDetailed },
    { name: 'package-json-implicit', run: parsePackageJsonConfigDetailed },
];

/**
 * Kontrak detail untuk consumer baru.
 *
 * @returns {Promise<{
 *   usedPackages: Set<string>,
 *   diagnostics: Array<object>,
 *   files: string[],
 *   complete: boolean
 * }>}
 */
export async function runConfigParsersDetailed(projectRoot) {
    const usedPackages = new Set();
    const diagnostics = [];
    const files = [];

    const results = await Promise.allSettled(
        PARSERS.map(parser => parser.run(projectRoot)),
    );

    results.forEach((result, index) => {
        const parserName = PARSERS[index].name;
        if (result.status === 'rejected') {
            diagnostics.push({
                source: projectRoot,
                parser: parserName,
                code: 'CONFIG_PARSER_FAILED',
                severity: 'warning',
                message: `${parserName} config parser gagal: ${result.reason?.message || result.reason}`,
                line: null,
                affectsDependencyClassification: true,
            });
            return;
        }

        const detail = result.value;
        for (const pkg of detail.packages || []) {
            if (pkg) usedPackages.add(pkg);
        }
        diagnostics.push(...(detail.diagnostics || []).map(item => ({
            parser: parserName,
            ...item,
        })));
        files.push(...(detail.files || []));
    });

    return {
        usedPackages,
        diagnostics,
        files: [...new Set(files)],
        complete: !diagnostics.some(item => item.affectsDependencyClassification),
    };
}

/**
 * API lama dipertahankan sebagai Set<string>. Metadata baru ditempelkan secara
 * non-enumerable agar iterasi/serialisasi consumer lama tidak berubah.
 */
export async function runConfigParsers(projectRoot) {
    const result = await runConfigParsersDetailed(projectRoot);
    const packages = result.usedPackages;
    Object.defineProperties(packages, {
        diagnostics: {
            value: result.diagnostics,
            enumerable: false,
        },
        files: {
            value: result.files,
            enumerable: false,
        },
        complete: {
            value: result.complete,
            enumerable: false,
        },
    });
    return packages;
}
