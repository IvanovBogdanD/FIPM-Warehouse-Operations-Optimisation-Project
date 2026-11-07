import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const templateFiles = ['index.html', 'src/layout/layout.html', 'src/pages/home/home.html',
    'src/pages/catalog/catalog.html', 'src/pages/catalog/product.html', 'src/pages/orders/orders.html', 'src/pages/receiving/receiving.html',
    'src/pages/auth/auth.html', 'src/pages/users/users.html', 'src/pages/inventory/inventory.html'];
const html = (await Promise.all(templateFiles.map((file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8')))).join('\n');
const moduleFiles = ['shared/api.js', 'shared/dom.js', 'shared/icons.js', 'layout/layout.js',
    'pages/home/home.js', 'pages/catalog/catalog.js', 'pages/catalog/product.js', 'pages/receiving/receiving.js', 'pages/orders/orders.js',
    'pages/auth/auth.js', 'pages/users/users.js', 'pages/inventory/inventory.js', 'app/router.js', 'main.js'];
const scripts = [];
for (const file of moduleFiles) {
    const url = new URL(`../src/${file}`, import.meta.url);
    let source = (await readFile(url, 'utf8')).replaceAll('\r\n', '\n');
    for (const match of source.matchAll(/^import (\w+) from '([^']+)\?raw';$/gm)) {
        const content = await readFile(new URL(match[2], url), 'utf8');
        source = source.replace(match[0], `const ${match[1]} = ${JSON.stringify(content)};`);
    }
    scripts.push(source.replace(/^import .+;\n/gm, '').replace(/^export /gm, ''));
}
const main = scripts.join('\n');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const product = (count = 10) => ({ id: 1, name: 'Молоко', count });
const receipt = (count = 10, status = 'pending') => ({
    id: 'test-order', number: 'П-TESTORDE', product: product(count), quantity: 3, responsible: 'Иванов', location: 'Стеллаж 1', status,
});
const order = (status = 'pending', changes = {}) => ({
    id: 'test-order', number: 'П-TESTORDE', type: 'receiving', status, createdAt: '2026-10-14T10:42:00+03:00', shipmentDate: null,
    responsible: 'Иванов', location: 'Стеллаж 1', items: [{ productId: 1, name: 'Молоко', quantity: 3 }], ...changes,
});
const rowText = (row) => row.children.map((cell) => cell.children[0]?.textContent ?? cell.textContent);

function deferred() {
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    return { promise, resolve, reject };
}

class Element {
    constructor() {
        this.value = '';
        this.textContent = '';
        this.hidden = false;
        this.disabled = false;
        this.children = [];
        this.dataset = {};
        this.listeners = new Map();
        this.classes = new Set();
        this.classList = {
            add: (name) => this.classes.add(name),
            remove: (name) => this.classes.delete(name),
            toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name),
        };
    }
    addEventListener(name, callback) {
        const listeners = this.listeners.get(name) || [];
        listeners.push(callback);
        this.listeners.set(name, listeners);
    }
    async fire(name) {
        for (const callback of this.listeners.get(name) || []) await callback({ preventDefault() {} });
    }
    dispatchEvent(event) { for (const callback of this.listeners.get(event.type) || []) callback(event); }
    append(...children) {
        for (const child of children) {
            if (typeof child === 'string') this.textContent += child;
            else this.children.push(child);
        }
    }
    replaceChildren(...children) { this.children = children; }
    insertAdjacentHTML(position, content) {
        assert.equal(position, 'beforeend');
        assert.ok(content.length > 0);
        assert.doesNotMatch(content, /\{\{[\w-]+\}\}/);
    }
    setAttribute(name, value) { this[name] = value; }
    removeAttribute(name) { delete this[name]; }
    set innerHTML(value) { throw new Error(`Небезопасный HTML: ${value}`); }
}

async function app(service = {}, hash = '#products') {
    const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, new Element()]));
    for (const id of ['main-layout', 'auth-page']) elements[id] = new Element();
    const window = new Element();
    window.go = { main: { DBService: {
        SearchProducts: async () => [product()],
        GetAllProducts: async () => [product()],
        GetProduct: async () => product(),
        CreateReceiving: async () => receipt(), GetReceiving: async () => receipt(),
        CompleteReceiving: async () => receipt(13, 'completed'), CancelReceiving: async () => {},
        GetOrders: async () => [], CancelOrder: async () => order('cancelled'),
        ...service,
    } } };
    let currentHash = hash;
    const location = {
        get hash() { return currentHash; },
        set hash(value) {
            if (value === currentHash) return;
            currentHash = value;
            Promise.resolve().then(() => window.fire('hashchange'));
        },
    };
    elements['receiving-form'].reset = () => {
        for (const id of ['receiving-product', 'receiving-quantity', 'receiving-responsible', 'receiving-location']) elements[id].value = '';
    };
    const navLinks = ['#home', '#products', '#orders'].map((hash) => Object.assign(new Element(), { hash }));
    const context = vm.createContext({
        window, location, Event,
        sessionStorage: { getItem: () => JSON.stringify({ role: 'Менеджер', firstName: 'Иван', lastName: 'Иванов' }) },
        document: {
            getElementById: (id) => {
                assert.ok(elements[id], `Элемент ${id} отсутствует в HTML`);
                return elements[id];
            },
            createElement: () => new Element(), querySelectorAll: () => navLinks,
        },
    });
    vm.runInContext(main, context);
    await tick();
    return {
        elements, navLinks,
        async navigate(hash) { currentHash = hash; await window.fire('hashchange'); },
        async draft() {
            await this.navigate('#orders/receiving');
            elements['receiving-product'].value = '1';
            elements['receiving-quantity'].value = '3';
            elements['receiving-responsible'].value = 'Иванов';
            elements['receiving-location'].value = 'Стеллаж 1';
            await elements['receiving-product'].fire('change');
            await elements['receiving-form'].fire('submit');
        },
    };
}

