import { callBackend } from '../../shared/api.js';
import { byId, showError, showStatus } from '../../shared/dom.js';
import { createOrderBadge, createOrderCell, formatOrderDay, orderQuantity, ORDER_TYPES } from '../orders/orders.js';

let homeRequest = 0;

function isToday(value) {
    return new Date(value).toDateString() === new Date().toDateString();
}

function renderHomeOrders(orders) {
    const shipments = orders.filter((order) => order.type === 'shipment');
    const upcoming = shipments.filter((order) => order.status === 'reserved')
        .sort((first, second) => new Date(first.shipmentDate) - new Date(second.shipmentDate));
    const today = shipments.filter((order) => order.status !== 'cancelled' && isToday(order.shipmentDate));
    byId('home-shipments-today').textContent = String(today.length);
    byId('home-shipments-empty').hidden = upcoming.length > 0;
    byId('home-shipments').replaceChildren(...upcoming.slice(0, 5).map((order) => {
        const row = document.createElement('tr');
        row.append(createOrderCell(order.number), createOrderCell(ORDER_TYPES[order.type]), createOrderCell(createOrderBadge(order.status)),
            createOrderCell(formatOrderDay(order.shipmentDate)), createOrderCell(order.responsible), createOrderCell(String(orderQuantity(order))));
        return row;
    }));
}

export async function loadHome() {
    const request = ++homeRequest;
    byId('home-date').textContent = new Intl.DateTimeFormat('ru-RU', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow',
    }).format(new Date());
    byId('home-total').textContent = '…';
    byId('home-free').textContent = '…';
    byId('home-reserved').textContent = '…';
    byId('home-shipments-today').textContent = '…';
    byId('home-positions').textContent = 'Загрузка каталога…';
    byId('home-attention-count').textContent = '…';
    byId('home-attention').replaceChildren();
    showStatus(byId('home-status'), 'Загрузка остатков…');
    try {
        const [products, stocks, orders] = await Promise.all([
            callBackend('GetAllProducts'), callBackend('GetProductStocks'), callBackend('GetOrders'),
        ]);
        if (request !== homeRequest) return;
        const total = products.reduce((sum, product) => sum + product.count, 0);
        const attention = products.filter((product) => product.count === 0);
        byId('home-total').textContent = total.toLocaleString('ru-RU');
        byId('home-free').textContent = stocks.reduce((sum, stock) => sum + stock.free, 0).toLocaleString('ru-RU');
        byId('home-reserved').textContent = stocks.reduce((sum, stock) => sum + stock.reserved, 0).toLocaleString('ru-RU');
        renderHomeOrders(orders);
        byId('home-positions').textContent = `Позиций в каталоге: ${products.length}`;
        byId('home-attention-count').textContent = attention.length;
        for (const product of attention) {
            const link = document.createElement('a');
            link.href = `#product/${product.id}`;
            link.className = 'list-group-item list-group-item-action d-flex align-items-center justify-content-between gap-3 px-0';
            const name = document.createElement('span');
            name.className = 'text-break';
            name.textContent = product.name;
            const badge = document.createElement('span');
            badge.className = 'badge bg-danger-subtle text-danger-emphasis text-nowrap';
            badge.textContent = '0 шт.';
            link.append(name, badge);
            byId('home-attention').append(link);
        }
        showStatus(byId('home-status'), attention.length ? '' : products.length ? 'Товаров с нулевым остатком нет.' : 'Каталог пуст.');
    } catch (error) {
        if (request !== homeRequest) return;
        byId('home-total').textContent = 'Недоступно';
        byId('home-free').textContent = 'Недоступно';
        byId('home-reserved').textContent = 'Недоступно';
        byId('home-shipments-today').textContent = 'Недоступно';
        byId('home-positions').textContent = 'Не удалось загрузить каталог';
        byId('home-attention-count').textContent = '?';
        showError(byId('home-status'), error);
    }
}

export function initHome() {
    byId('reload-home').addEventListener('click', loadHome);
}
