import { $ } from './dom.js';
import { state } from './state.js';

export const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

export function pulse(el, className) {
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

export function positionIndicator(container, active, indicator) {
    if (!active || !indicator) return;
    indicator.style.width = active.offsetWidth + 'px';
    indicator.style.height = active.offsetHeight + 'px';
    indicator.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`;
    container.classList.add('has-indicator');
}

export function setupIndicators() {
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

export function collapseOut(el) {
    if (reducedMotion.matches || !el.animate || !el.offsetHeight) return Promise.resolve();
    el.style.overflow = 'hidden';
    return el.animate([
        { height: el.offsetHeight + 'px', opacity: 1 },
        { height: '0px', opacity: 0, paddingTop: '0px', paddingBottom: '0px' },
    ], { duration: 240, easing: 'cubic-bezier(0.4, 0, 0.2, 1)' }).finished
        .catch(() => {})
        .then(() => { el.style.overflow = ''; });
}

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

export const BUSY_STATUSES = ['waiting', 'uploading', 'queued', 'processing'];

export function updateBusy() {
    setBusy(Object.values(state.tools).some((tool) =>
        tool.files.some((f) => BUSY_STATUSES.includes(f.status))));
}
