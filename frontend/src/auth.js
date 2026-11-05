import authHtml from './auth.html?raw';

document.addEventListener("DOMContentLoaded", () => {
    // 1. Вставляем HTML
    const authContainer = document.getElementById("auth-container");
    if (authContainer) {
        authContainer.innerHTML = authHtml;
    }

    // 2. Находим элементы
    const loginScreen = document.getElementById("login-screen");
    const registerScreen = document.getElementById("register-screen");
    const mainApp = document.getElementById("main-app");
    
    // --- ПЕРЕКЛЮЧЕНИЕ ЭКРАНОВ ---
    document.getElementById("link-to-register").addEventListener("click", () => {
        loginScreen.style.display = "none";
        registerScreen.style.display = "flex"; // Или block
    });

    document.getElementById("link-to-login").addEventListener("click", () => {
        registerScreen.style.display = "none";
        loginScreen.style.display = "flex"; // Или block
    });

    // --- ЛОГИКА ВХОДА ---
    const loginForm = document.getElementById("login-form");
    const loginError = document.getElementById("login-error");

    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        loginError.style.display = "none";
        
        const email = document.getElementById("login-email").value;
        const password = document.getElementById("login-password").value;

        try {
            const isSuccess = await window.go.main.AuthService.Login(email, password);
            if (isSuccess) {
                // Скрываем авторизацию полностью и показываем приложение
                document.getElementById("auth-container").style.display = "none";
                mainApp.style.display = "block"; 
                
                // Кричим, что вошли
                window.dispatchEvent(new CustomEvent('user-logged-in'));
            } else {
                loginError.textContent = "Неверный email или пароль";
                loginError.style.display = "block";
            }
        } catch (err) {
            loginError.textContent = "Ошибка сервера: " + err;
            loginError.style.display = "block";
        }
    });

    // --- ЛОГИКА РЕГИСТРАЦИИ ---
    const registerForm = document.getElementById("register-form");
    const regError = document.getElementById("register-error");

    registerForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        regError.style.display = "none";

        const pass = document.getElementById("reg-password").value;
        const passConfirm = document.getElementById("reg-password-confirm").value;

        if (pass !== passConfirm) {
            regError.textContent = "Пароли не совпадают!";
            regError.style.display = "block";
            return;
        }

        const request = {
            lastName: document.getElementById("reg-lastname").value,
            firstName: document.getElementById("reg-firstname").value,
            middleName: document.getElementById("reg-middlename").value,
            email: document.getElementById("reg-email").value,
            password: pass,
            role: document.querySelector('input[name="reg-role"]:checked').value
        };

        try {
            await window.go.main.AuthService.Register(request);
            alert("Регистрация успешна! Войдите в систему.");
            // Программно кликаем на ссылку "Войти", чтобы переключить экран
            document.getElementById("link-to-login").click(); 
        } catch (err) {
            regError.textContent = "Ошибка: " + err;
            regError.style.display = "block";
        }
    });
});