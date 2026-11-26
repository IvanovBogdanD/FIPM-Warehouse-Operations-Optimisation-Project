import { byId, showError, showStatus } from '../../shared/dom.js';
import { showModal, hideModal } from '../../shared/modal.js';
import { initInventoryProductSearch, closeInventorySearch, setInventorySearchMode } from './product-search.js';
import { callBackend } from '../../shared/api.js';
import { createWarehouseGrid } from '../../shared/warehouse-grid.js';
import { createManagerPicker } from '../../shared/manager-picker.js';
import { inventoryNumber, inventoryDate, inventoryTotals } from './inventory-data.js';
import { renderInventoryReport, exportInventoryReport } from './inventory-report.js';

let inventoryDetails = null;
let inventoryBusy = false;
let inventoryChoices = [];
const inventorySelected = new Set();
let inventoryGrid;
let inventoryStocks = [];
let inventoryCellChoice = null;
let inventoryUsesCells = true;
let inventoryCommission;
let currentUser = null;

function choiceFromInventoryItem(item) {
    return { id: inventoryUsesCells ? item.stockId : item.productId, name: item.productName, count: item.systemCount,
        article: item.article, storageLocation: item.storageLocation };
}

async function loadInventoryGrid() {
    byId('inventory-grid-panel').hidden = !inventoryUsesCells;
    if (!inventoryUsesCells) return;
    inventoryStocks = await callBackend('GetWarehouseStocks');
    inventoryGrid.render(inventoryStocks, inventoryCellChoice);
}

export function initInventory() {
    inventoryCommission = createManagerPicker('inventory-commission-toggle', 'Выберите сотрудников');
    inventoryGrid = createWarehouseGrid(byId('inventory-grid'), (cell) => {
        inventoryCellChoice = cell;
        for (const stock of cell.items) {
            if (!inventoryChoices.some((item) => item.id === stock.id)) inventoryChoices.push(stock);
            inventorySelected.add(stock.id);
        }
        renderInventorySelection();
    });
    initInventoryProductSearch((product) => {
        if (!inventoryChoices.find(p => p.id === product.id)) {
            inventoryChoices.push(product);
        }
        inventorySelected.add(product.id);
        renderInventorySelection();
    }, (products) => {});

    byId('btn-create-inventory').addEventListener('click', () => runInventoryAction('btn-create-inventory', async () => {
        inventoryDetails = null;
        inventoryChoices = [];
        inventorySelected.clear();
        
        const user = JSON.parse(sessionStorage.getItem('user'));
        const created = await window.go.main.InventoryService.CreateInventory(user.id, user.role);
        await openInventory(await window.go.main.InventoryService.GetInventory(created.id, user.id));
    }));

    byId('inventory-selection-body').addEventListener('click', (event) => {
        const btn = event.target.closest('button[data-remove-id]');
        if (btn) {
            const id = Number(btn.dataset.removeId);
            inventoryChoices = inventoryChoices.filter(p => p.id !== id);
            inventorySelected.delete(id);
            renderInventorySelection();
        }
    });

    byId('inventory-items-body').addEventListener('click', async (event) => {
        const btn = event.target.closest('button[data-remove-id]');
        if (btn) {
            if (!confirm('Удалить этот товар из инвентаризации?')) return;
            const id = Number(btn.dataset.removeId);
            try {
                await saveInventoryCounts(false);
                const user = JSON.parse(sessionStorage.getItem('user'));
                const method = inventoryDetails.byCells ? 'DeleteInventoryCell' : 'DeleteInventoryItem';
                inventoryDetails = await window.go.main.InventoryService[method](inventoryDetails.id, id, user.id);
                renderInventoryCounts();
            } catch (error) {
                showError(byId('inventory-status'), error);
            }
        }
    });

    byId('inventory-back-to-creation').addEventListener('click', () => runInventoryAction('inventory-back-to-creation', async () => {
        await saveInventoryCounts(false);
        const user = JSON.parse(sessionStorage.getItem('user'));
        inventoryDetails = await window.go.main.InventoryService.GetInventory(inventoryDetails.id, user.id);
        inventorySelected.clear();
        inventoryChoices = inventoryDetails.items.map(choiceFromInventoryItem);
        inventoryChoices.forEach((product) => inventorySelected.add(product.id));
        
        byId('inventory-date').value = inventoryDetails.date || byId('inventory-date').value;
        await loadInventoryPeople(inventoryDetails);
        await loadInventoryGrid();
        
        renderInventorySelection();
        showInventoryStage('create');
    }));

    byId('inventory-back-to-compare').addEventListener('click', () => {
        showInventoryStage('compare');
    });

    byId('inventory-show-history').addEventListener('click', () => runInventoryAction('inventory-show-history', showInventoryHistory));
    
    byId('inventory-history-body').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-inventory-id]');
        if (button) return runInventoryAction('btn-create-inventory', async () => {
            const id = Number(button.dataset.inventoryId);
            const user = JSON.parse(sessionStorage.getItem('user'));
            if (button.dataset.inventoryStatus === 'completed' || button.dataset.inventoryStatus === 'approved') {
                await openCompletedInventory(id);
            } else {
                await openInventory(await window.go.main.InventoryService.GetInventory(id, user.id));
            }
        });
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
    
    byId('inventory-submit-review').addEventListener('click', () => runInventoryAction('inventory-submit-review', async () => {
        await saveInventoryCounts(true);
        const user = JSON.parse(sessionStorage.getItem('user'));
        await window.go.main.InventoryService.SubmitForReview(inventoryDetails.id, user.id, user.role);
        showModal('inventory-submitted-modal');
    }));

    byId('inventory-submitted-ok').addEventListener('click', () => {
        hideModal('inventory-submitted-modal');
        showInventoryHistory();
    });

    byId('inventory-approve').addEventListener('click', () => runInventoryAction('inventory-approve', async () => {
        await saveInventoryCounts(false);
        const user = JSON.parse(sessionStorage.getItem('user'));
        await window.go.main.InventoryService.ApproveInventory(inventoryDetails.id, user.id, user.role);
        inventoryDetails = await window.go.main.InventoryService.GetInventory(inventoryDetails.id, user.id);
        if (inventoryDetails.status === 'completed') {
            showStatus(byId('inventory-status'), 'Инвентаризация завершена. Остатки скорректированы.');
            inventoryDetails = await window.go.main.InventoryService.GetInventoryReport(inventoryDetails.id, user.id, user.role);
            showInventoryReport();
        } else {
            showStatus(byId('inventory-status'), 'Вы подтвердили результаты. Ожидаем остальных членов комиссии.');
            showInventoryStage('compare');
        }
    }));

    byId('inventory-open-report').addEventListener('click', () => runInventoryAction('inventory-open-report', async () => {
        await saveInventoryCounts(true);
        const user = JSON.parse(sessionStorage.getItem('user'));
        inventoryDetails = await window.go.main.InventoryService.GetInventoryReport(inventoryDetails.id, user.id, user.role);
        showInventoryReport();
    }));
    for (const [id, print] of [['inventory-download-pdf', false], ['inventory-print', true]]) {
        byId(id).addEventListener('click', () => runInventoryAction(id, () => exportInventoryReport(inventoryDetails, print, byId('inventory-status'))));
    }
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

