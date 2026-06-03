/**
 * Menggali (Extract) secara rekursif semua nama Variabel (Identifier) dari pola dekonstruksi.
 * Mendukung pola komplit: Identifier murni, ObjectPattern ({a, b}), ArrayPattern ([a, b]),
 * RestElement (...rest), dan AssignmentPattern (a = 1).
 * 
 * @param {object} pattern - Node AST pola (contoh: node.id dari sebuah VariableDeclarator)
 * @returns {Array<{name: string, node: object}>} Daftar pengidentifikasi yang berhasil digali berserta Node AST aslinya
 */
export function extractIdentifiers(pattern) {
    const identifiers = [];

    if (!pattern) return identifiers;

    switch (pattern.type) {
        case 'Identifier':
            // Variabel murni
            identifiers.push({ name: pattern.name, node: pattern });
            break;

        case 'ObjectPattern':
            // Pola Objek destructuring: const { a, b } = obj;
            for (const prop of pattern.properties) {
                if (prop.type === 'RestElement') {
                    identifiers.push(...extractIdentifiers(prop.argument));
                } else if (prop.type === 'Property') {
                    const extracted = extractIdentifiers(prop.value);
                    // Ganti referensi AST node ke level 'Property'
                    // Agar saat magic-string menghapus, seluruh "kunci: nilai" terhapus, bukan cuma nilainya
                    extracted.forEach(item => item.node = prop);
                    identifiers.push(...extracted);
                }
            }
            break;

        case 'ArrayPattern':
            // Pola Array destructuring: const [a, b] = arr;
            for (const element of pattern.elements) {
                if (element) {
                    identifiers.push(...extractIdentifiers(element));
                }
            }
            break;

        case 'RestElement':
            // Sisa elemen (rest operator): ...rest
            identifiers.push(...extractIdentifiers(pattern.argument));
            break;

        case 'AssignmentPattern':
            // Pola bernilai default: a = 1
            identifiers.push(...extractIdentifiers(pattern.left));
            break;

        default:
            break;
    }

    return identifiers;
}
