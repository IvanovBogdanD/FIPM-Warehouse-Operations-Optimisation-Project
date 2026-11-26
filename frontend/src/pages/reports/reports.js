import { byId, showError, showStatus } from '../../shared/dom.js';
import { inventoryDate, inventoryNumber } from '../inventory/inventory-data.js';
import { exportInventoryReport, renderInventoryReport } from '../inventory/inventory-report.js';

let selectedReport;
let reportsRequest = 0;

function renderReports(reports) {
    const rows = reports.map((report) => {
        const row = document.createElement('tr');
        const number = document.createElement('td');
        const link = document.createElement('a');
        link.href = `#reports/${report.id}`;
        link.textContent = inventoryNumber(report);
        number.append(link);
        row.append(number);
        
        let statusText = 'Черновик';
        if (report.status === 'completed') statusText = 'Завершён';
        else if (report.status === 'pending') statusText = 'Ожидает подтверждения';

        for (const value of [inventoryDate(report.date), report.commission || 'Не указан', statusText]) {
            const cell = document.createElement('td');
            cell.textContent = value;
            row.append(cell);
        }

        const cell = document.createElement('td');
        if (report.status === 'pending') {
            const button = document.createElement('button');
            button.type = 'button'; button.className = 'btn btn-outline-primary btn-sm';
            button.textContent = 'Проверить';
            button.addEventListener('click', () => {
                location.hash = `#inventory/${report.id}`;
            });
            cell.append(button);
        }
        row.append(cell);
        
        return row;
    });
    byId('reports-body').replaceChildren(...rows);
    byId('reports-table').hidden = rows.length === 0;
    byId('reports-empty').hidden = rows.length > 0;
    byId('reports-list').hidden = false;
}

export async function loadReports(id) {
    const request = ++reportsRequest;
    const listing = id === null;
    const status = byId('reports-status');
    byId('reports-list').hidden = true;
    byId('reports-detail').hidden = listing;
    byId('reports-act').hidden = true;
    showStatus(status, listing ? 'Загрузка отчётов…' : 'Загрузка акта…');

    const userStr = sessionStorage.getItem('user');
    const user = userStr ? JSON.parse(userStr) : { id: 0, role: 'Гость' };

    try {
        const service = window.go.main.InventoryService;
        const result = await (listing ? service.GetInventoryReports(user.id, user.role) : service.GetInventoryReport(id, user.id, user.role));
        if (request !== reportsRequest) return;
        if (listing) {
            renderReports(result);
        } else {
            renderInventoryReport(result, 'reports-act');
            selectedReport = result;
            byId('reports-act').hidden = false;
        }
        showStatus(status, '');
    } catch (error) {
        if (request === reportsRequest) showError(status, error);
    }
}

export function initReports() {
    for (const [id, print] of [['reports-download-pdf', false], ['reports-print', true]]) {
        const button = byId(id);
        button.addEventListener('click', async () => {
            const status = byId('reports-status');
            showStatus(status, '');
            button.disabled = true;
            try {
                await exportInventoryReport(selectedReport, print, status);
            } catch (error) {
                showError(status, error);
            } finally {
                button.disabled = false;
            }
        });
    }
}