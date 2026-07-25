import js from '@eslint/js';
import globals from 'globals';

/**
 * Konfigurasi ESLint (Flat Config - ESLint v9+)
 * Didesain sebagai teman pendamping developer saat mengembangkan CLI DeadKiller.
 */
export default [
  // 1. Abaikan direktori dan file hasil generate / build
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'coverage/**',
      '**/*.html',
      'package-lock.json',
      // Abaikan file dummy/fixture yang berisi kode kotor sengaja untuk pengujian analyzer
      'test/dirty.js',
      'test/refactor_baseline/**',
      'test/fixtures/**'
    ]
  },

  // 2. Konfigurasi utama untuk seluruh file sumber daya (CLI, Engine, dkk)
  {
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.es2022
      }
    },
    rules: {
      ...js.configs.recommended.rules,

      // -- Aturan Khusus yang Ramah untuk Pengembangan CLI --

      // CLI tool membutuhkan console.log / console.error / console.warn
      'no-console': 'off',

      // Berikan warning (bukan error) jika ada variabel tak terpakai,
      // dan abaikan variabel/argumen yang berawalan underscore (_)
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_'
        }
      ],

      // Izinkan blok try-catch kosong (misalnya saat pengujian eksistensi file fallback)
      'no-empty': ['warn', { allowEmptyCatch: true }],

      // Izinkan perulangan kondisional tetap (misal while(true) pada parser tertentu)
      'no-constant-condition': ['warn', { checkLoops: false }],

      // Beri peringatan ringan untuk escape character yang tidak perlu
      'no-useless-escape': 'warn',

      // Izinkan pemanggilan langsung dari Object.prototype jika diperlukan
      'no-prototype-builtins': 'off',

      // Mencegah redeklarasi variabel secara tidak sengaja
      'no-redeclare': 'error'
    }
  },

  // 3. Konfigurasi khusus untuk environment Testing (Vitest)
  {
    files: ['test/**/*.js', 'test/**/*.mjs', '**/*.test.js', 'tests/**/*.js'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.vitest,
        describe: 'readonly',
        it: 'readonly',
        test: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        vi: 'readonly'
      }
    },
    rules: {
      // Dalam tes sering ada ekspresi tunggal seperti expect(foo).to.be.true
      'no-unused-expressions': 'off'
    }
  }
];