export async function loadInventory(inventoryId = null) {
    const userStr = sessionStorage.getItem('user');
    if (userStr) currentUser = JSON.parse(userStr);

    closeInventorySearch();
    showStatus(byId('inventory-status'), 'Загрузка инвентаризации...');
    try {
        if (inventoryId) {
            const details = await window.go.main.InventoryService.GetInventory(inventoryId, currentUser.id);
            await openInventory(details);
        } else {
            await showInventoryHistory();
        }
        showStatus(byId('inventory-status'), '');
    } catch (error) { showError(byId('inventory-status'), error); }
}

async function showInventoryHistory() {
    closeInventorySearch();
    if (!currentUser) return;
    
    const inventories = await window.go.main.InventoryService.GetInventories(currentUser.id, currentUser.role);
    
    byId('inventory-empty').hidden = false;
    byId('inventory-active').hidden = true;
    byId('inventory-steps').hidden = true;
    byId('btn-create-inventory').style.display = (currentUser.role === 'Кладовщик') ? 'inline-block' : 'none';
    
    byId('inventory-title').textContent = 'Инвентаризация';
    byId('page-title').textContent = 'Инвентаризация';
    byId('inventory-subtitle').textContent = 'Проверки и сохранённые акты';
    
    const body = byId('inventory-history-body');
    body.replaceChildren();
    
    for (const inventory of inventories) {
        const row = document.createElement('tr');
        
        let statusText = 'Черновик';
        if (inventory.status === 'completed') statusText = 'Завершена';
        else if (inventory.status === 'pending') {
            if (currentUser.role === 'Менеджер') {
                if (inventory.isApprovedByMe) {
                    statusText = inventory.waitForOtherApprove ? 'На согласовании комиссии' : 'Завершена';
                } else {
                    statusText = 'Требует вашего подтверждения';
                }
            } else {
                statusText = 'Ожидает подтверждения';
            }
        }
        
        for (const value of [inventoryNumber(inventory), inventory.date ? inventoryDate(inventory.date) : '-', inventory.commission || 'Не указано', statusText]) {
            row.append(inventoryCell(value));
        }
        
        const cell = document.createElement('td');
        if (inventory.status === 'completed') {
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'btn btn-outline-primary btn-sm';
            button.textContent = 'Открыть акт';
            button.dataset.inventoryId = inventory.id;
            button.dataset.inventoryStatus = inventory.status;
            cell.append(button);
        } else if (inventory.status === 'draft' && currentUser.role === 'Кладовщик') {
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'btn btn-outline-primary btn-sm';
            button.textContent = 'Продолжить';
            button.dataset.inventoryId = inventory.id;
            button.dataset.inventoryStatus = inventory.status;
            cell.append(button);
        } else if (inventory.status === 'pending' && currentUser.role === 'Менеджер') {
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'btn btn-outline-primary btn-sm';
            if (!inventory.isApprovedByMe) {
                button.textContent = 'Проверить';
                button.dataset.inventoryStatus = 'pending';
            } else {
                button.textContent = 'Открыть акт';
                button.dataset.inventoryStatus = 'approved';
            }
            button.dataset.inventoryId = inventory.id;
            cell.append(button);
        }
        
        row.append(cell);
        body.append(row);
    }
    byId('inventory-history-empty').hidden = inventories.length > 0;
}

