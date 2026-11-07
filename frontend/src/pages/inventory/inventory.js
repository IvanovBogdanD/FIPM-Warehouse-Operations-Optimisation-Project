import { byId, showError, showStatus } from '../../shared/dom.js';
import { showModal, hideModal } from '../../shared/modal.js';
import { initInventoryProductSearch, closeInventorySearch } from './product-search.js';
import { inventoryNumber, inventoryDate, inventoryTotals } from './inventory-data.js';
import { renderInventoryReport, exportInventoryReport } from './inventory-report.js';

let inventoryDetails = null;
let inventoryBusy = false;
let inventoryChoices = [];
const inventorySelected = new Set();

export function initInventory() {
    initInventoryProductSearch((product) => {
        inventorySelected.add(product.id);
        renderInventorySelection();
    }, (products) => { inventoryChoices = products; renderInventorySelection(); });
    byId('btn-create-inventory').addEventListener('click', () => runInventoryAction('btn-create-inventory', async () => {
        const draft = await window.go.main.InventoryService.GetDraftInventory();
        if (draft) await openInventory(draft);
        else {
            const created = await window.go.main.InventoryService.CreateInventory();
            await openInventory(await window.go.main.InventoryService.GetInventory(created.id));
        }
    }));
    byId('inventory-show-history').addEventListener('click', () => runInventoryAction('inventory-show-history', showInventoryHistory));
    byId('inventory-history-body').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-inventory-id]');
        if (button) return runInventoryAction('btn-create-inventory', async () => openInventory(await window.go.main.InventoryService.GetInventory(Number(button.dataset.inventoryId))));
    });
    byId('inventory-selection-body').addEventListener('change', (event) => {
        const id = Number(event.target.dataset.productId);
        const product = inventoryChoices.find((item) => item.id === id);
        if (!product) return;
        if (event.target.checked) inventorySelected.add(id);
        else inventorySelected.delete(id);
        renderInventorySelection();
    });
    byId('inventory-select-shown').addEventListener('click', selectInventoryShown);
    byId('inventory-select-all').addEventListener('change', (event) => {
        for (const product of inventoryChoices) {
            if (event.target.checked) inventorySelected.add(product.id);
            else inventorySelected.delete(product.id);
        }
        renderInventorySelection();
    });
    byId('inventory-clear-selection').addEventListener('click', () => { inventorySelected.clear(); renderInventorySelection(); });
    for (const id of ['inventory-kind-partial', 'inventory-kind-full']) byId(id).addEventListener('change', renderInventorySelection);
    byId('inventory-commission').addEventListener('change', updateInventoryCommission);
    byId('inventory-start-count').addEventListener('click', () => runInventoryAction('inventory-start-count', startInventoryCount));
    byId('inventory-save-counts').addEventListener('click', () => runInventoryAction('inventory-save-counts', async () => {
        await saveInventoryCounts(false);
        showStatus(byId('inventory-status'), 'Результаты подсчёта сохранены.');
    }));
    byId('inventory-to-compare').addEventListener('click', () => runInventoryAction('inventory-to-compare', async () => {
        await saveInventoryCounts(true);
        renderInventoryComparison();
        showInventoryStage('compare');
    }));
    byId('inventory-back-count').addEventListener('click', () => runInventoryAction('inventory-back-count', async () => {
        await saveInventoryCounts(true);
        renderInventoryCounts(); showInventoryStage('count');
    }));
    byId('inventory-save-compare').addEventListener('click', () => runInventoryAction('inventory-save-compare', async () => {
        await saveInventoryCounts(true);
        renderInventoryComparison();
        showStatus(byId('inventory-status'), 'Результаты сверки сохранены.');
    }));
    byId('btn-apply-inventory').addEventListener('click', () => runInventoryAction('btn-apply-inventory', async () => {
        await saveInventoryCounts(true);
        renderInventoryComparison();
        showInventoryCorrection();
    }));
    byId('inventory-comparison-body').addEventListener('change', refreshInventoryComparison);
    byId('inventory-correction-confirm').addEventListener('click', () => runInventoryAction('inventory-correction-confirm', async () => {
        await window.go.main.InventoryService.ApplyInventory(inventoryDetails.id);
        inventoryDetails = await window.go.main.InventoryService.GetInventory(inventoryDetails.id);
        hideModal('inventory-correction-modal');
        showInventoryReport();
    }, 'inventory-correction-status'));
    byId('inventory-open-report').addEventListener('click', () => runInventoryAction('inventory-open-report', async () => {
        await saveInventoryCounts(true);
        showInventoryReport();
    }));
    byId('inventory-download-pdf').addEventListener('click', () => runInventoryAction('inventory-download-pdf', () => exportInventoryReport(inventoryDetails, false)));
    byId('inventory-print').addEventListener('click', () => runInventoryAction('inventory-print', () => exportInventoryReport(inventoryDetails, true)));
}

