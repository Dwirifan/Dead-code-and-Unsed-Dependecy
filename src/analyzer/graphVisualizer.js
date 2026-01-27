import path from 'path';

/**
 * Generates Mermaid definitions from project graph.
 * @param {object} graph - { liveFiles: Set<string>, usedPackages: Set<string> }
 * @param {string} rootDir - Project root directory for relative paths
 * @returns {string} Mermaid graph definition
 */
export function generateMermaidGraph(graph, rootDir) {
    const lines = ['graph TD'];
    
    // Nodes
    const nodes = new Map(); // path -> id
    let idCounter = 0;

    const getId = (p) => {
        if (!nodes.has(p)) {
            nodes.set(p, `N${idCounter++}`);
        }
        return nodes.get(p);
    };

    // Add Live Files
    const liveFilesList = Array.from(graph.liveFiles).sort(); // Sort for consistency
    liveFilesList.forEach(file => {
        const id = getId(file);
        const label = path.relative(rootDir, file).replace(/\\/g, '/');
        lines.push(`    ${id}["📄 ${label}"]`);
        
        // Add styling if needed
        // lines.push(`    style ${id} fill:#f9f,stroke:#333,stroke-width:2px`);
    });

    // Add Packages (Optional, might clutter the graph)
    // Array.from(graph.usedPackages).forEach(pkg => {
    //     const id = getId(pkg);
    //     lines.push(`    ${id}("📦 ${pkg}")`);
    // });

    // Add Edges
    if (graph.edges) {
        graph.edges.forEach(edge => {
            const fromId = getId(edge.from);
            const toId = getId(edge.to);
            lines.push(`    ${fromId} --> ${toId}`);
        });
    }

    return lines.join('\n');
}
