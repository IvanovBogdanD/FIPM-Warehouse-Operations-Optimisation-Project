import { byId, showStatus } from '../../shared/dom.js';
import { inventoryNumber, inventoryDate, inventorySigners, inventoryTotals } from './inventory-data.js';
import inventoryFontUrl from '../../assets/fonts/Nunito-Regular.ttf?url';

export function renderInventoryReport(details, prefix) {
    const field = (name) => byId(`${prefix}-${name}`);
    const totals = inventoryTotals(details);
    const completed = details.status === 'completed';
    const pending = details.status === 'pending';
    
    field('status').textContent = completed ? 'Инвентаризация завершена' : (pending ? 'Ожидает подтверждения' : 'Черновик');
    field('status').className = `badge text-bg-${completed ? 'success' : (pending ? 'warning' : 'secondary')}`;
    field('title').textContent = `АКТ ИНВЕНТАРИЗАЦИИ № ${inventoryNumber(details)}`;
    field('date').textContent = `от ${inventoryDate(details.date)}`;
    
    field('people').textContent = `Комиссия — ${details.commission || 'не указана'}. Вид проверки — ${details.kind === 'full' ? 'полная' : 'выборочная'}.`;
    
    const body = field('body'); body.replaceChildren();
    details.items.forEach((item, index) => {
        const difference = item.actualCount - item.systemCount;
        const row = document.createElement('tr');
        for (const value of [index + 1, item.productName, item.article || '-', item.storageLocation || '-', item.systemCount, item.actualCount, difference < 0 ? -difference : '-', difference > 0 ? difference : '-']) {
            const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
        }
        body.append(row);
    });
    const total = document.createElement('tr');
    const label = document.createElement('th'); label.colSpan = 4; label.textContent = 'Итого'; total.append(label);
    for (const value of [totals.system, totals.actual, totals.shortage, totals.surplus]) { const cell = document.createElement('th'); cell.textContent = value; total.append(cell); }
    field('total').replaceChildren(total);
    
    field('result').textContent = completed ? `Остатки в системе скорректированы по фактическим данным. Дата проведения: ${inventoryDate(details.date)}.` : 'Не все члены комиссии закончили проверку.';
    
    const signatures = field('signatures'); signatures.replaceChildren();
    for (const person of inventorySigners(details)) {
        const line = document.createElement('p'); line.className = 'border-top pt-2 mt-5';
        line.textContent = `${person} · Подпись ____________________`; signatures.append(line);
    }
}

export async function exportInventoryReport(details, print, status) {
    const response = await fetch(inventoryFontUrl);
    if (!response.ok) throw new Error('Не удалось загрузить шрифт для акта.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const font = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
    const { createInventoryPDF } = await import('./inventory-pdf.js');
    const pdf = createInventoryPDF(details, font);
    const encoded = pdf.output('datauristring').split(',')[1];
    const path = await window.go.main.InventoryService.SaveInventoryPDF(details.id, encoded, print);
    if (path) showStatus(status, print ? 'Акт открыт в просмотрщике PDF. Выберите «Печать».' : 'Акт сохранён в PDF.');
}