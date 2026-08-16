import { createMomentApi } from '../api/momentsApi.js';
import { momentsStore } from '../store/momentsStore.js';

const MAX_IMAGE_SIZE = 32 * 1024 * 1024;

function readImage(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = event => resolve(event.target.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}

export function initMomentsComposer({ reload, pageContext }) {
    const postIcon = document.querySelector('.post-icon');
    const modal = document.getElementById('postModal');
    const cancel = modal.querySelector('.modal-cancel');
    const submit = modal.querySelector('.modal-submit');
    const textInput = document.getElementById('postText');
    const fileInput = document.getElementById('postFileInput');
    const previews = document.getElementById('postImagePreviews');

    let submitting = false;

    function renderPreviews() {
        previews.replaceChildren();

        momentsStore.selectedPostImages.forEach((source, index) => {
            const wrapper = document.createElement('div');
            wrapper.className = 'img-preview-wrapper';

            const image = document.createElement('img');
            image.src = source;

            const remove = document.createElement('div');
            remove.className = 'remove-img-btn';
            remove.dataset.removeIndex = String(index);
            remove.innerHTML = '×';

            wrapper.append(image, remove);
            previews.appendChild(wrapper);
        });

        const placeholder = document.createElement('div');
        placeholder.className = 'upload-btn-placeholder';
        placeholder.innerHTML = '<span class="plus-icon">+</span>';
        previews.appendChild(placeholder);
    }

    function open() {
        if (pageContext.mode !== 'timeline') return;
        modal.classList.add('active');
    }

    function close() {
        if (submitting) return;

        modal.classList.remove('active');
        textInput.value = '';
        fileInput.value = '';
        momentsStore.clearPostImages();
        renderPreviews();
    }

    async function handleFiles(event) {
        const files = Array.from(event.target.files || []);
        fileInput.value = '';

        for (const file of files) {
            if (file.size > MAX_IMAGE_SIZE) {
                window.alert('单张图片文件不能超过 32MB');
                continue;
            }

            try {
                momentsStore.addPostImage(await readImage(file));
                renderPreviews();
            } catch (error) {
                console.error('读取发布图片失败:', error);
            }
        }
    }

    function handlePreviewClick(event) {
        const remove = event.target.closest('[data-remove-index]');

        if (remove) {
            momentsStore.removePostImage(
                Number.parseInt(remove.dataset.removeIndex, 10)
            );
            renderPreviews();
            return;
        }

        if (event.target.closest('.upload-btn-placeholder')) {
            fileInput.click();
        }
    }

    async function submitPost() {
        const text = textInput.value.trim();

        if (!text && momentsStore.selectedPostImages.length === 0) {
            window.alert('不能发表空白的动态...');
            return;
        }

        if (submitting) return;

        submitting = true;
        submit.disabled = true;

        try {
            await createMomentApi({
                text,
                appendix: [...momentsStore.selectedPostImages],
                senderUuid: 'user',
            });

            modal.classList.remove('active');
            textInput.value = '';
            momentsStore.clearPostImages();
            renderPreviews();

            await reload();
        } catch (error) {
            console.error('发布朋友圈失败:', error);
        } finally {
            submitting = false;
            submit.disabled = false;
        }
    }

    postIcon?.addEventListener('click', open);
    cancel.addEventListener('click', close);
    submit.addEventListener('click', submitPost);
    fileInput.addEventListener('change', handleFiles);
    previews.addEventListener('click', handlePreviewClick);

    renderPreviews();

    return {
        destroy() {
            postIcon?.removeEventListener('click', open);
            cancel.removeEventListener('click', close);
            submit.removeEventListener('click', submitPost);
            fileInput.removeEventListener('change', handleFiles);
            previews.removeEventListener('click', handlePreviewClick);
        },
    };
}
