import { callBackend } from '../../shared/api.js';
import { byId, showError, showStatus } from '../../shared/dom.js';
import { cellName, createWarehouseGrid } from '../../shared/warehouse-grid.js';

let movementGrid;
let movementStocks = [];
let movementSelected = null;
let movementMode = 'browse';
let movementStock = null;
let movementQuantity = 0;
let movementMergeSources = [];
let movementDestination = null;
let movementHighlightedProduct = null;
let movementShowItems = false;
let movementVersion = 0;

const cellItems = (cell) => cell ? movementStocks.filter((item) => item.x === cell.x && item.y === cell.y) : [];
const uniqueProducts = () => [...new Map(movementStocks.map((item) => [item.productId, item])).values()].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
const sameCell = (a, b) => a && b && a.x === b.x && a.y === b.y;

function setMovementStatus(message, tone = '') {
    const element = byId('movements-status');
    for (const name of ['text-danger', 'text-success', 'text-warning', 'text-info']) element.classList.remove(name);
    if (tone) element.classList.add(`text-${tone}`);
    element.textContent = message;
}

function button(label, cls, action, disabled = false) {
    const el = document.createElement('button');
    el.type = 'button'; el.className = `btn ${cls}`; el.textContent = label;
    el.disabled = disabled;
    el.addEventListener('click', action);
    return el;
}
function paragraph(text, cls = 'small text-body-secondary') {
    const el = document.createElement('p'); el.className = cls; el.textContent = text; return el;
}
function setMode(next) {
    movementMode = next;
    if (next !== 'browse') movementShowItems = false;
    byId('movements-cancel').hidden = next === 'browse';
    render();
}
function clearProductFilter() {
    movementHighlightedProduct = null;
    byId('movements-product').value = '';
    byId('movements-find').disabled = true;
    byId('movements-back').hidden = true;
}
function renderGrid() {
    const marked = new Set();
    if (movementHighlightedProduct !== null) {
        movementStocks.filter((s) => s.productId === movementHighlightedProduct).forEach((s) => marked.add(`${s.x}:${s.y}`));
    }
    if (movementMode === 'merge-select' || movementMode === 'merge-target') {
        movementMergeSources.slice(1).forEach((c) => marked.add(`${c.x}:${c.y}`));
    }
    // During the first movement step the map is deliberately non-interactive.
    const disabled = movementMode === 'move-choose';
    const highlightVariant = movementMode === 'merge-select' || movementMode === 'merge-target' ? 'info' : 'success';
    movementGrid.render(movementStocks, movementSelected, disabled, marked, highlightVariant,
        movementDestination, movementMode === 'merge-select');
}
function renderDetails() {
    const card = byId('movements-details-card');
    card.classList.toggle('movements-operation-card', movementMode === 'move-target' || movementMode === 'merge-target');
    const title = byId('movements-cell-title');
    const empty = byId('movements-cell-empty');
    const list = byId('movements-cell-items');
    list.classList.remove('movements-items-popover');
    list.hidden = false;

    if (movementMode === 'move-target') {
        title.textContent = 'Перемещение товара';
        empty.hidden = false;
        empty.textContent = 'Выберите ячейку назначения на карте.';
        list.replaceChildren();
        return;
    }
    if (movementMode === 'merge-target') {
        title.textContent = 'Объединение ячеек';
        empty.hidden = false;
        empty.textContent = 'Выберите ячейку назначения на карте.';
        list.replaceChildren();
        return;
    }

    title.textContent = movementSelected ? `Ячейка ${cellName(movementSelected.x, movementSelected.y)}` : 'Содержимое ячейки';
    const items = cellItems(movementSelected);
    empty.hidden = items.length > 0;
    empty.textContent = movementSelected ? 'Ячейка свободна.' : 'Выберите ячейку на карте.';

    const createItemLink = (item) => {
        const link = document.createElement('a');
        link.href = `#product/${item.productId}`;
        link.className = 'list-group-item list-group-item-action px-2 py-2';
        const name = document.createElement('strong');
        name.className = 'd-block';
        name.textContent = item.name;
        const count = document.createElement('span');
        count.className = 'd-block mt-1';
        count.textContent = `${item.count.toLocaleString('ru-RU')} шт.`;
        const date = document.createElement('span');
        date.className = 'small text-body-secondary';
        date.textContent = item.receivedAt ? `Поступление: ${new Date(item.receivedAt).toLocaleString('ru-RU')}` : 'Дата поступления не указана';
        link.append(name, count, date);
        return link;
    };

    if (items.length > 1 && movementShowItems) {
        list.classList.add('movements-items-popover');
        const header = document.createElement('div');
        header.className = 'd-flex align-items-center justify-content-between gap-2 px-2 py-2 border-bottom mb-1';
        const heading = document.createElement('strong');
        heading.className = 'small';
        heading.textContent = `Все товары в ячейке · ${items.length}`;
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'btn-close';
        close.setAttribute('aria-label', 'Закрыть список товаров');
        close.addEventListener('click', () => { movementShowItems = false; render(); });
        header.append(heading, close);
        list.replaceChildren(header, ...items.map(createItemLink));
        return;
    }

    if (items.length > 0) {
        const firstItem = createItemLink(items[0]);
        list.replaceChildren(firstItem);
        if (items.length > 1) {
            const showAll = document.createElement('a');
            showAll.href = '#all-items';
            showAll.className = 'd-inline-flex align-items-center gap-1 small fw-semibold text-success px-2 py-2 movements-show-all-link';
            showAll.textContent = 'Ко всем товарам';
            showAll.setAttribute('aria-label', `Ко всем товарам в ячейке, ${items.length} позиций`);
            showAll.addEventListener('click', (event) => {
                event.preventDefault();
                event.stopPropagation();
                movementShowItems = true;
                render();
            });
            list.append(showAll);
        }
    } else {
        list.replaceChildren();
    }
}
function renderActions() {
    const root = byId('movements-actions'); root.replaceChildren();
    const operationActive = movementMode !== 'browse';
    byId('movements-product').disabled = operationActive;
    byId('movements-find').disabled = operationActive || !byId('movements-product').value;
    byId('movements-back').disabled = operationActive;
    byId('movements-reload').disabled = operationActive;
    if (!movementSelected || movementMode === 'browse') {
        if (movementSelected && cellItems(movementSelected).length) {
            root.append(button('Переместить товар', 'btn-primary w-100 mb-2', () => {
                movementStock = null; movementQuantity = 0; movementDestination = null; movementShowItems = false; setMode('move-choose');
            }));
            root.append(button('Объединить ячейки', 'btn-outline-primary w-100', () => {
                movementMergeSources = [movementSelected]; movementDestination = null; movementShowItems = false; setMode('merge-select');
            }));
        }
        return;
    }

    if (movementMode === 'move-choose') {
        root.append(paragraph('Шаг 1. Выберите товар и количество для перемещения.', 'fw-semibold mb-2'));
        const select = document.createElement('select'); select.className = 'form-select mb-2';
        select.setAttribute('aria-label', 'Товар для перемещения');
        const placeholder = document.createElement('option');
        placeholder.value = ''; placeholder.textContent = 'Выберите товар'; placeholder.disabled = true; placeholder.selected = true; placeholder.hidden = true;
        select.append(placeholder);
        for (const item of cellItems(movementSelected)) {
            const option = document.createElement('option'); option.value = item.id; option.textContent = `${item.name} — ${item.count} шт.`; select.append(option);
        }
        const quantity = document.createElement('input');
        quantity.type = 'number'; quantity.min = '1'; quantity.step = '1'; quantity.max = '0';
        quantity.className = 'form-control mb-2'; quantity.placeholder = 'Количество'; quantity.disabled = true;
        const all = button('Переместить всё количество', 'btn-outline-secondary w-100 mb-2', () => {
            const item = cellItems(movementSelected).find((s) => String(s.id) === select.value);
            if (!item) return;
            quantity.value = String(item.count);
            quantity.dispatchEvent(new Event('input', { bubbles: true }));
        }, true);
        const next = button('Выбрать место хранения', 'btn-primary w-100', () => {
            const item = cellItems(movementSelected).find((s) => String(s.id) === select.value);
            const amount = Number(quantity.value);
            if (!item || !Number.isInteger(amount) || amount < 1 || amount > item.count) return;
            movementStock = item; movementQuantity = amount; movementDestination = null; setMode('move-target');
        }, true);
        select.addEventListener('change', () => {
            const item = cellItems(movementSelected).find((s) => String(s.id) === select.value);
            quantity.disabled = !item;
            quantity.max = item ? String(item.count) : '0';
            quantity.value = '';
            all.disabled = !item;
            next.disabled = true;
        });
        quantity.addEventListener('input', () => {
            const item = cellItems(movementSelected).find((s) => String(s.id) === select.value);
            const amount = Number(quantity.value);
            next.disabled = !item || !Number.isInteger(amount) || amount < 1 || amount > item.count;
        });
        root.append(select, quantity, all, next);
    } else if (movementMode === 'move-target') {
        root.append(paragraph(`Товар: ${movementStock.name} · ${movementQuantity} шт.`, 'fw-semibold mb-2'));
        root.append(paragraph(`Откуда: ${cellName(movementSelected.x, movementSelected.y)}`, 'text-success fw-semibold mb-1'));
        root.append(paragraph('Выберите ячейку назначения на карте.', 'small text-body-secondary mb-2'));
        if (movementDestination) {
            root.append(paragraph(`Куда: ${cellName(movementDestination.x, movementDestination.y)}`, 'text-danger fw-bold mb-2'));
            root.append(button('Подтвердить перемещение', 'btn-success w-100', confirmMove));
        }
    } else if (movementMode === 'merge-select') {
        root.append(paragraph(`Исходная ячейка: ${cellName(movementSelected.x, movementSelected.y)}. Выберите ещё от 1 до 3 непустых ячеек.`, 'fw-semibold'));
        const count = paragraph(`Выбрано: ${movementMergeSources.length - 1} /3`, 'fw-bold text-success mb-2');
        count.style.fontSize = '1.05rem';
        root.append(count);
        root.append(button('Выбрать ячейку назначения', 'btn-primary w-100', () => {
            movementDestination = null; setMode('merge-target');
        }, movementMergeSources.length < 2));
    } else if (movementMode === 'merge-target') {
        root.append(paragraph('Объединяются ячейки:', 'fw-semibold mb-1'));
        for (const cell of movementMergeSources) root.append(paragraph(cellName(cell.x, cell.y), 'text-success fw-semibold mb-1'));
        root.append(paragraph('Выберите ячейку назначения на карте.', 'small text-body-secondary mt-2 mb-2'));
        if (movementDestination) {
            root.append(paragraph(`Назначение: ${cellName(movementDestination.x, movementDestination.y)}`, 'text-danger fw-bold mb-2'));
            root.append(button('Подтвердить объединение', 'btn-success w-100', confirmMerge));
        }
    }
}
function render() { renderGrid(); renderDetails(); renderActions(); }
function onCell(cell) {
    showStatus(byId('movements-status'), '');
    if (movementMode === 'browse') {
        movementSelected = sameCell(movementSelected, cell) ? null : cell;
        movementDestination = null;
        movementShowItems = false;
        render();
        return;
    }
    if (movementMode === 'move-choose') return;
    if (movementMode === 'move-target') { movementDestination = cell; render(); return; }
    if (movementMode === 'merge-select') {
        if (sameCell(cell, movementSelected)) return;
        const index = movementMergeSources.findIndex((c) => sameCell(c, cell));
        if (index >= 0) { movementMergeSources.splice(index, 1); render(); return; }
        if (!cellItems(cell).length) return setMovementStatus('Для объединения можно выбрать только непустые ячейки.', 'warning');
        if (movementMergeSources.length >= 4) return setMovementStatus('Можно выбрать не более трёх дополнительных ячеек.', 'warning');
        movementMergeSources.push({ x: cell.x, y: cell.y }); render(); return;
    }
    if (movementMode === 'merge-target') { movementDestination = cell; render(); }
}
function resetOperation() {
    movementMode = 'browse'; movementStock = null; movementQuantity = 0;
    movementMergeSources = []; movementDestination = null; movementSelected = null; movementShowItems = false;
    clearProductFilter();
    byId('movements-cancel').hidden = true;
    render();
}
async function confirmMove() {
    if (!movementStock || !movementDestination) return;
    try {
        await callBackend('MoveWarehouseStock', movementStock.id, movementQuantity, movementDestination.x, movementDestination.y);
        await loadMovements();
        setMovementStatus('Товар успешно перемещён.', 'success');
    } catch (error) { showError(byId('movements-status'), error); }
}
async function confirmMerge() {
    if (!movementDestination || movementMergeSources.length < 2) return;
    try {
        await callBackend('MergeWarehouseCells', movementMergeSources, movementDestination.x, movementDestination.y);
        await loadMovements();
        setMovementStatus('Ячейки успешно объединены.', 'success');
    } catch (error) { showError(byId('movements-status'), error); }
}
function fillProductSelect() {
    const select = byId('movements-product');
    const placeholder = document.createElement('option');
    placeholder.value = ''; placeholder.textContent = 'Выберите товар'; placeholder.disabled = true; placeholder.selected = true; placeholder.hidden = true;
    const options = uniqueProducts().map((item) => {
        const option = document.createElement('option'); option.value = item.productId; option.textContent = item.name; return option;
    });
    select.replaceChildren(placeholder, ...options);
    select.value = '';
    byId('movements-find').disabled = true;
}
export async function loadMovements() {
    const request = ++movementVersion;
    byId('movements-summary').textContent = 'Загрузка ячеек...';
    movementStocks = []; resetOperation(); fillProductSelect(); setMovementStatus('');
    try {
        const loaded = await callBackend('GetWarehouseStocks');
        if (request !== movementVersion) return;
        movementStocks = loaded; resetOperation(); fillProductSelect();
        const occupied = new Set(movementStocks.map((s) => `${s.x}:${s.y}`)).size;
        byId('movements-summary').textContent = `Занято ${occupied} из 64 · свободно ${64 - occupied}`;
    } catch (error) {
        if (request !== movementVersion) return;
        showError(byId('movements-status'), error);
        byId('movements-summary').textContent = 'Не удалось загрузить склад';
    }
}
export function initMovements() {
    movementGrid = createWarehouseGrid(byId('movements-grid'), onCell);
    byId('movements-reload').addEventListener('click', loadMovements);
    byId('movements-cancel').addEventListener('click', () => {
        resetOperation(); setMovementStatus('Операция отменена. Склад не изменён.', 'info');
    });
    byId('movements-product').addEventListener('change', () => {
        byId('movements-find').disabled = movementMode !== 'browse' || !byId('movements-product').value;
    });
    byId('movements-find').addEventListener('click', () => {
        if (movementMode !== 'browse') return;
        const id = Number(byId('movements-product').value);
        if (!id) return;
        movementHighlightedProduct = id; movementSelected = null; byId('movements-back').hidden = false; render();
        const count = new Set(movementStocks.filter((s) => s.productId === id).map((s) => `${s.x}:${s.y}`)).size;
        setMovementStatus(`Товар найден в ячейках: ${count}.`, 'success');
    });
    byId('movements-back').addEventListener('click', () => {
        if (movementMode !== 'browse') return;
        clearProductFilter(); render(); setMovementStatus('Фильтр сброшен.', 'info');
    });
    byId('movements-page').addEventListener('click', (event) => {
        if (movementMode !== 'browse' || !movementShowItems) return;
        // Клик по самой карточке списка не закрывает её; клик по карте или
        // любому свободному месту закрывает только список, не снимая выбор ячейки.
        if (event.target.closest('#movements-cell-items')) return;
        movementShowItems = false;
        render();
    });
}
