export const kasusUji = [
    // ─── KELOMPOK A: Berhasil di Kedua Engine (Baseline) ───────────────
    {
        no: 1,
        label: 'Konstruksi JavaScript Dasar - Import dengan Alias dan Side-effect',
        file: 'tc01.js',
        kode: `
import defaultExport, { namedA, namedB as aliasB } from 'module-alpha';
import * as ModuleBeta from 'module-beta';
import 'side-effect-module';

export { defaultExport, aliasB };
`.trim()
    },
    {
        no: 2,
        label: 'Konstruksi JavaScript Dasar - Variabel Global di dalam IIFE',
        file: 'tc02.js',
        kode: `
(function(global) {
    global.globalConfig = { init: true, mode: 'strict' };
    undeclaredVariable = "This is implicitly global";
})(typeof window !== 'undefined' ? window : global);
`.trim()
    },
    {
        no: 3,
        label: 'Konstruksi JavaScript Dasar - Deklarasi Var Hoisting',
        file: 'tc03.js',
        kode: `
console.log(hoistedVar);
var hoistedVar = "I am hoisted";

for(var i = 0; i < 5; i++) {
    var leakedScope = i;
}
`.trim()
    },
    {
        no: 4,
        label: 'Konstruksi JavaScript Dasar - Deklarasi Let & Const dengan Block Scope',
        file: 'tc04.js',
        kode: `
const MAX_LIMIT = 100;
let currentCount = 0;

if (currentCount < MAX_LIMIT) {
    let blockScopedVar = "Safe here";
    currentCount += blockScopedVar.length;
}
`.trim()
    },
    {
        no: 5,
        label: 'Konstruksi JavaScript Dasar - Fungsi Generator dan Default Parameters',
        file: 'tc05.js',
        kode: `
async function* fetchDataSequence(endpoint = '/api/default', retries = 3) {
    for (let i = 0; i < retries; i++) {
        yield await fetch(\`\${endpoint}?retry=\${i}\`).then(res => res.json());
    }
}
`.trim()
    },
    {
        no: 6,
        label: 'Konstruksi JavaScript Dasar - Arrow Function Lanjutan',
        file: 'tc06.js',
        kode: `
export const processData = async (dataList) => 
    dataList
        .filter((item) => item.isValid)
        .map(({ id, value }) => ({ id, computed: value * 2 }))
        .reduce((acc, curr) => ({ ...acc, [curr.id]: curr.computed }), {});
`.trim()
    },
    {
        no: 7,
        label: 'Konstruksi JavaScript Dasar - Deep Object Destructuring',
        file: 'tc07.js',
        kode: `
const userPayload = { meta: { id: 1, roles: ['admin'] }, profile: { name: 'Alice' } };
const { 
    meta: { id: userId, roles: [primaryRole, ...otherRoles] }, 
    profile: { name = 'Anonymous', age: userAge = 18 } 
} = userPayload;
`.trim()
    },
    {
        no: 8,
        label: 'Konstruksi JavaScript Dasar - Nested Array Destructuring',
        file: 'tc08.js',
        kode: `
const matrix = [[1, 2], [3, 4], [5, 6]];
const [[topLeft, topRight], ...remainingRows] = matrix;

let x = 1, y = 2;
[x, y] = [y, x]; // Swap trick
`.trim()
    },
    {
        no: 9,
        label: 'JavaScript & TypeScript Dasar - Decorators & Class',
        file: 'tc09.ts',
        kode: `
import { Injectable, Logger } from '@core';

@Injectable()
export class DataService<T extends Record<string, any>> {
    constructor(private readonly logger: Logger) {}
    
    public async processBatch(items: T[]): Promise<void> {
        this.logger.info(\`Processing \${items.length} items\`);
    }
}
`.trim()
    },

    {
        no: 12,
        label: 'TypeScript 4.1 — Template Literal Types Lanjutan',
        file: 'tc12.ts',
        kode: `
type Endpoint = 'users' | 'posts' | 'comments';
type Method = 'GET' | 'POST' | 'DELETE';
type ApiRoute = \`/api/v1/\${Endpoint}\`;
type ApiSignature = \`\${Method} \${ApiRoute}\`;

export class ApiClient {
    public request<T>(route: ApiSignature, payload?: any): Promise<T> {
        const [method, url] = route.split(' ');
        return fetch(url, { method, body: JSON.stringify(payload) }).then(r => r.json());
    }
}
`.trim()
    },

    // ─── KELOMPOK B: Uji Kompatibilitas Sintaks (Compatibility Test) ───────────────
    {
        no: 13,
        label: 'Type-Only Export (TS 3.8+) - Terpisah',
        file: 'tc13.ts',
        kode: `
interface UserProfile { id: string; name: string; }
type AuthCredentials = { token: string; expiresIn: number; };

export type { UserProfile, AuthCredentials };
`.trim()
    },
    {
        no: 14,
        label: 'Inline Type Export (TS 4.5+) - Bersama Runtime',
        file: 'tc14.ts',
        kode: `
import { createStore, Reducer } from 'redux';

export const rootReducer: Reducer = (state = {}, action) => state;
export const store = createStore(rootReducer);

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
`.trim()
    },
    {
        no: 15,
        label: 'Export Type Star (TS 3.8+) - Namespace & Direct',
        file: 'tc15.ts',
        kode: `
export type * from './interfaces/models.d.ts';
export type * as NetworkTypes from './interfaces/network.d.ts';
`.trim()
    },
    {
        no: 16,
        label: 'Override keyword pada Polymorphism Kompleks',
        file: 'tc16.ts',
        kode: `
abstract class AbstractWorker {
    abstract performTask(taskId: string): Promise<boolean>;
    protected log(msg: string) { console.log(msg); }
}

export class BackgroundWorker extends AbstractWorker {
    public override async performTask(taskId: string): Promise<boolean> {
        this.log(\`Starting background task: \${taskId}\`);
        return true;
    }
}
`.trim()
    },
    {
        no: 17,
        label: 'Operator satisfies (TS 4.9+) - Objek Bersarang',
        file: 'tc17.ts',
        kode: `
type AppConfig = {
    features: Record<string, boolean>;
    apiEndpoints: Record<string, string>;
};

export const prodConfig = {
    features: { newUI: false, betaAccess: true },
    apiEndpoints: { graphql: 'https://api.example.com/graphql' }
} satisfies AppConfig;
`.trim()
    },
    {
        no: 18,
        label: 'Assignment ke Non-Null Assertion dalam Kondisional',
        file: 'tc18.ts',
        kode: `
interface Config { retries?: number; timeout?: number; }

export function applyDefaults(cfg: Config) {
    if (cfg.retries !== undefined) {
        cfg.retries! += 1;
    } else {
        cfg.retries = 3;
    }
}
`.trim()
    },
    // ─── KELOMPOK C: Pengujian Kompatibilitas Traversal AST ───────────────
    {
        no: 19,
        label: 'TSInterfaceDeclaration dapat ditelusuri',
        file: 'tc19.ts',
        kode: `
export interface IRepository<T> {
    findById(id: string): Promise<T | null>;
    save(entity: T): Promise<void>;
}
`.trim(),
        expectedNodeType: 'TSInterfaceDeclaration'
    },
    {
        no: 20,
        label: 'TSTypeAliasDeclaration dapat ditelusuri',
        file: 'tc20.ts',
        kode: `
export type Result<T, E = Error> = 
    | { success: true; data: T }
    | { success: false; error: E };
`.trim(),
        expectedNodeType: 'TSTypeAliasDeclaration'
    },
    {
        no: 21,
        label: 'TSEnumDeclaration dapat ditelusuri',
        file: 'tc21.ts',
        kode: `
export enum HttpStatusCode {
    OK = 200,
    BAD_REQUEST = 400,
    UNAUTHORIZED = 401,
    INTERNAL_SERVER_ERROR = 500
}
`.trim(),
        expectedNodeType: 'TSEnumDeclaration'
    },
    {
        no: 22,
        label: 'TSModuleDeclaration dapat ditelusuri',
        file: 'tc22.ts',
        kode: `
export namespace MathematicalOperations {
    export const PI = 3.14159;
    
    export function calculateCircumference(radius: number): number {
        return 2 * PI * radius;
    }
}
`.trim(),
        expectedNodeType: 'TSModuleDeclaration'
    }
];

// ─── KELOMPOK D: Skenario Kehancuran Mutlak (Engine Crash & Extreme Lag) ───────────────
// Membuat AST bersarang hingga 15.000 tingkat (Menguji batas Call Stack Node.js V8)
const deepNestingCode = 'const bomb = ' + '['.repeat(15000) + '1' + ']'.repeat(15000) + ';';

// Membuat payload raksasa (Dikecilkan menjadi 2.000 baris agar testing tidak hang, untuk skripsi bisa ditulis 200.000)
const massivePayloadCode = Array.from({ length: 2000 }, (_, i) => `export const var${i} = ${i}; function doNothing${i}() { return ${i}; }`).join('\n');

kasusUji.push(
    {
        no: 23,
        label: 'Skenario Kehancuran - Deep Nesting (Menyebabkan RangeError: Maximum Call Stack)',
        file: 'tc23.js',
        kode: deepNestingCode,
        isError: true
    },
    {
        no: 24,
        label: 'Skenario Lag Ekstrem - Massive Payload (2.000 Baris Deklarasi & Ekspor)',
        file: 'tc24.js',
        kode: massivePayloadCode
    }
);