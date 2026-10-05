// On-device codecs for local mode. Runs in the local worker (via importScripts) and on the
// main thread as a fallback. Everything here works on in-memory data only; nothing is sent anywhere.
(function (global) {
    'use strict';

    class LocalError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    }

    /* ---------- Shared helpers ---------- */

    const CRC_TABLE = (() => {
        const table = new Uint32Array(256);
        for (let n = 0; n < 256; n++) {
            let c = n;
            for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
            table[n] = c >>> 0;
        }
        return table;
    })();

    function crc32(bytes, start, end) {
        let c = 0xffffffff;
        for (let i = start; i < end; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    }

    // zlib-wrapped deflate, as PNG's IDAT expects.
    async function zlibDeflate(data) {
        const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('deflate'));
        return new Uint8Array(await new Response(stream).arrayBuffer());
    }

    function ascii(str) {
        const out = new Uint8Array(str.length);
        for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i);
        return out;
    }

    function isOpaque(rgba) {
        for (let i = 3; i < rgba.length; i += 4) if (rgba[i] !== 255) return false;
        return true;
    }

    /* ---------- PNG ---------- */

    function pngChunk(type, data) {
        const out = new Uint8Array(12 + data.length);
        const view = new DataView(out.buffer);
        view.setUint32(0, data.length);
        out.set(ascii(type), 4);
        out.set(data, 8);
        view.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
        return out;
    }

    function ihdr(width, height, bitDepth, colorType) {
        const data = new Uint8Array(13);
        const view = new DataView(data.buffer);
        view.setUint32(0, width);
        view.setUint32(4, height);
        data[8] = bitDepth;
        data[9] = colorType;
        return data;
    }

    function paeth(a, b, c) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        if (pa <= pb && pa <= pc) return a;
        return pb <= pc ? b : c;
    }

    // Applies the cheapest of the five PNG filters per row (minimum sum of absolute differences).
    function filterTruecolor(pixels, width, height, bpp) {
        const stride = width * bpp;
        const out = new Uint8Array((stride + 1) * height);
        const zero = new Uint8Array(stride);
        const candidates = [0, 1, 2, 3, 4].map(() => new Uint8Array(stride));

        for (let y = 0; y < height; y++) {
            const cur = pixels.subarray(y * stride, (y + 1) * stride);
            const prev = y ? pixels.subarray((y - 1) * stride, y * stride) : zero;
            let best = 0;
            let bestScore = Infinity;

            for (let f = 0; f < 5; f++) {
                const line = candidates[f];
                let score = 0;
                for (let i = 0; i < stride; i++) {
                    const left = i >= bpp ? cur[i - bpp] : 0;
                    const up = prev[i];
                    const upLeft = i >= bpp ? prev[i - bpp] : 0;
                    let v;
                    switch (f) {
                        case 0: v = cur[i]; break;
                        case 1: v = cur[i] - left; break;
                        case 2: v = cur[i] - up; break;
                        case 3: v = cur[i] - ((left + up) >> 1); break;
                        default: v = cur[i] - paeth(left, up, upLeft);
                    }
                    v &= 0xff;
                    line[i] = v;
                    score += v < 128 ? v : 256 - v;
                }
                if (score < bestScore) {
                    bestScore = score;
                    best = f;
                }
            }

            const offset = y * (stride + 1);
            out[offset] = best;
            out.set(candidates[best], offset + 1);
        }
        return out;
    }

    async function encodePngTruecolor(rgba, width, height) {
        const opaque = isOpaque(rgba);
        let pixels = rgba;
        if (opaque) {
            pixels = new Uint8Array(width * height * 3);
            for (let i = 0, j = 0; i < rgba.length; i += 4, j += 3) {
                pixels[j] = rgba[i];
                pixels[j + 1] = rgba[i + 1];
                pixels[j + 2] = rgba[i + 2];
            }
        }
        const filtered = filterTruecolor(pixels, width, height, opaque ? 3 : 4);
        const idat = await zlibDeflate(filtered);
        return new Blob([
            new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
            pngChunk('IHDR', ihdr(width, height, 8, opaque ? 2 : 6)),
            pngChunk('IDAT', idat),
            pngChunk('IEND', new Uint8Array(0)),
        ], { type: 'image/png' });
    }

    async function encodePngIndexed(indices, palette, width, height) {
        const colors = palette.length / 4;
        const bitDepth = colors <= 2 ? 1 : colors <= 4 ? 2 : colors <= 16 ? 4 : 8;
        const rowBytes = Math.ceil(width * bitDepth / 8);
        const raw = new Uint8Array((rowBytes + 1) * height);
        const perByte = 8 / bitDepth;

        for (let y = 0; y < height; y++) {
            const rowStart = y * (rowBytes + 1) + 1;
            const src = y * width;
            if (bitDepth === 8) {
                raw.set(indices.subarray(src, src + width), rowStart);
            } else {
                for (let x = 0; x < width; x++) {
                    const shift = 8 - bitDepth * (x % perByte + 1);
                    raw[rowStart + Math.floor(x / perByte)] |= indices[src + x] << shift;
                }
            }
        }

        const plte = new Uint8Array(colors * 3);
        let lastTransparent = -1;
        for (let i = 0; i < colors; i++) {
            plte[i * 3] = palette[i * 4];
            plte[i * 3 + 1] = palette[i * 4 + 1];
            plte[i * 3 + 2] = palette[i * 4 + 2];
            if (palette[i * 4 + 3] !== 255) lastTransparent = i;
        }

        const parts = [
            new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
            pngChunk('IHDR', ihdr(width, height, bitDepth, 3)),
            pngChunk('PLTE', plte),
        ];
        if (lastTransparent >= 0) {
            const trns = new Uint8Array(lastTransparent + 1);
            for (let i = 0; i <= lastTransparent; i++) trns[i] = palette[i * 4 + 3];
            parts.push(pngChunk('tRNS', trns));
        }
        parts.push(pngChunk('IDAT', await zlibDeflate(raw)));
        parts.push(pngChunk('IEND', new Uint8Array(0)));
        return new Blob(parts, { type: 'image/png' });
    }

    /* ---------- Median-cut palette quantizer ---------- */

    // Buckets colors to 5 bits per RGB channel and 4 bits of alpha, then splits the most
    // populated, widest box until the palette is full. Each bucket maps straight to its box.
    function quantize(rgba, maxColors) {
        const SIZE = 1 << 19;
        const counts = new Uint32Array(SIZE);
        const sums = new Float64Array(SIZE * 4);
        const keys = new Uint32Array(rgba.length / 4);

        for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
            const a = rgba[i + 3];
            const key = a < 8 ? 0 : ((rgba[i] >> 3) << 14) | ((rgba[i + 1] >> 3) << 9) | ((rgba[i + 2] >> 3) << 4) | (a >> 4);
            keys[p] = key;
            counts[key]++;
            const s = key * 4;
            sums[s] += rgba[i];
            sums[s + 1] += rgba[i + 1];
            sums[s + 2] += rgba[i + 2];
            sums[s + 3] += a;
        }

        const entries = [];
        for (let k = 0; k < SIZE; k++) if (counts[k]) entries.push(k);

        const channel = (key, c) => (c === 0 ? key >> 14 : c === 1 ? (key >> 9) & 31 : c === 2 ? (key >> 4) & 31 : (key & 15) * 2);

        function describe(box) {
            let total = 0;
            const min = [99, 99, 99, 99], max = [-1, -1, -1, -1];
            for (let i = box.start; i < box.end; i++) {
                const key = entries[i];
                total += counts[key];
                for (let c = 0; c < 4; c++) {
                    const v = channel(key, c);
                    if (v < min[c]) min[c] = v;
                    if (v > max[c]) max[c] = v;
                }
            }
            let axis = 0, range = -1;
            for (let c = 0; c < 4; c++) {
                if (max[c] - min[c] > range) {
                    range = max[c] - min[c];
                    axis = c;
                }
            }
            box.total = total;
            box.axis = axis;
            box.score = box.end - box.start > 1 ? range * total : -1;
            return box;
        }

        const boxes = [describe({ start: 0, end: entries.length })];
        while (boxes.length < maxColors) {
            let target = null;
            for (const box of boxes) if (box.score > 0 && (!target || box.score > target.score)) target = box;
            if (!target) break;

            const axis = target.axis;
            const slice = entries.slice(target.start, target.end).sort((a, b) => channel(a, axis) - channel(b, axis));
            for (let i = 0; i < slice.length; i++) entries[target.start + i] = slice[i];

            // Split at the weighted median, keeping at least one entry on each side.
            let acc = 0;
            let split = target.end - 1;
            for (let i = target.start; i < target.end - 1; i++) {
                acc += counts[entries[i]];
                if (acc >= target.total / 2) {
                    split = i + 1;
                    break;
                }
            }

            const right = describe({ start: split, end: target.end });
            target.end = split;
            describe(target);
            boxes.push(right);
        }

        const palette = new Uint8Array(boxes.length * 4);
        const lut = new Uint8Array(SIZE);
        boxes.forEach((box, index) => {
            const acc = [0, 0, 0, 0];
            let n = 0;
            for (let i = box.start; i < box.end; i++) {
                const key = entries[i];
                lut[key] = index;
                n += counts[key];
                for (let c = 0; c < 4; c++) acc[c] += sums[key * 4 + c];
            }
            for (let c = 0; c < 4; c++) palette[index * 4 + c] = Math.round(acc[c] / n);
        });

        const indices = new Uint8Array(keys.length);
        for (let p = 0; p < keys.length; p++) indices[p] = lut[keys[p]];
        return { palette, indices };
    }

    /* ---------- BMP / TIFF / PDF ---------- */

    function encodeBMP(rgba, width, height) {
        const rowSize = Math.ceil(width * 3 / 4) * 4;
        const dataSize = rowSize * height;
        const buf = new Uint8Array(54 + dataSize);
        const view = new DataView(buf.buffer);
        buf[0] = 0x42;
        buf[1] = 0x4d;
        view.setUint32(2, buf.length, true);
        view.setUint32(10, 54, true);
        view.setUint32(14, 40, true);
        view.setInt32(18, width, true);
        view.setInt32(22, height, true);
        view.setUint16(26, 1, true);
        view.setUint16(28, 24, true);
        view.setUint32(34, dataSize, true);
        view.setUint32(38, 2835, true);
        view.setUint32(42, 2835, true);
        for (let y = 0; y < height; y++) {
            const dst = 54 + (height - 1 - y) * rowSize;
            for (let x = 0; x < width; x++) {
                const s = (y * width + x) * 4;
                const d = dst + x * 3;
                buf[d] = rgba[s + 2];
                buf[d + 1] = rgba[s + 1];
                buf[d + 2] = rgba[s];
            }
        }
        return new Blob([buf], { type: 'image/bmp' });
    }

    // Baseline, uncompressed, single-strip TIFF (RGB, or RGBA with unassociated alpha).
    function encodeTIFF(rgba, width, height) {
        const opaque = isOpaque(rgba);
        const spp = opaque ? 3 : 4;
        const tags = [
            [256, 4, 1, width],
            [257, 4, 1, height],
            [258, 3, spp, 'bps'],
            [259, 3, 1, 1],
            [262, 3, 1, 2],
            [273, 4, 1, 'data'],
            [277, 3, 1, spp],
            [278, 4, 1, height],
            [279, 4, 1, width * height * spp],
            [284, 3, 1, 1],
        ];
        if (!opaque) tags.push([338, 3, 1, 2]);

        const ifdSize = 2 + tags.length * 12 + 4;
        const bpsOffset = 8 + ifdSize;
        const dataOffset = bpsOffset + spp * 2 + ((spp * 2) % 4 ? 4 - (spp * 2) % 4 : 0);
        const buf = new Uint8Array(dataOffset + width * height * spp);
        const view = new DataView(buf.buffer);

        buf.set([0x49, 0x49, 42, 0]);
        view.setUint32(4, 8, true);
        view.setUint16(8, tags.length, true);
        tags.forEach(([tag, type, count, value], i) => {
            const o = 10 + i * 12;
            view.setUint16(o, tag, true);
            view.setUint16(o + 2, type, true);
            view.setUint32(o + 4, count, true);
            const v = value === 'bps' ? bpsOffset : value === 'data' ? dataOffset : value;
            if (type === 3 && count === 1) view.setUint16(o + 8, v, true);
            else view.setUint32(o + 8, v, true);
        });
        view.setUint32(10 + tags.length * 12, 0, true);
        for (let i = 0; i < spp; i++) view.setUint16(bpsOffset + i * 2, 8, true);

        if (opaque) {
            for (let i = 0, j = dataOffset; i < rgba.length; i += 4, j += 3) {
                buf[j] = rgba[i];
                buf[j + 1] = rgba[i + 1];
                buf[j + 2] = rgba[i + 2];
            }
        } else {
            buf.set(rgba, dataOffset);
        }
        return new Blob([buf], { type: 'image/tiff' });
    }

    // Single-page PDF with the JPEG embedded as-is (DCTDecode), page sized at 96 dpi.
    function encodePDF(jpeg, width, height) {
        const w = +(width * 0.75).toFixed(2);
        const h = +(height * 0.75).toFixed(2);
        const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`;
        const parts = [];
        const offsets = [];
        let length = 0;
        const push = (chunk) => {
            const bytes = typeof chunk === 'string' ? ascii(chunk) : chunk;
            parts.push(bytes);
            length += bytes.length;
        };
        const object = (n, body) => {
            offsets[n] = length;
            push(`${n} 0 obj\n${body}\nendobj\n`);
        };

        push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
        object(1, '<< /Type /Catalog /Pages 2 0 R >>');
        object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
        object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`);
        offsets[4] = length;
        push(`4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`);
        push(jpeg);
        push('\nendstream\nendobj\n');
        object(5, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);

        const xref = length;
        let table = 'xref\n0 6\n0000000000 65535 f \n';
        for (let n = 1; n <= 5; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
        push(table);
        push(`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
        return new Blob(parts, { type: 'application/pdf' });
    }

    /* ---------- Audio ---------- */

    function interleave16(channels, view, offset, littleEndian) {
        const frames = channels[0].length;
        const n = channels.length;
        for (let i = 0; i < frames; i++) {
            for (let c = 0; c < n; c++) {
                const s = Math.max(-1, Math.min(1, channels[c][i]));
                view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, littleEndian);
                offset += 2;
            }
        }
    }

    function encodeWAV(channels, sampleRate) {
        const n = channels.length;
        const dataSize = channels[0].length * n * 2;
        const buf = new ArrayBuffer(44 + dataSize);
        const view = new DataView(buf);
        const bytes = new Uint8Array(buf);
        bytes.set(ascii('RIFF'), 0);
        view.setUint32(4, 36 + dataSize, true);
        bytes.set(ascii('WAVEfmt '), 8);
        view.setUint32(16, 16, true);
        view.setUint16(20, 1, true);
        view.setUint16(22, n, true);
        view.setUint32(24, sampleRate, true);
        view.setUint32(28, sampleRate * n * 2, true);
        view.setUint16(32, n * 2, true);
        view.setUint16(34, 16, true);
        bytes.set(ascii('data'), 36);
        view.setUint32(40, dataSize, true);
        interleave16(channels, view, 44, true);
        return new Blob([buf], { type: 'audio/wav' });
    }

    // IEEE 754 80-bit extended, as AIFF's COMM chunk stores the sample rate.
    function writeExtended(view, offset, value) {
        const exp = Math.floor(Math.log2(value));
        const mant = value / Math.pow(2, exp);
        const hi = Math.floor(mant * 0x80000000);
        const lo = Math.floor((mant * 0x80000000 - hi) * 0x100000000);
        view.setUint16(offset, exp + 16383);
        view.setUint32(offset + 2, hi);
        view.setUint32(offset + 6, lo);
    }

    function encodeAIFF(channels, sampleRate) {
        const n = channels.length;
        const frames = channels[0].length;
        const dataSize = frames * n * 2;
        const buf = new ArrayBuffer(54 + dataSize);
        const view = new DataView(buf);
        const bytes = new Uint8Array(buf);
        bytes.set(ascii('FORM'), 0);
        view.setUint32(4, 46 + dataSize);
        bytes.set(ascii('AIFFCOMM'), 8);
        view.setUint32(16, 18);
        view.setUint16(20, n);
        view.setUint32(22, frames);
        view.setUint16(26, 16);
        writeExtended(view, 28, sampleRate);
        bytes.set(ascii('SSND'), 38);
        view.setUint32(42, 8 + dataSize);
        view.setUint32(46, 0);
        view.setUint32(50, 0);
        interleave16(channels, view, 54, false);
        return new Blob([buf], { type: 'audio/aiff' });
    }

    /* ---------- Image pipeline ---------- */

    function makeCanvas(width, height) {
        if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        return canvas;
    }

    function canvasToBlob(canvas, type, quality) {
        if (canvas.convertToBlob) return canvas.convertToBlob({ type, quality });
        return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
    }

    // Palette size for lossy PNG: 8 colors at quality 1, up to 256 near the top of the scale.
    function pngColors(quality) {
        return Math.max(8, Math.min(256, Math.round(Math.pow(2, 3 + 5 * quality / 100))));
    }

    const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

    // task: { op: 'convert'|'compress', format, quality (1-100), lossless, maxPixels }
    async function processImage(file, task) {
        let bitmap;
        try {
            bitmap = await createImageBitmap(file);
        } catch (e) {
            throw new LocalError('decode', 'This browser cannot read this image format.');
        }

        const { width, height } = bitmap;
        if (width * height > task.maxPixels) {
            bitmap.close();
            throw new LocalError('too-large', `${(width * height / 1e6).toFixed(0)} megapixels is above the local limit of ${(task.maxPixels / 1e6).toFixed(0)}.`);
        }

        const format = task.format;
        const canvas = makeCanvas(width, height);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (format === 'jpeg' || format === 'bmp' || format === 'pdf') {
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, width, height);
        }
        ctx.drawImage(bitmap, 0, 0);
        bitmap.close();

        const q = Math.max(1, Math.min(100, task.quality)) / 100;
        const pixels = () => ctx.getImageData(0, 0, width, height).data;
        let blob;

        switch (format) {
            case 'jpeg':
            case 'webp':
                blob = await canvasToBlob(canvas, MIME[format], q);
                if (!blob || blob.type !== MIME[format]) {
                    throw new LocalError('encode', `This browser cannot create ${format.toUpperCase()} files.`);
                }
                break;
            case 'png':
                if (task.op === 'convert') {
                    blob = await canvasToBlob(canvas, 'image/png');
                } else if (task.lossless || task.quality >= 96) {
                    const [native, filtered] = await Promise.all([
                        canvasToBlob(canvas, 'image/png'),
                        encodePngTruecolor(pixels(), width, height),
                    ]);
                    blob = native.size <= filtered.size ? native : filtered;
                } else {
                    const { palette, indices } = quantize(pixels(), pngColors(task.quality));
                    blob = await encodePngIndexed(indices, palette, width, height);
                }
                break;
            case 'bmp':
                blob = encodeBMP(pixels(), width, height);
                break;
            case 'tiff':
                blob = encodeTIFF(pixels(), width, height);
                break;
            case 'pdf': {
                const jpeg = await canvasToBlob(canvas, 'image/jpeg', 0.92);
                blob = encodePDF(new Uint8Array(await jpeg.arrayBuffer()), width, height);
                break;
            }
            default:
                throw new LocalError('unsupported', `${format.toUpperCase()} is not available locally.`);
        }

        if (task.op === 'compress' && blob.size >= file.size) {
            return { blob: file, kept: true };
        }
        return { blob, kept: false };
    }

    global.ILCCodecs = {
        LocalError,
        processImage,
        quantize,
        encodePngIndexed,
        encodePngTruecolor,
        encodeBMP,
        encodeTIFF,
        encodePDF,
        encodeWAV,
        encodeAIFF,
        pngColors,
    };
})(typeof self !== 'undefined' ? self : window);
