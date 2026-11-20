import { byId } from './dom.js';

export function createManagerPicker(id, placeholder = 'Выберите менеджеров') {
    const button = byId(id);
    const options = byId(`${id}-options`);
    const inputs = () => Array.from(options.children, (label) => label.firstElementChild);
    const checked = () => inputs().filter((input) => input.checked);
    const ids = () => checked().map((input) => Number(input.value));
    const names = () => checked().map((input) => input.dataset.name);
    const updateLabel = () => {
        const selectedNames = names();
        button.textContent = selectedNames.length ? selectedNames.join(', ') : placeholder;
    };
    updateLabel();
    options.addEventListener('change', updateLabel);

    function render(managers, selected = ids()) {
        const currentUserId = JSON.parse(sessionStorage.getItem('user'))?.id;
        options.replaceChildren(...managers.map((manager) => {
            const label = document.createElement('label');
            label.className = 'dropdown-item d-flex align-items-start gap-2 text-wrap';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.className = 'form-check-input flex-shrink-0';
            input.value = String(manager.id);
            input.dataset.name = manager.name;
            input.checked = selected.includes(manager.id);
            const name = document.createElement('span');
            name.textContent = manager.id === currentUserId ? `${manager.name} (вы)` : manager.name;
            label.append(input, name);
            return label;
        }));
        button.disabled = managers.length === 0;
        updateLabel();
    }

    function clear() {
        for (const input of inputs()) input.checked = false;
        updateLabel();
    }

    return { ids, names, render, clear };
}
