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
            if (info.isImport) {
                return { confidence: 'high', status: 'safe', reason: 'Modul diimpor tetapi tidak pernah direferensikan atau digunakan dalam kode.' };
            }
            // Variable lokal biasa = high confidence
            return { confidence: 'high', status: 'safe', reason: 'Variabel lokal dideklarasikan tetapi nilainya tidak pernah dibaca atau digunakan.' };

        case 'UnusedType':
            // Interface/Type/Enum TypeScript yang tidak dipakai
            return { confidence: 'high', status: 'safe', reason: 'Tipe/Interface/Alias TypeScript dideklarasikan tetapi tidak pernah digunakan.' };

        case 'UnusedEnumMember':
            return { confidence: 'high', status: 'safe', reason: 'Anggota Enum tidak pernah direferensikan dalam logika aplikasi.' };

        case 'WriteOnly':
            // Variable yang hanya ditulis tapi tidak pernah dibaca
            return { confidence: 'medium', status: 'review', reason: 'Variabel hanya diberi nilai (assign) tetapi nilainya tidak pernah dibaca (perlu peninjauan side-effect).' };

        case 'DeadStore':
            // Penugasan berulang sia-sia (Wasted Computation)
            return { confidence: 'medium', status: 'review', reason: 'Nilai ditugaskan ke variabel tetapi tertimpa oleh nilai lain sebelum sempat dibaca.' };

        case 'Function':
            // Fungsi yang tidak dipanggil di scope manapun
            return { confidence: 'medium', status: 'review', reason: 'Fungsi dideklarasikan tetapi tidak terdeteksi dipanggil dalam scope internal.' };

        // === HIGH CONFIDENCE (Pasti tidak tereksekusi) ===
        case 'DeadCode':
        case 'DeadBranch':
            return { confidence: 'high', status: 'safe', reason: 'Blok kode tidak dapat dicapai (unreachable) setelah statement return/throw/break atau kondisi mustahil.' };

        // === MEDIUM CONFIDENCE (Butuh peninjauan) ===
        case 'DuplicateCondition':
            return { confidence: 'medium', status: 'review', reason: 'Kondisi percabangan identik dengan kondisi pada cabang sebelumnya.' };

        case 'EmptyBlock':
            return { confidence: 'medium', status: 'review', reason: 'Blok kode kosong tanpa instruksi atau eksekusi logika.' };

        case 'DuplicateImport':
            return { confidence: 'high', status: 'safe', reason: 'Modul yang sama diimpor berulang kali dalam satu file.' };

        case 'RedundantCode':
            return { confidence: 'medium', status: 'review', reason: 'Kode redundan atau tidak memberikan efek samping logika (no-op).' };

        case 'PathWarning':
            return { confidence: 'low', status: 'risky', reason: 'Peringatan resolusi jalur modul (perlu diverifikasi manual).' };

        // === LOW CONFIDENCE (Berisiko tinggi) ===
        case 'ClassMethod':
            return { confidence: 'low', status: 'risky', reason: 'Metode kelas tidak terdeteksi dipanggil secara eksplisit (risiko dipanggil via dynamic/framework callback).' };

        case 'Parameter':
            return { confidence: 'low', status: 'risky', reason: 'Parameter fungsi tidak digunakan dalam tubuh fungsi (risiko mengubah tanda tangan/API fungsi jika dihapus).' };

        case 'UndeclaredVariable':
            // Bug: variabel digunakan tapi tidak pernah dideklarasikan (no-undef)
            return { confidence: 'high', status: 'review', reason: 'Variabel direferensikan tetapi tidak ditemukan deklarasinya (kemungkinan import yang hilang atau typo).' };

        default:
            return { confidence: 'medium', status: 'review', reason: 'Item tidak digunakan atau berpotensi redundan (perlu peninjauan).' };
    }
}
