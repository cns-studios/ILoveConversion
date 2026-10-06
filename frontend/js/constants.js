export const POLL_INTERVAL = 2000;

export const VIDEO_CONVERT_QUALITY = 85;

export const FORMAT_ALIASES = { jpg: 'jpeg', tif: 'tiff' };

export const CATEGORIES = ['image', 'audio', 'video', 'pdf'];

const CATEGORY_LABELS = { image: 'images', audio: 'audio files', video: 'videos', pdf: 'PDFs' };

export const CATEGORY_TITLES = { image: 'Images', audio: 'Audio', video: 'Video', pdf: 'PDF' };

export const CATEGORY_SOURCE = {
    image: 'image_convert',
    audio: 'audio_convert',
    video: 'video_compress',
    pdf: 'pdf_compress',
};

export const CONVERT_OPS = { image: 'image_convert', audio: 'audio_convert', video: 'video_compress' };

export const COMPRESS_OPS = { image: 'image_compress', audio: 'audio_compress', video: 'video_compress', pdf: 'pdf_compress' };

export const DEFAULTS = {
    target: { image: 'image_convert:jpeg', audio: 'audio_convert:mp3', video: 'video_compress:mp4' },
    quality: { image: 80, audio: 70, video: 65, pdf: 75 },
};

export const LOSSLESS_FORMATS = {
    image: ['png', 'webp', 'avif', 'tiff', 'tif'],
    audio: ['flac', 'wav', 'aiff'],
};

export const LOCAL_IMAGE_OUTPUTS = ['jpeg', 'png', 'webp', 'bmp', 'tiff', 'pdf'];

export const LOCAL_IMAGE_COMPRESS = ['jpeg', 'jpg', 'png', 'webp'];

export const LOCAL_AUDIO_INPUTS = ['mp3', 'wav', 'flac', 'ogg', 'opus', 'aac', 'm4a'];

export const LOCAL_AUDIO_OUTPUTS = ['wav', 'aiff'];

const LOCAL_CATEGORIES = { convert: ['image', 'audio'], compress: ['image'] };

export const MIME_MAP = {
    jpeg: 'image/jpeg', jpg: 'image/jpeg', png: 'image/png',
    webp: 'image/webp', tiff: 'image/tiff', tif: 'image/tiff',
    gif: 'image/gif', avif: 'image/avif', heif: 'image/heif',
    heic: 'image/heic', bmp: 'image/bmp', pdf: 'application/pdf',
    mp3: 'audio/mpeg', wav: 'audio/wav', flac: 'audio/flac',
    ogg: 'audio/ogg', opus: 'audio/opus', aac: 'audio/aac',
    m4a: 'audio/mp4', aiff: 'audio/aiff', wma: 'audio/x-ms-wma',
    mp4: 'video/mp4', mkv: 'video/x-matroska', webm: 'video/webm',
    avi: 'video/x-msvideo', mov: 'video/quicktime',
};

export const FALLBACK_FORMATS = {
    image_convert: {
        input: ['jpeg', 'jpg', 'png', 'webp', 'tiff', 'tif', 'gif', 'avif', 'heif', 'heic', 'bmp'],
        output: ['jpeg', 'png', 'webp', 'tiff', 'gif', 'avif', 'heif', 'bmp'],
    },
    image_compress: {
        input: ['jpeg', 'jpg', 'png', 'webp', 'tiff', 'tif', 'gif', 'avif', 'heif', 'heic', 'bmp'],
    },
    image_remove_bg: {
        input: ['jpeg', 'jpg', 'png', 'webp', 'tiff', 'tif', 'bmp'],
        output: ['png', 'webp'],
        default_output: 'png',
    },
    pdf_compress: { input: ['pdf'], output: ['pdf'] },
    audio_convert: {
        input: ['mp3', 'wav', 'flac', 'ogg', 'opus', 'aac', 'm4a', 'aiff', 'wma'],
        output: ['mp3', 'wav', 'flac', 'ogg', 'opus', 'aac', 'm4a', 'aiff'],
    },
    audio_compress: {
        input: ['mp3', 'wav', 'flac', 'ogg', 'opus', 'aac', 'm4a', 'aiff', 'wma'],
    },
    video_compress: {
        input: ['mp4', 'mkv', 'webm', 'avi', 'mov'],
        output: ['mp4', 'mkv', 'webm'],
    },
};
