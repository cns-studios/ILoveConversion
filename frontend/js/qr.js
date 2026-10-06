import { $, dom } from './dom.js';
import { createPicker } from './picker.js';
import { state } from './state.js';

export function createQrTypePicker() {
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

export function switchQrType() {
    const type = state.qrType.value;

    $('#qr-url-fields').classList.toggle('hidden', type !== 'url');
    $('#qr-text-fields').classList.toggle('hidden', type !== 'text');
    $('#qr-location-fields').classList.toggle('hidden', type !== 'location');
    $('#qr-wifi-fields').classList.toggle('hidden', type !== 'wifi');

    generateQrCode();
}

export function generateQrCode() {
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

export function debounceLocationSearch() {
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

export function downloadQrCode() {
    const canvas = dom.qrResultCanvas.querySelector('canvas');
    if (!canvas) return;

    const link = document.createElement('a');
    link.href = canvas.toDataURL('image/png');
    link.download = 'qr-code.png';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
