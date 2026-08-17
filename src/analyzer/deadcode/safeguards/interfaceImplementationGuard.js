
export function evaluateClassContract(methodNode, classNode) {
    if (!methodNode || methodNode.type !== 'MethodDefinition') {
        return { shouldBeRisky: false };
    }

    if (methodNode.override) {
        return {
            shouldBeRisky: true,
            reason: "Metode ini memiliki keyword 'override'. Menghapusnya dapat merusak rantai polimorfisme kelas induk."
        };
    }

    if (classNode && Array.isArray(classNode.implements) && classNode.implements.length > 0) {
        return {
            shouldBeRisky: true,
            reason: 'Kelas ini mengimplementasikan sebuah Interface. Metode di dalamnya berisiko bagian dari kontrak antarmuka, menghapusnya dapat menyebabkan error compiler TypeScript.'
        };
    }

    return { shouldBeRisky: false };
}
