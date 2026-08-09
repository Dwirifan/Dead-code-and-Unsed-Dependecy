import MagicString from 'magic-string';
import { parse } from '@typescript-eslint/typescript-estree';

/**
 * Memeriksa apakah string kode valid secara sintaksis menggunakan parser AST.
 */
function isValidSyntax(code) {
    try {
        parse(code, {
            loc: false,
            range: false,
            jsx: true,
            comment: false,
            errorOnUnknownASTType: false,
            allowHashBang: true
        });
        return true;
    } catch (_e) {
        return false;
    }
}

/**
 * Menerapkan manipulasi MagicString untuk satu node dead code tunggal.
 */
function applySingleNodeRemoval(ms, codeString, dead, ruleEngine, eliminationLevel) {
    const [start, end] = dead.node.range;

    // Level 1: Lazy Load (React Components)
    if (eliminationLevel <= 1 && dead.type === 'ReactComponent') {
        return;
    }

    // ClassMethod yang sudah diklasifikasikan SAFE (misalnya private tanpa caller)
    // boleh dihapus utuh. Method REVIEW/RISKY tidak pernah diteruskan oleh fixCommand.
    const removableSafeClassMethod = dead.type === 'ClassMethod' && dead.status === 'safe';

    // Level 2 & 3: Empty Body untuk API Publik (Parameter & method non-SAFE)
    if ((!removableSafeClassMethod && dead.type === 'ClassMethod') ||
        dead.type === 'Parameter' ||
        dead.type === 'FunctionDeclaration') {
        if (eliminationLevel >= 2) {
            if (dead.node.value && dead.node.value.body && dead.node.value.body.range) {
                const bodyStart = dead.node.value.body.range[0];
                const bodyEnd = dead.node.value.body.range[1];
                ms.overwrite(bodyStart, bodyEnd, '{}');
            } else if (dead.type === 'Parameter') {
                if (ruleEngine && ruleEngine.rules && ruleEngine.rules.eliminator && ruleEngine.rules.eliminator.autoRenameUnusedParameters) {
                    const paramText = codeString.substring(start, end);
                    if (!paramText.startsWith('_')) {
                        ms.prependRight(start, '_');
                    }
                }
            }
        }
        return;
    }

    // Penanganan Auto-Refactoring untuk EmptyBlock (Catch kosong, dll)
    if (dead.type === 'EmptyBlock') {
        if (ruleEngine && ruleEngine.rules && ruleEngine.rules.eliminator && ruleEngine.rules.eliminator.autoRemoveEmptyBlocks) {
            const blockText = codeString.substring(start, end);
            if (blockText.includes('{')) {
                const openBraceIdx = start + blockText.indexOf('{') + 1;
                ms.appendRight(openBraceIdx, '\n/* [DeadKiller] Auto-Refactored */\nif (process.env.DEBUG) console.warn("Empty Block Reached");\n');
            }
        }
        return;
    }

    // Level 3 (Aggressive Delete)
    let effectiveStart = start;
    if (dead.node && dead.node.leadingComments && dead.node.leadingComments.length > 0) {
        effectiveStart = dead.node.leadingComments[0].range[0];
    } else {
        const beforeLine = codeString.substring(0, findLineStart(codeString, start));
        const trimmedBefore = beforeLine.trimEnd();
        if (trimmedBefore.endsWith('*/')) {
            const commentStartIdx = trimmedBefore.lastIndexOf('/*');
            if (commentStartIdx !== -1) {
                const lineOfComment = findLineStart(codeString, commentStartIdx);
                const prefix = codeString.substring(lineOfComment, commentStartIdx).trim();
                if (prefix === '') {
                    effectiveStart = commentStartIdx;
                }
            }
        }
    }

    const lineStart = findLineStart(codeString, effectiveStart);
    const lineEnd = findLineEnd(codeString, end);

    const beforeNode = codeString.substring(lineStart, effectiveStart).trim();
    const afterNode = codeString.substring(end, lineEnd).trim();

    const afterIsTrailing = afterNode === '' || afterNode === ';' || afterNode === ',';
    if (beforeNode === '' && afterIsTrailing) {
        const fullLineEnd = consumeNewline(codeString, lineEnd);
        ms.remove(lineStart, fullLineEnd);
    } else {
        let removeStart = effectiveStart;
        let removeEnd = end;

        const afterSlice = codeString.substring(removeEnd, lineEnd);
        const trailingComma = afterSlice.match(/^\s*,\s*/);
        if (trailingComma) {
            removeEnd += trailingComma[0].length;
        } else {
            const beforeSlice = codeString.substring(lineStart, removeStart);
            const leadingComma = beforeSlice.match(/,\s*$/);
            if (leadingComma) {
                removeStart -= leadingComma[0].length;
            }
        }

        const remainingBefore = codeString.substring(lineStart, removeStart).trim();
        const remainingAfter = codeString.substring(removeEnd, lineEnd).trim();
        const isEmptyDeclaration = /^(const|let|var)$/.test(remainingBefore) &&
            (remainingAfter === '' || remainingAfter === ';');

        const isEmptyImport = /^import\s*\{?$/.test(remainingBefore) &&
            /^\}?\s*from\s+['"][^'"]+['"];?$/.test(remainingAfter);

        if (isEmptyDeclaration || isEmptyImport) {
            const fullLineEnd = consumeNewline(codeString, lineEnd);
            ms.remove(lineStart, fullLineEnd);
        } else {
            if (dead.type === 'CatchParameter') {
                const beforeParen = codeString.lastIndexOf('(', removeStart);
                const afterParen = codeString.indexOf(')', removeEnd);
                if (beforeParen !== -1 && afterParen !== -1) {
                    if (codeString.substring(beforeParen + 1, removeStart).trim() === '' &&
                        codeString.substring(removeEnd, afterParen).trim() === '') {
                        removeStart = beforeParen;
                        removeEnd = afterParen + 1;

                        // Hapus spasi ekstra sebelum kurung buka jika ada
                        if (removeStart > 0 && codeString[removeStart - 1] === ' ') {
                            removeStart--;
                        }
                    }
                }
            }
            ms.remove(removeStart, removeEnd);
        }
    }
}

