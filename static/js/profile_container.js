/**
 * 根据消息行 DOM 节点解析出对应的发送者用户数据
 * @param {HTMLElement} msgRow - 消息行 DOM 元素
 * @returns {Object} 匹配到的用户或联系人对象
 */
function getSenderDataFromMsgRow(msgRow) {
    if (db.contact && db.contact.type !== 'G') {
        return msgRow.classList.contains('me') ? db.user : db.contact;
    }

    if (db.contact && db.contact.type === 'G') {
        let matchedMessage = null;

        const rawId = msgRow.getAttribute('data-id') || msgRow.id;
        if (rawId) {
            const numericId = rawId.replace(/\D/g, '');
            matchedMessage = db.messages.find(m => String(m.id) === String(numericId) || String(m.id) === String(rawId));
        }

        if (!matchedMessage) {
            const allRows = Array.from(document.querySelectorAll('#chat-content .msg-row'));
            const index = allRows.indexOf(msgRow);
            if (index !== -1 && db.messages && db.messages[index]) {
                matchedMessage = db.messages[index];
            }
        }

        if (matchedMessage) {
            if (matchedMessage.sender_uuid === null || !matchedMessage.sender_uuid) {
                return db.user;
            } else {
                const contact = db.contacts.find(c => c.uuid === matchedMessage.sender_uuid);
                if (contact) {
                    return contact;
                }
                return {
                    uuid: matchedMessage.sender_uuid,
                    nickname: matchedMessage.nickname || matchedMessage.sender_name || "群成员",
                    avatar: matchedMessage.avatar || null
                };
            }
        }
    }

    return msgRow.classList.contains('me') ? db.user : db.contact;
}

/**
 * 填充并打开个人信息卡片，计算在桌面端和移动端的显示位置
 * @param {Object} data - 用户或联系人数据对象
 * @param {HTMLElement} clickedElement - 触发点击的头像元素
 */
