import path from 'path';
import { parse } from '@typescript-eslint/typescript-estree';

const STATIC_PARSER_OPTIONS = {
    loc: true,
    range: true,
    jsx: true,
    comment: true,
    errorOnUnknownASTType: false,
    allowHashBang: true,
};

function walkAst(node, visitor, parent = null) {
    if (!node || typeof node !== 'object') return;
    if (typeof node.type === 'string') visitor(node, parent);

    for (const [key, value] of Object.entries(node)) {
        if (key === 'parent' || key === 'loc' || key === 'range' || key === 'tokens' || key === 'comments') continue;
        if (Array.isArray(value)) {
            for (const child of value) {
                if (child && typeof child === 'object') walkAst(child, visitor, node);
            }
        } else if (value && typeof value === 'object') {
            walkAst(value, visitor, node);
        }
    }
}

export function getPropertyName(node) {
    if (!node || node.type !== 'Property' || node.computed) return null;
    if (node.key?.type === 'Identifier') return node.key.name;
    if (node.key?.type === 'Literal' && typeof node.key.value === 'string') return node.key.value;
    return null;
}

export function getStaticString(node) {
    if (!node) return null;
    if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
    if (node.type === 'TemplateLiteral' && node.expressions?.length === 0) {
        return node.quasis?.[0]?.value?.cooked ?? node.quasis?.[0]?.value?.raw ?? '';
    }
    return null;
}

export function packageNameFromSpecifier(specifier) {
    if (typeof specifier !== 'string' || specifier.length === 0) return null;
    if (
        specifier.startsWith('.') ||
        specifier.startsWith('/') ||
        specifier.startsWith('#') ||
        path.isAbsolute(specifier) ||
        /^[a-zA-Z]+:\/\//.test(specifier)
    ) {
        return null;
    }

    const parts = specifier.split('/');
    return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
}

function diagnostic(filePath, code, message, line = null) {
    return {
        source: filePath,
        code,
        severity: 'warning',
        message,
        line,
        affectsDependencyClassification: true,
    };
}

function isRequireCall(node) {
    return node?.type === 'CallExpression' &&
        node.callee?.type === 'Identifier' &&
        node.callee.name === 'require';
}

function isRequireResolveCall(node) {
    return node?.type === 'CallExpression' &&
        node.callee?.type === 'MemberExpression' &&
        node.callee.computed === false &&
        node.callee.object?.type === 'Identifier' &&
        node.callee.object.name === 'require' &&
        node.callee.property?.type === 'Identifier' &&
        node.callee.property.name === 'resolve';
}

function addModuleSpecifier(specifier, filePath, packages, diagnostics) {
    const packageName = packageNameFromSpecifier(specifier);
    if (packageName) {
        packages.add(packageName);
        return;
    }

    if (
        typeof specifier === 'string' &&
        (specifier.startsWith('.') || specifier.startsWith('/') || path.isAbsolute(specifier))
    ) {
        diagnostics.push(diagnostic(
            filePath,
            'CONFIG_LOCAL_REFERENCE_UNRESOLVED',
            `Referensi config lokal '${specifier}' tidak ditelusuri secara rekursif; klasifikasi dependency dibuat konservatif.`,
        ));
    }
}

/**
 * Parse konfigurasi JavaScript/TypeScript tanpa mengeksekusi modulnya.
 * Hasil AST dan import binding digunakan parser ESLint/Babel untuk ekstraksi semantik.
 */
