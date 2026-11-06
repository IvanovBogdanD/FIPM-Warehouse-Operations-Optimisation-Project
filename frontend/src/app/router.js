import { byId } from '../shared/dom.js';
import { loadHome } from '../pages/home/home.js';
import { loadProducts } from '../pages/catalog/catalog.js';
import { loadProduct } from '../pages/catalog/product.js';

async function route() {
    const hash = location.hash.slice(1) || 'home';
    const productMatch = /^product\/(\d+)$/.exec(hash);
    const page = productMatch ? 'product' : hash === 'products' ? 'catalog' : 'home';
    const titles = { home: 'Главная', catalog: 'Товары', product: 'Карточка товара' };
    for (const name of ['home', 'catalog', 'product']) byId(`${name}-page`).hidden = page !== name;
    byId('page-title').textContent = titles[page];
    const activeHash = page === 'home' ? '#home' : '#products';
    document.querySelectorAll('.sidebar-menu a.nav-link').forEach((link) => {
        const active = link.hash === activeHash;
        link.classList.toggle('active', active);
        if (active) link.setAttribute('aria-current', 'page');
        else link.removeAttribute('aria-current');
    });
    if (page === 'home') await loadHome();
    if (page === 'catalog') await loadProducts();
    if (page === 'product') await loadProduct(Number(productMatch[1]));
}

export function initRouter() {
    window.addEventListener('hashchange', route);
    route();
}
