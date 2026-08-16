import {
    deleteMessagesApi,
    fetchHistory,
    fetchInitData,
    fetchMessageContext,
    pollMessages,
} from '../api/chatApi.js';

import {
    DEFAULT_AVATAR_SVG,
    FIVE_MINUTES_MS,
    STATUS_LIST,
    store,
} from '../store/chatStore.js';

import { formatTime } from '../utils/helpers.js';

const HISTORY_LIMIT = 20;
const POLL_TIMEOUT_MS = 35000;
const RETRY_DELAY_MS = 10000;
const CLEAR_ERROR_DELAY_MS = 2500;

function getRequiredElement(id) {
    const element = document.getElementById(id);

    if (!element) {
        throw new Error(`chatView 初始化失败：缺少 #${id}`);
    }

    return element;
}

function getMessageTimestamp(message) {
    const idTimestamp = Number(message?.id);

    if (Number.isFinite(idTimestamp) && idTimestamp > 0) {
        return idTimestamp;
    }

    if (message?.time) {
        const timeTimestamp = new Date(message.time).getTime();

        if (Number.isFinite(timeTimestamp)) {
            return timeTimestamp;
        }
    }

    return null;
}

function createTimeTag(text) {
    const wrapper = document.createElement('div');
    wrapper.className = 'time-tag';

    const span = document.createElement('span');
    span.textContent = text;

    wrapper.appendChild(span);
    return wrapper;
}

function appendAvatar(container, avatar) {
    if (!avatar) {
        container.innerHTML = DEFAULT_AVATAR_SVG;
        return;
    }

    const image = document.createElement('img');
    image.alt = '';
    image.src = avatar;

    image.addEventListener('error', () => {
        image.remove();
        container.innerHTML = DEFAULT_AVATAR_SVG;
    }, { once: true });

    container.appendChild(image);
}

/**
 * 把消息文本和 @[昵称]{uuid} 转换为安全 DOM。
 */
function appendMessageText(container, text) {
    const value = String(text || '');
    const mentionPattern = /@\[([^\]]+)\]{([a-zA-Z0-9-]+)}/g;

    let lastIndex = 0;
    let match;

    function appendPlainText(plainText) {
        const parts = plainText.split('\n');

        parts.forEach((part, index) => {
            if (part) {
                container.appendChild(document.createTextNode(part));
            }

            if (index < parts.length - 1) {
                container.appendChild(document.createElement('br'));
            }
        });
    }

    while ((match = mentionPattern.exec(value)) !== null) {
        appendPlainText(value.slice(lastIndex, match.index));

        const mention = document.createElement('span');
        mention.className = 'mention-log-tag';
        mention.textContent = `@${match[1]}`;
        container.appendChild(mention);

        lastIndex = mentionPattern.lastIndex;
    }

    appendPlainText(value.slice(lastIndex));
}

function getSenderPresentation(message) {
    if (message.role === 'user') {
        return {
            avatar: store.user.avatar,
            nickname: '',
        };
    }

    if (store.contact.type === 'G' && message.sender_uuid) {
        const sender = store.getContactByUuid(message.sender_uuid);

        if (sender) {
            return {
                avatar: sender.avatar,
                nickname: sender.nickname || '',
            };
        }
    }

    return {
        avatar: store.contact.avatar,
        nickname: '',
    };
}

function createMessageRow(message) {
    const isMe = message.role === 'user';
    const sender = getSenderPresentation(message);

    const row = document.createElement('div');
    row.className = `msg-row ${isMe ? 'me' : 'other'}`;

    if (message.id !== undefined && message.id !== null) {
        row.dataset.id = String(message.id);
    }

    const checkboxArea = document.createElement('div');
    checkboxArea.className = 'checkbox-area';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'msg-check';
    checkboxArea.appendChild(checkbox);

    const messageContent = document.createElement('div');
    messageContent.className = 'msg-content';

    const avatarBox = document.createElement('div');
    avatarBox.className = 'avatar-box';
    appendAvatar(avatarBox, sender.avatar);

    const bubbleColumn = document.createElement('div');
    bubbleColumn.style.display = 'flex';
    bubbleColumn.style.flexDirection = 'column';

    if (sender.nickname) {
        const senderName = document.createElement('div');
        senderName.className = 'sender-name-tag';
        senderName.style.cssText =
            'font-size:11px;color:#888;margin-bottom:4px;padding-left:4px;';
        senderName.textContent = sender.nickname;
        bubbleColumn.appendChild(senderName);
    }

    const bubble = document.createElement('div');
    bubble.className = 'bubble';
    appendMessageText(bubble, message.text);

    bubbleColumn.appendChild(bubble);
    messageContent.appendChild(avatarBox);
    messageContent.appendChild(bubbleColumn);

    row.appendChild(checkboxArea);
    row.appendChild(messageContent);

    return row;
}

