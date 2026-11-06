import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const templateFiles = ['index.html', 'src/layout/layout.html', 'src/pages/home/home.html',
    'src/pages/catalog/catalog.html', 'src/pages/catalog/product.html', 'src/pages/orders/orders.html', 'src/pages/order-form/order-form.html', 'src/pages/receiving/receiving.html'];
const html = (await Promise.all(templateFiles.map((file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8')))).join('\n');
const moduleFiles = ['shared/api.js', 'shared/dom.js', 'shared/icons.js', 'shared/modal.js', 'layout/layout.js',
    'pages/home/home.js', 'pages/catalog/catalog.js', 'pages/catalog/product.js', 'pages/receiving/receiving.js', 'pages/orders/orders.js', 'pages/order-form/order-form.js', 'app/router.js', 'main.js'];
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
const stock = (id = 1, name = 'Молоко', count = 10, reserved = 0) => ({ id, name, count, reserved, free: count - reserved });
const shipment = (status = 'reserved', changes = {}) => order(status, {
    id: 'З-2026-0001', number: 'З-2026-0001', type: 'shipment', shipmentDate: '2026-11-20T00:00:00+03:00', location: '',
    address: 'ул. Складская, 14', note: 'До 12:00', completedBy: '', items: [{ productId: 1, name: 'Молоко', quantity: 4 }], ...changes,
});
const changeText = (cell) => cell.children.map((child) => child.textContent).join('');

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
    const window = new Element();
    window.go = { main: { DBService: {
        SearchProducts: async () => [product()],
        GetAllProducts: async () => [product()],
        GetProduct: async () => product(),
        CreateReceiving: async () => receipt(), GetReceiving: async () => receipt(),
        CompleteReceiving: async () => receipt(13, 'completed'), CancelReceiving: async () => {},
        GetOrders: async () => [], CancelOrder: async () => order('cancelled'),
        GetProductStocks: async () => [stock()], GetProductStock: async () => stock(),
        CreateOutgoing: async () => ({ order: shipment(), stock: [stock(1, 'Молоко', 10, 4)] }),
        CompleteOutgoing: async () => ({ order: shipment('shipped'), stock: [stock(1, 'Молоко', 6)] }),
        ...service,
    } } };
    const location = { hash };
    elements['receiving-form'].reset = () => {
        for (const id of ['receiving-product', 'receiving-quantity', 'receiving-responsible', 'receiving-location']) elements[id].value = '';
    };
    elements['order-form'].reset = () => {
        for (const id of ['order-form-date', 'order-form-responsible', 'order-form-address', 'order-form-note']) elements[id].value = '';
    };
    const navLinks = ['#home', '#products', '#orders'].map((hash) => Object.assign(new Element(), { hash }));
    const context = vm.createContext({
        window, location, Event,
        bootstrap: { Modal: { getOrCreateInstance: (element) => ({
            show() { element.modalOpen = true; }, hide() { element.modalOpen = false; },
        }) } },
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
        elements, navLinks, location,
        async navigate(hash) { location.hash = hash; await window.fire('hashchange'); },
        async fillOrderForm(productId = '1') {
            elements['order-form-date'].value = '2026-11-20';
            elements['order-form-responsible'].value = ' Петрова А.С. ';
            elements['order-form-address'].value = ' ул. Складская, 14 ';
            elements['order-form-note'].value = ' До 12:00 ';
            elements['order-form-product'].value = productId;
            await elements['order-form-product'].fire('change');
        },
        quantityInput(index = 0) {
            return elements['order-form-items'].children[index].children[2].children[0].children[1];
        },
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
    assert.deepEqual(ui.elements['product-details'].children.map((child) => child.textContent),
        ['ID', 1, 'Название', 'Молоко', 'Количество', 10]);
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
    assert.equal(ui.elements['product-details'].children.length, 0);
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
    assert.deepEqual(ui.elements['product-details'].children.map((child) => child.textContent),
        ['ID', 2, 'Название', 'Хлеб', 'Количество', 5]);
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
                : ui.elements['product-details'].children[5].textContent;
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

test('Карточка показывает свободное количество и бронь, поля без данных скрыты при ошибке', async () => {
    const ui = await app({
        GetProduct: async (id) => { if (id === 999) throw new Error('товар не найден'); return product(); },
        GetProductStock: async () => stock(1, 'Молоко', 10, 3),
    });
    await ui.navigate('#product/1');
    assert.equal(ui.elements['product-card'].hidden, false);
    assert.equal(ui.elements['product-free'].textContent, '7');
    assert.equal(ui.elements['product-reserved'].textContent, '3');
    await ui.navigate('#product/999');
    assert.equal(ui.elements['product-card'].hidden, true);
    assert.match(html, /Фото: нет данных/);
    for (const field of ['Срок хранения (FIFO/LIFO)', 'Физические размеры',
        'Поставщик/производитель', 'Размер в юнитах (SKU)', 'Идентификатор товарной позиции', 'Дата поступления на склад',
        'Распределение по складам']) {
        assert.ok(html.includes(`<dt class="mt-3">${field}</dt><dd>Нет данных</dd>`), field);
    }
});

test('Меню заказов предлагает создание заказа и приёмку', () => {
    assert.match(html, /id="orders-create-order" class="dropdown-item py-2" href="#orders\/new">\s*<span class="d-block fw-semibold">Создать заказ<\/span>/);
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
    assert.equal(ui.elements['orders-count-active'].textContent, '1');
});

test('Неизвестные статус и тип показываются как есть и не ломают список', async () => {
    const ui = await app({ GetOrders: async () => [order('in_assembly', { type: 'transfer' })] }, '#orders');
    const row = ui.elements['orders-body'].children[0];
    assert.equal(rowText(row)[1], 'in_assembly');
    assert.equal(row.children[6].children.length, 0);
    await row.fire('click');
    assert.deepEqual(ui.elements['order-summary'].children.slice(0, 2).map((child) => child.textContent), ['Тип', 'transfer']);
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

test('Форма заказа подставляет сегодняшнюю дату и не отправляет неверные данные', async () => {
    let creates = 0;
    const ui = await app({ CreateOutgoing: async () => { creates++; return { order: shipment(), stock: [stock(1, 'Молоко', 10, 4)] }; } }, '#orders/new');
    assert.match(ui.elements['order-form-date'].value, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(ui.elements['order-form-fields'].disabled, false);
    assert.equal(ui.elements['page-title'].textContent, 'Заказы');
    assert.equal(ui.navLinks[2]['aria-current'], 'page');
    assert.equal(ui.elements['order-form-items-empty'].hidden, false);

    ui.elements['order-form-responsible'].value = 'Петрова';
    ui.elements['order-form-address'].value = 'Адрес';
    await ui.elements['order-form'].fire('submit');
    assert.match(ui.elements['order-form-status'].textContent, /хотя бы один товар/);
    assert.equal(ui.elements['order-form-status'].classes.has('text-danger'), true);

    await ui.fillOrderForm();
    const input = ui.quantityInput();
    const row = ui.elements['order-form-items'].children[0];
    assert.equal(input.value, '1');
    for (const value of ['', '0', '-1', '1.5', '1e2', '9007199254740992']) {
        input.value = value;
        await input.fire('input');
        assert.equal(input.classes.has('is-invalid'), true, value);
        await ui.elements['order-form'].fire('submit');
        assert.match(ui.elements['order-form-status'].textContent, /целым числом/, value);
    }
    input.value = '11';
    await input.fire('input');
    assert.equal(row.children[3].textContent, '-1');
    assert.equal(row.children[3].classes.has('text-danger'), true);
    assert.equal(row.children[2].children[1].textContent, 'Больше свободного остатка');
    await ui.elements['order-form'].fire('submit');
    assert.match(ui.elements['order-form-status'].textContent, /свободно только 10/);

    input.value = '3';
    await input.fire('input');
    ui.elements['order-form-address'].value = ' ';
    await ui.elements['order-form'].fire('submit');
    assert.match(ui.elements['order-form-status'].textContent, /адрес/);
    ui.elements['order-form-address'].value = 'Адрес';
    ui.elements['order-form-date'].value = '';
    await ui.elements['order-form'].fire('submit');
    assert.match(ui.elements['order-form-status'].textContent, /дату/);
    assert.equal(creates, 0);
});

test('Форма заказа добавляет, меняет и убирает товары без потери ввода', async () => {
    const ui = await app({ GetProductStocks: async () => [stock(), stock(2, 'Хлеб', 5), stock(3, 'Соль', 0)] }, '#orders/new');
    const options = () => ui.elements['order-form-product'].children.map((option) => option.textContent);
    assert.deepEqual(options(), ['Добавить товар…', 'Молоко — свободно 10', 'Хлеб — свободно 5', 'Соль — свободно 0']);
    assert.equal(ui.elements['order-form-product'].children[3].disabled, true);
    await ui.fillOrderForm('1');
    assert.deepEqual(options(), ['Добавить товар…', 'Хлеб — свободно 5', 'Соль — свободно 0']);
    assert.equal(ui.elements['order-form-items-empty'].hidden, true);

    const input = ui.quantityInput();
    const group = ui.elements['order-form-items'].children[0].children[2].children[0];
    await group.children[2].fire('click');
    assert.equal(input.value, '2');
    assert.equal(ui.elements['order-form-items'].children[0].children[3].textContent, '8');
    await group.children[0].fire('click');
    await group.children[0].fire('click');
    assert.equal(input.value, '1');
    input.value = '6';
    await input.fire('input');
    assert.equal(ui.quantityInput(), input);
    const summary = ui.elements['order-form-summary'].children.map((child) => child.textContent);
    assert.deepEqual(summary, ['Тип', 'Отгрузка', 'Позиций', '1', 'Всего единиц', '6 шт.', 'Дата', '20.11.2026']);

    await ui.elements['order-form-items'].children[0].children[4].children[0].fire('click');
    assert.equal(ui.elements['order-form-items'].children.length, 0);
    assert.equal(ui.elements['order-form-items-empty'].hidden, false);
    assert.equal(options().length, 4);
});

test('Создание заказа бронирует товар, показывает окно и очищает форму', async () => {
    const requests = [];
    const creation = deferred();
    const ui = await app({
        CreateOutgoing: (request) => { requests.push(request); return creation.promise; },
    }, '#orders/new');
    await ui.fillOrderForm();
    ui.quantityInput().value = '4';
    await ui.quantityInput().fire('input');
    const submitting = ui.elements['order-form'].fire('submit');
    await ui.elements['order-form'].fire('submit');
    assert.equal(requests.length, 1);
    assert.equal(ui.elements['order-form-fields'].disabled, true);
    assert.deepEqual(JSON.parse(JSON.stringify(requests[0])), {
        type: 'shipment', date: '2026-11-20', address: 'ул. Складская, 14', responsible: 'Петрова А.С.', note: 'До 12:00',
        items: [{ productId: 1, quantity: '4' }],
    });
    creation.resolve({ order: shipment(), stock: [stock(1, 'Молоко', 10, 4)] });
    await submitting;
    assert.equal(ui.elements['order-created-modal'].modalOpen, true);
    assert.equal(ui.elements['order-created-title'].textContent, 'Заказ З-2026-0001 создан');
    assert.match(ui.elements['order-created-text'].textContent, /уменьшен на 4 шт/);
    const row = ui.elements['order-created-items'].children[0];
    assert.equal(changeText(row.children[1]), '10 → 6');
    assert.equal(changeText(row.children[2]), '0 → 4');
    assert.equal(row.children[3].textContent, '10');
    assert.equal(ui.elements['order-form-items'].children.length, 0);
    assert.equal(ui.elements['order-form-responsible'].value, '');
    assert.equal(ui.elements['order-form-fields'].disabled, false);
    assert.match(ui.elements['order-form-date'].value, /^\d{4}-/);

    await ui.elements['order-created-open'].fire('click');
    assert.equal(ui.location.hash, '#orders');
});

test('Открытие созданного заказа выбирает его в списке', async () => {
    const ui = await app({ GetOrders: async () => [shipment()] }, '#orders/new');
    await ui.fillOrderForm();
    await ui.elements['order-form'].fire('submit');
    await ui.elements['order-created-open'].fire('click');
    await ui.navigate('#orders');
    assert.equal(ui.elements['order-details'].hidden, false);
    assert.equal(ui.elements['order-title'].textContent, 'Заказ З-2026-0001');
    assert.equal(ui.elements['orders-body'].children[0].classes.has('table-active'), true);
});

test('Списание задаётся адресом страницы и попадает в запрос', async () => {
    let request;
    const ui = await app({
        CreateOutgoing: async (value) => { request = value; return { order: shipment('reserved', { type: 'writeoff' }), stock: [stock(1, 'Молоко', 10, 4)] }; },
    }, '#orders/new/writeoff');
    assert.equal(ui.elements['order-form-date-label'].textContent, 'Дата списания');
    assert.equal(ui.elements['order-form-type-writeoff'].classes.has('active'), true);
    assert.equal(ui.elements['order-form-type-shipment'].classes.has('active'), false);
    await ui.fillOrderForm();
    assert.equal(ui.elements['order-form-summary'].children[1].textContent, 'Списание');
    await ui.navigate('#orders/new');
    assert.equal(ui.elements['order-form-type-shipment'].classes.has('active'), true);
    assert.equal(ui.elements['order-form-items'].children.length, 1);
    await ui.navigate('#orders/new/writeoff');
    await ui.elements['order-form'].fire('submit');
    assert.equal(request.type, 'writeoff');
});

test('Ошибки загрузки и создания заказа видны, ввод сохраняется', async () => {
    let failed = true;
    const ui = await app({
        GetProductStocks: async () => { if (failed) throw new Error('SQLite read'); return [stock()]; },
        CreateOutgoing: async () => { throw new Error('недостаточно свободного остатка'); },
    }, '#orders/new');
    assert.match(ui.elements['order-form-status'].textContent, /SQLite read/);
    assert.equal(ui.elements['order-form-fields'].disabled, true);
    failed = false;
    await ui.elements['order-form-reload'].fire('click');
    assert.equal(ui.elements['order-form-fields'].disabled, false);
    await ui.fillOrderForm();
    await ui.elements['order-form'].fire('submit');
    assert.match(ui.elements['order-form-status'].textContent, /недостаточно свободного остатка/);
    assert.equal(ui.elements['order-created-modal'].modalOpen, undefined);
    assert.equal(ui.elements['order-form-items'].children.length, 1);
    assert.equal(ui.elements['order-form-responsible'].value, ' Петрова А.С. ');
    assert.equal(ui.elements['order-form-fields'].disabled, false);
});

test('Отгрузка показывает изменения и выполняется один раз', async () => {
    const completion = deferred();
    const calls = [];
    const ui = await app({
        GetOrders: async () => [shipment()],
        GetProductStocks: async () => [stock(1, 'Молоко', 10, 4)],
        CompleteOutgoing: (id, request) => { calls.push([id, request]); return completion.promise; },
    }, '#orders');
    await ui.elements['orders-body'].children[0].fire('click');
    assert.equal(ui.elements['order-complete'].hidden, false);
    assert.equal(ui.elements['order-complete'].textContent, 'Отгрузить заказ');
    assert.deepEqual(ui.elements['order-summary'].children.slice(10).map((child) => child.textContent), ['Примечание', 'До 12:00']);
    await ui.elements['order-complete'].fire('click');
    assert.equal(ui.elements['order-complete-title'].textContent, 'Отгрузить заказ З-2026-0001?');
    assert.equal(ui.elements['order-complete-person'].value, 'Иванов');
    assert.match(ui.elements['order-complete-date'].value, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(ui.elements['order-complete-confirm'].disabled, false);
    const row = ui.elements['order-complete-items'].children[0];
    assert.equal(row.children[1].textContent, '4');
    assert.equal(changeText(row.children[2]), '4 → 0');
    assert.equal(changeText(row.children[3]), '10 → 6');

    ui.elements['order-complete-person'].value = ' ';
    await ui.elements['order-complete-confirm'].fire('click');
    assert.equal(calls.length, 0);
    assert.match(ui.elements['order-complete-status'].textContent, /ФИО/);

    ui.elements['order-complete-person'].value = ' Кузнецов ';
    ui.elements['order-complete-date'].value = '2026-11-21';
    ui.elements['order-complete-modal'].modalOpen = true;
    const confirming = ui.elements['order-complete-confirm'].fire('click');
    await ui.elements['order-complete-confirm'].fire('click');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'З-2026-0001');
    assert.deepEqual(JSON.parse(JSON.stringify(calls[0][1])), { date: '2026-11-21', completedBy: 'Кузнецов' });
    assert.equal(ui.elements['order-complete'].disabled, true);
    completion.resolve({ order: shipment('shipped', { completedBy: 'Кузнецов' }), stock: [stock(1, 'Молоко', 6)] });
    await confirming;
    assert.equal(ui.elements['order-complete-modal'].modalOpen, false);
    assert.match(ui.elements['orders-status'].textContent, /отгружен. Остаток обновлён/);
    const updated = ui.elements['orders-body'].children[0];
    assert.equal(rowText(updated)[1], 'Отгружен');
    assert.equal(updated.children[6].children.length, 0);
    assert.equal(ui.elements['order-complete'].hidden, true);
    assert.equal(ui.elements['order-cancel'].hidden, true);
    assert.ok(ui.elements['order-summary'].children.some((child) => child.textContent === 'Отгрузил'));
    assert.equal(ui.elements['orders-count-completed'].textContent, '1');
});

test('Списание подписано своими словами', async () => {
    const writeoff = (status) => shipment(status, { id: 'С-2026-0002', number: 'С-2026-0002', type: 'writeoff' });
    const ui = await app({
        GetOrders: async () => [writeoff('reserved')],
        GetProductStocks: async () => [stock(1, 'Молоко', 10, 4)],
        CompleteOutgoing: async () => ({ order: writeoff('written_off'), stock: [stock(1, 'Молоко', 6)] }),
    }, '#orders');
    await ui.elements['orders-body'].children[0].fire('click');
    assert.equal(ui.elements['order-complete'].textContent, 'Списать заказ');
    assert.ok(ui.elements['order-summary'].children.some((child) => child.textContent === 'Дата списания'));
    await ui.elements['order-complete'].fire('click');
    assert.equal(ui.elements['order-complete-column'].textContent, 'Списание');
    assert.equal(ui.elements['order-complete-person-label'].textContent, 'Списал');
    assert.equal(ui.elements['order-complete-confirm'].textContent, 'Списать');
    await ui.elements['order-complete-confirm'].fire('click');
    assert.match(ui.elements['orders-status'].textContent, /списан/);
    assert.equal(rowText(ui.elements['orders-body'].children[0])[1], 'Списан');
});

test('Ошибка отгрузки остаётся в окне, список сверяется с backend', async () => {
    let current = shipment();
    const ui = await app({
        GetOrders: async () => [current],
        GetProductStocks: async () => [stock(1, 'Молоко', 10, 4)],
        CompleteOutgoing: async () => { current = shipment('cancelled'); throw new Error('заказ уже завершён или отменён'); },
    }, '#orders');
    await ui.elements['orders-body'].children[0].fire('click');
    await ui.elements['order-complete'].fire('click');
    ui.elements['order-complete-modal'].modalOpen = true;
    await ui.elements['order-complete-confirm'].fire('click');
    assert.equal(ui.elements['order-complete-modal'].modalOpen, true);
    assert.match(ui.elements['order-complete-status'].textContent, /уже завершён/);
    assert.equal(ui.elements['order-complete-confirm'].disabled, false);
    assert.equal(rowText(ui.elements['orders-body'].children[0])[1], 'Отменён');
});

test('Без остатков окно отгрузки нельзя подтвердить', async () => {
    const ui = await app({
        GetOrders: async () => [shipment()],
        GetProductStocks: async () => { throw new Error('SQLite read'); },
    }, '#orders');
    await ui.elements['orders-body'].children[0].fire('click');
    await ui.elements['order-complete'].fire('click');
    assert.match(ui.elements['order-complete-status'].textContent, /SQLite read/);
    assert.equal(ui.elements['order-complete-confirm'].disabled, true);
});

test('Отмена заказа с бронью сообщает о снятии брони', async () => {
    const ui = await app({
        GetOrders: async () => [shipment()],
        CancelOrder: async () => shipment('cancelled'),
    }, '#orders');
    const row = ui.elements['orders-body'].children[0];
    assert.equal(rowText(row)[1], 'В брони');
    await row.children[6].children[0].fire('click');
    assert.match(ui.elements['order-cancel-text'].textContent, /Бронь на 4 шт\. будет снята/);
    await ui.elements['order-cancel-confirm'].fire('click');
    assert.match(ui.elements['orders-status'].textContent, /отменён. Бронь снята/);
});

test('Активные и завершённые заказы попадают на свои вкладки', async () => {
    const ui = await app({ GetOrders: async () => [
        order('pending', { id: 'a', number: 'А' }), shipment('reserved', { id: 'b', number: 'Б' }),
        order('completed', { id: 'c', number: 'В' }), shipment('shipped', { id: 'd', number: 'Г' }),
        shipment('written_off', { id: 'e', number: 'Д' }), shipment('cancelled', { id: 'f', number: 'Е' }),
    ] }, '#orders');
    const numbers = () => ui.elements['orders-body'].children.map((row) => rowText(row)[0]);
    await ui.elements['orders-tab-active'].fire('click');
    assert.deepEqual(numbers(), ['А', 'Б']);
    await ui.elements['orders-tab-completed'].fire('click');
    assert.deepEqual(numbers(), ['В', 'Г', 'Д']);
    await ui.elements['orders-tab-cancelled'].fire('click');
    assert.deepEqual(numbers(), ['Е']);
    assert.equal(ui.elements['orders-count-all'].textContent, '6');
});

test('Главная показывает свободный остаток, бронь и ближайшие отгрузки', async () => {
    const today = new Date().toISOString();
    const ui = await app({
        GetProductStocks: async () => [stock(1, 'Молоко', 10, 4), stock(2, 'Хлеб', 5, 1)],
        GetOrders: async () => [
            shipment('reserved', { number: 'З-поздний', shipmentDate: '2030-01-02T00:00:00Z' }),
            shipment('reserved', { number: 'З-ранний', shipmentDate: today }),
            shipment('shipped', { number: 'З-готов', shipmentDate: today }),
            shipment('cancelled', { number: 'З-отменён', shipmentDate: today }),
            shipment('reserved', { number: 'С-списание', type: 'writeoff', shipmentDate: today }),
            order('pending'),
        ],
    }, '#home');
    assert.equal(ui.elements['home-free'].textContent, '10');
    assert.equal(ui.elements['home-reserved'].textContent, '5');
    assert.equal(ui.elements['home-shipments-today'].textContent, '2');
    assert.equal(ui.elements['home-shipments-empty'].hidden, true);
    const rows = ui.elements['home-shipments'].children;
    assert.deepEqual(rows.map((row) => row.children[0].textContent), ['З-ранний', 'З-поздний']);
    assert.equal(rows[0].children[1].textContent, 'Отгрузка');
    assert.equal(rows[0].children[5].textContent, '4');
    assert.match(html, /href="#orders\/new" class="info-box/);
    assert.match(html, /href="#orders\/new\/writeoff" class="info-box/);
});

test('Главная не выдаёт нули за данные при ошибке', async () => {
    const ui = await app({ GetProductStocks: async () => { throw new Error('SQLite read'); } }, '#home');
    assert.equal(ui.elements['home-free'].textContent, 'Недоступно');
    assert.equal(ui.elements['home-reserved'].textContent, 'Недоступно');
    assert.equal(ui.elements['home-shipments-today'].textContent, 'Недоступно');
    assert.match(ui.elements['home-status'].textContent, /SQLite read/);
});

test('Окна отгрузки и созданного заказа лежат вне скрываемых секций', () => {
    assert.match(html, /<\/div>\s*<div id="order-complete-modal" class="modal fade"/);
    assert.match(html, /<\/section>\s*<div id="order-created-modal" class="modal fade"/);
    assert.match(html, /id="order-complete"[^>]*data-bs-toggle="modal" data-bs-target="#order-complete-modal"/);
    assert.doesNotMatch(html, /id="order-complete-confirm"[^>]*data-bs-dismiss/);
    assert.match(html, /id="order-created-list"[^>]*data-bs-dismiss="modal"/);
    assert.match(html, /id="order-created-open"[^>]*data-bs-dismiss="modal"/);
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