test('Поиск игнорирует запоздалые ответы и безопасно выводит названия', async () => {
    const slow = deferred();
    const ui = await app({ SearchProducts: (query) => query === 'старый' ? slow.promise : Promise.resolve([]) });
    const search = ui.elements.search;
    search.value = 'старый';
    const old = search.fire('input');
    search.value = 'новый';
    await search.fire('input');
    assert.match(ui.elements['catalog-status'].textContent, /не найдены/);
    slow.resolve([product()]);
    await old;
    assert.equal(ui.elements['products-body'].children.length, 0);
    const unsafe = '<img src=x onerror=alert(1)>';
    const safe = await app({ SearchProducts: async () => [{ ...product(), name: unsafe }] });
    const row = safe.elements['products-body'].children[0];
    assert.equal(row.children[1].textContent, unsafe);
    assert.equal(row.children[3].children[0].href, '#product/1');
});

test('Ссылка открывает карточку с данными товара, возврат сохраняет поиск', async () => {
    const queries = [];
    const ui = await app({
        SearchProducts: async (query) => { queries.push(query); return [product()]; },
        GetProduct: async (id) => { assert.equal(id, 1); return product(); },
    });
    ui.elements.search.value = 'мол';
    await ui.elements.search.fire('input');
    const link = ui.elements['products-body'].children[0].children[3].children[0];
    await ui.navigate(link.href);
    assert.equal(ui.elements['catalog-page'].hidden, true);
    assert.equal(ui.elements['product-page'].hidden, false);
    assert.equal(ui.elements['product-name'].textContent, 'Молоко');
    assert.equal(ui.elements['product-info-name'].textContent, 'Молоко');
    assert.equal(ui.elements['product-id'].textContent, 'ID 1');
    assert.equal(ui.elements['product-count'].textContent, '10');
    await ui.navigate('#products');
    assert.equal(ui.elements['catalog-page'].hidden, false);
    assert.equal(ui.elements['product-page'].hidden, true);
    assert.equal(queries.at(-1), 'мол');
});

test('Ошибки загрузки видны, обновление каталога позволяет повторить запрос', async () => {
    let failed = true;
    const ui = await app({
        SearchProducts: async () => { if (failed) throw new Error('SQLite read'); return [product()]; },
        GetProduct: async () => { throw new Error('товар не найден'); },
    });
    assert.match(ui.elements['catalog-status'].textContent, /SQLite read/);
    assert.equal(ui.elements['products-body'].children.length, 0);
    await ui.navigate('#product/999');
    assert.match(ui.elements['product-status'].textContent, /товар не найден/);
    assert.equal(ui.elements['product-card'].hidden, true);
    assert.equal(ui.elements['product-summary'].hidden, true);
    assert.equal(ui.elements['product-name'].textContent, 'Карточка товара');
    failed = false;
    await ui.navigate('#products');
    await ui.elements['reload-catalog'].fire('click');
    assert.equal(ui.elements['products-body'].children.length, 1);
    assert.equal(ui.elements['catalog-status'].classes.has('text-danger'), false);
    assert.match(ui.elements['catalog-status'].textContent, /Найдено товаров: 1/);
});

