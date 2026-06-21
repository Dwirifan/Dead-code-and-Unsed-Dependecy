/**
 * Kelas Scope: Merepresentasikan jangkauan (scope) lingkungan Lexical environment
 * mulai dari tingkat Global, Fungsi, hingga Blok.
 * 
 * Mendukung Read/Write Differentiation:
 *   - readReferences: variabel yang DIBACA nilainya (console.log(a), return a)
 *   - writeReferences: variabel yang hanya DITULIS (a = 10, a++)
 *   - Variabel yang hanya di-write tapi tidak pernah di-read = Write-Only Dead Code
 */
export class Scope {
    constructor(parent = null) {
        this.parent = parent;
        this.declarations = new Map(); // nama -> { type, line, node, used: false, readCount: 0, writeCount: 0 }
        this.readReferences = [];  // Nama variabel yang DIBACA (read)
        this.writeReferences = []; // Nama variabel yang DITULIS saja (write-only)
        this.selfName = null; // Nama fungsi pemilik scope ini (untuk deteksi rekursi/self-reference)
    }

    addDeclaration(name, type, line, node, parentNode = null) {
        // Hanya meregistrasi jika belum pernah dideklarasikan di scope ini (hindari duplikasi)
        if (!this.declarations.has(name)) {
            this.declarations.set(name, { type, line, node, parentNode, used: false, readCount: 0, writeCount: 0 });
        }
    }



    addReadReference(name) {
        this.readReferences.push(name);
    }

    addWriteReference(name) {
        this.writeReferences.push(name);
    }

    resolve() {
        // Cocokkan READ references — hanya READ yang membuat variabel "used"
        for (const refName of this.readReferences) {
            // Lewati self-reference: fungsi yang memanggil dirinya sendiri (rekursi)
            // tidak dihitung sebagai penggunaan eksternal.
            // Tanpa ini, fungsi rekursif yang tidak pernah dipanggil dari luar
            // akan salah ditandai sebagai "used" hanya karena memanggil dirinya sendiri.
            if (refName === this.selfName) continue;

            this.markRead(refName);
        }

        // Catat WRITE references — tidak menandai used, hanya menaikkan writeCount
        for (const refName of this.writeReferences) {
            if (refName === this.selfName) continue;
            this.markWrite(refName);
        }
    }

    markRead(name) {
        if (this.declarations.has(name)) {
            const decl = this.declarations.get(name);
            decl.used = true;
            decl.readCount++;
        } else if (this.parent) {
            this.parent.markRead(name);
        }
    }

    markWrite(name) {
        if (this.declarations.has(name)) {
            const decl = this.declarations.get(name);
            decl.writeCount++;
            // TIDAK menandai used = true; write-only variable tetap dianggap dead
        } else if (this.parent) {
            this.parent.markWrite(name);
        }
    }

    // Backward compatibility alias
    markUsed(name) {
        this.markRead(name);
    }
}
