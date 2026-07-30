let db = {
    user: {
        nickname: "User",
        avatar: null,
        org: "",
        gender: "",
        birthday: "",
        hobbies: "",
        background: ""
    },
    moments: []
};

let activeMomentUuid = null; // 当前正在评论的动态
let selectedPostImages = []; // 临时存储准备发布的 Base64 数组
let newMessagesData = [];    // 存储新消息列表数据

// 提取当前 URL 里的参数
const urlParams = new URLSearchParams(window.location.search);
const senderUuid = urlParams.get('uuid');
const momentUuid = urlParams.get('moment_uuid');

// 滚动分页状态变量
let isLoadingMore = false;
let hasMore = true;

// 初始化入口
function init() {
    // 1. 参数互斥校验
    if (senderUuid && momentUuid) {
        console.error("非法参数：uuid 和 moment_uuid 不能同时传入");
        alert("非法参数请求");
        return;
    }

    // 2. 单条朋友圈详情页模式 (moment_uuid)
    if (momentUuid && momentUuid.trim() !== "") {
        // 修改导航栏标题为“详情”
        const navTitle = document.querySelector('.nav-title');
        if (navTitle) navTitle.innerText = "详情";

        // 隐藏小照相机
        const postIcon = document.querySelector('.post-icon');
        if (postIcon) postIcon.style.display = 'none';

        // 隐藏背景、头像和昵称区域
        const headerBanner = document.getElementById('headerBanner');
        if (headerBanner) headerBanner.style.display = 'none';
    }
    // 3. 个人朋友圈主页模式 (senderUuid)
    else if (senderUuid && senderUuid.trim() !== "") {
        const postIcon = document.querySelector('.post-icon');
        if (postIcon) postIcon.style.display = 'none';
    }

    initMomentsData();
    initUploadAppendixListener();

    // 监听滚动事件（详情页模式下跳过加载更多）
    window.addEventListener("scroll", (e) => {
        if (momentUuid) return; // 详情页不需要触底加载更多

        const target = (e.target === document || e.target === window)
            ? document.documentElement
            : e.target;

        if (!target) return;

        const scrollTop = target.scrollTop || 0;
        const scrollHeight = target.scrollHeight || 0;
        const clientHeight = target.clientHeight || 0;

        if (scrollHeight <= clientHeight) return;
        if (isLoadingMore || !hasMore) return;

        if (scrollTop + clientHeight >= scrollHeight - 200) {
            loadMoreMoments();
        }
    }, true);

    // 点击页面空白处，关闭所有打开的互动菜单和评论输入栏
    document.addEventListener("click", (e) => {
        if (!e.target.closest('.action-menu-container')) {
            closeAllPopups();
        }
    });
}

// 确保初始化方法一定会被执行
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
} else {
    init();
}

// 1. 初始化拉取数据
async function initMomentsData() {
    try {
        hasMore = true;
        isLoadingMore = false;

        // 检查新消息 (无附加参数时才触发)
        checkUnreadMessages();

        // 根据是否有 uuid 追加初始化请求参数
        let initUrl = '/api/moments/init';
        if (senderUuid) {
            initUrl += `?uuid=${encodeURIComponent(senderUuid)}`;
        }
        const initResponse = await fetch(initUrl);
        const userData = await initResponse.json();
        db.user = userData;

        // 根据是否有 uuid 追加历史纪录请求参数
        let historyUrl = '/api/moments/history';
        if (senderUuid) {
            historyUrl += `?uuid=${encodeURIComponent(senderUuid)}`;
        }
        if (momentUuid) {
            historyUrl += `?moment_uuid=${encodeURIComponent(momentUuid)}`;
        }
        const historyResponse = await fetch(historyUrl);
        const historyData = await historyResponse.json();
        db.moments = historyData;

        const pageSize = 20;
        if (momentUuid || !historyData || historyData.length < pageSize) {
            hasMore = false;
        }

        render();
    } catch (error) {
        console.error("加载朋友圈数据失败:", error);
    }
}

