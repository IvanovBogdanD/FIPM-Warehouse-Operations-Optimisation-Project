import authHtml from './auth.html?raw';

document.addEventListener("DOMContentLoaded", () => {
    // 1. Inject HTML
    const authContainer = document.getElementById("auth-container");
    if (authContainer) {
        authContainer.innerHTML = authHtml;
    }

    // 2. Find elements
    const loginScreen    = document.getElementById("login-screen");
    const registerScreen = document.getElementById("register-screen");
    const mainApp        = document.getElementById("main-app");

    // --- SCREEN SWITCHING ---
    document.getElementById("link-to-register").addEventListener("click", () => {
        loginScreen.style.display = "none";
        registerScreen.style.display = "flex";
    });

    document.getElementById("link-to-login").addEventListener("click", () => {
        registerScreen.style.display = "none";
        loginScreen.style.display = "flex";
    });

    // --- LOGIN ---
    const loginForm  = document.getElementById("login-form");
    const loginError = document.getElementById("login-error");

    loginForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        loginError.style.display = "none";

        const email    = document.getElementById("login-email").value;
        const password = document.getElementById("login-password").value;

        try {
            const user = await window.go.main.AuthService.Login(email, password);

            if (user) {
                if (!user.isApproved) {
                    loginError.textContent = "Ваш аккаунт ожидает подтверждения администратором.";
                    loginError.style.display = "block";
                    return;
                }

                loginScreen.style.display = "none";
                mainApp.style.display = "block";

                // Notify other modules (main.js listens for this)
                window.dispatchEvent(new CustomEvent('user-logged-in', { detail: user }));

                // Show "Manage Users" button only for administrators
                const manageUsersBtn = document.getElementById("btn-manage-users");
                if (manageUsersBtn) {
                    manageUsersBtn.style.display =
                        (user.role === "Администратор") ? "inline-block" : "none";
                }
            }
        } catch (err) {
            loginError.textContent = err;
            loginError.style.display = "block";
        }
    });

    // --- REGISTRATION ---
    const registerForm = document.getElementById("register-form");
    const regError     = document.getElementById("register-error");

    registerForm.addEventListener("submit", async (e) => {
        e.preventDefault();
        regError.style.display = "none";

        const pass        = document.getElementById("reg-password").value;
        const passConfirm = document.getElementById("reg-password-confirm").value;

        if (pass !== passConfirm) {
            regError.textContent = "Пароли не совпадают!";
            regError.style.display = "block";
            return;
        }

        const request = {
            lastName:   document.getElementById("reg-lastname").value,
            firstName:  document.getElementById("reg-firstname").value,
            middleName: document.getElementById("reg-middlename").value,
            email:      document.getElementById("reg-email").value,
            password:   pass,
            role:       document.querySelector('input[name="reg-role"]:checked').value
        };

        try {
            await window.go.main.AuthService.Register(request);
            alert("Регистрация успешна! Войдите в систему.");
            document.getElementById("link-to-login").click();
        } catch (err) {
            regError.textContent = "Ошибка: " + err;
            regError.style.display = "block";
        }
    });

    // --- USERS MANAGEMENT (ADMIN ONLY) ---
    const manageUsersModalEl = document.getElementById("manage-users-modal");
    const manageUsersBody    = document.getElementById("manage-users-body");
    const manageUsersStatus  = document.getElementById("manage-users-status");

    // Bootstrap modal instance is created lazily on first open
    let manageUsersModal = null;

    // Escape user-supplied strings before injecting them into HTML
    function escapeHtml(value) {
        return String(value ?? "")
            .replaceAll("&", "&amp;")
            .replaceAll("<", "&lt;")
            .replaceAll(">", "&gt;")
            .replaceAll('"', "&quot;")
            .replaceAll("'", "&#39;");
    }

    // Build a single <tr> for the users table
    function renderUserRow(user) {
        const tr = document.createElement("tr");
        tr.dataset.userId = user.id;

        const fullName = [user.lastName, user.firstName, user.middleName]
            .filter(Boolean)
            .join(" ");

        const roles = ["Кладовщик", "Менеджер", "Администратор"];
        const roleOptions = roles
            .map(r => `<option value="${r}" ${r === user.role ? "selected" : ""}>${r}</option>`)
            .join("");

        const statusBadge = user.isApproved
            ? `<span class="badge bg-success">Подтверждён</span>`
            : `<span class="badge bg-warning text-dark">Ожидает</span>`;

        tr.innerHTML = `
            <td>${user.id}</td>
            <td>${escapeHtml(fullName)}</td>
            <td>${escapeHtml(user.email)}</td>
            <td>
                <select class="form-select form-select-sm user-role-select">
                    ${roleOptions}
                </select>
            </td>
            <td>${statusBadge}</td>
            <td>
                <button type="button"
                        class="btn btn-sm btn-success btn-approve-user"
                        ${user.isApproved ? "disabled" : ""}>
                    ${user.isApproved ? "Одобрен" : "Одобрить"}
                </button>
            </td>
        `;
        return tr;
    }

    // Fetch all users from Go and render them
    async function loadUsers() {
        manageUsersBody.innerHTML = "";
        manageUsersStatus.style.display = "block";
        manageUsersStatus.textContent = "Загрузка...";

        try {
            const users = await window.go.main.AuthService.GetAllUsers();

            if (!users || users.length === 0) {
                manageUsersStatus.textContent = "Список пуст.";
                return;
            }

            manageUsersStatus.style.display = "none";

            const fragment = document.createDocumentFragment();
            users.forEach(u => fragment.appendChild(renderUserRow(u)));
            manageUsersBody.appendChild(fragment);
        } catch (err) {
            manageUsersStatus.textContent = "Ошибка загрузки: " + err;
        }
    }

    // Approve button click (event delegation on tbody)
    manageUsersBody.addEventListener("click", async (e) => {
        const btn = e.target.closest(".btn-approve-user");
        if (!btn || btn.disabled) return;

        const row     = btn.closest("tr");
        const userId  = Number(row.dataset.userId);
        const newRole = row.querySelector(".user-role-select").value;

        btn.disabled = true;
        btn.textContent = "Сохранение...";

        try {
            await window.go.main.AuthService.ApproveUser(userId, newRole);
            await loadUsers();
        } catch (err) {
            btn.disabled = false;
            btn.textContent = "Одобрить";
            manageUsersStatus.style.display = "block";
            manageUsersStatus.textContent = "Ошибка: " + err;
        }
    });

    // Open modal + load users on click
    const manageUsersBtn = document.getElementById("btn-manage-users");
    if (manageUsersBtn) {
        manageUsersBtn.addEventListener("click", () => {
            if (!manageUsersModal) {
                manageUsersModal = new bootstrap.Modal(manageUsersModalEl);
            }
            manageUsersModal.show();
            loadUsers();
        });
    }
});