test('Запоздалый ответ карточки не подменяет выбранный товар', async () => {
    const slow = deferred();
    const ui = await app({
        GetProduct: (id) => id === 1 ? slow.promise : Promise.resolve({ id: 2, name: 'Хлеб', count: 5 }),
    });
    const old = ui.navigate('#product/1');
    await ui.navigate('#product/2');
    slow.resolve(product());
    await old;
    assert.equal(ui.elements['product-name'].textContent, 'Хлеб');
    assert.equal(ui.elements['product-count'].textContent, '5');
});

test('Навигация не дублирует обработчики поиска и обновления', async () => {
    const ui = await app();
    for (let i = 0; i < 5; i++) {
        await ui.navigate('#home');
        await ui.navigate('#product/1');
        await ui.navigate('#products');
    }
    assert.equal(ui.elements.search.listeners.get('input').length, 1);
    assert.equal(ui.elements['reload-catalog'].listeners.get('click').length, 1);
    assert.equal(ui.elements['reload-home'].listeners.get('click').length, 1);
});

test('Главная открывается по умолчанию и показывает остатки из SQLite', async () => {
    const unsafeName = '<img src=x onerror=alert(1)>';
    const ui = await app({ GetAllProducts: async () => [product(25), { id: 2, name: unsafeName, count: 0 }] }, '');
    assert.equal(ui.elements['home-page'].hidden, false);
    assert.equal(ui.elements['catalog-page'].hidden, true);
    assert.equal(ui.elements['home-total'].textContent, '25');
    assert.match(ui.elements['home-positions'].textContent, /2/);
    assert.equal(Number(ui.elements['home-attention-count'].textContent), 1);
    const warning = ui.elements['home-attention'].children[0];
    assert.equal(warning.href, '#product/2');
    assert.equal(warning.children[0].textContent, unsafeName);
    assert.equal(ui.navLinks[0]['aria-current'], 'page');
    await ui.navigate('#products');
    assert.equal(ui.elements['home-page'].hidden, true);
    assert.equal(ui.navLinks[1]['aria-current'], 'page');
    assert.equal(ui.navLinks[0]['aria-current'], undefined);
});

test('Главная различает пустой каталог и ошибку загрузки, запрос можно повторить', async () => {
    let failed = true;
    const ui = await app({ GetAllProducts: async () => { if (failed) throw new Error('SQLite read'); return []; } }, '#home');
    assert.match(ui.elements['home-status'].textContent, /SQLite read/);
    assert.equal(ui.elements['home-total'].textContent, 'Недоступно');
    failed = false;
    await ui.elements['reload-home'].fire('click');
    assert.equal(ui.elements['home-total'].textContent, '0');
    assert.match(ui.elements['home-status'].textContent, /Каталог пуст/);
    assert.equal(ui.elements['home-status'].classes.has('text-danger'), false);
});

test('Запоздалый ответ не подменяет обновлённую сводку главной', async () => {
    const slow = deferred();
    let requests = 0;
    const ui = await app({ GetAllProducts: () => ++requests === 1 ? slow.promise : Promise.resolve([product(50)]) }, '#home');
    await ui.elements['reload-home'].fire('click');
    slow.resolve([product(10)]);
    await tick();
    assert.equal(ui.elements['home-total'].textContent, '50');
});

test('Приёмка проверяет обязательные поля, отменяет черновик без изменения остатка', async () => {
    let creates = 0, cancels = 0;
    const ui = await app({
        CreateReceiving: async () => { creates++; return receipt(); },
        CancelReceiving: async (id) => { assert.equal(id, 'test-order'); cancels++; },
    }, '#receiving');
    for (const quantity of ['', '0', '-1', '1.5', '1e2', '9007199254740992']) {
        ui.elements['receiving-product'].value = '1';
        ui.elements['receiving-quantity'].value = quantity;
        ui.elements['receiving-responsible'].value = 'Иванов';
        ui.elements['receiving-location'].value = 'Стеллаж 1';
        await ui.elements['receiving-form'].fire('submit');
        assert.match(ui.elements['receiving-status'].textContent, /Количество/);
    }
    ui.elements['receiving-quantity'].value = '3';
    ui.elements['receiving-responsible'].value = ' ';
    await ui.elements['receiving-form'].fire('submit');
    assert.match(ui.elements['receiving-status'].textContent, /ФИО/);
    assert.equal(creates, 0);
    await ui.draft();
    assert.equal(creates, 1);
    assert.equal(ui.elements['receiving-current-count'].textContent, '10 шт.');
    assert.equal(ui.elements['receiving-confirmation'].hidden, false);
    assert.equal(ui.elements['receiving-fields'].disabled, true);
    await ui.navigate('#products');
    await ui.navigate('#receiving');
    assert.equal(ui.elements['receiving-order-status'].textContent, 'Черновик');
    await ui.elements['cancel-receiving'].fire('click');
    assert.equal(cancels, 1);
    assert.equal(ui.elements['receiving-confirmation'].hidden, true);
    assert.equal(ui.elements['receiving-fields'].disabled, false);
    assert.match(ui.elements['receiving-status'].textContent, /не изменён/);
});

