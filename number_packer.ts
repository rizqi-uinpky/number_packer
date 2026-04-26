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
	// METHOD SKEMA, UKURANBIT, SIGNED, UKURAN
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
			if (index > schema.length) index = schema.length;
			if (!schema[index]) schema[index] = { bit: 1, signed: false };
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
			const groupSize = schemas.length * (count === Infinity ? 1 : count);
			if (index < currentIndex + groupSize) {
				config = schemas[(index - currentIndex) % schemas.length];
				break;
			}
			currentIndex += groupSize;
		}
		if (!config) return;
		const b = config.bit, isBig = b > 31;

		if (config.signed) {
			const rangeSize = isBig ? (1n << BigInt(b - 1)) : (1 << b - 1);
			return { min: -rangeSize, max: isBig ? rangeSize as bigint - 1n : rangeSize as number - 1 };
		} else
			return { min: isBig ? 0n : 0, max: isBig ? (1n << BigInt(b)) - 1n : (1 << b) - 1 };
	}

	#recalculateTotals() {
		const sG = this.#schemaGroups;
		if (sG.some(item => item[0] === Infinity)) this.#totalByte = this.#totalBit = Infinity;
		else this.#totalByte = -(-(this.#totalBit = sG.reduce((totalBit, item) => totalBit + item[1].reduce((acc, { bit }) => acc + bit, 0) * item[0], 0)) >> 3); // Math.ceil(totalBit / 8)
	}

	// ==========================================
	// CORE PACKING & UNPACKING METHODS
	// ==========================================

	pack(numbers: NUMBER[], buffer?: Uint8Array, offset = 0, bufLen = buffer?.length) {
		if (buffer === undefined)
			if (this.#totalBit === Infinity) {
				// Calculate required bits dynamically
				let requiredBits = 0;
				let numIndex = 0;
				outer: for (const [count, schemas] of this.#schemaGroups) {
					const groupBits = schemas.reduce((acc, { bit }) => acc + bit, 0);
					if (count === Infinity) {
						const remainingNumbers = numbers.length - numIndex;
						if (schemas.length > 0)
							requiredBits += Math.ceil(remainingNumbers / schemas.length) * groupBits;
						break;
					}
					for (let i = 0; i < count; i++) {
						if (numIndex >= numbers.length) break outer;
						requiredBits += groupBits;
						numIndex += schemas.length;
					}
				}
				buffer = new Uint8Array(Math.ceil(requiredBits / 8));
			} else buffer = new Uint8Array(this.#totalByte);
		if (bufLen === undefined) bufLen = buffer.length;
		for (let i = offset; i < bufLen; i)buffer[i] = 0;
		let bitAcc = 0;
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
				const byteIdx = offset + (bitAcc >> 3);
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

		outer: for (const [count, schemas] of this.#schemaGroups)
			for (let i = 0; i < count; i++)
				for (const schema of schemas) {
					if (numIndex >= numbers.length)
						if (this.throwOnLessData && this.#totalBit !== Infinity)
							throw new Error(`Not enough numbers provided. Expected at least ${this.#totalBit / 8} bytes worth of data.`);
						else break outer;
					writeValue(numbers[numIndex], schema.bit, schema.signed, numIndex++);
				}

		return buffer;
	}

	unpack(buf: Uint8Array, result: NUMBER[] = [], offset = 0) {
		let bitAcc = 0,
			itemsUnpacked = 0,
			totalExpectedItems = 0,
			hasInfinite = false;

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

		outer: for (const [count, schemas] of this.#schemaGroups) {
			if (count === Infinity) hasInfinite = true;
			else totalExpectedItems += count * schemas.length;

			for (let i = 0; i < count; i++)
				for (const schema of schemas) {
					const value = readValue(schema.bit, schema.signed);
					if (value === null) break outer;
					result[offset++] = value;
					itemsUnpacked++;
				}
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

export const calculateMaxVal = (bits: number) => (1 << bits) - 1;

// ==========================================
// FOR ONE-OFF USE
// ==========================================

/**
 * Packs an array of numbers into a binary buffer in a single static call.
 * Ideal for stateless, one-off packing operations.
 * @param schemaInit The schema definition for this packing operation.
 * @param numbers The numbers to pack.
 * @returns A new Uint8Array containing the packed data.
 */
export const pack = (schemaInit: SCHEMA_INIT[], numbers: NUMBER[], buffer?: Uint8Array, offset = 0) =>
	new NumberPacker(...schemaInit).pack(numbers, buffer, offset);

/**
 * Unpacks numbers from a binary buffer in a single static call.
 * Ideal for stateless, one-off unpacking operations.
 * @param schemaInit The schema definition for this unpacking operation.
 * @param buffer The buffer to read from.
 * @returns An array of unpacked numbers.
 */
export const unpack = (schemaInit: SCHEMA_INIT[], buffer: Uint8Array, result?: NUMBER[], offset = 0) =>
	new NumberPacker(...schemaInit).unpack(buffer, result, offset);