// 检查未读新消息
async function checkUnreadMessages() {
    // 如果存在 senderUuid 或 momentUuid，说明是看别人主页或特定动态，不拉取新消息
    if (senderUuid || momentUuid) {
        return;
    }

    try {
        const response = await fetch('/api/moments/new_messages');
        if (!response.ok) return;

        const data = await response.json();
        const len = data.len || 0;
        newMessagesData = data.new_messages || [];

        const banner = document.getElementById("unreadNewsBanner");
        const avatar = document.getElementById("unreadNewsAvatar");
        const text = document.getElementById("unreadNewsText");

        if (len > 0 && newMessagesData.length > 0) {
            // 获取最新一条消息的头像
            const latestMessage = newMessagesData[0];
            if (avatar) avatar.src = latestMessage.avatar || "";
            if (text) text.innerText = `${len} 条新消息`;
            if (banner) banner.style.display = "flex";
        } else {
            if (banner) banner.style.display = "none";
        }
    } catch (error) {
        console.error("拉取新消息失败:", error);
    }
}

// 点击胶囊进入消息详情页
async function openNotifModal() {
    const banner = document.getElementById("unreadNewsBanner");
    if (banner) {
        banner.style.display = "none";
    }

    renderNotifList();

    const notifModal = document.getElementById("notifModal");
    if (notifModal) {
        notifModal.style.display = "flex";
    }

    try {
        await fetch('/api/moments/read_messages', { method: 'POST' });
    } catch (e) {
        console.error("标记消息已读失败:", e);
    }
}

// 渲染消息详情列表
function renderNotifList() {
    const listContainer = document.getElementById("notifList");
    if (!listContainer) return;

    listContainer.innerHTML = "";

    if (!newMessagesData || newMessagesData.length === 0) {
        listContainer.innerHTML = `<div style="text-align: center; color: #999; padding: 40px 0; font-size: 14px;">暂无新消息</div>`;
        return;
    }

    newMessagesData.forEach(item => {
        const itemEl = document.createElement("div");
        itemEl.className = "notif-item";

        // 点击单条消息，跳转查看对应的朋友圈详情
        itemEl.onclick = () => {
            if (item.moment_uuid) {
                window.open(`?moment_uuid=${encodeURIComponent(item.moment_uuid)}`, '_blank');
            }
        };

        // 中间交互文本/图标解析
        let contentHtml = "";
        if (item.type === "praise") {
            contentHtml = `
                <div class="notif-action">
                    <svg class="praise-svg" viewBox="0 0 24 24">
                        <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path>
                    </svg>
                </div>
            `;
        } else {
            let commentBody = "";
            if (item.reply_to) {
                commentBody = `回复<span class="reply-target-name">${item.reply_to}</span>: ${item.comment_text || ''}`;
            } else {
                commentBody = item.comment_text || '';
            }
            contentHtml = `<div class="notif-text">${commentBody}</div>`;
        }

        // 右侧原动态缩略预览解析（有图显示首图，无图显示纯文本）
        let previewHtml = "";
        if (item.appendix && item.appendix.length > 0) {
            previewHtml = `
                <div class="notif-target-preview">
                    <img src="${item.appendix[0]}" alt="预览">
                </div>
            `;
        } else {
            previewHtml = `
                <div class="notif-target-preview text-only-preview">
                    ${item.moment_text || ''}
                </div>
            `;
        }

        itemEl.innerHTML = `
            <img class="notif-avatar" src="${item.avatar || ''}" alt="${item.nickname || ''}">
            <div class="notif-content">
                <div class="notif-user">${item.nickname || ''}</div>
                ${contentHtml}
                <div class="notif-time">${formatTime(item.time)}</div>
            </div>
            ${previewHtml}
        `;

        listContainer.appendChild(itemEl);
    });
}

// 关闭消息详情页函数
function closeNotifModal() {
    const notifModal = document.getElementById("notifModal");
    if (notifModal) {
        notifModal.style.display = "none";
    }
}

// 加载更多朋友圈动态
async function loadMoreMoments() {
    if (isLoadingMore || !hasMore) return;
    if (db.moments.length === 0) return;

    const lastMoment = db.moments[db.moments.length - 1];
    const cursor = lastMoment.id;

    isLoadingMore = true;
    try {
        let historyUrl = `/api/moments/history?cursor=${cursor}`;
        if (senderUuid) {
            historyUrl += `&uuid=${encodeURIComponent(senderUuid)}`;
        }

        const response = await fetch(historyUrl);
        const moreMoments = await response.json();

        const pageSize = 20;

        if (moreMoments && moreMoments.length > 0) {
            db.moments = db.moments.concat(moreMoments);
            renderMomentsList();

            if (moreMoments.length < pageSize) {
                hasMore = false;
                renderMomentsList();
            }
        } else {
            hasMore = false;
            renderMomentsList();
        }
    } catch (error) {
        console.error("加载更多朋友圈数据失败:", error);
    } finally {
        isLoadingMore = false;
    }
}

