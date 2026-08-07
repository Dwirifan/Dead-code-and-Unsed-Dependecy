import fs from 'fs';
import path from 'path';

// Cache untuk menyimpan status dukungan ES2019 per root folder proyek
const environmentSupportCache = new Map();

/**
 * Menganalisa `package.json` untuk mengetahui target node engine.
 * ES2019 (mendukung Optional Catch Binding `catch {}`) hadir sejak Node >= 10.3.0
 */
function supportsES2019Catch(projectRoot) {
    if (!projectRoot) return false;

    if (environmentSupportCache.has(projectRoot)) {
        return environmentSupportCache.get(projectRoot);
    }

    try {
        const pkgPath = path.join(projectRoot, 'package.json');
        if (fs.existsSync(pkgPath)) {
            const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
            if (pkg.engines && pkg.engines.node) {
                const nodeEngine = pkg.engines.node;
                // Sangat sederhana: cari angka major pertama dari versi
                const match = nodeEngine.match(/\b([0-9]+)\b/);
                if (match && parseInt(match[1], 10) >= 12) { // Aman ambil patokan Node 12
                    environmentSupportCache.set(projectRoot, true);
                    return true;
                }
            }
        }
    } catch (err) {
        // Abaikan error pembacaan
    }

    // Default fallback: Anggap false (tidak aman menghapus kurung catch) jika ragu
    environmentSupportCache.set(projectRoot, false);
    return false;
}

/**
 * Mengevaluasi CatchParameter untuk memberikan rekomendasi perlindungan (Safe-Guard).
 * 
 * @param {Object} info Deklarasi info dari astAnalyzer
 * @param {Object} globalRegistry Registry global (untuk akses projectRoot)
 * @param {Object} ruleEngine RuleEngine (jika ada override)
 * @returns {Object} Hasil evaluasi (action, status, dll)
 */
export function evaluateCatchParameter(info, globalRegistry, ruleEngine) {
    const isBlockEmpty = info.bindingNode &&
        info.bindingNode.body &&
        info.bindingNode.body.type === 'BlockStatement' &&
        info.bindingNode.body.body &&
        info.bindingNode.body.body.length === 0;

    const projectRoot = globalRegistry ? globalRegistry.projectRoot : process.cwd();

    const isES2019Supported = supportsES2019Catch(projectRoot);

    const isSuppressed = info.name.startsWith('_'); // Deteksi konvensi ignore

    const result = {
        isCodeSmell: false,
        codeSmellType: null,
        codeSmellMessage: '',
        canBeDeleted: false,
        shouldBeRisky: false,
        riskyMessage: '',
        isValidLegacy: false
    };

    if (isBlockEmpty) {
        result.isCodeSmell = true;
        result.codeSmellType = 'EmptyCatchBlock';
        result.codeSmellMessage = 'Code Smell: Error ditelan diam-diam (Swallowed Error). Harap tangani eksepsi atau tambahkan komentar.';

        return result;
    }

    if (isSuppressed) {
        result.isValidLegacy = true;
        return result;
    }

    if (isES2019Supported) {
        result.canBeDeleted = true;
    } else {
        // Lingkungan usang, tidak aman dihapus dan belum di-suppress.
        result.shouldBeRisky = true;
        result.riskyMessage = `Parameter catch '${info.name}' tidak dipakai. Penghapusan (Auto-Fix) menyebabkan SyntaxError di Node < 12. Rekomendasi: ubah nama menjadi '_' jika sengaja diabaikan.`;
    }

    return result;
}
