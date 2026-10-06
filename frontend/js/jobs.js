import { COMPRESS_OPS, FORMAT_ALIASES, LOCAL_AUDIO_INPUTS, LOCAL_AUDIO_OUTPUTS, LOCAL_IMAGE_COMPRESS, LOCAL_IMAGE_OUTPUTS, VIDEO_CONVERT_QUALITY } from './constants.js';
import { formatsFor, listOf } from './formats.js';
import { formatBytes } from './helpers.js';

export function isLocalTarget(operation, format) {
    if (operation === 'image_convert') return LOCAL_IMAGE_OUTPUTS.includes(format);
    if (operation === 'audio_convert') return LOCAL_AUDIO_OUTPUTS.includes(format);
    return false;
}

export function localPlan(item) {
    const { category, ext, file, operation, params } = item;
    const limit = ILCLocal.LIMITS[category];
    const target = (params.output_format || '').toUpperCase();

    switch (operation) {
        case 'image_convert':
            if (!LOCAL_IMAGE_OUTPUTS.includes(params.output_format)) return { reason: `Creating ${target} files needs the server.` };
            break;
        case 'image_compress':
            if (!LOCAL_IMAGE_COMPRESS.includes(ext)) return { reason: `Compressing ${ext.toUpperCase()} files needs the server.` };
            if (params.lossless && ext === 'webp') return { reason: 'Lossless WEBP compression needs the server.' };
            break;
        case 'image_remove_bg':
            return { reason: 'Background removal uses an AI model on the server.' };
        case 'audio_convert':
            if (!LOCAL_AUDIO_OUTPUTS.includes(params.output_format)) return { reason: `Creating ${target} files needs the server. WAV and AIFF work on this device.` };
            if (!LOCAL_AUDIO_INPUTS.includes(ext)) return { reason: `${ext.toUpperCase()} files can't be decoded in the browser.` };
            break;
        case 'audio_compress':
            return { reason: 'Audio compression needs the server.' };
        case 'video_compress':
            return { reason: 'Video processing needs the server.' };
        case 'pdf_compress':
            return { reason: 'PDF compression needs the server.' };
        default:
            return { reason: 'This needs the server.' };
    }

    if (limit && file.size > limit.bytes) {
        return { reason: `Larger than the ${formatBytes(limit.bytes)} limit for on-device processing.` };
    }

    if (category === 'image') {
        const isCompress = operation === 'image_compress';
        return {
            task: {
                kind: 'image',
                op: isCompress ? 'compress' : 'convert',
                format: isCompress ? (FORMAT_ALIASES[ext] || ext) : params.output_format,
                quality: isCompress ? params.quality : 92,
                lossless: !!params.lossless,
            },
        };
    }
    return { task: { kind: 'audio', format: params.output_format } };
}

export function jobFor(tool, item) {
    const { category, ext } = item;
    const c = tool.controls;

    if (tool.mode === 'convert') {
        const [operation, format] = c[`target.${category}`].value.split(':');
        if (!listOf(formatsFor(operation).input).includes(ext)) {
            return { error: `.${ext} can't be converted to ${c[`target.${category}`].text}.` };
        }
        const params = { output_format: format };
        if (operation === 'video_compress') params.quality = VIDEO_CONVERT_QUALITY;
        return { operation, params };
    }

    const operation = COMPRESS_OPS[category];
    if (!listOf(formatsFor(operation).input).includes(ext)) {
        return { error: `.${ext} files can't be compressed.` };
    }
    const quality = c[`quality.${category}`].value;
    const lossless = c[`lossless.${category}`] ? c[`lossless.${category}`].checked : false;
    switch (category) {
        case 'pdf':
            return { operation, params: { image_quality: quality, image_dpi: c.pdfDpi.value } };
        case 'video': {
            const params = { quality };
            if (c.videoFormat.value) params.output_format = c.videoFormat.value;
            return { operation, params };
        }
        default:
            return { operation, params: { quality, lossless } };
    }
}