function checkAndLoadMoreIfNotScrollable() {
    if (!hasMore || isLoadingMore) return;

    const momentsList = document.getElementById("momentsList");
    let scrollContainer = document.documentElement;

    if (momentsList) {
        let parent = momentsList.parentElement;
        while (parent && parent !== document.body) {
            const style = window.getComputedStyle(parent);
            if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
                scrollContainer = parent;
                break;
            }
            parent = parent.parentElement;
        }
    }

    const scrollHeight = scrollContainer.scrollHeight;
    const clientHeight = scrollContainer.clientHeight;

    if (scrollHeight - clientHeight < 10) {
        loadMoreMoments();
    }
}

// 统一渲染
function render() {
    renderProfileHeader();
    renderMomentsList();

    setTimeout(checkAndLoadMoreIfNotScrollable, 300);
}

// 渲染头部信息
function renderProfileHeader() {
    document.getElementById("userNickname").innerText = db.user.nickname || "User";
    document.getElementById("userAvatar").src = db.user.avatar || "https://api.dicebear.com/7.x/adventurer/svg?seed=placeholder";

    const banner = document.getElementById("headerBanner");
    if (db.user.background) {
        banner.style.backgroundImage = `url('${db.user.background}')`;
    } else {
        banner.style.backgroundImage = "none";
        banner.style.backgroundColor = "#808080";
    }
}

// 格式化时间
function formatTime(timestamp) {
    const diff = Math.floor(Date.now() / 1000) - timestamp;
    if (diff < 60) return "刚刚";
    if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
    return new Date(timestamp * 1000).toLocaleDateString();
}

