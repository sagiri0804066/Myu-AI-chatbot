/**
 * 默认头像 SVG
 */
export const DEFAULT_AVATAR_SVG = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#E0E0E0"/><circle cx="50" cy="35" r="20" fill="#A0A0A0"/><path d="M20 85 C20 60 80 60 80 85" fill="#A0A0A0"/></svg>`;

/**
 * 状态列表
 */
export const STATUS_LIST = ["🟢在线", "🟡忙碌", "🔴离线", "对方输入中...", ""];

/**
 * 5分钟时间差常量（毫秒）
 */
export const FIVE_MINUTES_MS = 5 * 60 * 1000;

function messageIdKey(id) {
    return id === null || id === undefined ? '' : String(id);
}

/**
 * 核心响应式/单例状态池
 */
export const store = {
    // 1. 用户与联系人核心数据
    user: {
        nickname: "",
        avatar: null,
        org: "",
        gender: "",
        birthday: "",
        hobbies: "",
        background: ""
    },
    contact: {
        type: "P",
        nickname: "",
        avatar: null,
        statusIndex: 2,
        members: []
    },
    contacts: [],
    messages: [],

    // 2. 聊天流转与分页控制状态
    isLoadingHistory: false,
    hasMoreOlderHistory: true,   // 向上滚动是否还有更旧的历史
    hasMoreNewerHistory: false,  // 向下滚动是否还有更新的历史（处于断面时为 true）
    isPollingActive: false,      // 当前是否有正在挂起的轮询

    /* ==========================================================================
       状态操作与变更方法 (Actions / Mutators)
       ========================================================================== */

    /**
     * 批量载入初始化数据
     * @param {object} data /api/message/init 返回的结构
     */
    setInitialData(data = {}) {
        const userDefaults = {
            nickname: "",
            avatar: null,
            org: "",
            gender: "",
            birthday: "",
            hobbies: "",
            background: ""
        };

        const contactDefaults = {
            type: "P",
            nickname: "",
            avatar: null,
            statusIndex: 2,
            members: []
        };

        Object.assign(this.user, userDefaults, data.user || {});
        Object.assign(this.contact, contactDefaults, data.contact || {});

        if (data.statusIndex !== undefined) {
            this.contact.statusIndex = data.statusIndex;
        }

        this.contact.members = Array.isArray(this.contact.members)
            ? this.contact.members
            : [];

        this.contacts = Array.isArray(data.contacts) ? data.contacts : [];
        this.messages = Array.isArray(data.messages) ? data.messages : [];

        this.hasMoreOlderHistory = true;
        this.hasMoreNewerHistory = false;
        this.isLoadingHistory = false;
    },

    /**
     * 更新当前登录用户资料
     * @param {object} profile
     */
    updateUserProfile(profile) {
        Object.assign(this.user, profile);
    },

    /**
     * 更新当前会话联系人的状态索引
     * @param {number} statusIndex
     */
    setContactStatus(statusIndex) {
        if (statusIndex !== undefined) {
            this.contact.statusIndex = statusIndex;
        }
    },

    /**
     * 尾部追加新消息（轮询或本地发送时调用，自动去重）
     * @param {Array<object>|object} newMsgs
     * @returns {boolean} 是否有实际新增
     */
    appendMessages(newMessages) {
        const messages = Array.isArray(newMessages)
            ? newMessages
            : [newMessages];

        const existingIds = new Set(
            this.messages.map(message => messageIdKey(message.id))
        );

        let hasNew = false;

        messages.forEach(message => {
            if (!message || message.id === undefined) return;

            const key = messageIdKey(message.id);
            if (existingIds.has(key)) return;

            this.messages.push(message);
            existingIds.add(key);
            hasNew = true;
        });

        return hasNew;
    },


    /**
     * 头部插入更旧的历史消息（向上滚动分页）
     * @param {Array<object>} olderMsgs
     */
    prependMessages(olderMessages) {
        if (!Array.isArray(olderMessages) || olderMessages.length === 0) {
            return false;
        }

        const existingIds = new Set(
            this.messages.map(message => messageIdKey(message.id))
        );

        const uniqueMessages = olderMessages.filter(message => {
            if (!message || message.id === undefined) return false;

            const key = messageIdKey(message.id);
            if (existingIds.has(key)) return false;

            existingIds.add(key);
            return true;
        });

        if (uniqueMessages.length === 0) return false;

        this.messages = [...uniqueMessages, ...this.messages];
        return true;
    },

    /**
     * 替换整个消息列表（进入历史断面跳转时使用）
     * @param {Array<object>} msgs
     */
    setMessages(msgs) {
        this.messages = Array.isArray(msgs) ? msgs : [];
    },

    /**
     * 批量删除消息
     * @param {Array<number>} ids
     */
    removeMessages(ids) {
        const idSet = new Set(
            ids
                .filter(id => id !== null && id !== undefined)
                .map(messageIdKey)
        );

        this.messages = this.messages.filter(message => {
            if (!message || message.id === null || message.id === undefined) {
                return true;
            }

            return !idSet.has(messageIdKey(message.id));
        });
    },

    /**
     * 新增或更新联系人列表中的某一项
     * @param {object} contact
     */
    upsertContact(contact) {
        const idx = this.contacts.findIndex(c => c.uuid === contact.uuid);
        if (idx !== -1) {
            this.contacts[idx] = { ...this.contacts[idx], ...contact };
        } else {
            this.contacts.push(contact);
        }
    },

    /**
     * 删除某个联系人
     * @param {string} uuid
     */
    removeContact(uuid) {
        this.contacts = this.contacts.filter(c => c.uuid !== uuid);
    },

    /* ==========================================================================
       查询与读取方法 (Getters / Queries)
       ========================================================================== */

    /**
     * 根据 UUID 查找联系人
     * @param {string} uuid
     * @returns {object|undefined}
     */
    getContactByUuid(uuid) {
        return this.contacts.find(c => c.uuid === uuid);
    },

    /**
     * 获取当前消息列表最后一条消息
     * @returns {object|null}
     */
    getLastMessage() {
        return this.messages.length > 0 ? this.messages[this.messages.length - 1] : null;
    },

    /**
     * 获取当前消息列表第一条消息
     * @returns {object|null}
     */
    getFirstMessage() {
        return this.messages.length > 0 ? this.messages[0] : null;
    }
};