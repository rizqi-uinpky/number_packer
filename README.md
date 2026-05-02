[![English](https://img.shields.io/badge/Language-English-blue.svg)](README.md)
[![Bahasa Indonesia](https://img.shields.io/badge/Bahasa-Indonesia-red.svg)](README.id.md)

# Number Packer

A versatile and efficient TypeScript library for packing multiple numbers of varying bit-lengths into a compact binary buffer and unpacking them back. Ideal for network protocols, file formats, or any scenario where data size is critical. Supports both `number` and `bigint`.

## Features

*   **Flexible Schema**: Define the bit-length and signedness for each number.
*   **BigInt Support**: Natively handles numbers larger than 32 bits.
*   **Stateful & Stateless API**: Use the `NumberPacker` class for complex, stateful operations or static `pack`/`unpack` functions for one-off tasks.
*   **Repeating Schema Groups**: Easily pack/unpack dynamic lists or arrays of objects.
*   **Error Handling**: Configurable options for handling buffer overflows, underflows, and value overflows.
*   **Helper Methods**: Convenient methods to dynamically adjust schemas (`autoSize`, `bitSize`, `signed`).
*   **Zero Dependencies**: Lightweight and self-contained.

## Installation

```bash
npm install number-packer
```

## Quick Start

### Stateless (One-Off) Usage

The easiest way to use the library is through the static `pack` and `unpack` functions.

```typescript
import { pack, unpack } from 'number-packer';

// Define a schema: [unsigned 5-bit, unsigned 10-bit, signed 3-bit]
const schema = [{ bit: 5 }, { bit: 10 }, { bit: 3, signed: true }];

// The numbers to pack
const myNumbers = [15, 512, -3];

// Pack the numbers into a buffer
const packedBuffer = pack(schema, myNumbers);
console.log(packedBuffer); // Uint8Array(3) [ 124, 1, 64 ]

// Unpack the buffer back into numbers
const unpackedNumbers = unpack(schema, packedBuffer);
console.log(unpackedNumbers); // [ 15, 512, -3 ]
```

### Stateful Usage with the `NumberPacker` Class

For more complex or repeated operations, create an instance of `NumberPacker`.

```typescript
import NumberPacker from 'number-packer';

// Create an instance with a schema
const packer = new NumberPacker({ bit: 8, signed: true }, { bit: 16 });

// Pack data
const buffer1 = packer.pack([-10, 1000]);
console.log(buffer1);

// Unpack data
const data1 = packer.unpack(buffer1);
console.log(data1); // [ -10, 1000 ]
```

## API Reference

### Schema Definition (`SCHEMA_INIT`)

A schema is an array that defines the structure of your packed data. Each element in the array configures one number. You can define a schema entry in several ways:

*   `{ bit: number, signed?: boolean }`: The most explicit form. Defines bit size and signedness.
*   `{ max: number | bigint, signed?: boolean }`: Automatically calculates the required bits to hold `max`.
*   `number | bigint`: A shorthand for an unsigned number. The bit size is calculated automatically based on the value.
*   `{ signed: boolean }`: If only signedness is provided, the bit size defaults to 1.

**Example:**
```typescript
const schema = [
    5,                          // An unsigned number that can hold up to 5 (needs 3 bits)
    { max: 1000 },              // An unsigned number that can hold up to 1000 (needs 10 bits)
    { bit: 16, signed: true },  // A 16-bit signed integer
];
```

### `new NumberPacker(...schemaInit: SCHEMA_INIT[])`

Creates a new `NumberPacker` instance with an initial schema.

### Class Methods

*   `.pack(numbers: NUMBER[], buffer?: Uint8Array, offset?: number, bufLen?: number): Uint8Array`
    Mengepak array angka ke dalam buffer sesuai dengan skema instance. Jika `buffer` tidak disediakan, buffer baru akan dibuat.

*   `.unpack(buffer: Uint8Array, result?: NUMBER[], offset?: number): NUMBER[]`
    Unpacks an array of numbers from a buffer.

*   `.schemaGroups(groups: [number | true, SCHEMA_INIT[]][]): this`
    Defines complex schemas with repeating groups. Use a number for a fixed number of repetitions, or `true` (for Infinity) for a dynamic list that consumes the rest of the data.

*   `.bitSize(arr: number[] | number, val?: number, groupIndex?: number): this`
    Gets or sets the bit size for schema entries.

*   `.signed(arr: boolean[] | boolean, val?: boolean, groupIndex?: number): this`
    Gets or sets the signed flag for schema entries.

*   `.autoSize(arr: NUMBER[] | number, val?: NUMBER, groupIndex?: number): this`
    Automatically sets the bit size for schema entries based on provided values.

*   `.getRange(index: number): { min: NUMBER, max: NUMBER } | undefined`
    Gets the minimum and maximum value a specific schema entry can hold. Returns `undefined` if the index is out of bounds.

### Error Handling Properties

*   `throwOnSmallBuffer: boolean`: (Default `false`) If `true`, `pack` throws an error if the provided buffer is too small.
*   `throwOnLessData: boolean`: (Default `false`) If `true`, `pack` throws an error if the number of values is less than what a fixed-size schema expects.
*   `throwOnSmallBufferForLimitedRepeat: boolean`: (Default `false`) If `true`, `unpack` throws an error if the buffer ends before a fixed-repetition schema group is fully unpacked.
*   `onOverflow: (details: { value, index, min, max, bit, signed }) => void`: A callback function that is triggered during packing if a value is outside the storable range for its bit size.

## Advanced Usage

### Repeating Schemas

Use `schemaGroups` to define repeating patterns. This is useful for lists of objects. To unpack, you often need to read the header/count first, then configure the packer with the dynamic count and read the rest of the data.

```typescript
import NumberPacker from 'number-packer';

// Schema for a list of players, each with an ID, x, and y position.

// --- Packing ---
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
    [1, [{ bit: 8 }]], // First, a single group for the player count
    [playerCount, [    // Then, a group that repeats 'playerCount' times
        { bit: 8 },    // id
        { bit: 7 },    // x
        { bit: 7 }     // y
    ]]
]);
const buffer = packer.pack(dataToPack);

// --- Unpacking ---
const unpackedData = [];
// 1. Unpack the header to find out how many players there are.
const headerUnpacker = new NumberPacker({ bit: 8 });
const header = headerUnpacker.unpack(buffer);
const dynamicPlayerCount = header[0] as number;

// 2. Set the full schema on the original packer and unpack the whole buffer.
packer.schemaGroups([
    [1, [{ bit: 8 }]],
    [dynamicPlayerCount, [{ bit: 8 }, { bit: 7 }, { bit: 7 }]],
]);
packer.unpack(buffer, unpackedData);

console.log(unpackedData); // [ 3, 101, 50, 80, 102, 52, 83, 103, 48, 79 ]
```

### Infinite Repetition

For lists where the count isn't known beforehand, you can use `Infinity` (represented by `true` in `schemaGroups`). The packer/unpacker will continue until it runs out of numbers (packing) or buffer space (unpacking).

```typescript
import NumberPacker from 'number-packer';

const itemSchema = [{ bit: 8 }, { bit: 16 }]; // e.g., itemID, itemValue
const packer = new NumberPacker().schemaGroups([
    [true, itemSchema] // 'true' means repeat until the end
]);

const items = [ 1, 1000, 2, 5000, 3, 2500 ];
const buffer = packer.pack(items);

// Unpack will read until the end of the buffer
const unpackedItems = packer.unpack(buffer);
console.log(unpackedItems); // [ 1, 1000, 2, 5000, 3, 2500 ]
```

### Handling BigInt

The library automatically uses `BigInt` for numbers requiring more than 31 bits.

```typescript
import { pack, unpack } from 'number-packer';

// A 64-bit unsigned integer
const schema = [{ bit: 64 }];
const largeNumber = [12345678901234567890n];

const buffer = pack(schema, largeNumber);
const result = unpack(schema, buffer);

console.log(result[0] === largeNumber[0]); // true
console.log(typeof result[0]); // bigint
```
