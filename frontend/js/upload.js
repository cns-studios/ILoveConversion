const CHUNK_RETRIES = 3;

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

async function sendChunk(item, url, blob, onProgress) {
    for (let attempt = 1; ; attempt++) {
        try {
            return await send(item, 'PUT', url, blob, onProgress);
        } catch (err) {
            const transient = err.retry || err.status >= 500;
            if (!transient || err.aborted || item.removed || attempt >= CHUNK_RETRIES) throw err;
            onProgress(0);
            await new Promise((r) => setTimeout(r, 500 * attempt));
        }
    }
}

export async function uploadFile(item, onProgress) {
    const { file } = item;
    const init = await send(item, 'POST', '/api/uploads', new URLSearchParams({
        ...item.params,
        operation: item.operation,
        filename: file.name,
        size: file.size,
    }));
    item.jobId = init.id;

    try {
        let sent = 0;
        for (let i = 0; i < init.chunks; i++) {
            const blob = file.slice(i * init.chunk_size, (i + 1) * init.chunk_size);
            await sendChunk(item, `/api/uploads/${init.id}/chunks/${i}`, blob,
                (loaded) => onProgress(Math.round(((sent + loaded) / file.size) * 100)));
            sent += blob.size;
        }
        onProgress(100);
        return await send(item, 'POST', `/api/uploads/${init.id}/complete`);
    } catch (err) {
        if (!item.removed) fetch(`/api/jobs/${init.id}`, { method: 'DELETE' }).catch(() => {});
        item.jobId = null;
        throw err;
    }
}
