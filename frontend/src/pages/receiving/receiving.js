import { callBackend } from '../../shared/api.js';
import { byId, showError, showStatus } from '../../shared/dom.js';

let receivingProducts = [];
let receivingOrder = null;
let receivingBusy = false;
let receivingLoaded = false;

export function validateReceiving(productId, quantity, responsible, location) {
    if (!Number.isSafeInteger(productId) || productId <= 0) throw new Error('Выберите товар.');
    if (!/^[0-9]+$/.test(quantity) || !Number.isSafeInteger(Number(quantity)) || Number(quantity) <= 0) {
        throw new Error('Количество должно быть целым числом от 1 до 9007199254740991.');
    }
    if (!responsible.trim() || !location.trim()) throw new Error('Укажите ФИО ответственного и место хранения.');
    return { productId, quantity, responsible: responsible.trim(), location: location.trim() };
}

function updateReceivingControls() {
    byId('receiving-fields').disabled = receivingBusy || !receivingLoaded || receivingOrder !== null;
    byId('reload-receiving').disabled = receivingBusy;
    byId('complete-receiving').disabled = receivingBusy;
    byId('cancel-receiving').disabled = receivingBusy;
    byId('new-receiving').disabled = receivingBusy;
}

function updateReceivingCount() {
    const selected = Number(byId('receiving-product').value);
    const product = receivingProducts.find((item) => item.id === selected);
    byId('receiving-current-count').textContent = product ? `${product.count} шт.` : 'Не выбран';
}

function renderReceivingOrder() {
    byId('receiving-empty').hidden = receivingOrder !== null;
    byId('receiving-confirmation').hidden = receivingOrder === null;
    byId('receiving-summary').replaceChildren();
    if (!receivingOrder) return;
    const completed = receivingOrder.status === 'completed';
    byId('receiving-order-status').className = completed ? 'badge text-bg-success mb-3' : 'badge text-bg-primary mb-3';
    byId('receiving-order-status').textContent = completed ? 'Завершён' : 'Черновик';
    byId('receiving-order-id').textContent = `Номер: ${receivingOrder.id}`;
    for (const [label, value] of [
        ['Товар', receivingOrder.product.name], ['Принимаемое количество', `${receivingOrder.quantity} шт.`],
        ['Ответственный', receivingOrder.responsible], ['Место хранения', receivingOrder.location],
    ]) {
        const term = document.createElement('dt');
        const definition = document.createElement('dd');
        term.className = 'mt-3';
        term.textContent = label;
        definition.className = 'text-break';
        definition.textContent = value;
        byId('receiving-summary').append(term, definition);
    }
    byId('receiving-actions').hidden = completed;
    byId('new-receiving').hidden = !completed;
    byId('receiving-completed-count').hidden = !completed;
    byId('receiving-completed-count').textContent = `Остаток после завершения: ${receivingOrder.product.count} шт.`;
    byId('receiving-product-link').href = `#product/${receivingOrder.product.id}`;
}

function applyReceivingOrder(order) {
    receivingOrder = order;
    receivingProducts = receivingProducts.map((product) => product.id === order.product.id ? order.product : product);
    updateReceivingCount();
    renderReceivingOrder();
}

export async function loadReceiving() {
    if (receivingBusy) return;
    receivingBusy = true;
    receivingLoaded = false;
    updateReceivingControls();
    showStatus(byId('receiving-status'), 'Загрузка товаров…');
    try {
        const products = await callBackend('GetAllProducts');
        if (receivingOrder) receivingOrder = await callBackend('GetReceiving', receivingOrder.id);
        const selected = byId('receiving-product').value;
        const options = products.map((product) => {
            const option = document.createElement('option');
            option.value = String(product.id);
            option.textContent = product.name;
            return option;
        });
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'Выберите товар';
        byId('receiving-product').replaceChildren(placeholder, ...options);
        byId('receiving-product').value = selected;
        receivingProducts = products;
        receivingLoaded = products.length > 0;
        updateReceivingCount();
        renderReceivingOrder();
        let message = 'Каталог пуст. Приёмка недоступна.';
        if (products.length > 0) message = 'Выберите товар и заполните данные приёмки.';
        if (receivingOrder) {
            message = receivingOrder.status === 'completed'
                ? 'Приёмка завершена. Остаток сохранён.'
                : 'Проверьте черновик и подтвердите приёмку. Остаток ещё не изменён.';
        }
        showStatus(byId('receiving-status'), message);
    } catch (error) {
        showError(byId('receiving-status'), error);
    } finally {
        receivingBusy = false;
        updateReceivingControls();
    }
}

function resetReceiving() {
    receivingOrder = null;
    byId('receiving-form').reset();
    renderReceivingOrder();
    updateReceivingCount();
    updateReceivingControls();
}

async function createReceiving(event) {
    event.preventDefault();
    if (receivingBusy || receivingOrder || !receivingLoaded) return;
    try {
        const request = validateReceiving(Number(byId('receiving-product').value), byId('receiving-quantity').value,
            byId('receiving-responsible').value, byId('receiving-location').value);
        receivingBusy = true;
        updateReceivingControls();
        showStatus(byId('receiving-status'), 'Создание черновика…');
        applyReceivingOrder(await callBackend('CreateReceiving', request));
        showStatus(byId('receiving-status'), 'Черновик создан. Проверьте данные и подтвердите приёмку. Остаток ещё не изменён.');
    } catch (error) {
        showError(byId('receiving-status'), error);
    } finally {
        receivingBusy = false;
        updateReceivingControls();
    }
}

async function completeReceiving() {
    if (receivingBusy || !receivingOrder || receivingOrder.status !== 'pending') return;
    receivingBusy = true;
    updateReceivingControls();
    showStatus(byId('receiving-status'), 'Сохранение приёмки…');
    try {
        applyReceivingOrder(await callBackend('CompleteReceiving', receivingOrder.id));
        showStatus(byId('receiving-status'), `Приёмка завершена. Остаток: ${receivingOrder.product.count} шт.`);
        window.dispatchEvent(new Event('stock-changed'));
    } catch (error) {
        showError(byId('receiving-status'), error);
    } finally {
        receivingBusy = false;
        updateReceivingControls();
    }
}

async function cancelReceiving() {
    if (receivingBusy || !receivingOrder || receivingOrder.status !== 'pending') return;
    receivingBusy = true;
    updateReceivingControls();
    try {
        await callBackend('CancelReceiving', receivingOrder.id);
        resetReceiving();
        showStatus(byId('receiving-status'), 'Черновик отменён. Остаток не изменён.');
    } catch (error) {
        showError(byId('receiving-status'), error);
    } finally {
        receivingBusy = false;
        updateReceivingControls();
    }
}

export function initReceiving() {
    byId('reload-receiving').addEventListener('click', loadReceiving);
    byId('receiving-product').addEventListener('change', updateReceivingCount);
    byId('receiving-form').addEventListener('submit', createReceiving);
    byId('complete-receiving').addEventListener('click', completeReceiving);
    byId('cancel-receiving').addEventListener('click', cancelReceiving);
    byId('new-receiving').addEventListener('click', () => { resetReceiving(); loadReceiving(); });
}
