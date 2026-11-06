import { byId } from '../shared/dom.js';
import { loadHome } from '../pages/home/home.js';
import { loadProducts } from '../pages/catalog/catalog.js';
import { loadProduct } from '../pages/catalog/product.js';
import { loadReceiving } from '../pages/receiving/receiving.js';
import { loadOrders } from '../pages/orders/orders.js';

async function route() {
    const hash = location.hash.slice(1) || 'home';
    const productMatch = /^product\/(\d+)$/.exec(hash);
    let page = 'home';
    if (hash === 'products') page = 'catalog';
    if (productMatch) page = 'product';
    if (hash === 'orders') page = 'orders';
    if (hash === 'orders/receiving' || hash === 'receiving') page = 'receiving';
    const titles = { home: 'Главная', catalog: 'Товары', product: 'Карточка товара', orders: 'Заказы', receiving: 'Заказы' };
    for (const name of ['home', 'catalog', 'product', 'orders', 'receiving']) byId(`${name}-page`).hidden = page !== name;
    byId('page-title').textContent = titles[page];
    let activeHash = '#home';
    if (page === 'catalog' || page === 'product') activeHash = '#products';
    if (page === 'orders' || page === 'receiving') activeHash = '#orders';
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
    if (page === 'receiving') await loadReceiving();
}

export function initRouter() {
    window.addEventListener('hashchange', route);
    window.addEventListener('stock-changed', route);
    route();
}
