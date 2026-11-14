import layoutHtml from './layout.html?raw';
import homeHtml from '../pages/home/home.html?raw';
import catalogHtml from '../pages/catalog/catalog.html?raw';
import productHtml from '../pages/catalog/product.html?raw';
import receivingHtml from '../pages/receiving/receiving.html?raw';
import ordersHtml from '../pages/orders/orders.html?raw';
import orderFormHtml from '../pages/order-form/order-form.html?raw';
import authHtml from '../pages/auth/auth.html?raw';
import usersHtml from '../pages/users/users.html?raw';
import inventoryHtml from '../pages/inventory/inventory.html?raw';
import warehouseHtml from '../pages/warehouse/warehouse.html?raw';
import { byId } from '../shared/dom.js';
import { withIcons } from '../shared/icons.js';

export function mountLayout() {
    byId('app').insertAdjacentHTML('beforeend', `<div id="main-layout" class="app-wrapper d-none">${withIcons(layoutHtml)}</div>`);
    
    byId('page-content').insertAdjacentHTML('beforeend', withIcons(
        homeHtml + catalogHtml + productHtml + ordersHtml + orderFormHtml + receivingHtml + usersHtml + inventoryHtml + warehouseHtml
    ));
    
    byId('app').insertAdjacentHTML('beforeend', `<div id="auth-page" class="d-none">${authHtml}</div>`);

    // ЛОГИКА ВЫХОДА
    byId('btn-logout').addEventListener('click', () => {
        sessionStorage.removeItem('user'); // Удаляем пользователя из памяти
        location.hash = '#auth';           // Отправляем на страницу входа
    });
}