async function runInventoryAction(buttonId, action, statusId = 'inventory-status') {
    if (inventoryBusy) return;
    inventoryBusy = true;
    byId(buttonId).disabled = true;
    showStatus(byId(statusId), '');
    try { await action(); }
    catch (error) { showError(byId(statusId), error); }
    finally { inventoryBusy = false; byId(buttonId).disabled = false; }
}

export async function loadInventory() {
    closeInventorySearch();
    showStatus(byId('inventory-status'), 'Загрузка инвентаризации...');
    try {
        const draft = await window.go.main.InventoryService.GetDraftInventory();
        if (draft) await openInventory(draft);
        else await showInventoryHistory();
        showStatus(byId('inventory-status'), '');
    } catch (error) { showError(byId('inventory-status'), error); }
}

async function showInventoryHistory() {
    closeInventorySearch();
    const inventories = await window.go.main.InventoryService.GetInventories();
    byId('inventory-empty').hidden = false;
    byId('inventory-active').hidden = true;
    byId('inventory-steps').hidden = true;
    byId('inventory-title').textContent = 'Инвентаризация';
    byId('page-title').textContent = 'Инвентаризация';
    byId('inventory-subtitle').textContent = 'Проверки и сохранённые акты';
    const body = byId('inventory-history-body');
    body.replaceChildren();
    for (const inventory of inventories) {
        const row = document.createElement('tr');
        for (const value of [inventoryNumber(inventory), inventory.date ? inventoryDate(inventory.date) : '-', inventory.responsible || 'Не указано', inventory.status === 'completed' ? 'Завершена' : 'Черновик']) row.append(inventoryCell(value));
        const cell = document.createElement('td');
        const button = document.createElement('button');
        button.type = 'button'; button.className = 'btn btn-outline-primary btn-sm';
        button.textContent = inventory.status === 'completed' ? 'Открыть акт' : 'Продолжить';
        button.dataset.inventoryId = inventory.id;
        cell.append(button); row.append(cell); body.append(row);
    }
    byId('inventory-history-empty').hidden = inventories.length > 0;
}

async function openInventory(details) {
    inventoryDetails = details;
    inventorySelected.clear();
    inventoryChoices = details.items.map((item) => ({ id: item.productId, name: item.productName, count: item.systemCount, article: item.article, storageLocation: item.storageLocation }));
    inventoryChoices.forEach((product) => inventorySelected.add(product.id));
    byId('inventory-product-search').value = '';
    if (details.status === 'completed') { showInventoryReport(); return; }
    if (details.items.length > 0) {
        if (details.items.every((item) => item.actualCount !== null)) { renderInventoryComparison(); showInventoryStage('compare'); }
        else { renderInventoryCounts(); showInventoryStage('count'); }
        return;
    }
    const user = JSON.parse(sessionStorage.getItem('user'));
    const today = new Date();
    byId('inventory-date').value = details.date || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    byId('inventory-responsible').value = details.responsible || [user.lastName, user.firstName, user.middleName].filter(Boolean).join(' ');
    byId('inventory-kind-full').checked = details.kind === 'full';
    byId('inventory-kind-partial').checked = details.kind !== 'full';
    const employees = await window.go.main.InventoryService.GetInventoryEmployees();
    const commission = byId('inventory-commission');
    commission.replaceChildren();
    for (const employee of employees) {
        const label = document.createElement('label'); label.className = 'dropdown-item d-flex gap-2 text-wrap';
        const input = document.createElement('input'); input.type = 'checkbox'; input.className = 'form-check-input flex-shrink-0'; input.value = employee.name;
        input.checked = (details.commission || '').split(', ').includes(employee.name);
        const name = document.createElement('span'); name.textContent = employee.name;
        label.append(input, name); commission.append(label);
    }
    updateInventoryCommission();
    renderInventorySelection();
    showInventoryStage('create');
}

