import { callBackend } from '../../shared/api.js';
import { byId, showError, showStatus } from '../../shared/dom.js';
import { hideModal } from '../../shared/modal.js';
import { forgetReceiving } from '../receiving/receiving.js';

const ORDER_STATUSES = {
    pending: { label: 'Черновик', style: 'text-bg-primary' },
    reserved: { label: 'В брони', style: 'text-bg-warning' },
    completed: { label: 'Завершён', style: 'text-bg-success' },
    shipped: { label: 'Отгружен', style: 'text-bg-success' },
    written_off: { label: 'Списан', style: 'text-bg-dark' },
    cancelled: { label: 'Отменён', style: 'text-bg-danger' },
};
export const ORDER_TYPES = { receiving: 'Приёмка товара', shipment: 'Отгрузка', writeoff: 'Списание' };
const ORDER_TAB_STATUSES = {
    active: ['pending', 'reserved'],
    completed: ['completed', 'shipped', 'written_off'],
    cancelled: ['cancelled'],
};
const ORDER_TABS = ['all', ...Object.keys(ORDER_TAB_STATUSES)];
const ORDER_COMPLETIONS = {
    shipment: {
        action: 'Отгрузить', column: 'Отгрузка', date: 'Фактическая дата отгрузки', person: 'Отгрузил', done: 'отгружен',
        text: 'Товар будет списан со склада и убран из брони. Действие нельзя отменить.',
    },
    writeoff: {
        action: 'Списать', column: 'Списание', date: 'Фактическая дата списания', person: 'Списал', done: 'списан',
        text: 'Товар будет списан со склада и убран из брони. Действие нельзя отменить.',
    },
};

let orders = [];
let ordersRequest = 0;
let ordersBusy = false;
let ordersLoadFailed = false;
let ordersTab = 'all';
let selectedOrderId = null;
let orderToCancel = null;
let orderToComplete = null;
let orderCompleteRequest = 0;

function formatOrderDate(value) {
    if (!value) return '—';
    return new Date(value).toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
}