async function openCompletedInventory(id) {
    inventoryDetails = await window.go.main.InventoryService.GetInventoryReport(id, currentUser.id, currentUser.role);
    showInventoryReport();
}

async function openInventory(details) {
    if (details.status === 'completed') {
        await openCompletedInventory(details.id);
        return;
    }
    
    inventoryDetails = details;
    inventoryUsesCells = details.byCells || details.items.length === 0;
    inventoryCellChoice = null;
    setInventorySearchMode(inventoryUsesCells);
    inventorySelected.clear();
    inventoryChoices = details.items.map(choiceFromInventoryItem);
    inventoryChoices.forEach((product) => inventorySelected.add(product.id));
    byId('inventory-product-search').value = '';
    
    await loadInventoryGrid();
    
    if (currentUser.role === 'Кладовщик' && details.status === 'pending') {
        inventoryDetails = await window.go.main.InventoryService.GetInventoryReport(details.id, currentUser.id, currentUser.role);
        showInventoryReport();
        return;
    }

    if (details.items.length > 0) {
        if (details.status === 'pending') {
            renderInventoryComparison();
            showInventoryStage('compare');
        } else if (details.items.every((item) => item.actualCount !== null)) {
            renderInventoryComparison(); showInventoryStage('compare');
        } else { 
            renderInventoryCounts(); showInventoryStage('count'); 
        }
        return;
    }
    
    const today = new Date();
    byId('inventory-date').value = details.date || `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    byId('inventory-kind-full').checked = details.kind === 'full';
    byId('inventory-kind-partial').checked = details.kind !== 'full';
    
    await loadInventoryPeople(details);
    
    renderInventorySelection();
    showInventoryStage('create');
}

async function loadInventoryPeople(details) {
    const employees = await window.go.main.InventoryService.GetInventoryEmployees();
    inventoryCommission.render(employees, details.commissionManagers.map((manager) => manager.id));
}

function showInventoryStage(stage) {
    closeInventorySearch();
    byId('inventory-empty').hidden = true;
    byId('inventory-active').hidden = false;
    byId('inventory-steps').hidden = false;
    byId('btn-create-inventory').style.display = 'none';
    
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
    const parameters = [inventoryDetails.date ? inventoryDate(inventoryDetails.date) : 'Черновик', inventoryDetails.commission].filter(Boolean);
    byId('inventory-subtitle').textContent = `${inventoryNumber(inventoryDetails)} · ${parameters.join(' · ')}`;

    const isStorekeeper = currentUser.role === 'Кладовщик';
    const isManager = currentUser.role === 'Менеджер';
    const isDraft = inventoryDetails.status === 'draft';
    const isPending = inventoryDetails.status === 'pending';

    byId('inventory-back-count').style.display = (stage === 'compare' && isDraft && isStorekeeper) ? 'inline-block' : 'none';
    byId('inventory-save-compare').style.display = (stage === 'compare' && (isDraft || isPending)) ? 'inline-block' : 'none';
    byId('inventory-submit-review').style.display = (stage === 'compare' && isDraft && isStorekeeper) ? 'inline-block' : 'none';
    byId('inventory-approve').style.display = (stage === 'compare' && isPending && isManager && !inventoryDetails.isApprovedByMe) ? 'inline-block' : 'none';
    
    const canViewReport = (stage === 'compare' && isPending && isManager && inventoryDetails.isApprovedByMe);
    byId('inventory-open-report').style.display = canViewReport ? 'inline-block' : 'none';

    const hint = byId('inventory-reconciliation-hint');
    if (hint) {
        if (isStorekeeper && isDraft) {
            hint.textContent = 'После нажатия на «Отправить на проверку» инвентаризация будет отправлена всем членам комиссии, изменение станет недоступным.';
            hint.className = 'alert alert-warning mb-0';
        } else if (isManager && isPending && !inventoryDetails.isApprovedByMe) {
            hint.textContent = 'Вы можете скорректировать фактическое количество. После подтверждения всеми членами комиссии остатки в системе будут обновлены.';
            hint.className = 'alert alert-info mb-0';
        } else if (isManager && isPending && inventoryDetails.isApprovedByMe) {
            hint.textContent = 'Вы уже подтвердили результаты. Ожидаем подтверждения от остальных членов комиссии.';
            hint.className = 'alert alert-success mb-0';
        } else {
            hint.textContent = 'Корректировка приведёт количество в системе к фактическому.';
            hint.className = 'alert alert-primary mb-0';
        }
    }
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
        
        const removeCell = document.createElement('td');
        if (!full) {
            const removeBtn = document.createElement('button');
            removeBtn.className = 'btn btn-sm btn-link text-danger p-0';
            removeBtn.textContent = '✕';
            removeBtn.title = 'Удалить из списка';
            removeBtn.dataset.removeId = product.id;
            removeCell.append(removeBtn);
        }

        row.append(choice, inventoryCell(product.name, 'fw-semibold'), inventoryCell(product.article || '-'), inventoryCell(product.storageLocation || '-'), inventoryCell(product.count, 'text-end'), removeCell);
        body.append(row);
    }
    if (!inventoryChoices.length) { const row = document.createElement('tr'); const cell = inventoryCell('Нажмите на поиск, чтобы выбрать товары.'); cell.colSpan = 6; row.append(cell); body.append(row); }
    const selected = inventoryChoices.filter((product) => inventorySelected.has(product.id)).length;
    byId('inventory-select-all').checked = full || (inventoryChoices.length > 0 && selected === inventoryChoices.length);
    byId('inventory-select-all').indeterminate = !full && selected > 0 && selected < inventoryChoices.length;
    byId('inventory-selected-count').textContent = full ? inventoryUsesCells ? 'Будут проверены все занятые ячейки' : 'Будут проверены все товары из базы' : `Выбрано позиций: ${inventorySelected.size}`;
    for (const id of ['inventory-select-all', 'inventory-select-shown', 'inventory-clear-selection']) byId(id).disabled = full;
    if (inventoryUsesCells) inventoryGrid.render(inventoryStocks, inventoryCellChoice, full);
}

async function startInventoryCount() {
    const user = JSON.parse(sessionStorage.getItem('user'));
    const request = {
        date: byId('inventory-date').value, 
        commissionIds: inventoryCommission.ids(),
        kind: byId('inventory-kind-full').checked ? 'full' : 'partial', 
        ...(inventoryUsesCells ? { byCells: true, stockIds: Array.from(inventorySelected) } : { productIds: Array.from(inventorySelected) }),
    };
    
    if (!request.date) throw new Error('Укажите дату проведения.');
    if (!request.commissionIds.length) throw new Error('Выберите хотя бы одного члена комиссии.');
    if (request.kind === 'partial' && inventorySelected.size === 0) throw new Error('Выберите товары для проверки.');
    
    inventoryDetails = await window.go.main.InventoryService.PrepareInventory(inventoryDetails.id, request, user.id);
    renderInventoryCounts(); showInventoryStage('count');
}

function inventoryInputCell(item, field, readonly = false) {
    const actual = field === 'actualCount';
    const input = document.createElement('input');
    input.type = actual ? 'number' : 'text';
    input.className = 'form-control form-control-sm';
    input.value = item[field] === null ? '' : item[field];
    if (actual) { input.min = '0'; input.step = '1'; }
    input.disabled = readonly;
    input.setAttribute('aria-label', `${actual ? 'Фактическое количество' : 'Комментарий'}: ${item.productName}, ${item.storageLocation || 'общий остаток'}`);
    const cell = document.createElement('td'); cell.append(input);
    return cell;
}

function renderInventoryCounts() {
    const body = byId('inventory-items-body'); body.replaceChildren();
    for (const item of inventoryDetails.items) {
        const row = document.createElement('tr'); row.dataset.productId = item.productId;
        row.dataset.stockId = item.stockId || 0;
        
        const removeCell = document.createElement('td');
        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn btn-sm btn-link text-danger p-0';
        removeBtn.textContent = '✕';
        removeBtn.title = 'Удалить из инвентаризации';
        removeBtn.dataset.removeId = inventoryDetails.byCells ? item.stockId : item.productId;
        removeCell.append(removeBtn);

        row.append(
            inventoryCell(item.productName, 'fw-semibold'), 
            inventoryCell(item.storageLocation || '-'), 
            inventoryCell(item.systemCount, 'text-end'), 
            inventoryInputCell(item, 'actualCount'), 
            inventoryInputCell(item, 'comment'),
            removeCell
        ); 
        body.append(row);
    }
}

async function saveInventoryCounts(requireAll) {
    const user = JSON.parse(sessionStorage.getItem('user'));
    const counts = readInventoryCounts(requireAll);
    inventoryDetails = await window.go.main.InventoryService.SaveInventoryCounts(inventoryDetails.id, counts, user.id, user.role);
}

function readInventoryCounts(requireAll) {
    const comparing = !byId('inventory-reconciliation').hidden;
    const body = byId(comparing ? 'inventory-comparison-body' : 'inventory-items-body');
    return Array.from(body.children).map((row) => {
        const value = String(row.children[3].children[0].value).trim();
        const actualCount = value === '' ? null : Number(value);
        if (requireAll && actualCount === null) throw new Error('Укажите фактическое количество для каждого товара.');
        if (actualCount !== null && (!Number.isSafeInteger(actualCount) || actualCount < 0)) throw new Error('Фактическое количество должно быть целым неотрицательным числом.');
        return { productId: Number(row.dataset.productId), ...(Number(row.dataset.stockId) > 0 ? { stockId: Number(row.dataset.stockId) } : {}),
            actualCount, comment: row.children[comparing ? 6 : 4].children[0].value.trim() };
    });
}

function renderInventoryComparison() {
    const body = byId('inventory-comparison-body'); body.replaceChildren();
    
    // Защита от пустой таблицы
    if (!inventoryDetails.items || inventoryDetails.items.length === 0) {
        const row = document.createElement('tr');
        const cell = document.createElement('td');
        cell.colSpan = 7;
        cell.className = 'text-center text-body-secondary py-4';
        cell.textContent = 'В этой инвентаризации нет товаров.';
        row.append(cell);
        body.append(row);
        return;
    }

    const canEdit = (currentUser.role === 'Менеджер' && inventoryDetails.status === 'pending' && !inventoryDetails.isApprovedByMe) || 
                    (currentUser.role === 'Кладовщик' && inventoryDetails.status === 'draft');

    for (const item of inventoryDetails.items) {
        const row = document.createElement('tr');
        row.dataset.productId = item.productId;
        row.dataset.stockId = item.stockId || 0;
        const badge = document.createElement('span');
        const cell = document.createElement('td'); cell.append(badge);
        row.append(inventoryCell(item.productName, 'fw-semibold'), inventoryCell(item.storageLocation || '-'), inventoryCell(item.systemCount, 'text-end'), inventoryInputCell(item, 'actualCount', !canEdit), inventoryCell(''), cell, inventoryInputCell(item, 'comment', !canEdit));
        body.append(row);
    }
    updateInventoryComparison(inventoryDetails.items);
}

function updateInventoryComparison(items) {
    const totals = inventoryTotals({ items });
    items.forEach((item, index) => {
        const difference = item.actualCount - item.systemCount;
        let color = 'success', result = 'Совпадает';
        if (difference < 0) { color = 'danger'; result = 'Недостача'; }
        if (difference > 0) { color = 'warning'; result = 'Излишек'; }
        const row = byId('inventory-comparison-body').children[index];
        if (!row) return;
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

function showInventoryReport() {
    renderInventoryReport(inventoryDetails, 'inventory-report');
    byId('inventory-back-to-compare').hidden = true;
    showInventoryStage('report');
}