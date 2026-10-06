import { $, $$ } from './dom.js';
import { refresh } from './file-tool.js';
import { positionIndicator } from './motion.js';
import { state } from './state.js';

export function setMode(mode) {
    state.mode = mode;

    $$('.mode-btn').forEach((btn) => {
        const active = btn.dataset.mode === mode;
        btn.classList.toggle('active', active);
        btn.setAttribute('aria-pressed', active);
    });
    document.documentElement.dataset.mode = mode;

    positionIndicator($('.mode-toggle'), $('.mode-btn.active'), $('.mode-indicator'));

    Object.values(state.tools).forEach((tool) => {
        tool.setupSignature = null;
        refresh(tool);
    });
}
