[![English](https://img.shields.io/badge/Language-English-blue.svg)](README.md)
[![Bahasa Indonesia](https://img.shields.io/badge/Bahasa-Indonesia-red.svg)](README.id.md)

# Number Packer

Pustaka TypeScript yang serbaguna dan efisien untuk mengemas beberapa angka dengan panjang-bit yang bervariasi ke dalam buffer biner yang ringkas dan membukanya kembali. Ideal untuk protokol jaringan, format file, atau skenario apa pun di mana ukuran data sangat penting. Mendukung `number` dan `bigint`.

## Fitur

*   **Skema Fleksibel**: Tentukan panjang-bit dan status `signed` (bertanda) untuk setiap angka.
*   **Dukungan BigInt**: Secara native menangani angka yang lebih besar dari 32 bit.
*   **API Stateful & Stateless**: Gunakan kelas `NumberPacker` untuk operasi yang kompleks dan stateful, atau fungsi statis `pack`/`unpack` untuk tugas sekali pakai.
*   **Grup Skema Berulang**: Mudah untuk mengemas/membuka daftar dinamis atau array objek.
*   **Penanganan Kesalahan**: Opsi yang dapat dikonfigurasi untuk menangani buffer overflow, underflow, dan value overflow.
*   **Metode Bantuan**: Metode praktis untuk menyesuaikan skema secara dinamis (`autoSize`, `bitSize`, `signed`).
*   **Tanpa Dependensi**: Ringan dan mandiri.

## Instalasi

```bash
npm install number-packer
```

## Mulai Cepat

### Penggunaan Stateless (Sekali Pakai)

Cara termudah untuk menggunakan pustaka ini adalah melalui fungsi statis `pack` dan `unpack`.

```typescript
import { pack, unpack } from 'number-packer';

// Definisikan skema: [5-bit unsigned, 10-bit unsigned, 3-bit signed]
const schema = [{ bit: 5 }, { bit: 10 }, { bit: 3, signed: true }];

// Angka yang akan dikemas
const myNumbers = [15, 512, -3];

// Kemas angka ke dalam buffer
const packedBuffer = pack(schema, myNumbers);
console.log(packedBuffer); // Uint8Array(3) [ 124, 1, 64 ]

// Buka kembali buffer menjadi angka
const unpackedNumbers = unpack(schema, packedBuffer);
console.log(unpackedNumbers); // [ 15, 512, -3 ]
```

### Penggunaan Stateful dengan Kelas `NumberPacker`

Untuk operasi yang lebih kompleks atau berulang, buat instance dari `NumberPacker`.

```typescript
import NumberPacker from 'number-packer';

// Buat instance dengan skema
const packer = new NumberPacker({ bit: 8, signed: true }, { bit: 16 });

// Kemas data
const buffer1 = packer.pack([-10, 1000]);
console.log(buffer1);

// Buka data
const data1 = packer.unpack(buffer1);
console.log(data1); // [ -10, 1000 ]
```

## Referensi API

### Definisi Skema (`SCHEMA_INIT`)

Skema adalah sebuah array yang mendefinisikan struktur data terkemas Anda. Setiap elemen dalam array mengkonfigurasi satu angka. Anda dapat mendefinisikan entri skema dengan beberapa cara:

*   `{ bit: number, signed?: boolean }`: Bentuk paling eksplisit. Mendefinisikan ukuran bit dan status signed (bertanda).
*   `{ max: number | bigint, signed?: boolean }`: Secara otomatis menghitung bit yang diperlukan untuk menampung `max`.
*   `number | bigint`: Singkatan untuk angka unsigned (tak bertanda). Ukuran bit dihitung secara otomatis berdasarkan nilainya.
*   `{ signed: boolean }`: Jika hanya status signed yang diberikan, ukuran bit defaultnya adalah 1.

**Contoh:**
```typescript
const schema = [
    5,                          // Angka unsigned yang dapat menampung hingga 5 (membutuhkan 3 bit)
    { max: 1000 },              // Angka unsigned yang dapat menampung hingga 1000 (membutuhkan 10 bit)
    { bit: 16, signed: true },  // Integer 16-bit signed
];
```

### `new NumberPacker(...schemaInit: SCHEMA_INIT[])`

Membuat instance `NumberPacker` baru dengan skema awal.

### Metode Kelas

*   `.pack(numbers: NUMBER[], buffer?: Uint8Array, offset?: number, bufLen?: number): Uint8Array`
    Mengemas array angka ke dalam buffer sesuai dengan skema instance. Jika `buffer` tidak disediakan, buffer baru akan dibuat.

*   `.unpack(buffer: Uint8Array, result?: NUMBER[], offset?: number): NUMBER[]`
    Membuka array angka dari buffer.

*   `.schemaGroups(groups: [number | true, SCHEMA_INIT[]][]): this`
    Mendefinisikan skema kompleks dengan grup berulang. Gunakan angka untuk jumlah pengulangan tetap, atau `true` (untuk Infinity) untuk daftar dinamis yang menggunakan sisa data.

*   `.bitSize(arr: number[] | number, val?: number, groupIndex?: number): this`
    Mendapatkan atau mengatur ukuran bit untuk entri skema.

*   `.signed(arr: boolean[] | boolean, val?: boolean, groupIndex?: number): this`
    Mendapatkan atau mengatur flag signed untuk entri skema.

*   `.autoSize(arr: NUMBER[] | number, val?: NUMBER, groupIndex?: number): this`
    Secara otomatis mengatur ukuran bit untuk entri skema berdasarkan nilai yang diberikan.

*   `.getRange(index: number): { min: NUMBER, max: NUMBER } | undefined`
    Mendapatkan nilai minimum dan maksimum yang dapat ditampung oleh entri skema tertentu. Mengembalikan `undefined` jika indeks tidak valid.

### Properti Penanganan Kesalahan

*   `throwOnSmallBuffer: boolean`: (Default `false`) Jika `true`, `pack` akan melempar error jika buffer yang disediakan terlalu kecil.
*   `throwOnLessData: boolean`: (Default `false`) Jika `true`, `pack` akan melempar error jika jumlah nilai kurang dari yang diharapkan oleh skema berukuran tetap.
*   `throwOnSmallBufferForLimitedRepeat: boolean`: (Default `false`) Jika `true`, `unpack` akan melempar error jika buffer berakhir sebelum grup skema dengan pengulangan tetap selesai dibuka.
*   `onOverflow: (details: { value, index, min, max, bit, signed }) => void`: Fungsi callback yang dipicu selama proses pengemasan jika sebuah nilai berada di luar rentang yang dapat disimpan untuk ukuran bitnya.

## Penggunaan Lanjutan

### Skema Berulang

Gunakan `schemaGroups` untuk mendefinisikan pola berulang. Ini berguna untuk daftar objek. Untuk membukanya, Anda sering kali perlu membaca header/jumlah terlebih dahulu, lalu mengkonfigurasi packer dengan jumlah dinamis dan membaca sisa datanya.

```typescript
import NumberPacker from 'number-packer';

// Skema untuk daftar pemain, masing-masing dengan ID, posisi x, dan y.

// --- Mengemas (Packing) ---
const playerCount = 3;
const players = [
    // Player 1
    101, 50, 80,
    // Player 2
    102, 52, 83,
    // Player 3
    103, 48, 79,
];
const dataToPack = [playerCount, ...players];

const packer = new NumberPacker().schemaGroups([
    [1, [{ bit: 8 }]], // Pertama, satu grup untuk jumlah pemain
    [playerCount, [    // Kemudian, grup yang berulang sebanyak 'playerCount'
        { bit: 8 },    // id
        { bit: 7 },    // x
        { bit: 7 }     // y
    ]]
]);
const buffer = packer.pack(dataToPack);

// --- Membuka (Unpacking) ---
const unpackedData = [];
// 1. Buka header untuk mengetahui berapa banyak pemain yang ada.
const headerUnpacker = new NumberPacker({ bit: 8 });
const header = headerUnpacker.unpack(buffer);
const dynamicPlayerCount = header as number;

// 2. Atur skema lengkap pada packer asli dan buka seluruh buffer.
packer.schemaGroups([
    [1, [{ bit: 8 }]],
    [dynamicPlayerCount, [{ bit: 8 }, { bit: 7 }, { bit: 7 }]],
]);
packer.unpack(buffer, unpackedData);

console.log(unpackedData); // [ 3, 101, 50, 80, 102, 52, 83, 103, 48, 79 ]
```

### Pengulangan Tak Terbatas (Infinite)

Untuk daftar di mana jumlahnya tidak diketahui sebelumnya, Anda dapat menggunakan `Infinity` (diwakili oleh `true` di `schemaGroups`). Packer/unpacker akan berlanjut hingga kehabisan angka (saat mengemas) atau ruang buffer (saat membuka).

```typescript
import NumberPacker from 'number-packer';

const itemSchema = [{ bit: 8 }, { bit: 16 }]; // misalnya, itemID, itemValue
const packer = new NumberPacker().schemaGroups([
    [true, itemSchema] // 'true' berarti ulangi hingga akhir
]);

const items = [ 1, 1000, 2, 5000, 3, 2500 ];
const buffer = packer.pack(items);

// Unpack akan membaca hingga akhir buffer
const unpackedItems = packer.unpack(buffer);
console.log(unpackedItems); // [ 1, 1000, 2, 5000, 3, 2500 ]
```

### Menangani BigInt

Pustaka ini secara otomatis menggunakan `BigInt` untuk angka yang membutuhkan lebih dari 31 bit.

```typescript
import { pack, unpack } from 'number-packer';

// Integer 64-bit unsigned
const schema = [{ bit: 64 }];
const largeNumber = [12345678901234567890n];

const buffer = pack(schema, largeNumber);
const result = unpack(schema, buffer);

console.log(result === largeNumber); // true
console.log(typeof result); // bigint
```