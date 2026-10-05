(function () {
    'use strict';

    const $ = (sel, root = document) => root.querySelector(sel);
    const $$ = (sel, root = document) => root.querySelectorAll(sel);

    const state = {
        activeTab: 'convert',
        mode: 'local',
        formats: null,
        tools: {},
        qrType: null,
        qrCodeData: null,
    };

    const POLL_INTERVAL = 2000;
    // Video "conversion" runs through the video_compress operation, so keep quality high.
    const VIDEO_CONVERT_QUALITY = 85;

    const ICON_DOWNLOAD = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11.25V2.25M12.75 7.5L9 11.25L5.25 7.5M15.75 11.25V14.25C15.75 14.6478 15.592 15.0294 15.3107 15.3107C15.0294 15.592 14.6478 15.75 14.25 15.75H3.75C3.35218 15.75 2.97064 15.592 2.68934 15.3107C2.40804 15.0294 2.25 14.6478 2.25 14.25V11.25"/></svg>';
    const ICON_X = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M13.5 4.5L4.5 13.5M4.5 4.5L13.5 13.5"/></svg>';
    const ICON_CHEVRONS = '<svg class="picker-chevron" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 15L12 20L17 15M7 9L12 4L17 9"/></svg>';
    const ICON_CHECK = '<svg class="picker-check" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17L4 12"/></svg>';

    const FORMAT_ALIASES = { jpg: 'jpeg', tif: 'tiff' };

    const CATEGORIES = ['image', 'audio', 'video', 'pdf'];
    const CATEGORY_LABELS = { image: 'images', audio: 'audio files', video: 'videos', pdf: 'PDFs' };
    const CATEGORY_TITLES = { image: 'Images', audio: 'Audio', video: 'Video', pdf: 'PDF' };

    // Formats used to detect a file's category from its extension.
    const CATEGORY_SOURCE = {
        image: 'image_convert',
        audio: 'audio_convert',
        video: 'video_compress',
        pdf: 'pdf_compress',
    };

    const CONVERT_OPS = { image: 'image_convert', audio: 'audio_convert', video: 'video_compress' };
    const COMPRESS_OPS = { image: 'image_compress', audio: 'audio_compress', video: 'video_compress', pdf: 'pdf_compress' };

    const DEFAULTS = {
        target: { image: 'image_convert:jpeg', audio: 'audio_convert:mp3', video: 'video_compress:mp4' },
        quality: { image: 80, audio: 70, video: 65, pdf: 75 },
    };

    // Formats where the backend's lossless flag actually changes the encoding.
    const LOSSLESS_FORMATS = {
        image: ['png', 'webp', 'avif', 'tiff', 'tif'],
        audio: ['flac', 'wav', 'aiff'],
    };

    // What local mode can do on-device. Anything else is offered as an online upload instead.
    const LOCAL_IMAGE_OUTPUTS = ['jpeg', 'png', 'webp', 'bmp', 'tiff', 'pdf'];
    const LOCAL_IMAGE_COMPRESS = ['jpeg', 'jpg', 'png', 'webp'];
    const LOCAL_AUDIO_INPUTS = ['mp3', 'wav', 'flac', 'ogg', 'opus', 'aac', 'm4a'];
    const LOCAL_AUDIO_OUTPUTS = ['wav', 'aiff'];
    const LOCAL_CATEGORIES = { convert: ['image', 'audio'], compress: ['image'] };

    const ICON_CLOUD = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9z"/></svg>';

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
        document.documentElement.classList.add('no-indicator-motion');
        migrateConsentCookie();
        await loadFormats();
        if (!ILCLocal.supportsWebp) LOCAL_IMAGE_OUTPUTS.splice(LOCAL_IMAGE_OUTPUTS.indexOf('webp'), 1);
        state.mode = loadSetting('mode', 'local') === 'online' && hasConsent() ? 'online' : 'local';
        state.tools.convert = createFileTool('convert', $('#panel-convert'));
        state.tools.compress = createFileTool('compress', $('#panel-compress'));
        setMode(state.mode);
        createQrTypePicker();
        bindEvents();
        switchQrType();
        setupIndicators();
        setTimeout(() => document.documentElement.classList.remove('page-enter'), 900);
    }

    /* ---------- Terms acceptance ---------- */

    // Only online mode sends files anywhere, so acceptance is asked for when switching to it.
    // The flag lives in localStorage on this device and is never sent to the server.
    let consentGiven = false;
    let consentRequest = null;

    function hasConsent() {
        return consentGiven || loadSetting('tosAccepted', '') === 'true';
    }

    // Earlier versions kept the acceptance in a cookie; carry it over and delete the cookie.
    function migrateConsentCookie() {
        const cookies = document.cookie.split('; ');
        if (cookies.includes('tos_and_policy_accepted=true')) saveSetting('tosAccepted', 'true');
        if (cookies.some((c) => c.startsWith('tos_and_policy_accepted='))) {
            document.cookie = 'tos_and_policy_accepted=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax';
        }
    }

    function requireConsent(onAccept, onDecline) {
        if (hasConsent()) {
            onAccept();
            return;
        }
        consentRequest = { onAccept, onDecline };
        $('#consent-modal').classList.remove('hidden');
        $('#btn-accept').focus();
    }

    function answerConsent(accepted) {
        const request = consentRequest;
        consentRequest = null;
        $('#consent-modal').classList.add('hidden');
        if (accepted) {
            consentGiven = true;
            saveSetting('tosAccepted', 'true');
        }
        const callback = request && (accepted ? request.onAccept : request.onDecline);
        if (callback) callback();
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
                if (btn.dataset.mode === 'online') {
                    requireConsent(() => setMode('online', { persist: true }));
                } else {
                    setMode('local', { persist: true });
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

        $('#btn-accept').addEventListener('click', () => answerConsent(true));
        $('#btn-decline').addEventListener('click', () => answerConsent(false));
        $('#consent-modal').addEventListener('keydown', (e) => {
            if (e.key === 'Escape') answerConsent(false);
        });
    }

    // Each tab keeps its own panel and state, so switching never interrupts running jobs.
    function switchTab(tab) {
        if (tab === state.activeTab) return;
        const order = [...dom.tabs()].map((el) => el.dataset.tool);
        const forward = order.indexOf(tab) > order.indexOf(state.activeTab);
        state.activeTab = tab;

        dom.tabs().forEach((el) => {
            const isActive = el.dataset.tool === tab;
            el.classList.toggle('active', isActive);
            el.setAttribute('aria-selected', isActive);
        });
        dom.panels().forEach((panel) => {
            const isActive = panel.dataset.panel === tab;
            panel.classList.toggle('hidden', !isActive);
            if (isActive) pulse(panel, forward ? 'enter-from-right' : 'enter-from-left');
        });
        positionIndicator($('.tool-tabs'), $('.tab.active'), $('.tab-indicator'));
    }

    /* ---------- Motion helpers ---------- */

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    // Restarts a one-shot CSS animation class. Ignores animations bubbling up from children.
    function pulse(el, className) {
        el.classList.remove(className);
        void el.offsetWidth;
        el.classList.add(className);
        const done = (e) => {
            if (e.target !== el) return;
            el.classList.remove(className);
            el.removeEventListener('animationend', done);
        };
        el.addEventListener('animationend', done);
    }

    function positionIndicator(container, active, indicator) {
        if (!active || !indicator) return;
        indicator.style.width = active.offsetWidth + 'px';
        indicator.style.height = active.offsetHeight + 'px';
        indicator.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
        container.classList.add('has-indicator');
    }

    // Sliding pills behind the active tab and the active mode; placed without animation first.
    function setupIndicators() {
        const place = () => {
            positionIndicator($('.tool-tabs'), $('.tab.active'), $('.tab-indicator'));
            positionIndicator($('.mode-toggle'), $('.mode-btn.active'), $('.mode-indicator'));
        };
        place();
        requestAnimationFrame(() => requestAnimationFrame(() => {
            document.documentElement.classList.remove('no-indicator-motion');
        }));
        if (document.fonts) document.fonts.ready.then(place);
        if (window.ResizeObserver) {
            new ResizeObserver(place).observe($('.tool-tabs'));
        } else {
            window.addEventListener('resize', place);
        }
    }

    // Collapses an element's height and fades it out before it is removed.
    function collapseOut(el) {
        if (reducedMotion.matches || !el.animate || !el.offsetHeight) return Promise.resolve();
        el.style.overflow = 'hidden';
        return el.animate([
            { height: el.offsetHeight + 'px', opacity: 1 },
            { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px' },
        ], { duration: 240, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }).finished
            .catch(() => {})
            .then(() => { el.style.overflow = ''; });
    }

    // Spins the logo while anything is uploading or processing. It eases in, and when work
    // stops it eases out onto a whole turn, always completing at least one full rotation.
    const spinner = { angle: 0, start: 0, velocity: 0, busy: false, target: null, frame: 0, last: 0 };
    const SPIN_MAX = 540;
    const SPIN_ACCEL = 720;

    function setBusy(busy) {
        if (busy === spinner.busy) return;
        spinner.busy = busy;
        if (busy) spinner.target = null;
        if (busy && !spinner.frame && !reducedMotion.matches) {
            spinner.start = spinner.angle;
            spinner.last = performance.now();
            spinner.frame = requestAnimationFrame(spinStep);
        }
    }

    function spinStep(now) {
        const dt = Math.min(0.05, (now - spinner.last) / 1000);
        spinner.last = now;
        const brake = (spinner.velocity * spinner.velocity) / (2 * SPIN_ACCEL);

        if (!spinner.busy && spinner.target === null) {
            const minimum = spinner.start + 360;
            spinner.target = Math.max(minimum, Math.ceil((spinner.angle + brake) / 360) * 360);
        }

        const remaining = spinner.target === null ? Infinity : spinner.target - spinner.angle;
        if (remaining <= brake) {
            spinner.velocity = Math.max(0, spinner.velocity - (spinner.velocity * spinner.velocity) / (2 * Math.max(remaining, 0.001)) * dt);
        } else {
            spinner.velocity = Math.min(SPIN_MAX, spinner.velocity + SPIN_ACCEL * dt);
        }
        spinner.angle += spinner.velocity * dt;

        const logo = $('.brand-logo');
        if (spinner.target !== null && (spinner.angle >= spinner.target - 0.5 || spinner.velocity === 0)) {
            spinner.angle = 0;
            spinner.velocity = 0;
            spinner.target = null;
            spinner.frame = 0;
            logo.style.transform = '';
            return;
        }
        logo.style.transform = `rotate(${spinner.angle % 360}deg)`;
        spinner.frame = requestAnimationFrame(spinStep);
    }

    const BUSY_STATUSES = ['waiting', 'uploading', 'queued', 'processing'];

    function updateBusy() {
        setBusy(Object.values(state.tools).some((tool) =>
            tool.files.some((f) => BUSY_STATUSES.includes(f.status))));
    }

    /* ---------- Local / Online mode ---------- */

    function setMode(mode, { persist = false } = {}) {
        state.mode = mode;
        if (persist) saveSetting('mode', mode);

        $$('.mode-btn').forEach((btn) => {
            const active = btn.dataset.mode === mode;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-pressed', active);
        });
        document.documentElement.dataset.mode = mode;

        positionIndicator($('.mode-toggle'), $('.mode-btn.active'), $('.mode-indicator'));

        // Rebuild settings so on-device / online markers match the new mode.
        Object.values(state.tools).forEach((tool) => {
            tool.setupSignature = null;
            refresh(tool);
        });
    }

    /* ---------- Picker (custom dropdown) ---------- */

    // groups: [{ label?, items: [{ value, label, display?, note? }] }]. Grid groups render as format chips.
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
                option.innerHTML = `<span class="picker-option-text"><span class="picker-option-label"></span><span class="picker-option-note"></span></span>${ICON_CHECK}`;
                option.querySelector('.picker-option-label').textContent = item.label;
                option.querySelector('.picker-option-note').textContent = item.note || '';
                if (item.cloud) {
                    option.classList.add('is-cloud');
                    option.title = 'Runs online';
                }
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
            trigger.querySelector('.picker-hint').textContent = (grid ? item.group : '') + (item.cloud ? ' · online' : '');
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
            get text() { return current.display || current.label; },
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

    function loadNumber(key, fallback) {
        const v = parseInt(loadSetting(key, fallback), 10);
        return Number.isFinite(v) ? v : fallback;
    }

    /* ---------- Quality descriptions ---------- */

    // Same integer mapping the Go backend uses (internal/processor/audio.go).
    function mapRange(value, inMin, inMax, outMin, outMax) {
        if (value <= inMin) return outMin;
        if (value >= inMax) return outMax;
        return outMin + Math.trunc((value - inMin) * (outMax - outMin) / (inMax - inMin));
    }

    const QUALITY_TIERS = [
        { max: 30, name: 'Smallest' },
        { max: 55, name: 'Small' },
        { max: 75, name: 'Balanced' },
        { max: 90, name: 'High' },
        { max: 100, name: 'Maximum' },
    ];

    const TIER_DESCRIPTIONS = {
        image: [
            'Tiny files with visible artifacts. Fine for thumbnails and previews.',
            'Slight softness. Good for chat apps and email.',
            'Good-looking and compact. The sweet spot for websites.',
            'Hard to tell apart from the original.',
            'Visually identical to the original, with the least savings.',
        ],
        audio: [
            'Voice and podcasts only. Music will sound muffled.',
            'Fine for speech and casual listening.',
            'Good for music on phones and headphones.',
            'Near CD quality.',
            'Transparent quality, with the least savings.',
        ],
        video: [
            'Very small, blocky in motion. Only for previews.',
            'Watchable on small screens.',
            'Good for sharing and the web.',
            'Sharp detail, larger files.',
            'Close to the original. Slow to encode.',
        ],
    };

    const PDF_PRESETS = [
        { max: 30, name: 'Screen', desc: 'Low-resolution images for on-screen reading. Smallest files.' },
        { max: 60, name: 'Ebook', desc: 'Readable images, good for email and e-readers.' },
        { max: 85, name: 'Printer', desc: 'High-quality images suitable for printing.' },
        { max: 100, name: 'Prepress', desc: 'Best quality with minimal image compression.' },
    ];

    const QUALITY_PRESETS = {
        default: [['Small', 40], ['Balanced', 70], ['High', 85], ['Max', 95]],
        pdf: [['Screen', 25], ['Ebook', 50], ['Printer', 75], ['Prepress', 95]],
    };

    function formatDetail(category, format, q, local) {
        const name = (FORMAT_ALIASES[format] || format).toUpperCase();
        if (local && category === 'image' && LOCAL_IMAGE_COMPRESS.includes(format)) {
            if (format === 'png') {
                return q >= 96 ? 'PNG re-encoded losslessly on this device' : `PNG with up to ${ILCCodecs.pngColors(q)} colors, made on this device`;
            }
            return `${name} quality ${q}, encoded on this device`;
        }
        switch (category) {
            case 'image':
                if (format === 'png') return `PNG palette quality ${Math.max(q - 20, 0)}–${q}`;
                if (format === 'gif' || format === 'bmp') return `${name} re-encoded (quality has little effect)`;
                return `${name} quality ${q}`;
            case 'audio':
                switch (format) {
                    case 'mp3': return `MP3 ≈ ${mapRange(q, 1, 100, 32, 320)} kbps`;
                    case 'ogg': return `OGG Vorbis level ${mapRange(q, 1, 100, 0, 10)}`;
                    case 'opus': return `OPUS ≈ ${mapRange(q, 1, 100, 16, 256)} kbps`;
                    case 'aac':
                    case 'm4a': return `${name} ≈ ${mapRange(q, 1, 100, 32, 256)} kbps`;
                    case 'wma': return `WMA ≈ ${mapRange(q, 1, 100, 32, 192)} kbps`;
                    case 'flac': return `FLAC is lossless; compression level ${mapRange(q, 1, 100, 12, 0)}`;
                    default: return `${name} is uncompressed; quality has no effect`;
                }
            case 'video':
                return format === 'webm'
                    ? `WEBM (VP9) CRF ${mapRange(q, 1, 100, 50, 15)}`
                    : `${name} (H.264) CRF ${mapRange(q, 1, 100, 45, 17)}`;
            default:
                return '';
        }
    }

    function qualityInfo(category, formats, q, lossless, local) {
        if (category === 'pdf') {
            const preset = PDF_PRESETS.find((p) => q <= p.max);
            return { tier: preset.name, desc: preset.desc, detail: `Ghostscript “${preset.name.toLowerCase()}” preset, image quality ${q}` };
        }
        const idx = QUALITY_TIERS.findIndex((t) => q <= t.max);
        if (lossless) {
            return {
                tier: 'Lossless',
                desc: 'No quality loss. Savings come only from smarter compression.',
                detail: '',
            };
        }
        const details = [...new Set(formats.map((f) => formatDetail(category, f, q, local)))].filter(Boolean);
        return {
            tier: QUALITY_TIERS[idx].name,
            desc: TIER_DESCRIPTIONS[category][idx],
            detail: details.slice(0, 3).join(' · '),
        };
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
            controls: {},
        };

        const ops = mode === 'convert' ? CONVERT_OPS : COMPRESS_OPS;
        tool.categories = Object.keys(ops);
        const exts = [];
        tool.categories.forEach((cat) => {
            listOf(formatsFor(CATEGORY_SOURCE[cat]).input).forEach((ext) => {
                if (!exts.includes(ext)) exts.push(ext);
            });
        });
        tool.inputExts = exts;
        refs.formats.textContent = mode === 'convert'
            ? 'Images, audio and video'
            : 'Images, audio, video and PDFs';
        refs.formats.title = exts.map((f) => '.' + f).join(', ');
        refs.input.setAttribute('accept', exts.map((f) => MIME_MAP[f] || '.' + f)
            .concat(exts.map((f) => '.' + f)).join(','));

        refs.dropzone.addEventListener('click', () => {
            if (!tool.prompting) refs.input.click();
        });
        refs.dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            if (!tool.prompting) refs.dropzone.classList.add('drag-over');
        });
        refs.dropzone.addEventListener('dragleave', (e) => {
            if (!refs.dropzone.contains(e.relatedTarget)) {
                refs.dropzone.classList.remove('drag-over');
            }
        });
        refs.dropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            refs.dropzone.classList.remove('drag-over');
            if (!tool.prompting) addFiles(tool, e.dataTransfer.files);
        });
        refs.input.addEventListener('change', () => {
            addFiles(tool, refs.input.files);
            refs.input.value = '';
        });
        // Let pickers overflow the panel once it has finished expanding.
        refs.setup.addEventListener('transitionend', (e) => {
            if (e.target === refs.setup && refs.setup.classList.contains('open')) {
                refs.setup.classList.add('settled');
            }
        });
        refs.action.addEventListener('click', () => startPending(tool));
        refs.clear.addEventListener('click', () => clearAll(tool));
        refs.cloudConfirm.addEventListener('click', (e) => {
            e.stopPropagation();
            confirmCloud(tool);
        });
        refs.cloudCancel.addEventListener('click', (e) => {
            e.stopPropagation();
            cancelCloud(tool);
        });

        return tool;
    }

    function categoryOf(ext) {
        return CATEGORIES.find((cat) =>
            listOf(formatsFor(CATEGORY_SOURCE[cat]).input).includes(ext)) || null;
    }

    function addFiles(tool, fileList) {
        const rejected = [];

        let added = 0;
        Array.from(fileList).forEach((file) => {
            const ext = getExtension(file.name);
            const category = categoryOf(ext);
            if (!category) {
                rejected.push(`${file.name}: .${ext} files aren't supported.`);
                return;
            }
            if (!tool.categories.includes(category)) {
                rejected.push(`${file.name}: ${CATEGORY_TITLES[category]} files can only be compressed. Use the Compress tab.`);
                return;
            }
            addFileRow(tool, file, ext, category, added++);
        });

        if (rejected.length) {
            showAlert(rejected.join('\n\n'), rejected.length === 1 ? 'File skipped' : 'Files skipped');
        }

        refresh(tool);
    }

    function pendingFiles(tool) {
        return tool.files.filter((f) => f.status === 'ready');
    }

    // Shows the settings for whatever is waiting to be processed, built from those files' types.
    function refresh(tool) {
        const pending = pendingFiles(tool);
        const signature = pending.map((f) => f.category + ':' + f.ext).sort().join('|');

        if (signature !== tool.setupSignature) {
            tool.setupSignature = signature;
            if (pending.length) buildOptions(tool, pending);
        }
        tool.refs.setup.classList.toggle('open', pending.length > 0);
        if (!pending.length) tool.refs.setup.classList.remove('settled');
        setInert(tool.refs.setup, pending.length === 0);

        const verb = tool.mode === 'convert' ? 'Convert' : 'Compress';
        tool.refs.action.textContent = `${verb} ${pending.length} ${pending.length === 1 ? 'file' : 'files'}`;

        tool.refs.files.classList.toggle('hidden', tool.files.length === 0);
        tool.refs.count.textContent = `${tool.files.length} ${tool.files.length === 1 ? 'file' : 'files'}`;
        updateBusy();
    }

    function setInert(el, inert) {
        if (inert) el.setAttribute('inert', '');
        else el.removeAttribute('inert');
    }

    function buildOptions(tool, pending) {
        const opts = tool.refs.options;
        opts.innerHTML = '';
        tool.controls = {};

        const byCategory = {};
        pending.forEach((f) => {
            (byCategory[f.category] = byCategory[f.category] || []).push(f.ext);
        });
        const categories = CATEGORIES.filter((c) => byCategory[c]);
        const multi = categories.length > 1;

        if (state.mode === 'local') {
            const online = categories.filter((c) => !LOCAL_CATEGORIES[tool.mode].includes(c));
            if (online.length) {
                const note = document.createElement('p');
                note.className = 'setup-note';
                const names = online.map((c) => CATEGORY_TITLES[c]).join(' and ');
                note.innerHTML = `${ICON_CLOUD}<span></span>`;
                note.querySelector('span').textContent = `${names} files can't be ${tool.mode === 'convert' ? 'converted' : 'compressed'} on this device. You'll be asked before anything is uploaded.`;
                opts.appendChild(note);
            }
        }

        categories.forEach((category) => {
            const exts = [...new Set(byCategory[category])];
            const group = document.createElement('div');
            group.className = 'option-group';
            if (multi) {
                const caption = document.createElement('div');
                caption.className = 'option-group-label';
                caption.textContent = CATEGORY_TITLES[category];
                group.appendChild(caption);
            }
            if (tool.mode === 'convert') {
                group.appendChild(convertRow(tool, category, multi));
            } else {
                compressRows(tool, category, exts).forEach((row) => group.appendChild(row));
            }
            opts.appendChild(group);
        });
    }

    function convertRow(tool, category, multi) {
        const groups = [];
        if (category === 'image') {
            groups.push({ label: 'Image', items: formatItems('image_convert') });
            groups.push({ label: 'Remove background', items: formatItems('image_remove_bg', ' · transparent') });
        } else if (category === 'audio') {
            groups.push({ label: 'Audio', items: formatItems('audio_convert') });
        } else {
            groups.push({ label: 'Video', items: formatItems('video_compress') });
        }

        const id = uid('convert-label');
        const row = optionRow(multi ? `${CATEGORY_TITLES[category]} to` : 'Convert to', id);
        const key = `target.${category}`;
        const picker = createPicker({
            groups: groups.filter((g) => g.items.length),
            grid: true,
            value: loadSetting(key, DEFAULTS.target[category]),
            labelledBy: id,
            onChange: (value) => saveSetting(key, value),
        });
        row.appendChild(picker.el);
        tool.controls[`target.${category}`] = picker;
        return row;
    }

    function formatItems(operation, suffix = '') {
        return listOf(formatsFor(operation).output).map((f) => ({
            value: `${operation}:${f}`,
            label: f.toUpperCase(),
            display: f.toUpperCase() + suffix,
            cloud: state.mode === 'local' && !isLocalTarget(operation, f),
        }));
    }

    function isLocalTarget(operation, format) {
        if (operation === 'image_convert') return LOCAL_IMAGE_OUTPUTS.includes(format);
        if (operation === 'audio_convert') return LOCAL_AUDIO_OUTPUTS.includes(format);
        return false;
    }

    // Decides whether a job can run on this device. Returns { task } or { reason }.
    function localPlan(item) {
        const { category, ext, file, operation, params } = item;
        const limit = ILCLocal.LIMITS[category];
        const target = (params.output_format || '').toUpperCase();

        switch (operation) {
            case 'image_convert':
                if (!LOCAL_IMAGE_OUTPUTS.includes(params.output_format)) return { reason: `Creating ${target} files needs the server.` };
                break;
            case 'image_compress':
                if (!LOCAL_IMAGE_COMPRESS.includes(ext)) return { reason: `Compressing ${ext.toUpperCase()} files needs the server.` };
                if (params.lossless && ext === 'webp') return { reason: 'Lossless WEBP compression needs the server.' };
                break;
            case 'image_remove_bg':
                return { reason: 'Background removal uses an AI model on the server.' };
            case 'audio_convert':
                if (!LOCAL_AUDIO_OUTPUTS.includes(params.output_format)) return { reason: `Creating ${target} files needs the server. WAV and AIFF work on this device.` };
                if (!LOCAL_AUDIO_INPUTS.includes(ext)) return { reason: `${ext.toUpperCase()} files can't be decoded in the browser.` };
                break;
            case 'audio_compress':
                return { reason: 'Audio compression needs the server.' };
            case 'video_compress':
                return { reason: 'Video processing needs the server.' };
            case 'pdf_compress':
                return { reason: 'PDF compression needs the server.' };
            default:
                return { reason: 'This needs the server.' };
        }

        if (limit && file.size > limit.bytes) {
            return { reason: `Larger than the ${formatBytes(limit.bytes)} limit for on-device processing.` };
        }

        if (category === 'image') {
            const isCompress = operation === 'image_compress';
            return {
                task: {
                    kind: 'image',
                    op: isCompress ? 'compress' : 'convert',
                    format: isCompress ? (FORMAT_ALIASES[ext] || ext) : params.output_format,
                    quality: isCompress ? params.quality : 92,
                    lossless: !!params.lossless,
                },
            };
        }
        return { task: { kind: 'audio', format: params.output_format } };
    }

    function compressRows(tool, category, exts) {
        const rows = [];

        if (category === 'video') {
            const id = uid('video-format');
            const row = optionRow('Format', id);
            const picker = createPicker({
                groups: [{
                    items: [{ value: '', label: 'Keep original', display: 'Keep original' }]
                        .concat(listOf(formatsFor('video_compress').output).map((f) => ({ value: f, label: f.toUpperCase() }))),
                }],
                value: loadSetting('videoFormat', ''),
                labelledBy: id,
                onChange: (value) => {
                    saveSetting('videoFormat', value);
                    quality.update();
                },
            });
            row.appendChild(picker.el);
            tool.controls.videoFormat = picker;
            rows.push(row);
        }

        if (category === 'pdf') {
            const id = uid('pdf-dpi');
            const row = optionRow('Image DPI', id);
            const picker = createPicker({
                groups: [{
                    items: [
                        { value: '72', label: '72 DPI', note: 'Smallest, screen only' },
                        { value: '150', label: '150 DPI', note: 'Balanced, readable when zoomed' },
                        { value: '300', label: '300 DPI', note: 'Print quality' },
                        { value: '600', label: '600 DPI', note: 'Archival, largest' },
                    ],
                }],
                value: loadSetting('pdfDpi', '150'),
                labelledBy: id,
                onChange: (value) => saveSetting('pdfDpi', value),
            });
            row.appendChild(picker.el);
            tool.controls.pdfDpi = picker;
            rows.push(row);
        }

        const formatsForInfo = () => {
            if (category !== 'video') return exts;
            const chosen = tool.controls.videoFormat && tool.controls.videoFormat.value;
            if (chosen) return [chosen];
            const outputs = listOf(formatsFor('video_compress').output);
            return exts.map((e) => (outputs.includes(e) ? e : 'mp4'));
        };

        const quality = qualityRow(category, formatsForInfo);
        tool.controls[`quality.${category}`] = quality;
        rows.push(quality.el);

        const losslessExts = LOSSLESS_FORMATS[category];
        if (losslessExts && exts.some((e) => losslessExts.includes(e))) {
            const note = category === 'image'
                ? 'Applies to PNG, WEBP, AVIF and TIFF. JPEGs always use the quality setting.'
                : 'Applies to FLAC, WAV and AIFF. Other formats use maximum quality.';
            const toggle = switchRow('Lossless', note, loadSetting(`lossless.${category}`, 'false') === 'true', (checked) => {
                saveSetting(`lossless.${category}`, checked);
                quality.setLossless(checked);
            });
            tool.controls[`lossless.${category}`] = toggle;
            quality.setLossless(toggle.checked);
            rows.push(toggle.el);
        }

        return rows;
    }

    function uid(prefix) {
        return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
    }

    function optionRow(label, labelId) {
        const row = document.createElement('div');
        row.className = 'option-row';
        const span = document.createElement('span');
        span.className = 'option-label';
        span.id = labelId;
        span.textContent = label;
        row.appendChild(span);
        return row;
    }

    function qualityRow(category, getFormats) {
        const key = `quality.${category}`;
        const initial = loadNumber(key, DEFAULTS.quality[category]);
        const id = uid('quality');
        const presets = QUALITY_PRESETS[category === 'pdf' ? 'pdf' : 'default'];

        const row = document.createElement('div');
        row.className = 'option-row option-row-quality';
        row.innerHTML = `
            <div class="quality-head">
                <label class="option-label" for="${id}">${category === 'pdf' ? 'Image quality' : 'Quality'}</label>
                <span class="quality-badge"><span class="quality-tier"></span><span class="quality-value"></span></span>
            </div>
            <input type="range" class="option-range" id="${id}" min="1" max="100" value="${initial}">
            <div class="quality-presets">${presets.map(([name, v]) =>
                `<button type="button" class="quality-preset" data-value="${v}">${name}</button>`).join('')}</div>
            <p class="quality-desc"></p>
            <p class="quality-detail"></p>`;

        const range = $('.option-range', row);
        let lossless = false;

        function update() {
            const q = parseInt(range.value, 10);
            const info = qualityInfo(category, getFormats(), q, lossless, state.mode === 'local');
            range.style.setProperty('--fill', ((q - 1) / 99 * 100) + '%');
            $('.quality-tier', row).textContent = info.tier;
            $('.quality-value', row).textContent = lossless ? '' : q;
            $('.quality-desc', row).textContent = info.desc;
            $('.quality-detail', row).textContent = info.detail;
            $$('.quality-preset', row).forEach((b) => {
                b.classList.toggle('active', !lossless && parseInt(b.dataset.value, 10) === q);
            });
        }

        range.addEventListener('input', update);
        range.addEventListener('change', () => saveSetting(key, range.value));
        $$('.quality-preset', row).forEach((b) => {
            b.addEventListener('click', () => {
                range.value = b.dataset.value;
                saveSetting(key, range.value);
                update();
            });
        });
        update();

        return {
            el: row,
            get value() { return parseInt(range.value, 10); },
            update,
            setLossless(on) {
                lossless = on;
                range.disabled = on;
                $$('.quality-preset', row).forEach((b) => { b.disabled = on; });
                row.classList.toggle('is-lossless', on);
                update();
            },
        };
    }

    function switchRow(label, note, checked, onChange) {
        const id = uid('switch');
        const row = document.createElement('label');
        row.className = 'option-row switch-row';
        row.setAttribute('for', id);
        row.innerHTML = `
            <span class="switch-text">
                <span class="option-label"></span>
                <span class="switch-note"></span>
            </span>
            <input type="checkbox" class="switch" id="${id}">`;
        $('.option-label', row).textContent = label;
        $('.switch-note', row).textContent = note;
        const input = $('.switch', row);
        input.checked = checked;
        input.addEventListener('change', () => onChange(input.checked));
        return { el: row, get checked() { return input.checked; } };
    }

    // Resolves the backend job for a file from the current settings, or returns { error }.
    function jobFor(tool, item) {
        const { category, ext } = item;
        const c = tool.controls;

        if (tool.mode === 'convert') {
            const [operation, format] = c[`target.${category}`].value.split(':');
            if (!listOf(formatsFor(operation).input).includes(ext)) {
                return { error: `.${ext} can't be converted to ${c[`target.${category}`].text}.` };
            }
            const params = { output_format: format };
            if (operation === 'video_compress') params.quality = VIDEO_CONVERT_QUALITY;
            return { operation, params };
        }

        const operation = COMPRESS_OPS[category];
        if (!listOf(formatsFor(operation).input).includes(ext)) {
            return { error: `.${ext} files can't be compressed.` };
        }
        const quality = c[`quality.${category}`].value;
        const lossless = c[`lossless.${category}`] ? c[`lossless.${category}`].checked : false;
        switch (category) {
            case 'pdf':
                return { operation, params: { image_quality: quality, image_dpi: c.pdfDpi.value } };
            case 'video': {
                const params = { quality };
                if (c.videoFormat.value) params.output_format = c.videoFormat.value;
                return { operation, params };
            }
            default:
                return { operation, params: { quality, lossless } };
        }
    }

    // In local mode a file only reaches the server after the user confirms the cloud prompt.
    function startPending(tool) {
        pendingFiles(tool).forEach((item) => {
            const job = jobFor(tool, item);
            if (job.error) {
                setError(item, job.error);
                renderFile(item);
                return;
            }
            item.operation = job.operation;
            item.params = job.params;
            if (state.mode === 'local') {
                const plan = localPlan(item);
                if (plan.task) {
                    item.backend = 'local';
                    item.task = plan.task;
                    item.status = 'waiting';
                } else {
                    needsCloud(item, plan.reason);
                }
            } else {
                item.backend = 'online';
                item.status = 'waiting';
            }
            renderFile(item);
        });
        refresh(tool);
        updateCloudPrompt(tool);
        pump(tool);
    }

    function needsCloud(item, reason) {
        item.status = 'needs-cloud';
        item.cloudReason = reason;
    }

    function updateCloudPrompt(tool) {
        const waiting = tool.files.filter((f) => f.status === 'needs-cloud');
        const show = waiting.length > 0;
        const { refs } = tool;

        if (show) {
            refs.cloudTitle.innerHTML = '';
            refs.cloudTitle.append(
                waiting.length === 1 ? 'File cannot be processed locally.' : `${waiting.length} files cannot be processed locally.`,
                document.createElement('br'),
                'Upload to cloud?'
            );
            refs.cloudReasons.replaceChildren(...waiting.slice(0, 4).map((f) => {
                const li = document.createElement('li');
                const name = document.createElement('strong');
                name.textContent = f.file.name;
                li.append(name, ` ${f.cloudReason}`);
                return li;
            }));
            if (waiting.length > 4) {
                const li = document.createElement('li');
                li.textContent = `and ${waiting.length - 4} more`;
                refs.cloudReasons.appendChild(li);
            }
        }

        if (show === !!tool.prompting) return;
        tool.prompting = show;
        refs.dropzone.classList.toggle('is-cloud-prompt', show);
        refs.dropDefault.hidden = show;
        refs.cloud.hidden = !show;
        if (show) refs.cloudConfirm.focus({ preventScroll: true });
    }

    function confirmCloud(tool) {
        requireConsent(() => uploadNeedsCloud(tool));
    }

    function uploadNeedsCloud(tool) {
        tool.files.forEach((item) => {
            if (item.status !== 'needs-cloud') return;
            item.backend = 'online';
            item.status = 'waiting';
            renderFile(item);
        });
        setMode('online');
        updateCloudPrompt(tool);
        pump(tool);
    }

    // Puts the files back to "Ready" so another target can be picked, without uploading anything.
    function cancelCloud(tool) {
        tool.files.forEach((item) => {
            if (item.status !== 'needs-cloud') return;
            item.status = 'ready';
            renderFile(item);
        });
        updateCloudPrompt(tool);
        refresh(tool);
    }

    function addFileRow(tool, file, ext, category, order = 0) {
        const item = {
            id: tool.nextId++,
            file,
            ext,
            category,
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
            </div>
            <div class="file-actions">
                <a class="btn-chip btn-download is-disabled" aria-disabled="true"><span class="btn-chip-text">Download</span>${ICON_DOWNLOAD}</a>
                <button type="button" class="btn-chip btn-square" aria-label="Remove file" title="Remove">${ICON_X}</button>
            </div>`;
        $('.file-name', row).textContent = file.name;
        $('.file-name', row).title = file.name;
        $('.btn-square', row).addEventListener('click', () => removeFile(tool, item));
        if (!reducedMotion.matches && row.animate) {
            row.animate([
                { opacity: 0, transform: 'translateY(8px)' },
                { opacity: 1, transform: 'translateY(0)' },
            ], { duration: 340, delay: Math.min(order, 8) * 45, easing: 'cubic-bezier(0.2, 0, 0, 1)', fill: 'backwards' });
        }

        item.el = {
            row,
            meta: $('.file-meta', row),
            download: $('.btn-download', row),
        };

        tool.files.push(item);
        tool.refs.list.appendChild(row);
        renderFile(item);
    }

    function disposeFile(item) {
        item.removed = true;
        if (item.objectUrl) URL.revokeObjectURL(item.objectUrl);
        if (item.xhr) item.xhr.abort();
        stopPolling(item);
        if (item.jobId) {
            fetch(`/api/jobs/${item.jobId}`, { method: 'DELETE' }).catch(() => {});
        }
    }

    async function removeFile(tool, item) {
        if (item.removed) return;
        const wasUploading = item.status === 'uploading';
        disposeFile(item);
        tool.files = tool.files.filter((f) => f !== item);
        if (wasUploading) {
            tool.uploading = false;
            pump(tool);
        }
        updateCloudPrompt(tool);
        if (tool.files.length) {
            refresh(tool);
            await collapseOut(item.el.row);
            item.el.row.remove();
        } else {
            await collapseOut(tool.refs.files);
            item.el.row.remove();
            refresh(tool);
        }
    }

    async function clearAll(tool) {
        const rows = tool.files.map((f) => f.el.row);
        tool.files.forEach(disposeFile);
        tool.files = [];
        tool.uploading = false;
        updateCloudPrompt(tool);
        await collapseOut(tool.refs.files);
        rows.forEach((row) => row.remove());
        refresh(tool);
    }

    // One upload and one on-device job at a time; server-side processing runs in parallel.
    function pump(tool) {
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
