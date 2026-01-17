import { unzlib, zlib } from 'fflate';
import { Buffer } from 'buffer';
import crc32 from 'crc/crc32';

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
        zlib(data, options, (err,QX) => {
            if (err) reject(err);
            else resolve(QX);
        });
    });
}

export async function mergePngs(pngs: Uint8Array[]): Promise<Uint8Array> {
    if (pngs.length === 0) throw new Error("No PNGs to merge");

    let totalHeight = 0;
    let width = 0;
    let rawDataParts: Uint8Array[] = [];

    // Protocol:
    // 1. Read IHDR of first PNG to get width/bitDepth/colorType/etc.
    // 2. Iterate all PNGs:
    //    - Validate compatibility (width, depth, type).
    //    - Sum height.
    //    - Extract all IDAT chunks, concat them.
    //    - Decompress IDAT.
    //    - Store decompressed raw scanlines.
    // 3. Concat all raw scanlines.
    // 4. Compress new IDAT.
    // 5. Construct new PNG.

    let firstIHDR: {
        width: number,
        height: number,
        depth: number,
        colorType: number,
        compression: number,
        filter: number,
        interlace: number,
        data: Uint8Array
    } | null = null;

    for (let i = 0; i < pngs.length; i++) {
        const png = pngs[i];
        const reader = new PngReader(png);
        
        // Validation & Header reading
        const ihdr = reader.readIHDR();
        if (i === 0) {
            firstIHDR = ihdr;
            width = ihdr.width;
        } else {
            if (ihdr.width !== firstIHDR!.width || 
                ihdr.depth !== firstIHDR!.depth || 
                ihdr.colorType !== firstIHDR!.colorType ||
                ihdr.compression !== firstIHDR!.compression ||
                ihdr.filter !== firstIHDR!.filter ||
                ihdr.interlace !== firstIHDR!.interlace) {
                console.warn("PNG Merge: Format mismatch in chunk " + i);
                // We proceed anyway, assuming simple stacking works for now,
                // but really this should differ.
                // If widths mismatch, we are in trouble.
                if (ihdr.width !== width) throw new Error("PNG width mismatch");
            }
        }
        totalHeight += ihdr.height;

        // Extract IDAT
        const idatCompressed = reader.readIDATs();
        // Decompress
        const idatRaw = await asyncUnzlib(idatCompressed);
        rawDataParts.push(idatRaw);
    }

    if (!firstIHDR) throw new Error("Failed to read header");

    // Merge raw data
    const totalLength = rawDataParts.reduce((acc, part) => acc + part.length, 0);
    const mergedRaw = new Uint8Array(totalLength);
    let offset = 0;
    for (const part of rawDataParts) {
        mergedRaw.set(part, offset);
        offset += part.length;
    }

    // Recompress
    const newIdatCompressed = await asyncZlib(mergedRaw, { level: 6 });

    // Construct new PNG
    // Sig (8) + IHDR (25) + IDAT (12 + len) + IEND (12)
    // IHDR Data: 13 bytes
    
    // Create new IHDR chunk
    const newHeightBuf = new Uint8Array(4);
    new DataView(newHeightBuf.buffer).setUint32(0, totalHeight, false); // Big Endian
    
    // IHDR content: Width(4), Height(4), Depth(1), Color(1), Comp(1), Filt(1), Interl(1)
    const newIhdrData = new Uint8Array(13);
    newIhdrData.set(firstIHDR.data.slice(0, 4), 0); // Width
    newIhdrData.set(newHeightBuf, 4); // Height
    newIhdrData.set(firstIHDR.data.slice(8, 13), 8); // Rest

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

function writeChunk(type: string, data: Uint8Array): Uint8Array {
    const len = data.length;
    // 4 len + 4 type + data + 4 crc
    const buf = new Uint8Array(4 + 4 + len + 4);
    const view = new DataView(buf.buffer);
    
    view.setUint32(0, len, false);
    
    // Type
    for (let i = 0; i < 4; i++) {
        buf[4 + i] = type.charCodeAt(i);
    }
    
    // Data
    buf.set(data, 8);
    
    // CRC
    // CRC is calculated on Type + Data
    const crcInput = buf.slice(4, 8 + len);
    const crc = crc32(Buffer.from(crcInput)); // crc32 expects Buffer or string usually, assume it handles Uint8Array or convert
    
    view.setUint32(8 + len, crc, false); // CRC is big endian in PNG? Yes.
    
    return buf;
}

class PngReader {
    pos = 8;
    constructor(private data: Uint8Array) {}

    readIHDR() {
        // IHDR must be first chunk
        // Check signature? We assume valid PNG per call
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

            if (type === 'IDAT') {
                idatParts.push(this.data.slice(this.pos + 8, this.pos + 8 + len));
            } else if (type === 'IEND') {
                break;
            }

            this.pos += 12 + len;
        }

        // Concat IDATs
        const totalLen = idatParts.reduce((a, b) => a + b.length, 0);
        const res = new Uint8Array(totalLen);
        let offset = 0;
        for (const part of idatParts) {
            res.set(part, offset);
            offset += part.length;
        }
        return res;
    }

    private readUint32(offset: number) {
        // Big endian
        return (this.data[offset] << 24) | (this.data[offset + 1] << 16) | (this.data[offset + 2] << 8) | this.data[offset + 3];
    }

    private readString(offset: number, len: number) {
        let res = "";
        for (let i = 0; i < len; i++) res += String.fromCharCode(this.data[offset + i]);
        return res;
    }
}