function showInventoryStage(stage) {
    closeInventorySearch();
    byId('inventory-empty').hidden = true;
    byId('inventory-active').hidden = false;
    byId('inventory-steps').hidden = false;
    const sections = { create: 'creation', count: 'counting', compare: 'reconciliation', report: 'report' };
    for (const [name, section] of Object.entries(sections)) {
        byId(`inventory-${section}`).hidden = name !== stage;
        const step = byId(`inventory-step-${name}`);
        step.className = name === stage ? 'nav-link px-2 active' : 'nav-link px-2 text-body-secondary';
        if (name === stage) step.setAttribute('aria-current', 'step');
        else step.removeAttribute('aria-current');
    }
    byId('inventory-title').textContent = stage === 'create' ? 'Новая инвентаризация' : `Инвентаризация ${inventoryNumber(inventoryDetails)}`;
    byId('page-title').textContent = `Инвентаризация / ${stage === 'create' ? 'Новая инвентаризация' : inventoryNumber(inventoryDetails)}`;
    const parameters = [inventoryDetails.date ? inventoryDate(inventoryDetails.date) : 'Черновик', inventoryDetails.responsible].filter(Boolean);
    byId('inventory-subtitle').textContent = `${inventoryNumber(inventoryDetails)} · ${parameters.join(' · ')}`;
}

function inventoryCell(value, className = '') {
    const cell = document.createElement('td'); cell.textContent = value; cell.className = className; return cell;
}

function selectInventoryShown() {
    inventoryChoices.forEach((product) => inventorySelected.add(product.id));
    renderInventorySelection();
}

function renderInventorySelection() {
    const body = byId('inventory-selection-body'); body.replaceChildren();
    const full = byId('inventory-kind-full').checked;
    for (const product of inventoryChoices) {
        const row = document.createElement('tr');
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox'; checkbox.className = 'form-check-input'; checkbox.dataset.productId = product.id;
        checkbox.checked = full || inventorySelected.has(product.id); checkbox.disabled = full;
        checkbox.setAttribute('aria-label', `Выбрать: ${product.name}`);
        const choice = document.createElement('td'); choice.append(checkbox);
        row.append(choice, inventoryCell(product.name, 'fw-semibold'), inventoryCell(product.article || '-'), inventoryCell(product.storageLocation || '-'), inventoryCell(product.count, 'text-end'));
        body.append(row);
    }
    if (!inventoryChoices.length) { const row = document.createElement('tr'); const cell = inventoryCell('Нажмите на поиск, чтобы выбрать товары.'); cell.colSpan = 5; row.append(cell); body.append(row); }
    const selected = inventoryChoices.filter((product) => inventorySelected.has(product.id)).length;
    byId('inventory-select-all').checked = full || (inventoryChoices.length > 0 && selected === inventoryChoices.length);
    byId('inventory-select-all').indeterminate = !full && selected > 0 && selected < inventoryChoices.length;
    byId('inventory-selected-count').textContent = full ? 'Будут проверены все товары из базы' : `Выбрано позиций: ${inventorySelected.size}`;
    for (const id of ['inventory-select-all', 'inventory-select-shown', 'inventory-clear-selection']) byId(id).disabled = full;
}

function selectedInventoryCommission() {
    return Array.from(byId('inventory-commission').children).map((label) => label.children[0]).filter((input) => input.checked).map((input) => input.value);
}

function updateInventoryCommission() {
    const names = selectedInventoryCommission();
    byId('inventory-commission-toggle').textContent = names.length ? names.join(', ') : 'Выберите сотрудников';
}

async function startInventoryCount() {
    const request = {
        date: byId('inventory-date').value, responsible: byId('inventory-responsible').value.trim(),
        commission: selectedInventoryCommission().join(', '),
        kind: byId('inventory-kind-full').checked ? 'full' : 'partial', productIds: Array.from(inventorySelected),
    };
    if (!request.date || !request.responsible) throw new Error('Укажите дату и ФИО проводящего проверку.');
    if (request.kind === 'partial' && !request.productIds.length) throw new Error('Выберите товары для проверки.');
    inventoryDetails = await window.go.main.InventoryService.PrepareInventory(inventoryDetails.id, request);
    renderInventoryCounts(); showInventoryStage('count');
}

function inventoryInputCell(item, field) {
    const actual = field === 'actualCount';
    const input = document.createElement('input');
    input.type = actual ? 'number' : 'text';
    input.className = 'form-control form-control-sm';
    input.value = item[field] === null ? '' : item[field];
    if (actual) { input.min = '0'; input.step = '1'; }
    input.setAttribute('aria-label', `${actual ? 'Фактическое количество' : 'Комментарий'}: ${item.productName}`);
    const cell = document.createElement('td'); cell.append(input);
    return cell;
}

function renderInventoryCounts() {
    const body = byId('inventory-items-body'); body.replaceChildren();
    for (const item of inventoryDetails.items) {
        const row = document.createElement('tr'); row.dataset.productId = item.productId;
        row.append(inventoryCell(item.productName, 'fw-semibold'), inventoryCell(item.storageLocation || '-'), inventoryCell(item.systemCount, 'text-end'), inventoryInputCell(item, 'actualCount'), inventoryInputCell(item, 'comment')); body.append(row);
    }
}

