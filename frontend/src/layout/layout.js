import layoutHtml from './layout.html?raw';
import homeHtml from '../pages/home/home.html?raw';
import catalogHtml from '../pages/catalog/catalog.html?raw';
import productHtml from '../pages/catalog/product.html?raw';
import receivingHtml from '../pages/receiving/receiving.html?raw';
import ordersHtml from '../pages/orders/orders.html?raw';
import { byId } from '../shared/dom.js';
import { withIcons } from '../shared/icons.js';

export function mountLayout() {
    byId('app').insertAdjacentHTML('beforeend', withIcons(layoutHtml));
    byId('page-content').insertAdjacentHTML('beforeend', withIcons(homeHtml + catalogHtml + productHtml + ordersHtml + receivingHtml));
}
