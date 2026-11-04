// 1. Bootstrap CSS (база)
import 'bootstrap/dist/css/bootstrap.min.css';
// 2. AdminLTE CSS (поверх Bootstrap)
import 'admin-lte/dist/css/adminlte.min.css';
// 3. Наши стили (могут переопределить adminlte)
import './style.css';

// 4. JS: сначала Bootstrap, потом AdminLTE
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import 'admin-lte/dist/js/adminlte.min.js';
import { GetAllProducts, AddProduct, DeleteProduct } from '../wailsjs/go/main/DBService';

const form     = document.getElementById('add-form');
const tbody    = document.getElementById('products-body');
const statusEl = document.getElementById('status');

// ---------- Загрузка списка ----------
async function loadProducts() {
    try {
        const products = await GetAllProducts();
        tbody.innerHTML = '';

        if (!products || products.length === 0) {
            statusEl.textContent = 'Товаров пока нет';
            return;
        }
        statusEl.textContent = `Всего товаров: ${products.length}`;

        products.forEach(p => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${p.id}</td>
                <td>${p.name}</td>
                <td>${p.count}</td>
                <td><button class="btn btn-danger btn-sm delete" data-id="${p.id}">Удалить</button></td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error(err);
        statusEl.textContent = 'Ошибка загрузки: ' + err;
    }
}

// ---------- Добавление ----------
form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const product = {
        name:  document.getElementById('name').value,
        count: parseInt(document.getElementById('count').value),
    };

    try {
        await AddProduct(product);
        form.reset();
        await loadProducts();
    } catch (err) {
        console.error(err);
        statusEl.textContent = 'Ошибка добавления: ' + err;
    }
});

// ---------- Удаление ----------
tbody.addEventListener('click', async (e) => {
    if (!e.target.classList.contains('delete')) return;

    const id = parseInt(e.target.dataset.id);
    try {
        await DeleteProduct(id);
        await loadProducts();
    } catch (err) {
        console.error(err);
        statusEl.textContent = 'Ошибка удаления: ' + err;
    }
});

// ---------- Старт ----------
loadProducts();