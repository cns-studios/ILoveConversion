import { formatBytes } from './helpers.js';
import { BUSY_STATUSES, pulse, updateBusy } from './motion.js';

export function setError(item, message) {
    item.status = 'error';
    item.error = message;
}

export function renderFile(item) {
    const { row, meta, download } = item.el;
    const size = formatBytes(item.file.size);
    const busy = BUSY_STATUSES.includes(item.status);
    updateBusy();

    row.classList.toggle('is-ready', item.status === 'ready');
    row.classList.toggle('is-cloud', item.status === 'needs-cloud');
    row.classList.toggle('is-error', item.status === 'error');
    row.classList.toggle('is-busy', busy);
    row.classList.toggle('is-done', item.status === 'done');
    if (item.status === 'done' && item.shownStatus !== 'done') pulse(row, 'just-done');
    item.shownStatus = item.status;
    row.setAttribute('aria-busy', busy);

    download.classList.toggle('hidden', item.status === 'error' || item.status === 'needs-cloud');
    download.classList.toggle('is-disabled', item.status !== 'done');
    download.setAttribute('aria-disabled', item.status !== 'done');

    switch (item.status) {
        case 'ready':
            meta.textContent = `${size} · Ready`;
            break;
        case 'waiting':
            meta.textContent = `${size} · Waiting…`;
            break;
        case 'needs-cloud':
            meta.textContent = `${size} · Needs online processing`;
            break;
        case 'uploading':
            meta.textContent = `${size} · Uploading ${item.progress}%`;
            break;
        case 'queued':
            meta.textContent = `${size} · In queue…`;
            break;
        case 'processing':
            meta.textContent = item.backend === 'local'
                ? `${size} · Processing on this device…`
                : `${size} · Processing…`;
            break;
        case 'error':
            meta.textContent = item.error;
            break;
        case 'done':
            renderDone(item);
            break;
    }
}

function renderDone(item) {
    if (item.backend === 'local') {
        renderLocalDone(item);
        return;
    }
    const { meta, download } = item.el;
    const job = item.job || {};
    const inSize = job.input_size || item.file.size;
    const outSize = job.output_size;

    meta.textContent = `${formatBytes(inSize)} → ${formatBytes(outSize)}`;
    if (inSize > 0 && outSize) {
        const savings = (1 - outSize / inSize) * 100;
        const note = document.createElement('span');
        if (savings >= 0.1) {
            note.textContent = ` · ${savings.toFixed(1)}% smaller`;
            note.className = 'is-success';
        } else if (savings <= -0.1) {
            note.textContent = ` · ${Math.abs(savings).toFixed(1)}% larger`;
            note.className = 'is-warning';
        }
        meta.appendChild(note);
    }

    const origName = item.file.name;
    const baseName = origName.substring(0, origName.lastIndexOf('.')) || origName;
    const outExt = job.output_filename
        ? job.output_filename.substring(job.output_filename.lastIndexOf('.'))
        : '';
    download.href = `/api/jobs/${item.jobId}/download`;
    download.setAttribute('download', baseName + '-iloveconversion' + outExt);
}

function renderLocalDone(item) {
    const { meta, download } = item.el;
    const { blob, kept } = item.result;
    const inSize = item.file.size;

    meta.textContent = kept
        ? `${formatBytes(inSize)} · Already optimized, kept original`
        : `${formatBytes(inSize)} → ${formatBytes(blob.size)}`;
    if (!kept && item.task.kind === 'image' && item.task.op === 'compress') {
        const savings = (1 - blob.size / inSize) * 100;
        const note = document.createElement('span');
        note.textContent = ` · ${savings.toFixed(1)}% smaller`;
        note.className = 'is-success';
        meta.appendChild(note);
    }
    const badge = document.createElement('span');
    badge.className = 'file-local';
    badge.textContent = ' · on device';
    meta.appendChild(badge);

    const origName = item.file.name;
    const baseName = origName.substring(0, origName.lastIndexOf('.')) || origName;
    const format = item.task.format === 'jpeg' ? 'jpg' : item.task.format;
    const ext = kept ? item.ext : format;
    if (!item.objectUrl) item.objectUrl = URL.createObjectURL(blob);
    download.href = item.objectUrl;
    download.setAttribute('download', `${baseName}-iloveconversion.${ext}`);
}
