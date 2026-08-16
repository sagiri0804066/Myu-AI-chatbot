/**
 * 显示二次确认模态弹窗
 * @param {string} message 提示信息文本
 * @param {Function} onConfirm 确认后的回调函数
 */
export function showCustomConfirm(message, onConfirm) {
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
    <div style="font-size: 16px; font-weight: bold; color: #333; margin-bottom: 12px;">
        确认提示
    </div>
    <div class="custom-confirm-message"
         style="font-size: 14px; color: #666; margin-bottom: 24px; line-height: 1.5; text-align: left;">
    </div>
    <div style="display: flex; justify-content: space-between; gap: 12px;">
        <button type="button" class="custom-confirm-cancel"
                style="flex: 1; padding: 10px; border-radius: 6px; border: 1px solid #ddd; background: #fff; color: #666; cursor: pointer; font-size: 14px;">
            取消
        </button>
        <button type="button" class="custom-confirm-ok"
                style="flex: 1; padding: 10px; border-radius: 6px; border: none; background: #FC5143; color: #fff; cursor: pointer; font-size: 14px; font-weight: bold;">
            确认
        </button>
    </div>
`;

    card.querySelector('.custom-confirm-message').textContent = message;

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const btnCancel = card.querySelector('.custom-confirm-cancel');
    const btnOk = card.querySelector('.custom-confirm-ok');

    const closeConfirm = () => {
        if (overlay.parentNode) {
            document.body.removeChild(overlay);
        }
        if (styleSheet.parentNode) {
            document.head.removeChild(styleSheet);
        }
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