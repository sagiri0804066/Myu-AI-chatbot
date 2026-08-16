import {
    editContactApi,
    updateUserProfileApi,
} from '../api/chatApi.js';

import { momentsStore } from '../store/momentsStore.js';

const MAX_BACKGROUND_SIZE = 32 * 1024 * 1024;

export function initMomentsProfile({
    pageContext,
    renderProfile,
}) {
    const banner = document.getElementById('headerBanner');
    const input = document.getElementById('bgFileInput');
    const userProfile = banner.querySelector('.user-profile');

    function openPicker() {
        if (pageContext.mode !== 'detail') {
            input.click();
        }
    }

    function handleBannerClick(event) {
        if (!event.target.closest('.user-profile')) {
            openPicker();
        }
    }

    async function handleFile(event) {
        const file = event.target.files?.[0];
        input.value = '';

        if (!file) return;

        if (file.size > MAX_BACKGROUND_SIZE) {
            window.alert('背景图不能超过 32MB');
            return;
        }

        const reader = new FileReader();

        reader.onload = async loadEvent => {
            const previous = momentsStore.profile.background;
            const base64 = loadEvent.target.result;

            momentsStore.profile.background = base64;
            renderProfile();

            try {
                const profile = {
                    ...momentsStore.profile,
                    background: base64,
                };

                if (
                    !pageContext.profileUuid ||
                    pageContext.profileUuid === 'user'
                ) {
                    await updateUserProfileApi(profile);
                } else {
                    await editContactApi(profile);
                }
            } catch (error) {
                momentsStore.profile.background = previous;
                renderProfile();
                console.error('保存背景失败:', error);
            }
        };

        reader.onerror = () => {
            console.error('读取背景图片失败:', reader.error);
        };

        reader.readAsDataURL(file);
    }

    function stopProfileClick(event) {
        event.stopPropagation();
    }

    banner.addEventListener('click', handleBannerClick);
    input.addEventListener('change', handleFile);
    userProfile?.addEventListener('click', stopProfileClick);

    return {
        destroy() {
            banner.removeEventListener('click', handleBannerClick);
            input.removeEventListener('change', handleFile);
            userProfile?.removeEventListener(
                'click',
                stopProfileClick
            );
        },
    };
}
