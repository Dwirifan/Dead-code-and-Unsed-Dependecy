import estraverse from 'estraverse';
import { visitorKeys as tsVisitorKeys } from '@typescript-eslint/visitor-keys';

// Gabungkan visitor keys ESTree + TypeScript/JSX
const visitorKeys = { ...estraverse.VisitorKeys, ...tsVisitorKeys };

/**
 * ═══════════════════════════════════════════════════════════════════
 * REACT BAD SMELLS ANALYZER
 * ═══════════════════════════════════════════════════════════════════
 * 
 * Mendeteksi anti-pattern yang berdampak pada performa React/JSX:
 * 
 *   Rule 1 — Too Many States    : Komponen menggunakan lebih dari 5 useState hook
 *   Rule 2 — Too Many Props     : Komponen menerima lebih dari 7 props
 *   Rule 3 — Unnecessary Wrapper: Elemen <div>/<span> pembungkus tanpa atribut
 *                                 yang hanya memiliki satu child langsung
 *   Rule 4 — Missing Key        : Elemen JSX di dalam .map() tanpa atribut key
 * 
 * Hanya dijalankan untuk file dengan ekstensi .jsx dan .tsx.
 * 
 * @param {object} ast - ESTree/TSEstree AST root
 * @returns {Array} Array temuan bad smells
 */
export function analyzeReactSmells(ast) {
    const findings = [];
    const TOO_MANY_STATES_THRESHOLD = 5;
    const TOO_MANY_PROPS_THRESHOLD  = 7;

    // ══════════════════════════════════════════════════════════════
    // RULE 1 — Too Many States
    // Melacak jumlah pemanggilan useState per komponen fungsional.
    // Setiap panggilan useState() baru memicu re-render yang bisa
    // dihindari dengan menggabungkan state ke dalam satu objek.
    // ══════════════════════════════════════════════════════════════
    _detectTooManyStates(ast, findings, TOO_MANY_STATES_THRESHOLD, visitorKeys);

    // ══════════════════════════════════════════════════════════════
    // RULE 2 — Too Many Props
    // Komponen yang menerima terlalu banyak props menandakan
    // pelanggaran Single Responsibility Principle dan sulit diuji.
    // ══════════════════════════════════════════════════════════════
    _detectTooManyProps(ast, findings, TOO_MANY_PROPS_THRESHOLD, visitorKeys);

    // ══════════════════════════════════════════════════════════════
    // RULE 3 — Unnecessary Wrapper
    // Tag <div> atau <span> yang hanya membungkus satu child tanpa
    // atribut CSS/event apapun dapat diganti dengan <></> (Fragment)
    // untuk mengurangi kedalaman pohon DOM secara tidak perlu.
    // ══════════════════════════════════════════════════════════════
    _detectUnnecessaryWrapper(ast, findings, visitorKeys);

    // ══════════════════════════════════════════════════════════════
    // RULE 4 — Missing Key
    // Setiap elemen yang dihasilkan oleh iterasi (seperti .map())
    // harus memiliki atribut `key` yang unik. Tanpa `key`, React
    // tidak bisa mengoptimalkan rekonsiliasi VDOM dan akan
    // merender ulang seluruh daftar secara tidak efisien.
    // ══════════════════════════════════════════════════════════════
    _detectMissingKey(ast, findings, visitorKeys);

    return findings;
}

// ─── Private Helpers ──────────────────────────────────────────────

/**
 * Mendeteksi komponen fungsional React yang memanggil useState
 * melebihi batas threshold yang ditentukan.
 */
