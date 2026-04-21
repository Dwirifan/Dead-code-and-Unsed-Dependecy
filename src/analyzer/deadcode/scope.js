/**
 * Kelas Scope: Merepresentasikan jangkauan (scope) lingkungan Lexical environment
 * mulai dari tingkat Global, Fungsi, hingga Blok.
 */
export class Scope {
    constructor(parent = null) {
        this.parent = parent;
        this.declarations = new Map(); // Pendataan nama -> { type, line, node, used: false }
        this.references = []; // Kumpulan nama-nama variabel yang dipanggil/digunakan
    }

    addDeclaration(name, type, line, node, parentNode = null) {
        // Hanya meregistrasi jika belum pernah dideklarasikan di scope ini (hindari duplikasi)
        if (!this.declarations.has(name)) {
            this.declarations.set(name, { type, line, node, parentNode, used: false });
        }
    }

    addReference(name) {
        this.references.push(name);
    }

    resolve() {
        // Cocokkan variabel yang dipanggil dengan variabel yang dideklarasikan di scope ini atau parent-nya
        for (const refName of this.references) {
            this.markUsed(refName);
        }
    }

    markUsed(name) {
        if (this.declarations.has(name)) {
            const decl = this.declarations.get(name);
            decl.used = true;
        } else if (this.parent) {
            this.parent.markUsed(name);
        }
    }
}
