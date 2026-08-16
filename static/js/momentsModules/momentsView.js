import {
    fetchMomentsHistoryApi,
    fetchMomentsProfileApi,
} from '../api/momentsApi.js';

import { momentsStore } from '../store/momentsStore.js';
import { escapeHTML } from '../utils/helpers.js';

const PAGE_SIZE = 20;
const DEFAULT_AVATAR =
    'https://api.dicebear.com/7.x/adventurer/svg?seed=placeholder';

function requiredElement(id) {
    const element = document.getElementById(id);
    if (!element) throw new Error(`momentsView 缺少 #${id}`);
    return element;
}

function escapeAttribute(value) {
    return escapeHTML(String(value ?? ''));
}

export function formatMomentTime(timestamp) {
    let numeric = Number(timestamp);
    if (!Number.isFinite(numeric)) return '';

    if (numeric > 1e12) {
        numeric = Math.floor(numeric / 1000);
    }

    const diff = Math.floor(Date.now() / 1000) - numeric;

    if (diff < 60) return '刚刚';
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;

    return new Date(numeric * 1000).toLocaleDateString();
}

const DELETE_ICON = `
    <svg class="icon" viewBox="0 0 1024 1024"
         version="1.1" xmlns="http://www.w3.org/2000/svg">
        <path d="M380.565633 84.168898C391.492953 73.241577 412.883938 64.383234 428.328892 64.383234L596.182087 64.383234C611.633685 64.383234 633.010015 73.233567 643.945345 84.168898L680.111776 120.335329 344.399202 120.335329 380.565633 84.168898Z" fill="#FC5143"></path>
        <path d="M875.944112 176.287425C891.394856 176.287425 903.92016 163.762122 903.92016 148.311377 903.92016 132.860633 891.394856 120.335329 875.944112 120.335329L148.566866 120.335329C133.116122 120.335329 120.590818 132.860633 120.590818 148.311377 120.590818 163.762122 133.116122 176.287425 148.566866 176.287425Z" fill="#FC5143"></path>
        <path d="M180.539492 232.239521 180.254748 228.253099 228.640985 176.287425 232.637564 176.287425 280.347765 844.230242C282.63628 876.269454 312.053012 903.664671 344.377659 903.664671L680.133319 903.664671C712.845805 903.664671 741.848496 876.636282 744.163214 844.230242L791.873414 176.287425 795.869993 176.287425 844.25623 228.253099 843.971486 232.239521 180.539492 232.239521ZM847.968064 176.287425 799.973118 848.216664C795.578506 909.741242 742.362215 959.616766 680.133319 959.616766L344.377659 959.616766C282.586578 959.616766 228.909839 909.424372 224.53786 848.216664L176.542914 176.287425 847.968064 176.287425Z" fill="#FC5143"></path>
        <path d="M484.279441 763.784431C484.279441 779.235176 496.804744 791.760479 512.255489 791.760479 527.706234 791.760479 540.231537 779.235176 540.231537 763.784431L540.231537 372.11976C540.231537 356.669016 527.706234 344.143713 512.255489 344.143713 496.804744 344.143713 484.279441 356.669016 484.279441 372.11976L484.279441 763.784431Z" fill="#FC5143"></path>
        <path d="M607.198225 760.600957C605.851604 775.992907 617.237593 789.562199 632.629543 790.908821 648.021493 792.255442 661.590785 780.869453 662.937406 765.477503L697.073232 375.303235C698.419853 359.911285 687.033864 346.341992 671.641914 344.995371 656.249965 343.64875 642.680672 355.034739 641.334051 370.426688L607.198225 760.600957Z" fill="#FC5143"></path>
        <path d="M361.573572 765.477503C362.920193 780.869453 376.489486 792.255442 391.881435 790.908821 407.273385 789.562199 418.659374 775.992907 417.312753 760.600957L383.176927 370.426688C381.830306 355.034739 368.261013 343.64875 352.869064 344.995371 337.477114 346.341992 326.091125 359.911285 327.437746 375.303235L361.573572 765.477503Z" fill="#FC5143"></path>
    </svg>
`;

