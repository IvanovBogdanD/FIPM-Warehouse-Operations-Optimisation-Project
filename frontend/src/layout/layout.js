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
import inventoryActHtml from '../pages/inventory/inventory-act.html?raw';
import reportsHtml from '../pages/reports/reports.html?raw';
import warehouseHtml from '../pages/warehouse/warehouse.html?raw';
import movementsHtml from '../pages/warehouse/movements.html?raw';
import managerPickerHtml from '../shared/manager-picker.html?raw';
import { byId } from '../shared/dom.js';
import { withIcons } from '../shared/icons.js';

function withManagerPicker(html, id) {
    return html.replace(`{{${id}}}`, managerPickerHtml.replaceAll('manager-picker', id));
}

export function mountLayout() {
    byId('app').insertAdjacentHTML('beforeend', `<div id="main-layout" class="app-wrapper d-none">${withIcons(layoutHtml)}</div>`);
    const inventoryForm = withManagerPicker(inventoryHtml, 'inventory-responsible');
    
    byId('page-content').insertAdjacentHTML('beforeend', withIcons(
        homeHtml + catalogHtml + productHtml + usersHtml + warehouseHtml + movementsHtml
        + withManagerPicker(ordersHtml, 'order-complete-person')
        + withManagerPicker(orderFormHtml, 'order-form-responsible')
        + withManagerPicker(receivingHtml, 'receiving-responsible')
        + withManagerPicker(inventoryForm, 'inventory-commission-toggle').replace('{{inventory-act}}', inventoryActHtml)
        + reportsHtml.replace('{{inventory-act}}', inventoryActHtml.replaceAll('inventory-report-', 'reports-act-'))
    ));
    
    byId('app').insertAdjacentHTML('beforeend', `<div id="auth-page" class="d-none">${authHtml}</div>`);

    // ЛОГИКА ВЫХОДА
    byId('btn-logout').addEventListener('click', () => {
        sessionStorage.removeItem('user'); // Удаляем пользователя из памяти
        location.hash = '#auth';           // Отправляем на страницу входа
    });
}
