import { jsPDF } from 'jspdf';
import { inventoryNumber, inventoryDate, inventoryTotals } from './inventory-data.js';

export function createInventoryPDF(details, font) {
    const totals = inventoryTotals(details);
    const pdf = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
    pdf.addFileToVFS('Nunito.ttf', font);
    pdf.addFont('Nunito.ttf', 'Nunito', 'normal');
    pdf.setFont('Nunito');
    pdf.setFontSize(11);
    pdf.text('ФИПМ', 12, 18);
    pdf.text('УТВЕРЖДАЮ', 155, 18);
    pdf.text('Подпись ______________', 145, 25);
    pdf.setFontSize(14);
    pdf.text(`АКТ ИНВЕНТАРИЗАЦИИ № ${inventoryNumber(details)}`, 105, 38, { align: 'center' });
    pdf.setFontSize(10);
    pdf.text(`от ${inventoryDate(details.date)}`, 105, 46, { align: 'center' });
    let y = 55;
    const paragraph = (text) => {
        const lines = pdf.splitTextToSize(text, 186);
        if (y + lines.length * 5 > 280) { pdf.addPage(); y = 18; }
        pdf.text(lines, 12, y); y += lines.length * 5 + 3;
    };
    paragraph(`Проводит: ${details.responsible || 'Не указано'}. Комиссия: ${details.commission || 'Не указана'}.`);
    paragraph(`Проведена ${details.kind === 'full' ? 'полная' : 'выборочная'} инвентаризация товаров. Результаты:`);
    const widths = [8, 58, 20, 24, 19, 19, 19, 19];
    const header = ['№', 'Наименование', 'Артикул', 'Место хранения', 'Учёт, шт.', 'Факт, шт.', 'Недостача', 'Излишек'];
    const drawRow = (values) => {
        pdf.setFontSize(9);
        const lines = values.map((value, index) => pdf.splitTextToSize(String(value), widths[index] - 3));
        const height = Math.max(10, ...lines.map((value) => value.length * 4 + 4));
        if (y + height > 275) { pdf.addPage(); y = 16; drawRow(header); }
        let x = 12;
        lines.forEach((text, index) => { pdf.rect(x, y, widths[index], height); pdf.text(text, x + 1.5, y + 5); x += widths[index]; });
        y += height;
    };
    drawRow(header);
    details.items.forEach((item, index) => {
        const difference = item.actualCount - item.systemCount;
        drawRow([index + 1, item.productName, item.article || '-', item.storageLocation || '-', item.systemCount, item.actualCount, difference < 0 ? -difference : '-', difference > 0 ? difference : '-']);
    });
    drawRow(['', 'Итого', '', '', totals.system, totals.actual, totals.shortage, totals.surplus]);
    y += 10;
    pdf.setFontSize(10);
    paragraph(details.status === 'completed' ? `Остатки в системе скорректированы по фактическим данным. Дата проведения: ${inventoryDate(details.date)}.` : 'Черновик акта. Корректировка остатков ещё не применена.');
    for (const item of details.items.filter((item) => item.comment)) paragraph(`${item.productName}: ${item.comment}`);
    for (const person of [details.responsible, ...details.commission.split(', ')].filter(Boolean)) { y += 8; paragraph(`${person} · Подпись ____________________`); }
    return pdf;
}
