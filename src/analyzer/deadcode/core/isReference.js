/**
 * Alat bantu (Helper) untuk membedah apakah sebuah *Identifier* 
 * merupakan referensi (dipanggil) atau hanyalah sebuah deklarasi.
 * 
 * @param {object} node - Titik AST target
 * @param {object} parent - Titik induk (Parent) dari node
 * @param {object} [grandParent] - Titik kakek/leluhur dari node (untuk membaca konteks)
 * @returns {boolean} Bernilai 'true' jika node adalah referensi pemanggilan
 */
export function isReference(node, parent, grandParent, ancestors = null) {
    if (!parent) return false;
    
    // Kasus-kasus Deklarasi (BUKAN Referensi Pemanggilan)
    if (parent.type === 'VariableDeclarator' && parent.id === node) return false;
    if (parent.type === 'FunctionDeclaration' && parent.id === node) return false;
    if (parent.type === 'FunctionExpression' && parent.id === node) return false;
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
    
    // JSX: Tag HTML bawaan (lowercase) bukan referensi variabel
    if ((parent.type === 'JSXOpeningElement' || parent.type === 'JSXClosingElement') && parent.name === node) {
        if (/^[a-z]/.test(node.name)) {
            return false;
        }
    }

    // Spesifikator Impor
    if (parent.type === 'ImportSpecifier' && parent.imported === node) return false;
    if (parent.type === 'ImportDefaultSpecifier') return false;
    if (parent.type === 'ImportNamespaceSpecifier') return false;
    if (parent.type === 'ImportSpecifier' && parent.local === node) return false;

    // Spesifikator Ekspor 
    if (parent.type === 'ExportSpecifier' && parent.exported === node) return false;
    if (parent.type === 'ExportAllDeclaration' && parent.exported === node) return false;

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

    // MetaProperty (misal: import.meta.url) - bukan variabel!
    if (parent.type === 'MetaProperty') return false;

    // Pola Pengisian (AssignmentPattern)
    if (parent.type === 'AssignmentPattern' && parent.left === node) return false;

    // TypeScript: Deklarasi dan abstraksi tipe (Pilar 2)
    // 1. Parameter dalam definisi tipe fungsi/method (misal: (sections: HelpSection[]) => void) BUKAN referensi variabel runtime
    if (parent.type === 'TSFunctionType' && parent.params && parent.params.includes(node)) return false;
    if (parent.type === 'TSCallSignatureDeclaration' && parent.params && parent.params.includes(node)) return false;
    if (parent.type === 'TSConstructSignatureDeclaration' && parent.params && parent.params.includes(node)) return false;
    if (parent.type === 'TSMethodSignature' && parent.params && parent.params.includes(node)) return false;
    if (parent.type === 'TSDeclareFunction' && parent.params && parent.params.includes(node)) return false;

    // 2. Deklarasi nama Interface, Type Alias, Enum, Module, dan Generics
    if (parent.type === 'TSInterfaceDeclaration' && parent.id === node) return false;
    if (parent.type === 'TSTypeAliasDeclaration' && parent.id === node) return false;
    if (parent.type === 'TSEnumDeclaration' && parent.id === node) return false;
    if (parent.type === 'TSModuleDeclaration' && parent.id === node) return false;
    if (parent.type === 'TSImportEqualsDeclaration' && parent.id === node) return false;
    if (parent.type === 'TSDeclareFunction' && parent.id === node) return false;
    if (parent.type === 'ClassExpression' && parent.id === node) return false;
    if (parent.type === 'TSTypeParameter' && parent.name === node) return false;

    // 3. Nama properti (keys) pada tipe/kelas BUKAN referensi variabel runtime
    if ((parent.type === 'PropertyDefinition' || parent.type === 'ClassProperty') && parent.key === node && !parent.computed) return false;
    if (parent.type === 'TSPropertySignature' && parent.key === node && !parent.computed) return false;
    if (parent.type === 'TSMethodSignature' && parent.key === node && !parent.computed) return false;
    if (parent.type === 'TSIndexSignature') return false;
    if (parent.type === 'TSEnumMember' && parent.id === node) return false;

    // 4. Isolasi Scope Sadar-Tipe (Ancestry Check untuk Pilar 2):
    // Jika identifier berada di dalam node abstraksi tipe (TSTypeAliasDeclaration, TSInterfaceDeclaration, TSFunctionType, TSTypeLiteral, TSDeclareFunction)
    // dan BUKAN merupakan TSTypeReference (yang merujuk pada tipe yang dideklarasikan/diimpor), abaikan dari graf analisis eksekusi runtime!
    const typeAbstractionTypes = new Set(['TSTypeAliasDeclaration', 'TSInterfaceDeclaration', 'TSFunctionType', 'TSTypeLiteral', 'TSDeclareFunction']);
    if (ancestors && Array.isArray(ancestors)) {
        const inTypeAbstraction = ancestors.some(a => a && typeAbstractionTypes.has(a.type));
        if (inTypeAbstraction) {
            if (parent.type !== 'TSTypeReference' && parent.type !== 'TSQualifiedName' && parent.type !== 'TSExpressionWithTypeArguments') {
                return false;
            }
        }
    } else {
        if (typeAbstractionTypes.has(parent.type) || (grandParent && typeAbstractionTypes.has(grandParent.type))) {
            if (parent.type !== 'TSTypeReference' && parent.type !== 'TSQualifiedName' && parent.type !== 'TSExpressionWithTypeArguments') {
                return false;
            }
        }
    }

    return true; // Jika lolos semua jebakan di atas, maka ini adalah The Real Reference
}