function openWeChatProfile(data, clickedElement) {
    if (!data) return;

    let resolvedContact = data;

    if ((!resolvedContact.uuid || resolvedContact === db.contact) && resolvedContact.nickname) {
        const found = db.contacts.find(c => c.nickname === resolvedContact.nickname);
        if (found) {
            resolvedContact = found;
        }
    }

    let resolvedUuid = resolvedContact.uuid;
    if (!resolvedUuid && resolvedContact.nickname) {
        if (db.contact && db.contact.nickname === resolvedContact.nickname && db.contact.uuid) {
            resolvedUuid = db.contact.uuid;
        }
    }
    if (!resolvedUuid && resolvedContact === db.user) {
        resolvedUuid = "user";
    }

    const isMobile = window.innerWidth < 768;
    const container = document.getElementById('profile-container');
    const card = document.getElementById('profile-card');

    document.getElementById('profile-nickname').textContent = resolvedContact.nickname || "未知用户";

    const uuidEl = document.getElementById('profile-uuid');
    uuidEl.textContent = resolvedUuid || "无";

    const avatarImg = document.getElementById('profile-avatar');
    const avatarSrc = resolvedContact.avatar || (db.contact && db.contact.nickname === resolvedContact.nickname ? db.contact.avatar : null);
    if (avatarSrc) {
        avatarImg.src = avatarSrc;
    } else {
        avatarImg.src = 'data:image/svg+xml;utf8,<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"><rect width="100" height="100" fill="%23ccc"/><text x="50" y="55" font-size="30" text-anchor="middle" fill="%23666">?</text></svg>';
    }

    // 朋友圈预览逻辑
    const previewContainer = document.getElementById('profile-moments-preview');
    if (previewContainer) {
        previewContainer.innerHTML = ''; // 每次打开前清空旧图片
    }

    async function loadMomentsPreview(uuid) {
        if (!previewContainer) return;

        try {
            let historyUrl = '/api/moments/history';
            // 存在 uuid（包括 "user"）
            if (uuid) {
                historyUrl += `?uuid=${encodeURIComponent(uuid)}`;
            }

            const res = await fetch(historyUrl);
            if (!res.ok) throw new Error('获取朋友圈数据失败');

            const result = await res.json();
            // 兼容数组或包裹在 data/list 字段中的情况
            const moments = Array.isArray(result) ? result : (result.list || result.data || []);

            const imageUrls = [];
            for (const moment of moments) {
                // 读取您数据结构中的 appendix 字段
                if (Array.isArray(moment.appendix)) {
                    for (const imgUrl of moment.appendix) {
                        if (imgUrl && imageUrls.length < 5) { // 限制最多 5 张预览图
                            imageUrls.push(imgUrl);
                        }
                    }
                }
                if (imageUrls.length >= 5) break;
            }

            previewContainer.innerHTML = ''; // 清除加载中的空状态

            if (imageUrls.length > 0) {
                imageUrls.forEach(url => {
                    const img = document.createElement('img');
                    img.src = url;
                    // 直接继承 CSS `.moments-preview-imgs img` 样式
                    previewContainer.appendChild(img);
                });
            }
        } catch (err) {
            console.error('朋友圈预览加载出错:', err);
        }
    }

    loadMomentsPreview(resolvedUuid);
    // 结束

    const sendMsgBtn = document.getElementById('btn-profile-send-msg');
    const isMe = (resolvedContact === db.user) || (resolvedUuid && db.user.uuid && resolvedUuid === db.user.uuid);

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

    if (isMe) {
        sendMsgBtn.style.display = 'none';
    } else {
        sendMsgBtn.style.display = 'flex';
        sendMsgBtn.onclick = async function () {
            if (typeof apiSwitchContact === 'function') {
                try {
                    await apiSwitchContact(resolvedUuid);
                    window.location.reload();
                } catch (err) {
                    console.error(err);
                }
            }
        };
    }

    const momentsBtn = document.getElementById('btn-profile-moments');
    momentsBtn.onclick = function () {
        const url = window.location.href.replace('/chat', '/moments') + '?uuid=' + (resolvedUuid || '');
        window.open(url, '_blank');
    };

    container.style.display = 'block';

    if (!isMobile && clickedElement) {
        const rect = clickedElement.getBoundingClientRect();
        const cardWidth = 290;
        const cardHeight = 220;

        let left = rect.right + 10;
        let top = rect.top;

        if (left + cardWidth > window.innerWidth) {
            left = rect.left - cardWidth - 10;
        }
        if (top + cardHeight > window.innerHeight) {
            top = window.innerHeight - cardHeight - 15;
        }
        if (top < 10) top = 10;

        card.style.position = 'absolute';
        card.style.left = left + 'px';
        card.style.top = top + 'px';
        card.style.width = cardWidth + 'px';
        card.style.height = 'auto';
    } else {
        card.style.position = '';
        card.style.left = '';
        card.style.top = '';
        card.style.width = '';
        card.style.height = '';
    }
}

/**
 * 关闭个人信息视图
 */
function closeWeChatProfile() {
    document.getElementById('profile-container').style.display = 'none';
}

// 绑定全局点击事件，用于触发头像点击以及防误触检测
document.addEventListener('click', function (e) {
    const avatarBox = e.target.closest('.avatar-box');
    if (avatarBox) {
        const msgRow = avatarBox.closest('.msg-row');
        if (msgRow) {
            e.stopPropagation();

            const senderData = getSenderDataFromMsgRow(msgRow);
            openWeChatProfile(senderData, avatarBox);
            return;
        }
    }

    const contactAvatar = e.target.closest('.contact-avatar');
    if (contactAvatar) {
        const contactItem = contactAvatar.closest('.contact-item');
        if (contactItem) {
            e.stopPropagation();
            const uuid = contactItem.getAttribute('data-uuid');
            if (uuid) {
                const targetContact = db.contacts.find(c => c.uuid === uuid);
                if (targetContact) {
                    openWeChatProfile(targetContact, contactAvatar);
                }
            }
            return;
        }
    }
});

// 点击空白背景关闭个人信息视图
document.getElementById('profile-container').addEventListener('click', function (e) {
    if (e.target === this) {
        closeWeChatProfile();
    }
});

// 手机版返回按钮关闭事件绑定
document.getElementById('btn-profile-back').addEventListener('click', function () {
    closeWeChatProfile();
});