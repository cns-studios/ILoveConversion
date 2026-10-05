export const $ = (sel, root = document) => root.querySelector(sel);

export const $$ = (sel, root = document) => root.querySelectorAll(sel);

export const dom = {
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
