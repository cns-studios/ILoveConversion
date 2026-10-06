import { answerConsent, migrateConsentCookie, requireConsent } from './consent.js';
import { LOCAL_IMAGE_OUTPUTS } from './constants.js';
import { $, $$, dom } from './dom.js';
import { createFileTool } from './file-tool.js';
import { loadFormats } from './formats.js';
import { setMode } from './mode.js';
import { positionIndicator, pulse, setupIndicators } from './motion.js';
import { createQrTypePicker, debounceLocationSearch, downloadQrCode, generateQrCode, switchQrType } from './qr.js';
import { clearStoredPreferences } from './settings.js';
import { state } from './state.js';

async function init() {
    document.documentElement.classList.add('no-indicator-motion');
    migrateConsentCookie();
    clearStoredPreferences();
    await loadFormats();
    if (!ILCLocal.supportsWebp) LOCAL_IMAGE_OUTPUTS.splice(LOCAL_IMAGE_OUTPUTS.indexOf('webp'), 1);
    state.mode = 'local';
    state.tools.convert = createFileTool('convert', $('#panel-convert'));
    state.tools.compress = createFileTool('compress', $('#panel-compress'));
    setMode(state.mode);
    createQrTypePicker();
    bindEvents();
    switchQrType();
    setupIndicators();
    setTimeout(() => document.documentElement.classList.remove('page-enter'), 900);
}

function bindEvents() {
    dom.tabs().forEach((tab) => {
        tab.addEventListener('click', () => switchTab(tab.dataset.tool));
    });

    $$('.mode-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            if (btn.dataset.mode === 'online') {
                requireConsent(() => setMode('online'));
            } else {
                setMode('local');
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

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