export function parseStaticJavaScriptConfig(code, filePath) {
    const packages = new Set();
    const importedBindings = new Set();
    const diagnostics = [];

    let ast;
    try {
        ast = parse(code, {
            ...STATIC_PARSER_OPTIONS,
            filePath,
        });
    } catch (err) {
        return {
            ast: null,
            packages,
            importedBindings,
            diagnostics: [diagnostic(
                filePath,
                'CONFIG_STATIC_PARSE_FAILED',
                `Config tidak dapat diparse secara statis: ${err.message}`,
                err.lineNumber || null,
            )],
            complete: false,
        };
    }

    walkAst(ast, (node) => {
        if (node.type === 'ImportDeclaration') {
            const specifier = getStaticString(node.source);
            addModuleSpecifier(specifier, filePath, packages, diagnostics);
            for (const spec of node.specifiers || []) {
                if (spec.local?.name) importedBindings.add(spec.local.name);
            }
            return;
        }

        if (
            (node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') &&
            node.source
        ) {
            addModuleSpecifier(getStaticString(node.source), filePath, packages, diagnostics);
            return;
        }

        if (isRequireCall(node) || isRequireResolveCall(node)) {
            const specifier = getStaticString(node.arguments?.[0]);
            if (specifier === null) {
                diagnostics.push(diagnostic(
                    filePath,
                    'CONFIG_DYNAMIC_MODULE_REFERENCE',
                    'Config menggunakan require/require.resolve dinamis; dependency yang dipakai tidak dapat dipastikan.',
                    node.loc?.start?.line || null,
                ));
            } else {
                addModuleSpecifier(specifier, filePath, packages, diagnostics);
            }

            const parent = node.parent;
            if (parent?.type === 'VariableDeclarator' && parent.id?.type === 'Identifier') {
                importedBindings.add(parent.id.name);
            }
            return;
        }

        if (node.type === 'ImportExpression') {
            const specifier = getStaticString(node.source);
            if (specifier === null) {
                diagnostics.push(diagnostic(
                    filePath,
                    'CONFIG_DYNAMIC_MODULE_REFERENCE',
                    'Config menggunakan import() dinamis; dependency yang dipakai tidak dapat dipastikan.',
                    node.loc?.start?.line || null,
                ));
            } else {
                addModuleSpecifier(specifier, filePath, packages, diagnostics);
            }
        }

        if (node.type === 'CallExpression' && node.callee?.type === 'Identifier' && node.callee.name === 'eval') {
            diagnostics.push(diagnostic(
                filePath,
                'CONFIG_DYNAMIC_EVAL',
                'Config menggunakan eval(); dependency yang dipakai tidak dapat dipastikan secara statis.',
                node.loc?.start?.line || null,
            ));
        }
    });

    // TSESTree tidak menambahkan parent pointer. Kumpulkan binding CJS dalam pass terpisah.
    walkAst(ast, (node) => {
        if (node.type !== 'VariableDeclarator' || node.id?.type !== 'Identifier') return;
        if (isImportedReference(node.init, importedBindings)) {
            importedBindings.add(node.id.name);
        }
    });

    return {
        ast,
        packages,
        importedBindings,
        diagnostics,
        complete: !diagnostics.some(d => d.affectsDependencyClassification),
    };
}

export function visitAst(ast, visitor) {
    walkAst(ast, visitor);
}

function isImportedReference(node, importedBindings) {
    if (!node) return false;
    if (isRequireCall(node) || isRequireResolveCall(node)) return getStaticString(node.arguments?.[0]) !== null;
    if (node.type === 'Identifier') return importedBindings.has(node.name);
    if (node.type === 'MemberExpression') return isImportedReference(node.object, importedBindings);
    if (node.type === 'CallExpression') return isImportedReference(node.callee, importedBindings);
    return false;
}

/**
 * Membaca string statis dari value config. `tupleFirst` mendukung format
 * Babel `[pluginName, options]`. Object values dipakai oleh flat ESLint config.
 */
export function collectStaticConfigValues(node, importedBindings, options = {}) {
    const { tupleFirst = false, objectValues = false } = options;
    if (!node) return { values: [], complete: false };

    const direct = getStaticString(node);
    if (direct !== null) return { values: [direct], complete: true };

    if (isImportedReference(node, importedBindings)) {
        return { values: [], complete: true };
    }

    if (node.type === 'ArrayExpression') {
        const values = [];
        let complete = true;
        for (const element of node.elements || []) {
            if (!element) continue;
            const target = tupleFirst && element.type === 'ArrayExpression'
                ? element.elements?.[0]
                : element;
            const result = collectStaticConfigValues(target, importedBindings, {
                tupleFirst,
                objectValues,
            });
            values.push(...result.values);
            complete = complete && result.complete;
        }
        return { values, complete };
    }

    if (node.type === 'ObjectExpression' && objectValues) {
        let complete = true;
        for (const prop of node.properties || []) {
            if (prop.type === 'SpreadElement') {
                complete = complete && isImportedReference(prop.argument, importedBindings);
                continue;
            }
            if (prop.type !== 'Property') {
                complete = false;
                continue;
            }
            complete = complete && isImportedReference(prop.value, importedBindings);
        }
        return { values: [], complete };
    }

    if (node.type === 'ConditionalExpression') {
        const left = collectStaticConfigValues(node.consequent, importedBindings, options);
        const right = collectStaticConfigValues(node.alternate, importedBindings, options);
        return {
            values: [...left.values, ...right.values],
            complete: left.complete && right.complete,
        };
    }

    if (node.type === 'LogicalExpression') {
        const left = collectStaticConfigValues(node.left, importedBindings, options);
        const right = collectStaticConfigValues(node.right, importedBindings, options);
        return {
            values: [...left.values, ...right.values],
            complete: left.complete && right.complete,
        };
    }

    return { values: [], complete: false };
}

export function createIncompletePropertyDiagnostic(filePath, propertyName, node) {
    return diagnostic(
        filePath,
        'CONFIG_PROPERTY_NOT_STATIC',
        `Nilai '${propertyName}' tidak sepenuhnya statis; dependency terkait diperlakukan sebagai unknown.`,
        node?.loc?.start?.line || null,
    );
}
