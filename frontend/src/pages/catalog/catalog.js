import { callBackend } from '../../shared/api.js';
import { byId, showError, showStatus } from '../../shared/dom.js';

let catalogRequest = 0;

export async function loadProducts() {
    const request = ++catalogRequest;
    const status = byId('catalog-status');
    showStatus(status, 'Загрузка товаров…');
    byId('products-body').replaceChildren();
    try {
        const products = await callBackend('SearchProducts', byId('search').value);
        if (request !== catalogRequest) return;
        const rows = products.map((product) => {
            const row = document.createElement('tr');
            for (const value of [product.article || '-', product.name, product.count]) {
                const cell = document.createElement('td');
                cell.className = 'text-break';
                cell.textContent = value;
                row.append(cell);
            }
            const cell = document.createElement('td');
            const link = document.createElement('a');
            link.href = `#product/${product.id}`;
            link.textContent = 'Открыть';
            cell.append(link);
            row.append(cell);
            return row;
        });
        byId('products-body').replaceChildren(...rows);
        showStatus(status, products.length ? `Найдено товаров: ${products.length}` : 'Товары не найдены.');
    } catch (error) {
        if (request === catalogRequest) showError(status, error);
    }
}

export function initCatalog() {
    byId('search').addEventListener('input', loadProducts);
    byId('reload-catalog').addEventListener('click', loadProducts);
}
