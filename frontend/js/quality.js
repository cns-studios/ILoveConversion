import { FORMAT_ALIASES, LOCAL_IMAGE_COMPRESS } from './constants.js';

function mapRange(value, inMin, inMax, outMin, outMax) {
    if (value <= inMin) return outMin;
    if (value >= inMax) return outMax;
    return outMin + Math.trunc((value - inMin) * (outMax - outMin) / (inMax - inMin));
}

const QUALITY_TIERS = [
    { max: 30, name: 'Smallest' },
    { max: 55, name: 'Small' },
    { max: 75, name: 'Balanced' },
    { max: 90, name: 'High' },
    { max: 100, name: 'Maximum' },
];

const TIER_DESCRIPTIONS = {
    image: [
        'Tiny files with visible artifacts. Fine for thumbnails and previews.',
        'Slight softness. Good for chat apps and email.',
        'Good-looking and compact. The sweet spot for websites.',
        'Hard to tell apart from the original.',
        'Visually identical to the original, with the least savings.',
    ],
    audio: [
        'Voice and podcasts only. Music will sound muffled.',
        'Fine for speech and casual listening.',
        'Good for music on phones and headphones.',
        'Near CD quality.',
        'Transparent quality, with the least savings.',
    ],
    video: [
        'Very small, blocky in motion. Only for previews.',
        'Watchable on small screens.',
        'Good for sharing and the web.',
        'Sharp detail, larger files.',
        'Close to the original. Slow to encode.',
    ],
};

const PDF_PRESETS = [
    { max: 30, name: 'Screen', desc: 'Low-resolution images for on-screen reading. Smallest files.' },
    { max: 60, name: 'Ebook', desc: 'Readable images, good for email and e-readers.' },
    { max: 85, name: 'Printer', desc: 'High-quality images suitable for printing.' },
    { max: 100, name: 'Prepress', desc: 'Best quality with minimal image compression.' },
];

export const QUALITY_PRESETS = {
    default: [['Small', 40], ['Balanced', 70], ['High', 85], ['Max', 95]],
    pdf: [['Screen', 25], ['Ebook', 50], ['Printer', 75], ['Prepress', 95]],
};

function formatDetail(category, format, q, local) {
    const name = (FORMAT_ALIASES[format] || format).toUpperCase();
    if (local && category === 'image' && LOCAL_IMAGE_COMPRESS.includes(format)) {
        if (format === 'png') {
            return q >= 96 ? 'PNG re-encoded losslessly on this device' : `PNG with up to ${ILCCodecs.pngColors(q)} colors, made on this device`;
        }
        return `${name} quality ${q}, encoded on this device`;
    }
    switch (category) {
        case 'image':
            if (format === 'png') return `PNG palette quality ${Math.max(q - 20, 0)}-${q}`;
            if (format === 'gif' || format === 'bmp') return `${name} re-encoded (quality has little effect)`;
            return `${name} quality ${q}`;
        case 'audio':
            switch (format) {
                case 'mp3': return `MP3 ≈ ${mapRange(q, 1, 100, 32, 320)} kbps`;
                case 'ogg': return `OGG Vorbis level ${mapRange(q, 1, 100, 0, 10)}`;
                case 'opus': return `OPUS ≈ ${mapRange(q, 1, 100, 16, 256)} kbps`;
                case 'aac':
                case 'm4a': return `${name} ≈ ${mapRange(q, 1, 100, 32, 256)} kbps`;
                case 'wma': return `WMA ≈ ${mapRange(q, 1, 100, 32, 192)} kbps`;
                case 'flac': return `FLAC is lossless; compression level ${mapRange(q, 1, 100, 12, 0)}`;
                default: return `${name} is uncompressed; quality has no effect`;
            }
        case 'video':
            return format === 'webm'
                ? `WEBM (VP9) CRF ${mapRange(q, 1, 100, 50, 15)}`
                : `${name} (H.264) CRF ${mapRange(q, 1, 100, 45, 17)}`;
        default:
            return '';
    }
}

export function qualityInfo(category, formats, q, lossless, local) {
    if (category === 'pdf') {
        const preset = PDF_PRESETS.find((p) => q <= p.max);
        return { tier: preset.name, desc: preset.desc, detail: `Ghostscript “${preset.name.toLowerCase()}” preset, image quality ${q}` };
    }
    const idx = QUALITY_TIERS.findIndex((t) => q <= t.max);
    if (lossless) {
        return {
            tier: 'Lossless',
            desc: 'No quality loss. Savings come only from smarter compression.',
            detail: '',
        };
    }
    const details = [...new Set(formats.map((f) => formatDetail(category, f, q, local)))].filter(Boolean);
    return {
        tier: QUALITY_TIERS[idx].name,
        desc: TIER_DESCRIPTIONS[category][idx],
        detail: details.slice(0, 3).join(' · '),
    };
}
