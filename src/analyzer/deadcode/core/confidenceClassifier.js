export function classifyConfidence(type, info = {}) {
    // === ABSOLUTE PROTECTION (TypeScript Type Annotations) ===
    if (info.isDeclare) {
        return { confidence: 'protected', status: 'protected', reason: 'Deklarasi ini adalah murni Type Annotation (TypeScript declare/abstract) dan dilindungi dari penghapusan.' };
    }
    if (info.isFakeThisContext) {
        return { confidence: 'protected', status: 'protected', reason: 'Parameter ini adalah konteks binding `this` semu milik TypeScript dan dilindungi dari penghapusan.' };
    }

    switch (type) {
        // === HIGH CONFIDENCE (Aman dihapus) ===
        case 'Variable':
            // Import yang tidak dipakai = high confidence
            if (info.isImport) {
                return { confidence: 'high', status: 'safe', reason: 'Modul diimpor tetapi tidak pernah direferensikan atau digunakan dalam kode.' };
            }
            if (info.isImpureInitializer) {
                return {
                    confidence: 'medium',
                    status: 'review',
                    reason: 'Binding variabel tidak pernah dibaca, tetapi inisialisasinya memanggil fungsi atau memiliki efek samping. Pertahankan ekspresi inisialisasi saat menghapus binding.'
                };
            }
            // Variable lokal biasa = high confidence
            return { confidence: 'high', status: 'safe', reason: 'Variabel lokal dideklarasikan tetapi nilainya tidak pernah dibaca atau digunakan.' };

        case 'UnusedType':
            // Interface/Type/Enum TypeScript yang tidak dipakai
            return { confidence: 'high', status: 'safe', reason: 'Tipe/Interface/Alias TypeScript dideklarasikan tetapi tidak pernah digunakan.' };

        case 'UnusedClass':
            return { confidence: 'high', status: 'safe', reason: 'Kelas dideklarasikan tetapi tidak pernah diinstansiasi atau digunakan dalam kode.' };

        case 'UnusedEnumMember':
            return { confidence: 'high', status: 'safe', reason: 'Anggota Enum tidak pernah direferensikan dalam logika aplikasi.' };

        case 'WriteOnly':
            if (info && info.isImpureWrite) {
                return {
                    confidence: 'medium',
                    status: 'review',
                    reason: 'Variabel Write-Only memiliki penugasan dengan efek samping (side-effect seperti panggilan fungsi/IO). Kebijakan: Hanya hapus deklarasi variabelnya, tetapi pertahankan instruksi eksekusi fungsinya.'
                };
            }
            return {
                confidence: 'high',
                status: 'safe',
                reason: 'Variabel hanya diberi nilai (assign) dengan ekspresi murni (pure) tetapi nilainya tidak pernah dibaca (aman untuk dihapus sepenuhnya).'
            };

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
            if (info && info.isAnonymousCallback) {
                return { confidence: 'low', status: 'risky', reason: 'Fungsi berbadan kosong yang dilempar sebagai pelengkap parameter (callback/stub). Fungsi ini terdeteksi sebagai statis murni dead, namun dilarang dihapus karena berpotensi merusak interface contract argumen.' };
            }
            return { confidence: 'medium', status: 'review', reason: 'Blok kode kosong tanpa instruksi atau eksekusi logika.' };

        case 'DuplicateImport':
            return { confidence: 'high', status: 'safe', reason: 'Modul yang sama diimpor berulang kali dalam satu file.' };

        case 'RedundantCode':
            return { confidence: 'medium', status: 'review', reason: 'Kode redundan atau tidak memberikan efek samping logika (no-op).' };

        case 'PathWarning':
            return { confidence: 'low', status: 'risky', reason: 'Peringatan resolusi jalur modul (perlu diverifikasi manual).' };

        // === LOW CONFIDENCE (Berisiko tinggi) ===
        case 'ClassMethod':
            if (info && info.hasDecorator) {
                return { confidence: 'low', status: 'risky', reason: 'Metode kelas menggunakan dekorator refleksi/framework (berisiko tinggi jika dihapus).' };
            }
            if (info && info.dynamicRisk) {
                return {
                    confidence: 'medium',
                    status: 'review',
                    reason: `Metode tidak memiliki referensi statis, tetapi ${info.dynamicRiskScope || 'kelas terkait'} memiliki akses member dinamis; temuan dilaporkan tanpa penghapusan otomatis.`
                };
            }
            if (info && (info.isPrivate || info.accessibility === 'private')) {
                return { confidence: 'high', status: 'safe', reason: 'Metode privat (#/private) tidak pernah dipanggil di dalam kelasnya sendiri (100% aman dihapus).' };
            }
            if (info && (info.isProtected || info.accessibility === 'protected') && info.isLeafClass) {
                return { confidence: 'high', status: 'safe', reason: 'Metode protected pada leaf class (tanpa kelas turunan) tidak pernah dipanggil (aman dihapus).' };
            }
            return { confidence: 'low', status: 'risky', reason: 'Metode publik atau berpotensi diwarisi tidak terdeteksi dipanggil secara eksplisit (risiko dipanggil via eksternal/framework callback).' };

        case 'Parameter': {
            const parameterName = typeof info.name === 'string' ? info.name : '';
            const suggestedName = parameterName
                ? (parameterName.startsWith('_') ? parameterName : `_${parameterName}`)
                : '_parameter';

            if (info.isPositional) {
                const isAlreadyPrefixed = parameterName && parameterName.startsWith('_');
                const reasonText = isAlreadyPrefixed
                    ? `Parameter '${parameterName}' adalah parameter posisional. Meskipun sudah ditandai dengan '_' (sengaja tidak dipakai), kehadirannya wajib dipertahankan karena parameter setelahnya masih digunakan (bersifat struktural).`
                    : `Parameter '${parameterName || 'ini'}' tidak digunakan, tetapi posisinya wajib dipertahankan karena parameter setelahnya masih digunakan. Jangan hapus; gunakan nama '${suggestedName}' bila ingin menandainya sebagai sengaja tidak digunakan.`;
                
                return {
                    confidence: 'high',
                    status: 'risky',
                    reason: reasonText
                };
            }

            return {
                confidence: 'low',
                status: 'risky',
                reason: `Parameter tidak digunakan. Rekomendasi: gunakan prefix '_' (misal: ${suggestedName}) jika ingin dipertahankan.`
            };
        }

        case 'CatchParameter':
            return {
                confidence: 'high',
                status: 'safe',
                reason: 'Parameter catch tidak pernah digunakan. Karena Node.js >= 12 mendukung Optional Catch Binding, parameter ini aman untuk dihapus (auto-fix).'
            };

        case 'UndeclaredVariable':
            // Bug: variabel digunakan tapi tidak pernah dideklarasikan (no-undef)
            return { confidence: 'high', status: 'review', reason: 'Variabel direferensikan tetapi tidak ditemukan deklarasinya (kemungkinan import yang hilang atau typo).' };

        default:
            return { confidence: 'medium', status: 'review', reason: 'Item tidak digunakan atau berpotensi redundan (perlu peninjauan).' };
    }
}