function _detectTooManyStates(ast, findings, threshold, visitorKeys) {
    // Telusuri fungsi-fungsi di level atas (kandidat komponen React)
    const topLevelFunctions = _collectTopLevelFunctions(ast);

    for (const fn of topLevelFunctions) {
        let stateCount = 0;
        let firstStateLine = null;

        estraverse.traverse(fn.node, {
            fallback: 'iteration',
            keys: visitorKeys,
            enter(node) {
                // Deteksi pola: useState(...) atau React.useState(...)
                if (
                    node.type === 'CallExpression' &&
                    (
                        (node.callee.type === 'Identifier' && node.callee.name === 'useState') ||
                        (node.callee.type === 'MemberExpression' &&
                         node.callee.property.type === 'Identifier' &&
                         node.callee.property.name === 'useState')
                    )
                ) {
                    stateCount++;
                    if (!firstStateLine && node.loc) {
                        firstStateLine = node.loc.start.line;
                    }
                }
            }
        });

        if (stateCount > threshold) {
            findings.push({
                name: `Too Many States: komponen '${fn.name}' memiliki ${stateCount} useState (maks: ${threshold})`,
                type: 'ReactSmell',
                rule: 'too-many-states',
                line: fn.line,
                node: fn.node
            });
        }
    }
}

/**
 * Mendeteksi komponen fungsional React yang menerima terlalu banyak props
 * (melebihi batas threshold yang ditentukan).
 */
function _detectTooManyProps(ast, findings, threshold, visitorKeys) {
    const topLevelFunctions = _collectTopLevelFunctions(ast);

    for (const fn of topLevelFunctions) {
        const node = fn.node;

        // Komponen React biasanya menerima satu parameter (props object)
        if (!node.params || node.params.length === 0) continue;

        const firstParam = node.params[0];
        let propCount = 0;

        // Pola: function Comp({ a, b, c }) — ObjectPattern destructuring
        if (firstParam.type === 'ObjectPattern' && firstParam.properties) {
            propCount = firstParam.properties.filter(p => p.type === 'Property').length;
        }

        if (propCount > threshold) {
            findings.push({
                name: `Too Many Props: komponen '${fn.name}' menerima ${propCount} props (maks: ${threshold})`,
                type: 'ReactSmell',
                rule: 'too-many-props',
                line: fn.line,
                node: node
            });
        }
    }
}

/**
 * Mendeteksi elemen JSX wrapper yang tidak perlu:
 * <div> atau <span> tanpa atribut yang hanya membungkus satu child.
 */
function _detectUnnecessaryWrapper(ast, findings, visitorKeys) {
    const PLAIN_WRAPPERS = new Set(['div', 'span', 'section', 'article', 'main']);

    estraverse.traverse(ast, {
        fallback: 'iteration',
        keys: visitorKeys,
        enter(node) {
            if (node.type !== 'JSXElement') return;

            const opening = node.openingElement;
            if (!opening || opening.type !== 'JSXOpeningElement') return;

            // Ambil nama tag (harus string, bukan komponen)
            const tagName = opening.name && opening.name.type === 'JSXIdentifier'
                ? opening.name.name
                : null;

            if (!tagName || !PLAIN_WRAPPERS.has(tagName)) return;

            // Tidak boleh memiliki atribut apapun (className, style, onClick, dsb.)
            if (opening.attributes && opening.attributes.length > 0) return;

            // Harus hanya memiliki tepat satu child JSXElement/JSXExpressionContainer
            const meaningfulChildren = (node.children || []).filter(
                c => c.type === 'JSXElement' ||
                     c.type === 'JSXExpressionContainer' ||
                     c.type === 'JSXFragment'
            );

            if (meaningfulChildren.length === 1) {
                findings.push({
                    name: `Unnecessary Wrapper: <${tagName}> tanpa atribut membungkus satu child — pertimbangkan ganti dengan <></>`,
                    type: 'ReactSmell',
                    rule: 'unnecessary-wrapper',
                    line: opening.loc ? opening.loc.start.line : 0,
                    node: node
                });
            }
        }
    });
}

/**
 * Mendeteksi elemen JSX yang dihasilkan dari operasi iterasi (.map())
 * yang tidak memiliki atribut `key`.
 */
