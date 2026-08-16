import {
    createMomentCommentApi,
    deleteMomentApi,
    toggleMomentPraiseApi,
} from '../api/momentsApi.js';

import { momentsStore } from '../store/momentsStore.js';
import { showCustomConfirm } from '../utils/dialog.js';

export function initMomentsInteractions({ reload }) {
    const list = document.getElementById('momentsList');
    const bar = document.getElementById('commentInputBar');
    const input = document.getElementById('commentInputText');
    const sendButton = document.getElementById('sendCommentBtn');

    let submitting = false;

    function closeAllPopups() {
        document.querySelectorAll('.action-popup').forEach(popup => {
            popup.classList.remove('active');
        });
    }

    function closeCommentInput() {
        bar.classList.remove('active');
        input.placeholder = '评论...';
        delete input.dataset.replyTo;
        momentsStore.clearActiveMoment();
    }

    function openCommentInput(uuid, replyUuid = '', replyName = '') {
        closeAllPopups();
        momentsStore.setActiveMoment(uuid);

        bar.classList.add('active');

        if (replyUuid && replyName) {
            input.placeholder = `回复 ${replyName}...`;
            input.dataset.replyTo = replyUuid;
        } else {
            input.placeholder = '评论...';
            delete input.dataset.replyTo;
        }

        input.focus();
    }

    async function submitComment() {
        const text = input.value.trim();

        if (
            submitting ||
            !text ||
            !momentsStore.activeMomentUuid
        ) {
            return;
        }

        submitting = true;
        sendButton.disabled = true;

        try {
            await createMomentCommentApi({
                momentUuid: momentsStore.activeMomentUuid,
                senderUuid: 'user',
                text,
                replyTo: input.dataset.replyTo || '',
            });

            input.value = '';
            closeCommentInput();
            await reload();
        } catch (error) {
            console.error('提交评论失败:', error);
        } finally {
            submitting = false;
            sendButton.disabled = false;
        }
    }

    function confirmDelete(uuid) {
        showCustomConfirm(
            '您确认要删除该动态吗？此操作将永久抹除其对应的数据库文件且无法找回。',
            async () => {
                try {
                    await deleteMomentApi(uuid);
                    await reload();
                } catch (error) {
                    console.error('删除动态失败:', error);
                }
            }
        );
    }

    async function handleListClick(event) {
        const target = event.target.closest('[data-action]');
        if (!target || !list.contains(target)) return;

        const action = target.dataset.action;
        const uuid = target.dataset.momentUuid;

        event.stopPropagation();

        if (action === 'toggle-menu') {
            const popup = document.getElementById(`popup-${uuid}`);
            const shouldOpen = !popup?.classList.contains('active');

            closeAllPopups();
            if (shouldOpen) popup?.classList.add('active');
        }

        if (action === 'praise') {
            closeAllPopups();

            try {
                await toggleMomentPraiseApi(uuid);
                await reload();
            } catch (error) {
                console.error('点赞失败:', error);
            }
        }

        if (action === 'comment') {
            openCommentInput(uuid);
        }

        if (action === 'reply') {
            openCommentInput(
                uuid,
                target.dataset.replyToUuid,
                target.dataset.replyToName
            );
        }

        if (action === 'delete') {
            confirmDelete(uuid);
        }
    }

    function handleDocumentClick(event) {
        if (!event.target.closest('.action-menu-container')) {
            closeAllPopups();
        }

        if (
            bar.classList.contains('active') &&
            !bar.contains(event.target)
        ) {
            closeCommentInput();
        }
    }

    function stopCommentBarPropagation(event) {
        event.stopPropagation();
    }

    list.addEventListener('click', handleListClick);
    sendButton.addEventListener('click', submitComment);
    bar.addEventListener('click', stopCommentBarPropagation);
    document.addEventListener('click', handleDocumentClick);

    return {
        destroy() {
            list.removeEventListener('click', handleListClick);
            sendButton.removeEventListener('click', submitComment);
            bar.removeEventListener('click', stopCommentBarPropagation);
            document.removeEventListener('click', handleDocumentClick);
        },
    };
}
