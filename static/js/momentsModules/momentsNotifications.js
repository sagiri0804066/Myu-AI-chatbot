import {
    fetchMomentsNotificationsApi,
    markMomentsNotificationsReadApi,
} from '../api/momentsApi.js';

import { momentsStore } from '../store/momentsStore.js';
import { formatMomentTime } from './momentsView.js';

export function initMomentsNotifications({ pageContext }) {
    const banner = document.getElementById('unreadNewsBanner');
    const avatar = document.getElementById('unreadNewsAvatar');
    const text = document.getElementById('unreadNewsText');
    const modal = document.getElementById('notifModal');
    const list = document.getElementById('notifList');
    const closeButton = document.getElementById(
        'closeNotifModalButton'
    );

    function createNotificationItem(notification) {
        const item = document.createElement('div');
        item.className = 'notif-item';

        item.onclick = () => {
            if (notification.moment_uuid) {
                window.open(
                    `?moment_uuid=${encodeURIComponent(notification.moment_uuid)}`,
                    '_blank'
                );
            }
        };

        const avatarElement = document.createElement('img');
        avatarElement.className = 'notif-avatar';
        avatarElement.src = notification.avatar || '';
        avatarElement.alt = notification.nickname || '';

        const content = document.createElement('div');
        content.className = 'notif-content';

        const user = document.createElement('div');
        user.className = 'notif-user';
        user.textContent = notification.nickname || '';
        content.appendChild(user);

        if (notification.type === 'praise') {
            const action = document.createElement('div');
            action.className = 'notif-action';
            action.innerHTML = `
                <svg class="praise-svg" viewBox="0 0 24 24">
                    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                </svg>
            `;
            content.appendChild(action);
        } else {
            const comment = document.createElement('div');
            comment.className = 'notif-text';

            if (notification.reply_to) {
                comment.appendChild(document.createTextNode('回复'));

                const replyTarget = document.createElement('span');
                replyTarget.className = 'reply-target-name';
                replyTarget.textContent = notification.reply_to;

                comment.appendChild(replyTarget);
                comment.appendChild(
                    document.createTextNode(
                        `: ${notification.comment_text || ''}`
                    )
                );
            } else {
                comment.textContent =
                    notification.comment_text || '';
            }

            content.appendChild(comment);
        }

        const time = document.createElement('div');
        time.className = 'notif-time';
        time.textContent = formatMomentTime(notification.time);
        content.appendChild(time);

        const preview = document.createElement('div');
        preview.className = 'notif-target-preview';

        if (
            Array.isArray(notification.appendix) &&
            notification.appendix.length > 0
        ) {
            const image = document.createElement('img');
            image.src = notification.appendix[0];
            image.alt = '预览';
            preview.appendChild(image);
        } else {
            preview.classList.add('text-only-preview');
            preview.textContent = notification.moment_text || '';
        }

        item.append(avatarElement, content, preview);
        return item;
    }

    function renderList() {
        list.replaceChildren();

        if (momentsStore.notifications.length === 0) {
            const empty = document.createElement('div');
            empty.style.cssText =
                'text-align:center;color:#999;padding:40px 0;font-size:14px;';
            empty.textContent = '暂无新消息';
            list.appendChild(empty);
            return;
        }

        momentsStore.notifications.forEach(notification => {
            list.appendChild(createNotificationItem(notification));
        });
    }

    async function loadUnread() {
        if (pageContext.mode !== 'timeline') {
            banner.style.display = 'none';
            return;
        }

        try {
            const data = await fetchMomentsNotificationsApi();
            const notifications = Array.isArray(data?.new_messages)
                ? data.new_messages
                : [];

            momentsStore.setNotifications(notifications);

            if ((data?.len || 0) > 0 && notifications.length > 0) {
                avatar.src = notifications[0].avatar || '';
                text.textContent = `${data.len} 条新消息`;
                banner.style.display = 'flex';
            } else {
                banner.style.display = 'none';
            }
        } catch (error) {
            console.error('拉取新消息失败:', error);
        }
    }

    async function open() {
        banner.style.display = 'none';
        renderList();
        modal.style.display = 'flex';

        try {
            await markMomentsNotificationsReadApi();
        } catch (error) {
            console.error('标记消息已读失败:', error);
        }
    }

    function close() {
        modal.style.display = 'none';
    }

    banner.addEventListener('click', open);
    closeButton.addEventListener('click', close);

    return {
        loadUnread,

        destroy() {
            banner.removeEventListener('click', open);
            closeButton.removeEventListener('click', close);
        },
    };
}