function _detectMissingKey(ast, findings, visitorKeys) {
    estraverse.traverse(ast, {
        fallback: 'iteration',
        keys: visitorKeys,
        enter(node) {
            // Cari pola: expression.map(callback)
            if (
                node.type !== 'CallExpression' ||
                node.callee.type !== 'MemberExpression' ||
                node.callee.property.type !== 'Identifier' ||
                node.callee.property.name !== 'map'
            ) return;

            // Ambil callback argument (.map(fn))
            const callback = node.arguments && node.arguments[0];
            if (!callback) return;

            // Dapatkan body dari callback function
            let returnedJSX = null;

            // Arrow function dengan implicit return: x => <div />
            if (
                (callback.type === 'ArrowFunctionExpression' || callback.type === 'FunctionExpression') &&
                callback.body
            ) {
                if (callback.body.type === 'JSXElement' || callback.body.type === 'JSXFragment') {
                    returnedJSX = callback.body;
                } else if (callback.body.type === 'BlockStatement') {
                    // Arrow function dengan explicit return: x => { return <div /> }
                    for (const stmt of (callback.body.body || [])) {
                        if (stmt.type === 'ReturnStatement' && stmt.argument &&
                            (stmt.argument.type === 'JSXElement' || stmt.argument.type === 'JSXFragment')) {
                            returnedJSX = stmt.argument;
                            break;
                        }
                    }
                }
            }

            if (!returnedJSX || returnedJSX.type !== 'JSXElement') return;

            // Cek apakah JSXElement memiliki atribut `key`
            const opening = returnedJSX.openingElement;
            if (!opening || !opening.attributes) return;

            const hasKey = opening.attributes.some(
                attr => attr.type === 'JSXAttribute' &&
                        attr.name &&
                        attr.name.name === 'key'
            );

            if (!hasKey) {
                const tagName = opening.name && opening.name.name ? opening.name.name : 'element';
                findings.push({
                    name: `Missing Key: <${tagName}> di dalam .map() tidak memiliki atribut key`,
                    type: 'ReactSmell',
                    rule: 'missing-key',
                    line: opening.loc ? opening.loc.start.line : 0,
                    node: returnedJSX
                });
            }
        }
    });
}

/**
 * Mengumpulkan semua fungsi/komponen React yang dideklarasikan di level atas (top-level).
 * Mengembalikan daftar { name, line, node }.
 */
function _collectTopLevelFunctions(ast) {
    const results = [];

    for (const node of (ast.body || [])) {
        // function Komponen() {}
        if (node.type === 'FunctionDeclaration' && node.id) {
            results.push({ name: node.id.name, line: node.loc?.start.line ?? 0, node });
        }

        // const Komponen = () => {} atau const Komponen = function() {}
        if (node.type === 'VariableDeclaration') {
            for (const decl of node.declarations) {
                if (
                    decl.id && decl.id.type === 'Identifier' && decl.init &&
                    (decl.init.type === 'ArrowFunctionExpression' || decl.init.type === 'FunctionExpression')
                ) {
                    results.push({ name: decl.id.name, line: decl.loc?.start.line ?? 0, node: decl.init });
                }
            }
        }

        // export default function Komponen() {}
        if (
            node.type === 'ExportDefaultDeclaration' &&
            node.declaration &&
            (node.declaration.type === 'FunctionDeclaration' || node.declaration.type === 'ArrowFunctionExpression')
        ) {
            const name = node.declaration.id ? node.declaration.id.name : '(default)';
            results.push({ name, line: node.loc?.start.line ?? 0, node: node.declaration });
        }

        // export function Komponen() {}
        if (
            node.type === 'ExportNamedDeclaration' &&
            node.declaration &&
            node.declaration.type === 'FunctionDeclaration' &&
            node.declaration.id
        ) {
            results.push({ name: node.declaration.id.name, line: node.loc?.start.line ?? 0, node: node.declaration });
        }
    }

    return results;
}
