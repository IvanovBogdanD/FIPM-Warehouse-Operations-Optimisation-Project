import { callBackend } from '../../shared/api.js';
import { byId, showError, showStatus } from '../../shared/dom.js';
import { createProductSearch } from '../../shared/product-search.js';
import { cellName, createWarehouseGrid } from '../../shared/warehouse-grid.js';

let receivingItems = [];
let receivingManagers = [];
let receivingOrder = null;
let receivingBusy = false;
let receivingLoaded = false;
let receivingSearch;
let receivingGrid;
let receivingStocks = [];
let receivingCellChoice = null;

function renderPlacement() {
    byId('receiving-cell-picker').hidden = byId('receiving-placement').value !== 'manual';
    byId('receiving-cell-label').textContent = receivingCellChoice ? `Выбрана ячейка ${cellName(receivingCellChoice.x, receivingCellChoice.y)}` : 'Выберите свободную ячейку.';
    receivingGrid.render(receivingStocks, receivingCellChoice);
}

export function validateReceiving(productId, quantity, location) {
    if (!Number.isSafeInteger(productId) || productId <= 0) throw new Error('Выберите товар.');
    if (!/^[0-9]+$/.test(quantity) || !Number.isSafeInteger(Number(quantity)) || Number(quantity) <= 0) {
        throw new Error('Количество должно быть целым числом от 1 до 9007199254740991.');
    }
    if (!location.trim()) throw new Error('Укажите место хранения.');
    return { productId, quantity, location: location.trim() };
}

function updateReceivingControls() {
    const disabled = receivingBusy || !receivingLoaded || receivingOrder !== null;
    byId('receiving-fields').disabled = disabled;
    byId('receiving-product-search').disabled = disabled;
    byId('reload-receiving').disabled = receivingBusy;
    for (const id of ['complete-receiving', 'cancel-receiving', 'new-receiving']) byId(id).disabled = receivingBusy;
}

function receivingCell(value, className = '') {
    const cell = document.createElement('td');
    cell.textContent = value;
    cell.className = className;
    return cell;
}

function renderReceivingItems() {
    const rows = receivingItems.map((item, index) => {
        const row = document.createElement('tr');
        const quantity = document.createElement('input');
        quantity.type = 'text'; quantity.inputMode = 'numeric'; quantity.pattern = '[0-9]+';
        quantity.required = true; quantity.className = 'form-control'; quantity.value = item.quantity;
        quantity.setAttribute('aria-label', `Принимаемое количество: ${item.product.name}`);
        quantity.addEventListener('input', () => { item.quantity = quantity.value; });
        const amount = document.createElement('td'); amount.append(quantity);
        const remove = document.createElement('button');
        remove.type = 'button'; remove.className = 'btn btn-outline-danger btn-sm'; remove.textContent = 'Убрать';
        remove.setAttribute('aria-label', `Убрать: ${item.product.name}`);
        remove.addEventListener('click', () => { receivingItems.splice(index, 1); renderReceivingItems(); });
        const actions = document.createElement('td'); actions.append(remove);
        row.append(receivingCell(item.product.name, 'text-break'), receivingCell(item.product.count, 'text-end'), amount, actions);
        return row;
    });
    byId('receiving-items').replaceChildren(...rows);
    byId('receiving-items-empty').hidden = receivingItems.length > 0;
}

function renderReceivingOrder() {
    byId('receiving-empty').hidden = receivingOrder !== null;
    byId('receiving-confirmation').hidden = receivingOrder === null;
    byId('receiving-summary').replaceChildren();
    byId('receiving-summary-items').replaceChildren();
    if (!receivingOrder) return;
    const completed = receivingOrder.status === 'completed';
    byId('receiving-order-status').className = completed ? 'badge text-bg-success mb-3' : 'badge text-bg-primary mb-3';
    byId('receiving-order-status').textContent = completed ? 'Завершён' : 'Черновик';
    byId('receiving-order-id').textContent = `Номер: ${receivingOrder.number}`;
    for (const [label, value] of [['Ответственный', receivingOrder.responsible], ['Позиций', receivingOrder.items.length], ['Ячейка', receivingOrder.location]]) {
        const term = document.createElement('dt'); term.textContent = label;
        const definition = document.createElement('dd'); definition.textContent = value;
        byId('receiving-summary').append(term, definition);
    }
    for (const item of receivingOrder.items) {
        const row = document.createElement('tr');
        const name = document.createElement('td');
        const link = document.createElement('a'); link.href = `#product/${item.product.id}`; link.textContent = item.product.name;
        const location = document.createElement('div'); location.className = 'small text-body-secondary'; location.textContent = item.location;
        name.append(link, location);
        row.append(name, receivingCell(item.quantity, 'text-end'), receivingCell(item.product.count, 'text-end'));
        byId('receiving-summary-items').append(row);
    }
    byId('receiving-actions').hidden = completed;
    byId('new-receiving').hidden = !completed;
    byId('receiving-completed-count').hidden = !completed;
    byId('receiving-completed-count').textContent = 'Остатки всех позиций сохранены.';
}

function applyReceivingOrder(order) {
    receivingOrder = order;
    receivingItems = order.items.map((item) => ({ product: item.product, quantity: String(item.quantity), location: item.location }));
    renderReceivingItems();
    renderReceivingOrder();
}

