import { CATEGORIES, CATEGORY_SOURCE, FALLBACK_FORMATS } from './constants.js';
import { isLocalTarget } from './jobs.js';
import { state } from './state.js';

export async function loadFormats() {
    try {
        const res = await fetch('/api/formats');
        if (res.ok) {
            state.formats = await res.json();
            const max = parseInt(res.headers.get('X-Max-File-Size'), 10);
            if (max > 0) state.maxFileSize = max;
        }
    } catch (e) {
    }

    if (!state.formats) {
        state.formats = FALLBACK_FORMATS;
    }
}

export function formatsFor(operation) {
    return state.formats[operation] || FALLBACK_FORMATS[operation] || {};
}

export function listOf(value) {
    return Array.isArray(value) ? value : [];
}

export function categoryOf(ext) {
    return CATEGORIES.find((cat) =>
        listOf(formatsFor(CATEGORY_SOURCE[cat]).input).includes(ext)) || null;
}

export function formatItems(operation, suffix = '') {
    return listOf(formatsFor(operation).output).map((f) => ({
        value: `${operation}:${f}`,
        label: f.toUpperCase(),
        display: f.toUpperCase() + suffix,
        cloud: state.mode === 'local' && !isLocalTarget(operation, f),
    }));
}

export function getExtension(filename) {
    return (filename || '').split('.').pop().toLowerCase();
}
