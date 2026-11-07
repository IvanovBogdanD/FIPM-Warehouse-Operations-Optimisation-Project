import { byId } from '../../shared/dom.js';

export function initAuth() {
    const loginScreen = byId('login-screen');
    const registerScreen = byId('register-screen');
    const loginForm = byId('login-form');
    const registerForm = byId('register-form');
    const linkToRegister = byId('link-to-register');
    const linkToLogin = byId('link-to-login');
    const loginError = byId('login-error');
    const registerError = byId('register-error');

    if (!loginForm || !registerForm) return;

    // Переключение на регистрацию
    linkToRegister.addEventListener('click', (e) => {
        e.preventDefault();
        loginScreen.classList.add('d-none');
        loginScreen.classList.remove('d-flex');
        
        registerScreen.classList.remove('d-none');
        registerScreen.classList.add('d-flex');
        
        loginError.style.display = 'none';
    });

    // Переключение на вход
    linkToLogin.addEventListener('click', (e) => {
        e.preventDefault();
        registerScreen.classList.add('d-none');
        registerScreen.classList.remove('d-flex');
        
        loginScreen.classList.remove('d-none');
        loginScreen.classList.add('d-flex');
        
        registerError.style.display = 'none';
    });

    // Обработка входа
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        loginError.style.display = 'none';
        
        const email = byId('login-email').value;
        const password = byId('login-password').value;

        try {
            const user = await window.go.main.AuthService.Login(email, password);
            
            if (!user.isApproved) {
                loginError.textContent = 'Ваш аккаунт ожидает подтверждения администратором.';
                loginError.style.display = 'block';
                return;
            }
            
            sessionStorage.setItem('user', JSON.stringify(user));
            
            if (user.role === 'Кладовщик') {
                window.location.hash = '#inventory';
            } else {
                window.location.hash = '#home';
            }
        } catch (err) {
            loginError.textContent = err.message || String(err) || 'Ошибка входа';
            loginError.style.display = 'block';
        }
    });

    // Обработка регистрации
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        registerError.style.display = 'none';
        
        const pass = byId('reg-password').value;
        const passConfirm = byId('reg-password-confirm').value;
        
        if (pass !== passConfirm) {
            registerError.textContent = 'Пароли не совпадают';
            registerError.style.display = 'block';
            return;
        }

        const req = {
            lastName: byId('reg-lastname').value,
            firstName: byId('reg-firstname').value,
            middleName: byId('reg-middlename').value,
            email: byId('reg-email').value,
            password: pass,
            role: byId('reg-role').value,
        };

        try {
            await window.go.main.AuthService.Register(req);
            alert('Регистрация успешна! Ожидайте подтверждения администратором.');
            registerForm.reset();
            linkToLogin.click();
        } catch (err) {
            registerError.textContent = err.message || String(err) || 'Ошибка регистрации';
            registerError.style.display = 'block';
        }
    });
}