for (const destination of ['#products', '#product/1', '#home']) {
    test(`Завершение приёмки обновляет открытую страницу ${destination}`, async () => {
        const completion = deferred();
        let stock = 10;
        const ui = await app({
            GetAllProducts: async () => [product(stock)], SearchProducts: async () => [product(stock)],
            GetProduct: async () => product(stock), CompleteReceiving: () => completion.promise,
        });
        await ui.draft();
        const finishing = ui.elements['complete-receiving'].fire('click');
        await ui.navigate(destination);
        stock = 13;
        completion.resolve(receipt(stock, 'completed'));
        await finishing;
        await tick();
        const shown = destination === '#products'
            ? ui.elements['products-body'].children[0].children[2].textContent
            : destination === '#home' ? ui.elements['home-total'].textContent
                : ui.elements['product-count'].textContent;
        assert.equal(Number(shown), stock);
    });
}

test('Повторные нажатия не дублируют приёмку, ошибку SQLite можно повторить', async () => {
    const creation = deferred(), completion = deferred();
    let creates = 0, completes = 0, cancels = 0;
    const ui = await app({
        CreateReceiving: () => { creates++; return creation.promise; },
        CompleteReceiving: () => { completes++; return completes === 1 ? completion.promise : Promise.resolve(receipt(13, 'completed')); },
        CancelReceiving: async () => { cancels++; },
    });
    const drafting = ui.draft();
    await tick();
    await ui.elements['receiving-form'].fire('submit');
    assert.equal(creates, 1);
    creation.resolve(receipt());
    await drafting;
    const finishing = ui.elements['complete-receiving'].fire('click');
    await ui.elements['complete-receiving'].fire('click');
    await ui.elements['cancel-receiving'].fire('click');
    assert.equal(completes, 1);
    assert.equal(cancels, 0);
    completion.reject(new Error('SQLite write'));
    await finishing;
    assert.match(ui.elements['receiving-status'].textContent, /SQLite write/);
    assert.equal(ui.elements['complete-receiving'].disabled, false);
    await ui.elements['complete-receiving'].fire('click');
    assert.equal(ui.elements['receiving-completed-count'].textContent, 'Остаток после завершения: 13 шт.');
    assert.equal(ui.elements['receiving-actions'].hidden, true);
    await ui.elements['complete-receiving'].fire('click');
    assert.equal(completes, 2);
});

test('Ошибка списка товаров блокирует создание приёмки до повторной загрузки', async () => {
    let failed = true;
    const ui = await app({ GetAllProducts: async () => { if (failed) throw new Error('SQLite read'); return [product()]; } }, '#receiving');
    assert.equal(ui.elements['receiving-fields'].disabled, true);
    assert.match(ui.elements['receiving-status'].textContent, /SQLite read/);
    failed = false;
    await ui.elements['reload-receiving'].fire('click');
    assert.equal(ui.elements['receiving-fields'].disabled, false);
});

test('Приёмка открывается внутри заказов и сохраняет черновик при возврате', async () => {
    const ui = await app({}, '#orders');
    assert.equal(ui.elements['orders-page'].hidden, false);
    assert.equal(ui.elements['receiving-page'].hidden, true);
    assert.equal(ui.navLinks[2]['aria-current'], 'page');
    await ui.draft();
    assert.equal(ui.elements['orders-page'].hidden, true);
    assert.equal(ui.elements['receiving-page'].hidden, false);
    assert.equal(ui.elements['page-title'].textContent, 'Заказы');
    assert.equal(ui.navLinks[2]['aria-current'], 'page');
    await ui.navigate('#orders');
    await ui.navigate('#orders/receiving');
    assert.equal(ui.elements['receiving-order-status'].textContent, 'Черновик');
    assert.equal(ui.elements['receiving-fields'].disabled, true);
    await ui.elements['cancel-receiving'].fire('click');
    assert.equal(ui.elements['receiving-fields'].disabled, false);
});

