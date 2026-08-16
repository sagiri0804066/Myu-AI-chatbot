import {
    deleteContactApi,
    editContactApi,
    switchContactApi,
} from '../api/chatApi.js';

import { store } from '../store/chatStore.js';
import { escapeHTML } from '../utils/helpers.js';
import { showCustomConfirm } from '../utils/dialog.js';

const DEFAULT_CONTACT_AVATAR =
    `data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" fill="%23ddd"><rect width="100" height="100"/><circle cx="50" cy="40" r="20" fill="%23999"/><path d="M20 90c0-15 10-25 30-25s30 10 30 25z" fill="%23999"/></svg>`;

/**
 * 初始化联系人与群组管理模块。
 *
 */
export function initContactManager() {
    let currentEditingContactUuid = null;
    let tempContactAvatarBase64 = '';

    const btnContacts = document.getElementById('btn-contacts');
    const contactsModal = document.getElementById('contacts-modal');
    const btnContactsClose = document.getElementById('btn-contacts-close');
    const btnContactAdd = document.getElementById('btn-contact-add');
    const contactList = document.getElementById('contact-list');

    const contactEditModal = document.getElementById('contact-edit-modal');
    const btnContactEditBack = document.getElementById('btn-contact-edit-back');
    const contactEditTitle = document.getElementById('contact-edit-title');
    const typeSelectContainer = document.getElementById('type-select-container');
    const contactEditType = document.getElementById('contact-edit-type');
    const contactEditNickname = document.getElementById('contact-edit-nickname');
    const contactEditDetails = document.getElementById('contact-edit-details');

    const groupMembersArea = document.getElementById('group-members-area');
    const membersDetails = document.getElementById('members-details');
    const selectedMembersCount = document.getElementById('selected-members-count');
    const groupMembersChecklist = document.getElementById('group-members-checklist');

    const lblNickname = document.getElementById('lbl-contact-nickname');
    const lblDetails = document.getElementById('lbl-contact-details');
    const btnContactSave = document.getElementById('btn-contact-save');

    const contactAvatarInput = document.getElementById('contact-avatar-input');
    const contactAvatarPreview = document.getElementById(
        'contact-avatar-preview-target'
    );

    function toggleGroupFields(type) {
        if (type === 'G') {
            groupMembersArea.style.display = 'block';
            lblNickname.textContent = '群聊名称';
            lblDetails.textContent = '群聊描述';
            contactEditDetails.setAttribute(
                'placeholder',
                '请输入群聊描述信息...'
            );
        } else {
            groupMembersArea.style.display = 'none';
            lblNickname.textContent = '昵称';
            lblDetails.textContent = '详细信息';
            contactEditDetails.setAttribute(
                'placeholder',
                '请输入联系人详细信息...'
            );
        }
    }

    function updateSelectedCount() {
        const checkedBoxes = groupMembersChecklist.querySelectorAll(
            '.member-checkbox:checked'
        );

        selectedMembersCount.textContent =
            `(已选 ${checkedBoxes.length} 人)`;
    }

    function renderGroupMembersChecklist(selectedUuids = []) {
        groupMembersChecklist.innerHTML = '';

        const privateContacts = store.contacts.filter(
            contact => contact.type === 'P' || !contact.type
        );

        if (privateContacts.length === 0) {
            groupMembersChecklist.innerHTML =
                '<div style="color: #999; font-size: 13px; text-align: center; padding: 15px 0;">暂无可添加的联系人</div>';

            selectedMembersCount.textContent = '(已选 0 人)';
            return;
        }

        privateContacts.forEach(contact => {
            const isChecked = selectedUuids.includes(contact.uuid);
            const itemDiv = document.createElement('div');

            itemDiv.style.cssText =
                'display: flex; align-items: center; gap: 10px; padding: 6px 0; border-bottom: 1px solid #f5f5f5;';

            const avatarSrc =
                contact.avatar || DEFAULT_CONTACT_AVATAR;

            itemDiv.innerHTML = `
                <input
                    type="checkbox"
                    class="member-checkbox"
                    value="${contact.uuid}"
                    ${isChecked ? 'checked' : ''}
                    style="cursor: pointer; width: 16px; height: 16px; flex-shrink: 0;"
                >
                <img
                    src="${avatarSrc}"
                    style="width: 30px; height: 30px; border-radius: 4px; object-fit: cover; flex-shrink: 0;"
                >
                <span
                    style="font-size: 14px; color: #333; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                >${escapeHTML(contact.nickname)}</span>
            `;

            itemDiv
                .querySelector('.member-checkbox')
                .addEventListener('change', updateSelectedCount);

            groupMembersChecklist.appendChild(itemDiv);
        });

        updateSelectedCount();
    }

    function openNewContact() {
        currentEditingContactUuid = null;
        tempContactAvatarBase64 = '';
        contactEditTitle.textContent = '新增联系人';

        typeSelectContainer.style.display = 'block';
        contactEditType.value = 'P';
        toggleGroupFields('P');

        contactEditNickname.value = '';
        contactEditDetails.value = '';

        membersDetails.removeAttribute('open');
        renderGroupMembersChecklist([]);

        contactAvatarPreview.innerHTML =
            '<div class="plus-overlay">+</div>';

        contactsModal.style.display = 'none';
        contactEditModal.style.display = 'flex';
    }

    function openEditContact(uuid) {
        const contact = store.contacts.find(
            item => item.uuid === uuid
        );

        if (!contact) return;

        currentEditingContactUuid = uuid;
        tempContactAvatarBase64 = contact.avatar || '';
        contactEditTitle.textContent = '修改联系人';

        typeSelectContainer.style.display = 'none';

        const contactType = contact.type || 'P';
        contactEditType.value = contactType;
        toggleGroupFields(contactType);

        contactEditNickname.value = contact.nickname;
        contactEditDetails.value = contact.card_data || '';

        membersDetails.removeAttribute('open');
        renderGroupMembersChecklist(contact.members || []);

        if (contact.avatar) {
            contactAvatarPreview.innerHTML = `
                <img src="${contact.avatar}" alt="avatar">
                <div class="plus-overlay">+</div>
            `;
        } else {
            contactAvatarPreview.innerHTML =
                '<div class="plus-overlay">+</div>';
        }

        contactsModal.style.display = 'none';
        contactEditModal.style.display = 'flex';
    }

    async function deleteContact(uuid) {
        showCustomConfirm(
            '您确认要删除该联系人吗？此操作将永久抹除其对应的数据库文件且无法找回。',
            async () => {
                try {
                    await deleteContactApi(uuid);
                    store.removeContact(uuid);
                    renderContacts();
                } catch (error) {
                    console.error('删除联系人失败:', error);
                }
            }
        );
    }

    function renderContacts() {
        contactList.innerHTML = '';

        const listToRender = store.contacts || [];

        listToRender.forEach(contact => {
            const item = document.createElement('div');
            item.className = 'contact-item';

            const avatarSrc =
                contact.avatar || DEFAULT_CONTACT_AVATAR;

            const typeBadge =
                contact.type === 'G'
                    ? '<span style="background: #e1f5fe; color: #039be5; font-size:10px; padding:2px 4px; border-radius:4px; margin-right:4px;">群</span>'
                    : '';

            item.innerHTML = `
                <div class="contact-avatar">
                    <img src="${avatarSrc}" alt="avatar">
                </div>
                <div class="contact-info">
                    <div class="contact-name">${typeBadge}${escapeHTML(contact.nickname)}</div>
                    <div class="contact-details">${escapeHTML(contact.card_data || '')}</div>
                </div>
                <div class="contact-actions">
                    <div class="contact-action-btn chat-btn" data-uuid="${contact.uuid}">
                        <svg t="1779562001970" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="10935" width="18" height="18">
                            <path d="M930.503111 1019.448889a43.804444 43.804444 0 0 1-22.528-6.257778l-190.236444-113.749333A576.540444 576.540444 0 0 1 512 936.618667c-282.311111 0-512-198.343111-512-442.140445C0 250.680889 229.688889 52.337778 512 52.337778s512 198.343111 512 442.140444c0 107.576889-44.145778 209.294222-125.041778 289.649778l72.334222 173.368889c7.395556 17.749333 2.673778 38.286222-11.690666 50.944-8.248889 7.281778-18.631111 11.008-29.098667 11.008z" fill="currentColor"></path>
                        </svg>
                    </div>
                    <div class="contact-action-btn edit-btn" data-uuid="${contact.uuid}">
                        <svg t="1779558880431" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="7697" width="18" height="18">
                            <path d="M550.4 292.48l180.992 180.992-422.4 422.4H128v-181.034667l422.4-422.4z m60.330667-60.373333l90.496-90.496a42.666667 42.666667 0 0 1 60.330666 0l120.704 120.661333a42.666667 42.666667 0 0 1 0 60.373333l-90.538666 90.496-180.992-181.034666z" fill="currentColor"></path>
                        </svg>
                    </div>
                    <div class="contact-action-btn delete-btn" data-uuid="${contact.uuid}">
                        <svg t="1779558902630" class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="8874" width="18" height="18">
                            <path d="M380.565633 84.168898C391.492953 73.241577 412.883938 64.383234 428.328892 64.383234L596.182087 64.383234C611.633685 64.383234 633.010015 73.233567 643.945345 84.168898L680.111776 120.335329 344.399202 120.335329 380.565633 84.168898ZM875.944112 176.287425C891.394856 176.287425 903.92016 163.762122 903.92016 148.311377 903.92016 132.860633 891.394856 120.335329 875.944112 120.335329L148.566866 120.335329C133.116122 120.335329 120.590818 132.860633 120.590818 148.311377 120.590818 163.762122 133.116122 176.287425 148.566866 176.287425L875.944112 176.287425ZM180.539492 232.239521 180.254748 228.253099 228.640985 176.287425 232.637564 176.287425 280.347765 844.230242C282.63628 876.269454 312.053012 903.664671 344.377659 903.664671L680.133319 903.664671C712.845805 903.664671 741.848496 876.636282 744.163214 844.230242L791.873414 176.287425 795.869993 176.287425 844.25623 228.253099 843.971486 232.239521 180.539492 232.239521ZM847.968064 176.287425 799.973118 848.216664C795.578506 909.741242 742.362215 959.616766 680.133319 959.616766L344.377659 959.616766C282.586578 959.616766 228.909839 909.424372 224.53786 848.216664L176.542914 176.287425 847.968064 176.287425ZM484.279441 763.784431C484.279441 779.235176 496.804744 791.760479 512.255489 791.760479 527.706234 791.760479 540.231537 779.235176 540.231537 763.784431L540.231537 372.11976C540.231537 356.669016 527.706234 344.143713 512.255489 344.143713 496.804744 344.143713 484.279441 356.669016 484.279441 372.11976L484.279441 763.784431ZM607.198225 760.600957C605.851604 775.992907 617.237593 789.562199 632.629543 790.908821 648.021493 792.255442 661.590785 780.869453 662.937406 765.477503L697.073232 375.303235C698.419853 359.911285 687.033864 346.341992 671.641914 344.995371 656.249965 343.64875 642.680672 355.034739 641.334051 370.426688L607.198225 760.600957ZM361.573572 765.477503C362.920193 780.869453 376.489486 792.255442 391.881435 790.908821 407.273385 789.562199 418.659374 775.992907 417.312753 760.600957L383.176927 370.426688C381.830306 355.034739 368.261013 343.64875 352.869064 344.995371 337.477114 343.64875 326.091125 359.911285 327.437746 375.303235L361.573572 765.477503Z" fill="#FC5143"></path>
                        </svg>
                    </div>
                </div>
            `;

            item
                .querySelector('.chat-btn')
                .addEventListener('click', async event => {
                    event.stopPropagation();

                    try {
                        await switchContactApi(contact.uuid);
                        window.location.reload();
                    } catch (error) {
                        console.error('切换联系人失败:', error);
                    }
                });

            item
                .querySelector('.edit-btn')
                .addEventListener('click', event => {
                    event.stopPropagation();
                    openEditContact(contact.uuid);
                });

            item
                .querySelector('.delete-btn')
                .addEventListener('click', event => {
                    event.stopPropagation();
                    deleteContact(contact.uuid);
                });

            contactList.appendChild(item);
        });
    }

    async function saveContact() {
        const typeVal = contactEditType.value;
        const nameVal = contactEditNickname.value.trim();
        const detailsVal = contactEditDetails.value.trim();

        let membersArr = [];

        if (!nameVal) {
            contactEditNickname.focus();
            return;
        }

        if (typeVal === 'G') {
            const checkedBoxes =
                groupMembersChecklist.querySelectorAll(
                    '.member-checkbox:checked'
                );

            membersArr = Array
                .from(checkedBoxes)
                .map(checkbox => checkbox.value);
        }

        btnContactSave.disabled = true;

        try {
            if (currentEditingContactUuid === null) {
                const result = await editContactApi({
                    uuid: 'new',
                    type: typeVal,
                    nickname: nameVal,
                    avatar: tempContactAvatarBase64 || null,
                    card_data: detailsVal,
                    members: membersArr,
                });

                store.contacts.push({
                    uuid: result.uuid,
                    type: typeVal,
                    nickname: nameVal,
                    avatar: tempContactAvatarBase64 || null,
                    card_data: detailsVal,
                    members: membersArr,
                });
            } else {
                await editContactApi({
                    uuid: currentEditingContactUuid,
                    type: typeVal,
                    nickname: nameVal,
                    avatar: tempContactAvatarBase64 || null,
                    card_data: detailsVal,
                    members: membersArr,
                });

                const contact = store.contacts.find(
                    item => item.uuid === currentEditingContactUuid
                );

                if (contact) {
                    contact.type = typeVal;
                    contact.nickname = nameVal;
                    contact.card_data = detailsVal;
                    contact.members = membersArr;

                    if (tempContactAvatarBase64) {
                        contact.avatar = tempContactAvatarBase64;
                    }
                }

                await switchContactApi(currentEditingContactUuid);
                window.location.reload();
            }

            contactEditModal.style.display = 'none';
            contactsModal.style.display = 'flex';
            renderContacts();
        } catch (error) {
            console.error('保存联系人失败:', error);
        } finally {
            btnContactSave.disabled = false;
        }
    }

    function handleContactAvatarChange(event) {
        const file = event.target.files[0];

        if (!file) return;

        const reader = new FileReader();

        reader.onload = loadEvent => {
            tempContactAvatarBase64 = loadEvent.target.result;

            contactAvatarPreview.innerHTML = `
                <img src="${tempContactAvatarBase64}" alt="avatar">
                <div class="plus-overlay">+</div>
            `;
        };

        reader.readAsDataURL(file);
    }

    contactEditType.addEventListener('change', event => {
        toggleGroupFields(event.target.value);
    });

    btnContacts.addEventListener('click', () => {
        contactsModal.style.display = 'flex';
        renderContacts();
    });

    btnContactsClose.addEventListener('click', () => {
        contactsModal.style.display = 'none';
    });

    btnContactAdd.addEventListener('click', openNewContact);

    btnContactEditBack.addEventListener('click', () => {
        contactEditModal.style.display = 'none';
        contactsModal.style.display = 'flex';
    });

    contactAvatarPreview.addEventListener('click', () => {
        contactAvatarInput.click();
    });

    contactAvatarInput.addEventListener(
        'change',
        handleContactAvatarChange
    );

    btnContactSave.addEventListener('click', saveContact);

    renderContacts();

    return {
        renderContacts,
        openEditContact,
    };
}
