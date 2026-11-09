import { createProductSearch } from '../../shared/product-search.js';
import { byId } from '../../shared/dom.js';

let inventorySearch;

export function initInventoryProductSearch(onChoose, onResults) {
    inventorySearch = createProductSearch({
        prefix: 'inventory', onResults,
        onChoose(product) {
            onChoose(product);
            byId('inventory-product-search').value = '';
        },
    });
}

export function closeInventorySearch() {
    inventorySearch.close();
}