test('Карточка показывает наличие и скрывает данные, если товар не загружен', async () => {
    const counts = { 1: 1240, 2: 0 };
    const ui = await app({
        GetProduct: async (id) => {
            if (!(id in counts)) throw new Error('товар не найден');
            return { id, name: 'Молоко', count: counts[id] };
        },
    });
    await ui.navigate('#product/1');
    assert.equal(ui.elements['product-card'].hidden, false);
    assert.equal(ui.elements['product-summary'].hidden, false);
    assert.equal(ui.elements['product-count'].textContent, (1240).toLocaleString('ru-RU'));
    assert.equal(ui.elements['product-availability'].textContent, 'В наличии');
    assert.equal(ui.elements['product-availability'].className, 'badge text-bg-success');
    await ui.navigate('#product/2');
    assert.equal(ui.elements['product-availability'].textContent, 'Нет в наличии');
    assert.equal(ui.elements['product-availability'].className, 'badge text-bg-danger');
    await ui.navigate('#product/999');
    assert.equal(ui.elements['product-card'].hidden, true);
    assert.equal(ui.elements['product-summary'].hidden, true);
});

test('Поля карточки без данных в базе показаны честно, а не выдуманы', () => {
    assert.match(html, /Фотография товара:<br>нет данных/);
    for (const field of ['Поставщик', 'Производитель', 'Срок хранения \\(FIFO\\/LIFO\\)', 'Размер в юнитах \\(SKU\\)',
        'ID товарной позиции', 'Дата поступления на склад', 'Ячейка']) {
        assert.match(html, new RegExp(`<dt [^>]*>${field}</dt><dd [^>]*>Нет данных</dd>`), field);
    }
    for (const field of ['Свободное количество', 'Количество в брони']) {
        assert.match(html, new RegExp(`<p [^>]*>${field}</p>\\s*<p [^>]*>Нет данных</p>`), field);
    }
    for (const field of ['Длина', 'Ширина', 'Высота', 'Масса', 'Объём жидкости', 'Объём упаковки']) {
        assert.match(html, new RegExp(`<p [^>]*>${field}</p><p [^>]*>Нет данных</p>`), field);
    }
    assert.doesNotMatch(html, /Распределение по складам/);
});

test('Меню заказов предлагает приёмку, а создание заказа отмечено как недоступное', () => {
    assert.match(html, /id="orders-create-order" class="dropdown-item disabled py-2" aria-disabled="true">\s*<span class="d-block fw-semibold">Создать заказ<\/span>\s*<small>Модуль в разработке<\/small>/);
    assert.match(html, /id="orders-create-receiving" class="dropdown-item py-2" href="#orders\/receiving">\s*<span class="d-block fw-semibold">Приёмка товара<\/span>/);
    assert.match(html, /id="orders-actions"[^>]*data-bs-toggle="dropdown"/);
});

test('Окно отмены подключено к Bootstrap и лежит вне скрываемой секции', () => {
    assert.match(html, /id="order-cancel"[^>]*data-bs-toggle="modal" data-bs-target="#order-cancel-modal"/);
    assert.match(html, /id="order-cancel-confirm"[^>]*data-bs-dismiss="modal"/);
    assert.match(html, /id="order-cancel-back"[^>]*data-bs-dismiss="modal"/);
    assert.match(html, /<\/section>\s*<div id="order-cancel-modal" class="modal fade"/);
});

test('Заказы показывают статус, даты, ответственного и безопасно выводят данные', async () => {
    const unsafe = '<img src=x onerror=alert(1)>';
    const ui = await app({ GetOrders: async () => [
        order('pending', { responsible: unsafe }),
        order('completed', { id: 'done', number: 'П-DONE', shipmentDate: '2026-10-16T09:00:00+03:00' }),
        order('cancelled', { id: 'gone', number: 'П-GONE' }),
    ] }, '#orders');
    assert.equal(ui.elements['orders-status'].textContent, '');
    assert.equal(ui.elements['orders-empty'].hidden, true);
    const [pending, completed, cancelled] = ui.elements['orders-body'].children;
    const expectedCreated = new Date('2026-10-14T10:42:00+03:00').toLocaleString('ru-RU', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
    });
    assert.deepEqual(rowText(pending).slice(0, 6), ['П-TESTORDE', 'Черновик', expectedCreated, '—', unsafe, '1']);
    assert.equal(rowText(completed)[1], 'Завершён');
    assert.notEqual(rowText(completed)[3], '—');
    assert.equal(rowText(cancelled)[1], 'Отменён');
    assert.equal(pending.children[6].children.length, 1);
    assert.equal(completed.children[6].children.length, 0);
    assert.equal(cancelled.children[6].children.length, 0);
    assert.equal(pending.children[6].children[0]['data-bs-toggle'], 'modal');
    assert.equal(pending.children[6].children[0]['data-bs-target'], '#order-cancel-modal');
    assert.equal(ui.elements['orders-count-all'].textContent, '3');
    assert.equal(ui.elements['orders-count-pending'].textContent, '1');
});

