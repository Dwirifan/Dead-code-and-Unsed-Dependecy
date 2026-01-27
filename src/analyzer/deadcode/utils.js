/**
 * Helper to determine if identifier is a reference (usage) vs declaration
 * @param {object} node - The AST node to check
 * @param {object} parent - The parent AST node
 * @returns {boolean} True if the node is a reference
 */
export function isReference(node, parent) {
    if (!parent) return false;
    
    // Declaration cases (NOT references)
    if (parent.type === 'VariableDeclarator' && parent.id === node) return false;
    if (parent.type === 'FunctionDeclaration' && parent.id === node) return false;
    if (parent.type === 'MethodDefinition' && parent.key === node) return false;
    if (parent.type === 'Property' && parent.key === node && !parent.computed) return false; // { key: val } -> key is not ref
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(parent.type)) {
        if (parent.params.includes(node)) return false;
    }
    if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return false; // obj.prop -> prop is not ref, obj is.
    
    return true;
}