// 渲染朋友圈动态列表
function renderMomentsList() {
    const listContainer = document.getElementById("momentsList");
    listContainer.innerHTML = "";

    db.moments.forEach(moment => {
        const item = document.createElement("div");
        item.className = "moment-item";

        let galleryHtml = "";
        if (moment.appendix && moment.appendix.length > 0) {
            let gridClass = "gallery-more";
            if (moment.appendix.length === 1) gridClass = "gallery-1";
            else if (moment.appendix.length === 2) gridClass = "gallery-2";
            else if (moment.appendix.length === 3) gridClass = "gallery-3";

            galleryHtml = `<div class="moment-gallery ${gridClass}">`;
            moment.appendix.forEach(base64Img => {
                galleryHtml += `<img src="${base64Img}" class="gallery-img">`;
            });
            galleryHtml += `</div>`;
        }

        const hasPraises = moment.praise && moment.praise.length > 0;
        const praiseText = hasPraises ? `<i class="fa-regular fa-heart"></i> ${moment.praise.join(", ")}` : "";

        const hasComments = moment.comments && moment.comments.length > 0;
        let commentsHtml = "";
        if (hasComments) {
            commentsHtml = `<div class="comments-sublist">`;
            moment.comments.forEach(comment => {
                const replyToText = comment.reply_to_name ? ` 回复 <span class="comment-user">${comment.reply_to_name}</span>` : "";
                const senderUuid = comment.sender_uuid || "user";

                commentsHtml += `
                    <div class="comment-item" onclick="openCommentInput('${moment.uuid}', '${senderUuid}', '${comment.name}')">
                        <span class="comment-user">${comment.name}</span>${replyToText}: <span>${comment.text}</span>
                    </div>
                `;
            });
            commentsHtml += `</div>`;
        }

        let interactionBoxHtml = "";
        if (hasPraises || hasComments) {
            interactionBoxHtml = `
                <div class="interactions-box">
                    ${hasPraises ? `<div class="praise-list">${praiseText}</div>` : ""}
                    ${hasComments ? commentsHtml : ""}
                </div>
            `;
        }

        const isDeletable = moment.sender_uuid === null || moment.sender_uuid === undefined || moment.sender_uuid === "user";
        const deleteButtonHtml = isDeletable ? `
            <span class="delete-btn" onclick="deleteMoment(event, '${moment.uuid}')" title="删除动态">
                <svg class="icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg">
                    <path d="M380.565633 84.168898C391.492953 73.241577 412.883938 64.383234 428.328892 64.383234L596.182087 64.383234C611.633685 64.383234 633.010015 73.233567 643.945345 84.168898L680.111776 120.335329 344.399202 120.335329 380.565633 84.168898Z" fill="#FC5143"></path>
                    <path d="M875.944112 176.287425C891.394856 176.287425 903.92016 163.762122 903.92016 148.311377 903.92016 132.860633 891.394856 120.335329 875.944112 120.335329L148.566866 120.335329C133.116122 120.335329 120.590818 132.860633 120.590818 148.311377 120.590818 163.762122 133.116122 176.287425 148.566866 176.287425Z" fill="#FC5143"></path>
                    <path d="M180.539492 232.239521 180.254748 228.253099 228.640985 176.287425 232.637564 176.287425 280.347765 844.230242C282.63628 876.269454 312.053012 903.664671 344.377659 903.664671L680.133319 903.664671C712.845805 903.664671 741.848496 876.636282 744.163214 844.230242L791.873414 176.287425 795.869993 176.287425 844.25623 228.253099 843.971486 232.239521 180.539492 232.239521ZM847.968064 176.287425 799.973118 848.216664C795.578506 909.741242 742.362215 959.616766 680.133319 959.616766L344.377659 959.616766C282.586578 959.616766 228.909839 909.424372 224.53786 848.216664L176.542914 176.287425 847.968064 176.287425Z" fill="#FC5143"></path>
                    <path d="M484.279441 763.784431C484.279441 779.235176 496.804744 791.760479 512.255489 791.760479 527.706234 791.760479 540.231537 779.235176 540.231537 763.784431L540.231537 372.11976C540.231537 356.669016 527.706234 344.143713 512.255489 344.143713 496.804744 344.143713 484.279441 356.669016 484.279441 372.11976L484.279441 763.784431Z" fill="#FC5143"></path>
                    <path d="M607.198225 760.600957C605.851604 775.992907 617.237593 789.562199 632.629543 790.908821 648.021493 792.255442 661.590785 780.869453 662.937406 765.477503L697.073232 375.303235C698.419853 359.911285 687.033864 346.341992 671.641914 344.995371 656.249965 343.64875 642.680672 355.034739 641.334051 370.426688L607.198225 760.600957Z" fill="#FC5143"></path>
                    <path d="M361.573572 765.477503C362.920193 780.869453 376.489486 792.255442 391.881435 790.908821 407.273385 789.562199 418.659374 775.992907 417.312753 760.600957L383.176927 370.426688C381.830306 355.034739 368.261013 343.64875 352.869064 344.995371 337.477114 346.341992 326.091125 359.911285 327.437746 375.303235L361.573572 765.477503Z" fill="#FC5143"></path>
                </svg>
            </span>
        ` : "";

        item.innerHTML = `
            <img class="sender-avatar" src="${moment.avatar || 'https://api.dicebear.com/7.x/adventurer/svg?seed=placeholder'}" alt="Avatar">
            <div class="moment-content">
                <div class="sender-name">${moment.nickname}</div>
                <div class="moment-text">${moment.text}</div>
                ${galleryHtml}
                <div class="moment-footer">
                    <div class="footer-left">
                        <span class="moment-time">${formatTime(moment.id)}</span>
                        ${deleteButtonHtml}
                    </div>
                    <div class="action-menu-container">
                        <div class="action-popup" id="popup-${moment.uuid}">
                            <div class="action-popup-item" onclick="togglePraise('${moment.uuid}')">
                                <i class="fa-solid fa-heart"></i> 赞
                            </div>
                            <div class="action-popup-item" onclick="openCommentInput('${moment.uuid}')">
                                <i class="fa-solid fa-comment"></i> 评论
                            </div>
                        </div>
                        <div class="action-menu-btn" onclick="toggleActionMenu(event, '${moment.uuid}')">
                            <i class="fa-solid fa-ellipsis"></i>
                        </div>
                    </div>
                </div>
                ${interactionBoxHtml}
            </div>
        `;

        listContainer.appendChild(item);
    });

    if (!hasMore && !momentUuid) {
        const divider = document.createElement("div");
        divider.className = "no-more-divider";
        divider.textContent = db.moments.length === 0 ? "暂无动态" : "暂无更多动态";
        listContainer.appendChild(divider);
    }
}

