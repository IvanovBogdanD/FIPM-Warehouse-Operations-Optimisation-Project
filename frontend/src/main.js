import 'bootstrap/dist/css/bootstrap.min.css';
import 'admin-lte/dist/css/adminlte.min.css';
import './style.css';
import 'bootstrap/dist/js/bootstrap.bundle.min.js';
import 'admin-lte';
import { mountLayout } from './layout/layout.js';
import { initHome } from './pages/home/home.js';
import { initCatalog } from './pages/catalog/catalog.js';
import { initRouter } from './app/router.js';
import { initReceiving } from './pages/receiving/receiving.js';

mountLayout();
initHome();
initCatalog();
initReceiving();
initRouter();
