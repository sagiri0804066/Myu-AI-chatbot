import { initTheme } from './chatModules/theme.js';
import { initChatView } from './chatModules/chatView.js';
import { initChatInput } from './chatModules/chatInput.js';
import { initUserSettings } from './chatModules/userSettings.js';
import { initContactManager } from './chatModules/contactManager.js';
import { initChatSearch } from './chatModules/chatSearch.js';
import { initUserCard } from './chatModules/userCard.js';

let appInstance = null;
let initializationPromise = null;

async function initializeApp() {
    if (appInstance) {
        return appInstance;
    }

    const initializedModules = [];

    try {
        initTheme();

        const chatView = initChatView();
        initializedModules.push(chatView);

        const chatInput = initChatInput({
            renderChat: chatView.render,
            reloadChat: chatView.reload,
        });
        initializedModules.push(chatInput);

        const userSettings = initUserSettings({
            renderChat: chatView.render,
        });
        initializedModules.push(userSettings);

        const contactManager = initContactManager({
            reloadChat: chatView.reload,
        });
        initializedModules.push(contactManager);

        const chatSearch = initChatSearch({
            jumpToMessage: chatView.jumpToMessage,
        });
        initializedModules.push(chatSearch);

        const userCard = initUserCard({
            reloadChat: chatView.reload,
        });
        initializedModules.push(userCard);

        // reload() 内部负责初始化失败重试和启动长轮询。
        const initialLoadSucceeded = await chatView.reload();

        if (initialLoadSucceeded) {
            contactManager.renderContacts();
        }

        appInstance = {
            chatView,
            chatInput,
            userSettings,
            contactManager,
            chatSearch,
            userCard,

            destroy() {
                [...initializedModules].reverse().forEach(module => {
                    try {
                        module.destroy?.();
                    } catch (error) {
                        console.error('销毁模块失败:', error);
                    }
                });

                appInstance = null;
                initializationPromise = null;
            },
        };

        return appInstance;
    } catch (error) {
        [...initializedModules].reverse().forEach(module => {
            try {
                module.destroy?.();
            } catch (destroyError) {
                console.error('清理已初始化模块失败:', destroyError);
            }
        });

        throw error;
    }
}

function startApp() {
    if (initializationPromise) {
        return initializationPromise;
    }

    initializationPromise = initializeApp().catch(error => {
        initializationPromise = null;
        console.error('聊天应用初始化失败:', error);
        throw error;
    });

    return initializationPromise;
}

function handleStartError() {
    // 错误已由 startApp() 统一记录。
}

if (document.readyState === 'loading') {
    document.addEventListener(
        'DOMContentLoaded',
        () => {
            startApp().catch(handleStartError);
        },
        { once: true }
    );
} else {
    startApp().catch(handleStartError);
}