export async function loadReceiving() {
    if (receivingBusy) return;
    receivingSearch.close();
    receivingBusy = true;
    receivingLoaded = false;
    updateReceivingControls();
    showStatus(byId('receiving-status'), 'Загрузка менеджеров...');
    try {
        const [managers, stocks] = await Promise.all([callBackend('GetManagers'), callBackend('GetWarehouseStocks')]);
        receivingStocks = stocks;
        if (receivingOrder) receivingOrder = await callBackend('GetReceiving', receivingOrder.id);
        const selected = byId('receiving-responsible').value;
        const placeholder = document.createElement('option'); placeholder.value = ''; placeholder.textContent = 'Выберите менеджера';
        const options = managers.map((manager) => {
            const option = document.createElement('option'); option.value = String(manager.id); option.textContent = manager.name;
            return option;
        });
        byId('receiving-responsible').replaceChildren(placeholder, ...options);
        byId('receiving-responsible').value = selected;
        receivingManagers = managers;
        receivingLoaded = managers.length > 0;
        renderReceivingItems(); renderReceivingOrder(); renderPlacement();
        showStatus(byId('receiving-status'), receivingOrder
            ? receivingOrder.status === 'completed' ? 'Приёмка завершена. Остатки сохранены.' : 'Проверьте состав заказа. Остатки ещё не изменены.'
            : managers.length ? 'Выберите менеджера и добавьте товары через поиск.' : 'Нет одобренных менеджеров. Создание приёмки недоступно.');
    } catch (error) { showError(byId('receiving-status'), error); }
    finally { receivingBusy = false; updateReceivingControls(); }
}

function resetReceiving() {
    receivingOrder = null;
    receivingItems = [];
    receivingCellChoice = null;
    byId('receiving-form').reset();
    renderPlacement();
    renderReceivingItems(); renderReceivingOrder(); updateReceivingControls();
}

export function forgetReceiving(id) {
    if (receivingOrder?.id !== id) return;
    resetReceiving();
    showStatus(byId('receiving-status'), 'Черновик отменён. Остатки не изменены.');
}

async function createReceiving(event) {
    event.preventDefault();
    if (receivingBusy || receivingOrder || !receivingLoaded) return;
    try {
        const manager = receivingManagers.find((item) => item.id === Number(byId('receiving-responsible').value));
        if (!manager) throw new Error('Выберите ответственного менеджера.');
        if (!receivingItems.length) throw new Error('Добавьте хотя бы один товар.');
        const placement = byId('receiving-placement').value;
        if (placement === 'manual' && !receivingCellChoice) throw new Error('Выберите свободную ячейку на карте.');
        const location = placement === 'manual' ? cellName(receivingCellChoice.x, receivingCellChoice.y) : 'Автоматически при подтверждении';
        const items = receivingItems.map((item) => validateReceiving(item.product.id, item.quantity, location));
        if (!Number.isSafeInteger(items.reduce((total, item) => total + Number(item.quantity), 0))) throw new Error('Общее количество в заказе превышает допустимый предел.');
        receivingBusy = true; receivingSearch.close(); updateReceivingControls();
        showStatus(byId('receiving-status'), 'Создание черновика...');
        applyReceivingOrder(await callBackend('CreateReceiving', {
            responsibleId: manager.id, items, placement,
            x: placement === 'manual' ? receivingCellChoice.x : 0,
            y: placement === 'manual' ? receivingCellChoice.y : 0,
        }));
        showStatus(byId('receiving-status'), 'Черновик создан. Проверьте товары и подтвердите приёмку. Остатки ещё не изменены.');
    } catch (error) { showError(byId('receiving-status'), error); }
    finally { receivingBusy = false; updateReceivingControls(); }
}

async function completeReceiving() {
    if (receivingBusy || !receivingOrder || receivingOrder.status !== 'pending') return;
    receivingBusy = true; updateReceivingControls();
    showStatus(byId('receiving-status'), 'Сохранение приёмки...');
    try {
        applyReceivingOrder(await callBackend('CompleteReceiving', receivingOrder.id));
        showStatus(byId('receiving-status'), 'Приёмка завершена. Остатки всех позиций сохранены.');
        window.dispatchEvent(new Event('stock-changed'));
    } catch (error) { showError(byId('receiving-status'), error); }
    finally { receivingBusy = false; updateReceivingControls(); }
}

async function cancelReceiving() {
    if (receivingBusy || !receivingOrder || receivingOrder.status !== 'pending') return;
    receivingBusy = true; updateReceivingControls();
    try {
        await callBackend('CancelReceiving', receivingOrder.id);
        resetReceiving();
        showStatus(byId('receiving-status'), 'Черновик отменён. Остатки не изменены.');
    } catch (error) { showError(byId('receiving-status'), error); }
    finally { receivingBusy = false; updateReceivingControls(); }
}

export function initReceiving() {
    receivingGrid = createWarehouseGrid(byId('receiving-grid'), (cell) => { receivingCellChoice = cell; renderPlacement(); }, true);
    byId('receiving-placement').addEventListener('change', renderPlacement);
    receivingSearch = createProductSearch({ prefix: 'receiving', onChoose(product) {
        if (receivingItems.some((item) => item.product.id === product.id)) {
            showStatus(byId('receiving-status'), 'Товар уже добавлен. Измените количество в его строке.');
            return;
        }
        receivingItems.push({ product, quantity: '1' });
        byId('receiving-product-search').value = '';
        renderReceivingItems();
    } });
    byId('reload-receiving').addEventListener('click', loadReceiving);
    byId('receiving-form').addEventListener('submit', createReceiving);
    byId('complete-receiving').addEventListener('click', completeReceiving);
    byId('cancel-receiving').addEventListener('click', cancelReceiving);
    byId('new-receiving').addEventListener('click', () => { resetReceiving(); return loadReceiving(); });
}