function renderMoment(moment) {
    const item = document.createElement('div');
    item.className = 'moment-item';

    const uuid = escapeAttribute(moment.uuid);
    const appendix = Array.isArray(moment.appendix)
        ? moment.appendix
        : [];

    let galleryHtml = '';

    if (appendix.length > 0) {
        let gridClass = 'gallery-more';

        if (appendix.length === 1) gridClass = 'gallery-1';
        else if (appendix.length === 2) gridClass = 'gallery-2';
        else if (appendix.length === 3) gridClass = 'gallery-3';

        galleryHtml = `<div class="moment-gallery ${gridClass}">`;

        appendix.forEach(image => {
            galleryHtml += `
                <img src="${escapeAttribute(image)}"
                     class="gallery-img">
            `;
        });

        galleryHtml += '</div>';
    }

    const praises = Array.isArray(moment.praise)
        ? moment.praise
        : [];

    const comments = Array.isArray(moment.comments)
        ? moment.comments
        : [];

    let commentsHtml = '';

    if (comments.length > 0) {
        commentsHtml = '<div class="comments-sublist">';

        comments.forEach(comment => {
            const senderUuid = escapeAttribute(
                comment.sender_uuid || 'user'
            );

            const senderName = escapeHTML(comment.name || '');
            const replyName = comment.reply_to_name
                ? ` 回复 <span class="comment-user">${escapeHTML(comment.reply_to_name)}</span>`
                : '';

            commentsHtml += `
                <div class="comment-item"
                     data-action="reply"
                     data-moment-uuid="${uuid}"
                     data-reply-to-uuid="${senderUuid}"
                     data-reply-to-name="${escapeAttribute(comment.name || '')}">
                    <span class="comment-user">${senderName}</span>${replyName}:
                    <span>${escapeHTML(comment.text || '')}</span>
                </div>
            `;
        });

        commentsHtml += '</div>';
    }

    let interactionBoxHtml = '';

    if (praises.length > 0 || comments.length > 0) {
        const praiseHtml = praises.length > 0
            ? `
                <div class="praise-list">
                    <i class="fa-regular fa-heart"></i>
                    ${escapeHTML(praises.join(', '))}
                </div>
            `
            : '';

        interactionBoxHtml = `
            <div class="interactions-box">
                ${praiseHtml}
                ${commentsHtml}
            </div>
        `;
    }

    const deletable =
        moment.sender_uuid === null ||
        moment.sender_uuid === undefined ||
        moment.sender_uuid === 'user';

    const deleteHtml = deletable
        ? `
            <span class="delete-btn"
                  data-action="delete"
                  data-moment-uuid="${uuid}"
                  title="删除动态">
                ${DELETE_ICON}
            </span>
        `
        : '';

    item.innerHTML = `
        <img class="sender-avatar"
             src="${escapeAttribute(moment.avatar || DEFAULT_AVATAR)}"
             alt="Avatar">

        <div class="moment-content">
            <div class="sender-name">${escapeHTML(moment.nickname || '')}</div>
            <div class="moment-text">${escapeHTML(moment.text || '')}</div>

            ${galleryHtml}

            <div class="moment-footer">
                <div class="footer-left">
                    <span class="moment-time">
                        ${formatMomentTime(moment.id)}
                    </span>
                    ${deleteHtml}
                </div>

                <div class="action-menu-container">
                    <div class="action-popup" id="popup-${uuid}">
                        <div class="action-popup-item"
                             data-action="praise"
                             data-moment-uuid="${uuid}">
                            <i class="fa-solid fa-heart"></i> 赞
                        </div>

                        <div class="action-popup-item"
                             data-action="comment"
                             data-moment-uuid="${uuid}">
                            <i class="fa-solid fa-comment"></i> 评论
                        </div>
                    </div>

                    <div class="action-menu-btn"
                         data-action="toggle-menu"
                         data-moment-uuid="${uuid}">
                        <i class="fa-solid fa-ellipsis"></i>
                    </div>
                </div>
            </div>

            ${interactionBoxHtml}
        </div>
    `;

    return item;
}

