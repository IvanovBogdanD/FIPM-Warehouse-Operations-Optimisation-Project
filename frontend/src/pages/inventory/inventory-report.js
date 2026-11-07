import { byId, showStatus } from '../../shared/dom.js';
import { inventoryNumber, inventoryDate, inventoryTotals } from './inventory-data.js';
import inventoryFontUrl from '../../assets/fonts/Nunito-Regular.ttf?url';

export function renderInventoryReport(details) {
    const totals = inventoryTotals(details);
    const completed = details.status === 'completed';
    byId('inventory-report-status').textContent = completed ? 'Инвентаризация завершена' : 'Черновик акта';
    byId('inventory-report-status').className = `badge text-bg-${completed ? 'success' : 'warning'}`;
    byId('inventory-report-title').textContent = `АКТ ИНВЕНТАРИЗАЦИИ № ${inventoryNumber(details)}`;
    byId('inventory-report-date').textContent = `от ${inventoryDate(details.date)}`;
    byId('inventory-report-people').textContent = `Проводит: ${details.responsible || 'Не указано'}. Комиссия: ${details.commission || 'Не указана'}. Вид проверки: ${details.kind === 'full' ? 'полная' : 'выборочная'}.`;
    const body = byId('inventory-report-body'); body.replaceChildren();
    details.items.forEach((item, index) => {
        const difference = item.actualCount - item.systemCount;
        const row = document.createElement('tr');
        for (const value of [index + 1, item.productName, '-', '-', item.systemCount, item.actualCount, difference < 0 ? -difference : '-', difference > 0 ? difference : '-']) {
            const cell = document.createElement('td'); cell.textContent = value; row.append(cell);
        }
        body.append(row);
    });
    const total = document.createElement('tr');
    const label = document.createElement('th'); label.colSpan = 4; label.textContent = 'Итого'; total.append(label);
    for (const value of [totals.system, totals.actual, totals.shortage, totals.surplus]) { const cell = document.createElement('th'); cell.textContent = value; total.append(cell); }
    byId('inventory-report-total').replaceChildren(total);
    byId('inventory-report-result').textContent = completed ? `Остатки в системе скорректированы по фактическим данным. Дата проведения: ${inventoryDate(details.date)}.` : 'Корректировка остатков ещё не применена.';
    const signatures = byId('inventory-report-signatures'); signatures.replaceChildren();
    const people = [details.responsible, ...details.commission.split(', ')].filter(Boolean);
    for (const person of people) {
        const line = document.createElement('p'); line.className = 'border-top pt-2 mt-5';
        line.textContent = `${person} · Подпись ____________________`; signatures.append(line);
    }
}

export async function exportInventoryReport(details, print) {
    const response = await fetch(inventoryFontUrl);
    if (!response.ok) throw new Error('Не удалось загрузить шрифт для акта.');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const font = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(''));
    const { createInventoryPDF } = await import('./inventory-pdf.js');
    const pdf = createInventoryPDF(details, font);
    const encoded = pdf.output('datauristring').split(',')[1];
    const path = await window.go.main.InventoryService.SaveInventoryPDF(details.id, encoded, print);
    if (path) showStatus(byId('inventory-status'), print ? 'Акт открыт в просмотрщике PDF. Выберите «Печать».' : 'Акт сохранён в PDF.');
}
