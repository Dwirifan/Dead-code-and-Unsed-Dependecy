# Panduan Publikasi ke NPM Registry

Panduan ini menjelaskan langkah-langkah untuk mempublikasikan tool `deadkiller` (Tugas Akhir) ke NPM agar bisa diinstall orang lain.

## 1. Persiapan Akun NPM

Sebelum mempublikasikan, Anda harus memiliki akun di [npmjs.com](https://www.npmjs.com/).
Jika belum punya, daftar terlebih dahulu.

## 2. Login di Terminal

Buka terminal di root project, lalu jalankan:

```bash
npm login
```

Ikuti instruksi di layar (biasanya akan membuka browser untuk otentikasi).

## 3. Cek Nama Paket Otomatis

Buka `package.json` dan perhatikan field `"name"`.
Saat ini namanya adalah `"tugas-akhir"`.

> [!WARNING]
> Nama "tugas-akhir" kemungkinan besar SUDAH DIAMBIL orang lain.
> **Solusi:** Ubah nama menjadi sesuatu yang unik sebelum publish.
> Contoh: `"name": "deadkiller-cli"` atau `"name": "@dwirifan/dce-tool"`.

## 4. Publikasi Paket

Setelah login dan memastikan nama unik, jalankan:

```bash
npm publish --access public
```

Jika berhasil, Anda akan melihat log sukses dengan versi paket (misal: `+ deadkiller-cli@1.0.0`).

## 5. Cara Orang Lain Menggunakan (Instalasi)

Setelah terbit, orang lain bisa menggunakan tool Anda dengan dua cara:

### Cara A: Tanpa Install (npx)

Langsung jalankan perintah ini di mana saja:

```bash
npx deadkiller-cli scan .
```

_(Ganti `deadkiller-cli` dengan nama paket Anda yang sebenarnya)_

### Cara B: Install Global

Agar bisa dipakai berulang kali tanpa download ulang:

```bash
npm install -g deadkiller-cli

# Lalu jalankan command:
deadkiller scan .
```

## 6. Update Versi

Jika Anda mengubah kode dan ingin update paket:

1.  Ubah versi di `package.json` (misal jadi `1.0.1`).
2.  Jalankan `npm publish` lagi.
