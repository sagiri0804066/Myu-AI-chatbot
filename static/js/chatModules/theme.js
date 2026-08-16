const THEME_STORAGE_KEY = 'chat-theme-mode';
const systemThemeQuery = window.matchMedia('(prefers-color-scheme: dark)');

/**
 * 应用实际主题到 DOM
 * @param {'light'|'dark'} theme
 */
export function applyTheme(theme) {
    const isDark = theme === 'dark';

    document.body.classList.toggle('dark-mode', isDark);
    document.documentElement.dataset.theme = theme;

    const desktopButton = document.getElementById('btn-theme-toggle');
    const mobileButton = document.getElementById('btn-mobile-theme-toggle');

    if (desktopButton) {
        desktopButton.title = isDark ? '切换到浅色模式' : '切换到深色模式';
        desktopButton.setAttribute('aria-label', desktopButton.title);
    }

    if (mobileButton) {
        mobileButton.textContent = isDark ? '浅色模式' : '深色模式';
    }
}

/**
 * 获取当前页面实际生效的主题
 * @returns {'light'|'dark'}
 */
export function getCurrentTheme() {
    return document.body.classList.contains('dark-mode') ? 'dark' : 'light';
}

/**
 * 设置为跟随系统主题
 */
export function followSystemTheme() {
    localStorage.setItem(THEME_STORAGE_KEY, 'system');
    applyTheme(systemThemeQuery.matches ? 'dark' : 'light');
}

/**
 * 手动在深色与浅色之间切换
 */
export function toggleTheme() {
    const nextTheme = getCurrentTheme() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    applyTheme(nextTheme);
}

/**
 * 设置指定主题模式
 * @param {'system'|'light'|'dark'} mode
 */
export function setThemeMode(mode) {
    if (mode === 'system') {
        followSystemTheme();
        return;
    }

    if (mode !== 'light' && mode !== 'dark') {
        console.warn('无效的主题模式：', mode);
        return;
    }

    localStorage.setItem(THEME_STORAGE_KEY, mode);
    applyTheme(mode);
}

/**
 * 监听系统主题变化的回调
 * @param {MediaQueryListEvent} event
 */
function handleSystemThemeChange(event) {
    const currentMode = localStorage.getItem(THEME_STORAGE_KEY) || 'system';
    if (currentMode === 'system') {
        applyTheme(event.matches ? 'dark' : 'light');
    }
}

/**
 * 初始化主题系统（注册监听并绑定桌面/移动端按钮）
 */
export function initTheme() {
    const savedMode = localStorage.getItem(THEME_STORAGE_KEY) || 'system';

    if (savedMode === 'light' || savedMode === 'dark') {
        applyTheme(savedMode);
    } else {
        followSystemTheme();
    }

    // 监听系统深浅色偏好变化
    if (typeof systemThemeQuery.addEventListener === 'function') {
        systemThemeQuery.addEventListener('change', handleSystemThemeChange);
    } else {
        // 兼容旧版 Safari
        systemThemeQuery.addListener(handleSystemThemeChange);
    }

    // 绑定桌面端与移动端切换按钮事件
    document.getElementById('btn-theme-toggle')?.addEventListener('click', toggleTheme);
    document.getElementById('btn-mobile-theme-toggle')?.addEventListener('click', toggleTheme);
}