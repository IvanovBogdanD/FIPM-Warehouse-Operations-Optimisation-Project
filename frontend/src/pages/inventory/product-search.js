import { byId, showError, showStatus } from '../../shared/dom.js';
import { callBackend } from '../../shared/api.js';

let inventorySearchVersion = 0;
let inventorySearchCursor = 0;
const inventorySearchProducts = new Map();
let inventorySearchChoose;
let inventorySearchResults;

export function initInventoryProductSearch(onChoose, onResults) {
    inventorySearchChoose = onChoose;
    inventorySearchResults = onResults;
    const input = byId('inventory-product-search');
    input.addEventListener('focus', handleSearchProducts);
    input.addEventListener('input', handleSearchProducts);
    input.addEventListener('click', () => {
        if (!byId('inventory-search-results').classList.contains('show')) handleSearchProducts();
    });
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') { event.preventDefault(); handleSearchProducts(); }
    });
    byId('inventory-product-search-btn').addEventListener('click', handleSearchProducts);
    byId('inventory-search-more').addEventListener('click', () => loadInventoryProducts(true));
    
    // Обработчик клика по товару в поиске
    byId('inventory-product-options').addEventListener('click', (event) => {
        const button = event.target.closest('button[data-product-id]');
        if (!button) return;
        
        inventorySearchChoose(inventorySearchProducts.get(Number(button.dataset.productId)));
        
        // Визуальное выделение (синяя галочка и синий фон)
        if (!button.classList.contains('active-product')) {
            button.classList.add('active-product', 'bg-primary-subtle'); // Светло-синий фон
            const check = button.querySelector('.text-primary');
            if (check) check.classList.remove('d-none'); // Показываем синюю галочку
        }
    });
    
    byId('inventory-product-picker').addEventListener('keydown', handleInventorySearchKey);
    document.addEventListener('pointerdown', handleInventorySearchOutside);
    document.addEventListener('focusin', handleInventorySearchOutside);
}

export function closeInventorySearch() {
    inventorySearchVersion++;
    byId('inventory-search-results').classList.remove('show');
    byId('inventory-product-search').setAttribute('aria-expanded', 'false');
    byId('inventory-product-options').replaceChildren();
    byId('inventory-search-more').hidden = true;
}

function handleInventorySearchOutside(event) {
    if (!byId('inventory-product-picker').contains(event.target)) closeInventorySearch();
}

function handleSearchProducts() {
    return loadInventoryProducts(false);
}

async function loadInventoryProducts(append) {
    const input = byId('inventory-product-search');
    const more = byId('inventory-search-more');
    if (input.disabled || (append && more.disabled)) return;
    const version = ++inventorySearchVersion;
    const options = byId('inventory-product-options');
    const status = byId('inventory-search-status');
    if (!append) {
        inventorySearchCursor = 0;
        options.replaceChildren();
        inventorySearchProducts.clear();
        more.hidden = true;
    }
    byId('inventory-search-results').classList.add('show');
    input.setAttribute('aria-expanded', 'true');
    showStatus(status, 'Загрузка товаров...');
    more.disabled = true;
    try {
        const page = await callBackend('SearchProductsPage', input.value.trim(), inventorySearchCursor);
        if (version !== inventorySearchVersion) return;
        for (const product of page.products) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'dropdown-item d-flex justify-content-between align-items-center gap-3 text-wrap py-2';
            button.dataset.productId = product.id;
            button.setAttribute('role', 'option');
            button.setAttribute('aria-selected', 'false');

            // Левая часть с галочкой и названием
            const leftPart = document.createElement('div');
            leftPart.className = 'd-flex align-items-center flex-grow-1';

            const check = document.createElement('span');
            check.innerHTML = '✓';
            check.className = 'me-2 text-primary fw-bold d-none'; // Скрыта, пока не выбрано

            const name = document.createElement('span');
            name.textContent = product.name;
            
            leftPart.append(check, name);

            // Правая часть с количеством
            const count = document.createElement('span');
            count.className = 'badge text-bg-light border text-nowrap';
            count.textContent = `${product.count} шт.`;
            
            button.append(leftPart, count);
            options.append(button);
            
            inventorySearchCursor = product.id;
            inventorySearchProducts.set(product.id, product);
        }
        inventorySearchResults(Array.from(inventorySearchProducts.values()));
        more.hidden = !page.hasMore;
        showStatus(status, options.children.length ? `Показано товаров: ${options.children.length}` : 'По запросу товары не найдены.');
    } catch (err) {
        if (version === inventorySearchVersion) showError(status, err);
    } finally {
        if (version === inventorySearchVersion) more.disabled = false;
    }
}

function handleInventorySearchKey(event) {
    if (event.key === 'Escape') closeInventorySearch();
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = Array.from(byId('inventory-product-options').children);
    if (buttons.length === 0) return;
    event.preventDefault();
    const index = buttons.indexOf(event.target);
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
    buttons[Math.max(0, Math.min(buttons.length - 1, next))].focus();
}