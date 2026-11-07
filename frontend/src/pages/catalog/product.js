import { callBackend } from '../../shared/api.js';
import { byId, showError, showStatus } from '../../shared/dom.js';

let productRequest = 0;

function renderProduct(product) {
    const available = product.count > 0;
    byId('product-name').textContent = product.name;
    byId('product-info-name').textContent = product.name;
    byId('product-id').textContent = `ID ${product.id}`;
    byId('product-availability').className = `badge ${available ? 'text-bg-success' : 'text-bg-danger'}`;
    byId('product-availability').textContent = available ? 'В наличии' : 'Нет в наличии';
    byId('product-count').textContent = product.count.toLocaleString('ru-RU');
}

export async function loadProduct(id) {
    const request = ++productRequest;
    byId('product-name').textContent = 'Карточка товара';
    byId('product-summary').hidden = true;
    byId('product-card').hidden = true;
    showStatus(byId('product-status'), 'Загрузка товара…');
    try {
        const product = await callBackend('GetProduct', id);
        if (request !== productRequest) return;
        renderProduct(product);
        byId('product-summary').hidden = false;
        byId('product-card').hidden = false;
        showStatus(byId('product-status'), '');
    } catch (error) {
        if (request === productRequest) showError(byId('product-status'), error);
    }
}
