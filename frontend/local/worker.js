importScripts('/local/core.js', '/local/png.js', '/local/quantize.js', '/local/bitmap.js', '/local/audio.js', '/local/image.js');

self.onmessage = async (event) => {
    const { id, file, task } = event.data;
    try {
        const result = await self.ILCCodecs.processImage(file, task);
        self.postMessage({ id, blob: result.blob, kept: result.kept });
    } catch (err) {
        self.postMessage({ id, error: { code: err.code || 'failed', message: err.message || String(err) } });
    }
};
