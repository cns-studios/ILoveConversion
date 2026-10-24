// The server can vanish for a while (a pod or the database restarted by the cluster), so every
// request is retried with backoff, capped at 10 s, for up to RETRY_WINDOW before giving up.
const RETRY_WINDOW = 10 * 60 * 1000;
const RETRY_STATUSES = [408, 429, 499];

function send(item, method, url, body, onProgress) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        item.xhr = xhr;
        if (onProgress) {
            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) onProgress(e.loaded);
            });
        }
        xhr.addEventListener('load', () => {
            item.xhr = null;
            if (xhr.status >= 200 && xhr.status < 300) {
                try {
                    resolve(xhr.responseText ? JSON.parse(xhr.responseText) : {});
                } catch (e) {
                    reject({ message: 'Invalid response from server.' });
                }
                return;
            }
            let message = `Upload failed (HTTP ${xhr.status})`;
            try {
                const err = JSON.parse(xhr.responseText);
                if (err.error) message = err.error;
            } catch (e) {
            }
            reject({ message, status: xhr.status });
        });
        xhr.addEventListener('error', () => {
            item.xhr = null;
            reject({ message: 'Network error. Please check your connection and try again.', retry: true });
        });
        xhr.addEventListener('abort', () => {
            item.xhr = null;
            reject({ message: 'Upload was cancelled.', aborted: true });
        });
        xhr.open(method, url);
        xhr.send(body);
    });
}

// sendRetrying repeats a request that failed for a reason that is not the request's fault.
// A 409 on a repeat of an idempotent step means the earlier attempt did land (acceptConflict).
async function sendRetrying(item, method, url, body, onProgress, { acceptConflict = false, onConflict } = {}) {
    const deadline = Date.now() + RETRY_WINDOW;
    for (let attempt = 1; ; attempt++) {
        try {
            return await send(item, method, url, body, onProgress);
        } catch (err) {
            if (acceptConflict && attempt > 1 && err.status === 409) return onConflict();
            const transient = err.retry || err.status >= 500 || RETRY_STATUSES.includes(err.status);
            if (!transient || err.aborted || item.removed || Date.now() >= deadline) throw err;
            if (onProgress) onProgress(0);
            await new Promise((r) => setTimeout(r, Math.min(500 * 2 ** (attempt - 1), 10000)));
        }
    }
}

// deleteJob is best-effort cleanup that outlasts a short outage; whatever it misses expires
// on the server anyway.
export async function deleteJob(id) {
    const deadline = Date.now() + 2 * 60 * 1000;
    for (let attempt = 1; Date.now() < deadline; attempt++) {
        try {
            const res = await fetch(`/api/jobs/${id}`, { method: 'DELETE' });
            if (res.status < 500 && !RETRY_STATUSES.includes(res.status)) return;
        } catch (e) {
        }
        await new Promise((r) => setTimeout(r, Math.min(1000 * 2 ** (attempt - 1), 15000)));
    }
}

export async function uploadFile(item, onProgress) {
    const { file } = item;
    const init = await sendRetrying(item, 'POST', '/api/uploads', new URLSearchParams({
        ...item.params,
        operation: item.operation,
        filename: file.name,
        size: file.size,
    }), null);
    item.jobId = init.id;

    try {
        let sent = 0;
        for (let i = 0; i < init.chunks; i++) {
            const blob = file.slice(i * init.chunk_size, (i + 1) * init.chunk_size);
            await sendRetrying(item, 'PUT', `/api/uploads/${init.id}/chunks/${i}`, blob,
                (loaded) => onProgress(Math.round(((sent + loaded) / file.size) * 100)));
            sent += blob.size;
        }
        onProgress(100);
        return await sendRetrying(item, 'POST', `/api/uploads/${init.id}/complete`, undefined, null, { acceptConflict: true, onConflict: () => ({ id: init.id }) });
    } catch (err) {
        if (!item.removed) deleteJob(init.id);
        item.jobId = null;
        throw err;
    }
}
