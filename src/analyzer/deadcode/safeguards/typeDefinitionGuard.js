import path from 'path';

/**
 * Mengevaluasi apakah variabel digunakan murni untuk keperluan Type Checking (tsc)
 * pada file-file TypeScript, khususnya di dalam folder/file testing.
 * 
 * @param {Object} info Deklarasi info dari astAnalyzer
 * @param {string} fileName Nama/path file yang sedang dianalisis
 * @returns {Object} Hasil evaluasi (shouldBeRisky, riskyMessage)
 */
export function evaluateTypeDefinitionVariable(info, fileName) {
    const result = {
        shouldBeRisky: false,
        riskyMessage: ''
    };

    if (!fileName) return result;

    const normalizedPath = fileName.replace(/\\/g, '/');
    
    // Pola file pengujian (tes) atau deklarasi tipe
    const isTypeTestFile = (
        normalizedPath.endsWith('.d.ts') ||
        normalizedPath.includes('/tests/types/') ||
        normalizedPath.includes('/type-tests/') ||
        normalizedPath.endsWith('.test.ts') ||
        normalizedPath.endsWith('.spec.ts') ||
        normalizedPath.endsWith('.test-d.ts')
    );

    if (isTypeTestFile) {
        let hasTypeAnnotation = false;
        
        // Periksa apakah variabel memiliki typeAnnotation
        // Node: info.node atau info.bindingNode (VariableDeclarator / Identifier)
        const targetNode = info.node || info.bindingNode;
        if (targetNode) {
            if (targetNode.type === 'VariableDeclarator' && targetNode.id && targetNode.id.typeAnnotation) {
                hasTypeAnnotation = true;
            } else if (targetNode.type === 'Identifier' && targetNode.typeAnnotation) {
                hasTypeAnnotation = true;
            }
        }

        // Di file .d.ts, semua variabel dianggap type definition
        if (normalizedPath.endsWith('.d.ts') || hasTypeAnnotation) {
            result.shouldBeRisky = true;
            result.riskyMessage = "Variabel ini memiliki anotasi tipe pada file pengujian/deklarasi TypeScript (Type Checking). Menghapusnya berisiko merusak mekanisme test compiler.";
        }
    }

    return result;
}
