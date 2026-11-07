import { callBackend } from '../../shared/api.js';
import { byId, showError, showStatus } from '../../shared/dom.js';

let productRequest = 0;

function productAvailability(stock) {
    if (stock.count <= 0) return { label: 'Нет в наличии', style: 'text-bg-danger' };
    if (stock.free <= 0) return { label: 'Всё в брони', style: 'text-bg-warning' };
    return { label: 'В наличии', style: 'text-bg-success' };
}

function renderProduct(stock) {
    const { label, style } = productAvailability(stock);
    const reservedShare = stock.count > 0 ? Math.min(100, Math.round(stock.reserved / stock.count * 100)) : 0;
    const freeShare = stock.count > 0 ? 100 - reservedShare : 0;
    byId('product-name').textContent = stock.name;
    byId('product-info-name').textContent = stock.name;
    byId('product-id').textContent = `ID ${stock.id}`;
    byId('product-availability').className = `badge ${style}`;
    byId('product-availability').textContent = label;
    byId('product-count').textContent = stock.count.toLocaleString('ru-RU');
    byId('product-free').textContent = stock.free.toLocaleString('ru-RU');
    byId('product-reserved').textContent = stock.reserved.toLocaleString('ru-RU');
    byId('product-bar-free').style.width = `${freeShare}%`;
    byId('product-bar-reserved').style.width = `${reservedShare}%`;
    byId('product-free-share').textContent = `Свободно ${freeShare}%`;
    byId('product-reserved-share').textContent = `В брони ${reservedShare}%`;
    byId('product-warning').hidden = stock.free >= 0;
}

export async function loadProduct(id) {
    const request = ++productRequest;
    byId('product-name').textContent = 'Карточка товара';
    byId('product-summary').hidden = true;
    byId('product-card').hidden = true;
    showStatus(byId('product-status'), 'Загрузка товара…');
    try {
        const stock = await callBackend('GetProductStock', id);
        if (request !== productRequest) return;
        renderProduct(stock);
        byId('product-summary').hidden = false;
        byId('product-card').hidden = false;
        showStatus(byId('product-status'), '');
    } catch (error) {
        if (request === productRequest) showError(byId('product-status'), error);
    }
}
