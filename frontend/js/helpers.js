import { $ } from './dom.js';

export function showAlert(message, title = 'Info') {
    $('#alert-title').textContent = title;
    $('#alert-text').textContent = message;
    $('#alert-modal').classList.remove('hidden');
}

export function formatBytes(bytes) {
    if (bytes === 0 || bytes == null) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
