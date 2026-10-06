import { CATEGORIES, CATEGORY_TITLES, DEFAULTS, LOSSLESS_FORMATS } from './constants.js';
import { $, $$ } from './dom.js';
import { formatItems, formatsFor, listOf } from './formats.js';
import { createPicker } from './picker.js';
import { QUALITY_PRESETS, qualityInfo } from './quality.js';
import { loadNumber, loadSetting, saveSetting } from './settings.js';
import { state } from './state.js';

export function buildOptions(tool, pending, more) {
    const opts = tool.refs.options;
    opts.innerHTML = '';
    tool.controls = {};

    const byCategory = {};
    pending.forEach((f) => {
        (byCategory[f.category] = byCategory[f.category] || []).push(f.ext);
    });
    const categories = CATEGORIES.filter((c) => byCategory[c]);
    const multi = more;

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
