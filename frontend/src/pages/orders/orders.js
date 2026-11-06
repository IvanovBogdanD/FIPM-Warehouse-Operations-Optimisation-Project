import { callBackend } from '../../shared/api.js';
import { byId, showError, showStatus } from '../../shared/dom.js';
import { forgetReceiving } from '../receiving/receiving.js';

const ORDER_STATUSES = {
    pending: { label: 'Черновик', style: 'text-bg-primary' },
    completed: { label: 'Завершён', style: 'text-bg-success' },
    cancelled: { label: 'Отменён', style: 'text-bg-danger' },
};
const ORDER_TYPES = { receiving: 'Приёмка товара' };
const ORDER_TABS = ['all', 'pending', 'completed', 'cancelled'];

let orders = [];
let ordersRequest = 0;
let ordersBusy = false;
let ordersLoadFailed = false;
let ordersTab = 'all';
let selectedOrderId = null;
let orderToCancel = null;

function formatOrderDate(value) {
    if (!value) return '—';
    return new Date(value).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
}

function createOrderBadge(status) {
    const { label, style } = ORDER_STATUSES[status] ?? { label: status, style: 'text-bg-secondary' };
    const badge = document.createElement('span');
    badge.className = `badge ${style}`;
    badge.textContent = label;
    return badge;
}

function createOrderCell(...content) {
    const cell = document.createElement('td');
    cell.append(...content);
    return cell;
}

function askOrderCancel(order) {
    orderToCancel = order.id;
    byId('order-cancel-title').textContent = `Отменить заказ ${order.number}?`;
}

function createOrderRow(order) {
    const row = document.createElement('tr');
    row.dataset.orderId = order.id;
    row.classList.toggle('table-active', order.id === selectedOrderId);
    row.addEventListener('click', () => selectOrder(order.id));

    const number = document.createElement('button');
    number.type = 'button';
    number.className = 'btn btn-link p-0 fw-semibold text-nowrap';
    number.textContent = order.number;

    const actions = createOrderCell();
    if (order.status === 'pending') {
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn btn-outline-danger btn-sm';
        cancel.textContent = 'Отменить';
        cancel.disabled = ordersBusy;
        cancel.setAttribute('data-bs-toggle', 'modal');
        cancel.setAttribute('data-bs-target', '#order-cancel-modal');
        cancel.addEventListener('click', () => askOrderCancel(order));
        actions.append(cancel);
    }

    row.append(createOrderCell(number), createOrderCell(createOrderBadge(order.status)),
        createOrderCell(formatOrderDate(order.createdAt)), createOrderCell(formatOrderDate(order.shipmentDate)),
        createOrderCell(order.responsible), createOrderCell(String(order.items.length)), actions);
    return row;
}

function visibleOrders() {
    const query = byId('orders-search').value.trim().toLowerCase();
    return orders.filter((order) => {
        if (ordersTab !== 'all' && order.status !== ordersTab) return false;
        const text = [order.number, order.responsible, ...order.items.map((item) => item.name)].join(' ');
        return text.toLowerCase().includes(query);
    });
}

function renderOrderDetails() {
    const order = orders.find((item) => item.id === selectedOrderId);
    byId('order-details-empty').hidden = Boolean(order);
    byId('order-details').hidden = !order;
    if (!order) return;
    byId('order-title').textContent = `Заказ ${order.number}`;
    byId('order-status-badge').replaceChildren(createOrderBadge(order.status));
    byId('order-summary').replaceChildren();
    for (const [label, value] of [
        ['Тип', ORDER_TYPES[order.type] ?? order.type], ['Дата создания', formatOrderDate(order.createdAt)],
        ['Дата отгрузки', formatOrderDate(order.shipmentDate)], ['Ответственный', order.responsible],
        ['Место хранения', order.location],
    ]) {
        const term = document.createElement('dt');
        const definition = document.createElement('dd');
        term.textContent = label;
        definition.className = 'text-break';
        definition.textContent = value;
        byId('order-summary').append(term, definition);
    }
    byId('order-items').replaceChildren(...order.items.map((item) => {
        const row = document.createElement('tr');
        const link = document.createElement('a');
        link.href = `#product/${item.productId}`;
        link.textContent = item.name;
        const name = createOrderCell(link);
        name.className = 'text-break';
        const quantity = createOrderCell(`${item.quantity} шт.`);
        quantity.className = 'text-end text-nowrap';
        row.append(name, quantity);
        return row;
    }));
    byId('order-positions').textContent = `Итого позиций: ${order.items.length}`;
    byId('order-total').textContent = `${order.items.reduce((sum, item) => sum + item.quantity, 0)} шт.`;
    byId('order-cancel').hidden = order.status !== 'pending';
    byId('order-cancel').disabled = ordersBusy;
}

function renderOrders() {
    for (const tab of ORDER_TABS) {
        const count = tab === 'all' ? orders.length : orders.filter((order) => order.status === tab).length;
        byId(`orders-count-${tab}`).textContent = String(count);
        byId(`orders-tab-${tab}`).classList.toggle('active', tab === ordersTab);
    }
    const visible = visibleOrders();
    byId('orders-body').replaceChildren(...visible.map(createOrderRow));
    byId('orders-empty').hidden = visible.length > 0 || ordersLoadFailed;
    byId('orders-empty').textContent = orders.length
        ? 'По заданным условиям заказы не найдены.'
        : 'Заказов пока нет. Чтобы создать приёмку, откройте меню «…».';
    renderOrderDetails();
}

// Строки не пересоздаются: Bootstrap ищет кнопку окна отмены уже после этого обработчика клика.
function selectOrder(id) {
    selectedOrderId = id;
    for (const row of byId('orders-body').children) {
        row.classList.toggle('table-active', row.dataset.orderId === id);
    }
    renderOrderDetails();
}

export async function loadOrders() {
    const request = ++ordersRequest;
    showStatus(byId('orders-status'), 'Загрузка заказов…');
    try {
        const loaded = await callBackend('GetOrders');
        if (request !== ordersRequest) return;
        orders = loaded;
        ordersLoadFailed = false;
        showStatus(byId('orders-status'), '');
    } catch (error) {
        if (request !== ordersRequest) return;
        orders = [];
        ordersLoadFailed = true;
        showError(byId('orders-status'), error);
    }
    renderOrders();
}

async function confirmOrderCancel() {
    if (ordersBusy || !orderToCancel) return;
    const id = orderToCancel;
    orderToCancel = null;
    ordersBusy = true;
    showStatus(byId('orders-status'), 'Отмена заказа…');
    renderOrders();
    try {
        const cancelled = await callBackend('CancelOrder', id);
        ordersRequest++;
        orders = orders.map((order) => order.id === id ? cancelled : order);
        forgetReceiving(id);
        showStatus(byId('orders-status'), `Заказ ${cancelled.number} отменён. Остаток товара не изменён.`);
    } catch (error) {
        await loadOrders();
        showError(byId('orders-status'), error);
    } finally {
        ordersBusy = false;
        renderOrders();
    }
}

export function initOrders() {
    byId('orders-reload').addEventListener('click', loadOrders);
    byId('orders-search').addEventListener('input', renderOrders);
    byId('order-cancel-confirm').addEventListener('click', confirmOrderCancel);
    byId('order-cancel').addEventListener('click', () => {
        askOrderCancel(orders.find((order) => order.id === selectedOrderId));
    });
    for (const tab of ORDER_TABS) {
        byId(`orders-tab-${tab}`).addEventListener('click', () => {
            ordersTab = tab;
            renderOrders();
        });
    }
}