export function initChatView() {
    const chatContainer = getRequiredElement('chat-container');
    const statusText = getRequiredElement('status-indicator');
    const displayName = getRequiredElement('display-name');
    const netErrOut = getRequiredElement('net-err-out');
    const netErrCode = getRequiredElement('net-err-code');

    const uiNormal = getRequiredElement('ui-normal');
    const uiEdit = getRequiredElement('ui-edit');
    const btnConfirm = getRequiredElement('btn-edit-confirm');
    const btnDesktopEdit = getRequiredElement('btn-desktop-edit');
    const btnMobileEdit = getRequiredElement('btn-mobile-edit');
    const btnEditCancel = getRequiredElement('btn-edit-cancel');

    let destroyed = false;
    let deleteStage = 1;

    let pollTimer = null;
    let pollController = null;
    let pollGeneration = 0;

    let initRetryTimer = null;
    let initGeneration = 0;

    function setNetError(show, code = '') {
        netErrOut.style.display = show ? 'block' : 'none';

        if (show) {
            netErrCode.textContent = String(code);
        }
    }

    function render(options = {}) {
        const { isHistory = false } = options;

        displayName.textContent =
            store.contact.nickname || '载入中...';

        if (store.contact.type === 'G') {
            const memberCount = Array.isArray(store.contact.members)
                ? store.contact.members.length
                : 0;

            statusText.textContent = `群聊 (${memberCount + 1} 人)`;
        } else {
            statusText.textContent =
                STATUS_LIST[store.contact.statusIndex] || STATUS_LIST[0];
        }

        chatContainer.replaceChildren();

        if (!store.hasMoreOlderHistory && store.messages.length > 0) {
            chatContainer.appendChild(
                createTimeTag('没有更多历史记录了')
            );
        }

        let previousMessageTime = 0;

        store.messages.forEach(message => {
            if (!message || !message.text) {
                return;
            }

            const currentTimestamp = getMessageTimestamp(message);

            if (currentTimestamp) {
                if (
                    previousMessageTime === 0 ||
                    currentTimestamp - previousMessageTime > FIVE_MINUTES_MS
                ) {
                    chatContainer.appendChild(
                        createTimeTag(formatTime(currentTimestamp))
                    );
                }

                previousMessageTime = currentTimestamp;
            } else {
                console.warn(
                    `消息 ID ${message.id} 缺少有效时间戳，仍渲染消息但不显示时间`
                );
            }

            chatContainer.appendChild(createMessageRow(message));
        });

        if (!isHistory) {
            requestAnimationFrame(() => {
                chatContainer.scrollTop = chatContainer.scrollHeight;
            });
        }
    }

    function clearPollTimer() {
        if (pollTimer !== null) {
            clearTimeout(pollTimer);
            pollTimer = null;
        }
    }

    function stopPolling() {
        pollGeneration += 1;
        clearPollTimer();

        if (pollController) {
            pollController.abort();
            pollController = null;
        }

        store.isPollingActive = false;
    }

    function schedulePoll(delay = 0) {
        if (
            destroyed ||
            store.hasMoreNewerHistory ||
            pollTimer !== null ||
            store.isPollingActive
        ) {
            return;
        }

        const generation = pollGeneration;

        pollTimer = setTimeout(() => {
            pollTimer = null;
            runPoll(generation);
        }, delay);
    }

    async function runPoll(generation) {
        if (
            destroyed ||
            generation !== pollGeneration ||
            store.hasMoreNewerHistory ||
            store.isPollingActive
        ) {
            return;
        }

        let nextPollDelay = RETRY_DELAY_MS;

        store.isPollingActive = true;

        const controller = new AbortController();
        pollController = controller;

        const timeoutId = setTimeout(() => {
            controller.abort();
        }, POLL_TIMEOUT_MS);

        const clearErrorTimer = setTimeout(() => {
            if (generation === pollGeneration) {
                setNetError(false);
            }
        }, CLEAR_ERROR_DELAY_MS);

        try {
            const lastMessage = store.getLastMessage();
            const cursor = lastMessage ? lastMessage.id : 0;

            const data = await pollMessages(cursor, controller.signal);

            clearTimeout(timeoutId);
            clearTimeout(clearErrorTimer);

            if (generation !== pollGeneration || destroyed) {
                return;
            }

            setNetError(false);

            let hasChange = false;

            if (
                data?.statusIndex !== undefined &&
                data.statusIndex !== store.contact.statusIndex
            ) {
                store.setContactStatus(data.statusIndex);
                hasChange = true;
            }

            if (Array.isArray(data?.messages)) {
                hasChange =
                    store.appendMessages(data.messages) || hasChange;
            }

            if (hasChange) {
                render();
            }

            nextPollDelay = 0;

        } catch (error) {
            clearTimeout(timeoutId);
            clearTimeout(clearErrorTimer);

            if (generation !== pollGeneration || destroyed) {
                return;
            }

            const errorName =
                error.name === 'AbortError'
                    ? '超时'
                    : error.status || '断开';

            setNetError(true, errorName);
            console.error('消息轮询失败:', error);
        } finally {
            clearTimeout(timeoutId);
            clearTimeout(clearErrorTimer);

            if (pollController === controller) {
                pollController = null;
            }

            if (generation === pollGeneration) {
                store.isPollingActive = false;

                if (!destroyed && !store.hasMoreNewerHistory) {
                    schedulePoll(nextPollDelay);

                }
            }
        }
    }

    function startPolling() {
        if (destroyed || store.hasMoreNewerHistory) {
            return;
        }

        schedulePoll(0);
    }

    async function runInitialLoad(generation) {
        try {
            const data = await fetchInitData();

            if (destroyed || generation !== initGeneration) {
                return false;
            }

            store.setInitialData(data || {});
            setNetError(false);
            render();
            startPolling();

            return true;
        } catch (error) {
            if (destroyed || generation !== initGeneration) {
                return false;
            }

            setNetError(true, error.status || '断开');
            console.error('聊天初始化失败:', error);

            initRetryTimer = setTimeout(() => {
                initRetryTimer = null;
                runInitialLoad(generation);
            }, RETRY_DELAY_MS);

            return false;
        }
    }

    async function reload() {
        if (destroyed) {
            return false;
        }

        initGeneration += 1;
        const generation = initGeneration;

        if (initRetryTimer !== null) {
            clearTimeout(initRetryTimer);
            initRetryTimer = null;
        }

        stopPolling();
        return await runInitialLoad(generation);
    }

    async function loadHistory(direction = 'older') {
        if (
            destroyed ||
            store.isLoadingHistory ||
            store.messages.length === 0
        ) {
            return;
        }

        if (
            direction === 'older' &&
            !store.hasMoreOlderHistory
        ) {
            return;
        }

        if (
            direction === 'newer' &&
            !store.hasMoreNewerHistory
        ) {
            return;
        }

        const firstMessage = store.getFirstMessage();
        const lastMessage = store.getLastMessage();

        const cursor =
            direction === 'older'
                ? firstMessage?.id
                : lastMessage?.id;

        if (cursor === undefined || cursor === null) {
            return;
        }

        store.isLoadingHistory = true;

        const oldScrollHeight = chatContainer.scrollHeight;
        const oldScrollTop = chatContainer.scrollTop;

        try {
            const data = await fetchHistory(
                cursor,
                direction,
                HISTORY_LIMIT
            );

            const messages = Array.isArray(data?.messages)
                ? data.messages
                : [];

            if (direction === 'older') {
                if (messages.length > 0) {
                    store.prependMessages(messages);
                }

                if (messages.length < HISTORY_LIMIT) {
                    store.hasMoreOlderHistory = false;
                }

                render({ isHistory: true });

                const heightDifference =
                    chatContainer.scrollHeight - oldScrollHeight;

                chatContainer.scrollTop =
                    oldScrollTop + heightDifference;
            } else {
                if (messages.length > 0) {
                    store.appendMessages(messages);
                }

                if (messages.length < HISTORY_LIMIT) {
                    store.hasMoreNewerHistory = false;
                }

                render({ isHistory: true });
                chatContainer.scrollTop = oldScrollTop;

                if (!store.hasMoreNewerHistory) {
                    startPolling();
                }
            }
        } catch (error) {
            console.error('获取历史消息失败:', error);
        } finally {
            store.isLoadingHistory = false;
        }
    }

    async function jumpToMessage(messageId) {
        if (
            destroyed ||
            store.isLoadingHistory ||
            messageId === undefined ||
            messageId === null
        ) {
            return false;
        }

        store.isLoadingHistory = true;
        store.hasMoreOlderHistory = true;
        store.hasMoreNewerHistory = true;

        stopPolling();

        try {
            store.setMessages([]);
            render({ isHistory: true });

            const data = await fetchMessageContext(messageId);
            const messages = Array.isArray(data?.messages)
                ? data.messages
                : [];

            store.setMessages(messages);
            render({ isHistory: true });

            const targetRow = Array
                .from(chatContainer.querySelectorAll('.msg-row'))
                .find(row => row.dataset.id === String(messageId));

            if (targetRow) {
                targetRow.scrollIntoView({
                    behavior: 'smooth',
                    block: 'center',
                });

                targetRow.classList.remove('highlight-flash');
                void targetRow.offsetWidth;
                targetRow.classList.add('highlight-flash');
            }

            return Boolean(targetRow);
        } catch (error) {
            console.error('获取消息上下文失败:', error);
            return false;
        } finally {
            store.isLoadingHistory = false;
        }
    }

    function toggleEditMode(show) {
        uiNormal.style.display = show ? 'none' : 'flex';
        uiEdit.style.display = show ? 'flex' : 'none';
        chatContainer.classList.toggle('edit-mode', show);

        deleteStage = 1;
        btnConfirm.textContent = '删除选中';
        btnConfirm.classList.remove('stage-2');
    }

    async function handleDeleteConfirm() {
        const checkedBoxes =
            chatContainer.querySelectorAll('.msg-check:checked');

        if (checkedBoxes.length === 0) {
            return;
        }

        if (deleteStage === 1) {
            deleteStage = 2;
            btnConfirm.textContent = '确定要删除吗？';
            btnConfirm.classList.add('stage-2');
            return;
        }

        const idsToDelete = Array
            .from(checkedBoxes)
            .map(checkbox => checkbox.closest('.msg-row')?.dataset.id)
            .filter(id => id !== undefined)
            .map(id => {
                const message = store.messages.find(
                    item => String(item.id) === id
                );

                return message ? message.id : id;
            });

        if (idsToDelete.length === 0) {
            return;
        }

        store.removeMessages(idsToDelete);
        toggleEditMode(false);
        render();

        try {
            await deleteMessagesApi(idsToDelete);
        } catch (error) {
            console.error('后台删除消息失败:', error);
        }
    }

    function handleScroll() {
        if (chatContainer.scrollTop < 30) {
            loadHistory('older');
        }

        const scrollBottom =
            chatContainer.scrollHeight -
            chatContainer.scrollTop -
            chatContainer.clientHeight;

        if (
            scrollBottom < 30 &&
            store.hasMoreNewerHistory
        ) {
            loadHistory('newer');
        }
    }

    function handleDesktopEdit() {
        toggleEditMode(true);
    }

    function handleMobileEdit() {
        toggleEditMode(true);

        const mobileMenu =
            document.getElementById('mobile-plus-menu');

        if (mobileMenu) {
            mobileMenu.style.display = 'none';
        }
    }

    function handleEditCancel() {
        toggleEditMode(false);
    }

    btnDesktopEdit.addEventListener('click', handleDesktopEdit);
    btnMobileEdit.addEventListener('click', handleMobileEdit);
    btnEditCancel.addEventListener('click', handleEditCancel);
    btnConfirm.addEventListener('click', handleDeleteConfirm);
    chatContainer.addEventListener('scroll', handleScroll);

    function destroy() {
        destroyed = true;
        initGeneration += 1;

        stopPolling();

        if (initRetryTimer !== null) {
            clearTimeout(initRetryTimer);
            initRetryTimer = null;
        }

        btnDesktopEdit.removeEventListener('click', handleDesktopEdit);
        btnMobileEdit.removeEventListener('click', handleMobileEdit);
        btnEditCancel.removeEventListener('click', handleEditCancel);
        btnConfirm.removeEventListener('click', handleDeleteConfirm);
        chatContainer.removeEventListener('scroll', handleScroll);
    }

    return {
        render,
        reload,
        loadHistory,
        jumpToMessage,
        startPolling,
        stopPolling,
        toggleEditMode,
        destroy,
    };
}
