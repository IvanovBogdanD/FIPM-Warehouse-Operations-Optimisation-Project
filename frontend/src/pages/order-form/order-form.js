import { callBackend } from '../../shared/api.js';
import { byId, showError, showStatus } from '../../shared/dom.js';
import { showModal } from '../../shared/modal.js';
import { createOrderCell, createStockChangeCell, openOrder, orderQuantity, ORDER_TYPES, todayForInput } from '../orders/orders.js';

let formType = 'shipment';
let formStocks = [];
let formItems = [];
let formLoaded = false;
let formBusy = false;
let formRequest = 0;
let createdOrderId = null;

function isValidQuantity(value) {
    return /^[0-9]+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) > 0;
}

function stockOf(item) {
    return formStocks.find((stock) => stock.id === item.productId);
}

export function buildOrderRequest() {
    const date = byId('order-form-date').value;
    const address = byId('order-form-address').value.trim();
    const responsible = byId('order-form-responsible').value.trim();
    if (!date) throw new Error('Укажите дату.');
    if (!responsible || !address) throw new Error('Укажите ФИО ответственного и адрес.');
    if (formItems.length === 0) throw new Error('Добавьте хотя бы один товар.');
    for (const item of formItems) {
        const stock = stockOf(item);
        if (!isValidQuantity(item.quantity)) throw new Error(`Количество «${stock.name}» должно быть целым числом больше нуля.`);
        if (Number(item.quantity) > stock.free) throw new Error(`Исправьте количество «${stock.name}»: свободно только ${stock.free} шт.`);
    }
    return {
        type: formType, date, address, responsible, note: byId('order-form-note').value.trim(),
        items: formItems.map((item) => ({ productId: item.productId, quantity: item.quantity })),
    };
}

function updateOrderFormControls() {
    byId('order-form-fields').disabled = formBusy || !formLoaded;
}

function renderOrderFormSummary() {
    const validItems = formItems.filter((item) => isValidQuantity(item.quantity));
    const date = byId('order-form-date').value;
    byId('order-form-summary').replaceChildren();
    for (const [label, value] of [
        ['Тип', ORDER_TYPES[formType]], ['Позиций', String(formItems.length)],
        ['Всего единиц', `${validItems.reduce((sum, item) => sum + Number(item.quantity), 0)} шт.`],
        ['Дата', date ? date.split('-').reverse().join('.') : '—'],
    ]) {
        const term = document.createElement('dt');
        const definition = document.createElement('dd');
        term.textContent = label;
        definition.textContent = value;
        byId('order-form-summary').append(term, definition);
    }
}

function renderProductOptions() {
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'Добавить товар…';
    const options = formStocks.filter((stock) => !formItems.some((item) => item.productId === stock.id)).map((stock) => {
        const option = document.createElement('option');
        option.value = String(stock.id);
        option.textContent = `${stock.name} — свободно ${stock.free}`;
        option.disabled = stock.free <= 0;
        return option;
    });
    byId('order-form-product').replaceChildren(placeholder, ...options);
    byId('order-form-product').value = '';
}

function createQuantityButton(text, label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn btn-outline-secondary';
    button.textContent = text;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', onClick);
    return button;
}

function createItemRow(item) {
    const stock = stockOf(item);
    const row = document.createElement('tr');
    const input = document.createElement('input');
    const problem = document.createElement('div');
    const left = createOrderCell();
    const refresh = () => {
        const valid = isValidQuantity(item.quantity);
        const tooMuch = valid && Number(item.quantity) > stock.free;
        input.classList.toggle('is-invalid', !valid || tooMuch);
        left.classList.toggle('text-danger', tooMuch);
        left.textContent = valid ? String(stock.free - Number(item.quantity)) : '—';
        problem.textContent = tooMuch ? 'Больше свободного остатка' : valid ? '' : 'Введите целое число больше нуля';
        renderOrderFormSummary();
    };
    const setQuantity = (value) => {
        item.quantity = value;
        input.value = value;
        refresh();
    };

    input.className = 'form-control text-center';
    input.type = 'text';
    input.inputMode = 'numeric';
    input.value = item.quantity;
    input.setAttribute('aria-label', `Количество: ${stock.name}`);
    input.addEventListener('input', () => {
        item.quantity = input.value.trim();
        refresh();
    });
    problem.className = 'small text-danger';
    left.className = 'text-end fw-semibold';

    const group = document.createElement('div');
    group.className = 'input-group input-group-sm flex-nowrap';
    group.append(
        createQuantityButton('−', `Уменьшить: ${stock.name}`, () => setQuantity(String(Math.max(1, (Number(item.quantity) || 0) - 1)))),
        input,
        createQuantityButton('+', `Увеличить: ${stock.name}`, () => setQuantity(String((Number(item.quantity) || 0) + 1))),
    );

    const remove = createQuantityButton('✕', `Убрать: ${stock.name}`, () => {
        formItems = formItems.filter((other) => other !== item);
        renderOrderForm();
    });
    remove.className = 'btn btn-outline-danger btn-sm';

    const name = createOrderCell(stock.name);
    name.className = 'fw-semibold text-break';
    const free = createOrderCell(String(stock.free));
    free.className = 'text-end';
    row.append(name, free, createOrderCell(group, problem), left, createOrderCell(remove));
    item.refresh = refresh;
    return row;
}