async function saveInventoryCounts(requireAll) {
    const counts = readInventoryCounts(requireAll);
    inventoryDetails = await window.go.main.InventoryService.SaveInventoryCounts(inventoryDetails.id, counts);
}

function readInventoryCounts(requireAll) {
    const comparing = !byId('inventory-reconciliation').hidden;
    const body = byId(comparing ? 'inventory-comparison-body' : 'inventory-items-body');
    return Array.from(body.children).map((row) => {
        const value = String(row.children[3].children[0].value).trim();
        const actualCount = value === '' ? null : Number(value);
        if (requireAll && actualCount === null) throw new Error('Укажите фактическое количество для каждого товара.');
        if (actualCount !== null && (!Number.isSafeInteger(actualCount) || actualCount < 0)) throw new Error('Фактическое количество должно быть целым неотрицательным числом.');
        return { productId: Number(row.dataset.productId), actualCount, comment: row.children[comparing ? 6 : 4].children[0].value.trim() };
    });
}

function renderInventoryComparison() {
    const body = byId('inventory-comparison-body'); body.replaceChildren();
    for (const item of inventoryDetails.items) {
        const row = document.createElement('tr');
        row.dataset.productId = item.productId;
        const badge = document.createElement('span');
        const cell = document.createElement('td'); cell.append(badge);
        row.append(inventoryCell(item.productName, 'fw-semibold'), inventoryCell(item.storageLocation || '-'), inventoryCell(item.systemCount, 'text-end'), inventoryInputCell(item, 'actualCount'), inventoryCell(''), cell, inventoryInputCell(item, 'comment'));
        body.append(row);
    }
    updateInventoryComparison(inventoryDetails.items);
}

function refreshInventoryComparison() {
    try {
        const counts = readInventoryCounts(true);
        const items = inventoryDetails.items.map((item, index) => ({ ...item, actualCount: counts[index].actualCount }));
        updateInventoryComparison(items);
        showStatus(byId('inventory-status'), '');
    } catch (error) { showError(byId('inventory-status'), error); }
}

function updateInventoryComparison(items) {
    const totals = inventoryTotals({ items });
    items.forEach((item, index) => {
        const difference = item.actualCount - item.systemCount;
        let color = 'success', result = 'Совпадает';
        if (difference < 0) { color = 'danger'; result = 'Недостача'; }
        if (difference > 0) { color = 'warning'; result = 'Излишек'; }
        const row = byId('inventory-comparison-body').children[index];
        row.children[4].textContent = difference > 0 ? `+${difference}` : difference;
        row.children[4].className = `text-end fw-semibold text-${color}`;
        const badge = row.children[5].children[0];
        badge.className = `badge bg-${color}-subtle text-${color}`; badge.textContent = result;
    });
    byId('inventory-summary-counted').textContent = `${inventoryDetails.items.length} из ${inventoryDetails.items.length}`;
    byId('inventory-summary-matched').textContent = totals.matched;
    byId('inventory-summary-shortage').textContent = totals.shortage ? `-${totals.shortage} шт.` : '0';
    byId('inventory-summary-surplus').textContent = totals.surplus ? `+${totals.surplus} шт.` : '0';
    byId('inventory-total').textContent = `Итого: в системе ${totals.system} шт. · фактически ${totals.actual} шт. · расхождение ${totals.actual - totals.system} шт.`;
}

function showInventoryCorrection() {
    const changed = inventoryDetails.items.filter((item) => item.actualCount !== item.systemCount);
    byId('inventory-correction-title').textContent = changed.length ? `Скорректировать остатки по ${changed.length} позициям?` : 'Завершить инвентаризацию без расхождений?';
    const body = byId('inventory-correction-body'); body.replaceChildren();
    for (const item of changed) {
        const row = document.createElement('tr'); const difference = item.actualCount - item.systemCount;
        row.append(inventoryCell(item.productName), inventoryCell(item.systemCount, 'text-end'), inventoryCell(item.actualCount, 'text-end fw-semibold'), inventoryCell(difference > 0 ? `+${difference}` : difference, `text-end fw-semibold text-${difference < 0 ? 'danger' : 'success'}`)); body.append(row);
    }
    showStatus(byId('inventory-correction-status'), ''); showModal('inventory-correction-modal');
}

function showInventoryReport() {
    renderInventoryReport(inventoryDetails);
    showInventoryStage('report');
}
