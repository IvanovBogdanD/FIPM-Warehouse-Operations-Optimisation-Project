import { byId, showError, showStatus } from './dom.js';
import { callBackend } from './api.js';

export function createProductSearch({ prefix, inputId = `${prefix}-product-search`, onChoose, onResults = () => {}, onError = () => {} }) {
    const input = byId(inputId);
    const picker = byId(`${prefix}-product-picker`);
    const results = byId(`${prefix}-search-results`);
    const options = byId(`${prefix}-product-options`);
    const more = byId(`${prefix}-search-more`);
    const status = byId(`${prefix}-search-status`);
    const products = new Map();
    let version = 0;
    let cursor = 0;

    function close() {
        version++;
        results.classList.remove('show');
        input.setAttribute('aria-expanded', 'false');
        options.replaceChildren();
        more.hidden = true;
    }

    async function load({ append = false, open = true } = {}) {
        if (input.disabled || (append && more.disabled)) return;
        const request = ++version;
        if (!append) {
            cursor = 0;
            options.replaceChildren();
            products.clear();
            more.hidden = true;
        }
        results.classList.toggle('show', open);
        input.setAttribute('aria-expanded', String(open));
        showStatus(status, 'Загрузка товаров...');
        more.disabled = true;
        try {
            const page = await callBackend('SearchProductsPage', input.value.trim(), cursor);
            if (request !== version) return;
            for (const product of page.products) {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'dropdown-item d-flex justify-content-between align-items-center gap-3 text-wrap py-2';
                button.dataset.productId = product.id;
                button.setAttribute('role', 'option');
                button.setAttribute('aria-selected', 'false');
                const name = document.createElement('span');
                name.textContent = product.article ? `${product.name} · ${product.article}` : product.name;
                const count = document.createElement('span');
                count.className = 'badge text-bg-light border text-nowrap';
                count.textContent = `${product.count} шт.`;
                button.append(name, count);
                options.append(button);
                cursor = product.id;
                products.set(product.id, product);
            }
            onResults(Array.from(products.values()), page.hasMore);
            more.hidden = !page.hasMore;
            showStatus(status, products.size ? `Показано товаров: ${products.size}` : 'По запросу товары не найдены.');
        } catch (error) {
            if (request === version) { showError(status, error); onError(error); }
        } finally {
            if (request === version) more.disabled = false;
        }
    }

    input.addEventListener('focus', () => load());
    input.addEventListener('input', () => load());
    input.addEventListener('click', () => { if (!results.classList.contains('show')) return load(); });
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); return load(); }
    });
    byId(`${prefix}-product-search-btn`).addEventListener('click', () => load());
    more.addEventListener('click', () => load({ append: true }));
    options.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-product-id]');
        if (!button) return;
        const product = products.get(Number(button.dataset.productId));
        close();
        onChoose(product);
    });
    picker.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') close();
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
        const buttons = Array.from(options.children);
        if (!buttons.length) return;
        event.preventDefault();
        const index = buttons.indexOf(event.target);
        const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
        buttons[Math.max(0, Math.min(buttons.length - 1, next))].focus();
    });
    const closeOutside = (event) => { if (!picker.contains(event.target)) close(); };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('focusin', closeOutside);
    return { load, close };
}
