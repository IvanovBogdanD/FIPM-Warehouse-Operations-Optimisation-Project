import { byId } from '../../shared/dom.js';

export function initUsers() {
    byId('btn-refresh-users').addEventListener('click', loadUsers);

    byId('users-body').addEventListener('click', async (e) => {
        // Обработка кнопки "Одобрить"
        if (e.target.classList.contains('btn-approve')) {
            const userId = Number(e.target.dataset.id);
            e.target.disabled = true;
            e.target.textContent = '...';
            
            try {
                await window.go.main.AdminService.ApproveUser(userId);
                await loadUsers();
            } catch (err) {
                alert('Ошибка при одобрении: ' + err);
                e.target.disabled = false;
                e.target.textContent = 'Одобрить';
            }
        }

        // Обработка кнопки "Отклонить" (Блокировка)
        if (e.target.classList.contains('btn-block')) {
            if (!confirm('Вы уверены, что хотите отклонить (заблокировать) этого пользователя?')) {
                return;
            }

            const userId = Number(e.target.dataset.id);
            e.target.disabled = true;
            e.target.textContent = '...';
            
            try {
                await window.go.main.AdminService.BlockUser(userId);
                await loadUsers();
            } catch (err) {
                alert('Ошибка при блокировке: ' + err);
                e.target.disabled = false;
                e.target.textContent = 'Отклонить';
            }
        }
    });
}

export async function loadUsers() {
    const tbody = byId('users-body');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-5">Загрузка...</td></tr>';

    try {
        const users = await window.go.main.AdminService.GetUsers();
        if (!users || users.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-5">Пользователей нет</td></tr>';
            return;
        }

        const currentUser = JSON.parse(sessionStorage.getItem('user'));
        tbody.innerHTML = '';

        users.forEach(u => {
            const tr = document.createElement('tr');
            const fio = `${u.lastName} ${u.firstName} ${u.middleName || ''}`.trim();
            
            // Красивые бейджи статуса
            const statusBadge = u.isApproved 
                ? '<span class="badge bg-success-subtle text-success border border-success-subtle px-2 py-1">Одобрен</span>' 
                : '<span class="badge bg-warning-subtle text-warning border border-warning-subtle px-2 py-1">Ожидает</span>';
            
            // Логика кнопок
            let actionBtn = '';
            if (u.isApproved) {
                // Если это текущий авторизованный админ, не даем ему заблокировать себя
                if (currentUser && currentUser.id === u.id) {
                    actionBtn = '<span class="text-muted small">Это вы</span>';
                } else {
                    actionBtn = `<button class="btn btn-sm btn-outline-danger btn-block" data-id="${u.id}">Отклонить</button>`;
                }
            } else {
                actionBtn = `<button class="btn btn-sm btn-primary btn-approve" data-id="${u.id}">Одобрить</button>`;
            }
            
            tr.innerHTML = `
                <td class="ps-3 text-muted">${u.id}</td>
                <td class="fw-medium">${fio}</td>
                <td>${u.email}</td>
                <td>${u.role}</td>
                <td>${statusBadge}</td>
                <td class="text-center">${actionBtn}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-5">Ошибка: ${err}</td></tr>`;
    }
}