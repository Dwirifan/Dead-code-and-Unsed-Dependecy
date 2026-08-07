/**
 * Melindungi variabel hasil destrukturisasi array yang tidak terpakai,
 * asalkan posisi elemen di sebelah kanannya masih memiliki variabel yang terpakai.
 * Menghapus elemen kiri akan menggeser indeks (posisi) elemen kanan, yang berakibat fatal.
 */
export function evaluateArrayDestructuring(info) {
    if (!info || info.type !== 'Variable') {
        return { isPositional: false, shouldBeRisky: false };
    }

    if (!info.isArrayDestructuring || info.arrayIndex === undefined || info.arrayLength === undefined) {
        return { isPositional: false, shouldBeRisky: false };
    }

    // Jika ini adalah destrukturisasi array, kita cek grup destrukturisasinya.
    // info.arraySiblings menyimpan semua info deklarasi dalam satu array pattern.
    const siblings = info.arraySiblings || [];
    
    // Apakah elemen pada indeks yang lebih besar (di sebelah kanan) masih dibaca/digunakan?
    const hasUsedRightSibling = siblings.some(sibling => 
        sibling.arrayIndex > info.arrayIndex && sibling.readCount > 0
    );

    if (hasUsedRightSibling) {
        return {
            isPositional: true,
            shouldBeRisky: true,
            reason: 'Variabel ini merupakan elemen destrukturisasi array. Menghapusnya akan menggeser urutan indeks elemen setelahnya yang masih digunakan.'
        };
    }

    // Jika posisi dia paling kanan (atau semua yang di kanannya juga mati), aman untuk dihapus
    return {
        isPositional: true,
        shouldBeRisky: false
    };
}
