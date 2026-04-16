/**
 * Helper to determine if identifier is a reference (usage) vs declaration.
 * 
 * @param {object} node - The AST node to check
 * @param {object} parent - The parent AST node
 * @param {object} [grandParent] - The grandparent AST node (for context)
 * @returns {boolean} True if the node is a reference
 */
export function isReference(node, parent, grandParent) {
    if (!parent) return false;
    
    // Declaration cases (NOT references)
    if (parent.type === 'VariableDeclarator' && parent.id === node) return false;
    if (parent.type === 'FunctionDeclaration' && parent.id === node) return false;
    if (parent.type === 'MethodDefinition' && parent.key === node) return false;

    // Property handling
    if (parent.type === 'Property' && parent.key === node && !parent.computed) return false;
    if (parent.type === 'Property' && parent.value === node && grandParent && grandParent.type === 'ObjectPattern') return false;

    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(parent.type)) {
        if (parent.params.includes(node)) return false;
    }
    if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return false;

    // Import specifiers
    if (parent.type === 'ImportSpecifier' && parent.imported === node) return false;
    if (parent.type === 'ImportDefaultSpecifier') return false;
    if (parent.type === 'ImportNamespaceSpecifier') return false;
    if (parent.type === 'ImportSpecifier' && parent.local === node) return false;

    // Export specifiers 
    if (parent.type === 'ExportSpecifier' && parent.exported === node) return false;

    // Class declaration name is not a reference
    if (parent.type === 'ClassDeclaration' && parent.id === node) return false;

    // Catch clause parameter is a declaration
    if (parent.type === 'CatchClause' && parent.param === node) return false;

    // For-in/for-of left side declaration
    if ((parent.type === 'ForInStatement' || parent.type === 'ForOfStatement') && parent.left === node) return false;

    // Label identifiers
    if (parent.type === 'LabeledStatement' && parent.label === node) return false;
    if (parent.type === 'BreakStatement' && parent.label === node) return false;
    if (parent.type === 'ContinueStatement' && parent.label === node) return false;

    // ArrayPattern elements 
    if (parent.type === 'ArrayPattern') return false;

    // RestElement 
    if (parent.type === 'RestElement') return false;

    // AssignmentPattern left
    if (parent.type === 'AssignmentPattern' && parent.left === node) return false;

    return true;
}
