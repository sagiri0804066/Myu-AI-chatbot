import { switchContactApi } from '../api/chatApi.js';
import { store } from '../store/chatStore.js';
import { fetchMomentsHistoryApi } from '../api/momentsApi.js';


const DEFAULT_PROFILE_AVATAR =
    "data:image/svg+xml;utf8," +
    "<svg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'>" +
    "<rect width='100' height='100' fill='%23ccc'/>" +
    "<text x='50' y='57' font-size='34' text-anchor='middle' fill='%23666'>?</text>" +
    "</svg>";

function requiredElement(id) {
    const element = document.getElementById(id);

    if (!element) {
        throw new Error(`userCard 初始化失败：缺少 #${id}`);
    }

    return element;
}

function messageIdEquals(left, right) {
    return String(left) === String(right);
}

/**
 * 根据消息行查找对应的消息数据。
 * @param {HTMLElement} messageRow
 * @returns {object|null}
 */
function getMessageFromRow(messageRow) {
    const messageId = messageRow.dataset.id;

    if (messageId === undefined) {
        return null;
    }

    return store.messages.find(message =>
        message &&
        message.id !== undefined &&
        messageIdEquals(message.id, messageId)
    ) || null;
}

/**
 * 根据消息行解析发送者。
 * @param {HTMLElement} messageRow
 * @returns {object|null}
 */
function getSenderFromMessageRow(messageRow) {
    if (messageRow.classList.contains('me')) {
        return store.user;
    }

    if (store.contact.type !== 'G') {
        return store.contact;
    }

    const message = getMessageFromRow(messageRow);

    if (!message) {
        return store.contact;
    }

    if (!message.sender_uuid) {
        return message.role === 'user'
            ? store.user
            : store.contact;
    }

    const sender = store.getContactByUuid(message.sender_uuid);

    if (sender) {
        return sender;
    }

    return {
        uuid: message.sender_uuid,
        nickname:
            message.nickname ||
            message.sender_name ||
            '群成员',
        avatar: message.avatar || null,
    };
}

/**
 * 尝试补全联系人 UUID。
 * 某些初始化数据中的当前联系人可能只有昵称，没有 uuid。
 */
function resolveProfileData(data) {
    if (!data) {
        return null;
    }

    if (data === store.user) {
        return {
            data: store.user,
            uuid: store.user.uuid || 'user',
            isMe: true,
        };
    }

    let resolvedData = data;

    if (!resolvedData.uuid && resolvedData.nickname) {
        const matchedContact = store.contacts.find(contact =>
            contact.nickname === resolvedData.nickname
        );

        if (matchedContact) {
            resolvedData = matchedContact;
        }
    }

    let uuid = resolvedData.uuid || null;

    if (
        !uuid &&
        resolvedData.nickname &&
        resolvedData.nickname === store.contact.nickname
    ) {
        uuid = store.contact.uuid || null;
    }

    const isMe = Boolean(
        resolvedData === store.user ||
        (
            uuid &&
            store.user.uuid &&
            String(uuid) === String(store.user.uuid)
        )
    );

    return {
        data: resolvedData,
        uuid: isMe ? (store.user.uuid || 'user') : uuid,
        isMe,
    };
}

function buildMomentsUrl(uuid) {
    const url = new URL(window.location.href);

    if (/\/chat\/?$/.test(url.pathname)) {
        url.pathname = url.pathname.replace(/\/chat\/?$/, '/moments');
    } else {
        url.pathname = url.pathname.replace('/chat', '/moments');
    }

    if (uuid) {
        url.searchParams.set('uuid', uuid);
    } else {
        url.searchParams.delete('uuid');
    }

    return url.toString();
}

/**
 * 初始化用户/联系人名片。
 *
 * @param {object} dependencies
 * @param {Function} dependencies.reloadChat 切换联系人后重新加载聊天
 */
