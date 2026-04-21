/**
 * Mencari ruang lingkup fungsi terdekat (atau ruang lingkup global) di dalam tumpukan hirarki scope.
 * Ini khusus digunakan untuk deklarasi dengan kata kunci `var` karena `var` tidak terikat oleh block-scope (kurung kurawal),
 * melainkan terikat oleh function-scope (fungsional).
 * 
 * @param {Array<object>} scopeStack - Tumpukan ruang lingkup saat ini
 * @param {Array<string>} scopeTypeStack - Tipe dari setiap ruang ('function', 'block', 'global')
 * @returns {object} Mengembalikan referensi ke ruang scope fungsi terdekat atau global.
 */
export function findFunctionScope(scopeStack, scopeTypeStack) {
    for (let i = scopeStack.length - 1; i >= 0; i--) {
        if (scopeTypeStack[i] === 'function' || scopeTypeStack[i] === 'global') {
            return scopeStack[i];
        }
    }
    return scopeStack[0];
}
