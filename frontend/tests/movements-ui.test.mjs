import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const html = await readFile(new URL('../src/pages/warehouse/movements.html', import.meta.url), 'utf8');
const js = await readFile(new URL('../src/pages/warehouse/movements.js', import.meta.url), 'utf8');
const grid = await readFile(new URL('../src/shared/warehouse-grid.js', import.meta.url), 'utf8');
const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');

test('Карта перемещений использует компактную сетку без полосы прокрутки', () => {
    assert.match(html, /class="row g-4 align-items-start"/);
    assert.match(html, /id="movements-grid" class="warehouse-grid-wrap"/);
    assert.doesNotMatch(html, /id="movements-grid" class="table-responsive"/);
    assert.match(css, /#movements-grid table \{ width: 100%; table-layout: fixed; \}/);
});

test('Фильтр начинается с placeholder, кнопка поиска доступна только в режиме просмотра после выбора товара', () => {
    assert.match(html, /id="movements-product"[^>]*>[\s\S]*?disabled selected hidden>Выберите товар/);
    assert.match(html, /id="movements-find"[^>]*disabled/);
    assert.match(js, /movementMode !== 'browse' \|\| !byId\('movements-product'\)\.value/);
    assert.match(js, /if \(movementMode !== 'browse'\) return;/);
    assert.match(html, />Сбросить фильтр</);
});

test('Во время операции блокируются поиск и обновление склада', () => {
    assert.match(js, /const operationActive = movementMode !== 'browse'/);
    assert.match(js, /byId\('movements-product'\)\.disabled = operationActive/);
    assert.match(js, /byId\('movements-back'\)\.disabled = operationActive/);
    assert.match(js, /byId\('movements-reload'\)\.disabled = operationActive/);
});

test('Перемещение требует выбора товара и количества до активации выбора места', () => {
    assert.match(js, /quantity\.disabled = !item/);
    assert.match(js, /all\.disabled = !item/);
    assert.match(js, /next\.disabled = !item \|\| !Number\.isInteger\(amount\)/);
    assert.match(js, /quantity\.value = String\(item\.count\)/);
    assert.match(js, /const disabled = movementMode === 'move-choose'/);
});

test('Объединение допускает только занятые ячейки и требует хотя бы одну дополнительную', () => {
    assert.match(js, /movementMergeSources\.length < 2/);
    assert.match(js, /movementMode === 'merge-select'\);/);
    assert.match(js, /Выбрано: \$\{movementMergeSources\.length - 1\} \/3/);
    assert.match(js, /fw-bold text-success mb-2/);
    assert.match(grid, /occupiedOnly && contents\.length === 0/);
    assert.match(grid, /`btn-\$\{highlightVariant\}`/);
});

test('Источник подсвечивается жёлтым, дополнительные ячейки бирюзовым, назначение красным', () => {
    assert.match(grid, /isDestination \? 'btn-danger' : active \? 'btn-warning' : marked \? `btn-\$\{highlightVariant\}`/);
    assert.match(js, /movementDestination, movementMode === 'merge-select'/);
    assert.match(js, /'text-success fw-semibold mb-1'/);
    assert.match(js, /'text-danger fw-bold mb-2'/);
    assert.match(css, /movements-operation-card \{ margin-top: 9rem; \}/);
});

test('Кнопка отмены красная и показывается только в режиме операции', () => {
    assert.match(html, /id="movements-cancel" class="btn btn-danger text-white"/);
    assert.match(js, /byId\('movements-cancel'\)\.hidden = next === 'browse'/);
    assert.match(js, /byId\('movements-cancel'\)\.hidden = true/);
    assert.match(js, /resetOperation\(\); setMovementStatus\('Операция отменена/);
});


test('Поиск товара подсвечивает ячейки зелёным, объединение сохраняет бирюзовый цвет', () => {
    assert.match(js, /const highlightVariant = movementMode === 'merge-select' \|\| movementMode === 'merge-target' \? 'info' : 'success'/);
    assert.match(js, /movementGrid\.render\(movementStocks, movementSelected, disabled, marked, highlightVariant/);
});

test('При нескольких товарах сначала показана одна позиция, полный список открывается отдельно', () => {
    assert.match(js, /let movementShowItems = false/);
    assert.match(js, /movementShowItems = false/);
    assert.match(js, /list\.classList\.add\('movements-items-popover'\)/);
    assert.match(js, /Закрыть список товаров/);
    assert.match(js, /movementShowItems = false;\s*render\(\);\s*return;/);
    assert.match(css, /#movements-cell-items\.movements-items-popover/);
});


test('Повторный клик по выбранной ячейке снимает выделение, пустое место не снимает выбор', () => {
    assert.ok(js.includes('movementSelected = sameCell(movementSelected, cell) ? null : cell'));
    assert.ok(js.includes("if (movementMode !== 'browse' || !movementShowItems) return"));
    assert.ok(!js.includes('movementSelected = null; render();\n        }'));
});

test('При нескольких товарах по умолчанию показана одна позиция и ссылка ко всем товарам', () => {
    assert.ok(js.includes('const firstItem = createItemLink(items[0])'));
    assert.ok(js.includes("showAll.textContent = 'Ко всем товарам'"));
    assert.ok(js.includes('movementShowItems = true;'));
    assert.ok(js.includes('Все товары в ячейке'));
});

test('Открытый список закрывается крестиком или кликом вне списка без снятия выбора ячейки', () => {
    assert.ok(js.includes("close.addEventListener('click', () => { movementShowItems = false; render(); })"));
    assert.ok(js.includes("event.target.closest('#movements-cell-items')"));
    assert.ok(js.includes('movementShowItems = false;\n        render();'));
    assert.match(css, /movements-show-all-link/);
});

test('Панель действий не зависит от открытия списка всех товаров', () => {
    assert.ok(!js.includes("if (movementMode === 'browse' && movementShowItems) return"));
    assert.ok(js.includes('function renderActions()'));
});
