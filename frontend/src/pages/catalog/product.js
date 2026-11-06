import { callBackend } from '../../shared/api.js';
import { byId, showError, showStatus } from '../../shared/dom.js';

let productRequest = 0;

export async function loadProduct(id) {
    const request = ++productRequest;
    byId('product-details').replaceChildren();
    byId('product-card').hidden = true;
    showStatus(byId('product-status'), 'Загрузка товара…');
    try {
        const [product, stock] = await Promise.all([callBackend('GetProduct', id), callBackend('GetProductStock', id)]);
        if (request !== productRequest) return;
        byId('product-free').textContent = String(stock.free);
        byId('product-reserved').textContent = String(stock.reserved);
        for (const [label, value] of [['ID', product.id], ['Название', product.name], ['Количество', product.count]]) {
            const term = document.createElement('dt');
            const definition = document.createElement('dd');
            term.className = 'mt-3';
            term.textContent = label;
            definition.className = 'text-break';
            definition.textContent = value;
            byId('product-details').append(term, definition);
        }
        byId('product-card').hidden = false;
        showStatus(byId('product-status'), '');
    } catch (error) {
        if (request === productRequest) showError(byId('product-status'), error);
    }
}
