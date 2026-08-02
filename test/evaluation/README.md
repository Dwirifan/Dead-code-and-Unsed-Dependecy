# Harness Evaluasi Z/G/T

Harness ini membandingkan akurasi DeadKiller pada tiga kondisi yang memakai
commit proyek identik:

- **Z (zero-config):** menjalankan `scan --json --no-config`.
- **G (generated):** menjalankan `scan --json` pada copy/worktree yang sudah
  berisi konfigurasi hasil generator.
- **T (tuned):** menjalankan `scan --json` pada copy/worktree yang sudah berisi
  konfigurasi yang disetel manual.

Harness tidak membuat worktree, menyalin konfigurasi, menjalankan instalasi,
atau mengakses jaringan. G dan T harus disiapkan pengguna sebelum evaluasi.
Seluruh output wajib ditempatkan di luar ketiga repo target. Setelah setiap arm,
harness membandingkan `git status` sebelum dan sesudah proses serta gagal bila
state berubah; perubahan tidak di-rollback otomatis.

Sebelum direktori output dibuat, harness juga membentuk snapshot konten Git untuk
setiap arm: seluruh file tracked serta untracked non-ignored di-hash bersama path,
tipe, mode, dan ukuran. Satu-satunya perbedaan yang dikecualikan adalah paling
banyak satu config DeadKiller pada root masing-masing arm. Ketiga hash dan jumlah
file harus identik. Root arm juga wajib terpisah dan tidak boleh saling nested.

## Menyiapkan eksperimen

1. Siapkan tiga copy atau worktree berbeda pada commit dan snapshot file yang
   sama. Jangan menaruh salah satu arm di dalam arm lain.
2. Z boleh memiliki paling banyak satu config karena flag `--no-config` akan
   mengabaikannya; config tersebut dikecualikan dari perbandingan snapshot.
3. Letakkan tepat satu config aktif pada root G dan tepat satu pada root T.
   Nama yang didukung adalah `deadkiller.config.mjs`,
   `deadkiller.config.js`, atau `.deadkillerrc.json`.
4. Salin `manifest.example.json`, isi commit riil dan ground truth, kemudian
   sesuaikan ketiga path. Path manifest relatif dihitung dari direktori manifest.
5. Pastikan dependency proyek sudah tersedia secara lokal. Harness tidak
   menjalankan `npm install`.

### Satu run, satu snapshot eksperimen

Satu manifest dan satu run hanya boleh mewakili salah satu dari dua keadaan:

- **baseline:** ketiga arm berisi snapshot proyek asli yang sama; atau
- **injeksi:** ketiga arm berisi snapshot hasil injeksi yang sama.

Jangan membandingkan Z baseline dengan G/T hasil injeksi dalam satu manifest.
Untuk beberapa injeksi, buat manifest/run terpisah per snapshot injeksi. Ground
truth pada manifest harus menjelaskan snapshot yang sedang dipakai, bukan gabungan
baseline dan injeksi lain. Config root Z/G/T boleh berbeda karena sengaja
dikecualikan; file non-config lainnya harus byte-identik.

Contoh eksekusi:

```powershell
node .\test\evaluation\run-evaluation.mjs `
  .\test\evaluation\manifest.local.json `
  --output D:\evaluation-results\run-01
```

Path output harus belum ada. Untuk menguji CLI lain secara eksplisit:

```powershell
node .\test\evaluation\run-evaluation.mjs manifest.json `
  --output D:\evaluation-results\run-02 `
  --cli D:\deadkiller\bin\dce-cli.js
```

Progress dan error ditulis ke stderr. Jika berhasil, stdout hanya berisi summary
JSON sehingga dapat dialihkan ke pipeline lain.

## Struktur manifest

Field wajib:

- `schemaVersion`: harus `1`.
- `repoRoot`: root untuk arm Z.
- `commit`: hash commit heksadesimal 7–64 karakter. `HEAD` ketiga arm harus
  identik dan cocok dengan hash ini.
- `groundTruth.findings`: daftar finding unik.
- `arms.G.repoRoot` dan `arms.T.repoRoot`: copy/worktree terpisah.

Field opsional:

