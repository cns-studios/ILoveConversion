(function (global) {
    'use strict';

    const codecs = global.ILCCodecs;
    const { LocalError, canvasToBlob, encodeBMP, encodePDF, encodePngIndexed, encodePngTruecolor, encodeTIFF, makeCanvas, pngColors, quantize } = codecs;

    const MIME = { jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

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

    Object.assign(codecs, { processImage });
})(typeof self !== 'undefined' ? self : window);
