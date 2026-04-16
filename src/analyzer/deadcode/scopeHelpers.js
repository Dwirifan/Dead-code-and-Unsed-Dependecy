/**
 * Finds the nearest function scope (or global scope) in the scope stack.
 * Used for `var` declarations which are function-scoped, not block-scoped.
 * @param {Array<object>} scopeStack - The current scope stack
 * @param {Array<string>} scopeTypeStack - The type of each scope ('function', 'block', 'global')
 * @returns {object} The nearest function or global scope
 */
export function findFunctionScope(scopeStack, scopeTypeStack) {
    for (let i = scopeStack.length - 1; i >= 0; i--) {
        if (scopeTypeStack[i] === 'function' || scopeTypeStack[i] === 'global') {
            return scopeStack[i];
        }
    }
    return scopeStack[0];
}
