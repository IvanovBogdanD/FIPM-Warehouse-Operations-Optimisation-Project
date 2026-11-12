import { callBackend } from '../../shared/api.js';
import { byId, showError, showStatus } from '../../shared/dom.js';
import { createOrderBadge, createOrderCell, formatOrderDay, formatOrderDate, orderQuantity, openOrder, ORDER_TYPES } from '../orders/orders.js';

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
    byId('home-shipments-empty').textContent = 'Активных заказов на отгрузку нет.';
    byId('home-shipments').replaceChildren(...upcoming.slice(0, 5).map((order) => {
        const row = document.createElement('tr');
        row.append(createOrderCell(order.number), createOrderCell(ORDER_TYPES[order.type]), createOrderCell(createOrderBadge(order.status)),
            createOrderCell(formatOrderDay(order.shipmentDate)), createOrderCell(order.responsible), createOrderCell(String(orderQuantity(order))));
        return row;
    }));
}

function renderRecentOrders(orders) {
    byId('home-recent-empty').hidden = orders.length > 0;
    byId('home-recent-empty').textContent = 'Заказов в текущем запуске пока нет.';
    for (const order of orders.slice(0, 5)) {
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'list-group-item list-group-item-action px-0';
        const heading = document.createElement('span'); heading.className = 'd-flex flex-wrap justify-content-between align-items-center gap-2';
        const number = document.createElement('strong'); number.textContent = order.number;
        heading.append(number, createOrderBadge(order.status));
        const description = document.createElement('span'); description.className = 'd-block small text-body-secondary mt-1';
        description.textContent = `${ORDER_TYPES[order.type]} · ${order.responsible} · ${formatOrderDate(order.createdAt)}`;
        button.append(heading, description); button.addEventListener('click', () => openOrder(order.id));
        byId('home-recent-orders').append(button);
    }
}

async function loadHomeStocks(request) {
    try {
        const stocks = await callBackend('GetProductStocks');
        if (request !== homeRequest) return;
        const total = stocks.reduce((sum, stock) => sum + stock.count, 0);
        const attention = stocks.filter((stock) => stock.count === 0);
        byId('home-total').textContent = total.toLocaleString('ru-RU');
        byId('home-free').textContent = stocks.reduce((sum, stock) => sum + stock.free, 0).toLocaleString('ru-RU');
        byId('home-reserved').textContent = stocks.reduce((sum, stock) => sum + stock.reserved, 0).toLocaleString('ru-RU');
        byId('home-positions').textContent = `Позиций в каталоге: ${stocks.length}`;
        byId('home-attention-count').textContent = attention.length;
        for (const stock of attention) {
            const link = document.createElement('a');
            link.href = `#product/${stock.id}`;
            link.className = 'list-group-item list-group-item-action d-flex align-items-center justify-content-between gap-3 px-0';
            const name = document.createElement('span'); name.className = 'text-break'; name.textContent = stock.name;
            const badge = document.createElement('span'); badge.className = 'badge bg-danger-subtle text-danger-emphasis text-nowrap'; badge.textContent = '0 шт.';
            link.append(name, badge); byId('home-attention').append(link);
        }
        showStatus(byId('home-status'), attention.length ? '' : stocks.length ? 'Товаров с нулевым остатком нет.' : 'Каталог пуст.');
    } catch (error) {
        if (request !== homeRequest) return;
        for (const id of ['home-total', 'home-free', 'home-reserved']) byId(id).textContent = 'Недоступно';
        byId('home-positions').textContent = 'Не удалось загрузить каталог';
        byId('home-attention-count').textContent = '?';
        showError(byId('home-status'), error);
    }
}

async function loadHomeOrders(request) {
    try {
        const orders = await callBackend('GetOrders');
        if (request !== homeRequest) return;
        renderHomeOrders(orders);
        renderRecentOrders(orders);
    } catch (error) {
        if (request !== homeRequest) return;
        byId('home-shipments-today').textContent = 'Недоступно';
        byId('home-recent-empty').textContent = 'Не удалось загрузить заказы.';
        byId('home-shipments-empty').hidden = false;
        byId('home-shipments-empty').textContent = 'Не удалось загрузить отгрузки.';
        showError(byId('home-orders-status'), error);
    }
}

export async function loadHome() {
    const request = ++homeRequest;
    const user = JSON.parse(sessionStorage.getItem('user'));
    const name = [user.firstName, user.middleName].filter(Boolean).join(' ');
    byId('home-greeting').textContent = name ? `Добрый день, ${name}!` : 'Добрый день!';
    byId('home-actions').hidden = user.role !== 'Менеджер';
    byId('home-date').textContent = new Intl.DateTimeFormat('ru-RU', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Moscow',
    }).format(new Date());
    for (const id of ['home-total', 'home-free', 'home-reserved', 'home-shipments-today', 'home-attention-count']) byId(id).textContent = '…';
    byId('home-positions').textContent = 'Загрузка каталога...';
    byId('home-attention').replaceChildren();
    byId('home-shipments').replaceChildren();
    byId('home-shipments-empty').hidden = true;
    byId('home-recent-orders').replaceChildren();
    byId('home-recent-empty').hidden = false;
    byId('home-recent-empty').textContent = 'Загрузка заказов...';
    showStatus(byId('home-status'), 'Загрузка остатков...');
    showStatus(byId('home-orders-status'), '');
    await Promise.all([loadHomeStocks(request), loadHomeOrders(request)]);
}

export function initHome() {
    byId('reload-home').addEventListener('click', loadHome);
}
