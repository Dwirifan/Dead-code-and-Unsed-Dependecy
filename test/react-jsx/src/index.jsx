// Entry point: src/index.jsx
// Ini adalah file utama yang di-trace dari package.json "main"

import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';

// Variabel sengaja tidak terpakai (dead code)
const APP_VERSION = '1.0.0';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
    <React.StrictMode>
        <App />
    </React.StrictMode>
);
