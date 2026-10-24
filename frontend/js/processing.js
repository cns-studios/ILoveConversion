import { needsCloud, updateCloudPrompt } from './cloud.js';
import { POLL_INTERVAL } from './constants.js';
import { formatBytes } from './helpers.js';
import { renderFile, setError } from './render.js';
import { state } from './state.js';
import { uploadFile } from './upload.js';

// Consecutive failed status checks tolerated before giving up: the same 10 minutes uploads wait.
const MAX_POLL_FAILURES = (10 * 60 * 1000) / POLL_INTERVAL;

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

async function upload(tool, item) {
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

    try {
        const job = await uploadFile(item, (percent) => {
            item.progress = percent;
            renderFile(item);
        });
        if (item.removed) return;
        item.jobId = job.id;
        item.status = 'queued';
        startPolling(item);
    } catch (err) {
        if (item.removed) return;
        setError(item, err.status === 413
            ? `This file is larger than the ${formatBytes(state.maxFileSize)} limit for online processing.`
            : err.message);
    }
    tool.uploading = false;
    renderFile(item);
    pump(tool);
}

function startPolling(item) {
    stopPolling(item);
    item.pollFailures = 0;
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
        if (res.status >= 500 || res.status === 429) {
            // The server (or its database) is restarting; the job lives on, so keep asking.
            if (++item.pollFailures >= MAX_POLL_FAILURES) {
                const err = await res.json().catch(() => ({}));
                stopPolling(item);
                setError(item, err.error || `Status check failed (HTTP ${res.status})`);
            }
        } else if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            stopPolling(item);
            setError(item, err.error || `Status check failed (HTTP ${res.status})`);
        } else {
            item.pollFailures = 0;
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
        // Network error: counts like a 5xx, the next tick retries.
        if (++item.pollFailures >= MAX_POLL_FAILURES && item.pollTimer) {
            stopPolling(item);
            setError(item, 'Lost connection to the server. Please try again.');
            renderFile(item);
        }
    } finally {
        item.polling = false;
    }
}