test('Неизвестные статус и тип показываются как есть и не ломают список', async () => {
    const ui = await app({ GetOrders: async () => [order('shipped', { type: 'shipment' })] }, '#orders');
    const row = ui.elements['orders-body'].children[0];
    assert.equal(rowText(row)[1], 'shipped');
    assert.equal(row.children[6].children.length, 0);
    await row.fire('click');
    assert.deepEqual(ui.elements['order-summary'].children.slice(0, 2).map((child) => child.textContent), ['Тип', 'shipment']);
    assert.equal(ui.elements['order-cancel'].hidden, true);
});

test('Пока заказы загружаются, виден статус загрузки', async () => {
    const slow = deferred();
    const ui = await app({ GetOrders: () => slow.promise }, '#orders');
    assert.match(ui.elements['orders-status'].textContent, /Загрузка заказов/);
    slow.resolve([]);
    await tick();
    assert.equal(ui.elements['orders-status'].textContent, '');
});

test('Выбор заказа открывает состав, не пересоздавая строки таблицы', async () => {
    const ui = await app({ GetOrders: async () => [order('completed'), order('pending', { id: 'second', number: 'П-SECOND' })] }, '#orders');
    assert.equal(ui.elements['order-details-empty'].hidden, false);
    assert.equal(ui.elements['order-details'].hidden, true);
    const rows = [...ui.elements['orders-body'].children];
    await rows[0].fire('click');
    assert.equal(ui.elements['orders-body'].children[0], rows[0]);
    assert.equal(ui.elements['orders-body'].children[1], rows[1]);
    assert.equal(rows[0].classes.has('table-active'), true);
    assert.equal(ui.elements['order-details'].hidden, false);
    assert.equal(ui.elements['order-title'].textContent, 'Заказ П-TESTORDE');
    assert.deepEqual(ui.elements['order-summary'].children.map((child) => child.textContent),
        ['Тип', 'Приёмка товара', 'Дата создания', rowText(rows[0])[2], 'Дата отгрузки', '—', 'Ответственный', 'Иванов', 'Место хранения', 'Стеллаж 1']);
    const item = ui.elements['order-items'].children[0];
    assert.equal(item.children[0].children[0].textContent, 'Молоко');
    assert.equal(item.children[0].children[0].href, '#product/1');
    assert.equal(item.children[1].textContent, '3 шт.');
    assert.equal(ui.elements['order-positions'].textContent, 'Итого позиций: 1');
    assert.equal(ui.elements['order-total'].textContent, '3 шт.');
    assert.equal(ui.elements['order-cancel'].hidden, true);
    await rows[1].fire('click');
    assert.equal(rows[0].classes.has('table-active'), false);
    assert.equal(rows[1].classes.has('table-active'), true);
    assert.equal(ui.elements['order-cancel'].hidden, false);
});

test('Пустой список и ошибка загрузки различаются, запрос можно повторить', async () => {
    let failed = true;
    const ui = await app({ GetOrders: async () => { if (failed) throw new Error('backend'); return []; } }, '#orders');
    assert.match(ui.elements['orders-status'].textContent, /backend/);
    assert.equal(ui.elements['orders-empty'].hidden, true);
    failed = false;
    await ui.elements['orders-reload'].fire('click');
    assert.equal(ui.elements['orders-status'].classes.has('text-danger'), false);
    assert.equal(ui.elements['orders-empty'].hidden, false);
    assert.match(ui.elements['orders-empty'].textContent, /Заказов пока нет/);
});

test('Ошибка обновления убирает устаревший список и состав заказа', async () => {
    let failed = false;
    const ui = await app({ GetOrders: async () => { if (failed) throw new Error('backend'); return [order('pending')]; } }, '#orders');
    await ui.elements['orders-body'].children[0].fire('click');
    assert.equal(ui.elements['order-details'].hidden, false);
    failed = true;
    await ui.elements['orders-reload'].fire('click');
    assert.match(ui.elements['orders-status'].textContent, /backend/);
    assert.equal(ui.elements['orders-body'].children.length, 0);
    assert.equal(ui.elements['orders-empty'].hidden, true);
    assert.equal(ui.elements['order-details'].hidden, true);
});

