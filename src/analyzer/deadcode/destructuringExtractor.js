/**
 * Recursively extracts all Identifier names from a destructuring pattern.
 * Supports: Identifier, ObjectPattern, ArrayPattern, RestElement, AssignmentPattern.
 * @param {object} pattern - AST pattern node (e.g., node.id of a VariableDeclarator)
 * @returns {Array<{name: string, node: object}>} List of extracted identifiers with their AST nodes
 */
export function extractIdentifiers(pattern) {
    const identifiers = [];

    if (!pattern) return identifiers;

    switch (pattern.type) {
        case 'Identifier':
            identifiers.push({ name: pattern.name, node: pattern });
            break;

        case 'ObjectPattern':
            for (const prop of pattern.properties) {
                if (prop.type === 'RestElement') {
                    identifiers.push(...extractIdentifiers(prop.argument));
                } else if (prop.type === 'Property') {
                    identifiers.push(...extractIdentifiers(prop.value));
                }
            }
            break;

        case 'ArrayPattern':
            for (const element of pattern.elements) {
                if (element) {
                    identifiers.push(...extractIdentifiers(element));
                }
            }
            break;

        case 'RestElement':
            identifiers.push(...extractIdentifiers(pattern.argument));
            break;

        case 'AssignmentPattern':
            identifiers.push(...extractIdentifiers(pattern.left));
            break;

        default:
            break;
    }

    return identifiers;
}
