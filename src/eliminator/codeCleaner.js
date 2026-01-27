import estraverse from 'estraverse';
import escodegen from 'escodegen';

/**
 * Removes dead code nodes from the AST and generates cleaned code.
 * @param {object} ast - The original AST.
 * @param {Array} deadNodes - List of dead code objects { name, type, line, node }.
 * @returns {string} The cleaned source code.
 */
export function removeDeadCode(ast, deadNodes) {
    if (!deadNodes || deadNodes.length === 0) {
        return escodegen.generate(ast);
    }

    // Create a Set of nodes to remove for faster lookup
    // Note: We need reliable object reference equality. 
    // Ideally, the deadNodes passed here should contain the direct AST node references.
    // In our analyzer, we stored 'node' in the dead node object.
    const nodesToRemove = new Set(deadNodes.map(d => d.node));

    const cleanedAST = estraverse.replace(ast, {
        enter: function (node, parent) {
            // Check if this node is marked for removal
            if (nodesToRemove.has(node)) {
                return estraverse.VisitorOption.Remove;
            }
            
            // 1. Variable Declarations
            // If the node is a VariableDeclarator and it's in our remove list
            if (node.type === 'VariableDeclarator' && nodesToRemove.has(node)) {
                
                // If the parent is a VariableDeclaration (const x=1, y=2), we might need to remove just one declarator.
                // estraverse.replace on a list returns the new list (or filters).
                // However, estraverse 'enter' works on individual nodes. 
                // To remove a node from an array property of the parent, returning VisitorOption.Remove works.
                return estraverse.VisitorOption.Remove;
            }

            // 2. Function Declarations
            if (node.type === 'FunctionDeclaration' && nodesToRemove.has(node)) {
                return estraverse.VisitorOption.Remove;
            }
            
            // 3. Handle VariableDeclaration wrapper if it becomes empty?
            // estraverse might leave an empty "const ;" if we remove all declarators.
            // We need to handle this in 'leave' or check parent.
        },
        leave: function (node) {
            // Build cleanup: Remove empty VariableDeclaration nodes
            if (node.type === 'VariableDeclaration') {
                if (node.declarations.length === 0) {
                    return estraverse.VisitorOption.Remove;
                }
            }
        }
    });

    // Generate code
    // Options for cleaner output
    const codegenOptions = {
        format: {
            indent: {
                style: '    ', // 4 spaces
                base: 0,
                adjustMultilineComment: false
            },
            newline: '\n',
            space: ' ',
            json: false,
            renumber: false,
            hexadecimal: false,
            quotes: 'single', // prefer single quotes
            escapeless: false,
            compact: false,
            preserveBlankLines: true,
            semicolons: true,
            parentheses: true
        },
        comment: true // Preserve comments
    };

    return escodegen.generate(cleanedAST, codegenOptions);
}
