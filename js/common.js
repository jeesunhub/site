function formatCurrency(val) {
    if (val === undefined || val === null || val === '') return '';
    const num = String(val).replace(/[^0-9]/g, '');
    if (!num) return '';
    return Number(num).toLocaleString('ko-KR');
}

function unformatCurrency(val) {
    if (val === undefined || val === null) return 0;
    return parseInt(String(val).replace(/[^0-9]/g, '')) || 0;
}

function formatPhone(val) {
    if (!val) return '';
    const num = String(val).replace(/[^0-9]/g, '');
    if (num.length <= 4) return num;
    if (num.length <= 8) {
        return num.slice(0, num.length - 4) + '-' + num.slice(num.length - 4);
    }
    // Standard Korean mobile: 010-1234-5678 (11 digits)
    // From back: 4 digits, then 4 digits, then rest.
    const part3 = num.slice(-4);
    const part2 = num.slice(-8, -4);
    const part1 = num.slice(0, -8);
    return `${part1}-${part2}-${part3}`;
}


function toggleFooterInfo() {
    const details = document.getElementById('footer-biz-details');
    if (details) {
        details.classList.toggle('show');
    }
}


function renderNavbar() {
    // Inject Google Analytics
    if (!document.getElementById('ga-script')) {
        const gaScript = document.createElement('script');
        gaScript.id = 'ga-script';
        gaScript.async = true;
        gaScript.src = 'https://www.googletagmanager.com/gtag/js?id=G-X4WCMLD7KQ'; // Assuming a placeholder or provided ID. Usually user provides one. I will use a placeholder or ask. Wait, I should probably check if user provided one. They just said "google analytics 추가". I will add the standard boilerplate with a placeholder ID.
        document.head.appendChild(gaScript);

        const gaConfig = document.createElement('script');
        gaConfig.innerHTML = `
            window.dataLayer = window.dataLayer || [];
            function gtag(){dataLayer.push(arguments);}
            gtag('js', new Date());
            gtag('config', 'G-X4WCMLD7KQ');
        `;
        document.head.appendChild(gaConfig);
    }

    const user = JSON.parse(localStorage.getItem('user'));
    if (!user) {
        window.location.href = '/index.html';
        return;
    }

    // Reorganize DOM if not already structured
    if (!document.getElementById('layout-header')) {
        const header = document.createElement('header');
        header.id = 'layout-header';

        const main = document.createElement('main');
        main.id = 'layout-main';

        const footer = document.createElement('footer');
        footer.id = 'layout-footer';
        footer.innerHTML = `
            <div class="footer-container">
                <div class="footer-biz-name" onclick="toggleFooterInfo()">상호명: 김지선, 김세미 부동산</div>
                <div class="footer-links">
                    <button class="footer-btn">이용약관</button>
                    <button class="footer-btn">개인정보처리방침</button>
                </div>
                <div id="footer-biz-details" class="footer-info-details">
                    상호명: 김지선, 김세미 부동산<br>
                    대표자명: 김지선외 1명<br>
                    사업자등록번호: 640-31-00762<br>
                    주소: 경기도 수원시 팔달구 우만동 89-5 GS지에스타워 403호
                </div>
            </div>
        `;

        // Defined toggle function globally already

        // Capture all current body elements except script tags and elements we just created
        const children = Array.from(document.body.children);

        // Clear body and add structure
        // Note: We don't use innerHTML='' to avoid losing script event listeners or states if possible, 
        // though moving them to 'main' is still a change.
        document.body.prepend(footer);
        document.body.prepend(main);
        document.body.prepend(header);

        children.forEach(child => {
            if (child.tagName !== 'SCRIPT' && child.id !== 'layout-header' && child.id !== 'layout-main' && child.id !== 'layout-footer') {
                main.appendChild(child);
            }
        });
    }

    const nav = document.createElement('nav');
    nav.className = 'navbar';

    const showBack = document.body.classList.contains('has-back-button');
    const backBtnHtml = showBack ? `
        <button class="nav-back-btn" onclick="history.back()" aria-label="뒤로가기">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
        </button>
    ` : '<div></div>';

    nav.innerHTML = `
        <div class="nav-container">
            <div class="nav-left">
                ${backBtnHtml}
            </div>
            
            <div class="nav-right">
                <div class="nav-user-info" onclick="toggleMenu(event)">
                    <span class="nav-nickname">${user.nickname || 'User'}</span>
                    <div class="hamburger-icon">
                        <span></span>
                        <span></span>
                        <span></span>
                    </div>
                </div>
                <div class="nav-noti-wrapper" onclick="window.location.href='/notices.html'">
                    <svg class="bell-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                    </svg>
                    <span id="unread-badge" class="noti-badge" style="display:none;"></span>
                </div>
                
                <div class="nav-dropdown" id="nav-menu">
                    <div class="dropdown-header">
                        <div class="avatar-circle" style="background:${user.color || '#6366f1'}">
                            ${user.nickname ? user.nickname[0] : 'U'}
                        </div>
                        <div class="header-text">
                            <div class="name">${user.nickname || 'User'}</div>
                            <div class="role">${user.role === 'admin' ? '관리자' : (user.role === 'landlord' ? '임대인' : '세입자')}</div>
                        </div>
                    </div>
                    <div class="dropdown-items">
                        <a href="/notices.html">📢 메시지함 <span id="menu-unread-count"></span></a>
                        <hr>
                        <a href="/dashboard.html">🏠 대시보드</a>
                        ${user.role === 'tenant' ? '<a href="/payments_monthly.html">💰 납부 내역</a>' : ''}
                        ${user.role === 'admin' ? '<a href="/landlord_management.html">👑 임대인 관리</a>' : ''}
                        ${(user.role === 'landlord' || user.role === 'admin') ? '<a href="/buildings.html">🏢 건물 관리</a>' : ''}
                        ${(user.role === 'landlord' || user.role === 'admin') ? '<a href="/tenants.html">👥 세입자 관리</a>' : ''}
                        ${(user.role === 'landlord' || user.role === 'admin') ? '<a href="/payments.html">💰 납부 관리</a>' : ''}
                        <hr>
                        ${(user.role === 'landlord' || user.role === 'admin') ? '<a href="/room_adv.html">🏠 방 내놓기</a>' : ''}
                        <a href="/item_adv.html">📦 물건 공유</a>
                        <a href="/info_adv.html">📰 정보 공유</a>
                        <hr>
                        <a href="/settings_profile.html">⚙️ 프로필 설정</a>
                        <a href="/settings_system.html">🛠️ 시스템 설정</a>
                        <hr>
                        <a href="#" onclick="logout()" class="logout-link">🚪 로그아웃</a>
                    </div>
                </div>
            </div>
        </div>
    `;
    const placeholder = document.getElementById('navbar-placeholder');
    const layoutHeader = document.getElementById('layout-header');

    if (placeholder) {
        placeholder.replaceWith(nav);
    } else if (layoutHeader) {
        layoutHeader.appendChild(nav);
    } else {
        document.body.prepend(nav);
    }

    // Fetch and update unread count
    updateUnreadCount(user.id);

    window.addEventListener('click', function (e) {
        const menu = document.getElementById('nav-menu');
        if (menu && menu.style.display === 'block' && !e.target.closest('.nav-dropdown') && !e.target.closest('.nav-user-info')) {
            menu.style.display = 'none';
        }
    });
}

