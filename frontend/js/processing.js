import { needsCloud, updateCloudPrompt } from './cloud.js';
import { POLL_INTERVAL } from './constants.js';
import { formatBytes } from './helpers.js';
import { renderFile, setError } from './render.js';
import { state } from './state.js';

export function pump(tool) {
    if (!tool.uploading) {
        const next = tool.files.find((f) => f.status === 'waiting' && f.backend === 'online');
        if (next) upload(tool, next);
    }
    if (!tool.localBusy) {
        const next = tool.files.find((f) => f.status === 'waiting' && f.backend === 'local');
        if (next) runLocal(tool, next);
    }
}

async function runLocal(tool, item) {
    tool.localBusy = true;
    item.status = 'processing';
    renderFile(item);
    try {
        const result = item.task.kind === 'image'
            ? await ILCLocal.image(item.file, item.task)
            : await ILCLocal.audio(item.file, item.task);
        if (item.removed) return;
        item.result = result;
        item.status = 'done';
    } catch (err) {
        if (item.removed) return;
        if (['decode', 'too-large', 'encode', 'unsupported'].includes(err.code)) {
            needsCloud(item, err.message);
        } else {
            setError(item, `On-device processing failed: ${err.message}`);
        }
    } finally {
        tool.localBusy = false;
        if (!item.removed) {
            renderFile(item);
            updateCloudPrompt(tool);
        }
        pump(tool);
    }
}

function upload(tool, item) {
    if (item.file.size > state.maxFileSize) {
        setError(item, `This file is larger than the ${formatBytes(state.maxFileSize)} limit for online processing.`);
        renderFile(item);
        pump(tool);
        return;
    }
    tool.uploading = true;
    item.status = 'uploading';
    item.progress = 0;
    renderFile(item);

    const formData = new FormData();
    formData.append('file', item.file);
    formData.append('operation', item.operation);
    Object.keys(item.params).forEach((key) => {
        formData.append(key, item.params[key]);
    });

    const xhr = new XMLHttpRequest();
    item.xhr = xhr;

    const finishUpload = () => {
        item.xhr = null;
        tool.uploading = false;
        renderFile(item);
        pump(tool);
    };

    xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) {
            item.progress = Math.round((e.loaded / e.total) * 100);
            renderFile(item);
        }
    });

    xhr.addEventListener('load', () => {
        if (xhr.status >= 200 && xhr.status < 300) {
            try {
                const data = JSON.parse(xhr.responseText);
                item.jobId = data.id;
                item.status = 'queued';
                startPolling(item);
            } catch (e) {
                setError(item, 'Invalid response from server.');
            }
        } else {
            let message = xhr.status === 413
                ? `This file is larger than the ${formatBytes(state.maxFileSize)} limit for online processing.`
                : `Upload failed (HTTP ${xhr.status})`;
            try {
                const err = JSON.parse(xhr.responseText);
                if (err.error) message = err.error;
            } catch (e) {
            }
            setError(item, message);
        }
        finishUpload();
    });

    xhr.addEventListener('error', () => {
        setError(item, 'Network error. Please check your connection and try again.');
        finishUpload();
    });

    xhr.addEventListener('abort', () => {
        if (item.removed) return;
        setError(item, 'Upload was cancelled.');
        finishUpload();
    });

    xhr.open('POST', '/api/jobs');
    xhr.send(formData);
}

function startPolling(item) {
    stopPolling(item);
    item.pollTimer = setInterval(() => pollJob(item), POLL_INTERVAL);
}

export function stopPolling(item) {
    if (item.pollTimer) {
        clearInterval(item.pollTimer);
        item.pollTimer = null;
    }
}

async function pollJob(item) {
    if (!item.jobId || item.polling) return;
    item.polling = true;

    try {
        const res = await fetch(`/api/jobs/${item.jobId}`);
        if (!item.pollTimer) return;
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            stopPolling(item);
            setError(item, err.error || `Status check failed (HTTP ${res.status})`);
        } else {
            const job = await res.json();
            switch (job.status) {
                case 'pending':
                    item.status = 'queued';
                    break;
                case 'processing':
                    item.status = 'processing';
                    break;
                case 'completed':
                    stopPolling(item);
                    item.status = 'done';
                    item.job = job;
                    break;
                case 'failed':
                    stopPolling(item);
                    setError(item, job.error_message || 'Processing failed. Please try again.');
                    break;
            }
        }
        renderFile(item);
    } catch (e) {
    } finally {
        item.polling = false;
    }
}
