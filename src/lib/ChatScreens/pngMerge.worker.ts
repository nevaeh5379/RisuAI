import { unzlib, zlib } from 'fflate';

// Precompute CRC table
const crcTable = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
        if (c & 1) c = 0xedb88320 ^ (c >>> 1);
        else c = c >>> 1;
    }
    crcTable[n] = c;
}

function crc32(buf: Uint8Array): number {
    let crc = 0xffffffff;
    for (let i = 0; i < buf.length; i++) {
        crc = crcTable[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return crc ^ 0xffffffff;
}

// --- Worker Handler ---
self.onmessage = async (e: MessageEvent) => {
    try {
        const { chunks } = e.data;
        if (!chunks || !Array.isArray(chunks)) throw new Error("Invalid input: chunks array required");

        const merged = await mergePngs(chunks);
        
        // Transfer the buffer back to main thread
        self.postMessage({ result: merged }, { transfer: [merged.buffer] });
    } catch (error) {
        self.postMessage({ error: error instanceof Error ? error.message : String(error) });
    }
};

// --- Async Wrappers for fflate ---
async function asyncUnzlib(data: Uint8Array): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        unzlib(data, (err, res) => {
            if (err) reject(err);
            else resolve(res);
        });
    });
}

async function asyncZlib(data: Uint8Array, options: any): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
        zlib(data, options, (err, res) => {
            if (err) reject(err);
            else resolve(res);
        });
    });
}

// --- Constants ---
const COLOR_TYPE_RGB = 2;
const COLOR_TYPE_RGBA = 6;

// --- Main Merge Logic ---
async function mergePngs(pngs: Uint8Array[]): Promise<Uint8Array> {
    if (pngs.length === 0) throw new Error("No PNGs to merge");

    let totalHeight = 0;
    let targetWidth = 0;
    let rawScanlines: Uint8Array[] = []; 
    // We will normalize everything to RGBA (Color Type 6), 8-bit, Non-interlaced
    
    // 1. Process First Chunk to establish baseline width
    const firstReader = new PngReader(pngs[0]);
    const firstIHDR = firstReader.readIHDR();
    targetWidth = firstIHDR.width;
    
    // We strictly support 8-bit depth for now (common web output)
    if (firstIHDR.depth !== 8) throw new Error("Unsupported bit depth: " + firstIHDR.depth);

    // 2. Iterate and Normalize Chunks
    for (let i = 0; i < pngs.length; i++) {
        const png = pngs[i];
        const reader = new PngReader(png);
        const ihdr = reader.readIHDR();

        if (ihdr.width !== targetWidth) throw new Error(`Width mismatch in chunk ${i}: expected ${targetWidth}, got ${ihdr.width}`);
        if (ihdr.depth !== 8) throw new Error(`Unsupported bit depth in chunk ${i}: ${ihdr.depth}`);
        
        totalHeight += ihdr.height;

        // Get Raw IDAT (Compressed)
        const idatCompressed = reader.readIDATs();
        // Decompress
        const idatRaw = await asyncUnzlib(idatCompressed);

        // Normalize Data to RGBA (Type 6)
        // This handles unfiltering and converting if necessary
        const normalized = normalizeToRGBA(idatRaw, ihdr.width, ihdr.height, ihdr.colorType);
        rawScanlines.push(normalized);
    }

    // 3. Merge Raw Data
    const totalLength = rawScanlines.reduce((acc, part) => acc + part.length, 0);
    const mergedRaw = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of rawScanlines) {
        mergedRaw.set(part, offset);
        offset += part.length;
    }

    // 4. Compress
    const newIdatCompressed = await asyncZlib(mergedRaw, { level: 6 });

    // 5. Construct New PNG
    // Create new IHDR (Type 6, 8-bit)
    const newHeightBuf = new Uint8Array(4);
    new DataView(newHeightBuf.buffer).setUint32(0, totalHeight, false);
    
    // IHDR: Width(4), Height(4), Depth(1), Color(1), Comp(1), Filt(1), Interl(1)
    const newIhdrData = new Uint8Array(13);
    newIhdrData.set(firstIHDR.data.slice(0, 4), 0); // Copy Width
    newIhdrData.set(newHeightBuf, 4); // New Height
    newIhdrData[8] = 8; // Bit Depth 8
    newIhdrData[9] = 6; // Color Type 6 (RGBA)
    newIhdrData[10] = 0; // Compression Deflate
    newIhdrData[11] = 0; // Filter Method
    newIhdrData[12] = 0; // Interlace None

    const newIhdrChunk = writeChunk("IHDR", newIhdrData);
    const newIdatChunk = writeChunk("IDAT", newIdatCompressed);
    const iendChunk = writeChunk("IEND", new Uint8Array(0));

    const sig = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    const finalPng = new Uint8Array(sig.length + newIhdrChunk.length + newIdatChunk.length + iendChunk.length);
    
    let finalOffset = 0;
    finalPng.set(sig, finalOffset); finalOffset += sig.length;
    finalPng.set(newIhdrChunk, finalOffset); finalOffset += newIhdrChunk.length;
    finalPng.set(newIdatChunk, finalOffset); finalOffset += newIdatChunk.length;
    finalPng.set(iendChunk, finalOffset); finalOffset += iendChunk.length;

    return finalPng;
}

