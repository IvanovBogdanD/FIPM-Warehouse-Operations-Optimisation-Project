import './style.css';
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
                <td><button class="delete" data-id="${p.id}">Удалить</button></td>
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