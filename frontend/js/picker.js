import { ICON_CHECK, ICON_CHEVRONS } from './icons.js';

export function createPicker({ groups, value, grid = false, labelledBy, onChange }) {
    const root = document.createElement('div');
    root.className = 'picker';

    const trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.className = 'picker-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    if (labelledBy) trigger.setAttribute('aria-labelledby', labelledBy);
    trigger.innerHTML = `<span class="picker-value"></span><span class="picker-hint"></span>${ICON_CHEVRONS}`;

    const menu = document.createElement('div');
    menu.className = 'picker-menu' + (grid ? ' is-grid' : '');
    menu.setAttribute('role', 'listbox');
    menu.hidden = true;

    const items = [];
    groups.forEach((group) => {
        const section = document.createElement('div');
        section.className = 'picker-group';
        if (group.label) {
            const heading = document.createElement('div');
            heading.className = 'picker-group-label';
            heading.textContent = group.label;
            section.appendChild(heading);
        }
        const list = document.createElement('div');
        list.className = 'picker-options';
        group.items.forEach((item) => {
            const option = document.createElement('button');
            option.type = 'button';
            option.className = 'picker-option';
            option.setAttribute('role', 'option');
            option.tabIndex = -1;
            option.innerHTML = `<span class="picker-option-text"><span class="picker-option-label"></span><span class="picker-option-note"></span></span>${ICON_CHECK}`;
            option.querySelector('.picker-option-label').textContent = item.label;
            option.querySelector('.picker-option-note').textContent = item.note || '';
            if (item.cloud) {
                option.classList.add('is-cloud');
                option.title = 'Runs online';
            }
            option.addEventListener('click', () => {
                select(item.value, true);
                close(true);
            });
            list.appendChild(option);
            items.push({ ...item, group: group.label || '', el: option });
        });
        section.appendChild(list);
        menu.appendChild(section);
    });

    root.append(trigger, menu);

    let current = null;

    function select(val, notify) {
        const item = items.find((i) => i.value === val) || items[0];
        current = item;
        items.forEach((i) => {
            const selected = i === item;
            i.el.classList.toggle('selected', selected);
            i.el.setAttribute('aria-selected', selected);
        });
        trigger.querySelector('.picker-value').textContent = item.display || item.label;
        trigger.querySelector('.picker-hint').textContent = (grid ? item.group : '') + (item.cloud ? ' · online' : '');
        if (notify && onChange) onChange(item.value);
    }

    function open() {
        if (!menu.hidden) return;
        menu.hidden = false;
        root.classList.add('open');
        trigger.setAttribute('aria-expanded', 'true');
        current.el.focus({ preventScroll: true });
        current.el.scrollIntoView({ block: 'nearest' });
        document.addEventListener('pointerdown', onOutside, true);
    }

    function close(focusTrigger) {
        if (menu.hidden) return;
        menu.hidden = true;
        root.classList.remove('open');
        trigger.setAttribute('aria-expanded', 'false');
        document.removeEventListener('pointerdown', onOutside, true);
        if (focusTrigger) trigger.focus();
    }

    function onOutside(e) {
        if (!root.contains(e.target)) close(false);
    }

    function move(delta) {
        const idx = items.findIndex((i) => i.el === document.activeElement);
        const next = Math.max(0, Math.min(items.length - 1, (idx < 0 ? 0 : idx) + delta));
        items[next].el.focus();
    }

    trigger.addEventListener('click', () => (menu.hidden ? open() : close(true)));
    trigger.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            open();
        }
    });
    menu.addEventListener('keydown', (e) => {
        switch (e.key) {
            case 'ArrowDown': e.preventDefault(); move(grid ? 4 : 1); break;
            case 'ArrowUp': e.preventDefault(); move(grid ? -4 : -1); break;
            case 'ArrowRight': e.preventDefault(); move(1); break;
            case 'ArrowLeft': e.preventDefault(); move(-1); break;
            case 'Home': e.preventDefault(); items[0].el.focus(); break;
            case 'End': e.preventDefault(); items[items.length - 1].el.focus(); break;
            case 'Escape': e.preventDefault(); close(true); break;
            case 'Tab': close(false); break;
        }
    });

    select(value, false);

    return {
        el: root,
        get value() { return current.value; },
        get text() { return current.display || current.label; },
    };
}
