import { cancelCloud, confirmCloud, startPending, updateCloudPrompt } from './cloud.js';
import { CATEGORY_SOURCE, CATEGORY_TITLES, COMPRESS_OPS, CONVERT_OPS, MIME_MAP } from './constants.js';
import { $, $$ } from './dom.js';
import { categoryOf, formatsFor, getExtension, listOf } from './formats.js';
import { showAlert } from './helpers.js';
import { ICON_DOWNLOAD, ICON_X } from './icons.js';
import { collapseOut, reducedMotion, updateBusy } from './motion.js';
import { buildOptions } from './options.js';
import { pump, stopPolling } from './processing.js';
import { renderFile } from './render.js';

export function createFileTool(mode, panel) {
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

export function pendingFiles(tool) {
    return tool.files.filter((f) => f.status === 'ready');
}

export function refresh(tool) {
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
