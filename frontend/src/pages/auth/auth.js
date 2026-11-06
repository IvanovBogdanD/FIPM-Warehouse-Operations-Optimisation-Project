import { byId } from '../../shared/dom.js';

export function initAuth() {
    const loginForm = byId('login-form');
    const regForm = byId('register-form');
    const toggleBtn = byId('toggle-auth-mode');
    const errorBox = byId('auth-error');

    if (!loginForm) return; // Защита, если формы нет

    toggleBtn.addEventListener('click', (e) => {
        e.preventDefault();
        loginForm.classList.toggle('d-none');
        regForm.classList.toggle('d-none');
        errorBox.classList.add('d-none');
        toggleBtn.textContent = loginForm.classList.contains('d-none') 
            ? 'Уже есть аккаунт? Войти' 
            : 'Нет аккаунта? Регистрация';
    });

    function showError(msg) {
        errorBox.textContent = msg;
        errorBox.classList.remove('d-none');
    }

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorBox.classList.add('d-none');
        const email = byId('login-email').value;
        const password = byId('login-password').value;

        try {
            const user = await window.go.main.AuthService.Login(email, password);
            if (!user.isApproved) {
                showError('Ваш аккаунт ожидает подтверждения администратором.');
                return;
            }
            sessionStorage.setItem('user', JSON.stringify(user));
            window.location.hash = '#home';
        } catch (err) {
            showError(err.message || 'Ошибка входа');
        }
    });

    regForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorBox.classList.add('d-none');
        const req = {
            lastName: byId('reg-lastName').value,
            firstName: byId('reg-firstName').value,
            middleName: byId('reg-middleName').value,
            email: byId('reg-email').value,
            password: byId('reg-password').value,
            role: byId('reg-role').value,
        };

        try {
            await window.go.main.AuthService.Register(req);
            alert('Регистрация успешна! Ожидайте подтверждения администратора.');
            toggleBtn.click();
        } catch (err) {
            showError(err.message || 'Ошибка регистрации');
        }
    });
}