import { updateUserProfileApi } from '../api/chatApi.js';
import { store } from '../store/chatStore.js';

const MAX_AVATAR_SIZE = 32 * 1024 * 1024;

function getRequiredElement(id) {
    const element = document.getElementById(id);

    if (!element) {
        throw new Error(`userSettings 初始化失败：缺少 #${id}`);
    }

    return element;
}

function renderAvatarPreview(container, avatar) {
    container.replaceChildren();

    if (avatar) {
        const image = document.createElement('img');
        image.src = avatar;
        image.alt = '头像预览';

        image.addEventListener('error', () => {
            image.remove();
        }, { once: true });

        container.appendChild(image);
    }

    const plusOverlay = document.createElement('div');
    plusOverlay.className = 'plus-overlay';
    plusOverlay.textContent = '+';

    container.appendChild(plusOverlay);
}

/**
 * 初始化当前用户资料编辑模块。
 *
 * @param {object} dependencies
 * @param {Function} dependencies.renderChat 用户资料更新后重新渲染聊天区
 */
export function initUserSettings({ renderChat }) {
    if (typeof renderChat !== 'function') {
        throw new TypeError(
            'userSettings 初始化失败：renderChat 必须是函数'
        );
    }

    const modal = getRequiredElement('modal-overlay');
    const btnOpen = getRequiredElement('btn-open-profile');
    const btnClose = getRequiredElement('btn-modal-close');
    const btnSave = getRequiredElement('btn-modal-save');

    const nicknameInput = getRequiredElement('edit-nickname');
    const orgInput = getRequiredElement('edit-org');
    const birthdayInput = getRequiredElement('edit-birthday');
    const hobbiesInput = getRequiredElement('edit-hobbies');
    const genderInput = getRequiredElement('edit-gender');

    const avatarInput = getRequiredElement('avatar-input');
    const avatarPreview = getRequiredElement(
        'avatar-preview-target'
    );

    let destroyed = false;
    let isSaving = false;
    let temporaryAvatar = null;
    let fileReadGeneration = 0;

    function fillForm() {
        nicknameInput.value = store.user.nickname || '';
        orgInput.value = store.user.org || '';
        birthdayInput.value = store.user.birthday || '';
        hobbiesInput.value = store.user.hobbies || '';
        genderInput.value = store.user.gender || '';

        temporaryAvatar = store.user.avatar || null;
        avatarInput.value = '';

        renderAvatarPreview(avatarPreview, temporaryAvatar);
    }

    function open() {
        if (destroyed) {
            return;
        }

        fileReadGeneration += 1;
        fillForm();
        modal.style.display = 'flex';
    }

    function close() {
        if (destroyed || isSaving) {
            return;
        }

        fileReadGeneration += 1;
        temporaryAvatar = null;
        avatarInput.value = '';
        modal.style.display = 'none';
    }

    function handleAvatarPreviewClick() {
        if (!isSaving) {
            avatarInput.click();
        }
    }

    function handleAvatarChange(event) {
        const file = event.target.files?.[0];

        if (!file) {
            return;
        }

        if (file.size > MAX_AVATAR_SIZE) {
            avatarInput.value = '';
            window.alert('头像图片不能超过 32MB');
            return;
        }

        const currentGeneration = ++fileReadGeneration;
        const reader = new FileReader();

        reader.addEventListener('load', loadEvent => {
            if (
                destroyed ||
                currentGeneration !== fileReadGeneration
            ) {
                return;
            }

            const result = loadEvent.target?.result;

            if (typeof result !== 'string') {
                return;
            }

            temporaryAvatar = result;
            renderAvatarPreview(avatarPreview, temporaryAvatar);
        });

        reader.addEventListener('error', () => {
            if (currentGeneration === fileReadGeneration) {
                console.error('读取头像文件失败');
                avatarInput.value = '';
            }
        });

        reader.readAsDataURL(file);
    }

    function readProfileFromForm() {
        return {
            nickname: nicknameInput.value,
            org: orgInput.value,
            birthday: birthdayInput.value,
            hobbies: hobbiesInput.value,
            gender: genderInput.value,
            avatar: temporaryAvatar,
        };
    }

    async function save() {
        if (destroyed || isSaving) {
            return;
        }

        const updatedProfile = readProfileFromForm();

        isSaving = true;
        btnSave.disabled = true;

        try {
            await updateUserProfileApi(updatedProfile);

            if (destroyed) {
                return;
            }

            store.updateUserProfile(updatedProfile);
            modal.style.display = 'none';
            avatarInput.value = '';

            renderChat();
        } catch (error) {
            console.error('保存用户资料失败:', error);
        } finally {
            isSaving = false;
            btnSave.disabled = false;
        }
    }

    function handleModalBackgroundClick(event) {
        if (event.target === modal) {
            close();
        }
    }

    btnOpen.addEventListener('click', open);
    btnClose.addEventListener('click', close);
    btnSave.addEventListener('click', save);

    avatarPreview.addEventListener(
        'click',
        handleAvatarPreviewClick
    );
    avatarInput.addEventListener(
        'change',
        handleAvatarChange
    );
    modal.addEventListener(
        'click',
        handleModalBackgroundClick
    );

    function destroy() {
        if (destroyed) {
            return;
        }

        destroyed = true;
        fileReadGeneration += 1;

        btnOpen.removeEventListener('click', open);
        btnClose.removeEventListener('click', close);
        btnSave.removeEventListener('click', save);

        avatarPreview.removeEventListener(
            'click',
            handleAvatarPreviewClick
        );
        avatarInput.removeEventListener(
            'change',
            handleAvatarChange
        );
        modal.removeEventListener(
            'click',
            handleModalBackgroundClick
        );

        modal.style.display = 'none';
        temporaryAvatar = null;
    }

    return {
        open,
        close,
        destroy,
    };
}
