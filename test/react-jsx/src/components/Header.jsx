// Header.jsx — Komponen header sederhana

import React from 'react';
import axios from 'axios';

// Fungsi yang dipakai
export function fetchData(url) {
    return axios.get(url);
}

// Fungsi dead (tidak dipanggil di manapun)
function internalLog(msg) {
    console.log('[Header]', msg);
}

// Variabel dead
const HEADER_VERSION = '2.0';

export default function Header({ title }) {
    return (
        <header>
            <h1>{title}</h1>
            <nav>
                <a href="/">Home</a>
                <a href="/about">About</a>
            </nav>
        </header>
    );
}
