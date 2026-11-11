import { byId, showError, showStatus } from '../../shared/dom.js';
import { createProductSearch } from '../../shared/product-search.js';

let catalogSearch;

function renderCatalog(products, hasMore) {
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
    showStatus(byId('catalog-status'), products.length
        ? `Показано товаров: ${products.length}${hasMore ? '. Продолжение доступно по кнопке «Ещё» в поиске.' : ''}`
        : 'Товары не найдены.');
}

export async function loadProducts() {
    byId('products-body').replaceChildren();
    showStatus(byId('catalog-status'), 'Загрузка товаров...');
    await catalogSearch.load({ open: false });
}

export function initCatalog() {
    catalogSearch = createProductSearch({
        prefix: 'catalog', inputId: 'search', onResults: renderCatalog,
        onChoose(product) { location.hash = `#product/${product.id}`; },
        onError(error) { byId('products-body').replaceChildren(); showError(byId('catalog-status'), error); },
    });
    byId('reload-catalog').addEventListener('click', loadProducts);
}
