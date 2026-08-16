/**
 * 通用 JSON 请求封装
 * @param {string} url 请求地址
 * @param {RequestInit} options fetch 配置项
 * @returns {Promise<any>}
 */
async function request(url, options = {}) {
    const headers = new Headers(options.headers || {});

    if (options.body != null && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    const res = await fetch(url, {
        ...options,
        headers,
    });

    const responseText = await res.text();
    let data = null;

    if (responseText) {
        try {
            data = JSON.parse(responseText);
        } catch (_) {
            data = responseText;
        }
    }

    if (!res.ok) {
        const detail =
            data && typeof data === 'object' && data.detail
                ? data.detail
                : `请求失败: ${res.status}`;

        const error = new Error(detail);
        error.status = res.status;
        error.data = data;
        throw error;
    }

    return data;
}


/* ==========================================================================
   1. 聊天与消息相关 API
   ========================================================================== */

/**
 * 页面初次载入拉取配置与首屏数据
 * @returns {Promise<{user: object, contact: object, contacts: Array, messages: Array, statusIndex: number}>}
 */
export async function fetchInitData() {
    return await request('/api/message/init');
}

/**
 * 长轮询拉取增量消息与状态
 * @param {number|string} cursor 游标（当前最后一条消息的 ID）
 * @param {AbortSignal} signal 超时打断信号
 * @returns {Promise<{messages?: Array, statusIndex?: number}>}
 */
export function pollMessages(cursor = 0, signal) {
    return request(
        `/api/message/poll?cursor=${encodeURIComponent(cursor)}`,
        { signal }
    );
}


/**
 * 发送一条消息
 * @param {string} text 序列化后的消息内容
 * @param {number} time 发送时的时间戳
 * @returns {Promise<{time?: string}>}
 */
export async function sendMessageApi(text, time) {
    return await request('/api/message/send', {
        method: 'POST',
        body: JSON.stringify({ text, time }),
    });
}

/**
 * 分页拉取历史消息（双向）
 * @param {number|string} cursor 游标消息 ID
 * @param {'older'|'newer'} direction 拉取方向
 * @param {number} limit 每次拉取数量
 * @returns {Promise<{messages: Array}>}
 */
export function fetchHistory(cursor, direction = 'older', limit = 20) {
    const params = new URLSearchParams({
        cursor: String(cursor),
        direction,
        limit: String(limit),
    });

    return request(`/api/message/history?${params.toString()}`);
}

/**
 * 获取指定消息上下文断面（用于搜索跳转）
 * @param {number|string} messageId 目标消息 ID
 * @returns {Promise<{messages: Array}>}
 */
export function fetchMessageContext(messageId) {
    return request(
        `/api/message/context?message_id=${encodeURIComponent(messageId)}`
    );
}

/**
 * 批量删除消息
 * @param {Array<number>} ids 要删除的消息 ID 列表
 * @returns {Promise<any>}
 */
export async function deleteMessagesApi(ids) {
    return await request('/api/message/delete', {
        method: 'POST',
        body: JSON.stringify({ ids }),
    });
}

/**
 * 发送输入打断信号（通知 AI/服务端停止生成）
 * @returns {Promise<any>}
 */
export function sendInterruptApi() {
    return request('/api/message/interrupt');
}

/* ==========================================================================
   2. 联系人与群组相关 API
   ========================================================================== */
/**
 * 新增或编辑联系人/群聊。
 * 保留传入对象的完整字段
 *
 * @param {object} contactData
 * @returns {Promise<{uuid?: string, status?: string}>}
 */
export function editContactApi(contactData) {
    if (!contactData || typeof contactData !== 'object') {
        throw new TypeError('editContactApi: contactData 必须是对象');
    }

    return request('/api/message/edit/contact', {
        method: 'POST',
        body: JSON.stringify(contactData),
    });
}


/**
 * 删除联系人
 * @param {string} uuid
 * @returns {Promise<any>}
 */
export async function deleteContactApi(uuid) {
    return await request('/api/message/delete/contact', {
        method: 'POST',
        body: JSON.stringify({ uuid }),
    });
}

/**
 * 切换当前会话联系人
 * @param {string} uuid
 * @returns {Promise<any>}
 */
export async function switchContactApi(uuid) {
    return await request('/api/message/switch/contact', {
        method: 'POST',
        body: JSON.stringify({ uuid }),
    });
}

/* ==========================================================================
   3. 用户资料相关 API
   ========================================================================== */

/**
 * 保存当前用户的个人信息配置
 * @param {object} profile 用户资料对象
 * @returns {Promise<any>}
 */
export async function updateUserProfileApi(profile) {
    return await request('/api/message/user/profile', {
        method: 'POST',
        body: JSON.stringify(profile),
    });
}

/* ==========================================================================
   4. 搜索与日历检索相关 API
   ========================================================================== */

/**
 * 关键字全文检索聊天记录
 * @param {string} query 关键词文本
 * @returns {Promise<{messages: Array}>}
 */
export async function searchMessagesApi(query) {
    return await request(`/api/message/search?query=${encodeURIComponent(query)}`);
}

/**
 * 查询指定月份包含聊天记录的活跃日期列表
 * @param {number} year 年份，如 2026
 * @param {number} month 月份索引（0 - 11）
 * @returns {Promise<{activeDays: Array<string>}>} 形如 { activeDays: ["2026/08/15", "2026/08/16"] }
 */
export async function fetchActiveDatesApi(year, month) {
    const formattedMonth = String(month + 1).padStart(2, '0');
    const yearMonth = `${year}/${formattedMonth}`;
    return await request(`/api/message/active_dates?year_month=${encodeURIComponent(yearMonth)}`);
}