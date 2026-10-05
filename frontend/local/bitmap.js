(function (global) {
    'use strict';

    const codecs = global.ILCCodecs;
    const { ascii, isOpaque } = codecs;

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

    Object.assign(codecs, { encodeBMP, encodeTIFF, encodePDF });
})(typeof self !== 'undefined' ? self : window);
