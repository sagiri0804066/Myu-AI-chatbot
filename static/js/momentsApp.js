import { initTheme } from './chatModules/theme.js';
import { initMomentsView } from './momentsModules/momentsView.js';
import { initMomentsInteractions } from './momentsModules/momentsInteractions.js';
import { initMomentsComposer } from './momentsModules/momentsComposer.js';
import { initMomentsNotifications } from './momentsModules/momentsNotifications.js';
import { initMomentsProfile } from './momentsModules/momentsProfile.js';

function parsePageContext() {
    const params = new URLSearchParams(window.location.search);

    const profileUuid =
        params.get('uuid')?.trim() || null;

    const momentUuid =
        params.get('moment_uuid')?.trim() || null;

    if (profileUuid && momentUuid) {
        throw new Error(
            '非法参数：uuid 和 moment_uuid 不能同时传入'
        );
    }

    return Object.freeze({
        profileUuid,
        momentUuid,
        mode: momentUuid
            ? 'detail'
            : profileUuid
                ? 'profile'
                : 'timeline',
    });
}

async function initializeMomentsApp() {
    const pageContext = parsePageContext();

    initTheme();

    const view = initMomentsView({ pageContext });

    const interactions = initMomentsInteractions({
        reload: view.reload,
    });

    const composer = initMomentsComposer({
        reload: view.reload,
        pageContext,
    });

    const notifications = initMomentsNotifications({
        pageContext,
    });

    const profile = initMomentsProfile({
        pageContext,
        renderProfile: view.renderProfile,
    });

    await view.initialize();

    if (pageContext.mode === 'timeline') {
        await notifications.loadUnread();
    }

    return {
        view,
        interactions,
        composer,
        notifications,
        profile,
    };
}

function start() {
    initializeMomentsApp().catch(error => {
        console.error('朋友圈初始化失败:', error);

        if (
            error.message.includes(
                'uuid 和 moment_uuid 不能同时传入'
            )
        ) {
            window.alert('非法参数请求');
        }
    });
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, {
        once: true,
    });
} else {
    start();
}
