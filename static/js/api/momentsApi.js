/**
 * 朋友圈接口通用请求封装。
 *
 * @param {string} url
 * @param {RequestInit} options
 * @returns {Promise<any>}
 */
async function request(url, options = {}) {
    const headers = new Headers(options.headers || {});

    if (options.body != null && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    const response = await fetch(url, {
        ...options,
        headers,
    });

    const responseText = await response.text();
    let data = null;

    if (responseText) {
        try {
            data = JSON.parse(responseText);
        } catch (_) {
            data = responseText;
        }
    }

    if (!response.ok) {
        const detail =
            data &&
            typeof data === 'object' &&
            data.detail
                ? data.detail
                : `请求失败: ${response.status}`;

        const error = new Error(detail);
        error.status = response.status;
        error.data = data;

        throw error;
    }

    return data;
}

function appendOptionalParam(params, name, value) {
    if (
        value !== null &&
        value !== undefined &&
        String(value).trim() !== ''
    ) {
        params.set(name, String(value));
    }
}

/* ==========================================================================
   1. 初始化与历史动态
   ========================================================================== */

/**
 * 获取朋友圈页面展示的资料。
 *
 * 不传 profileUuid 时获取当前用户资料；
 * 传入 profileUuid 时获取对应联系人的资料。
 *
 * @param {string|null} profileUuid
 * @returns {Promise<object>}
 */
export function fetchMomentsProfileApi(profileUuid = null) {
    const params = new URLSearchParams();
    appendOptionalParam(params, 'uuid', profileUuid);

    const query = params.toString();

    return request(
        `/api/moments/init${query ? `?${query}` : ''}`
    );
}

/**
 * 获取朋友圈历史动态。
 *
 * @param {object} options
 * @param {string|number|null} options.cursor 分页游标
 * @param {string|null} options.profileUuid 联系人 UUID
 * @param {string|null} options.momentUuid 单条动态 UUID
 * @returns {Promise<Array<object>>}
 */
export function fetchMomentsHistoryApi({
    cursor = null,
    profileUuid = null,
    momentUuid = null,
} = {}) {
    if (profileUuid && momentUuid) {
        throw new Error(
            'fetchMomentsHistoryApi: profileUuid 和 momentUuid 不能同时传入'
        );
    }

    const params = new URLSearchParams();

    appendOptionalParam(params, 'cursor', cursor);
    appendOptionalParam(params, 'uuid', profileUuid);
    appendOptionalParam(params, 'moment_uuid', momentUuid);

    const query = params.toString();

    return request(
        `/api/moments/history${query ? `?${query}` : ''}`
    );
}

/* ==========================================================================
   2. 动态操作
   ========================================================================== */

/**
 * 发布朋友圈动态。
 *
 * @param {object} post
 * @param {string} post.text
 * @param {Array<string>} post.appendix Base64 图片数组
 * @param {string} post.senderUuid
 * @returns {Promise<any>}
 */
export function createMomentApi({
    text = '',
    appendix = [],
    senderUuid = 'user',
}) {
    return request('/api/moments/send', {
        method: 'POST',
        body: JSON.stringify({
            text,
            appendix: Array.isArray(appendix) ? appendix : [],
            sender_uuid: senderUuid,
        }),
    });
}

/**
 * 删除一条朋友圈动态。
 *
 * @param {string} uuid
 * @returns {Promise<any>}
 */
export function deleteMomentApi(uuid) {
    if (!uuid) {
        throw new TypeError('deleteMomentApi: uuid 不能为空');
    }

    return request('/api/moments/delete', {
        method: 'POST',
        body: JSON.stringify({ uuid }),
    });
}

/**
 * 点赞或取消点赞。
 *
 * 后端当前通过 GET 请求切换点赞状态，重构阶段保持原接口行为。
 *
 * @param {string} momentUuid
 * @param {string} senderUuid
 * @returns {Promise<any>}
 */
export function toggleMomentPraiseApi(
    momentUuid,
    senderUuid = 'user'
) {
    if (!momentUuid) {
        throw new TypeError(
            'toggleMomentPraiseApi: momentUuid 不能为空'
        );
    }

    const params = new URLSearchParams({
        uuid: String(momentUuid),
        sender_uuid: String(senderUuid),
    });

    return request(
        `/api/moments/praise?${params.toString()}`
    );
}

/**
 * 提交动态评论或回复。
 *
 * @param {object} comment
 * @param {string} comment.momentUuid
 * @param {string} comment.senderUuid
 * @param {string} comment.text
 * @param {string|null} comment.replyTo
 * @returns {Promise<any>}
 */
export function createMomentCommentApi({
    momentUuid,
    senderUuid = 'user',
    text,
    replyTo = null,
}) {
    if (!momentUuid) {
        throw new TypeError(
            'createMomentCommentApi: momentUuid 不能为空'
        );
    }

    const normalizedText =
        typeof text === 'string' ? text.trim() : '';

    if (!normalizedText) {
        throw new TypeError(
            'createMomentCommentApi: 评论内容不能为空'
        );
    }

    return request('/api/moments/comments', {
        method: 'POST',
        body: JSON.stringify({
            moment_uuid: momentUuid,
            sender_uuid: senderUuid,
            text: normalizedText,
            reply_to: replyTo || '',
        }),
    });
}

/* ==========================================================================
   3. 新消息通知
   ========================================================================== */

/**
 * 获取未读朋友圈消息。
 *
 * @returns {Promise<{
 *   len?: number,
 *   new_messages?: Array<object>
 * }>}
 */
export function fetchMomentsNotificationsApi() {
    return request('/api/moments/new_messages');
}

/**
 * 将朋友圈消息标记为已读。
 *
 * @returns {Promise<any>}
 */
export function markMomentsNotificationsReadApi() {
    return request('/api/moments/read_messages', {
        method: 'POST',
    });
}