// --- Normalization Logic ---

function normalizeToRGBA(rawData: Uint8Array, width: number, height: number, colorType: number): Uint8Array {
    // If already RGBA (Type 6), check if we just need to pass it or re-filter
    // For simplicity, we decode everything to raw pixels and re-encode with Filter 0 (None)
    
    // bytesPerPixel for the SOURCE
    let bpp = 0;
    if (colorType === 2) bpp = 3; // RGB
    else if (colorType === 6) bpp = 4; // RGBA
    else throw new Error("Unsupported color type for normalization: " + colorType);

    const scanlineLength = width * bpp + 1; // +1 for filter byte
    if (rawData.length < height * scanlineLength) throw new Error("Raw data too short");

    // Decoding (Unfiltering)
    const pixels = new Uint8Array(width * height * 4); // Target: RGBA (4 bytes)
    
    let prevScanline = new Uint8Array(width * bpp); // Zero filled initially
    let cursor = 0;

    for (let y = 0; y < height; y++) {
        const filterType = rawData[cursor++];
        const scanline = rawData.slice(cursor, cursor + width * bpp);
        cursor += width * bpp;

        // Unfilter into 'currentScanline'
        const currentScanline = new Uint8Array(width * bpp);
        
        // Paeth helper
        const paeth = (a: number, b: number, c: number) => {
            const p = a + b - c;
            const pa = Math.abs(p - a);
            const pb = Math.abs(p - b);
            const pc = Math.abs(p - c);
            if (pa <= pb && pa <= pc) return a;
            if (pb <= pc) return b;
            return c;
        };

        for (let i = 0; i < width * bpp; i++) {
            const x = scanline[i];
            const a = i >= bpp ? currentScanline[i - bpp] : 0;
            const b = prevScanline[i];
            const c = i >= bpp ? prevScanline[i - bpp] : 0;

            let val = x;
            if (filterType === 1) val = x + a; // Sub
            else if (filterType === 2) val = x + b; // Up
            else if (filterType === 3) val = x + Math.floor((a + b) / 2); // Average
            else if (filterType === 4) val = x + paeth(a, b, c); // Paeth
            
            currentScanline[i] = val & 0xFF;
        }

        // Convert currentScanline to Target Pixels (RGBA)
        const targetRowOffset = y * width * 4;
        for (let px = 0; px < width; px++) {
            const srcIdx = px * bpp;
            const dstIdx = targetRowOffset + px * 4;
            
            currentScanline[srcIdx]; // R
            
            if (colorType === 2) {
                // RGB -> RGBA
                pixels[dstIdx] = currentScanline[srcIdx];     // R
                pixels[dstIdx + 1] = currentScanline[srcIdx + 1]; // G
                pixels[dstIdx + 2] = currentScanline[srcIdx + 2]; // B
                pixels[dstIdx + 3] = 255;                         // A
            } else {
                // RGBA -> RGBA
                pixels[dstIdx] = currentScanline[srcIdx];
                pixels[dstIdx + 1] = currentScanline[srcIdx + 1];
                pixels[dstIdx + 2] = currentScanline[srcIdx + 2];
                pixels[dstIdx + 3] = currentScanline[srcIdx + 3];
            }
        }

        prevScanline = currentScanline;
    }

    // Encoding (Filter 0 - None)
    // We repack 'pixels' (RGBA) into filter-0 scanlines
    const outputScanlineLen = width * 4 + 1;
    const output = new Uint8Array(height * outputScanlineLen);
    
    for (let y = 0; y < height; y++) {
        const offset = y * outputScanlineLen;
        output[offset] = 0; // Filter Type 0
        const rowPixels = pixels.subarray(y * width * 4, (y + 1) * width * 4);
        output.set(rowPixels, offset + 1);
    }
    
    return output;
}