export function formatOrderDay(value) {
    if (!value) return '—';
    return new Date(value).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function todayForInput() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

export function orderQuantity(order) {
    return order.items.reduce((sum, item) => sum + item.quantity, 0);
}

export function createOrderBadge(status) {
    const { label, style } = ORDER_STATUSES[status] ?? { label: status, style: 'text-bg-secondary' };
    const badge = document.createElement('span');
    badge.className = `badge ${style}`;
    badge.textContent = label;
    return badge;
}

export function createOrderCell(...content) {
    const cell = document.createElement('td');
    cell.append(...content);
    return cell;
}

export function createStockChangeCell(before, after, style) {
    const was = document.createElement('span');
    was.className = 'text-body-secondary';
    was.textContent = `${before} → `;
    const now = document.createElement('span');
    now.className = `fw-bold ${style}`;
    now.textContent = String(after);
    const cell = createOrderCell(was, now);
    cell.className = 'text-end text-nowrap';
    return cell;
}

function isOrderCancellable(order) {
    return order.status === 'pending' || order.status === 'reserved';
}

function askOrderCancel(order) {
    orderToCancel = order.id;
    byId('order-cancel-title').textContent = `Отменить заказ ${order.number}?`;
    byId('order-cancel-text').textContent = order.status === 'reserved'
        ? `Бронь на ${orderQuantity(order)} шт. будет снята, товары вернутся в свободный остаток. Действие нельзя отменить.`
        : 'Это черновик приёмки: остаток товара не изменится. Действие нельзя отменить.';
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
    if (isOrderCancellable(order)) {
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
        createOrderCell(formatOrderDate(order.createdAt)), createOrderCell(formatOrderDay(order.shipmentDate)),
        createOrderCell(order.responsible), createOrderCell(String(order.items.length)), actions);
    return row;
}

function ordersOfTab(tab) {
    return tab === 'all' ? orders : orders.filter((order) => ORDER_TAB_STATUSES[tab].includes(order.status));
}

function visibleOrders() {
    const query = byId('orders-search').value.trim().toLowerCase();
    return ordersOfTab(ordersTab).filter((order) => {
        const text = [order.number, order.responsible, order.address, ...order.items.map((item) => item.name)].join(' ');
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
        [order.type === 'writeoff' ? 'Дата списания' : 'Дата отгрузки', formatOrderDay(order.shipmentDate)],
        ['Ответственный', order.responsible], ['Место хранения', order.location], ['Адрес', order.address],
        [ORDER_COMPLETIONS[order.type]?.person, order.completedBy], ['Примечание', order.note],
    ]) {
        if (!value) continue;
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
    byId('order-total').textContent = `${orderQuantity(order)} шт.`;
    byId('order-complete').hidden = order.status !== 'reserved';
    byId('order-complete').disabled = ordersBusy;
    byId('order-complete').textContent = `${ORDER_COMPLETIONS[order.type]?.action ?? 'Завершить'} заказ`;
    byId('order-cancel').hidden = !isOrderCancellable(order);
    byId('order-cancel').disabled = ordersBusy;
}

function renderOrders() {
    for (const tab of ORDER_TABS) {
        byId(`orders-count-${tab}`).textContent = String(ordersOfTab(tab).length);
        byId(`orders-tab-${tab}`).classList.toggle('active', tab === ordersTab);
    }
    const visible = visibleOrders();
    byId('orders-body').replaceChildren(...visible.map(createOrderRow));
    byId('orders-empty').hidden = visible.length > 0 || ordersLoadFailed;
    byId('orders-empty').textContent = orders.length
        ? 'По заданным условиям заказы не найдены.'
        : 'Заказов пока нет. Чтобы создать заказ или приёмку, откройте меню «…».';
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

export function openOrder(id) {
    selectedOrderId = id;
    location.hash = '#orders';
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

function applyOrder(updated) {
    ordersRequest++;
    orders = orders.map((order) => order.id === updated.id ? updated : order);
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
        applyOrder(cancelled);
        forgetReceiving(id);
        const result = cancelled.type === 'receiving' ? 'Остаток товара не изменён.' : 'Бронь снята.';
        showStatus(byId('orders-status'), `Заказ ${cancelled.number} отменён. ${result}`);
    } catch (error) {
        await loadOrders();
        showError(byId('orders-status'), error);
    } finally {
        ordersBusy = false;
        renderOrders();
    }
}

function createCompletionRow(item, stock) {
    const row = document.createElement('tr');
    const name = createOrderCell(item.name);
    name.className = 'text-break';
    const quantity = createOrderCell(String(item.quantity));
    quantity.className = 'text-end';
    row.append(name, quantity,
        createStockChangeCell(stock.reserved, stock.reserved - item.quantity, 'text-success'),
        createStockChangeCell(stock.count, stock.count - item.quantity, 'text-danger'));
    return row;
}

async function askOrderComplete() {
    const order = orders.find((item) => item.id === selectedOrderId);
    const completion = ORDER_COMPLETIONS[order.type];
    const request = ++orderCompleteRequest;
    orderToComplete = order;
    byId('order-complete-title').textContent = `${completion.action} заказ ${order.number}?`;
    byId('order-complete-text').textContent = completion.text;
    byId('order-complete-column').textContent = completion.column;
    byId('order-complete-date-label').textContent = completion.date;
    byId('order-complete-person-label').textContent = completion.person;
    byId('order-complete-date').value = todayForInput();
    byId('order-complete-person').value = order.responsible;
    byId('order-complete-confirm').textContent = completion.action;
    byId('order-complete-confirm').disabled = true;
    byId('order-complete-items').replaceChildren();
    showStatus(byId('order-complete-status'), 'Загрузка остатков…');
    try {
        const stocks = await callBackend('GetProductStocks');
        if (request !== orderCompleteRequest) return;
        byId('order-complete-items').replaceChildren(...order.items.map((item) => {
            return createCompletionRow(item, stocks.find((stock) => stock.id === item.productId));
        }));
        byId('order-complete-confirm').disabled = false;
        showStatus(byId('order-complete-status'), '');
    } catch (error) {
        if (request === orderCompleteRequest) showError(byId('order-complete-status'), error);
    }
}

async function confirmOrderComplete() {
    if (ordersBusy || !orderToComplete) return;
    const request = {
        date: byId('order-complete-date').value,
        completedBy: byId('order-complete-person').value.trim(),
    };
    if (!request.date || !request.completedBy) {
        showError(byId('order-complete-status'), new Error('Укажите дату и ФИО сотрудника.'));
        return;
    }
    const id = orderToComplete.id;
    ordersBusy = true;
    byId('order-complete-confirm').disabled = true;
    showStatus(byId('order-complete-status'), 'Сохранение…');
    renderOrders();
    try {
        const { order } = await callBackend('CompleteOutgoing', id, request);
        applyOrder(order);
        orderToComplete = null;
        hideModal('order-complete-modal');
        showStatus(byId('orders-status'), `Заказ ${order.number} ${ORDER_COMPLETIONS[order.type].done}. Остаток обновлён.`);
    } catch (error) {
        await loadOrders();
        showError(byId('order-complete-status'), error);
    } finally {
        ordersBusy = false;
        byId('order-complete-confirm').disabled = false;
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
    byId('order-complete').addEventListener('click', askOrderComplete);
    byId('order-complete-confirm').addEventListener('click', confirmOrderComplete);
    for (const tab of ORDER_TABS) {
        byId(`orders-tab-${tab}`).addEventListener('click', () => {
            ordersTab = tab;
            renderOrders();
        });
    }
}
