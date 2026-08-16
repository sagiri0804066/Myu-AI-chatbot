/**
 * HTML 转义，防止 XSS 注入
 * @param {string} str
 * @returns {string}
 */
export function escapeHTML(str) {
    if (!str) return '';
    return str.replace(/[&<>'"]/g,
        tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
    );
}

/**
 * 格式化聊天时间戳（今天、昨天、年月日）
 * @param {number|string} timestamp
 * @returns {string}
 */
export function formatTime(timestamp) {
    if (!timestamp) return "";

    // 如果已经是格式化好的简短时间字符串（如 "HH:MM"），直接返回
    if (typeof timestamp === 'string' && timestamp.includes(':') && timestamp.length <= 5) {
        return timestamp;
    }

    const target = new Date(timestamp);
    const now = new Date();

    const hours = String(target.getHours()).padStart(2, '0');
    const mins = String(target.getMinutes()).padStart(2, '0');
    const timeStr = `${hours}:${mins}`;

    // 获取今天与目标日期的零点时间，计算天数差
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const targetDay = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
    const dayDiff = Math.floor((today - targetDay) / (1000 * 60 * 60 * 24));

    if (dayDiff === 0) {
        return timeStr; // 今天直接显示 "HH:MM"
    }

    if (dayDiff === 1) {
        return `昨天 ${timeStr}`; // 昨天显示 "昨天 HH:MM"
    }

    // 跨天或更早的时间显示 "YYYY-MM-DD HH:MM"
    const year = target.getFullYear();
    const month = String(target.getMonth() + 1).padStart(2, '0');
    const day = String(target.getDate()).padStart(2, '0');
    return `${year}-${month}-${day} ${timeStr}`;
}

/**
 * 函数节流
 * @param {Function} func 目标执行函数
 * @param {number} limit 节流间隔时间(ms)
 * @returns {Function}
 */
export function throttle(func, limit) {
    let inThrottle;
    return function () {
        const args = arguments;
        const context = this;
        if (!inThrottle) {
            func.apply(context, args);
            inThrottle = true;
            setTimeout(() => inThrottle = false, limit);
        }
    };
}