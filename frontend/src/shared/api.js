export function callBackend(method, ...args) {
    const service = window.go?.main?.DBService;
    if (typeof service?.[method] !== 'function') {
        return Promise.reject(new Error('Backend недоступен. Откройте приложение через Wails.'));
    }
    return service[method](...args);
}
