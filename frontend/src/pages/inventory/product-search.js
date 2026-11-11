import { createProductSearch } from '../../shared/product-search.js';
import { byId } from '../../shared/dom.js';

let inventorySearch;

export function initInventoryProductSearch(onChoose, onResults) {
    inventorySearch = createProductSearch({
        prefix: 'inventory', 
        onResults,
        onChoose(product) {
            onChoose(product);
            // УБРАНА СТРОКА byId('inventory-product-search').value = ''; 
            // Теперь текст в поиске не стирается, и можно выбрать сразу несколько товаров
        },
    });
}

export function closeInventorySearch() {
    inventorySearch.close();
}