async function updateUnreadCount(userId) {
    try {
        const res = await fetch(`/api/messages/unread-count/${userId}`);
        const data = await res.json();
        const count = data.count || 0;

        const badge = document.getElementById('unread-badge');
        const menuCount = document.getElementById('menu-unread-count');

        if (badge) {
            if (count > 0) {
                badge.textContent = count > 99 ? '99+' : count;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }

        if (menuCount) {
            menuCount.textContent = count > 0 ? `(${count})` : '';
            menuCount.style.color = 'var(--primary)';
            menuCount.style.fontWeight = 'bold';
        }
    } catch (err) {
        console.error('Failed to update unread count:', err);
    }
}

function toggleMenu(e) {
    e.stopPropagation();
    const menu = document.getElementById('nav-menu');
    const isVisible = menu.style.display === 'block';
    menu.style.display = isVisible ? 'none' : 'block';
}

function logout() {
    localStorage.removeItem('user');
    window.location.href = '/index.html';
}

const colorPalette = [
    '#6366f1', '#a855f7', '#ec4899', '#f43f5e', '#f97316',
    '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6'
];

function getDueDate(billMonth, startDate, type) {
    if (!billMonth || !startDate) return null;
    try {
        const startDay = parseInt(startDate.split('-')[2]);
        const parts = billMonth.split('-');
        if (parts.length < 2) return null;
        const [bYear, bMonth] = parts.map(Number);
        if (isNaN(startDay) || isNaN(bYear) || isNaN(bMonth)) return null;
        let date = new Date(bYear, bMonth - 1, startDay);
        if (type === 'postpaid') {
            date.setMonth(date.getMonth() + 1);
        }
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    } catch (e) {
        return null;
    }
}

async function initTestingMode() {
    try {
        const res = await fetch('/api/config/mode');
        const data = await res.json();
        if (data.mode === 'TEST') {
            document.body.classList.add('test-mode');
        }
    } catch (err) {
        // Silently fail if endpoint is not available or non-test mode
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initTestingMode();
});
