(function (global) {
    'use strict';

    const codecs = global.ILCCodecs;

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

    Object.assign(codecs, { quantize });
})(typeof self !== 'undefined' ? self : window);
