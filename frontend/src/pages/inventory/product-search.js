import { createProductSearch } from '../../shared/product-search.js';
import { callBackend } from '../../shared/api.js';

let inventorySearch;
let byCells = true;

export function initInventoryProductSearch(onChoose, onResults) {
    inventorySearch = createProductSearch({
        prefix: 'inventory', 
        onResults,
        keepOpenOnSelect: true,
        searchPage: (query, cursor) => callBackend(byCells ? 'SearchWarehouseStocksPage' : 'SearchProductsPage', query, cursor),
        productLabel: (product) => [product.name, product.article, product.storageLocation].filter(Boolean).join(' · '),
        onChoose(product) {
            onChoose(product);
        },
    });
}

export function closeInventorySearch() {
    inventorySearch.close();
}

export function setInventorySearchMode(value) {
    byCells = value;
    inventorySearch.close();
}
