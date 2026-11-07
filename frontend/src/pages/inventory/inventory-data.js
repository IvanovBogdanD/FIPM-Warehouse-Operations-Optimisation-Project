export function inventoryNumber(details) {
    const year = (details.date || details.createdAt).slice(0, 4);
    return `ИНВ-${year}-${String(details.id).padStart(4, '0')}`;
}

export function inventoryDate(value) {
    return value ? value.split('-').reverse().join('.') : 'Не указана';
}

export function inventoryTotals(details) {
    const totals = { system: 0, actual: 0, shortage: 0, surplus: 0, matched: 0 };
    for (const item of details.items) {
        if (item.actualCount === null) throw new Error('Сначала завершите подсчёт всех товаров.');
        const difference = item.actualCount - item.systemCount;
        totals.system += item.systemCount;
        totals.actual += item.actualCount;
        if (difference < 0) totals.shortage -= difference;
        else if (difference > 0) totals.surplus += difference;
        else totals.matched++;
    }
    return totals;
}
