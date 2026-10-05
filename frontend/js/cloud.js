import { requireConsent } from './consent.js';
import { pendingFiles, refresh } from './file-tool.js';
import { jobFor, localPlan } from './jobs.js';
import { setMode } from './mode.js';
import { pump } from './processing.js';
import { renderFile, setError } from './render.js';
import { state } from './state.js';

export function startPending(tool) {
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

export function needsCloud(item, reason) {
    item.status = 'needs-cloud';
    item.cloudReason = reason;
}

export function updateCloudPrompt(tool) {
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

export function confirmCloud(tool) {
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

export function cancelCloud(tool) {
    tool.files.forEach((item) => {
        if (item.status !== 'needs-cloud') return;
        item.status = 'ready';
        renderFile(item);
    });
    updateCloudPrompt(tool);
    refresh(tool);
}
