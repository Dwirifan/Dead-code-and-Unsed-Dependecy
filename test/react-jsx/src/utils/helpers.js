// helpers.js — Utilitas yang dipakai oleh App.jsx

// Fungsi terpakai (di-import oleh App.jsx)
export function formatDate(date) {
    return date.toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'long',
        year: 'numeric'
    });
}

// Fungsi terpakai (di-import oleh App.jsx)
export function formatCurrency(amount) {
    return new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR'
    }).format(amount);
}

// Fungsi dead (di-export tapi tidak di-import oleh siapapun)
export function slugify(text) {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');
}

// Fungsi dead (tidak di-export, tidak dipanggil)
function internalTrim(str) {
    return str.replace(/\s+/g, ' ').trim();
}
