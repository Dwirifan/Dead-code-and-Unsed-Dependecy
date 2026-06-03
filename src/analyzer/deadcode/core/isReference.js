/**
 * Alat bantu (Helper) untuk membedah apakah sebuah *Identifier* 
 * merupakan referensi (dipanggil) atau hanyalah sebuah deklarasi.
 * 
 * @param {object} node - Titik AST target
 * @param {object} parent - Titik induk (Parent) dari node
 * @param {object} [grandParent] - Titik kakek/leluhur dari node (untuk membaca konteks)
 * @returns {boolean} Bernilai 'true' jika node adalah referensi pemanggilan
 */
export function isReference(node, parent, grandParent) {
    if (!parent) return false;
    
    // Kasus-kasus Deklarasi (BUKAN Referensi Pemanggilan)
    if (parent.type === 'VariableDeclarator' && parent.id === node) return false;
    if (parent.type === 'FunctionDeclaration' && parent.id === node) return false;
    if (parent.type === 'MethodDefinition' && parent.key === node) return false;

    // Penanganan Properti Objek (Key bukan panggilan variabel)
    if (parent.type === 'Property' && parent.key === node && !parent.computed) return false;
    if (parent.type === 'Property' && parent.value === node && grandParent && grandParent.type === 'ObjectPattern') return false;

    // Penanganan Parameter pada blok fungsi
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(parent.type)) {
        if (parent.params.includes(node)) return false;
    }
    // Properti dalam ekspresi member (obj.properti)
    if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return false;

    // JSX: Nama Properti (Attribute) di <Component prop={...} /> bukan referensi variabel
    if (parent.type === 'JSXAttribute' && parent.name === node) return false;
    // JSX: Nama komponen dalam member expression (contoh: <My.Component />)
    // Jika node adalah bagian property dari JSXMemberExpression, itu bukan variabel independen
    if (parent.type === 'JSXMemberExpression' && parent.property === node) return false;

    // Spesifikator Impor
    if (parent.type === 'ImportSpecifier' && parent.imported === node) return false;
    if (parent.type === 'ImportDefaultSpecifier') return false;
    if (parent.type === 'ImportNamespaceSpecifier') return false;
    if (parent.type === 'ImportSpecifier' && parent.local === node) return false;

    // Spesifikator Ekspor 
    if (parent.type === 'ExportSpecifier' && parent.exported === node) return false;

    // Nama kelas deklarasi murni
    if (parent.type === 'ClassDeclaration' && parent.id === node) return false;

    // Penangkapan parameter (Catch clause error)
    if (parent.type === 'CatchClause' && parent.param === node) return false;

    // Iterator Untuk (For-in/for-of left side)
    if ((parent.type === 'ForInStatement' || parent.type === 'ForOfStatement') && parent.left === node) return false;

    // Penanda Label Identifikasi
    if (parent.type === 'LabeledStatement' && parent.label === node) return false;
    if (parent.type === 'BreakStatement' && parent.label === node) return false;
    if (parent.type === 'ContinueStatement' && parent.label === node) return false;

    // Pola Array 
    if (parent.type === 'ArrayPattern') return false;

    // Sisa Elemen (...rest)
    if (parent.type === 'RestElement') return false;

    // Pola Pengisian (AssignmentPattern)
    if (parent.type === 'AssignmentPattern' && parent.left === node) return false;

    // TypeScript: Deklarasi nama Interface, Type Alias, Enum, dan Class Expression
    if (parent.type === 'TSInterfaceDeclaration' && parent.id === node) return false;
    if (parent.type === 'TSTypeAliasDeclaration' && parent.id === node) return false;
    if (parent.type === 'TSEnumDeclaration' && parent.id === node) return false;
    if (parent.type === 'TSModuleDeclaration' && parent.id === node) return false;
    if (parent.type === 'ClassExpression' && parent.id === node) return false;

    // TypeScript: Nama properti di TSEnumMember bukan referensi
    if (parent.type === 'TSEnumMember' && parent.id === node) return false;

    return true; // Jika lolos semua jebakan di atas, maka ini adalah The Real Reference
}
