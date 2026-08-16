import { sendInterruptApi, sendMessageApi } from '../api/chatApi.js';
import { store } from '../store/chatStore.js';
import { escapeHTML, throttle } from '../utils/helpers.js';

function getElement(id) {
    return document.getElementById(id);
}

function serializeContent(container) {
    let text = '';

    container.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent;
            return;
        }

        if (node.nodeType !== Node.ELEMENT_NODE) {
            return;
        }

        if (node.classList.contains('mention-tag')) {
            const name = node.textContent.replace(/^@/, '');

            if (node.dataset.uuid) {
                text += `@[${name}]{${node.dataset.uuid}}`;
            } else {
                text += node.textContent;
            }

            return;
        }

        if (node.tagName === 'BR') {
            text += '\n';
            return;
        }

        text += node.textContent;
    });

    return text.trim();
}

function getSelectionTextBeforeCaret(input) {
    const selection = window.getSelection();

    if (!selection || selection.rangeCount === 0) {
        return '';
    }

    const range = selection.getRangeAt(0);
    const node = range.startContainer;

    if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent.slice(0, range.startOffset);
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
        const text = selection.anchorNode?.textContent ||
            input.textContent ||
            '';

        const offset = Number.isInteger(selection.anchorOffset)
            ? selection.anchorOffset
            : text.length;

        return text.slice(0, offset);
    }

    return '';
}

