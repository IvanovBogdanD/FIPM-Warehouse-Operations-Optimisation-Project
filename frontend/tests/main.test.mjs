import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
const api = await readFile(new URL('../src/api.js', import.meta.url), 'utf8');
const main = await readFile(new URL('../src/main.js', import.meta.url), 'utf8');
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
    set innerHTML(value) { throw new Error(`Небезопасный HTML: ${value}`); }
}

async function app(service = {}) {
    const elements = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(([, id]) => [id, new Element()]));
    const window = new Element();
    window.go = { main: { DBService: {
        SearchProducts: async () => [product()],
        GetProduct: async () => product(),
        ...service,
    } } };
    const location = { hash: '#products' };
    const context = vm.createContext({
        window, location, document: {
            getElementById: (id) => {
                assert.ok(elements[id], `Элемент ${id} отсутствует в HTML`);
                return elements[id];
            },
            createElement: () => new Element(), querySelectorAll: () => [],
        },
    });
    vm.runInContext(api.replaceAll('export function ', 'function ') + main.replace(/^import .+;\n/gm, ''), context);
    await tick();
    return {
        elements,
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
        await ui.navigate('#product/1');
        await ui.navigate('#products');
    }
    assert.equal(ui.elements.search.listeners.get('input').length, 1);
    assert.equal(ui.elements['reload-catalog'].listeners.get('click').length, 1);
});
