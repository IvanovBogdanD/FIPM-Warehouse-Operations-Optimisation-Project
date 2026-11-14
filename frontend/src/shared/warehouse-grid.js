export function cellName(x, y) {
    return `X${x} Y${y}`;
}

export function createWarehouseGrid(container, onSelect, onlyEmpty = false) {
    let stocks = [];
    const buttons = [];
    const table = document.createElement('table');
    table.className = 'table table-borderless align-middle text-center mb-0';
    const caption = document.createElement('caption');
    caption.className = 'visually-hidden';
    caption.textContent = 'Склад 8 на 8. X увеличивается вправо, Y вниз.';
    const head = document.createElement('thead');
    const header = document.createElement('tr');
    const corner = document.createElement('th'); corner.textContent = 'Y / X';
    header.append(corner);
    for (let x = 1; x <= 8; x++) {
        const cell = document.createElement('th'); cell.scope = 'col'; cell.textContent = x;
        header.append(cell);
    }
    head.append(header);
    const body = document.createElement('tbody');
    for (let y = 1; y <= 8; y++) {
        const row = document.createElement('tr');
        const label = document.createElement('th'); label.scope = 'row'; label.textContent = y;
        row.append(label);
        for (let x = 1; x <= 8; x++) {
            const cell = document.createElement('td'); cell.className = 'p-1';
            const square = document.createElement('div'); square.className = 'ratio ratio-1x1';
            const button = document.createElement('button');
            button.type = 'button'; button.dataset.x = x; button.dataset.y = y;
            const name = document.createElement('span'); name.className = 'small text-nowrap'; name.textContent = `${x}:${y}`;
            const amount = document.createElement('span'); amount.className = 'small';
            button.append(name, amount);
            button.addEventListener('click', () => onSelect({ x, y, items: stocks.filter((stock) => stock.x === x && stock.y === y) }));
            square.append(button); cell.append(square); row.append(cell); buttons.push(button);
        }
        body.append(row);
    }
    table.append(caption, head, body); container.replaceChildren(table);
    return {
        render(items, selected = null, disabled = false) {
            stocks = items;
            for (const button of buttons) {
                const x = Number(button.dataset.x), y = Number(button.dataset.y);
                const contents = stocks.filter((stock) => stock.x === x && stock.y === y);
                const active = selected !== null && selected.x === x && selected.y === y;
                button.disabled = disabled || (onlyEmpty && contents.length > 0);
                button.className = `btn ${active ? 'btn-warning' : contents.length ? 'btn-primary' : 'btn-outline-secondary'} p-1 d-flex flex-column align-items-center justify-content-center w-100`;
                button.setAttribute('aria-pressed', String(active));
                button.setAttribute('aria-label', `Ячейка ${cellName(x, y)}, ${contents.length ? `видов товара: ${contents.length}, всего: ${contents.reduce((sum, item) => sum + item.count, 0)} шт.` : 'свободна'}`);
                button.children[1].textContent = contents.length ? `${contents.length} вид.` : '';
            }
        },
    };
}