- `name`: label eksperimen.
- `scanTimeoutMs`: timeout setiap scan, default 300000 ms.
- `validationCommands`: command yang dijalankan pada setiap arm sebelum scan.
- `arms.<ID>.validationCommands`: command tambahan khusus arm.
- `arms.G.configPath` dan `arms.T.configPath`: path config yang diharapkan,
  relatif terhadap root arm. Jika tidak diisi, harness tetap mendeteksi dan
  mewajibkan tepat satu config aktif pada root.

Validation command selalu dijalankan langsung dengan `shell: false` dan berbentuk:

```json
{
  "command": "npm",
  "args": ["test"],
  "cwd": ".",
  "timeoutMs": 120000
}
```

`cwd` harus tetap berada di dalam root arm. Harness sendiri tidak memanggil
jaringan, tetapi isi validation command adalah tanggung jawab pengguna. Gunakan
command deterministik yang tidak mengunduh dependency dan tidak menulis source.
Pada Windows, executable `npm`, `npx`, `pnpm`, dan `yarn` otomatis diarahkan ke
shim `.cmd` agar tetap dapat dijalankan dengan `shell: false`.

## Ground truth dan ruang lingkup prediksi

Setiap finding dicocokkan secara eksak dengan tiga field string:

```text
file + type + name
```

`file` harus berupa path portabel relatif root (gunakan `/`). Evaluator mengambil
prediksi dari empat field raw report:

| Sumber report | Representasi key |
| --- | --- |
| `deadCode` | `file`, `type`, dan `name` dari report |
| `deadFiles` | `file=<path>`, `type=DeadFile`, `name=*` |
| `unusedDependencies` | `file=package.json`, `type=UnusedDependency` |
| `deadDevDependencies` | `file=package.json`, `type=DeadDevDependency` |

Finding `uncertain`, missing dependency, unresolved import, duplicate export,
dan circular dependency sengaja tidak masuk metrik precision/recall utama.
Raw report tetap menyimpannya untuk analisis kualitatif.

Pencocokan bersifat set-based. Finding duplikat pada ground truth ditolak;
duplikat identik pada prediksi dihitung satu kali. Jika denominator suatu metrik
nol, nilainya ditulis sebagai JSON `null` (bukan `0`). Dengan demikian repo bersih
tanpa ground truth dan tanpa prediksi tidak keliru dinilai memiliki performa nol.

## Output

Direktori output berisi:

- `Z.raw.json`, `G.raw.json`, `T.raw.json`: stdout asli `scan --json`.
- `Z.stderr.txt`, `G.stderr.txt`, `T.stderr.txt`: diagnostic stderr scan.
- `Z.validation.json`, `G.validation.json`, `T.validation.json`: command,
  exit code, stdout, dan stderr validasi.
- `summary.json`: TP, FP, FN, precision, recall, F1, serta daftar true positive,
  false positive, dan false negative setiap arm.

Summary juga mencatat hash dan jumlah file snapshot bersama config yang
dikecualikan untuk tiap arm. Harness memvalidasi treatment dari raw report, bukan
dari label arm saja: Z wajib melaporkan `policy=none` dan `loaded=false`, sedangkan
G/T wajib melaporkan `loaded=true`, `source=file`, serta path config yang cocok.
Hash SHA-256 CLI dan config serta commit penuh dicatat sebagai provenance. File
CLI di-hash ulang sebelum dan sesudah setiap arm; perubahan selama run membuat
evaluasi gagal.

File yang diabaikan Git (misalnya `node_modules`) tidak masuk hash snapshot. Oleh
karena itu dependency lokal ketiga arm tetap harus berasal dari instalasi yang
setara dan tidak boleh diubah selama eksperimen.

## Unit test harness

Core evaluator memakai modul bawaan Node dan dapat diuji tanpa network:

```powershell
node --test --test-isolation=none `
  .\test\evaluation\evaluation-core.test.mjs `
  .\test\evaluation\runner.integration.test.mjs
```

Integration test membuat tiga repo Git sementara dan fake CLI lokal. Jika sandbox
secara eksplisit melarang subprocess (`EPERM`), test tersebut ditandai skip;
unit test core tetap berjalan.
