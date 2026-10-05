// Local mode: processes files on this device. Images go through a Web Worker (or the main
// thread where OffscreenCanvas is missing); audio is decoded with the Web Audio API.
// Nothing in here touches the network.
(function (global) {
    'use strict';

    const { LocalError } = global.ILCCodecs;

    const MB = 1024 * 1024;
    const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    const LIMITS = {
        image: { bytes: 50 * MB, pixels: isIOS ? 16e6 : 50e6 },
        audio: { bytes: 25 * MB },
    };

    const supportsWebp = (() => {
        try {
            return document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp');
        } catch (e) {
            return false;
        }
    })();

    const workerCapable = typeof Worker !== 'undefined'
        && typeof OffscreenCanvas !== 'undefined'
        && typeof OffscreenCanvas.prototype.convertToBlob === 'function';

    let worker = null;
    let nextId = 1;
    const jobs = new Map();

    function getWorker() {
        if (worker) return worker;
        worker = new Worker('/local-worker.js');
        worker.onmessage = (event) => {
            const { id, blob, kept, error } = event.data;
            const job = jobs.get(id);
            if (!job) return;
            jobs.delete(id);
            if (error) job.reject(new LocalError(error.code, error.message));
            else job.resolve({ blob, kept });
        };
        worker.onerror = (event) => {
            event.preventDefault();
            jobs.forEach((job) => job.reject(new LocalError('failed', 'The local worker crashed. The image may be too large for this device.')));
            jobs.clear();
            worker.terminate();
            worker = null;
        };
        return worker;
    }

    function image(file, task) {
        const full = { ...task, maxPixels: LIMITS.image.pixels };
        if (!workerCapable) return global.ILCCodecs.processImage(file, full);
        return new Promise((resolve, reject) => {
            const id = nextId++;
            jobs.set(id, { resolve, reject });
            getWorker().postMessage({ id, file, task: full });
        });
    }

    // decodeAudioData resamples to the context rate; 44.1 kHz matches most music sources.
    async function audio(file, task) {
        const Ctx = global.OfflineAudioContext || global.webkitOfflineAudioContext;
        if (!Ctx) throw new LocalError('decode', 'This browser has no audio decoder.');
        const data = await file.arrayBuffer();
        let buffer;
        try {
            buffer = await new Ctx(1, 1, 44100).decodeAudioData(data);
        } catch (e) {
            throw new LocalError('decode', 'This browser cannot read this audio format.');
        }
        const channels = [];
        for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
        const blob = task.format === 'aiff'
            ? global.ILCCodecs.encodeAIFF(channels, buffer.sampleRate)
            : global.ILCCodecs.encodeWAV(channels, buffer.sampleRate);
        return { blob, kept: false };
    }

    global.ILCLocal = { LIMITS, supportsWebp, image, audio };
})(window);
