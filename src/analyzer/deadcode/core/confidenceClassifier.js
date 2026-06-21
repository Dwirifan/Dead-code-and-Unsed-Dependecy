/**
 * Sistem Klasifikasi Kepercayaan (Confidence Scoring)
 * 
 * Setiap temuan dead code diberi label:
 *   - confidence: 'high' | 'medium' | 'low'
 *   - status:     'safe' | 'review' | 'risky'
 * 
 * Aturan Penentuan:
 *   HIGH  + SAFE   → Unused local variable, unused import (99% aman dihapus)
 *   HIGH  + SAFE   → Unreachable code setelah return/throw (100% aman)
 *   MEDIUM + REVIEW → Unused function, write-only variable (perlu cek side-effect)
 *   MEDIUM + REVIEW → Duplicate condition (logika mungkin sengaja)
 *   LOW   + RISKY  → Class method, parameter (risiko rusak API/callback)
 */
export function classifyConfidence(type, info = {}) {
    switch (type) {
        // === HIGH CONFIDENCE (Aman dihapus) ===
        case 'Variable':
            // Import yang tidak dipakai = high confidence
            if (info.isImport) return { confidence: 'high', status: 'safe' };
            // Variable lokal biasa = high confidence
            return { confidence: 'high', status: 'safe' };

        case 'UnusedType':
            // Interface/Type/Enum TypeScript yang tidak dipakai
            return { confidence: 'high', status: 'safe' };

        case 'UnusedEnumMember':
            return { confidence: 'high', status: 'safe' };

        case 'WriteOnly':
            // Variable yang hanya ditulis tapi tidak pernah dibaca
            return { confidence: 'medium', status: 'review' };

        case 'DeadStore':
            // Penugasan berulang sia-sia (Wasted Computation)
            return { confidence: 'medium', status: 'review' };

        case 'Function':
            // Fungsi yang tidak dipanggil di scope manapun
            return { confidence: 'medium', status: 'review' };

        // === HIGH CONFIDENCE (Pasti tidak tereksekusi) ===
        case 'DeadCode':
        case 'DeadBranch':
            return { confidence: 'high', status: 'safe' };

        // === MEDIUM CONFIDENCE (Butuh peninjauan) ===
        case 'DuplicateCondition':
            return { confidence: 'medium', status: 'review' };

        case 'EmptyBlock':
            return { confidence: 'medium', status: 'review' };

        case 'DuplicateImport':
            return { confidence: 'high', status: 'safe' };

        case 'RedundantCode':
            return { confidence: 'medium', status: 'review' };

        case 'PathWarning':
            return { confidence: 'low', status: 'risky' };

        // === LOW CONFIDENCE (Berisiko tinggi) ===
        case 'ClassMethod':
            return { confidence: 'low', status: 'risky' };

        case 'Parameter':
            return { confidence: 'low', status: 'risky' };

        default:
            return { confidence: 'medium', status: 'review' };
    }
}
