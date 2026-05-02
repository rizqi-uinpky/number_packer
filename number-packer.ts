export default class NumberPacker {
	#schemaGroups: [number, SCHEMA[]][] = [];
	#totalBit = 0;
	#totalByte: number = 0;

	// Error & Warning Configuration
	/** Controls whether to throw an error or return silently when the buffer is too small during unpacking. */
	throwOnSmallBufferForLimitedRepeat = false;
	/** Controls whether to throw an error or return silently when the buffer is too small during packing. */
	throwOnSmallBuffer = false;
	/** Controls whether to throw an error if the number of provided values is less than the schema expects. */
	throwOnLessData = false;
	/** A callback function that gets called when a value exceeds its defined bit capacity during packing. */
	onOverflow?: ((details: { value: NUMBER, index: number, min: NUMBER, max: NUMBER, bit: number, signed: boolean }) => void);

	// Constructor accepts an initial schema definition
	constructor(...schemaInit: SCHEMA_INIT[]) { if (schemaInit.length > 0) this.schemaGroups([[1, schemaInit]]); }

	// ==========================================
	// SCHEMA, BITSIZE, SIGNED, AND AUTO-SIZE METHODS
	// ==========================================

	schemaGroups(): [number, SCHEMA[]][];
	schemaGroups(groups: [number | true, SCHEMA_INIT[]][]): this;
	schemaGroups(groups?: [number | true, SCHEMA_INIT[]][]) {
		if (groups === undefined)// Return a deep copy
			return this.#schemaGroups.map(([count, schemas]) => [count, schemas.map(s => ({ ...s }))]);

		this.#schemaGroups = groups.map(([count, schemaInits]) => [count === true ? Infinity : count, schemaInits.map(val => {
			const isN = typeof val === 'number' || typeof val === 'bigint';
			const bit = isN ? calculateNeededBits(val) :
				'bit' in val ? val.bit :
					'max' in val ? calculateNeededBits(val.max) : 1;
			return { bit, signed: isN ? false : !!val.signed };
		})]);

		this.#recalculateTotals();
		return this;
	}

	bitSize(): number[];
	bitSize(groupIndex: number): number[];
	bitSize(arr: number[], groupIndex?: number): this;
	bitSize(index: number, val: number, groupIndex?: number): this;
	bitSize(index?: number[] | number, val?: number, groupIndex = 0) {
		// Getter: bitSize() or bitSize(groupIndex)
		if (index === undefined || (typeof index === 'number' && val === undefined)) {
			const gIndex = index === undefined ? 0 : index;
			const group = this.#schemaGroups[gIndex];
			return group ? group[1].map(item => item.bit) : [];
		}

		const gIndex = Array.isArray(index) ? (val as number) ?? 0 : groupIndex;
		const group = this.#schemaGroups[gIndex];
		if (!group) return this;
		const schema = group[1];

		// Setter: bitSize(arr, groupIndex)
		if (Array.isArray(index)) {
			for (let i = 0; i < index.length; i++) {
				if (!schema[i]) schema[i] = { bit: 1, signed: false };
				schema[i].bit = index[i];
			}
			this.#recalculateTotals();
			return this;
		}

		// Setter: bitSize(index, val, groupIndex)
		if (typeof index === 'number' && typeof val === 'number') {
			if (!schema[index]) return this; // Do not modify if index is out of bounds for consistency
			schema[index].bit = val;
			this.#recalculateTotals();
		}

		return this;
	}

	signed(): boolean[];
	signed(groupIndex: number): boolean[];
	signed(arr: boolean[], groupIndex?: number): this;
	signed(index: number, val: boolean, groupIndex?: number): this;
	signed(index?: boolean[] | number, val?: boolean | number, groupIndex = 0) {
		if (index === undefined || (typeof index === 'number' && val === undefined)) {
			const gIndex = index === undefined ? 0 : index;
			const group = this.#schemaGroups[gIndex];
			return group ? group[1].map(item => item.signed) : [];
		}

		const gIndex = Array.isArray(index) ? (val as number) ?? 0 : groupIndex;
		const group = this.#schemaGroups[gIndex];
		if (!group) return this;
		const schema = group[1];

		if (Array.isArray(index)) {
			index.forEach((v, i) => { if (schema[i]) schema[i].signed = !!v; });
		} else if (typeof index === 'number' && typeof val === 'boolean') {
			if (schema[index]) schema[index].signed = val;
		}
		return this;
	}

	/**
	 * Automatically sets the bit size for one or more schema entries based on a given value.
	 * This is a convenient way to set the required bits without calculating them manually.
	 * @param arr An array of numbers/bigints to set the bit size for each corresponding schema entry.
	 */
	autoSize(arr: NUMBER[], groupIndex?: number): this;
	autoSize(index: number, val: NUMBER, groupIndex?: number): this;
	autoSize(...[arg1, arg2, arg3 = 0]: [arr: NUMBER[], groupIndex?: number] | [index: number, val: NUMBER, groupIndex?: number]) {
		if (typeof arg1 !== 'number') {// Overload: autoSize(arr, groupIndex?)
			const groupIndex = (arg2 as number) ?? 0;
			if (this.#schemaGroups[groupIndex]) this.bitSize(arg1.map(v => calculateNeededBits(v)), groupIndex); // Reuse bitSize logic
		} else// Overload: autoSize(index, val, groupIndex?)
			this.bitSize(arg1, calculateNeededBits(arg2 as NUMBER), arg3);
		return this;
	}

	/**
	 * Gets the valid numeric range for a schema entry.
	 * @param index The index of the schema entry.
	 * @returns An object with `min` and `max` values, or `undefined` if the index is invalid.
	 */
	getRange(index: number) {
		let currentIndex = 0;
		let config: SCHEMA | undefined;

		for (const [count, schemas] of this.#schemaGroups) {
			if (count === Infinity) {
				// If it's an infinite group, it consumes all remaining indices.
				config = schemas[(index - currentIndex) % schemas.length];
				break;
			}
			const groupItemCount = schemas.length * count;
			if (index < currentIndex + groupItemCount) {
				config = schemas[(index - currentIndex) % schemas.length];
				break;
			}
			currentIndex += groupItemCount;
		}
		if (!config) return;
		const b = config.bit, isBig = b > 31;

		if (config.signed) {
			const rangeSize = isBig ? (1n << BigInt(b - 1)) : (1 << b - 1);
			return { min: -rangeSize, max: (isBig ? rangeSize as bigint - 1n : rangeSize as number - 1) as NUMBER };
		} else
			return { min: isBig ? 0n : 0, max: isBig ? (1n << BigInt(b)) - 1n : (1 << b) - 1 };
	}

	#recalculateTotals() {
		const sG = this.#schemaGroups;
		if (sG.some(item => item[0] === Infinity)) {
			this.#totalByte = this.#totalBit = Infinity;
		} else {
			this.#totalBit = sG.reduce((totalBit, item) => totalBit + item[1].reduce((acc, { bit }) => acc + bit, 0) * item[0], 0);
			this.#totalByte = Math.ceil(this.#totalBit / 8);
		}
	}

	#getRequiredBits(numbers: NUMBER[]): number {
		if (this.#totalBit !== Infinity) return this.#totalBit;

		let requiredBits = 0;
		let numIndex = 0;

		const allGroups = this.#schemaGroups;
		const infiniteGroupIndex = allGroups.findIndex(([count]) => count === Infinity);

		let suffixItems = 0;
		let suffixGroups: [number, SCHEMA[]][] = [];

		if (infiniteGroupIndex !== -1) {
			suffixGroups = allGroups.slice(infiniteGroupIndex + 1);
			suffixItems = suffixGroups.reduce((total, [count, schemas]) => total + count * schemas.length, 0);
		}

		const mainGroups = infiniteGroupIndex !== -1 ? allGroups.slice(0, infiniteGroupIndex + 1) : allGroups;

		mainLoop: for (const [count, schemas] of mainGroups) {
			const isInfinite = count === Infinity;
			const loopCount = isInfinite ? Infinity : count;

			for (let i = 0; i < loopCount; i++) {
				if (isInfinite && (numbers.length - numIndex) <= suffixItems) break mainLoop;

				for (const schema of schemas) {
					if (numIndex >= numbers.length) break mainLoop;
					requiredBits += schema.bit;
					numIndex++;
				}
			}
		}

		for (const [count, schemas] of suffixGroups)
			for (let i = 0; i < count; i++)
				for (const schema of schemas) {
					if (numIndex >= numbers.length) break;
					requiredBits += schema.bit;
					numIndex++;
				}
		return requiredBits;
	}

	createBuf(numbers: NUMBER[]) {
		const requiredBits = this.#getRequiredBits(numbers);
		return new Uint8Array(Math.ceil(requiredBits / 8));
	}

	// ==========================================
	// CORE PACKING & UNPACKING METHODS
	// ==========================================

	pack(numbers: NUMBER[], buffer?: Uint8Array, offset?: number, bufLen?: number) {
		if (buffer === undefined) {
			buffer = this.createBuf(numbers);
			offset = 0;
			bufLen = buffer.length;
		} else {
			if (offset === undefined) offset = 0;
			if (bufLen === undefined) bufLen = buffer.length;
			const bytesToPack = Math.ceil(this.#getRequiredBits(numbers) / 8);
			const fillEnd = Math.min(offset + bytesToPack, bufLen);
			// The packing logic uses bitwise OR (|=), so we must clear the target area of the buffer first.
			buffer.fill(0, offset, fillEnd);
		}
		let bitAcc = offset * 8;
		let numIndex = 0;
		const writeValue = (value: NUMBER, bit: number, signed: boolean, index: number) => {
			let bitsRemaining = bit;
			if (this.onOverflow) {
				// This is a simplification; getRange needs to know which schema part it's in.
				// For now, we'll skip this for prefix/suffix to avoid complexity.
				const range = this.getRange(index);
				if (range) {
					const { min, max } = range;
					if (value < min || value > max) this.onOverflow({ value, index, min, max, bit, signed });
				}
			}
			while (bitsRemaining > 0) {
				const byteIdx = bitAcc >> 3;
				if (byteIdx >= bufLen)
					if (this.throwOnSmallBuffer)
						throw new Error(`Buffer too small! Packing stopped at byte ${byteIdx}.`);
					else return; // Stop packing
				const bitOffset = bitAcc & 7,
					bitsAvailable = 8 - bitOffset,
					bitsToWrite = Math.min(bitsRemaining, bitsAvailable);

				const mask = (1 << bitsToWrite) - 1,
					shiftAmt = bitsRemaining - bitsToWrite,
					isBig = typeof value === 'bigint';
				const chunk = isBig ?
					Number((value as bigint >> BigInt(shiftAmt)) & BigInt(mask)) :
					(value as number >> shiftAmt) & mask;

				buffer[byteIdx] |= (chunk << (bitsAvailable - bitsToWrite));
				bitAcc += bitsToWrite;
				bitsRemaining -= bitsToWrite;
			}
		};

		const allGroups = this.#schemaGroups;
		const infiniteGroupIndex = allGroups.findIndex(([count]) => count === Infinity);

		let suffixItems = 0;
		let suffixGroups: [number, SCHEMA[]][] = [];

		if (infiniteGroupIndex !== -1) {
			suffixGroups = allGroups.slice(infiniteGroupIndex + 1);
			if (suffixGroups.some(([count]) => count === Infinity))
				throw new Error("Schema cannot have a group after an infinite `true` group.");
			suffixItems = suffixGroups.reduce((total, [count, schemas]) => total + count * schemas.length, 0);
		}

		const mainGroups = infiniteGroupIndex !== -1 ? allGroups.slice(0, infiniteGroupIndex + 1) : allGroups;

		mainLoop: for (const [count, schemas] of mainGroups) {
			const isInfinite = count === Infinity;
			const loopCount = isInfinite ? Infinity : count;

			for (let i = 0; i < loopCount; i++) {
				if (isInfinite && (numbers.length - numIndex) <= suffixItems)
					break mainLoop;

				for (const schema of schemas) {
					if (numIndex >= numbers.length) {
						if (this.throwOnLessData && this.#totalBit !== Infinity)
							throw new Error(`Not enough numbers provided. Expected at least ${this.#totalBit / 8} bytes worth of data.`);
						break mainLoop;
					}
					writeValue(numbers[numIndex], schema.bit, schema.signed, numIndex++);
				}
			}
		}

		for (const [count, schemas] of suffixGroups)
			for (let i = 0; i < count; i++)
				for (const schema of schemas) {
					if (numIndex >= numbers.length) {
						if (this.throwOnLessData) throw new Error(`Not enough numbers provided for suffix.`);
						break;
					}
					writeValue(numbers[numIndex], schema.bit, schema.signed, numIndex++);
				}

		return buffer;
	}

	unpack(buf: Uint8Array, result: NUMBER[] = [], offset = 0) {
		let bitAcc = offset * 8; // Start reading from the buffer offset
		let itemsUnpacked = 0;
		let totalExpectedItems = 0;
		let hasInfinite = false;

		const readValue = (bit: number, signed: boolean) => {
			if (bitAcc + bit > buf.length * 8) return null;
			const isBigInt = bit > 31;
			let bitsRemaining = bit,
				valN = 0,
				valB = 0n;

			while (bitsRemaining > 0) {
				const byteIdx = bitAcc >> 3,
					bitOffset = bitAcc & 7,
					bitsAvailable = 8 - bitOffset,
					bitsToRead = Math.min(bitsRemaining, bitsAvailable);

				const mask = (1 << bitsToRead) - 1,
					shift = bitsAvailable - bitsToRead,
					byteValue = byteIdx < buf.length ? buf[byteIdx] : 0,
					chunk = (byteValue >> shift) & mask;

				if (isBigInt) valB = (valB << BigInt(bitsToRead)) | BigInt(chunk);
				else valN = (valN << bitsToRead) | chunk;

				bitAcc += bitsToRead;
				bitsRemaining -= bitsToRead;
			}

			if (signed)
				if (isBigInt) { if (valB & 1n << BigInt(bit - 1)) valB = valB - (1n << BigInt(bit)) }
				else { if (valN & 1 << (bit - 1)) valN = valN - (1 << bit) }

			return isBigInt ? valB : valN;
		};

		const allGroups = this.#schemaGroups;
		const infiniteGroupIndex = allGroups.findIndex(([count]) => count === Infinity);

		let suffixTotalBit = 0;
		let suffixGroups: [number, SCHEMA[]][] = [];

		if (infiniteGroupIndex !== -1) {
			suffixGroups = allGroups.slice(infiniteGroupIndex + 1);
			if (suffixGroups.some(([count]) => count === Infinity))
				throw new Error("Schema cannot have a group after an infinite `true` group.");
			suffixTotalBit = suffixGroups.reduce((totalBit, [count, schemas]) => totalBit + schemas.reduce((acc, { bit }) => acc + bit, 0) * count, 0);
		}

		const mainGroups = infiniteGroupIndex !== -1 ? allGroups.slice(0, infiniteGroupIndex + 1) : allGroups;
		const totalBufferBits = buf.length * 8;

		mainLoop: for (const [count, schemas] of mainGroups) {
			if (count === Infinity) hasInfinite = true;
			else totalExpectedItems += count * schemas.length;

			const isInfinite = count === Infinity;
			const loopCount = isInfinite ? Infinity : count;

			for (let i = 0; i < loopCount; i++) {
				if (isInfinite && (totalBufferBits - bitAcc) <= suffixTotalBit)
					break mainLoop;

				for (const schema of schemas) {
					const value = readValue(schema.bit, schema.signed);
					if (value === null) break mainLoop;
					result.push(value);
					itemsUnpacked++;
				}
			}
		}

		for (const [count, schemas] of suffixGroups)
			for (let i = 0; i < count; i++)
				for (const schema of schemas) {
					const value = readValue(schema.bit, schema.signed);
					if (value === null) break;
					result.push(value);
					itemsUnpacked++;
				}

		if (!hasInfinite && this.throwOnSmallBufferForLimitedRepeat && itemsUnpacked < totalExpectedItems)
			throw new Error(`Buffer too small for the defined schema. Expected to unpack ${totalExpectedItems} items, but only got ${itemsUnpacked}.`);

		return result;
	}
}
export type NUMBER = number | bigint;
export type SCHEMA = { bit: number; signed: boolean };
export type SCHEMA_INIT = NUMBER | (({ bit: number } | { max: NUMBER }) & { signed?: boolean }) | { signed: boolean };

export const calculateNeededBits = (maxValue: NUMBER) => {
	if (maxValue === 0 || maxValue === 0n) return 1;
	if (typeof maxValue === 'bigint') return maxValue.toString(2).length;
	return 32 - Math.clz32(Math.abs(maxValue));
}

export const calculateMaxVal = (bits: number): NUMBER => {
	if (bits >= 31) return (1n << BigInt(bits)) - 1n;
	return (1 << bits) - 1;
};

// ==========================================
// STATIC METHODS FOR ONE-OFF USE
// ==========================================

/**
 * Packs an array of numbers into a binary buffer in a single static call.
 * Ideal for stateless, one-off packing operations.
 * @param schemaInit The schema definition for this packing operation.
 * @param numbers The numbers to pack.
 * @returns A new Uint8Array containing the packed data.
 */
export const pack = (schemaInit: SCHEMA_INIT[], numbers: NUMBER[], buffer?: Uint8Array, offset?: number, bufLen?: number) =>
	new NumberPacker(...schemaInit).pack(numbers, buffer, offset, bufLen);

/**
 * Unpacks numbers from a binary buffer in a single static call.
 * Ideal for stateless, one-off unpacking operations.
 * @param schemaInit The schema definition for this unpacking operation.
 * @param buffer The buffer to read from.
 * @returns An array of unpacked numbers.
 */
export const unpack = (schemaInit: SCHEMA_INIT[], buffer: Uint8Array, result?: NUMBER[], offset = 0) =>
	new NumberPacker(...schemaInit).unpack(buffer, result, offset);