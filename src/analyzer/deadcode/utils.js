/**
 * Helper to determine if identifier is a reference (usage) vs declaration.
 * Improved: handles import/export specifiers, destructuring patterns, and more.
 * 
 * IMPORTANT: In destructuring patterns like `const { name, age } = obj`,
 * the identifiers `name` and `age` appear as Property.value nodes.
 * estraverse visits them with parent = Property, but we need to know
 * if that Property is inside an ObjectPattern (declaration context) vs
 * a regular object literal (expression context).
 * 
 * To solve this, we use a two-pass approach: the main analyzer should
 * NOT count identifiers inside destructuring patterns as references,
 * since extractIdentifiers() already handles registration.
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

    // Property handling — need to distinguish between:
    //   1. Object literal: { key: value } → key is not ref, value IS ref
    //   2. Destructuring pattern: const { key } = obj → key is NOT ref (it's a declaration)
    if (parent.type === 'Property' && parent.key === node && !parent.computed) return false;
    // If this Property is inside a destructuring pattern (ObjectPattern), 
    // the value is also a declaration target, not a reference
    if (parent.type === 'Property' && parent.value === node && grandParent && grandParent.type === 'ObjectPattern') return false;

    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(parent.type)) {
        if (parent.params.includes(node)) return false;
    }
    if (parent.type === 'MemberExpression' && parent.property === node && !parent.computed) return false; // obj.prop -> prop is not ref, obj is.

    // Import specifiers — imported names in declaration context are NOT references
    if (parent.type === 'ImportSpecifier' && parent.imported === node) return false;
    if (parent.type === 'ImportDefaultSpecifier') return false;
    if (parent.type === 'ImportNamespaceSpecifier') return false;
    // The local alias of an import IS a declaration, not a reference
    if (parent.type === 'ImportSpecifier' && parent.local === node) return false;

    // Export specifiers — re-exported names
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

    // ArrayPattern elements — identifiers inside [a, b] = ... are declarations
    if (parent.type === 'ArrayPattern') return false;

    // RestElement — ...rest in destructuring is a declaration
    if (parent.type === 'RestElement') return false;

    // AssignmentPattern left — const { a = 10 } = obj; → `a` is a declaration
    if (parent.type === 'AssignmentPattern' && parent.left === node) return false;

    return true;
}
