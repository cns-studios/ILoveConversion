(function (global) {
    'use strict';

    const codecs = global.ILCCodecs;
    const { ascii, crc32, isOpaque, zlibDeflate } = codecs;

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

    function pngColors(quality) {
        return Math.max(8, Math.min(256, Math.round(Math.pow(2, 3 + 5 * quality / 100))));
    }

    Object.assign(codecs, { encodePngTruecolor, encodePngIndexed, pngColors });
})(typeof self !== 'undefined' ? self : window);
