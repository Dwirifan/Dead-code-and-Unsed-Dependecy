export class Scope {
    constructor(parent = null) {
        this.parent = parent;
        this.declarations = new Map(); // name -> { type, line, node, used: false }
        this.references = []; // names of referenced variables
    }

    addDeclaration(name, type, line, node) {
        // Only add if not already declared in this scope (handle var vs let/const redundancy if needed, but simple map is ok)
        if (!this.declarations.has(name)) {
            this.declarations.set(name, { type, line, node, used: false });
        }
    }

    addReference(name) {
        this.references.push(name);
    }

    resolve() {
        // Resolve references in this scope against declarations in this scope or parents
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
