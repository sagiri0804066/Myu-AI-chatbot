const DEFAULT_AVATAR_SVG = `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#E0E0E0"/><circle cx="50" cy="35" r="20" fill="#A0A0A0"/><path d="M20 85 C20 60 80 60 80 85" fill="#A0A0A0"/></svg>`;

// --- 状态与数据 ---
let db = {
    user: { nickname: "", avatar: null, org: "", gender: "", birthday: "", hobbies: "", background: "" },
    contact: { type: "P", nickname: "", avatar: null, statusIndex: 2, members: [] },
    contacts: [],
    messages: [],
};

const STATUS_LIST = ["🟢在线", "🟡忙碌", "🔴离线", "对方输入中...", ""];

let isLoadingHistory = false;
let hasMoreOlderHistory = true; // 是否还有更旧的历史
let hasMoreNewerHistory = false; // 是否还有更新的历史
let isLoadingNewer = false;
let hasMoreNewer = false;
let isPollingActive = false; // 标记当前是否正在运行轮询循环

// 记录上一条有效消息的时间戳
let lastMessageTime = 0;
const FIVE_MINUTES_MS = 5 * 60 * 1000; // 5分钟的毫秒数

document.addEventListener('DOMContentLoaded', () => {

    // HTML 转义辅助函数
    function escapeHTML(str) {
        if (!str) return '';
        return str.replace(/[&<>'"]/g,
            tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
        );
    }

    function formatTime(timestamp) {
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

    const netErrOut = document.getElementById('net-err-out');
    const netErrCode = document.getElementById('net-err-code');

    function setNetError(show, code = "") {
        netErrOut.style.display = show ? 'block' : 'none';
        if (show) netErrCode.innerText = code;
    }

    async function poll() {
        // 1. 如果在浏览历史断面，直接退出，暂停所有网络请求
        if (hasMoreNewerHistory) {
            isPollingActive = false;
            console.error("正在浏览历史记录");
            return;
        }

        // 2. 如果当前已经有一个活跃的轮询在执行，避免重复启动
        if (isPollingActive) {
            console.error("已有活跃游标");
            return;
        }
        isPollingActive = true;

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 35000);

        // 用于延时消除错误的定时器句柄
        let clearErrorTimer = null;

        try {
            const lastMsg = db.messages[db.messages.length - 1];
            const cursor = lastMsg ? lastMsg.id : 0;

            // 如果 2.5 秒内连接未断开，说明长轮询已经成功建立并挂起，此时再消除错误提示
            clearErrorTimer = setTimeout(() => {
                setNetError(false);
            }, 2500);

            const res = await fetch(`/api/message/poll?cursor=${cursor}`, {
                signal: controller.signal
            });

            clearTimeout(timeoutId);
            clearTimeout(clearErrorTimer); // 请求已响应，清除延时定时器

            if (!res.ok) {
                setNetError(true, res.status);
                isPollingActive = false;
                setTimeout(poll, 10000);
                return;
            }

            // 明确返回 200 OK，清除网络错误
            setNetError(false);

            const data = await res.json();

            let hasChange = false;
            if (data.statusIndex !== undefined && data.statusIndex !== db.contact.statusIndex) {
                db.contact.statusIndex = data.statusIndex;
                hasChange = true;
            }

            if (data.messages && data.messages.length > 0) {
                data.messages.forEach(newMsg => {
                    if (!db.messages.find(m => m.id === newMsg.id)) {
                        db.messages.push(newMsg);
                        hasChange = true;
                    }
                });
            }

            if (hasChange) render();

            isPollingActive = false;

            poll();

        } catch (e) {
            clearTimeout(timeoutId);
            clearTimeout(clearErrorTimer); // 报错时立刻取消清除定时器，防止误消除错误

            const errName = (e.name === 'AbortError') ? "超时" : "断开";
            setNetError(true, errName);
            isPollingActive = false;

            setTimeout(poll, 10000);
        }
    }

    async function initChat() {
        try {
            const res = await fetch('/api/message/init');

            if (!res.ok) {
                setNetError(true, res.status);
                console.error("初始化接口返回错误:", res.status);
                setTimeout(initChat, 10000);
                return;
            }

            const data = await res.json();
            setNetError(false);
            if (data.user) {
                Object.assign(db.user, data.user);
            }

            if (data.contact) {
                if (!db.contact) db.contact = {};
                db.contact.type = data.contact.type || "P";
                db.contact.nickname = data.contact.nickname;
                db.contact.avatar = data.contact.avatar;
                db.contact.members = data.contact.members || [];
            }
            db.contact.statusIndex = data.statusIndex || 0;

            db.contacts = data.contacts || [];
            db.messages = data.messages || [];

            render();
            poll();

        } catch (error) {
            setNetError(true, "断开");
            console.error("初始化网络异常:", error);
            setTimeout(initChat, 10000);
        }
    }

    const chatContainer = document.getElementById('chat-container');
    const msgInput = document.getElementById('msg-input');
    const statusText = document.getElementById('status-indicator');
    const displayName = document.getElementById('display-name');
    const avatarInput = document.getElementById('avatar-input');
    const avatarPreview = document.getElementById('avatar-preview-target');

    async function loadHistory(direction = "older") {
        if (isLoadingHistory || db.messages.length === 0) return;

        // 根据滚动方向判断是否需要继续加载
        if (direction === "older" && !hasMoreOlderHistory) return;
        if (direction === "newer" && !hasMoreNewerHistory) return;

        isLoadingHistory = true;
        const oldScrollHeight = chatContainer.scrollHeight;
        const oldScrollTop = chatContainer.scrollTop;

        // 根据方向决定使用第一个还是最后一个消息ID作为游标
        const cursor = direction === "older" ? db.messages[0].id : db.messages[db.messages.length - 1].id;

        try {
            const res = await fetch(`/api/message/history?cursor=${cursor}&direction=${direction}&limit=20`);
            if (!res.ok) throw new Error("获取历史记录失败");

            const data = await res.json();
            const limit = 20;

            if (data.messages && data.messages.length > 0) {
                if (direction === "older") {
                    // 向上滚动：数据合并到头部
                    db.messages = [...data.messages, ...db.messages];
                    render({ isHistory: true });

                    // 保持原滚动视图位置
                    const newScrollHeight = chatContainer.scrollHeight;
                    chatContainer.scrollTop = newScrollHeight - oldScrollHeight;

                    if (data.messages.length < limit) {
                        hasMoreOlderHistory = false;
                    }
                } else {
                    // 向下滚动：数据合并到尾部
                    db.messages = [...db.messages, ...data.messages];
                    render({ isHistory: true });

                    if (data.messages.length < limit) {
                        hasMoreNewerHistory = false;
                        poll();
                    }
                }
            } else {
                if (direction === "older") hasMoreOlderHistory = false;
                if (direction === "newer") hasMoreNewerHistory = false;
                render({ isHistory: true });
            }
        } catch (e) {
            console.error(e);
        } finally {
            isLoadingHistory = false;
        }
    }

    // 将文本中的 @[昵称]{uuid} 解析为发送时的昵称
    function parseMentions(escapedText) {
        if (!escapedText) return "";
        return escapedText.replace(/@\[([^\]]+)\]\{([a-zA-Z0-9-]+)\}/g, (match, nickname, uuid) => {
            return `<span class="mention-log-tag">@${nickname}</span>`;
        });
    }



    // 1. 渲染聊天界面
    function render(options = { isHistory: false }) {
        displayName.innerText = db.contact.nickname || "载入中...";

        if (db.contact.type === "G") {
            const memberCount = db.contact.members ? db.contact.members.length : 0;
            statusText.innerText = `群聊 (${memberCount + 1} 人)`;
        } else {
            statusText.innerText = STATUS_LIST[db.contact.statusIndex] || STATUS_LIST[0];
        }

        chatContainer.innerHTML = '';

        if (!hasMoreOlderHistory && db.messages.length > 0) {
            chatContainer.innerHTML += `<div class="time-tag"><span>没有更多历史记录了</span></div>`;
        }

        db.messages.forEach((m, idx) => {
            if (!m || !m.text) return;

            const currentTimestamp = Number(m.id) || (m.time ? new Date(m.time).getTime() : null);
            if (!currentTimestamp) {
                console.warn(`消息 ID ${m.id} 缺少有效的时间戳，跳过时间显示计算`);
                return;
            }
            // 上一条 vs 下一条
            // 判断当前消息与上一条有效消息的时间差是否大于 5 分钟
            if (lastMessageTime === 0 || (currentTimestamp - lastMessageTime) > FIVE_MINUTES_MS) {
                // 下一条 vs 现在
                // 将“下一条的时间戳”传入 formatTime，在里面与 new Date()（现在）对比，决定格式
                const timeStr = formatTime(currentTimestamp);

                chatContainer.innerHTML += `<div class="time-tag"><span>${timeStr}</span></div>`;
            }
            // 更新“上一条”的时间戳，供下一个循环（即下下一条）对比使用
            lastMessageTime = currentTimestamp;

            const isMe = m.role === 'user';
            let avatarData = null;
            let nameHeaderHtml = '';

            if (isMe) {
                avatarData = db.user.avatar;
            } else {
                if (db.contact.type === "G" && m.sender_uuid) {
                    const sender = db.contacts.find(c => c.uuid === m.sender_uuid);
                    if (sender) {
                        avatarData = sender.avatar;
                        nameHeaderHtml = `<div class="sender-name-tag" style="font-size:11px; color:#888; margin-bottom:4px; padding-left:4px;">${escapeHTML(sender.nickname)}</div>`;
                    } else {
                        avatarData = db.contact.avatar;
                    }
                } else {
                    avatarData = db.contact.avatar;
                }
            }

            const row = document.createElement('div');
            row.className = `msg-row ${isMe ? 'me' : 'other'}`;
            row.dataset.id = m.id;

            // 1. 进行基础 HTML 安全转义
            const escapedText = escapeHTML(m.text || "");
            // 2. 将其中的 @[昵称]{uuid} 直接还原为带有样式的历史昵称标签
            const parsedText = parseMentions(escapedText);

            row.innerHTML = `
                <div class="checkbox-area"><input type="checkbox" class="msg-check"></div>
                <div class="msg-content">
                    <div class="avatar-box">
                        ${avatarData ? `<img src="${avatarData}" onerror="this.style.display='none'">` : DEFAULT_AVATAR_SVG}
                    </div>
                    <div style="display: flex; flex-direction: column;">
                        ${nameHeaderHtml}
                        <div class="bubble">${parsedText.replace(/\n/g, '<br>')}</div>
                    </div>
                </div>
            `;
            chatContainer.appendChild(row);
        });

        if (!options.isHistory) {
            requestAnimationFrame(() => {
                chatContainer.scrollTop = chatContainer.scrollHeight;
            });
        }
    }

    // 2.1提取输入框内容
    function serializeContent(container) {
        let text = "";
        container.childNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE) {
                text += node.textContent;
            } else if (node.nodeType === Node.ELEMENT_NODE) {
                if (node.classList.contains('mention-tag')) {
                    if (node.dataset.uuid) {
                        // 提取标签中的名字部分（去掉前缀 @ 符号）
                        const nameOnly = node.textContent.replace(/^@/, '');
                        // 序列化为双绑定格式：@[昵称]{uuid}
                        text += `@[${nameOnly}]{${node.dataset.uuid}}`;
                    } else {
                        text += node.textContent; // @所有人
                    }
                } else if (node.tagName === 'BR') {
                    text += '\n';
                } else {
                    text += node.textContent;
                }
            }
        });
        return text.trim();
    }

    const mentionPopover = document.getElementById('mention-popover');
    const mentionList = document.getElementById('mention-list');

    function hideMentionPopover() {
        if (mentionPopover) mentionPopover.style.display = 'none';
    }

    function showMentionPopover() {
        if (!mentionPopover || !mentionList) return;
        mentionList.innerHTML = '';

        // 首位@所有人 选项
        const allItem = document.createElement('div');
        allItem.className = 'mention-item';
        const groupAvatar = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' fill='%2307c160'><rect width='100' height='100'/><path d='M35 40h10l15-15v50L45 60H35V40zM70 35a20 20 0 0 1 0 30' stroke='white' stroke-width='6' stroke-linecap='round' fill='none'/></svg>";
        allItem.innerHTML = `
            <img class="mention-avatar" src="${groupAvatar}">
            <span class="mention-name">所有人</span>
        `;

        // 传入 null 作为 uuid，名称为 "所有人"
        allItem.addEventListener('mousedown', (e) => {
            e.stopPropagation();
            e.preventDefault();
            insertMentionTag(null, "所有人"); // 不传 UUID
            hideMentionPopover();
        });

        mentionList.appendChild(allItem);

        // 群成员加载逻辑
        const memberUuids = db.contact.members || [];
        const listToRender = db.contacts.filter(c => memberUuids.includes(c.uuid));

        if (listToRender.length === 0 && memberUuids.length === 0) {
            hideMentionPopover();
            return;
        }

        const defaultAvatar = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="%23ddd"><rect width="100" height="100"/><circle cx="50" cy="40" r="20" fill="%23999"/><path d="M20 90c0-15 10-25 30-25s30 10 30 25z" fill="%23999"/></svg>`;

        listToRender.forEach(member => {
            const item = document.createElement('div');
            item.className = 'mention-item';

            const avatarSrc = member.avatar || defaultAvatar;
            item.innerHTML = `
                <img class="mention-avatar" src="${avatarSrc}">
                <span class="mention-name">${escapeHTML(member.nickname)}</span>
            `;

            // 改用 mousedown 阻止输入框失焦
            item.addEventListener('mousedown', (e) => {
                e.stopPropagation();
                e.preventDefault();
                insertMentionTag(member.uuid, member.nickname);
                hideMentionPopover();
            });

            mentionList.appendChild(item);
        });

        mentionPopover.style.display = 'block';
    }

    // 将选中的联系人转化为 contenteditable="false" 的内联块插入
    function insertMentionTag(uuid, name) {
        msgInput.focus();
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);
        const node = range.startContainer;

        let targetNode = node;
        let offset = range.startOffset;

        // 如果光标在父级元素节点上，定位到包含 @ 的实际文本子节点
        if (targetNode.nodeType === Node.ELEMENT_NODE) {
            const anchorNode = selection.anchorNode;
            if (anchorNode && anchorNode.nodeType === Node.TEXT_NODE) {
                targetNode = anchorNode;
                offset = selection.anchorOffset;
            } else if (targetNode.childNodes.length > 0) {
                // 如果没有活动文本选区，从元素子节点中寻找可能包含 @ 的文本节点
                const child = targetNode.childNodes[Math.max(0, offset - 1)];
                if (child && child.nodeType === Node.TEXT_NODE) {
                    targetNode = child;
                    offset = child.textContent.length;
                }
            }
        }

        // 清除手动输入的 '@' 字符
        if (targetNode && targetNode.nodeType === Node.TEXT_NODE) {
            const text = targetNode.textContent;
            const index = text.lastIndexOf('@', offset - 1);
            if (index !== -1) {
                range.setStart(targetNode, index);
                range.setEnd(targetNode, offset);
                range.deleteContents();
            }
        }

        // 创建不可编辑的 mention span
        const span = document.createElement('span');
        span.className = 'mention-tag';

        // 仅在 uuid 有值时赋值 uuid，如果是“所有人”则跳过
        if (uuid) {
            span.dataset.uuid = uuid;
        }

        span.contentEditable = 'false'; // 设为不可编辑，删除时会当作一整个标签整体删掉
        span.innerText = `@${name}`;

        // 创建一个空格，确保光标跳出 span 后可以正常输入
        const spaceNode = document.createTextNode('\u00A0');

        range.insertNode(spaceNode);
        range.insertNode(span);

        // 将光标定位在空格之后
        range.setStartAfter(spaceNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    // 检查光标前的输入字符，判断是否需要弹出列表
    function checkMentionTrigger() {
        if (db.contact.type !== "G") {
            hideMentionPopover();
            return;
        }

        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) {
            hideMentionPopover();
            return;
        }

        const range = selection.getRangeAt(0);
        const node = range.startContainer;

        let textValue = "";
        let caretOffset = 0;

        // 1. 如果光标在文本节点上
        if (node.nodeType === Node.TEXT_NODE) {
            textValue = node.textContent;
            caretOffset = range.startOffset;
        }
        // 2. 如果输入框为空并刚打入第一个字符，浏览器可能将光标判定在元素节点（ELEMENT_NODE）上
        else if (node.nodeType === Node.ELEMENT_NODE) {
            textValue = node.textContent || "";
            // 如果节点是输入框本身，取其第一个子节点的文本，或者直接兜底取整个文本
            const selectionText = selection.anchorNode ? selection.anchorNode.textContent : "";
            textValue = selectionText || msgInput.textContent || "";
            caretOffset = selection.anchorOffset !== undefined ? selection.anchorOffset : textValue.length;
        }

        const textBeforeCaret = textValue.substring(0, caretOffset);

        // 当且仅当光标前的最后一个字符为 '@' 时触发
        if (textBeforeCaret.endsWith('@')) {
            showMentionPopover();
            return;
        }
        hideMentionPopover();
    }

    // 将选中的联系人转化为 contenteditable="false" 的内联块插入
    function insertMentionTag(uuid, name) {
        msgInput.focus();
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0);
        const node = range.startContainer;

        // 清除手动输入的 '@' 字符（自动去掉原本的 @ 符号）
        if (node.nodeType === Node.TEXT_NODE) {
            const offset = range.startOffset;
            const text = node.textContent;
            const index = text.lastIndexOf('@', offset - 1);
            if (index !== -1) {
                range.setStart(node, index);
                range.setEnd(node, offset);
                range.deleteContents();
            }
        }

        // 创建不可编辑的 mention span
        const span = document.createElement('span');
        span.className = 'mention-tag';

        // 仅在 uuid 有值（如单人提及）时赋值 uuid，如果是“所有人”则跳过
        if (uuid) {
            span.dataset.uuid = uuid;
        }

        span.contentEditable = 'false'; // 设为不可编辑，删除时会当作一整个标签整体删掉
        span.innerText = `@${name}`;

        // 创建一个空格，确保光标跳出 span 后可以正常输入
        const spaceNode = document.createTextNode('\u00A0');

        range.insertNode(spaceNode);
        range.insertNode(span);

        // 将光标定位在空格之后
        range.setStartAfter(spaceNode);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
    }

    msgInput.addEventListener('input', () => {
        checkMentionTrigger();
        sendInterruptSignal();
    });
    msgInput.addEventListener('keyup', (e) => {
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Escape') {
            hideMentionPopover();
        }
    });

    // 点击空白处关闭弹窗
    document.addEventListener('click', (e) => {
        if (mentionPopover && !mentionPopover.contains(e.target) && e.target !== msgInput) {
            hideMentionPopover();
        }
    });

    // 2.2 发送消息
    async function sendMessage() {
        // 获取序列化后的文本（如 "你好 @{uuid-123456}"）
        const text = serializeContent(msgInput);
        if (!text) return;

        const msgTime = Date.now();

        // 写入本地数据以进行渲染
        db.messages.push({
            id: msgTime,
            role: "user",
            text: text,
            time: ""
        });

        render();

        msgInput.innerHTML = '';

        try {
            const res = await fetch('/api/message/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: text,
                    time: msgTime
                })
            });

            if (res.ok) {
                const data = await res.json();
                const targetMsg = db.messages.find(m => m.id === msgTime);
                if (targetMsg && data.time) {
                    targetMsg.time = data.time;
                }

                if (hasMoreNewerHistory) {
                    hasMoreNewerHistory = false;
                    hasMoreOlderHistory = true;
                    isLoadingHistory = false;
                    initChat();
                    return;
                }
            }
        } catch (error) {
            console.error("消息发送失败:", error);
        }
    }
    // 2.3. 节流辅助函数和打断请求逻辑
    function throttle(func, limit) {
        let inThrottle;
        return function () {
            const args = arguments;
            const context = this;
            if (!inThrottle) {
                func.apply(context, args);
                inThrottle = true;
                setTimeout(() => inThrottle = false, limit);
            }
        }
    }

    // 限制 2.5 秒内至多请求一次打断 API
    const sendInterruptSignal = throttle(async () => {
        try {
            await fetch('/api/message/interrupt');
        } catch (e) {
            console.error("失败:", e);
        }
    }, 2500);

    // 3. 个人信息面板 
    const modal = document.getElementById('modal-overlay');
    document.getElementById('btn-open-profile').onclick = () => {
        document.getElementById('edit-nickname').value = db.user.nickname;
        document.getElementById('edit-org').value = db.user.org;
        document.getElementById('edit-birthday').value = db.user.birthday;
        document.getElementById('edit-hobbies').value = db.user.hobbies;
        document.getElementById('edit-gender').value = db.user.gender;

        if (db.user.avatar) {
            avatarPreview.innerHTML = `<img src="${db.user.avatar}"><div class="plus-overlay">+</div>`;
        } else {
            avatarPreview.innerHTML = `<div class="plus-overlay">+</div>`;
        }
        modal.style.display = 'flex';
    };

    document.getElementById('btn-modal-close').onclick = () => modal.style.display = 'none';

    avatarPreview.onclick = () => avatarInput.click();
    avatarInput.onchange = (e) => {
        const file = e.target.files[0];
        if (file) {
            if (file.size > 32 * 8192 * 8192) {
                return alert("头像图片不能超过 32MB");
            }
            const reader = new FileReader();
            reader.onload = (event) => {
                const base64 = event.target.result;
                avatarPreview.innerHTML = `<img src="${base64}"><div class="plus-overlay">+</div>`;
                db.user.avatar = base64;
                render();
            };
            reader.readAsDataURL(file);
        }
    };

    document.getElementById('btn-modal-save').onclick = async () => {
        const updatedProfile = {
            nickname: document.getElementById('edit-nickname').value,
            org: document.getElementById('edit-org').value,
            birthday: document.getElementById('edit-birthday').value,
            hobbies: document.getElementById('edit-hobbies').value,
            gender: document.getElementById('edit-gender').value,
            avatar: db.user.avatar
        };

        Object.assign(db.user, updatedProfile);
        modal.style.display = 'none';
        render();
        try {
            await fetch('/api/message/user/profile', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(updatedProfile)
            });
            console.log("配置已保存到本地后端");
        } catch (error) {
            console.error("保存失败:", error);
        }
    };

    // 4. 删除逻辑
    let deleteStage = 1;
    const btnConfirm = document.getElementById('btn-edit-confirm');

    function toggleEditMode(show) {
        document.getElementById('ui-normal').style.display = show ? 'none' : 'flex';
        document.getElementById('ui-edit').style.display = show ? 'flex' : 'none';
        chatContainer.classList.toggle('edit-mode', show);
        deleteStage = 1;
        btnConfirm.innerText = "删除选中";
        btnConfirm.classList.remove('stage-2');
    }

    document.getElementById('btn-desktop-edit').onclick = () => toggleEditMode(true);
    document.getElementById('btn-mobile-edit').onclick = () => {
        toggleEditMode(true);
        document.getElementById('mobile-plus-menu').style.display = 'none';
    };
    document.getElementById('btn-edit-cancel').onclick = () => toggleEditMode(false);

    btnConfirm.onclick = () => {
        const checked = document.querySelectorAll('.msg-check:checked');

        if (deleteStage === 1) {
            deleteStage = 2;
            btnConfirm.innerText = "确定要删除吗？";
            btnConfirm.classList.add('stage-2');
        } else {
            const idsToDelete = Array.from(checked).map(c => parseInt(c.closest('.msg-row').dataset.id));
            if (idsToDelete.length === 0) return;

            db.messages = db.messages.filter(m => !idsToDelete.includes(m.id));
            toggleEditMode(false);
            render();

            fetch('/api/message/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ids: idsToDelete })
            }).then(res => {
                if (!res.ok) console.warn("后台删除失败");
            }).catch(e => {
                console.error("网络异常，删除请求未送达");
            });
        }
    };

    // 5. 基础交互
    document.getElementById('btn-send').onclick = sendMessage;
    msgInput.onkeydown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey && window.innerWidth > 767) {
            e.preventDefault(); sendMessage();
        }
    };

    document.getElementById('mobile-plus-btn').onclick = (e) => {
        e.stopPropagation();
        const menu = document.getElementById('mobile-plus-menu');
        menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
    };
    document.onclick = (e) => {
        if (!e.target.closest('.plus-menu') && !e.target.closest('.plus-btn-circle')) {
            document.getElementById('mobile-plus-menu').style.display = 'none';
        }
    };

    // 6. 高度拖拽
    let isResizing = false;
    document.getElementById('drag-handle').onmousedown = () => isResizing = true;
    document.onmousemove = (e) => {
        if (!isResizing) return;
        let h = window.innerHeight - e.clientY;
        if (h > 100 && h < window.innerHeight * 0.7) {
            document.getElementById('input-section').style.height = h + 'px';
        }
    };
    document.onmouseup = () => isResizing = false;

    chatContainer.addEventListener('scroll', () => {
        // 1. 触顶加载更旧的历史消息
        if (chatContainer.scrollTop < 30) {
            loadHistory("older");
        }

        // 2. 触底加载更新的历史消息（仅在跳转至历史断面、且下方还有数据时触发）
        const scrollBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;
        if (scrollBottom < 30 && hasMoreNewerHistory) {
            loadHistory("newer");
        }
    });

    // ================== 联系人管理系统 ==================
    (function () {
        const DEFAULT_CONTACT_AVATAR = `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="%23ddd"><rect width="100" height="100"/><circle cx="50" cy="40" r="20" fill="%23999"/><path d="M20 90c0-15 10-25 30-25s30 10 30 25z" fill="%23999"/></svg>`;

        let currentEditingContactUuid = null;
        let tempContactAvatarBase64 = '';

        // 获取相关节点
        const btnContacts = document.getElementById('btn-contacts');
        const contactsModal = document.getElementById('contacts-modal');
        const btnContactsClose = document.getElementById('btn-contacts-close');
        const btnContactAdd = document.getElementById('btn-contact-add');
        const contactList = document.getElementById('contact-list');

        const contactEditModal = document.getElementById('contact-edit-modal');
        const btnContactEditBack = document.getElementById('btn-contact-edit-back');
        const contactEditTitle = document.getElementById('contact-edit-title');
        const typeSelectContainer = document.getElementById('type-select-container'); // 类型父容器
        const contactEditType = document.getElementById('contact-edit-type');
        const contactEditNickname = document.getElementById('contact-edit-nickname');
        const contactEditDetails = document.getElementById('contact-edit-details');

        const groupMembersArea = document.getElementById('group-members-area');
        const membersDetails = document.getElementById('members-details');
        const selectedMembersCount = document.getElementById('selected-members-count');
        const groupMembersChecklist = document.getElementById('group-members-checklist');

        const lblNickname = document.getElementById('lbl-contact-nickname');
        const lblDetails = document.getElementById('lbl-contact-details');
        const btnContactSave = document.getElementById('btn-contact-save');

        const contactAvatarInput = document.getElementById('contact-avatar-input');
        const contactAvatarPreview = document.getElementById('contact-avatar-preview-target');

        // 动态展示/隐藏群成员选项并调整标签
        function toggleGroupFields(type) {
            if (type === 'G') {
                groupMembersArea.style.display = 'block';
                lblNickname.textContent = '群聊名称';
                lblDetails.textContent = '群聊描述';
                contactEditDetails.setAttribute('placeholder', '请输入群聊描述信息...');
            } else {
                groupMembersArea.style.display = 'none';
                lblNickname.textContent = '昵称';
                lblDetails.textContent = '详细信息';
                contactEditDetails.setAttribute('placeholder', '请输入联系人详细信息...');
            }
        }

        // 刷新群成员已选择人数标签
        function updateSelectedCount() {
            const checkedBoxes = groupMembersChecklist.querySelectorAll('.member-checkbox:checked');
            selectedMembersCount.textContent = `(已选 ${checkedBoxes.length} 人)`;
        }

        // 读取数据库中的 P 类型联系人，渲染为可视化 Checkbox 复选框列表
        function renderGroupMembersChecklist(selectedUuids = []) {
            groupMembersChecklist.innerHTML = '';

            // 过滤出所有单聊(P)好友
            const privateContacts = db.contacts.filter(c => c.type === 'P' || !c.type);

            if (privateContacts.length === 0) {
                groupMembersChecklist.innerHTML = '<div style="color: #999; font-size: 13px; text-align: center; padding: 15px 0;">暂无可添加的联系人</div>';
                selectedMembersCount.textContent = `(已选 0 人)`;
                return;
            }

            privateContacts.forEach(c => {
                const isChecked = selectedUuids.includes(c.uuid);
                const itemDiv = document.createElement('div');
                itemDiv.style.cssText = 'display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid #f5f5f5;';

                const avatarSrc = c.avatar || DEFAULT_CONTACT_AVATAR;

                itemDiv.innerHTML = `
                    <input type="checkbox" class="member-checkbox" value="${c.uuid}" ${isChecked ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px; flex-shrink: 0;">
                    <img src="${avatarSrc}" style="width: 30px; height: 30px; border-radius: 4px; object-fit: cover; flex-shrink: 0;">
                    <span style="font-size: 14px; color: #333; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHTML(c.nickname)}</span>
                `;

                // 监听勾选状态改变并同步更新人数标签
                itemDiv.querySelector('.member-checkbox').addEventListener('change', updateSelectedCount);
                groupMembersChecklist.appendChild(itemDiv);
            });

            updateSelectedCount();
        }

        contactEditType.addEventListener('change', (e) => {
            toggleGroupFields(e.target.value);
        });

        // 1. 展现联系人列表弹窗
        btnContacts.addEventListener('click', () => {
            contactsModal.style.display = 'flex';
            renderContacts();
        });

        // 2. 关闭联系人列表弹窗
        btnContactsClose.addEventListener('click', () => {
            contactsModal.style.display = 'none';
        });

        // 3. 点击加号打开新增联系人窗口
        btnContactAdd.addEventListener('click', () => {
            currentEditingContactUuid = null;
            tempContactAvatarBase64 = '';
            contactEditTitle.textContent = '新增联系人';

            // 新增好友：展示选择单聊还是群聊
            typeSelectContainer.style.display = 'block';
            contactEditType.value = 'P';
            toggleGroupFields('P');

            contactEditNickname.value = '';
            contactEditDetails.value = '';

            // 折叠折叠盒，并初始化空勾选列表
            membersDetails.removeAttribute('open');
            renderGroupMembersChecklist([]);

            contactAvatarPreview.innerHTML = `<div class="plus-overlay">+</div>`;

            contactsModal.style.display = 'none';
            contactEditModal.style.display = 'flex';
        });

        // 4. 点击新增/修改窗口左上角返回按钮
        btnContactEditBack.addEventListener('click', () => {
            contactEditModal.style.display = 'none';
            contactsModal.style.display = 'flex';
        });

        // 5. 联系人头像本地上传读取
        contactAvatarPreview.addEventListener('click', () => {
            contactAvatarInput.click();
        });

        contactAvatarInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    tempContactAvatarBase64 = event.target.result;
                    contactAvatarPreview.innerHTML = `
                        <img src="${tempContactAvatarBase64}" alt="avatar">
                        <div class="plus-overlay">+</div>
                    `;
                };
                reader.readAsDataURL(file);
            }
        });

        // 6. 保存联系人数据 (新增 / 确认修改)
        btnContactSave.addEventListener('click', async () => {
            const typeVal = contactEditType.value;
            const nameVal = contactEditNickname.value.trim();
            const detailsVal = contactEditDetails.value.trim();
            let membersArr = [];

            if (!nameVal) {
                contactEditNickname.focus();
                return;
            }

            // 如果是群聊类型，自动抓取所有被勾选复选框的 UUID
            if (typeVal === 'G') {
                const checkedBoxes = groupMembersChecklist.querySelectorAll('.member-checkbox:checked');
                membersArr = Array.from(checkedBoxes).map(cb => cb.value);
            }

            btnContactSave.disabled = true;

            try {
                if (currentEditingContactUuid === null) {
                    // 新增联系人
                    const result = await apiEditContact("new", typeVal, nameVal, tempContactAvatarBase64 || null, detailsVal, membersArr);
                    db.contacts.push({
                        uuid: result.uuid,
                        type: typeVal,
                        nickname: nameVal,
                        avatar: tempContactAvatarBase64 || null,
                        card_data: detailsVal,
                        members: membersArr
                    });
                } else {
                    // 修改联系人
                    await apiEditContact(currentEditingContactUuid, typeVal, nameVal, tempContactAvatarBase64 || null, detailsVal, membersArr);
                    const contact = db.contacts.find(c => c.uuid === currentEditingContactUuid);
                    if (contact) {
                        contact.type = typeVal;
                        contact.nickname = nameVal;
                        contact.card_data = detailsVal;
                        contact.members = membersArr;
                        if (tempContactAvatarBase64) {
                            contact.avatar = tempContactAvatarBase64;
                        }
                    }
                    await apiSwitchContact(currentEditingContactUuid);
                    window.location.reload();
                }

                contactEditModal.style.display = 'none';
                contactsModal.style.display = 'flex';
                renderContacts();
            } catch (err) {
                console.error("保存联系人失败:", err);
            } finally {
                btnContactSave.disabled = false;
            }
        });

        // 7. 渲染联系人列表项
        function renderContacts() {
            contactList.innerHTML = '';
            const listToRender = db.contacts || [];

            listToRender.forEach(contact => {
                const item = document.createElement('div');
                item.className = 'contact-item';

                const avatarSrc = contact.avatar || DEFAULT_CONTACT_AVATAR;
                const typeBadge = contact.type === "G" ? `<span style="background: #e1f5fe; color: #039be5; font-size:10px; padding:2px 4px; border-radius:4px; margin-right:4px;">群</span>` : "";

                item.innerHTML = `
                    <div class="contact-avatar">
                        <img src="${avatarSrc}" alt="avatar">
                    </div>
                    <div class="contact-info">
                        <div class="contact-name">${typeBadge}${escapeHTML(contact.nickname)}</div>
                        <div class="contact-details">${escapeHTML(contact.card_data || '')}</div>
                    </div>
                    <div class="contact-actions">
                        <div class="contact-action-btn chat-btn" data-uuid="${contact.uuid}">
                            <svg t="1779562001970" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="10935" width="18" height="18">
                                <path d="M930.503111 1019.448889a43.804444 43.804444 0 0 1-22.528-6.257778l-190.236444-113.749333A576.540444 576.540444 0 0 1 512 936.618667c-282.311111 0-512-198.343111-512-442.140445C0 250.680889 229.688889 52.337778 512 52.337778s512 198.343111 512 442.140444c0 107.576889-44.145778 209.294222-125.041778 289.649778l72.334222 173.368889c7.395556 17.749333 2.673778 38.286222-11.690666 50.944-8.248889 7.281778-18.631111 11.008-29.098667 11.008z" fill="#000000"></path>
                            </svg>
                        </div>
                        <div class="contact-action-btn edit-btn" data-uuid="${contact.uuid}">
                            <svg t="1779558880431" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="7697" width="18" height="18">
                                <path d="M550.4 292.48l180.992 180.992-422.4 422.4H128v-181.034667l422.4-422.4z m60.330667-60.373333l90.496-90.496a42.666667 42.666667 0 0 1 60.330666 0l120.704 120.661333a42.666667 42.666667 0 0 1 0 60.373333l-90.538666 90.496-180.992-181.034666z" fill="#000000"></path>
                            </svg>
                        </div>
                        <div class="contact-action-btn delete-btn" data-uuid="${contact.uuid}">
                            <svg t="1779558902630" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="8874" width="18" height="18">
                                <path d="M380.565633 84.168898C391.492953 73.241577 412.883938 64.383234 428.328892 64.383234L596.182087 64.383234C611.633685 64.383234 633.010015 73.233567 643.945345 84.168898L680.111776 120.335329 344.399202 120.335329 380.565633 84.168898ZM875.944112 176.287425C891.394856 176.287425 903.92016 163.762122 903.92016 148.311377 903.92016 132.860633 891.394856 120.335329 875.944112 120.335329L148.566866 120.335329C133.116122 120.335329 120.590818 132.860633 120.590818 148.311377 120.590818 163.762122 133.116122 176.287425 148.566866 176.287425L875.944112 176.287425ZM180.539492 232.239521 180.254748 228.253099 228.640985 176.287425 232.637564 176.287425 280.347765 844.230242C282.63628 876.269454 312.053012 903.664671 344.377659 903.664671L680.133319 903.664671C712.845805 903.664671 741.848496 876.636282 744.163214 844.230242L791.873414 176.287425 795.869993 176.287425 844.25623 228.253099 843.971486 232.239521 180.539492 232.239521ZM847.968064 176.287425 799.973118 848.216664C795.578506 909.741242 742.362215 959.616766 680.133319 959.616766L344.377659 959.616766C282.586578 959.616766 228.909839 909.424372 224.53786 848.216664L176.542914 176.287425 847.968064 176.287425ZM484.279441 763.784431C484.279441 779.235176 496.804744 791.760479 512.255489 791.760479 527.706234 791.760479 540.231537 779.235176 540.231537 763.784431L540.231537 372.11976C540.231537 356.669016 527.706234 344.143713 512.255489 344.143713 496.804744 344.143713 484.279441 356.669016 484.279441 372.11976L484.279441 763.784431ZM607.198225 760.600957C605.851604 775.992907 617.237593 789.562199 632.629543 790.908821 648.021493 792.255442 661.590785 780.869453 662.937406 765.477503L697.073232 375.303235C698.419853 359.911285 687.033864 346.341992 671.641914 344.995371 656.249965 343.64875 642.680672 355.034739 641.334051 370.426688L607.198225 760.600957ZM361.573572 765.477503C362.920193 780.869453 376.489486 792.255442 391.881435 790.908821 407.273385 789.562199 418.659374 775.992907 417.312753 760.600957L383.176927 370.426688C381.830306 355.034739 368.261013 343.64875 352.869064 344.995371 337.477114 346.341992 326.091125 359.911285 327.437746 375.303235L361.573572 765.477503Z" fill="#FC5143"></path>
                            </svg>
                        </div>
                    </div>
                `;

                item.querySelector('.chat-btn').addEventListener('click', async (e) => {
                    e.stopPropagation();
                    try {
                        await apiSwitchContact(contact.uuid);
                        window.location.reload();
                    } catch (err) {
                        console.error("切换联系人失败:", err);
                    }
                });

                item.querySelector('.edit-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    openEditContact(contact.uuid);
                });

                item.querySelector('.delete-btn').addEventListener('click', (e) => {
                    e.stopPropagation();
                    deleteContact(contact.uuid);
                });

                contactList.appendChild(item);
            });
        }

        // 8. 开启修改模式并载入数据
        function openEditContact(uuid) {
            const contact = db.contacts.find(c => c.uuid === uuid);
            if (!contact) return;

            currentEditingContactUuid = uuid;
            tempContactAvatarBase64 = contact.avatar || '';
            contactEditTitle.textContent = '修改联系人';

            // 修改时，隐藏单聊/群聊选项面板，防止中途篡改基本类型
            typeSelectContainer.style.display = 'none';

            const contactType = contact.type || 'P';
            contactEditType.value = contactType;
            toggleGroupFields(contactType);

            contactEditNickname.value = contact.nickname;
            contactEditDetails.value = contact.card_data || '';

            // 确保折叠控件重置为折叠状态
            membersDetails.removeAttribute('open');

            // 传入已有群成员以填充复选状态
            renderGroupMembersChecklist(contact.members || []);

            if (contact.avatar) {
                contactAvatarPreview.innerHTML = `
                    <img src="${contact.avatar}" alt="avatar">
                    <div class="plus-overlay">+</div>
                `;
            } else {
                contactAvatarPreview.innerHTML = `<div class="plus-overlay">+</div>`;
            }

            contactsModal.style.display = 'none';
            contactEditModal.style.display = 'flex';
        }

        // 9. 删除联系人方法
        async function deleteContact(uuid) {
            showCustomConfirm("您确认要删除该联系人吗？此操作将永久抹除其对应的数据库文件且无法找回。", async () => {
                try {
                    await apiDeleteContact(uuid);
                    db.contacts = db.contacts.filter(c => c.uuid !== uuid);
                    renderContacts();
                } catch (err) {
                    console.error("删除联系人失败:", err);
                }
            });
        }

        window.renderContacts = renderContacts;
        renderContacts();
    })();

    async function apiEditContact(uuid, type, nickname, avatar, card_data, members = []) {
        const res = await fetch('/api/message/edit/contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uuid, type, nickname, avatar, card_data, members })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || '编辑联系人失败');
        }
        return await res.json();
    }

    async function apiDeleteContact(uuid) {
        const res = await fetch('/api/message/delete/contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uuid })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || '删除联系人失败');
        }
        return await res.json();
    }

    async function apiSwitchContact(uuid) {
        const res = await fetch('/api/message/switch/contact', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uuid })
        });
        if (!res.ok) {
            const err = await res.json();
            throw new Error(err.detail || '切换联系人失败');
        }
        return await res.json();
    }

    // 二级确认弹窗
    function showCustomConfirm(message, onConfirm) {
        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 99999;
            backdrop-filter: blur(2px);
        `;

        const card = document.createElement('div');
        card.style.cssText = `
            background: #fff;
            padding: 24px;
            border-radius: 12px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
            width: 300px;
            text-align: center;
            animation: customConfirmFadeIn 0.2s ease-out;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        `;

        const styleSheet = document.createElement("style");
        styleSheet.innerText = `
            @keyframes customConfirmFadeIn {
                from { transform: scale(0.9); opacity: 0; }
                to { transform: scale(1); opacity: 1; }
            }
        `;
        document.head.appendChild(styleSheet);

        card.innerHTML = `
            <div style="font-size: 16px; font-weight: bold; color: #333; margin-bottom: 12px;">确认提示</div>
            <div style="font-size: 14px; color: #666; margin-bottom: 24px; line-height: 1.5; text-align: left;">${message}</div>
            <div style="display: flex; justify-content: space-between; gap: 12px;">
                <button id="custom-confirm-cancel" style="flex: 1; padding: 10px; border-radius: 6px; border: 1px solid #ddd; background: #fff; color: #666; cursor: pointer; font-size: 14px; outline: none; transition: background 0.2s;">取消</button>
                <button id="custom-confirm-ok" style="flex: 1; padding: 10px; border-radius: 6px; border: none; background: #FC5143; color: #fff; cursor: pointer; font-size: 14px; outline: none; font-weight: bold; transition: background 0.2s;">确认</button>
            </div>
        `;

        overlay.appendChild(card);
        document.body.appendChild(overlay);

        const btnCancel = card.querySelector('#custom-confirm-cancel');
        const btnOk = card.querySelector('#custom-confirm-ok');

        const closeConfirm = () => {
            document.body.removeChild(overlay);
            document.head.removeChild(styleSheet);
        };

        btnCancel.onmouseenter = () => btnCancel.style.background = '#f5f5f5';
        btnCancel.onmouseleave = () => btnCancel.style.background = '#fff';
        btnOk.onmouseenter = () => btnOk.style.background = '#e04438';
        btnOk.onmouseleave = () => btnOk.style.background = '#FC5143';

        btnCancel.addEventListener('click', closeConfirm);
        btnOk.addEventListener('click', () => {
            closeConfirm();
            if (typeof onConfirm === 'function') {
                onConfirm();
            }
        });
    }

    // 1. HTML 中定义的两个搜索按钮
    const searchButtons = [
        document.getElementById("btn-desktop-search"),
        document.getElementById("btn-mobile-search")
    ];

    // 2. 统一绑定点击事件，点击后打开完全相同的搜索弹窗
    searchButtons.forEach(btn => {
        if (btn) {
            btn.addEventListener("click", () => {
                if (window.chatSearchModule) {
                    window.chatSearchModule.open();
                }
            });
        }
    });

    // 注册全局跳转方法，供搜索弹窗点击结果时调用
    window.jumpToMessageContext = async function (messageId) {
        if (isLoadingHistory) return;
        isLoadingHistory = true;

        // 1. 开启双向加载状态，允许向上和向下滚动加载
        hasMoreOlderHistory = true;
        hasMoreNewerHistory = true;

        try {
            // 2. 清空当前的聊天数据数组，并调用 render 彻底清除页面上的旧气泡
            db.messages = [];
            render({ isHistory: true });

            // 3. 向后端拉取目标消息的上下文记录（包含该消息及其后续的新数据）
            const res = await fetch(`/api/message/context?message_id=${messageId}`);
            if (!res.ok) throw new Error("获取上下文记录失败");

            const data = await res.json();

            if (data.messages && data.messages.length > 0) {
                // 4. 将获取到的新消息截面数组写入，并重新渲染生成新的气泡 DOM
                db.messages = data.messages;
                render({ isHistory: true });

                // 5. 在新生成的 DOM 中找到目标消息行
                const targetEl = chatContainer.querySelector(`[data-id="${messageId}"]`);
                if (targetEl) {
                    // 平滑滚动定位到视口中央
                    targetEl.scrollIntoView({ behavior: "smooth", block: "center" });

                    // 6. 触发高亮闪烁动画
                    targetEl.classList.remove('highlight-flash');
                    void targetEl.offsetWidth; // 触发重绘
                    targetEl.classList.add('highlight-flash');
                }
            }

            // 7. 关闭历史检索遮罩弹窗并重置检索视图
            if (window.chatSearchModule) {
                window.chatSearchModule.close();
            }
        } catch (e) {
            console.error(e);
        } finally {
            isLoadingHistory = false;
        }
    };

    initChat();
});