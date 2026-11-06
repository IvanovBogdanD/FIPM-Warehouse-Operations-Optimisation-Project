import 'bootstrap/dist/css/bootstrap.min.css';
import 'admin-lte/dist/css/adminlte.min.css';
import './style.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import 'admin-lte';
import { callBackend } from './api.js';

const byId = (id) => document.getElementById(id);
let catalogRequest = 0;
let routeRequest = 0;

function showError(element, error) {
    element.classList.add('text-danger');
    element.textContent = `Ошибка: ${error?.message || String(error)}`;
}

function showStatus(element, message) {
    element.classList.remove('text-danger');
    element.textContent = message;
}

async function loadProducts() {
    const request = ++catalogRequest;
    const status = byId('catalog-status');
    showStatus(status, 'Загрузка товаров…');
    byId('products-body').replaceChildren();
    try {
        const products = await callBackend('SearchProducts', byId('search').value);
        if (request !== catalogRequest) return;
        const rows = products.map((product) => {
            const row = document.createElement('tr');
            for (const value of [product.id, product.name, product.count]) {
                const cell = document.createElement('td');
                cell.textContent = value;
                row.append(cell);
            }
            const cell = document.createElement('td');
            const link = document.createElement('a');
            link.href = `#product/${product.id}`;
            link.textContent = 'Открыть';
            cell.append(link);
            row.append(cell);
            return row;
        });
        byId('products-body').replaceChildren(...rows);
        showStatus(status, products.length ? `Найдено товаров: ${products.length}` : 'Товары не найдены.');
    } catch (error) {
        if (request === catalogRequest) showError(status, error);
    }
}

async function route() {
    const request = ++routeRequest;
    const hash = location.hash.slice(1) || 'products';
    const productMatch = /^product\/(\d+)$/.exec(hash);
    const page = productMatch ? 'product' : 'catalog';
    for (const name of ['catalog', 'product']) byId(`${name}-page`).hidden = page !== name;
    byId('page-title').textContent = { catalog: 'Товары', product: 'Карточка товара' }[page];
    document.querySelectorAll('.sidebar-menu .nav-link').forEach((link) => {
        link.classList.toggle('active', link.hash === '#products');
    });
    if (page === 'catalog') await loadProducts();
    if (page === 'product') {
        byId('product-details').replaceChildren();
        showStatus(byId('product-status'), 'Загрузка товара…');
        try {
            const product = await callBackend('GetProduct', Number(productMatch[1]));
            if (request !== routeRequest) return;
            for (const [label, value] of [['ID', product.id], ['Название', product.name], ['Количество', product.count]]) {
                const term = document.createElement('dt');
                const definition = document.createElement('dd');
                term.textContent = label;
                definition.textContent = value;
                byId('product-details').append(term, definition);
            }
            showStatus(byId('product-status'), '');
        } catch (error) {
            if (request === routeRequest) showError(byId('product-status'), error);
        }
    }
}

byId('search').addEventListener('input', loadProducts);
byId('reload-catalog').addEventListener('click', loadProducts);
window.addEventListener('hashchange', route);
route();
