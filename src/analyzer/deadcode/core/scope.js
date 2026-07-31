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
        // Key pertama tetap memakai nama agar API lama (`declarations.get(name)`) kompatibel.
        // Deklarasi bernama sama (shadowing / namespace type-value TS) memakai Symbol key,
        // sedangkan identitas binding sebenarnya disimpan pada `bindingNode`.
        this.declarations = new Map();
        this.readReferences = [];  // Array of { name, node }
        this.writeReferences = []; // Array of { name, node }
        this.selfName = null; // Nama fungsi pemilik scope ini (untuk deteksi rekursi/self-reference)
        this.undeclaredVariables = []; // Array of { name, node } (hanya terisi pada global scope)
    }

    addDeclaration(name, type, line, node, parentNode = null, metadata = {}) {
        const bindingNode = metadata.bindingNode || node;
        const existing = [...this.declarations.values()].find(decl => decl.bindingNode === bindingNode);
        if (existing) return existing;

        const declaration = {
            name,
            type,
            line,
            node,
            parentNode,
            bindingNode,
            namespace: metadata.namespace || 'value',
            used: false,
            readCount: 0,
            writeCount: 0,
            writeNodes: []
        };

        const key = this.declarations.has(name) ? Symbol(name) : name;
        this.declarations.set(key, declaration);
        return declaration;
    }



    addReadReference(name, node = null, owners = null) {
        this.readReferences.push({ name, node, owners, active: true });
    }

    addWriteReference(name, node = null, owners = null) {
        this.writeReferences.push({ name, node, owners, active: true });
    }

    resolve() {
        // Cocokkan READ references — hanya READ yang membuat variabel "used"
        for (const ref of this.readReferences) {
            // Lewati self-reference: fungsi yang memanggil dirinya sendiri (rekursi)
            // tidak dihitung sebagai penggunaan eksternal.
            // Tanpa ini, fungsi rekursif yang tidak pernah dipanggil dari luar
            // akan salah ditandai sebagai "used" hanya karena memanggil dirinya sendiri.
            if (ref.name === this.selfName) continue;

            this.markRead(ref.name, ref.node, ref);
        }

        // Catat WRITE references — tidak menandai used, hanya menaikkan writeCount
        for (const ref of this.writeReferences) {
            if (ref.name === this.selfName) continue;
            this.markWrite(ref.name, ref.node, ref);
        }
    }

    markRead(name, originalNode = null, refObj = null) {
        const decl = [...this.declarations.values()].find(candidate => candidate.name === name);
        if (decl) {
            decl.used = true;
            decl.readCount++;
            if (refObj) refObj.targetDecl = decl;
        } else if (this.parent) {
            this.parent.markRead(name, originalNode, refObj);
        } else {
            // Tidak ditemukan deklarasi sampai global scope
            if (!name.includes('.')) {
                this.undeclaredVariables.push({ name, node: originalNode });
            }
        }
    }

    markWrite(name, originalNode = null, refObj = null) {
        const decl = [...this.declarations.values()].find(candidate => candidate.name === name);
        if (decl) {
            decl.writeCount++;
            if (originalNode) {
                decl.writeNodes = decl.writeNodes || [];
                decl.writeNodes.push(originalNode);
            }
            if (refObj) refObj.targetDecl = decl;
            // TIDAK menandai used = true; write-only variable tetap dianggap dead
        } else if (this.parent) {
            this.parent.markWrite(name, originalNode, refObj);
        } else {
            // Write ke undeclared variable (implicit global)
            if (!name.includes('.')) {
                this.undeclaredVariables.push({ name, node: originalNode });
            }
        }
    }

    // Backward compatibility alias
    markUsed(name) {
        this.markRead(name);
    }
}
