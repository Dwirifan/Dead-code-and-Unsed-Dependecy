export function greet(name: string): string {
    return `Hello, ${name}!`;
}

// UNUSED export — should be detectable via cross-file analysis
export function farewell(name: string): string {
    return `Goodbye, ${name}!`;
}
