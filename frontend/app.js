(function () {
    'use strict';

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => root.querySelectorAll(sel);

    const state = {
        activeTab: 'convert',
        formats: null,
        tools: {},
        qrType: null,
        qrCodeData: null,
    };

    const POLL_INTERVAL = 2000;
    // Video "conversion" runs through the video_compress operation, so keep quality high.
    const VIDEO_CONVERT_QUALITY = 85;
    const DEFAULT_COMPRESS_QUALITY = 75;

    const ICON_DOWNLOAD = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11.25V2.25M12.75 7.5L9 11.25L5.25 7.5M15.75 11.25V14.25C15.75 14.6478 15.592 15.0294 15.3107 15.3107C15.0294 15.592 14.6478 15.75 14.25 15.75H3.75C3.35218 15.75 2.97064 15.592 2.68934 15.3107C2.40804 15.0294 2.25 14.6478 2.25 14.25V11.25"/></svg>';
    const ICON_X = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 4.5L4.5 13.5M4.5 4.5L13.5 13.5"/></svg>';
    const ICON_CHEVRONS = '<svg class="picker-chevron" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 15L12 20L17 15M7 9L12 4L17 9"/></svg>';
    const ICON_CHECK = '<svg class="picker-check" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17L4 12"/></svg>';

    const FORMAT_ALIASES = { jpg: 'jpeg', tif: 'tiff' };

    const CATEGORY_LABELS = { image: 'images', audio: 'audio files', video: 'videos', pdf: 'PDFs' };

    // Formats used to detect a file's category from its extension.
    const CATEGORY_SOURCE = {
        image: 'image_convert',
        audio: 'audio_convert',
        video: 'video_compress',
        pdf: 'pdf_compress',
    };

    const COMPRESS_OPS = {
        image: 'image_compress',
        audio: 'audio_compress',
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
        createQrTypePicker();
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

    function listOf(value) {
        return Array.isArray(value) ? value : [];
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

    /* ---------- Picker (custom dropdown) ---------- */

    // groups: [{ label?, items: [{ value, label, display? }] }]. Grid groups render as format chips.
    function createPicker({ groups, value, grid = false, labelledBy, onChange }) {
        const root = document.createElement('div');
        root.className = 'picker';

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'picker-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        if (labelledBy) trigger.setAttribute('aria-labelledby', labelledBy);
        trigger.innerHTML = `<span class="picker-value"></span><span class="picker-hint"></span>${ICON_CHEVRONS}`;

        const menu = document.createElement('div');
        menu.className = 'picker-menu' + (grid ? ' is-grid' : '');
        menu.setAttribute('role', 'listbox');
        menu.hidden = true;

        const items = [];
        groups.forEach((group) => {
            const section = document.createElement('div');
            section.className = 'picker-group';
            if (group.label) {
                const heading = document.createElement('div');
                heading.className = 'picker-group-label';
                heading.textContent = group.label;
                section.appendChild(heading);
            }
            const list = document.createElement('div');
            list.className = 'picker-options';
            group.items.forEach((item) => {
                const option = document.createElement('button');
                option.type = 'button';
                option.className = 'picker-option';
                option.setAttribute('role', 'option');
                option.tabIndex = -1;
                option.innerHTML = `<span class="picker-option-label"></span>${ICON_CHECK}`;
                option.querySelector('.picker-option-label').textContent = item.label;
                option.addEventListener('click', () => {
                    select(item.value, true);
                    close(true);
                });
                list.appendChild(option);
                items.push({ ...item, group: group.label || '', el: option });
            });
            section.appendChild(list);
            menu.appendChild(section);
        });

        root.append(trigger, menu);

        let current = null;

        function select(val, notify) {
            const item = items.find((i) => i.value === val) || items[0];
            current = item;
            items.forEach((i) => {
                const selected = i === item;
                i.el.classList.toggle('selected', selected);
                i.el.setAttribute('aria-selected', selected);
            });
            trigger.querySelector('.picker-value').textContent = item.display || item.label;
            trigger.querySelector('.picker-hint').textContent = grid ? item.group : '';
            if (notify && onChange) onChange(item.value);
        }

        function open() {
            if (!menu.hidden) return;
            menu.hidden = false;
            root.classList.add('open');
            trigger.setAttribute('aria-expanded', 'true');
            current.el.focus({ preventScroll: true });
            current.el.scrollIntoView({ block: 'nearest' });
            document.addEventListener('pointerdown', onOutside, true);
        }

        function close(focusTrigger) {
            if (menu.hidden) return;
            menu.hidden = true;
            root.classList.remove('open');
            trigger.setAttribute('aria-expanded', 'false');
            document.removeEventListener('pointerdown', onOutside, true);
            if (focusTrigger) trigger.focus();
        }

        function onOutside(e) {
            if (!root.contains(e.target)) close(false);
        }

        function move(delta) {
            const idx = items.findIndex((i) => i.el === document.activeElement);
            const next = Math.max(0, Math.min(items.length - 1, (idx < 0 ? 0 : idx) + delta));
            items[next].el.focus();
        }

        trigger.addEventListener('click', () => (menu.hidden ? open() : close(true)));
        trigger.addEventListener('keydown', (e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                open();
            }
        });
        menu.addEventListener('keydown', (e) => {
            switch (e.key) {
                case 'ArrowDown': e.preventDefault(); move(grid ? 4 : 1); break;
                case 'ArrowUp': e.preventDefault(); move(grid ? -4 : -1); break;
                case 'ArrowRight': e.preventDefault(); move(1); break;
                case 'ArrowLeft': e.preventDefault(); move(-1); break;
                case 'Home': e.preventDefault(); items[0].el.focus(); break;
                case 'End': e.preventDefault(); items[items.length - 1].el.focus(); break;
                case 'Escape': e.preventDefault(); close(true); break;
                case 'Tab': close(false); break;
            }
        });

        select(value, false);

        return {
            el: root,
            get value() { return current.value; },
        };
    }

    /* ---------- Settings persistence ---------- */

    function loadSetting(key, fallback) {
        try {
            const v = localStorage.getItem('ilc.' + key);
            return v == null ? fallback : v;
        } catch (e) {
            return fallback;
        }
    }

    function saveSetting(key, value) {
        try {
            localStorage.setItem('ilc.' + key, value);
        } catch (e) {
        }
    }

    /* ---------- File tools (Convert / Compress) ---------- */

    function createFileTool(mode, panel) {
        panel.appendChild($('#tpl-file-tool').content.cloneNode(true));

        const refs = {};
        $$('[data-ref]', panel).forEach((el) => { refs[el.dataset.ref] = el; });

        const tool = {
            mode,
            refs,
            files: [],
            uploading: false,
            nextId: 1,
        };

        if (mode === 'convert') {
            buildConvertOptions(tool);
        } else {
            buildCompressOptions(tool);
        }

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

        return tool;
    }

    function setAccepted(tool, exts, description) {
        tool.inputExts = exts;
        tool.refs.formats.textContent = description;
        tool.refs.formats.title = exts.map((f) => '.' + f).join(', ');
        tool.refs.input.setAttribute('accept', exts.map((f) => MIME_MAP[f] || '.' + f)
            .concat(exts.map((f) => '.' + f)).join(','));
    }

    function buildConvertOptions(tool) {
        const groups = [
            { label: 'Image', op: 'image_convert' },
            { label: 'Remove background', op: 'image_remove_bg', suffix: ' · transparent' },
            { label: 'Audio', op: 'audio_convert' },
            { label: 'Video', op: 'video_compress' },
        ].map((g) => ({
            label: g.label,
            items: listOf(formatsFor(g.op).output).map((f) => ({
                value: `${g.op}:${f}`,
                label: f.toUpperCase(),
                display: f.toUpperCase() + (g.suffix || ''),
            })),
        })).filter((g) => g.items.length);

        const row = document.createElement('div');
        row.className = 'option-row';
        row.innerHTML = '<span class="option-label" id="convert-to-label">Convert to</span>';

        const picker = createPicker({
            groups,
            grid: true,
            value: loadSetting('convertTarget', 'image_convert:jpeg'),
            labelledBy: 'convert-to-label',
            onChange: (value) => {
                saveSetting('convertTarget', value);
                updateConvertAccepted(tool);
            },
        });
        row.appendChild(picker.el);
        tool.refs.options.appendChild(row);
        tool.picker = picker;
        updateConvertAccepted(tool);
    }

    function convertTarget(tool) {
        const [operation, format] = tool.picker.value.split(':');
        return { operation, format };
    }

    function updateConvertAccepted(tool) {
        const { operation } = convertTarget(tool);
        const exts = listOf(formatsFor(operation).input);
        const names = [...new Set(exts.map((f) => (FORMAT_ALIASES[f] || f).toUpperCase()))];
        setAccepted(tool, exts, 'Accepts ' + names.join(', '));
    }

    function buildCompressOptions(tool) {
        const initial = parseInt(loadSetting('compressQuality', DEFAULT_COMPRESS_QUALITY), 10) || DEFAULT_COMPRESS_QUALITY;
        const row = document.createElement('div');
        row.className = 'option-row';
        row.innerHTML = `
            <label class="option-label" for="compress-quality">Quality</label>
            <div class="option-range-wrap">
                <span class="option-range-hint">Smaller</span>
                <input type="range" class="option-range" id="compress-quality" min="1" max="100" value="${initial}">
                <span class="option-range-hint">Better</span>
                <span class="option-range-value"></span>
            </div>`;
        const range = $('.option-range', row);
        const value = $('.option-range-value', row);
        const sync = () => {
            value.textContent = range.value;
            range.style.setProperty('--fill', ((range.value - range.min) / (range.max - range.min) * 100) + '%');
        };
        range.addEventListener('input', sync);
        range.addEventListener('change', () => saveSetting('compressQuality', range.value));
        sync();

        tool.refs.options.appendChild(row);
        tool.qualityInput = range;

        const exts = [];
        Object.values(CATEGORY_SOURCE).forEach((op) => {
            listOf(formatsFor(op).input).forEach((ext) => {
                if (!exts.includes(ext)) exts.push(ext);
            });
        });
        setAccepted(tool, exts, 'Images, audio, video and PDFs');
    }

    function categoryOf(ext) {
        return Object.keys(CATEGORY_SOURCE).find((cat) =>
            listOf(formatsFor(CATEGORY_SOURCE[cat]).input).includes(ext)) || null;
    }

    // Resolves the job for a file from the tool's current settings, or returns { error }.
    function jobFor(tool, ext) {
        if (tool.mode === 'convert') {
            const { operation, format } = convertTarget(tool);
            if (!listOf(formatsFor(operation).input).includes(ext)) {
                const category = categoryOf(ext);
                const hint = category ? ` Pick a matching format in “Convert to” for ${CATEGORY_LABELS[category]}.` : '';
                return { error: `.${ext} can't be converted to ${tool.picker.el.querySelector('.picker-value').textContent}.${hint}` };
            }
            const params = { output_format: format };
            if (operation === 'video_compress') params.quality = VIDEO_CONVERT_QUALITY;
            return { operation, params };
        }

        const category = categoryOf(ext);
        const operation = category && COMPRESS_OPS[category];
        if (!operation || !listOf(formatsFor(operation).input).includes(ext)) {
            return { error: `.${ext} files can't be compressed.` };
        }
        const quality = parseInt(tool.qualityInput.value, 10);
        const params = operation === 'pdf_compress' ? { image_quality: quality } : { quality };
        return { operation, params };
    }

    // Dropped files are processed right away with the settings selected at that moment.
    function addFiles(tool, fileList) {
        const rejected = [];

        Array.from(fileList).forEach((file) => {
            const ext = getExtension(file.name);
            const job = jobFor(tool, ext);
            if (job.error) {
                rejected.push(`${file.name}: ${job.error}`);
                return;
            }
            addFileRow(tool, file, ext, job);
        });

        if (rejected.length) {
            showAlert(rejected.join('\n\n'), rejected.length === 1 ? 'File skipped' : 'Files skipped');
        }

        updateList(tool);
        pump(tool);
    }

    function addFileRow(tool, file, ext, job) {
        const item = {
            id: tool.nextId++,
            file,
            ext,
            operation: job.operation,
            params: job.params,
            status: 'waiting',
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
            </div>
            <div class="file-actions">
                <a class="btn-chip btn-download is-disabled" aria-disabled="true"><span class="btn-chip-text">Download</span>${ICON_DOWNLOAD}</a>
                <button type="button" class="btn-chip btn-square" aria-label="Remove file" title="Remove">${ICON_X}</button>
            </div>`;
        $('.file-name', row).textContent = file.name;
        $('.file-name', row).title = file.name;
        $('.btn-square', row).addEventListener('click', () => removeFile(tool, item));

        item.el = {
            row,
            meta: $('.file-meta', row),
            download: $('.btn-download', row),
        };

        tool.files.push(item);
        tool.refs.list.appendChild(row);
        renderFile(item);
    }

    function removeFile(tool, item) {
        const wasUploading = item.status === 'uploading';
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
        if (wasUploading) {
            tool.uploading = false;
            pump(tool);
        }
        updateList(tool);
    }

    function updateList(tool) {
        tool.refs.list.classList.toggle('hidden', tool.files.length === 0);
    }

    // Upload one file at a time; processing on the server runs in parallel.
    function pump(tool) {
        if (tool.uploading) return;
        const next = tool.files.find((f) => f.status === 'waiting');
        if (next) upload(tool, next);
    }

    function upload(tool, item) {
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

    function startPolling(item) {
        stopPolling(item);
        item.pollTimer = setInterval(() => pollJob(item), POLL_INTERVAL);
    }

    function stopPolling(item) {
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

    function setError(item, message) {
        item.status = 'error';
        item.error = message;
    }

    function renderFile(item) {
        const { row, meta, download } = item.el;
        const size = formatBytes(item.file.size);
        const busy = ['waiting', 'uploading', 'queued', 'processing'].includes(item.status);

        row.classList.toggle('is-error', item.status === 'error');
        row.classList.toggle('is-uploading', item.status === 'waiting' || item.status === 'uploading');
        row.classList.toggle('is-processing', item.status === 'queued' || item.status === 'processing');
        row.classList.toggle('is-done', item.status === 'done');
        row.style.setProperty('--progress', item.status === 'uploading' ? item.progress : 0);
        row.setAttribute('aria-busy', busy);

        download.classList.toggle('hidden', item.status === 'error');
        download.classList.toggle('is-disabled', item.status !== 'done');
        download.setAttribute('aria-disabled', item.status !== 'done');

        switch (item.status) {
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

    function createQrTypePicker() {
        state.qrType = createPicker({
            groups: [{
                items: [
                    { value: 'url', label: 'URL', display: 'QR Code · URL' },
                    { value: 'text', label: 'Text', display: 'QR Code · Text' },
                    { value: 'location', label: 'Location', display: 'QR Code · Location' },
                    { value: 'wifi', label: 'WiFi', display: 'QR Code · WiFi' },
                ],
                label: 'QR Code',
            }],
            value: 'url',
            labelledBy: 'qr-type-label',
            onChange: switchQrType,
        });
        $('#qr-type-picker').replaceWith(state.qrType.el);
    }

    function switchQrType() {
        const type = state.qrType.value;

        $('#qr-url-fields').classList.toggle('hidden', type !== 'url');
        $('#qr-text-fields').classList.toggle('hidden', type !== 'text');
        $('#qr-location-fields').classList.toggle('hidden', type !== 'location');
        $('#qr-wifi-fields').classList.toggle('hidden', type !== 'wifi');

        generateQrCode();
    }

    function generateQrCode() {
        const type = state.qrType.value;
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