test('Вкладки и поиск фильтруют заказы', async () => {
    const ui = await app({ GetOrders: async () => [
        order('pending', { id: 'a', number: 'П-AAA', responsible: 'Петрова' }),
        order('completed', { id: 'b', number: 'П-BBB', items: [{ productId: 2, name: 'Хлеб', quantity: 1 }] }),
        order('cancelled', { id: 'c', number: 'П-CCC' }),
    ] }, '#orders');
    const numbers = () => ui.elements['orders-body'].children.map((row) => rowText(row)[0]);
    await ui.elements['orders-tab-cancelled'].fire('click');
    assert.deepEqual(numbers(), ['П-CCC']);
    assert.equal(ui.elements['orders-tab-cancelled'].classes.has('active'), true);
    assert.equal(ui.elements['orders-tab-all'].classes.has('active'), false);
    await ui.elements['orders-tab-all'].fire('click');
    for (const [query, expected] of [['хлеб', ['П-BBB']], [' петрова ', ['П-AAA']], ['п-ccc', ['П-CCC']], ['нет такого', []]]) {
        ui.elements['orders-search'].value = query;
        await ui.elements['orders-search'].fire('input');
        assert.deepEqual(numbers(), expected);
    }
    assert.match(ui.elements['orders-empty'].textContent, /не найдены/);
    assert.equal(ui.elements['orders-empty'].hidden, false);
});

test('Отмена выполняется один раз после подтверждения и оставляет заказ в списке', async () => {
    const cancellation = deferred();
    const cancelled = [];
    const ui = await app({
        GetOrders: async () => [order('pending')],
        CancelOrder: (id) => { cancelled.push(id); return cancellation.promise; },
    }, '#orders');
    await ui.elements['order-cancel-confirm'].fire('click');
    assert.equal(cancelled.length, 0);
    const row = ui.elements['orders-body'].children[0];
    await row.fire('click');
    await row.children[6].children[0].fire('click');
    assert.equal(ui.elements['order-cancel-title'].textContent, 'Отменить заказ П-TESTORDE?');
    const confirming = ui.elements['order-cancel-confirm'].fire('click');
    await ui.elements['order-cancel-confirm'].fire('click');
    assert.deepEqual(cancelled, ['test-order']);
    assert.equal(ui.elements['orders-body'].children[0].children[6].children[0].disabled, true);
    assert.equal(ui.elements['order-cancel'].disabled, true);
    assert.match(ui.elements['orders-status'].textContent, /Отмена заказа/);
    cancellation.resolve(order('cancelled'));
    await confirming;
    assert.equal(ui.elements['order-cancel'].disabled, false);
    assert.match(ui.elements['orders-status'].textContent, /отменён. Остаток товара не изменён/);
    const updated = ui.elements['orders-body'].children[0];
    assert.equal(rowText(updated)[1], 'Отменён');
    assert.equal(updated.children[6].children.length, 0);
    assert.equal(ui.elements['order-cancel'].hidden, true);
    assert.equal(ui.elements['orders-count-cancelled'].textContent, '1');
});

test('Кнопка в карточке заказа отменяет выбранный заказ', async () => {
    const cancelled = [];
    const ui = await app({
        GetOrders: async () => [order('pending', { id: 'first', number: 'П-1' }), order('pending', { id: 'second', number: 'П-2' })],
        CancelOrder: async (id) => { cancelled.push(id); return order('cancelled', { id, number: 'П-2' }); },
    }, '#orders');
    await ui.elements['orders-body'].children[1].fire('click');
    await ui.elements['order-cancel'].fire('click');
    assert.equal(ui.elements['order-cancel-title'].textContent, 'Отменить заказ П-2?');
    await ui.elements['order-cancel-confirm'].fire('click');
    assert.deepEqual(cancelled, ['second']);
    assert.equal(rowText(ui.elements['orders-body'].children[0])[1], 'Черновик');
    assert.equal(rowText(ui.elements['orders-body'].children[1])[1], 'Отменён');
});

test('Ошибка отмены видна, список сверяется с backend', async () => {
    let current = order('pending');
    const ui = await app({
        GetOrders: async () => [current],
        CancelOrder: async () => { current = order('completed'); throw new Error('завершённую приёмку отменить нельзя'); },
    }, '#orders');
    await ui.elements['orders-body'].children[0].children[6].children[0].fire('click');
    await ui.elements['order-cancel-confirm'].fire('click');
    assert.match(ui.elements['orders-status'].textContent, /завершённую приёмку отменить нельзя/);
    assert.equal(ui.elements['orders-status'].classes.has('text-danger'), true);
    assert.equal(rowText(ui.elements['orders-body'].children[0])[1], 'Завершён');
    assert.equal(ui.elements['orders-body'].children[0].children[6].children.length, 0);
});

