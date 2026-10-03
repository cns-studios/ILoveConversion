(function () {
    'use strict';

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => root.querySelectorAll(sel);

    const state = {
        activeTab: 'convert',
        formats: null,
        tools: {},
        qrCodeData: null,
    };

    const POLL_INTERVAL = 2000;
    // Video "conversion" runs through the video_compress operation, so keep quality high.
    const VIDEO_CONVERT_QUALITY = 85;

    const ICON_DOWNLOAD = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11.25V2.25M12.75 7.5L9 11.25L5.25 7.5M15.75 11.25V14.25C15.75 14.6478 15.592 15.0294 15.3107 15.3107C15.0294 15.592 14.6478 15.75 14.25 15.75H3.75C3.35218 15.75 2.97064 15.592 2.68934 15.3107C2.40804 15.0294 2.25 14.6478 2.25 14.25V11.25"/></svg>';
    const ICON_X = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 4.5L4.5 13.5M4.5 4.5L13.5 13.5"/></svg>';

    const CATEGORY_LABELS = { image: 'images', audio: 'audio files', video: 'videos', pdf: 'PDFs' };

    // Which backend operation handles each file category, per tab.
    const MODES = {
        convert: {
            verb: 'Convert',
            progressVerb: 'Converting',
            ops: { image: 'image_convert', audio: 'audio_convert', video: 'video_compress' },
        },
        compress: {
            verb: 'Compress',
            progressVerb: 'Compressing',
            ops: { image: 'image_compress', audio: 'audio_compress', video: 'video_compress', pdf: 'pdf_compress' },
        },
    };

    // Formats used to detect a file's category from its extension.
    const CATEGORY_SOURCE = {
        image: 'image_convert',
        audio: 'audio_convert',
        video: 'video_compress',
        pdf: 'pdf_compress',
    };

    const MIME_MAP = {
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

    const FALLBACK_FORMATS = {
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

    const dom = {
        tabs: () => $$('.tab'),
        panels: () => $$('.tool-panel'),
        qrOutputSection: $('#qr-output-section'),
        qrResultCanvas: $('#qr-result-canvas'),
        btnDownloadQr: $('#btn-download-qr'),
        qrType: $('#qr-type'),
        qrUrlInput: $('#qr-url-input'),
        qrTextInput: $('#qr-text-input'),
        qrLatitudeInput: $('#qr-latitude-input'),
        qrLongitudeInput: $('#qr-longitude-input'),
        qrLocationSearch: $('#qr-location-search'),
        qrSearchResults: $('#qr-search-results'),
        qrWifiSsid: $('#qr-wifi-ssid'),
        qrWifiPassword: $('#qr-wifi-password'),
        qrWifiHidden: $('#qr-wifi-hidden'),
    };

    async function init() {
        checkConsent();
        await loadFormats();
        state.tools.convert = createFileTool('convert', $('#panel-convert'));
        state.tools.compress = createFileTool('compress', $('#panel-compress'));
        bindEvents();
        switchQrType();
    }

    function checkConsent() {
        const cookie = document.cookie.split('; ').find(row => row.startsWith('tos_and_policy_accepted='));
        const isAccepted = cookie ? cookie.split('=')[1] === 'true' : false;
        if (!isAccepted) {
            $('#consent-modal').classList.remove('hidden');
        }
    }

    async function loadFormats() {
        try {
            const res = await fetch('/api/formats');
            if (res.ok) {
                state.formats = await res.json();
            }
        } catch (e) {
        }

        if (!state.formats) {
            state.formats = FALLBACK_FORMATS;
        }
    }

    function formatsFor(operation) {
        return state.formats[operation] || FALLBACK_FORMATS[operation] || {};
    }

    function bindEvents() {
        dom.tabs().forEach((tab) => {
            tab.addEventListener('click', () => switchTab(tab.dataset.tool));
        });

        $$('.mode-btn').forEach((btn) => {
            btn.addEventListener('click', () => {
                if (btn.dataset.mode === 'local') {
                    showAlert('Local mode, where files are processed entirely in your browser, is not available yet. Online mode encrypts your files and deletes them after 24 hours.', 'Local mode');
                }
            });
        });

        $('#btn-alert-close').addEventListener('click', () => {
            $('#alert-modal').classList.add('hidden');
        });

        dom.btnDownloadQr.addEventListener('click', downloadQrCode);

        dom.qrType.addEventListener('change', switchQrType);
        dom.qrUrlInput.addEventListener('input', generateQrCode);
        dom.qrTextInput.addEventListener('input', generateQrCode);
        dom.qrLocationSearch.addEventListener('input', debounceLocationSearch);
        dom.qrLatitudeInput.addEventListener('input', generateQrCode);
        dom.qrLongitudeInput.addEventListener('input', generateQrCode);
        dom.qrWifiSsid.addEventListener('input', generateQrCode);
        dom.qrWifiPassword.addEventListener('input', generateQrCode);
        dom.qrWifiHidden.addEventListener('change', generateQrCode);

        $('#btn-accept').addEventListener('click', () => {
            const date = new Date();
            date.setFullYear(date.getFullYear() + 1);
            document.cookie = `tos_and_policy_accepted=true; expires=${date.toUTCString()}; path=/; SameSite=Lax`;
            $('#consent-modal').classList.add('hidden');
        });

        $('#btn-decline').addEventListener('click', () => {
            window.location.href = 'https://google.com';
        });
    }

    // Each tab keeps its own panel and state, so switching never interrupts running jobs.
    function switchTab(tab) {
        if (tab === state.activeTab) return;
        state.activeTab = tab;

        dom.tabs().forEach((el) => {
            const isActive = el.dataset.tool === tab;
            el.classList.toggle('active', isActive);
            el.setAttribute('aria-selected', isActive);
        });
        dom.panels().forEach((panel) => {
            panel.classList.toggle('hidden', panel.dataset.panel !== tab);
        });
    }

    /* ---------- File tools (Convert / Compress) ---------- */

    function createFileTool(mode, panel) {
        panel.appendChild($('#tpl-file-tool').content.cloneNode(true));

        const refs = {};
        $$('[data-ref]', panel).forEach((el) => { refs[el.dataset.ref] = el; });

        const tool = {
            mode,
            config: MODES[mode],
            refs,
            category: null,
            files: [],
            uploading: false,
            nextId: 1,
        };

        const categories = Object.keys(tool.config.ops);
        const inputExts = [];
        categories.forEach((cat) => {
            (formatsFor(CATEGORY_SOURCE[cat]).input || []).forEach((ext) => {
                if (!inputExts.includes(ext)) inputExts.push(ext);
            });
        });
        tool.inputExts = inputExts;

        refs.formats.textContent = categories.map((c) => CATEGORY_LABELS[c]).join(', ')
            .replace(/^./, (c) => c.toUpperCase())
            .replace(/, ([^,]*)$/, ' and $1');
        refs.formats.title = inputExts.map((f) => '.' + f).join(', ');
        refs.input.setAttribute('accept', inputExts.map((f) => MIME_MAP[f] || '.' + f)
            .concat(inputExts.map((f) => '.' + f)).join(','));

        refs.dropzone.addEventListener('click', () => refs.input.click());
        refs.dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            refs.dropzone.classList.add('drag-over');
        });
        refs.dropzone.addEventListener('dragleave', (e) => {
            if (!refs.dropzone.contains(e.relatedTarget)) {
                refs.dropzone.classList.remove('drag-over');
            }
        });
        refs.dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            refs.dropzone.classList.remove('drag-over');
            addFiles(tool, e.dataTransfer.files);
        });
        refs.input.addEventListener('change', () => {
            addFiles(tool, refs.input.files);
            refs.input.value = '';
        });
        refs.action.addEventListener('click', () => handleAction(tool));

        return tool;
    }

    function categoryOf(tool, ext) {
        return Object.keys(tool.config.ops).find((cat) =>
            (formatsFor(CATEGORY_SOURCE[cat]).input || []).includes(ext)) || null;
    }

    function addFiles(tool, fileList) {
        const unsupported = [];
        const mismatched = [];

        Array.from(fileList).forEach((file) => {
            const ext = getExtension(file.name);
            const category = categoryOf(tool, ext);
            if (!category) {
                unsupported.push(file.name);
                return;
            }
            if (tool.category && category !== tool.category) {
                mismatched.push(file.name);
                return;
            }
            if (!tool.category) {
                tool.category = category;
                buildOptions(tool);
            }
            addFileRow(tool, file, ext);
        });

        const messages = [];
        if (unsupported.length) {
            messages.push(`Unsupported file type: ${unsupported.join(', ')}\n\nSupported: ${tool.inputExts.map((f) => '.' + f).join(', ')}`);
        }
        if (mismatched.length) {
            messages.push(`Skipped ${mismatched.join(', ')}: all files in one batch must be ${CATEGORY_LABELS[tool.category]}. Finish or clear this batch first.`);
        }
        if (messages.length) showAlert(messages.join('\n\n'));

        updateTool(tool);
    }

    function addFileRow(tool, file, ext) {
        const item = {
            id: tool.nextId++,
            file,
            ext,
            status: 'ready',
            progress: 0,
            jobId: null,
            xhr: null,
            pollTimer: null,
            error: '',
            job: null,
        };

        const row = document.createElement('div');
        row.className = 'file-row';
        row.innerHTML = `
            <div class="file-main">
                <span class="file-name"></span>
                <span class="file-meta"></span>
                <div class="file-progress hidden"><div class="file-progress-fill"></div></div>
            </div>
            <div class="file-actions">
                <a class="btn-chip btn-download hidden" href="#" download><span class="btn-chip-text">Download</span>${ICON_DOWNLOAD}</a>
                <button type="button" class="btn-chip btn-square" aria-label="Remove file" title="Remove">${ICON_X}</button>
            </div>`;
        $('.file-name', row).textContent = file.name;
        $('.file-name', row).title = file.name;
        $('.btn-square', row).addEventListener('click', () => removeFile(tool, item));

        item.el = {
            row,
            meta: $('.file-meta', row),
            progress: $('.file-progress', row),
            fill: $('.file-progress-fill', row),
            download: $('.btn-download', row),
        };

        tool.files.push(item);
        tool.refs.list.appendChild(row);
        renderFile(item);
    }

    function removeFile(tool, item) {
        if (item.xhr) {
            item.removed = true;
            item.xhr.abort();
        }
        stopPolling(item);
        if (item.jobId) {
            fetch(`/api/jobs/${item.jobId}`, { method: 'DELETE' }).catch(() => {});
        }
        item.el.row.remove();
        tool.files = tool.files.filter((f) => f !== item);
        if (item.status === 'uploading') {
            tool.uploading = false;
            pump(tool);
        }
        if (tool.files.length === 0) {
            resetTool(tool);
        }
        updateTool(tool);
    }

    function resetTool(tool) {
        tool.files.forEach((item) => {
            if (item.xhr) {
                item.removed = true;
                item.xhr.abort();
            }
            stopPolling(item);
        });
        tool.files = [];
        tool.uploading = false;
        tool.category = null;
        tool.refs.list.innerHTML = '';
        tool.refs.options.innerHTML = '';
        updateTool(tool);
    }

    const ACTIVE_STATUSES = ['waiting', 'uploading', 'queued', 'processing'];

    function updateTool(tool) {
        const { refs, files, config } = tool;
        const hasFiles = files.length > 0;

        refs.list.classList.toggle('hidden', !hasFiles);
        refs.options.classList.toggle('hidden', !hasFiles || !refs.options.children.length);
        refs.action.classList.toggle('hidden', !hasFiles);
        if (!hasFiles) return;

        const active = files.filter((f) => ACTIVE_STATUSES.includes(f.status)).length;
        const ready = files.filter((f) => f.status === 'ready').length;
        const finished = files.filter((f) => f.status === 'done' || f.status === 'error').length;

        refs.action.classList.remove('btn-muted');
        refs.action.classList.add('btn-accent');

        if (active > 0) {
            const total = active + finished;
            refs.action.disabled = true;
            refs.action.textContent = total > 1
                ? `${config.progressVerb}… ${finished}/${total}`
                : `${config.progressVerb}…`;
        } else if (ready > 0) {
            refs.action.disabled = false;
            refs.action.textContent = `${config.verb} ${ready} ${ready === 1 ? 'file' : 'files'}`;
        } else {
            refs.action.disabled = false;
            refs.action.textContent = 'Start over';
            refs.action.classList.remove('btn-accent');
            refs.action.classList.add('btn-muted');
        }
    }

    function handleAction(tool) {
        const hasReady = tool.files.some((f) => f.status === 'ready');
        if (!hasReady) {
            resetTool(tool);
            return;
        }

        const { operation, params } = gatherParams(tool);
        const supported = formatsFor(operation).input || [];

        tool.files.forEach((item) => {
            if (item.status !== 'ready') return;
            item.operation = operation;
            item.params = params;
            if (supported.length && !supported.includes(item.ext)) {
                item.status = 'error';
                item.error = `.${item.ext} is not supported for this option`;
            } else {
                item.status = 'waiting';
            }
            renderFile(item);
        });

        updateTool(tool);
        pump(tool);
    }

    // Upload one file at a time; processing on the server runs in parallel.
    function pump(tool) {
        if (tool.uploading) return;
        const next = tool.files.find((f) => f.status === 'waiting');
        if (!next) {
            updateTool(tool);
            return;
        }
        upload(tool, next);
    }

    function upload(tool, item) {
        tool.uploading = true;
        item.status = 'uploading';
        item.progress = 0;
        renderFile(item);
        updateTool(tool);

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
            updateTool(tool);
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
                    startPolling(tool, item);
                } catch (e) {
                    setError(item, 'Invalid response from server.');
                }
            } else {
                let message = `Upload failed (HTTP ${xhr.status})`;
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

    function startPolling(tool, item) {
        stopPolling(item);
        item.pollTimer = setInterval(() => pollJob(tool, item), POLL_INTERVAL);
    }

    function stopPolling(item) {
        if (item.pollTimer) {
            clearInterval(item.pollTimer);
            item.pollTimer = null;
        }
    }

    async function pollJob(tool, item) {
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
            updateTool(tool);
        } catch (e) {
        } finally {
            item.polling = false;
        }
    }

    function setError(item, message) {
        item.status = 'error';
        item.error = message;
    }

    function renderFile(item) {
        const { row, meta, progress, fill, download } = item.el;
        const size = formatBytes(item.file.size);

        row.classList.toggle('is-error', item.status === 'error');
        download.classList.toggle('hidden', item.status !== 'done');
        progress.classList.toggle('hidden', !['uploading', 'queued', 'processing'].includes(item.status));
        fill.classList.toggle('indeterminate', item.status === 'queued' || item.status === 'processing');
        fill.style.width = item.status === 'uploading' ? item.progress + '%' : '';

        switch (item.status) {
            case 'ready':
                meta.textContent = size;
                break;
            case 'waiting':
                meta.textContent = `${size} · Waiting…`;
                break;
            case 'uploading':
                meta.textContent = `${size} · Uploading ${item.progress}%`;
                break;
            case 'queued':
                meta.textContent = `${size} · In queue…`;
                break;
            case 'processing':
                meta.textContent = `${size} · Processing…`;
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

    /* ---------- Options ---------- */

    function buildOptions(tool) {
        const operation = tool.config.ops[tool.category];
        const formats = formatsFor(operation);
        let html = '';

        if (tool.mode === 'convert') {
            const outputs = Array.isArray(formats.output) ? formats.output : [];
            let optionsHtml = outputs.map((f) => `<option value="${f}">${f.toUpperCase()}</option>`).join('');
            if (tool.category === 'image') {
                const bg = formatsFor('image_remove_bg');
                const bgOutputs = Array.isArray(bg.output) ? bg.output : ['png', 'webp'];
                optionsHtml += `<optgroup label="Remove background">${bgOutputs
                    .map((f) => `<option value="bg:${f}">${f.toUpperCase()} · transparent</option>`).join('')}</optgroup>`;
            }
            html += selectRow('Convert to', 'output-format', optionsHtml);
        } else {
            switch (tool.category) {
                case 'image':
                    html += rangeRow('Quality', 'quality', 80);
                    html += switchRow('Lossless', 'lossless');
                    break;
                case 'audio':
                    html += rangeRow('Quality', 'quality', 70);
                    html += switchRow('Lossless', 'lossless');
                    break;
                case 'video': {
                    const outputs = Array.isArray(formats.output) ? formats.output : [];
                    html += selectRow('Format', 'output-format', '<option value="">Keep original</option>' +
                        outputs.map((f) => `<option value="${f}">${f.toUpperCase()}</option>`).join(''));
                    html += rangeRow('Quality', 'quality', 65);
                    break;
                }
                case 'pdf':
                    html += selectRow('Image DPI', 'image-dpi', [
                        ['72', '72 · Smallest'],
                        ['150', '150 · Balanced'],
                        ['300', '300 · High quality'],
                        ['600', '600 · Maximum'],
                    ].map(([v, l]) => `<option value="${v}"${v === '150' ? ' selected' : ''}>${l}</option>`).join(''));
                    html += rangeRow('Image quality', 'image-quality', 75);
                    break;
            }
        }

        const opts = tool.refs.options;
        opts.innerHTML = html;

        $$('.option-range', opts).forEach((range) => {
            const value = $(`[data-value-for="${range.dataset.opt}"]`, opts);
            const sync = () => {
                value.textContent = range.value;
                range.style.setProperty('--fill', ((range.value - range.min) / (range.max - range.min) * 100) + '%');
            };
            range.addEventListener('input', sync);
            sync();
        });

        const lossless = $('[data-opt="lossless"]', opts);
        const quality = $('[data-opt="quality"]', opts);
        if (lossless && quality) {
            lossless.addEventListener('change', () => {
                quality.disabled = lossless.checked;
            });
        }
    }

    function optId(name) {
        return `opt-${name}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function selectRow(label, name, optionsHtml) {
        const id = optId(name);
        return `
            <div class="option-row">
                <label class="option-label" for="${id}">${label}</label>
                <select class="option-select" id="${id}" data-opt="${name}">${optionsHtml}</select>
            </div>`;
    }

    function rangeRow(label, name, value) {
        const id = optId(name);
        return `
            <div class="option-row">
                <label class="option-label" for="${id}">${label}</label>
                <div class="option-range-wrap">
                    <input type="range" class="option-range" id="${id}" data-opt="${name}" min="1" max="100" value="${value}">
                    <span class="option-range-value" data-value-for="${name}">${value}</span>
                </div>
            </div>`;
    }

    function switchRow(label, name) {
        const id = optId(name);
        return `
            <label class="option-row switch-row" for="${id}">
                <span class="switch-label">${label}</span>
                <input type="checkbox" class="switch" id="${id}" data-opt="${name}">
            </label>`;
    }

    function gatherParams(tool) {
        const opts = tool.refs.options;
        const get = (name) => $(`[data-opt="${name}"]`, opts);
        let operation = tool.config.ops[tool.category];
        const params = {};

        const format = get('output-format');
        if (format && format.value) {
            if (format.value.startsWith('bg:')) {
                operation = 'image_remove_bg';
                params.output_format = format.value.slice(3);
            } else {
                params.output_format = format.value;
            }
        }

        if (tool.mode === 'convert' && operation === 'video_compress') {
            params.quality = VIDEO_CONVERT_QUALITY;
        }

        const quality = get('quality');
        if (quality) params.quality = parseInt(quality.value, 10);

        const lossless = get('lossless');
        if (lossless) params.lossless = lossless.checked;

        const dpi = get('image-dpi');
        if (dpi) params.image_dpi = parseInt(dpi.value, 10);

        const imgQuality = get('image-quality');
        if (imgQuality) params.image_quality = parseInt(imgQuality.value, 10);

        return { operation, params };
    }

    /* ---------- Helpers ---------- */

    function showAlert(message, title = 'Info') {
        $('#alert-title').textContent = title;
        $('#alert-text').textContent = message;
        $('#alert-modal').classList.remove('hidden');
    }

    function formatBytes(bytes) {
        if (bytes === 0 || bytes == null) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.min(Math.floor(Math.log(bytes) / Math.log(k)), sizes.length - 1);
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function getExtension(filename) {
        return (filename || '').split('.').pop().toLowerCase();
    }

    /* ---------- Create: QR codes ---------- */

    function switchQrType() {
        const type = dom.qrType.value;

        $('#qr-url-fields').classList.toggle('hidden', type !== 'url');
        $('#qr-text-fields').classList.toggle('hidden', type !== 'text');
        $('#qr-location-fields').classList.toggle('hidden', type !== 'location');
        $('#qr-wifi-fields').classList.toggle('hidden', type !== 'wifi');

        generateQrCode();
    }

    function generateQrCode() {
        const type = dom.qrType.value;
        let data = '';

        switch (type) {
            case 'url':
                data = dom.qrUrlInput.value.trim();
                break;
            case 'text':
                data = dom.qrTextInput.value.trim();
                break;
            case 'location': {
                const lat = dom.qrLatitudeInput.value.trim();
                const lng = dom.qrLongitudeInput.value.trim();
                if (lat && lng) {
                    data = `geo:${lat},${lng}`;
                }
                break;
            }
            case 'wifi': {
                const ssid = dom.qrWifiSsid.value.trim();
                const password = dom.qrWifiPassword.value.trim();
                const hidden = dom.qrWifiHidden.checked ? 'true' : 'false';
                if (ssid) {
                    // WiFi QR code format: WIFI:T:WPA;S:SSID;P:PASSWORD;H:HIDDEN;;
                    data = `WIFI:T:WPA;S:${escapeWifiString(ssid)};P:${password ? escapeWifiString(password) : ''};H:${hidden};;`;
                }
                break;
            }
        }

        dom.qrResultCanvas.innerHTML = '';

        if (!data) {
            dom.qrOutputSection.classList.add('hidden');
            state.qrCodeData = null;
            return;
        }

        try {
            new QRCode(dom.qrResultCanvas, {
                text: data,
                width: 180,
                height: 180,
                colorDark: '#ffffff',
                colorLight: '#18181b',
                correctLevel: QRCode.CorrectLevel.H
            });
            dom.qrOutputSection.classList.remove('hidden');
            state.qrCodeData = data;
        } catch (e) {
            console.error('Failed to generate QR code:', e);
            dom.qrOutputSection.classList.add('hidden');
        }
    }

    function escapeWifiString(str) {
        return str.replace(/([\\";:,])/g, '\\$1');
    }

    let locationSearchTimer;
    function debounceLocationSearch() {
        clearTimeout(locationSearchTimer);
        const query = dom.qrLocationSearch.value.trim();

        if (!query) {
            dom.qrSearchResults.classList.add('hidden');
            return;
        }

        locationSearchTimer = setTimeout(() => searchLocation(query), 300);
    }

    function showSearchMessage(text) {
        const item = document.createElement('div');
        item.className = 'search-result-item';
        item.textContent = text;
        dom.qrSearchResults.replaceChildren(item);
        dom.qrSearchResults.classList.remove('hidden');
    }

    async function searchLocation(query) {
        try {
            const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=8`;
            const response = await fetch(url, { headers: { 'Accept': 'application/json' } });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);

            const results = await response.json();
            if (results.length === 0) {
                showSearchMessage('No places found');
                return;
            }

            dom.qrSearchResults.replaceChildren(...results.map((result) => {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'search-result-item';
                item.textContent = result.display_name;
                item.addEventListener('click', () => selectLocationResult(result));
                return item;
            }));
            dom.qrSearchResults.classList.remove('hidden');
        } catch (e) {
            console.error('Location search error:', e);
            showSearchMessage(`Error: ${e.message}`);
        }
    }

    function selectLocationResult(result) {
        dom.qrLatitudeInput.value = result.lat;
        dom.qrLongitudeInput.value = result.lon;
        dom.qrLocationSearch.value = result.display_name;
        dom.qrSearchResults.classList.add('hidden');
        generateQrCode();
    }

    function downloadQrCode() {
        const canvas = dom.qrResultCanvas.querySelector('canvas');
        if (!canvas) return;

        const link = document.createElement('a');
        link.href = canvas.toDataURL('image/png');
        link.download = 'qr-code.png';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
