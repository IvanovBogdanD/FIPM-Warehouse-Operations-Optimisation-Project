export const byId = (id) => document.getElementById(id);

export function showError(element, error) {
    element.classList.add('text-danger');
    element.textContent = `Ошибка: ${error?.message || String(error)}`;
}

export function showStatus(element, message) {
    element.classList.remove('text-danger');
    element.textContent = message;
}