// 2. 删除动态 API 交互
async function deleteMoment(event, uuid) {
    event.stopPropagation();
    showCustomConfirm("您确认要删除该动态吗？此操作将永久抹除其对应的数据库文件且无法找回。", async () => {
        try {
            const response = await fetch("/api/moments/delete", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ uuid: uuid })
            });
            if (response.ok) {
                initMomentsData();
            } else {
                console.error("删除失败");
            }
        } catch (e) {
            console.error("删除请求失败:", e);
        }
    });
}

// 3. 互动面板控制
function toggleActionMenu(event, uuid) {
    event.stopPropagation();
    const popup = document.getElementById(`popup-${uuid}`);
    const isActive = popup.classList.contains("active");
    closeAllPopups();
    if (!isActive) {
        popup.classList.add("active");
    }
}

function closeAllPopups() {
    document.querySelectorAll(".action-popup").forEach(p => p.classList.remove("active"));
}

// 点赞 API 交互
async function togglePraise(uuid) {
    closeAllPopups();
    try {
        const response = await fetch(`/api/moments/praise?uuid=${uuid}&sender_uuid=user`, { method: "GET" });
        if (response.ok) {
            initMomentsData();
        }
    } catch (e) {
        console.error("点赞请求失败:", e);
    }
}

// 关闭评论输入框函数
function closeCommentInput() {
    const bar = document.getElementById("commentInputBar");
    if (bar) {
        bar.classList.remove("active");
    }
    document.removeEventListener("click", handleOutsideClick);
    document.removeEventListener("touchstart", handleOutsideClick);
}

// 判断点击事件是否落在输入框外部
function handleOutsideClick(e) {
    const bar = document.getElementById("commentInputBar");
    if (bar && !bar.contains(e.target)) {
        closeCommentInput();
    }
}

// 评论输入激活
function openCommentInput(momentUuid, replyToUuid = null, replyToName = null) {
    closeAllPopups();
    activeMomentUuid = momentUuid;
    const bar = document.getElementById("commentInputBar");
    const input = document.getElementById("commentInputText");

    bar.classList.add("active");
    if (replyToUuid && replyToName) {
        input.placeholder = `回复 ${replyToName}...`;
        input.dataset.replyTo = replyToUuid;
    } else {
        input.placeholder = "评论...";
        delete input.dataset.replyTo;
    }
    input.focus();

    setTimeout(() => {
        document.removeEventListener("click", handleOutsideClick);
        document.removeEventListener("touchstart", handleOutsideClick);

        document.addEventListener("click", handleOutsideClick);
        document.addEventListener("touchstart", handleOutsideClick);
    }, 10);
}

// 提交评论
async function submitComment() {
    const input = document.getElementById("commentInputText");
    const text = input.value.trim();
    if (!text) return;

    const replyTo = input.dataset.replyTo || "";

    try {
        const response = await fetch("/api/moments/comments", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                moment_uuid: activeMomentUuid,
                sender_uuid: "user",
                text: text,
                reply_to: replyTo
            })
        });
        if (response.ok) {
            input.value = "";
            closeCommentInput();
            initMomentsData();
        }
    } catch (e) {
        console.error("提交评论请求失败:", e);
    }
}

// 4. 附件图片转换 Base64
function initUploadAppendixListener() {
    const postFileInput = document.getElementById('postFileInput');
    postFileInput.onchange = (e) => {
        const files = Array.from(e.target.files);
        files.forEach(file => {
            if (file.size > 32 * 8192 * 8192) {
                alert("单张图片文件不能超过 32MB");
                return;
            }
            const reader = new FileReader();
            reader.onload = (event) => {
                selectedPostImages.push(event.target.result);
                renderAppendixPreviews();
            };
            reader.readAsDataURL(file);
        });
        postFileInput.value = "";
    };
}

function renderAppendixPreviews() {
    const container = document.getElementById("postImagePreviews");
    const placeholder = `
        <div class="upload-btn-placeholder" onclick="document.getElementById('postFileInput').click()">
            <span class="plus-icon">+</span>
        </div>
    `;

    let imgHtml = selectedPostImages.map((base64, index) => `
        <div class="img-preview-wrapper">
            <img src="${base64}">
            <div class="remove-img-btn" onclick="removeAppendixImage(${index})">&times;</div>
        </div>
    `).join("");

    container.innerHTML = imgHtml + placeholder;
}

