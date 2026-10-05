(function (global) {
    'use strict';

    const codecs = (global.ILCCodecs = global.ILCCodecs || {});

    class LocalError extends Error {
        constructor(code, message) {
            super(message);
            this.code = code;
        }
    }

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

    Object.assign(codecs, { LocalError, crc32, zlibDeflate, ascii, isOpaque, makeCanvas, canvasToBlob });
})(typeof self !== 'undefined' ? self : window);
