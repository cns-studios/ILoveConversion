(function (global) {
    'use strict';

    const codecs = global.ILCCodecs;
    const { ascii } = codecs;

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

    Object.assign(codecs, { encodeWAV, encodeAIFF });
})(typeof self !== 'undefined' ? self : window);