export function initMomentsView({ pageContext }) {
    const list = requiredElement('momentsList');
    const nickname = requiredElement('userNickname');
    const avatar = requiredElement('userAvatar');
    const banner = requiredElement('headerBanner');

    let destroyed = false;
    let heightCheckTimer = null;

    function applyPageMode() {
        const navTitle = document.querySelector('.nav-title');
        const postIcon = document.querySelector('.post-icon');

        if (pageContext.mode === 'detail') {
            if (navTitle) navTitle.textContent = '详情';
            if (postIcon) postIcon.style.display = 'none';
            banner.style.display = 'none';
        } else if (pageContext.mode === 'profile') {
            if (postIcon) postIcon.style.display = 'none';
        }
    }

    function renderProfile() {
        nickname.textContent =
            momentsStore.profile.nickname || 'User';

        avatar.src =
            momentsStore.profile.avatar || DEFAULT_AVATAR;

        if (momentsStore.profile.background) {
            banner.style.backgroundImage =
                `url('${momentsStore.profile.background}')`;
            banner.style.backgroundColor = '';
        } else {
            banner.style.backgroundImage = 'none';
            banner.style.backgroundColor = '#808080';
        }
    }

    function renderMoments() {
        list.replaceChildren();

        momentsStore.moments.forEach(moment => {
            list.appendChild(renderMoment(moment));
        });

        if (
            !momentsStore.hasMore &&
            pageContext.mode !== 'detail'
        ) {
            const divider = document.createElement('div');
            divider.className = 'no-more-divider';
            divider.textContent = momentsStore.moments.length === 0
                ? '暂无动态'
                : '暂无更多动态';

            list.appendChild(divider);
        }
    }

    function scheduleHeightCheck() {
        clearTimeout(heightCheckTimer);

        heightCheckTimer = setTimeout(() => {
            if (
                !destroyed &&
                momentsStore.hasMore &&
                !momentsStore.isLoadingMore
            ) {
                const container = document.querySelector('.moments-scroll');
                if (
                    container &&
                    container.scrollHeight - container.clientHeight < 10
                ) {
                    loadMore();
                }
            }
        }, 300);
    }

    function render() {
        renderProfile();
        renderMoments();
        scheduleHeightCheck();
    }

    async function reload() {
        momentsStore.resetPagination();

        try {
            const [profile, history] = await Promise.all([
                fetchMomentsProfileApi(pageContext.profileUuid),
                fetchMomentsHistoryApi({
                    profileUuid: pageContext.profileUuid,
                    momentUuid: pageContext.momentUuid,
                }),
            ]);

            if (destroyed) return false;

            momentsStore.setProfile(profile);
            momentsStore.setMoments(history);

            if (
                pageContext.mode === 'detail' ||
                momentsStore.moments.length < PAGE_SIZE
            ) {
                momentsStore.hasMore = false;
            }

            render();
            return true;
        } catch (error) {
            console.error('加载朋友圈数据失败:', error);
            return false;
        }
    }

    async function loadMore() {
        if (
            destroyed ||
            pageContext.mode === 'detail' ||
            momentsStore.isLoadingMore ||
            !momentsStore.hasMore ||
            momentsStore.moments.length === 0
        ) {
            return;
        }

        const lastMoment =
            momentsStore.moments[momentsStore.moments.length - 1];

        momentsStore.isLoadingMore = true;

        try {
            const more = await fetchMomentsHistoryApi({
                cursor: lastMoment.id,
                profileUuid: pageContext.profileUuid,
            });

            const messages = Array.isArray(more) ? more : [];
            momentsStore.appendMoments(messages);

            if (messages.length < PAGE_SIZE) {
                momentsStore.hasMore = false;
            }

            renderMoments();
            scheduleHeightCheck();
        } catch (error) {
            console.error('加载更多朋友圈失败:', error);
        } finally {
            momentsStore.isLoadingMore = false;
        }
    }

    function handleScroll(event) {
        if (
            pageContext.mode === 'detail' ||
            momentsStore.isLoadingMore ||
            !momentsStore.hasMore
        ) {
            return;
        }

        const target =
            event.target === window || event.target === document
                ? document.documentElement
                : event.target;

        if (!target || target.scrollHeight <= target.clientHeight) return;

        if (
            target.scrollTop + target.clientHeight >=
            target.scrollHeight - 200
        ) {
            loadMore();
        }
    }

    applyPageMode();
    window.addEventListener('scroll', handleScroll, true);

    return {
        initialize: reload,
        reload,
        loadMore,
        renderProfile,
        renderMoments,

        destroy() {
            destroyed = true;
            clearTimeout(heightCheckTimer);
            window.removeEventListener('scroll', handleScroll, true);
        },
    };
}