function removeAppendixImage(index) {
    selectedPostImages.splice(index, 1);
    renderAppendixPreviews();
}

// 5. 发送朋友圈
function openPostModal() {
    document.getElementById("postModal").classList.add("active");
}

function closePostModal() {
    document.getElementById("postModal").classList.remove("active");
    document.getElementById("postText").value = "";
    selectedPostImages = [];
    renderAppendixPreviews();
}

// 发送朋友圈
async function submitPost() {
    const text = document.getElementById("postText").value.trim();
    if (!text && selectedPostImages.length === 0) {
        alert("不能发表空白的动态...");
        return;
    }

    try {
        const response = await fetch("/api/moments/send", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                text: text,
                appendix: selectedPostImages,
                sender_uuid: "user"
            })
        });
        if (response.ok) {
            closePostModal();
            initMomentsData();
        }
    } catch (e) {
        console.error("发布朋友圈失败:", e);
    }
}

// 6. 独立修改背景逻辑
function triggerBgUpload() {
    document.getElementById('bgFileInput').click();
}

document.getElementById('bgFileInput').onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
        if (file.size > 32 * 8192 * 8192) {
            return alert("背景图不能超过 32MB");
        }
        const reader = new FileReader();
        reader.onload = async (event) => {
            const base64 = event.target.result;
            db.user.background = base64;
            renderProfileHeader();

            const urlParams = new URLSearchParams(window.location.search);
            const senderUuid = urlParams.get('uuid');

            if (!senderUuid || senderUuid === "user") {
                try {
                    await fetch('/api/message/user/profile', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(db.user)
                    });
                } catch (error) {
                    console.error("保存用户背景出错:", error);
                }
            } else {
                try {
                    const response = await fetch('/api/message/edit/contact', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(db.user)
                    });

                    const result = await response.json();
                    if (result.status !== "success") {
                        console.error("保存联系人背景失败:", result);
                    }
                } catch (error) {
                    console.error("保存联系人背景出错:", error);
                }
            }
        };
        reader.readAsDataURL(file);
    }
};

// 二级确认弹窗
function showCustomConfirm(message, onConfirm) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 99999;
        backdrop-filter: blur(2px);
    `;

    const card = document.createElement('div');
    card.style.cssText = `
        background: #fff;
        padding: 24px;
        border-radius: 12px;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
        width: 300px;
        text-align: center;
        animation: customConfirmFadeIn 0.2s ease-out;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    `;

    const styleSheet = document.createElement("style");
    styleSheet.innerText = `
        @keyframes customConfirmFadeIn {
            from { transform: scale(0.9); opacity: 0; }
            to { transform: scale(1); opacity: 1; }
        }
    `;
    document.head.appendChild(styleSheet);

    card.innerHTML = `
        <div style="font-size: 16px; font-weight: bold; color: #333; margin-bottom: 12px;">确认提示</div>
        <div style="font-size: 14px; color: #666; margin-bottom: 24px; line-height: 1.5; text-align: left;">${message}</div>
        <div style="display: flex; justify-content: space-between; gap: 12px;">
            <button id="custom-confirm-cancel" style="flex: 1; padding: 10px; border-radius: 6px; border: 1px solid #ddd; background: #fff; color: #666; cursor: pointer; font-size: 14px; outline: none; transition: background 0.2s;">取消</button>
            <button id="custom-confirm-ok" style="flex: 1; padding: 10px; border-radius: 6px; border: none; background: #FC5143; color: #fff; cursor: pointer; font-size: 14px; outline: none; font-weight: bold; transition: background 0.2s;">确认</button>
        </div>
    `;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const btnCancel = card.querySelector('#custom-confirm-cancel');
    const btnOk = card.querySelector('#custom-confirm-ok');

    const closeConfirm = () => {
        document.body.removeChild(overlay);
        document.head.removeChild(styleSheet);
    };

    btnCancel.onmouseenter = () => btnCancel.style.background = '#f5f5f5';
    btnCancel.onmouseleave = () => btnCancel.style.background = '#fff';
    btnOk.onmouseenter = () => btnOk.style.background = '#e04438';
    btnOk.onmouseleave = () => btnOk.style.background = '#FC5143';

    btnCancel.addEventListener('click', closeConfirm);
    btnOk.addEventListener('click', () => {
        closeConfirm();
        if (typeof onConfirm === 'function') {
            onConfirm();
        }
    });
}