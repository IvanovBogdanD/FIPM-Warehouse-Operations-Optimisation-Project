import { byId } from '../../shared/dom.js';

let currentInventoryId = null;

export function initInventory() {
    byId('btn-create-inventory').addEventListener('click', handleCreateInventory);
    byId('inventory-product-search-btn').addEventListener('click', handleSearchProducts);
    byId('inventory-product-search').addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            handleSearchProducts();
        }
    });
    byId('inventory-search-results').addEventListener('click', handleSearchResultClick);
    byId('inventory-items-body').addEventListener('change', handleActualCountChange);
    byId('btn-apply-inventory').addEventListener('click', handleApplyInventory);
}

export async function loadInventory() {
    try {
        const draft = await window.go.main.InventoryService.GetDraftInventory();
        if (draft) {
            currentInventoryId = draft.id;
            renderInventory(draft);
        } else {
            currentInventoryId = null;
            showEmpty();
        }
    } catch (err) {
        console.error('load inventory failed:', err);
        alert('Ошибка загрузки инвентаризации: ' + err);
    }
}

function showEmpty() {
    byId('inventory-empty').classList.remove('d-none');
    byId('inventory-active').classList.add('d-none');
}

function showActive() {
    byId('inventory-empty').classList.add('d-none');
    byId('inventory-active').classList.remove('d-none');
}

function renderInventory(details) {
    showActive();
    byId('inventory-id').textContent = details.id;

    const badge = byId('inventory-status-badge');
    if (details.status === 'draft') {
        badge.textContent = 'Черновик';
        badge.className = 'badge ms-2 bg-warning-subtle text-warning border border-warning-subtle';
    } else {
        badge.textContent = 'Завершена';
        badge.className = 'badge ms-2 bg-success-subtle text-success border border-success-subtle';
    }

    const isDraft = details.status === 'draft';
    const hasAllActual = details.items.length > 0
        && details.items.every(it => it.actualCount !== null);

    byId('inventory-product-search').disabled = !isDraft;
    byId('inventory-product-search-btn').disabled = !isDraft;
    byId('btn-apply-inventory').disabled = !isDraft || !hasAllActual;

    renderItems(details.items, isDraft);
}

function renderItems(items, isDraft) {
    const tbody = byId('inventory-items-body');

    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="text-center text-muted py-4">Товары не добавлены</td></tr>';
        return;
    }

    tbody.innerHTML = '';
    items.forEach(item => {
        const tr = document.createElement('tr');
        const actual = item.actualCount !== null ? item.actualCount : '';
        const inputDisabled = isDraft ? '' : 'disabled';

        let diffText = '—';
        let diffClass = 'text-muted';
        if (item.difference !== null) {
            diffText = (item.difference > 0 ? '+' : '') + item.difference;
            if (item.difference > 0) diffClass = 'text-success';
            else if (item.difference < 0) diffClass = 'text-danger';
        }

        tr.innerHTML = `
            <td>${item.productName}</td>
            <td class="text-end">${item.systemCount}</td>
            <td class="text-end">
                <input type="number" min="0" step="1"
                       class="form-control form-control-sm text-end actual-count-input"
                       data-product-id="${item.productId}"
                       value="${actual}" ${inputDisabled}>
            </td>
            <td class="text-end fw-semibold ${diffClass}">${diffText}</td>
        `;
        tbody.appendChild(tr);
    });
}

async function handleCreateInventory() {
    const btn = byId('btn-create-inventory');
    btn.disabled = true;
    try {
        const inv = await window.go.main.InventoryService.CreateInventory();
        currentInventoryId = inv.id;
        await reloadInventory();
    } catch (err) {
        alert('Ошибка создания инвентаризации: ' + err);
    } finally {
        btn.disabled = false;
    }
}

async function reloadInventory() {
    if (currentInventoryId === null) return;
    const details = await window.go.main.InventoryService.GetInventory(currentInventoryId);
    renderInventory(details);
}

async function handleSearchProducts() {
    const q = byId('inventory-product-search').value.trim();
    const resultsEl = byId('inventory-search-results');

    if (q.length === 0) {
        resultsEl.innerHTML = '';
        return;
    }

    try {
        const products = await window.go.main.DBService.SearchProducts(q);
        if (!products || products.length === 0) {
            resultsEl.innerHTML = '<div class="list-group-item text-muted">Ничего не найдено</div>';
            return;
        }

        resultsEl.innerHTML = '';
        products.forEach(p => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'list-group-item list-group-item-action d-flex justify-content-between align-items-center';
            btn.dataset.productId = p.id;
            btn.innerHTML = `<span>${p.name}</span><span class="badge bg-light text-dark border">${p.count} шт.</span>`;
            resultsEl.appendChild(btn);
        });
    } catch (err) {
        alert('Ошибка поиска: ' + err);
    }
}

async function handleSearchResultClick(e) {
    const btn = e.target.closest('button[data-product-id]');
    if (!btn) return;

    const productId = Number(btn.dataset.productId);
    try {
        await window.go.main.InventoryService.AddInventoryItems(currentInventoryId, [productId]);
        byId('inventory-search-results').innerHTML = '';
        byId('inventory-product-search').value = '';
        await reloadInventory();
    } catch (err) {
        alert('Ошибка добавления товара: ' + err);
    }
}

async function handleActualCountChange(e) {
    if (!e.target.classList.contains('actual-count-input')) return;

    const productId = Number(e.target.dataset.productId);
    const value = e.target.value.trim();
    if (value === '') return;

    const num = Number(value);
    if (!Number.isInteger(num) || num < 0) {
        alert('Фактическое количество должно быть целым неотрицательным числом.');
        return;
    }

    try {
        await window.go.main.InventoryService.SetActualCount(currentInventoryId, productId, num);
        await reloadInventory();
    } catch (err) {
        alert('Ошибка сохранения: ' + err);
    }
}

async function handleApplyInventory() {
    if (!confirm('Применить корректировку остатков? Действие нельзя отменить.')) return;

    const btn = byId('btn-apply-inventory');
    btn.disabled = true;
    try {
        await window.go.main.InventoryService.ApplyInventory(currentInventoryId);
        await reloadInventory();
        alert('Инвентаризация завершена. Остатки обновлены.');
    } catch (err) {
        alert('Ошибка применения: ' + err);
        btn.disabled = false;
    }
}