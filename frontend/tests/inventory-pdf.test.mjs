import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createInventoryPDF } from '../src/pages/inventory/inventory-pdf.js';

test('Акт PDF поддерживает кириллицу и переносит длинную таблицу на следующие страницы', async () => {
    const font = (await readFile(new URL('../src/assets/fonts/Nunito-Regular.ttf', import.meta.url))).toString('base64');
    const details = {
        id: 12, date: '2026-11-07', createdAt: '2026-11-07', responsible: 'Иванов Иван Иванович', commission: 'Петров Пётр Петрович', kind: 'full', status: 'completed',
        items: Array.from({ length: 30 }, (_, index) => ({ productId: index + 1, productName: `Краска акриловая белая для внутренних работ, позиция ${index + 1}`, article: `ART-${index + 1}`, storageLocation: 'A-01-01-1', systemCount: 10, actualCount: 9, comment: index === 0 ? 'Повреждена упаковка' : '' })),
    };
    const pdf = createInventoryPDF(details, font);
    const bytes = Buffer.from(pdf.output('arraybuffer'));
    assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
    assert.ok(pdf.getNumberOfPages() > 1);
    assert.ok(pdf.getFontList().Nunito.includes('normal'));
    assert.ok(bytes.length > 10000);
    assert.throws(() => createInventoryPDF({ ...details, items: [{ ...details.items[0], actualCount: null }] }, font), /завершите подсчёт/);
});