test('Отмена черновика из заказов освобождает форму приёмки', async () => {
    const ui = await app({ GetOrders: async () => [order('pending')] });
    await ui.draft();
    assert.equal(ui.elements['receiving-fields'].disabled, true);
    assert.equal(ui.elements['receiving-order-id'].textContent, 'Номер: П-TESTORDE');
    await ui.navigate('#orders');
    await ui.elements['orders-body'].children[0].children[6].children[0].fire('click');
    await ui.elements['order-cancel-confirm'].fire('click');
    await ui.navigate('#orders/receiving');
    assert.equal(ui.elements['receiving-confirmation'].hidden, true);
    assert.equal(ui.elements['receiving-fields'].disabled, false);
    assert.doesNotMatch(ui.elements['receiving-status'].textContent, /Ошибка/);
    assert.doesNotMatch(ui.elements['receiving-status'].textContent, /Проверьте черновик/);
});

test('Статус приёмки сообщает об отмене, если окно подтвердили поверх её страницы', async () => {
    const ui = await app({ GetOrders: async () => [order('pending')] });
    await ui.draft();
    await ui.navigate('#orders');
    await ui.elements['orders-body'].children[0].children[6].children[0].fire('click');
    await ui.navigate('#orders/receiving');
    await ui.elements['order-cancel-confirm'].fire('click');
    assert.equal(ui.elements['receiving-status'].textContent, 'Черновик отменён. Остаток не изменён.');
});

test('Отмена другого заказа не трогает открытый черновик приёмки', async () => {
    const ui = await app({
        GetOrders: async () => [order('pending', { id: 'other', number: 'П-OTHER' })],
        CancelOrder: async (id) => order('cancelled', { id, number: 'П-OTHER' }),
    });
    await ui.draft();
    await ui.navigate('#orders');
    await ui.elements['orders-body'].children[0].children[6].children[0].fire('click');
    await ui.elements['order-cancel-confirm'].fire('click');
    await ui.navigate('#orders/receiving');
    assert.equal(ui.elements['receiving-confirmation'].hidden, false);
    assert.equal(ui.elements['receiving-fields'].disabled, true);
});

test('Запоздавший список не возвращает отменённый заказ в черновики', async () => {
    const slow = deferred();
    let requests = 0;
    const ui = await app({ GetOrders: () => ++requests === 2 ? slow.promise : Promise.resolve([order('pending')]) }, '#orders');
    const cancel = ui.elements['orders-body'].children[0].children[6].children[0];
    const reloading = ui.elements['orders-reload'].fire('click');
    await cancel.fire('click');
    await ui.elements['order-cancel-confirm'].fire('click');
    slow.resolve([order('pending')]);
    await reloading;
    assert.equal(rowText(ui.elements['orders-body'].children[0])[1], 'Отменён');
    assert.match(ui.elements['orders-status'].textContent, /отменён/);
});

test('Запоздавшая ошибка не очищает загруженный список заказов', async () => {
    const slow = deferred();
    let requests = 0;
    const ui = await app({ GetOrders: () => ++requests === 1 ? slow.promise : Promise.resolve([order('completed')]) }, '#orders');
    await ui.elements['orders-reload'].fire('click');
    slow.reject(new Error('backend'));
    await tick();
    assert.equal(ui.elements['orders-body'].children.length, 1);
    assert.equal(ui.elements['orders-status'].classes.has('text-danger'), false);
});

test('Запоздалый ответ не подменяет обновлённый список заказов', async () => {
    const slow = deferred();
    let requests = 0;
    const ui = await app({ GetOrders: () => ++requests === 1 ? slow.promise : Promise.resolve([order('completed')]) }, '#orders');
    await ui.elements['orders-reload'].fire('click');
    slow.resolve([order('pending')]);
    await tick();
    assert.equal(rowText(ui.elements['orders-body'].children[0])[1], 'Завершён');
});

test('Завершение приёмки обновляет открытую вкладку заказов', async () => {
    const completion = deferred();
    let current = order('pending');
    const ui = await app({ GetOrders: async () => [current], CompleteReceiving: () => completion.promise });
    await ui.draft();
    const finishing = ui.elements['complete-receiving'].fire('click');
    await ui.navigate('#orders');
    assert.equal(rowText(ui.elements['orders-body'].children[0])[1], 'Черновик');
    current = order('completed');
    completion.resolve(receipt(13, 'completed'));
    await finishing;
    await tick();
    assert.equal(rowText(ui.elements['orders-body'].children[0])[1], 'Завершён');
});
