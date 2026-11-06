import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const templateFiles = ['index.html', 'src/layout/layout.html', 'src/pages/home/home.html',
    'src/pages/catalog/catalog.html', 'src/pages/catalog/product.html'];
const html = (await Promise.all(templateFiles.map((file) => readFile(new URL(`../${file}`, import.meta.url), 'utf8')))).join('\n');
const moduleFiles = ['shared/api.js', 'shared/dom.js', 'shared/icons.js', 'layout/layout.js',
    'pages/home/home.js', 'pages/catalog/catalog.js', 'pages/catalog/product.js', 'app/router.js', 'main.js'];
const scripts = [];
for (const file of moduleFiles) {
    const url = new URL(`../src/${file}`, import.meta.url);
    let source = await readFile(url, 'utf8');
    for (const match of source.matchAll(/^import (\w+) from '([^']+)\?raw';$/gm)) {
        const content = await readFile(new URL(match[2], url), 'utf8');
        source = source.replace(match[0], `const ${match[1]} = ${JSON.stringify(content)};`);
    }
    scripts.push(source.replace(/^import .+;\n/gm, '').replace(/^export /gm, ''));
}
const main = scripts.join('\n');
const tick = () => new Promise((resolve) => setImmediate(resolve));
const product = (count = 10) => ({ id: 1, name: 'Молоко', count });

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
    append(...children) { this.children.push(...children); }
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
        ...service,
    } } };
    const location = { hash };
    const navLinks = ['#home', '#products'].map((hash) => Object.assign(new Element(), { hash }));
    const context = vm.createContext({
        window, location, document: {
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
        async navigate(hash) { location.hash = hash; await window.fire('hashchange'); },
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
