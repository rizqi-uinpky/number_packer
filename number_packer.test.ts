import { describe, it, expect, beforeEach, vi } from 'vitest';
import NumberPacker, { pack, unpack, calculateNeededBits, calculateMaxVal, NUMBER } from './number_packer.ts';

describe('NumberPacker', () => {
    let packer: NumberPacker;

    beforeEach(() => {
        packer = new NumberPacker();
    });

    describe('Constructor and Basic Schema', () => {
        it('should initialize with a schema in the constructor', () => {
            const p = new NumberPacker(8, 4, { bit: 4, signed: true });
            expect(p.schemaGroups()).toEqual([[1, [
                { bit: 4, signed: false },
                { bit: 3, signed: false },
                { bit: 4, signed: true },
            ]]]);
        });

        it('should correctly pack and unpack simple aligned values', () => {
            packer.schemaGroups([[1, [255, 255, 255, 255]]]);
            const values = [10, 255, 0, 42];
            const buffer = packer.pack(values);
            expect(buffer).toEqual(new Uint8Array([10, 255, 0, 42]));
            const unpacked = packer.unpack(buffer);
            expect(unpacked).toEqual(values);
        });

        it('should handle unaligned values that cross byte boundaries', () => {
            packer.schemaGroups([[1, [3, 5, 2, 6].map(calculateMaxVal)]]); // 16 bits = 2 bytes
            const values = [5, 20, 3, 42];
            // Binary: 101_10100_11_101010 -> 10110100 11101010 -> 180 234
            const buffer = packer.pack(values);
            expect(buffer).toEqual(new Uint8Array([180, 234]));
            const unpacked = packer.unpack(buffer);
            expect(unpacked).toEqual(values);
        });

        it('should handle signed numbers correctly', () => {
            packer.schemaGroups([[1, [{ bit: 8, signed: true }, { bit: 16, signed: true }]]]);
            const values = [-128, -1];
            const buffer = packer.pack(values);
            const unpacked = packer.unpack(buffer);
            expect(unpacked[0]).toBe(values[0]);
            expect(unpacked[1]).toBe(values[1]);
        });

        it('should handle BigInt values', () => {
            packer.schemaGroups([[1, [{ bit: 40, signed: false }, { bit: 64, signed: true }]]]);
            const val1 = (1n << 40n) - 1n; // max unsigned 40-bit
            const val2 = -(1n << 63n);      // min signed 64-bit
            const values = [val1, val2];
            const buffer = packer.pack(values);
            const unpacked = packer.unpack(buffer);
            expect(unpacked).toEqual(values);
        });
    });

    describe('schemaGroups', () => {
        it('should handle a single repeating group (Infinity)', () => {
            packer.schemaGroups([[true, [4, 12].map(calculateMaxVal)]]);
            const values = [15, 4095, 10, 1000, 5, 500];
            const buffer = packer.pack(values);
            const unpacked = packer.unpack(buffer);
            expect(unpacked).toEqual(values);
        });

        it('should handle a fixed number of repetitions', () => {
            packer.schemaGroups([[2, [4, 12].map(calculateMaxVal)]]); // Repeat twice
            const values = [15, 4095, 10, 1000];
            const buffer = packer.pack(values);
            const unpacked = packer.unpack(buffer);
            expect(unpacked).toEqual(values);
            // Test with more values than schema allows
            const extraValues = [15, 4095, 10, 1000, 5, 500];
            const limitedBuffer = packer.pack(extraValues);
            const limitedUnpacked = packer.unpack(limitedBuffer);
            expect(limitedUnpacked).toEqual(values); // Should only pack the first 4
        });

        it('should handle prefix, repeating, and suffix groups', () => {
            packer.schemaGroups([
                [1, [255]],                         // Prefix: 1x uint8
                [true, [15, 15]],                   // Repeating: uint4, uint4
                [1, [{ bit: 16 }, { bit: 8, signed: true }]] // Suffix: uint16, int8
            ]);
            const values = [100, 15, 0, 10, 5, 1, 14, 65535, -128];
            const buffer = packer.pack(values);
            const unpacked = packer.unpack(buffer);
            expect(unpacked).toEqual(values);
        });
    });

    describe('Schema Modification', () => {
        beforeEach(() => {
            packer.schemaGroups([
                [1, [255, 255]],       // Group 0
                [true, [15, 0xfff]]    // Group 1
            ]);
        });

        it('should get and set bitSize for a specific group', () => {
            expect(packer.bitSize(0)).toEqual([8, 8]);
            expect(packer.bitSize(1)).toEqual([4, 12]);

            packer.bitSize(0, 10, 0); // Set first item of group 0 to 10 bits
            expect(packer.bitSize(0)).toEqual([10, 8]);

            packer.bitSize([6, 10], 1); // Set group 1 sizes
            expect(packer.bitSize(1)).toEqual([6, 10]);
        });

        it('should get and set signed for a specific group', () => {
            expect(packer.signed(0)).toEqual([false, false]);
            packer.signed(1, true, 0); // Set second item of group 0 to signed
            expect(packer.signed(0)).toEqual([false, true]);
        });

        it('should auto-size bits based on values', () => {
            packer.autoSize([255, 65535], 0);
            expect(packer.bitSize(0)).toEqual([8, 16]);

            packer.autoSize(1, 1000, 1); // Set second item of group 1
            expect(packer.bitSize(1)).toEqual([4, 10]);
        });
    });

    describe('Error Handling and Edge Cases', () => {
        it('should throw on small buffer during pack if configured', () => {
            packer.schemaGroups([[1, [255, 255, 255]]]);
            const buffer = new Uint8Array(2);
            packer.throwOnSmallBuffer = true;
            expect(() => packer.pack([1, 2, 3], buffer)).toThrow('Buffer too small! Packing stopped at byte 2.');
        });

        it('should throw on small buffer during unpack if configured', () => {
            packer.schemaGroups([[3, [255]]]); // Expects 3 bytes
            const buffer = new Uint8Array([10, 20]); // Provide only 2
            packer.throwOnSmallBufferForLimitedRepeat = true;
            expect(() => packer.unpack(buffer)).toThrow('Buffer too small for the defined schema. Expected to unpack 3 items, but only got 2.');
        });

        it('should throw on less data during pack if configured', () => {
            packer.schemaGroups([[1, [255, 255, 255]]]);
            packer.throwOnLessData = true;
            expect(() => packer.pack([1, 2])).toThrow('Not enough numbers provided. Expected at least 3 bytes worth of data.');
        });

        it('should handle empty schemas gracefully', () => {
            packer.schemaGroups([]);
            const buffer = packer.pack([1, 2, 3]);
            expect(buffer.length).toBe(0);
            const unpacked = packer.unpack(new Uint8Array([1, 2, 3]));
            expect(unpacked).toEqual([]);
        });
    });

    describe('Offset Functionality', () => {
        it('should pack data at a given offset', () => {
            packer.schemaGroups([[1, [255, 255]]]);
            const buffer = new Uint8Array([255, 255, 255, 255]);
            packer.pack([10, 20], buffer, 1);
            expect(buffer).toEqual(new Uint8Array([255, 10, 20, 255]));
        });

        it('should unpack data from a given offset', () => {
            packer.schemaGroups([[1, [255, 255]]]);
            const buffer = new Uint8Array([255, 10, 20, 255]);
            const result: NUMBER[] = [];
            packer.unpack(buffer, result, 1);
            expect(result).toEqual([10, 20]);
        });
    });

    describe('Static Helper Functions', () => {
        it('should pack using the static pack method', () => {
            const buffer = pack([255, 255], [10, 20]);
            expect(buffer).toEqual(new Uint8Array([10, 20]));
        });

        it('should unpack using the static unpack method', () => {
            const buffer = new Uint8Array([10, 20]);
            const unpacked = unpack([255, 255], buffer);
            expect(unpacked).toEqual([10, 20]);
        });

        it('should unpack with offset using the static unpack method', () => {
            const buffer = new Uint8Array([0, 10, 20]);
            const result: NUMBER[] = [];
            unpack([255, 255], buffer, result, 1);
            expect(result).toEqual([10, 20]);
        });
    });

    describe('calculateNeededBits', () => {
        it('should calculate correct bits for numbers', () => {
            expect(calculateNeededBits(0)).toBe(1);
            expect(calculateNeededBits(1)).toBe(1);
            expect(calculateNeededBits(7)).toBe(3);
            expect(calculateNeededBits(8)).toBe(4);
            expect(calculateNeededBits(255)).toBe(8);
            expect(calculateNeededBits(256)).toBe(9);
        });

        it('should calculate correct bits for bigints', () => {
            expect(calculateNeededBits(0n)).toBe(1);
            expect(calculateNeededBits(1n)).toBe(1);
            expect(calculateNeededBits(255n)).toBe(8);
            expect(calculateNeededBits(256n)).toBe(9);
            expect(calculateNeededBits((1n << 64n) - 1n)).toBe(64);
        });
    });
});
