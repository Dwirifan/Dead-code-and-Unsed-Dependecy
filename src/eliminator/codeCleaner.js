import MagicString from 'magic-string';

/**
 * Menghapus dead code dari kode sumber asli menggunakan manipulasi string presisi (koordinat posisi).
 * Menggunakan algoritma `magic-string` untuk membedah node mati tanpa merusak format tulisan asli,
 * komentar, spasi, atau anotasi tipe TypeScript yang tak terkait.
 *
 * @param {string} codeString - Teks kode sumber mentah/asli.
 * @param {Array} deadNodes - Daftar objek dead code { name, type, line, node }.
 *                            Setiap node wajib memiliki properti `range` bertipe [start, end].
 * @returns {string} String kode sumber yang telah suci dari dead code.
 */
export function removeDeadCode(codeString, deadNodes) {
    if (!deadNodes || deadNodes.length === 0) {
        return codeString;
    }

    const ms = new MagicString(codeString);

    // Sortir deadNodes berdasarkan posisi range[0] secara menurun (dari belakang ke depan)
    // agar penghapusan tidak menggeser indeks node yang belum dihapus
    const sortedNodes = [...deadNodes]
        .filter(d => d.node && d.node.range)
        .sort((a, b) => b.node.range[0] - a.node.range[0]);

    for (const dead of sortedNodes) {
        const [start, end] = dead.node.range;

        // Tentukan batas baris penuh untuk node ini
        const lineStart = findLineStart(codeString, start);
        const lineEnd = findLineEnd(codeString, end);

        // Cek apakah node ini adalah satu-satunya konten bermakna di baris tersebut
        const beforeNode = codeString.substring(lineStart, start).trim();
        const afterNode = codeString.substring(end, lineEnd).trim();

        // Jika ada di baris sendiri (atau hanya ada koma/titik koma/spasi di sisa baris),
        // hapus seluruh baris agar tidak menyisakan baris kosong.
        const afterIsTrailing = afterNode === '' || afterNode === ';' || afterNode === ',';
        if (beforeNode === '' && afterIsTrailing) {
            // Hapus seluruh baris termasuk newline di akhirnya
            const fullLineEnd = consumeNewline(codeString, lineEnd);
            ms.remove(lineStart, fullLineEnd);
        } else {
            // Node berbagi baris dengan kode lain (misal: const a = 1, b = 2)
            // Hapus hanya node-nya, lalu bersihkan koma/spasi yang menggantung
            let removeStart = start;
            let removeEnd = end;

            // Cek dan hapus koma yang menggantung sesudah node
            const afterSlice = codeString.substring(removeEnd, lineEnd);
            const trailingComma = afterSlice.match(/^\s*,\s*/);
            if (trailingComma) {
                removeEnd += trailingComma[0].length;
            } else {
                // Cek dan hapus koma yang menggantung sebelum node
                const beforeSlice = codeString.substring(lineStart, removeStart);
                const leadingComma = beforeSlice.match(/,\s*$/);
                if (leadingComma) {
                    removeStart -= leadingComma[0].length;
                }
            }

            // Cek apakah setelah penghapusan, hanya tersisa keyword kosong (const/let/var ;)
            const remainingBefore = codeString.substring(lineStart, removeStart).trim();
            const remainingAfter = codeString.substring(removeEnd, lineEnd).trim();
            const isEmptyDeclaration = /^(const|let|var)$/.test(remainingBefore) &&
                (remainingAfter === '' || remainingAfter === ';');

            if (isEmptyDeclaration) {
                const fullLineEnd = consumeNewline(codeString, lineEnd);
                ms.remove(lineStart, fullLineEnd);
            } else {
                ms.remove(removeStart, removeEnd);
            }
        }
    }

    return ms.toString();
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
