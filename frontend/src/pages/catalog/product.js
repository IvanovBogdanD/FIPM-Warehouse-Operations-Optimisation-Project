import { callBackend } from '../../shared/api.js';
import { byId, showError, showStatus } from '../../shared/dom.js';

let productRequest = 0;

function productAvailability(stock) {
    if (stock.count <= 0) return { label: 'Нет в наличии', style: 'text-bg-danger' };
    if (stock.free <= 0) return { label: 'Всё в брони', style: 'text-bg-warning' };
    return { label: 'В наличии', style: 'text-bg-success' };
}

function renderProduct(stock, locations) {
    const { label, style } = productAvailability(stock);
    const reservedShare = stock.count > 0 ? Math.min(100, Math.round(stock.reserved / stock.count * 100)) : 0;
    const freeShare = stock.count > 0 ? 100 - reservedShare : 0;
    byId('product-name').textContent = stock.name;
    byId('product-info-name').textContent = stock.name;
    byId('product-id').textContent = `ID ${stock.id}`;
    byId('product-availability').className = `badge ${style}`;
    byId('product-availability').textContent = label;
    byId('product-count').textContent = stock.count.toLocaleString('ru-RU');
    byId('product-free').textContent = stock.free.toLocaleString('ru-RU');
    byId('product-reserved').textContent = stock.reserved.toLocaleString('ru-RU');
    byId('product-bar-free').style.width = `${freeShare}%`;
    byId('product-bar-reserved').style.width = `${reservedShare}%`;
    byId('product-free-share').textContent = `Свободно ${freeShare}%`;
    byId('product-reserved-share').textContent = `В брони ${reservedShare}%`;
    byId('product-warning').hidden = stock.free >= 0;
    const measure = (value, unit) => value > 0 ? `${value.toLocaleString('ru-RU')} ${unit}` : 'Не указано';
    const date = (value) => value ? value.split('-').reverse().join('.') : 'Не указана';
    const fields = {
        supplier: stock.supplier || 'Не указан',
        manufacturer: stock.manufacturer || 'Не указан',
        article: stock.article || 'Не указан',
        sku: stock.sku ? `${stock.sku} · ${stock.unitsPerPackage} ед.` : 'Не указан',
        warehouse: stock.warehouse || 'Не указан',
        location: locations.length ? locations.map((item) => `${item.storageLocation}: ${item.count} шт.`).join('; ') : 'Не размещён в ячейках',
        'position-id': stock.id,
        'received-on': date(stock.receivedOn),
        storage: stock.rotation ? `${stock.expiresOn ? `До ${date(stock.expiresOn)}` : 'Без ограничения срока'} · ${stock.rotation}` : 'Не указан',
        length: measure(stock.lengthMm, 'мм'),
        width: measure(stock.widthMm, 'мм'),
        height: measure(stock.heightMm, 'мм'),
        weight: measure(stock.weightKg, 'кг'),
        'liquid-volume': stock.liquidVolumeL === 0 ? 'Не применяется' : measure(stock.liquidVolumeL, 'л'),
        'package-volume': measure(stock.packageVolumeL, 'л'),
    };
    for (const [id, value] of Object.entries(fields)) byId(`product-${id}`).textContent = value;
    byId('product-demo-note').hidden = !stock.demoData;
}

export async function loadProduct(id) {
    const request = ++productRequest;
    byId('product-name').textContent = 'Карточка товара';
    byId('product-summary').hidden = true;
    byId('product-card').hidden = true;
    showStatus(byId('product-status'), 'Загрузка товара…');
    try {
        const [stock, locations] = await Promise.all([callBackend('GetProductStock', id), callBackend('GetProductLocations', id)]);
        if (request !== productRequest) return;
        renderProduct(stock, locations);
        byId('product-summary').hidden = false;
        byId('product-card').hidden = false;
        showStatus(byId('product-status'), '');
    } catch (error) {
        if (request === productRequest) showError(byId('product-status'), error);
    }
}