// --- PNG Helpers ---

class PngReader {
    pos = 8;
    constructor(private data: Uint8Array) {}

    readIHDR() {
        const len = this.readUint32(this.pos);
        const type = this.readString(this.pos + 4, 4);
        if (type !== 'IHDR') throw new Error("First chunk is not IHDR");
        
        const chunkData = this.data.slice(this.pos + 8, this.pos + 8 + len);
        const view = new DataView(chunkData.buffer, chunkData.byteOffset, chunkData.byteLength);
        
        const width = view.getUint32(0, false);
        const height = view.getUint32(4, false);
        const depth = view.getUint8(8);
        const colorType = view.getUint8(9);
        const compression = view.getUint8(10);
        const filter = view.getUint8(11);
        const interlace = view.getUint8(12);

        this.pos += 12 + len;
        
        return { width, height, depth, colorType, compression, filter, interlace, data: chunkData };
    }

    readIDATs(): Uint8Array {
        let idatParts: Uint8Array[] = [];
        while (this.pos < this.data.length) {
            const len = this.readUint32(this.pos);
            const type = this.readString(this.pos + 4, 4);
            if (type === 'IDAT') idatParts.push(this.data.slice(this.pos + 8, this.pos + 8 + len));
            else if (type === 'IEND') break;
            this.pos += 12 + len;
        }
        const totalLen = idatParts.reduce((a, b) => a + b.length, 0);
        const res = new Uint8Array(totalLen);
        let offset = 0;
        for (const part of idatParts) {
            res.set(part, offset);
            offset += part.length;
        }
        return res;
    }

    private readUint32(o: number) {
        return (this.data[o] << 24) | (this.data[o + 1] << 16) | (this.data[o + 2] << 8) | this.data[o + 3];
    }

    private readString(o: number, l: number) {
        let res = "";
        for (let i = 0; i < l; i++) res += String.fromCharCode(this.data[o + i]);
        return res;
    }
}

function writeChunk(type: string, data: Uint8Array): Uint8Array {
    const len = data.length;
    const buf = new Uint8Array(4 + 4 + len + 4);
    const view = new DataView(buf.buffer);
    view.setUint32(0, len, false);
    for (let i = 0; i < 4; i++) buf[4 + i] = type.charCodeAt(i);
    buf.set(data, 8);
    // crc32 (buffer) check
    // we need to mimic buffer behavior for crc32 lib? 
    // The crc library usually accepts Uint8Array.
    // If not, we might need Buffer.from() if available in worker (polyfill) or use a raw crc algorithm.
    // We imported Buffer from 'buffer'.
    const crcInput = buf.slice(4, 8 + len);
    view.setUint32(8 + len, crc32(crcInput), false);
    return buf;
}
