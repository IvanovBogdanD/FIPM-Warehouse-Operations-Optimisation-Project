import bootstrap from 'bootstrap/dist/js/bootstrap.bundle.min.js';
import { byId } from './dom.js';

export function showModal(id) {
    bootstrap.Modal.getOrCreateInstance(byId(id)).show();
}

export function hideModal(id) {
    bootstrap.Modal.getOrCreateInstance(byId(id)).hide();
}
