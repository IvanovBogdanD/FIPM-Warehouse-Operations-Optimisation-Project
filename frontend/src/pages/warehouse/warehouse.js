import { callBackend } from '../../shared/api.js';
import { byId, showError, showStatus } from '../../shared/dom.js';
import { cellName, createWarehouseGrid } from '../../shared/warehouse-grid.js';

let grid;
let stocks = [];
let selected = null;
let version = 0;

function renderCell() {
    byId('warehouse-cell-title').textContent = selected ? `Ячейка ${cellName(selected.x, selected.y)}` : 'Содержимое ячейки';
    const items = selected ? stocks.filter((stock) => stock.x === selected.x && stock.y === selected.y) : [];
    byId('warehouse-cell-empty').hidden = items.length > 0;
    byId('warehouse-cell-empty').textContent = selected ? 'Ячейка свободна.' : 'Выберите ячейку на карте.';
    const links = items.map((item) => {
        const link = document.createElement('a'); link.href = `#product/${item.productId}`;
        link.className = 'list-group-item list-group-item-action px-0';
        const name = document.createElement('strong'); name.className = 'd-block'; name.textContent = item.name;
        const count = document.createElement('span'); count.className = 'd-block mt-1'; count.textContent = `${item.count.toLocaleString('ru-RU')} шт.`;
        const date = document.createElement('span'); date.className = 'small text-body-secondary';
        date.textContent = item.receivedAt ? `Поступление: ${new Date(item.receivedAt).toLocaleString('ru-RU')}` : 'Дата поступления не указана';
        link.append(name, count, date); return link;
    });
    byId('warehouse-cell-items').replaceChildren(...links);
    grid.render(stocks, selected);
}

export async function loadWarehouse() {
    const request = ++version;
    byId('warehouse-summary').textContent = 'Загрузка ячеек...';
    showStatus(byId('warehouse-status'), '');
    stocks = []; grid.render(stocks, null, true); byId('warehouse-cell-items').replaceChildren();
    byId('warehouse-cell-empty').hidden = false; byId('warehouse-cell-empty').textContent = 'Загрузка...';
    try {
        const loaded = await callBackend('GetWarehouseStocks');
        if (request !== version) return;
        stocks = loaded;
        const occupied = new Set(stocks.map((stock) => `${stock.x}:${stock.y}`)).size;
        byId('warehouse-summary').textContent = `Занято ${occupied} из 64 · свободно ${64 - occupied}`;
        renderCell();
    } catch (error) {
        if (request !== version) return;
        byId('warehouse-summary').textContent = 'Ячейки недоступны';
        byId('warehouse-cell-empty').textContent = 'Не удалось загрузить содержимое склада.';
        showError(byId('warehouse-status'), error);
    }
}

export function initWarehouse() {
    grid = createWarehouseGrid(byId('warehouse-grid'), (cell) => { selected = cell; renderCell(); });
    byId('warehouse-reload').addEventListener('click', loadWarehouse);
}
