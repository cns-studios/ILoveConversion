const settings = new Map();

const ACCEPTANCE_KEY = 'ilc.tosAccepted';

const TERMS_VERSION = '2.1';

export function loadSetting(key, fallback) {
    return settings.has(key) ? settings.get(key) : fallback;
}

export function saveSetting(key, value) {
    settings.set(key, String(value));
}

export function readAcceptance() {
    try {
        return localStorage.getItem(ACCEPTANCE_KEY) === TERMS_VERSION;
    } catch (e) {
        return false;
    }
}

export function storeAcceptance() {
    try {
        localStorage.setItem(ACCEPTANCE_KEY, TERMS_VERSION);
    } catch (e) {
    }
}

export function clearStoredPreferences() {
    try {
        Object.keys(localStorage)
            .filter((k) => k.startsWith('ilc.') && k !== ACCEPTANCE_KEY)
            .forEach((k) => localStorage.removeItem(k));
    } catch (e) {
    }
}

export function loadNumber(key, fallback) {
    const v = parseInt(loadSetting(key, fallback), 10);
    return Number.isFinite(v) ? v : fallback;
}