export function initUserCard({ reloadChat }) {
    if (typeof reloadChat !== 'function') {
        throw new TypeError(
            'userCard 初始化失败：reloadChat 必须是函数'
        );
    }

    const container = requiredElement('profile-container');
    const card = requiredElement('profile-card');
    const nicknameElement = requiredElement('profile-nickname');
    const uuidElement = requiredElement('profile-uuid');
    const avatarElement = requiredElement('profile-avatar');
    const sendMessageButton = requiredElement(
        'btn-profile-send-msg'
    );
    const momentsButton = requiredElement('btn-profile-moments');
    const backButton = requiredElement('btn-profile-back');

    const momentsPreview = document.getElementById(
        'profile-moments-preview'
    );

    let destroyed = false;
    let currentProfileUuid = null;
    let isSwitchingContact = false;
    let momentsPreviewGeneration = 0;

    function clearMomentsPreview() {
        if (momentsPreview) {
            momentsPreview.replaceChildren();
        }
    }

    async function loadMomentsPreview(uuid) {
        if (!momentsPreview) {
            return;
        }

        const generation = ++momentsPreviewGeneration;
        momentsPreview.replaceChildren();

        try {
            const result = await fetchMomentsHistoryApi({
                profileUuid: uuid || null,
            });

            if (
                destroyed ||
                generation !== momentsPreviewGeneration ||
                String(currentProfileUuid || '') !== String(uuid || '')
            ) {
                return;
            }

            const moments = Array.isArray(result)
                ? result
                : Array.isArray(result?.list)
                    ? result.list
                    : Array.isArray(result?.data)
                        ? result.data
                        : [];

            const imageUrls = [];

            for (const moment of moments) {
                if (!Array.isArray(moment?.appendix)) {
                    continue;
                }

                for (const imageUrl of moment.appendix) {
                    if (
                        typeof imageUrl === 'string' &&
                        imageUrl.trim()
                    ) {
                        imageUrls.push(imageUrl);
                    }

                    if (imageUrls.length >= 5) {
                        break;
                    }
                }

                if (imageUrls.length >= 5) {
                    break;
                }
            }

            const fragment = document.createDocumentFragment();

            imageUrls.forEach(imageUrl => {
                const image = document.createElement('img');
                image.src = imageUrl;
                image.alt = '';
                image.loading = 'lazy';

                image.addEventListener(
                    'error',
                    () => image.remove(),
                    { once: true }
                );

                fragment.appendChild(image);
            });

            momentsPreview.replaceChildren(fragment);
        } catch (error) {
            if (
                destroyed ||
                generation !== momentsPreviewGeneration
            ) {
                return;
            }

            momentsPreview.replaceChildren();
            console.error('朋友圈预览加载失败:', error);
        }
    }

    function positionCard(clickedElement) {
        const isMobile = window.innerWidth < 768;

        if (isMobile || !clickedElement) {
            card.style.position = '';
            card.style.left = '';
            card.style.top = '';
            card.style.width = '';
            card.style.height = '';
            return;
        }

        const anchorRect = clickedElement.getBoundingClientRect();
        const cardWidth = 290;
        const viewportMargin = 15;

        card.style.position = 'absolute';
        card.style.width = `${cardWidth}px`;
        card.style.height = 'auto';

        const cardHeight = card.getBoundingClientRect().height || 220;

        let left = anchorRect.right + 10;
        let top = anchorRect.top;

        if (left + cardWidth > window.innerWidth - viewportMargin) {
            left = anchorRect.left - cardWidth - 10;
        }

        if (left < viewportMargin) {
            left = viewportMargin;
        }

        if (top + cardHeight > window.innerHeight - viewportMargin) {
            top = window.innerHeight - cardHeight - viewportMargin;
        }

        if (top < 10) {
            top = 10;
        }

        card.style.left = `${left}px`;
        card.style.top = `${top}px`;
    }
    
    function close() {
        momentsPreviewGeneration += 1;
        container.style.display = 'none';
        currentProfileUuid = null;
        clearMomentsPreview();
    }

    function open(profileData, clickedElement = null) {
        if (destroyed || !profileData) {
            return;
        }

        const resolved = resolveProfileData(profileData);

        if (!resolved) {
            return;
        }

        const {
            data,
            uuid,
            isMe,
        } = resolved;

        currentProfileUuid = uuid;

        nicknameElement.textContent =
            data.nickname || '未知用户';

        uuidElement.textContent = uuid || '无';

        avatarElement.src =
            data.avatar ||
            (
                store.contact.nickname === data.nickname
                    ? store.contact.avatar
                    : null
            ) ||
            DEFAULT_PROFILE_AVATAR;

        avatarElement.onerror = () => {
            avatarElement.onerror = null;
            avatarElement.src = DEFAULT_PROFILE_AVATAR;
        };

        clearMomentsPreview();
        loadMomentsPreview(uuid);


        if (isMe || !uuid) {
            sendMessageButton.style.display = 'none';
        } else {
            sendMessageButton.style.display = 'flex';
        }

        container.style.display = 'block';
        positionCard(clickedElement);
    }

    async function handleSendMessage() {
        if (
            destroyed ||
            isSwitchingContact ||
            !currentProfileUuid ||
            currentProfileUuid === 'user'
        ) {
            return;
        }

        isSwitchingContact = true;
        sendMessageButton.disabled = true;

        try {
            await switchContactApi(currentProfileUuid);

            if (destroyed) {
                return;
            }

            close();
            await reloadChat();
        } catch (error) {
            console.error('从名片切换联系人失败:', error);
        } finally {
            isSwitchingContact = false;
            sendMessageButton.disabled = false;
        }
    }

    function handleMomentsClick() {
        if (destroyed) {
            return;
        }

        const url = buildMomentsUrl(currentProfileUuid || '');
        window.open(url, '_blank', 'noopener');
    }

    function handleDocumentClick(event) {
        const avatarBox = event.target.closest('.avatar-box');

        if (avatarBox) {
            const messageRow = avatarBox.closest('.msg-row');

            if (messageRow) {
                event.stopPropagation();

                const sender = getSenderFromMessageRow(messageRow);
                open(sender, avatarBox);
                return;
            }
        }

        const contactAvatar = event.target.closest('.contact-avatar');

        if (!contactAvatar) {
            return;
        }

        const contactItem = contactAvatar.closest('.contact-item');
        const uuid = contactItem?.dataset.uuid;

        if (!uuid) {
            return;
        }

        const contact = store.getContactByUuid(uuid);

        if (contact) {
            event.stopPropagation();
            open(contact, contactAvatar);
        }
    }

    function handleContainerClick(event) {
        if (event.target === container) {
            close();
        }
    }

    function handleWindowResize() {
        if (
            container.style.display !== 'none' &&
            window.innerWidth < 768
        ) {
            positionCard(null);
        }
    }

    document.addEventListener('click', handleDocumentClick);
    container.addEventListener('click', handleContainerClick);
    backButton.addEventListener('click', close);
    sendMessageButton.addEventListener(
        'click',
        handleSendMessage
    );
    momentsButton.addEventListener(
        'click',
        handleMomentsClick
    );
    window.addEventListener('resize', handleWindowResize);

    function destroy() {
        if (destroyed) {
            return;
        }

        destroyed = true;

        document.removeEventListener('click', handleDocumentClick);
        container.removeEventListener(
            'click',
            handleContainerClick
        );
        backButton.removeEventListener('click', close);
        sendMessageButton.removeEventListener(
            'click',
            handleSendMessage
        );
        momentsButton.removeEventListener(
            'click',
            handleMomentsClick
        );
        window.removeEventListener('resize', handleWindowResize);

        close();
    }

    return {
        open,
        close,
        destroy,
    };
}
