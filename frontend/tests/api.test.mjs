import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/shared/api.js', import.meta.url), 'utf8');
const { callBackend } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('Вызовы используют публичный сервис Wails и передают ошибки', async () => {
    globalThis.window = {};
    await assert.rejects(callBackend('GetAllProducts'), /Backend недоступен/);
    const product = { id: 1, name: 'Молоко', count: 10 };
    window.go = { main: { DBService: {
        GetProduct: async (id) => { assert.equal(id, 1); return product; },
        SearchProducts: async () => { throw new Error('SQLite failure'); },
    } } };
    assert.deepEqual(await callBackend('GetProduct', 1), product);
    await assert.rejects(callBackend('SearchProducts', 'Молоко'), /SQLite failure/);
    delete globalThis.window;
});
