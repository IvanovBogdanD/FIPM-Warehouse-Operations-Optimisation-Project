import { byId } from '../shared/dom.js';
import { loadHome } from '../pages/home/home.js';
import { loadProducts } from '../pages/catalog/catalog.js';
import { loadProduct } from '../pages/catalog/product.js';
import { loadReceiving } from '../pages/receiving/receiving.js';
import { loadUsers } from '../pages/users/users.js';
import { loadInventory } from '../pages/inventory/inventory.js';
import { loadOrders } from '../pages/orders/orders.js';
import { loadOrderForm } from '../pages/order-form/order-form.js';
import { loadWarehouse } from '../pages/warehouse/warehouse.js';
import { loadReports } from '../pages/reports/reports.js';

function updateMenuVisibility(role) {
    const menuItems = ['nav-home', 'nav-products', 'nav-warehouse', 'nav-orders', 'nav-inventory', 'nav-analytics', 'nav-analytics-header', 'nav-users'];
    menuItems.forEach(id => {
        const el = byId(id);
        if (el) el.classList.add('d-none');
    });

    if (role === 'Администратор') {
        if (byId('nav-home')) byId('nav-home').classList.remove('d-none');
        if (byId('nav-users')) byId('nav-users').classList.remove('d-none');
    } 
    else if (role === 'Кладовщик') {
        if (byId('nav-inventory')) byId('nav-inventory').classList.remove('d-none');
        if (byId('nav-analytics')) byId('nav-analytics').classList.remove('d-none');
        if (byId('nav-analytics-header')) byId('nav-analytics-header').classList.remove('d-none');
    } 
    else if (role === 'Менеджер') {
        if (byId('nav-home')) byId('nav-home').classList.remove('d-none');
        if (byId('nav-products')) byId('nav-products').classList.remove('d-none');
        if (byId('nav-warehouse')) byId('nav-warehouse').classList.remove('d-none');
        if (byId('nav-orders')) byId('nav-orders').classList.remove('d-none');
        if (byId('nav-inventory')) byId('nav-inventory').classList.remove('d-none'); // Добавлена вкладка
        if (byId('nav-analytics')) byId('nav-analytics').classList.remove('d-none');
        if (byId('nav-analytics-header')) byId('nav-analytics-header').classList.remove('d-none');
    }
}

async function route() {
    const userStr = sessionStorage.getItem('user');
    
    if (!userStr) {
        if (location.hash !== '#auth') {
            location.hash = '#auth';
            return;
        }
        byId('main-layout').classList.add('d-none');
        byId('auth-page').classList.remove('d-none');
        return;
    }

    byId('main-layout').classList.remove('d-none');
    byId('auth-page').classList.add('d-none');

    const user = JSON.parse(userStr);

    if (location.hash === '#auth' || location.hash === '') {
        location.hash = (user.role === 'Кладовщик') ? '#inventory' : '#home';
        return;
    }

    const userNameEl = byId('sidebar-user-name');
    const userRoleEl = byId('sidebar-user-role');
    const userInitialEl = byId('sidebar-user-initial');

    if (userNameEl && userRoleEl && userInitialEl) {
        userNameEl.textContent = `${user.lastName} ${user.firstName}`;
        userRoleEl.textContent = user.role;
        const initial = (user.firstName && user.firstName.length > 0) ? user.firstName.charAt(0).toUpperCase() : '?';
        userInitialEl.textContent = initial;
    }

    const hash = location.hash.slice(1) || 'home';
    const reportMatch = /^reports(?:\/(\d+))?$/.exec(hash);
    const inventoryMatch = /^inventory(?:\/(\d+))?$/.exec(hash);

    if (user.role === 'Кладовщик') {
        if (hash !== 'inventory' && !hash.startsWith('inventory/') && !hash.startsWith('reports')) {
            location.hash = '#inventory';
            return;
        }
    } 
    else if (user.role === 'Администратор') {
        if (['products', 'product', 'warehouse', 'orders', 'orders/new', 'orders/new/writeoff', 'receiving', 'inventory'].includes(hash) || hash.startsWith('inventory/') || hash.startsWith('reports')) {
            location.hash = '#users';
            return;
        }
    } 
    else if (user.role === 'Менеджер') {
        if (['users'].includes(hash)) {
            location.hash = '#home';
            return;
        }
    }

    if (reportMatch && user.role !== 'Менеджер' && user.role !== 'Кладовщик') {
        location.hash = '#home';
        return;
    }

    updateMenuVisibility(user.role);

    const productMatch = /^product\/(\d+)$/.exec(hash);
    const orderFormMatch = /^orders\/new(\/writeoff)?$/.exec(hash);
    let page = 'home';
    if (hash === 'products') page = 'catalog';
    if (hash === 'warehouse') page = 'warehouse';
    if (reportMatch) page = 'reports';
    if (productMatch) page = 'product';
    if (hash === 'orders') page = 'orders';
    if (orderFormMatch) page = 'order-form';
    if (hash === 'orders/receiving' || hash === 'receiving') page = 'receiving';
    if (hash === 'users') page = 'users';
    if (inventoryMatch) page = 'inventory';

    const titles = {
        home: 'Главная', catalog: 'Товары', product: 'Товары / Карточка товара',
        orders: 'Заказы', 'order-form': 'Заказы', receiving: 'Заказы', users: 'Пользователи',
        inventory: 'Инвентаризация', warehouse: 'Карта склада', reports: 'Отчёты'
    };

    for (const name of Object.keys(titles)) {
        const el = byId(`${name}-page`);
        if (el) el.hidden = page !== name;
    }
    byId('page-title').textContent = titles[page];
    
    let activeHash = `#${page}`;
    if (page === 'catalog' || page === 'product') activeHash = '#products';
    if (page === 'orders' || page === 'order-form' || page === 'receiving') activeHash = '#orders';
    if (page === 'inventory') activeHash = '#inventory';

    document.querySelectorAll('.sidebar-menu a.nav-link').forEach((link) => {
        const active = link.hash === activeHash;
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });

    if (page === 'home') await loadHome();
    if (page === 'catalog') await loadProducts();
    if (page === 'product') await loadProduct(Number(productMatch[1]));
    if (page === 'orders') await loadOrders();
    if (page === 'order-form') await loadOrderForm(orderFormMatch[1] ? 'writeoff' : 'shipment');
    if (page === 'receiving') await loadReceiving();
    if (page === 'users') await loadUsers();
    if (page === 'inventory') await loadInventory(inventoryMatch && inventoryMatch[1] ? Number(inventoryMatch[1]) : null);
    if (page === 'warehouse') await loadWarehouse();
    if (page === 'reports') await loadReports(reportMatch[1] ? Number(reportMatch[1]) : null);
}

export function initRouter() {
    window.addEventListener('hashchange', route);
    window.addEventListener('stock-changed', route);
    route();
}