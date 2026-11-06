import houseIcon from './icons/house.svg?raw';
import gridIcon from './icons/grid.svg?raw';
import ordersIcon from './icons/list-ul.svg?raw';
import inventoryIcon from './icons/clipboard-check.svg?raw';
import reportsIcon from './icons/bar-chart.svg?raw';
import menuIcon from './icons/list.svg?raw';
import shippingIcon from './icons/box-arrow-up.svg?raw';
import closeIcon from './icons/x-lg.svg?raw';

const icons = {
    house: houseIcon, grid: gridIcon, 'list-ul': ordersIcon,
    'clipboard-check': inventoryIcon, 'bar-chart': reportsIcon,
    list: menuIcon, 'box-arrow-up': shippingIcon, 'x-lg': closeIcon,
};

export function withIcons(template) {
    for (const [name, svg] of Object.entries(icons)) {
        template = template.replaceAll(`{{${name}}}`, svg.replace('<svg ', '<svg aria-hidden="true" focusable="false" '));
    }
    return template;
}
