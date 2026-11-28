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
    assert.match(html, /id="movements-product"[^>]*data-bs-toggle="dropdown"[^>]*>Выберите товар</);
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

test('Объединение допускает только занятые ячейки, требует хотя бы одну дополнительную и не ограничено сверху', () => {
    assert.match(js, /movementMergeSources\.length < 2/);
    assert.match(js, /movementMode === 'merge-select'\);/);
    assert.match(js, /Выбрано: \$\{movementMergeSources\.length - 1\}`/);
    assert.doesNotMatch(js, /\/3/);
    assert.doesNotMatch(js, /movementMergeSources\.length >= 4/);
    assert.match(js, /fw-bold text-success mb-2/);
    assert.match(grid, /occupiedOnly && contents\.length === 0/);
    assert.match(grid, /`btn-\$\{highlightVariant\}`/);
});

test('Источник подсвечивается жёлтым, дополнительные ячейки бирюзовым, назначение красным', () => {
    assert.match(grid, /isDestination \? 'btn-danger' : active \? 'btn-warning' : marked \? `btn-\$\{highlightVariant\}`/);
    assert.match(js, /movementDestination, movementMode === 'merge-select'/);
    assert.match(js, /'text-success fw-semibold mb-1'/);
    assert.match(js, /'text-danger fw-bold mb-2'/);
    assert.match(css, /#movements-destination-card \{ height: 11rem; \}/);
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
    assert.ok(js.includes('setExpanded(true);'));
    assert.ok(js.includes('movementShowItems = value; render();'));
    assert.ok(js.includes('Все товары в ячейке'));
});

test('Открытый список закрывается крестиком или кликом вне списка без снятия выбора ячейки', () => {
    assert.ok(js.includes("close.addEventListener('click', () => setExpanded(false))"));
    assert.ok(js.includes("event.target.closest('#movements-cell-items')"));
    assert.ok(js.includes('movementShowItems = false;\n        render();'));
    assert.match(css, /movements-show-all-link/);
});

test('Панель действий не зависит от открытия списка всех товаров', () => {
    assert.ok(!js.includes("if (movementMode === 'browse' && movementShowItems) return"));
    assert.ok(js.includes('function renderActions()'));
});

test('Пункт "Все содержимое ячейки" стоит первым в списке и скрывает количество', () => {
    assert.match(js, /allOption\.value = 'all'; allOption\.textContent = 'Все содержимое ячейки'; select\.append\(allOption\);/);
    assert.match(js, /select\.append\(placeholder\);\s*\n\s*const allOption/);
    assert.match(js, /if \(select\.value === 'all'\) \{\s*\n\s*quantity\.hidden = true; quantity\.disabled = true; quantity\.value = '';\s*\n\s*all\.hidden = true;\s*\n\s*next\.disabled = false;/);
    assert.match(js, /movementMoveAll = true; movementStock = null; movementQuantity = 0; movementDestination = null; setMode\('move-target'\);/);
});

test('Перемещение "всего содержимого ячейки" переносит каждую позицию и восстанавливает обычный режим при смене выбора', () => {
    assert.match(js, /const label = movementMoveAll \? 'Товар: всё содержимое ячейки' : `Товар: \$\{movementStock\.name\} · \$\{movementQuantity\} шт\.`;/);
    assert.match(js, /for \(const item of cellItems\(movementSelected\)\) \{\s*\n\s*await callBackend\('MoveWarehouseStock', item\.id, item\.count, movementDestination\.x, movementDestination\.y\);/);
    assert.match(js, /quantity\.hidden = false; all\.hidden = false;/);
    assert.match(js, /movementMoveAll = false; movementStock = item; movementQuantity = amount; movementDestination = null; setMode\('move-target'\);/);
});

test('Поиск товара: поле ввода находится внутри выпадающего списка, отдельного поля поиска нет', () => {
    assert.match(html, /id="movements-product-picker" class="dropdown"/);
    assert.match(html, /<div class="dropdown-menu[^"]*"[^>]*>\s*<input id="movements-product-search"/);
    assert.doesNotMatch(html, /<select id="movements-product"/);
    assert.doesNotMatch(html, /<label[^>]*>Найти товар<\/label>\s*<input/);
});

test('Поиск товара: фильтрация идёт при вводе, пустой запрос возвращает все товары', () => {
    assert.match(js, /productSearch\.addEventListener\('input', renderProductOptions\)/);
    assert.match(js, /\.filter\(\(item\) => !query \|\| item\.name\.toLocaleLowerCase\('ru'\)\.includes\(query\)\)/);
    assert.match(js, /'hidden\.bs\.dropdown'/);
    assert.match(js, /'shown\.bs\.dropdown', \(\) => productSearch\.focus\(\)/);
    assert.match(js, /function setProductChoice\(id, name = ''\)/);
});

test('Ячейка назначения: над панелью операции показывается её содержимое тем же способом, что и при обычном просмотре', () => {
    assert.match(html, /id="movements-destination-card"[^>]*hidden/);
    assert.match(html, /id="movements-destination-items"/);
    assert.match(html, /Ячейка назначения не выбрана\./);
    assert.ok(js.includes('function renderDestination()'));
    assert.ok(js.includes("const active = movementMode === 'move-target' || movementMode === 'merge-target';"));
    assert.ok(js.includes('renderCellItems(list, items, movementDestShowItems'));
    assert.ok(js.includes('renderCellItems(list, items, movementShowItems'));
    assert.ok(js.includes("function render() { renderGrid(); renderDestination(); renderDetails(); renderActions(); }"));
    assert.ok(js.includes("event.target.closest('#movements-destination-items')"));
    assert.match(css, /#movements-destination-items\.movements-items-popover/);
});

test('Нижняя панель операции закреплена: карточка назначения имеет фиксированную высоту, отступ-заглушка убран', () => {
    assert.match(css, /@media \(min-width: 1200px\) \{ #movements-destination-card \{ height: 11rem; \} \}/);
    assert.doesNotMatch(css, /movements-operation-card \{ margin-top/);
});

test('Карта склада прокручивается внутри своей карточки, размер ячеек прежний', () => {
    assert.match(css, /#movements-page \.col-xl-8 > \.card \{ max-height: max\(20rem, calc\(100vh - 14\.5rem\)\); \}/);
    assert.match(css, /#movements-page \.col-xl-8 > \.card > \.card-body \{ overflow-y: auto; min-height: 0; \}/);
    assert.match(css, /#movements-status \{ min-height: 1\.5rem; \}/);
    assert.doesNotMatch(css, /#movements-grid table \{ max-width/);
});
