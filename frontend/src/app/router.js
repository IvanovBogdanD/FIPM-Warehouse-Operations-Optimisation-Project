import { byId } from '../shared/dom.js';
import { loadHome } from '../pages/home/home.js';
import { loadProducts } from '../pages/catalog/catalog.js';
import { loadProduct } from '../pages/catalog/product.js';
import { loadReceiving } from '../pages/receiving/receiving.js';
import { loadUsers } from '../pages/users/users.js';
import { loadInventory } from '../pages/inventory/inventory.js';

function updateMenuVisibility(role) {
    const menuItems = ['nav-home', 'nav-products', 'nav-orders', 'nav-inventory', 'nav-analytics', 'nav-analytics-header', 'nav-users'];
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
    } 
    else if (role === 'Менеджер') {
        if (byId('nav-home')) byId('nav-home').classList.remove('d-none');
        if (byId('nav-products')) byId('nav-products').classList.remove('d-none');
        if (byId('nav-orders')) byId('nav-orders').classList.remove('d-none');
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

    // Дефолтный маршрут по роли после входа
    if (location.hash === '#auth' || location.hash === '') {
        location.hash = (user.role === 'Кладовщик') ? '#inventory' : '#home';
        return;
    }

    // Карточка пользователя внизу сайдбара
    const userNameEl = byId('sidebar-user-name');
    const userRoleEl = byId('sidebar-user-role');
    const userInitialEl = byId('sidebar-user-initial');

    if (userNameEl && userRoleEl && userInitialEl) {
        userNameEl.textContent = `${user.lastName} ${user.firstName}`;
        userRoleEl.textContent = user.role;
        const initial = (user.firstName && user.firstName.length > 0) ? user.firstName.charAt(0).toUpperCase() : '?';
        userInitialEl.textContent = initial;
    }

    let hash = location.hash.slice(1) || 'home';

    if (user.role === 'Кладовщик') {
        if (hash !== 'inventory') {
            location.hash = '#inventory';
            return;
        }
    } 
    else if (user.role === 'Администратор') {
        if (['products', 'product', 'orders', 'receiving', 'inventory'].includes(hash)) {
            location.hash = '#users';
            return;
        }
    } 
    else if (user.role === 'Менеджер') {
        if (['inventory', 'users'].includes(hash)) {
            location.hash = '#home';
            return;
        }
    }

    updateMenuVisibility(user.role);

    const productMatch = /^product\/(\d+)$/.exec(hash);
    let page = 'home';
    if (hash === 'products') page = 'catalog';
    if (productMatch) page = 'product';
    if (hash === 'orders') page = 'orders';
    if (hash === 'orders/receiving' || hash === 'receiving') page = 'receiving';
    if (hash === 'users') page = 'users';
    if (hash === 'inventory') page = 'inventory';
    
    const titles = { 
        home: 'Главная', catalog: 'Товары', product: 'Карточка товара', 
        orders: 'Заказы', receiving: 'Заказы', users: 'Пользователи', inventory: 'Инвентаризация' 
    };
    
    for (const name of ['home', 'catalog', 'product', 'orders', 'receiving', 'users', 'inventory']) {
        const el = byId(`${name}-page`);
        if (el) el.hidden = page !== name;
    }
    byId('page-title').textContent = titles[page];
    
    let activeHash = '#home';
    if (page === 'catalog' || page === 'product') activeHash = '#products';
    if (page === 'orders' || page === 'receiving') activeHash = '#orders';
    if (page === 'users') activeHash = '#users';
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
    if (page === 'receiving') await loadReceiving();
    if (page === 'users') await loadUsers();
    if (page === 'inventory') await loadInventory();
}

export function initRouter() {
    window.addEventListener('hashchange', route);
    window.addEventListener('stock-changed', route);
    route();
}