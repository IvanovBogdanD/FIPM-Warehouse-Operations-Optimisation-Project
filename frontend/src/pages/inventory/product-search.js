import { createProductSearch } from '../../shared/product-search.js';
import { byId } from '../../shared/dom.js';

let inventorySearch;

export function initInventoryProductSearch(onChoose, onResults) {
    inventorySearch = createProductSearch({
        prefix: 'inventory', 
        onResults,
        keepOpenOnSelect: true, // ВКЛЮЧАЕМ РЕЖИМ МУЛЬТИВЫБОРА
        onChoose(product) {
            onChoose(product);
        },
    });
}

export function closeInventorySearch() {
    inventorySearch.close();
}