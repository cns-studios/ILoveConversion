import { $ } from './dom.js';
import { readAcceptance, storeAcceptance } from './settings.js';

let consentGiven = false;

let consentRequest = null;

function hasConsent() {
    return consentGiven || readAcceptance();
}

export function migrateConsentCookie() {
    const cookies = document.cookie.split('; ');
    if (cookies.some((c) => c.startsWith('tos_and_policy_accepted='))) {
        document.cookie = 'tos_and_policy_accepted=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax';
    }
}

export function requireConsent(onAccept, onDecline) {
    if (hasConsent()) {
        onAccept();
        return;
    }
    consentRequest = { onAccept, onDecline };
    $('#consent-modal').classList.remove('hidden');
    $('#btn-accept').focus();
}

export function answerConsent(accepted) {
    const request = consentRequest;
    consentRequest = null;
    $('#consent-modal').classList.add('hidden');
    if (accepted) {
        consentGiven = true;
        storeAcceptance();
    }
    const callback = request && (accepted ? request.onAccept : request.onDecline);
    if (callback) callback();
}