/**
 * Menghapus dead code dari kode sumber asli menggunakan manipulasi string presisi (koordinat posisi).
 * Menggunakan algoritma `magic-string` untuk membedah node mati dan memvalidasi hasil AST
 * untuk mencegah kerusakan sintaks struktural.
 *
 * @param {string} codeString - Teks kode sumber mentah/asli.
 * @param {Array} deadNodes - Daftar objek dead code { name, type, line, node }.
 * @returns {string} String kode sumber yang telah suci dari dead code.
 */
export function removeDeadCode(codeString, deadNodes, ruleEngine = null, eliminationLevel = 3) {
    // Level 0 (Dry-Run): Jangan ubah file fisik sama sekali
    if (eliminationLevel === 0 || !deadNodes || deadNodes.length === 0) {
        return codeString;
    }

    const STRUCTURAL_UNFIXABLE = new Set(['DuplicateCondition']);
    const expandedNodes = deadNodes.flatMap(dead => {
        if (dead.type !== 'WriteOnly' || !Array.isArray(dead.relatedNodes)) {
            return [dead];
        }
        return [
            dead,
            ...dead.relatedNodes.map(node => ({
                ...dead,
                name: `${dead.name} assignment`,
                node,
                relatedNodes: [],
            })),
        ];
    });
    const sortedNodes = expandedNodes
        .filter(d => d.node && d.node.range && !STRUCTURAL_UNFIXABLE.has(d.type))
        .sort((a, b) => b.node.range[0] - a.node.range[0]);

    if (sortedNodes.length === 0) {
        return codeString;
    }

    // 1. Fast Path: Coba hapus seluruh node sekaligus
    const fastMs = new MagicString(codeString);
    for (const dead of sortedNodes) {
        applySingleNodeRemoval(fastMs, codeString, dead, ruleEngine, eliminationLevel);
    }
    const fastResult = cleanupArtifacts(fastMs.toString());

    // Validasi parse ulang AST pasca-transformasi
    if (isValidSyntax(fastResult)) {
        if (process.env.DEBUG) console.log('[CodeCleaner] fastResult was valid:\n', fastResult);
        return fastResult;
    } else {
        if (process.env.DEBUG) console.log('[CodeCleaner] fastResult was INVALID:\n', fastResult);
    }

    // 2. Fallback Path (Safe Incremental Elimination): Uji satu per satu jika batch removal merusak sintaks
    if (process.env.DEBUG) {
        console.warn('[CodeCleaner] Batch removal merusak sintaks. Beralih ke verifikasi AST incremental.');
    }

    const acceptedNodes = [];
    for (const dead of sortedNodes) {
        const testMs = new MagicString(codeString);
        for (const accepted of acceptedNodes) {
            applySingleNodeRemoval(testMs, codeString, accepted, ruleEngine, eliminationLevel);
        }
        applySingleNodeRemoval(testMs, codeString, dead, ruleEngine, eliminationLevel);

        if (isValidSyntax(cleanupArtifacts(testMs.toString()))) {
            acceptedNodes.push(dead);
        } else if (process.env.DEBUG) {
            console.warn(`[CodeCleaner] Menolak penghapusan node ${dead.type} '${dead.name}' karena merusak sintaks struktural.`);
        }
    }

    const finalMs = new MagicString(codeString);
    for (const accepted of acceptedNodes) {
        applySingleNodeRemoval(finalMs, codeString, accepted, ruleEngine, eliminationLevel);
    }
    return cleanupArtifacts(finalMs.toString());
}

function cleanupArtifacts(code) {
    const withoutEmptyImports = code.replace(
        /^[\t ]*import[\t ]*\{[\t ]*\}[\t ]*from[\t ]*(['"])[^'"]+\1;?[\t ]*(?:\r?\n|$)/gm,
        '',
    );
    // Penghapusan beberapa node pada satu baris dapat menyisakan EmptyStatement
    // tersendiri (`  ;`). Aman dibuang hanya jika semicolon adalah satu-satunya
    // token pada baris; semicolon di `for (;;)`, body loop, dan statement lain
    // tidak tersentuh.
    return withoutEmptyImports.replace(/^[\t ]*;[\t ]*(?:\r?\n|$)/gm, '');
}

/**
 * Menemukan indeks awal baris yang mengandung posisi `pos`.
 */
function findLineStart(code, pos) {
    let i = pos - 1;
    while (i >= 0 && code[i] !== '\n') {
        i--;
    }
    return i + 1;
}

/**
 * Menemukan indeks akhir baris (sebelum newline) yang mengandung posisi `pos`.
 */
function findLineEnd(code, pos) {
    let i = pos;
    while (i < code.length && code[i] !== '\n' && code[i] !== '\r') {
        i++;
    }
    return i;
}

/**
 * Melewatkan karakter newline (\r\n atau \n) setelah posisi tertentu,
 * agar penghapusan tidak menyisakan baris kosong.
 */
function consumeNewline(code, pos) {
    if (pos < code.length && code[pos] === '\r') pos++;
    if (pos < code.length && code[pos] === '\n') pos++;
    return pos;
}