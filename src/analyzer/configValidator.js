import micromatch from 'micromatch';

const LIST_FIELDS = new Set([
    'entryPoints',
    'preserveFiles',
    'ignoreFiles',
    'ignoreDependencies',
    'globals',
]);

const BOOLEAN_FIELDS = new Set([
    'preserveUnsafeFiles',
    'detectDeadStores',
]);

const KNOWN_FIELDS = new Set([
    'mode',
    'ignorePrefixedVariables',
    'preserveExports',
    'reactRuntime',
    'overrides',
    'eliminator',
    ...LIST_FIELDS,
    ...BOOLEAN_FIELDS,
]);

export class ConfigValidationError extends Error {
    constructor(diagnostics) {
        const summary = diagnostics
            .filter(item => item.level === 'error')
            .map(item => `${item.path}: ${item.message}`)
            .join('; ');
        super(`Konfigurasi DeadKiller tidak valid: ${summary}`);
        this.name = 'ConfigValidationError';
        this.code = 'DEADKILLER_INVALID_CONFIG';
        this.diagnostics = diagnostics;
    }
}

function diagnostic(level, code, configPath, message) {
    return { level, code, path: configPath, message };
}

function isPlainObject(value) {
    return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeStringList(value, configPath, diagnostics, { paths = false } = {}) {
    let values = value;
    if (typeof values === 'string') {
        values = [values];
        diagnostics.push(diagnostic(
            'warning',
            'CONFIG_LIST_NORMALIZED',
            configPath,
            'Nilai string tunggal dinormalisasi menjadi array.',
        ));
    }
    if (!Array.isArray(values) || values.some(item => typeof item !== 'string')) {
        diagnostics.push(diagnostic('error', 'CONFIG_EXPECTED_STRING_ARRAY', configPath, 'Harus berupa array string.'));
        return [];
    }

    const normalized = values.map(item => item.trim()).filter(Boolean).map(item => (
        paths ? item.replace(/\\/g, '/') : item
    ));
    if (normalized.length !== values.length) {
        diagnostics.push(diagnostic('warning', 'CONFIG_EMPTY_LIST_ITEM', configPath, 'Item kosong dihapus dari daftar.'));
    }
    return [...new Set(normalized)];
}

function validateGlobList(values, configPath, diagnostics) {
    for (const pattern of values) {
        try {
            micromatch.makeRe(pattern);
        } catch (error) {
            diagnostics.push(diagnostic('error', 'CONFIG_INVALID_GLOB', configPath, `Glob '${pattern}' tidak valid: ${error.message}`));
        }
    }
}

function normalizeEliminator(value, defaults, configPath, diagnostics) {
    if (!isPlainObject(value)) {
        diagnostics.push(diagnostic('error', 'CONFIG_EXPECTED_OBJECT', configPath, 'Harus berupa object.'));
        return { ...defaults };
    }

    const result = { ...defaults };
    const booleanKeys = ['autoRenameUnusedParameters', 'autoRemoveEmptyBlocks'];
    for (const key of booleanKeys) {
        if (value[key] === undefined) continue;
        if (typeof value[key] !== 'boolean') {
            diagnostics.push(diagnostic('error', 'CONFIG_EXPECTED_BOOLEAN', `${configPath}.${key}`, 'Harus berupa boolean.'));
        } else {
            result[key] = value[key];
        }
    }
    if (value.maxBackups !== undefined) {
        if (value.maxBackups !== false && (!Number.isInteger(value.maxBackups) || value.maxBackups < 0)) {
            diagnostics.push(diagnostic('error', 'CONFIG_INVALID_MAX_BACKUPS', `${configPath}.maxBackups`, 'Harus berupa false atau bilangan bulat >= 0.'));
        } else {
            result.maxBackups = value.maxBackups;
        }
    }

    for (const key of Object.keys(value)) {
        if (![...booleanKeys, 'maxBackups'].includes(key)) {
            diagnostics.push(diagnostic('error', 'CONFIG_UNKNOWN_KEY', `${configPath}.${key}`, 'Opsi tidak dikenal. Periksa kemungkinan typo.'));
        }
    }
    return result;
}

function normalizeRuleObject(value, defaults, configPath, diagnostics, { override = false } = {}) {
    if (!isPlainObject(value)) {
        diagnostics.push(diagnostic('error', 'CONFIG_EXPECTED_OBJECT', configPath, 'Harus berupa object.'));
        return {};
    }

    const result = override ? {} : { ...defaults, eliminator: { ...(defaults.eliminator || {}) } };
    for (const [key, fieldValue] of Object.entries(value)) {
        const fieldPath = configPath ? `${configPath}.${key}` : key;

        if (override && key === 'files') {
            const normalized = normalizeStringList(fieldValue, fieldPath, diagnostics, { paths: true });
            validateGlobList(normalized, fieldPath, diagnostics);
            result.files = normalized;
            continue;
        }
        if (!KNOWN_FIELDS.has(key)) {
            diagnostics.push(diagnostic('error', 'CONFIG_UNKNOWN_KEY', fieldPath, 'Opsi tidak dikenal. Periksa kemungkinan typo.'));
            continue;
        }
        if (LIST_FIELDS.has(key)) {
            const normalized = normalizeStringList(fieldValue, fieldPath, diagnostics, {
                paths: ['entryPoints', 'preserveFiles', 'ignoreFiles'].includes(key),
            });
            if (['entryPoints', 'preserveFiles', 'ignoreFiles'].includes(key)) {
                validateGlobList(normalized, fieldPath, diagnostics);
            }
            result[key] = normalized;
            continue;
        }
        if (BOOLEAN_FIELDS.has(key)) {
            if (typeof fieldValue !== 'boolean') {
                diagnostics.push(diagnostic('error', 'CONFIG_EXPECTED_BOOLEAN', fieldPath, 'Harus berupa boolean.'));
            } else {
                result[key] = fieldValue;
            }
            continue;
        }

        switch (key) {
            case 'mode':
                if (!['vanilla', 'react', 'next', 'vue'].includes(fieldValue)) {
                    diagnostics.push(diagnostic('error', 'CONFIG_INVALID_MODE', fieldPath, 'Gunakan vanilla, react, next, atau vue.'));
                } else result.mode = fieldValue;
                break;
            case 'reactRuntime':
                if (!['classic', 'automatic'].includes(fieldValue)) {
                    diagnostics.push(diagnostic('error', 'CONFIG_INVALID_REACT_RUNTIME', fieldPath, 'Gunakan classic atau automatic.'));
                } else result.reactRuntime = fieldValue;
                break;
            case 'preserveExports':
                if (typeof fieldValue !== 'boolean' && fieldValue !== 'strict') {
                    diagnostics.push(diagnostic('error', 'CONFIG_INVALID_PRESERVE_EXPORTS', fieldPath, "Harus berupa boolean atau 'strict'."));
                } else result.preserveExports = fieldValue;
                break;
            case 'ignorePrefixedVariables':
                if (fieldValue === false || fieldValue === null) {
                    result.ignorePrefixedVariables = null;
                } else if (typeof fieldValue !== 'string') {
                    diagnostics.push(diagnostic('error', 'CONFIG_EXPECTED_REGEX_STRING', fieldPath, 'Harus berupa string regex, false, atau null.'));
                } else {
                    try {
                        new RegExp(fieldValue);
                        result.ignorePrefixedVariables = fieldValue;
                    } catch (error) {
                        diagnostics.push(diagnostic('error', 'CONFIG_INVALID_REGEX', fieldPath, `Regex tidak valid: ${error.message}`));
                    }
                }
                break;
            case 'eliminator':
                result.eliminator = normalizeEliminator(fieldValue, defaults.eliminator || {}, fieldPath, diagnostics);
                break;
            case 'overrides':
                if (!Array.isArray(fieldValue)) {
                    diagnostics.push(diagnostic('error', 'CONFIG_EXPECTED_ARRAY', fieldPath, 'Harus berupa array object override.'));
                    result.overrides = [];
                    break;
                }
                result.overrides = fieldValue.map((item, index) => {
                    const overridePath = `${fieldPath}[${index}]`;
                    const normalized = normalizeRuleObject(item, defaults, overridePath, diagnostics, { override: true });
                    if (!normalized.files || normalized.files.length === 0) {
                        diagnostics.push(diagnostic('error', 'CONFIG_OVERRIDE_FILES_REQUIRED', `${overridePath}.files`, 'Override wajib memiliki files.'));
                    }
                    return normalized;
                });
                break;
            default:
                break;
        }
    }
    return result;
}

export function validateAndNormalizeConfig(userConfig, defaults) {
    const diagnostics = [];
    const config = normalizeRuleObject(userConfig, defaults, '', diagnostics);
    if (diagnostics.some(item => item.level === 'error')) {
        throw new ConfigValidationError(diagnostics);
    }
    return { config, diagnostics };
}
