// App.jsx — Komponen utama React

import React, { useState } from 'react';
import Header from './components/Header.jsx';
import Dashboard from './components/Dashboard.tsx';
import { formatDate, formatCurrency } from './utils/helpers.js';

// Fungsi yang tidak pernah dipanggil (dead code)
function debugApp() {
    console.log('Debug mode aktif');
}

// Variabel dead
const MAX_RETRIES = 3;

export default function App() {
    const [count, setCount] = useState(0);

    return (
        <div className="app">
            <Header title="React Dead Code Test" />
            <main>
                <p>Tanggal: {formatDate(new Date())}</p>
                <p>Harga: {formatCurrency(50000)}</p>
                <p>Counter: {count}</p>
                <button onClick={() => setCount(c => c + 1)}>Tambah</button>
            </main>
        </div>
    );
}
