/**
 * Penjaga (Guard) Traversing AST khusus TypeScript.
 * Fungsi ini menentukan apakah sebuah node TypeScript berisi informasi "tipe murni"
 * (type-only) yang tidak memiliki wujud / dipanggil saat runtime.
 * Mengembalikan `true` berarti AST Crawler (seperti estraverse) harus SKIP penelusuran 
 * ke dalam child node-nya untuk mencegah False Positive.
 */
export function shouldSkipTsNode(node) {
    if (!node) return false;

    // Node yang pasti merupakan deklarasi atau anotasi tipe murni
    const typeOnlyNodes = new Set([
        'TSTypeAnnotation',
        'TSTypeAliasDeclaration',
        'TSInterfaceDeclaration',
        'TSDeclareMethod',
        'TSDeclareFunction',
        'TSAbstractMethodDefinition',
        'TSPropertySignature',
        'TSMethodSignature',
        'TSIndexSignature'
    ]);

    if (typeOnlyNodes.has(node.type)) {
        return true;
    }

    // Deklarasi yang ditandai dengan keyword 'declare'
    if (node.declare === true) {
        return true;
    }

    return false;
}