export function initChatInput({
    renderChat,
    reloadChat,
}) {
    const msgInput = getElement('msg-input');
    const btnSend = getElement('btn-send');
    const mentionPopover = getElement('mention-popover');
    const mentionList = getElement('mention-list');

    if (!msgInput) {
        throw new Error('chatInput 初始化失败：缺少 #msg-input');
    }

    let destroyed = false;
    let isResizing = false;

    function hideMentionPopover() {
        if (mentionPopover) {
            mentionPopover.style.display = 'none';
        }
    }

    function insertMentionTag(uuid, name) {
        msgInput.focus();

        const selection = window.getSelection();

        if (!selection || selection.rangeCount === 0) {
            return;
        }

        const range = selection.getRangeAt(0);
        const node = range.startContainer;

        // 删除当前光标前由用户输入的 @。
        if (node.nodeType === Node.TEXT_NODE) {
            const offset = range.startOffset;
            const text = node.textContent || '';
            const atIndex = text.lastIndexOf('@', offset - 1);

            if (atIndex !== -1) {
                range.setStart(node, atIndex);
                range.setEnd(node, offset);
                range.deleteContents();
            }
        }

        const mention = document.createElement('span');
        mention.className = 'mention-tag';
        mention.contentEditable = 'false';
        mention.textContent = `@${name}`;

        if (uuid) {
            mention.dataset.uuid = uuid;
        }

        const trailingSpace = document.createTextNode('\u00A0');

        range.insertNode(trailingSpace);
        range.insertNode(mention);

        range.setStartAfter(trailingSpace);
        range.collapse(true);

        selection.removeAllRanges();
        selection.addRange(range);
    }

    function appendMentionItem({
        avatar,
        name,
        uuid = null,
    }) {
        if (!mentionList) {
            return;
        }

        const item = document.createElement('div');
        item.className = 'mention-item';

        const image = document.createElement('img');
        image.className = 'mention-avatar';
        image.alt = '';
        image.src = avatar;

        const label = document.createElement('span');
        label.className = 'mention-name';
        label.textContent = name;

        item.appendChild(image);
        item.appendChild(label);

        item.addEventListener('mousedown', event => {
            event.preventDefault();
            event.stopPropagation();

            insertMentionTag(uuid, name);
            hideMentionPopover();
        });

        mentionList.appendChild(item);
    }

    function showMentionPopover() {
        if (!mentionPopover || !mentionList) {
            return;
        }

        mentionList.replaceChildren();

        const groupAvatar =
            "data:image/svg+xml;utf8," +
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' " +
            "fill='%2307c160'>" +
            "<rect width='100' height='100'/>" +
            "<path d='M35 40h10l15-15v50L45 60H35V40zM70 35a20 20 0 0 1 0 30' " +
            "stroke='white' stroke-width='6' stroke-linecap='round' fill='none'/>" +
            "</svg>";

        appendMentionItem({
            avatar: groupAvatar,
            name: '所有人',
        });

        const memberUuids = Array.isArray(store.contact.members)
            ? store.contact.members
            : [];

        const members = store.contacts.filter(contact =>
            memberUuids.includes(contact.uuid)
        );

        if (members.length === 0 && memberUuids.length === 0) {
            hideMentionPopover();
            return;
        }

        const defaultAvatar =
            "data:image/svg+xml;utf8," +
            "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100' " +
            "fill='%23ddd'>" +
            "<rect width='100' height='100'/>" +
            "<circle cx='50' cy='40' r='20' fill='%23999'/>" +
            "<path d='M20 90c0-15 10-25 30-25s30 10 30 25z' fill='%23999'/>" +
            "</svg>";

        members.forEach(member => {
            appendMentionItem({
                avatar: member.avatar || defaultAvatar,
                name: member.nickname || '未命名联系人',
                uuid: member.uuid,
            });
        });

        mentionPopover.style.display = 'block';
    }

    function checkMentionTrigger() {
        if (store.contact.type !== 'G') {
            hideMentionPopover();
            return;
        }

        const textBeforeCaret = getSelectionTextBeforeCaret(msgInput);

        if (textBeforeCaret.endsWith('@')) {
            showMentionPopover();
        } else {
            hideMentionPopover();
        }
    }

    const sendInterruptSignal = throttle(async () => {
        try {
            await sendInterruptApi();
        } catch (error) {
            console.error('发送输入打断信号失败:', error);
        }
    }, 2500);

    async function sendMessage() {
        if (destroyed) {
            return;
        }

        const text = serializeContent(msgInput);

        if (!text) {
            return;
        }

        const messageId = Date.now();

        store.appendMessages({
            id: messageId,
            role: 'user',
            text,
            time: '',
        });

        msgInput.replaceChildren();
        hideMentionPopover();
        renderChat();

        try {
            const data = await sendMessageApi(text, messageId);
            const localMessage = store.messages.find(
                message => String(message.id) === String(messageId)
            );

            if (localMessage && data?.time) {
                localMessage.time = data.time;
                renderChat();
            }

            // 发送消息后离开历史断面，重新拉取当前会话。
            if (store.hasMoreNewerHistory) {
                store.hasMoreNewerHistory = false;
                store.hasMoreOlderHistory = true;
                store.isLoadingHistory = false;

                await reloadChat();
            }
        } catch (error) {
            console.error('消息发送失败:', error);
        }
    }

    function handleInput() {
        checkMentionTrigger();
        sendInterruptSignal();
    }

    function handleKeyup(event) {
        if (
            event.key === 'ArrowLeft' ||
            event.key === 'ArrowRight' ||
            event.key === 'Escape'
        ) {
            hideMentionPopover();
        }
    }

    function handleKeydown(event) {
        if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            window.innerWidth > 767
        ) {
            event.preventDefault();
            sendMessage();
        }
    }

    function handleDocumentClick(event) {
        if (
            mentionPopover &&
            !mentionPopover.contains(event.target) &&
            event.target !== msgInput &&
            !msgInput.contains(event.target)
        ) {
            hideMentionPopover();
        }

        const mobileMenu = getElement('mobile-plus-menu');

        if (
            mobileMenu &&
            !event.target.closest('.plus-menu') &&
            !event.target.closest('.plus-btn-circle')
        ) {
            mobileMenu.style.display = 'none';
        }
    }

    function handleMobilePlusClick(event) {
        event.stopPropagation();

        const mobileMenu = getElement('mobile-plus-menu');

        if (!mobileMenu) {
            return;
        }

        mobileMenu.style.display =
            mobileMenu.style.display === 'block'
                ? 'none'
                : 'block';
    }

    function handleResizeStart() {
        isResizing = true;
    }

    function handleResizeMove(event) {
        if (!isResizing) {
            return;
        }

        const inputSection = getElement('input-section');

        if (!inputSection) {
            return;
        }

        const height = window.innerHeight - event.clientY;

        if (
            height > 100 &&
            height < window.innerHeight * 0.7
        ) {
            inputSection.style.height = `${height}px`;
        }
    }

    function handleResizeEnd() {
        isResizing = false;
    }

    msgInput.addEventListener('input', handleInput);
    msgInput.addEventListener('keyup', handleKeyup);
    msgInput.addEventListener('keydown', handleKeydown);

    if (btnSend) {
        btnSend.addEventListener('click', sendMessage);
    }

    document.addEventListener('click', handleDocumentClick);

    const mobilePlusButton = getElement('mobile-plus-btn');
    if (mobilePlusButton) {
        mobilePlusButton.addEventListener(
            'click',
            handleMobilePlusClick
        );
    }

    const dragHandle = getElement('drag-handle');
    if (dragHandle) {
        dragHandle.addEventListener('mousedown', handleResizeStart);
    }

    document.addEventListener('mousemove', handleResizeMove);
    document.addEventListener('mouseup', handleResizeEnd);

    function destroy() {
        destroyed = true;
        isResizing = false;

        msgInput.removeEventListener('input', handleInput);
        msgInput.removeEventListener('keyup', handleKeyup);
        msgInput.removeEventListener('keydown', handleKeydown);

        if (btnSend) {
            btnSend.removeEventListener('click', sendMessage);
        }

        document.removeEventListener('click', handleDocumentClick);

        if (mobilePlusButton) {
            mobilePlusButton.removeEventListener(
                'click',
                handleMobilePlusClick
            );
        }

        if (dragHandle) {
            dragHandle.removeEventListener(
                'mousedown',
                handleResizeStart
            );
        }

        document.removeEventListener('mousemove', handleResizeMove);
        document.removeEventListener('mouseup', handleResizeEnd);

        hideMentionPopover();
    }

    return {
        sendMessage,
        serializeContent: () => serializeContent(msgInput),
        showMentionPopover,
        hideMentionPopover,
        destroy,
    };
}
