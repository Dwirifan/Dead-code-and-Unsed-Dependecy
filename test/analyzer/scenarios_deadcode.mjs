export const kasusUjiDeadCode = [
    {
        no: 1,
        label: 'Unused import JavaScript biasa (.js)',
        file: 'test1.js',
        kode: `
import { format } from 'date-fns';
const x = 1;
export default x;
`.trim(),
        harusTerdeteksi: ['format'],
        note: 'Dasar — harus terdeteksi di kedua engine'
    },
    {
        no: 2,
        label: 'Unused variable di TypeScript dasar (.ts)',
        file: 'test2.ts',
        kode: `
const nama: string = "Dwi";
const umur: number = 22;
export { umur };
`.trim(),
        harusTerdeteksi: ['nama'],
        note: 'Variabel tidak terpakai dengan anotasi tipe sederhana'
    },
    {
        no: 3,
        label: 'Unused variable di komponen React (.jsx)',
        file: 'test3.jsx',
        kode: `
import React from 'react';
const unusedVar = "dead";

function Kartu() { 
    return <div className="card">Halo</div>; 
}
export default Kartu;
`.trim(),
        harusTerdeteksi: ['unusedVar'],
        note: 'Variabel tidak terpakai di dalam file JSX murni'
    },
    {
        no: 4,
        label: 'Unused TypeScript interface',
        file: 'test4.ts',
        kode: `
interface UserProfile {
    id: number;
    nama: string;
}
const x = 1;
export default x;
`.trim(),
        harusTerdeteksi: ['UserProfile'],
        note: 'Hanya terdeteksi jika engine menelusuri TSInterfaceDeclaration'
    },
    {
        no: 5,
        label: 'Unused TypeScript type alias',
        file: 'test5.ts',
        kode: `
type Status = 'active' | 'inactive';
const x = 1;
export default x;
`.trim(),
        harusTerdeteksi: ['Status'],
        note: 'Hanya terdeteksi jika engine menelusuri TSTypeAliasDeclaration'
    },
    {
        no: 6,
        label: 'Unused TypeScript enum',
        file: 'test6.ts',
        kode: `
enum Warna { 
    Merah, 
    Hijau, 
    Biru 
}
const x = 1;
export default x;
`.trim(),
        harusTerdeteksi: ['Warna'],
        note: 'Hanya terdeteksi jika engine menelusuri TSEnumDeclaration'
    },
    {
        no: 7,
        label: 'Unused Type-only Import',
        file: 'test7.ts',
        kode: `
import type { UserData } from './types';
const x = 1;
export default x;
`.trim(),
        harusTerdeteksi: ['UserData'],
        note: 'Hanya terdeteksi jika parser memahami import type khusus TypeScript'
    },
    {
        no: 8,
        label: 'Unused namespace',
        file: 'test8.ts',
        kode: `
namespace Utility {
    export const a = 1;
}
const x = 1;
export default x;
`.trim(),
        harusTerdeteksi: ['Utility'],
        note: 'Hanya terdeteksi jika engine menelusuri TSModuleDeclaration'
    },
    {
        no: 9,
        label: 'Unused variable di file TSX',
        file: 'test9.tsx',
        kode: `
import React from 'react';
const tidakTerpakai = "dead";

function App() { 
    return <div>Halo</div>; 
}
export default App;
`.trim(),
        harusTerdeteksi: ['tidakTerpakai'],
        note: 'Variabel unused di dalam file TSX (TypeScript + JSX)'
    },
    {
        no: 10,
        label: 'Operator satisfies (TypeScript 4.9+)',
        file: 'test10.ts',
        kode: `
const palette = { 
    red: [255,0,0] 
} satisfies Record<string, number[]>;

export default palette;
`.trim(),
        harusTerdeteksi: [],
        note: 'Uji parsing sintaks modern TypeScript'
    }
];