function renderOrderForm() {
    renderProductOptions();
    byId('order-form-items').replaceChildren(...formItems.map(createItemRow));
    byId('order-form-items-empty').hidden = formItems.length > 0;
    for (const item of formItems) item.refresh();
    renderOrderFormSummary();
}

export async function loadOrderForm(type) {
    const request = ++formRequest;
    formType = type;
    byId('order-form-type-shipment').classList.toggle('active', type === 'shipment');
    byId('order-form-type-writeoff').classList.toggle('active', type === 'writeoff');
    byId('order-form-date-label').textContent = type === 'writeoff' ? 'Дата списания' : 'Дата отгрузки';
    if (!byId('order-form-date').value) byId('order-form-date').value = todayForInput();
    formLoaded = false;
    updateOrderFormControls();
    showStatus(byId('order-form-status'), 'Загрузка товаров…');
    try {
        const stocks = await callBackend('GetProductStocks');
        if (request !== formRequest) return;
        formStocks = stocks;
        formItems = formItems.filter((item) => stockOf(item));
        formLoaded = stocks.length > 0;
        renderOrderForm();
        showStatus(byId('order-form-status'), stocks.length ? '' : 'Каталог пуст. Создать заказ нельзя.');
    } catch (error) {
        if (request !== formRequest) return;
        showError(byId('order-form-status'), error);
    }
    updateOrderFormControls();
}

function showOrderCreated(order, stocks) {
    createdOrderId = order.id;
    byId('order-created-title').textContent = `Заказ ${order.number} создан`;
    byId('order-created-text').textContent = `Товары забронированы. Свободный остаток уменьшен на ${orderQuantity(order)} шт.`;
    byId('order-created-items').replaceChildren(...order.items.map((item) => {
        const stock = stocks.find((other) => other.id === item.productId);
        const row = document.createElement('tr');
        const name = createOrderCell(item.name);
        name.className = 'text-break';
        const total = createOrderCell(String(stock.count));
        total.className = 'text-end';
        row.append(name, createStockChangeCell(stock.free + item.quantity, stock.free, 'text-danger'),
            createStockChangeCell(stock.reserved - item.quantity, stock.reserved, 'text-warning-emphasis'), total);
        return row;
    }));
    showModal('order-created-modal');
}

async function submitOrderForm(event) {
    event.preventDefault();
    if (formBusy || !formLoaded) return;
    try {
        const request = buildOrderRequest();
        formBusy = true;
        updateOrderFormControls();
        showStatus(byId('order-form-status'), 'Создание заказа…');
        const { order, stock } = await callBackend('CreateOutgoing', request);
        showOrderCreated(order, stock);
        formItems = [];
        byId('order-form').reset();
        await loadOrderForm(formType);
    } catch (error) {
        showError(byId('order-form-status'), error);
    } finally {
        formBusy = false;
        updateOrderFormControls();
    }
}

export function initOrderForm() {
    byId('order-form').addEventListener('submit', submitOrderForm);
    byId('order-form-reload').addEventListener('click', () => loadOrderForm(formType));
    byId('order-form-date').addEventListener('input', renderOrderFormSummary);
    byId('order-form-product').addEventListener('change', () => {
        const productId = Number(byId('order-form-product').value);
        if (!productId) return;
        formItems = [...formItems, { productId, quantity: '1' }];
        renderOrderForm();
    });
    byId('order-created-list').addEventListener('click', () => { location.hash = '#orders'; });
    byId('order-created-open').addEventListener('click', () => openOrder(createdOrderId));
}
