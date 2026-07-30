(function () {
    let displayYear = new Date().getFullYear();
    let displayMonth = new Date().getMonth();
    let isEventsInitialized = false;

    let keywordInput = null;
    let searchBtn = null;

    // 挂载全局方法
    window.chatSearchModule = {
        open: function () {
            const mask = document.getElementById("search-history-mask");
            if (!mask) return;
            mask.style.display = "flex";

            resetSearchView();

            const latestDate = getLatestChatMonthAndYear();
            displayYear = latestDate.year;
            displayMonth = latestDate.month;

            initEventsOnce();
            renderCalendar(displayYear, displayMonth);
        },
        close: function () {
            const mask = document.getElementById("search-history-mask");
            if (mask) mask.style.display = "none";
            resetSearchView();
        }
    };

    // HTML 转义
    function escapeHTML(str) {
        if (!str) return '';
        return str.replace(/[&<>'"]/g,
            tag => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[tag] || tag)
        );
    }

    // 重置检索状态，恢复日历显示
    function resetSearchView() {
        const calendarContainer = document.querySelector(".calendar-container");
        const resultsContainer = document.getElementById("search-results-container");

        if (calendarContainer) calendarContainer.style.display = "flex";
        if (resultsContainer) resultsContainer.style.display = "none";
        if (keywordInput) keywordInput.value = "";
    }

    // 解析当前页面上最新的一条聊天日期
    function getLatestChatMonthAndYear() {
        const timeTags = document.querySelectorAll(".time-tag span");
        const now = new Date();

        if (timeTags.length === 0) {
            return { year: now.getFullYear(), month: now.getMonth() };
        }

        for (let i = timeTags.length - 1; i >= 0; i--) {
            const text = timeTags[i].textContent.trim();

            const matchFull = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);
            if (matchFull) {
                return {
                    year: parseInt(matchFull[1], 10),
                    month: parseInt(matchFull[2], 10) - 1
                };
            }

            if (text.startsWith("昨天")) {
                const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
                return {
                    year: yesterday.getFullYear(),
                    month: yesterday.getMonth()
                };
            }

            if (/^\d{2}:\d{2}$/.test(text)) {
                return {
                    year: now.getFullYear(),
                    month: now.getMonth()
                };
            }
        }

        return { year: now.getFullYear(), month: now.getMonth() };
    }

    // 核心检索逻辑
    async function performKeywordSearch() {
        if (!keywordInput) return;
        const query = keywordInput.value.trim();
        if (!query) return;

        try {
            const res = await fetch(`/api/message/search?query=${encodeURIComponent(query)}`);
            if (!res.ok) throw new Error("搜索失败");
            const data = await res.json();

            showSearchResults(data.messages || []);
        } catch (e) {
            console.error(e);
        }
    }

    // 初始化事件绑定
    function initEventsOnce() {
        if (isEventsInitialized) return;

        const closeBtn = document.getElementById("close-search-history");
        const prevMonthBtn = document.getElementById("prev-month-btn");
        const nextMonthBtn = document.getElementById("next-month-btn");
        const mask = document.getElementById("search-history-mask");

        keywordInput = document.getElementById("history-keyword-input");
        searchBtn = document.getElementById("history-search-btn");

        if (closeBtn) closeBtn.onclick = () => window.chatSearchModule.close();
        if (mask) {
            mask.onclick = (e) => {
                if (e.target === mask) window.chatSearchModule.close();
            };
        }

        if (prevMonthBtn) {
            prevMonthBtn.onclick = () => {
                displayMonth--;
                if (displayMonth < 0) { displayMonth = 11; displayYear--; }
                renderCalendar(displayYear, displayMonth);
            };
        }
        if (nextMonthBtn) {
            nextMonthBtn.onclick = () => {
                displayMonth++;
                if (displayMonth > 11) { displayMonth = 0; displayYear++; }
                renderCalendar(displayYear, displayMonth);
            };
        }

        if (keywordInput && searchBtn) {
            searchBtn.onclick = performKeywordSearch;
            keywordInput.onkeypress = (e) => {
                if (e.key === "Enter") performKeywordSearch();
            };
        }

        isEventsInitialized = true;
    }

    // 动态渲染结果列表
    function showSearchResults(messages) {
        const calendarContainer = document.querySelector(".calendar-container");
        let resultsContainer = document.getElementById("search-results-container");

        if (!resultsContainer) {
            resultsContainer = document.createElement("div");
            resultsContainer.id = "search-results-container";
            resultsContainer.className = "contact-list-container";
            resultsContainer.style.cssText = "flex: 1; overflow-y: auto; margin-top: 10px;";
            document.querySelector(".search-modal-box").appendChild(resultsContainer);
        }

        calendarContainer.style.display = "none";
        resultsContainer.style.display = "block";
        resultsContainer.innerHTML = "";

        if (messages.length === 0) {
            resultsContainer.innerHTML = '<div style="text-align: center; color: var(--text-grey); margin-top: 40px; font-size: 14px;">未找到相关聊天记录</div>';
            return;
        }

        messages.forEach(msg => {
            const item = document.createElement("div");
            item.className = "contact-item";
            item.style.cursor = "pointer";
            item.innerHTML = `
                <div class="contact-info">
                    <div class="contact-name" style="font-size: 14px;">${msg.role === 'user' ? '我' : '对方'}</div>
                    <div class="contact-details" style="font-size: 13px; color: #333; margin-top: 4px;">${escapeHTML(msg.text)}</div>
                </div>
                <div style="font-size: 11px; color: var(--text-grey); flex-shrink: 0; align-self: flex-start;">${msg.time}</div>
            `;

            // 点击该聊天记录跳转，传递 id 作为唯一键
            item.onclick = () => {
                if (window.jumpToMessageContext) {
                    window.jumpToMessageContext(msg.id);
                }
            };
            resultsContainer.appendChild(item);
        });
    }

    // 获取有历史记录的日期数据
    async function fetchHistoryDatesFromServer(year, month) {
        const formattedMonth = String(month + 1).padStart(2, '0');
        const yearMonth = `${year}/${formattedMonth}`;

        try {
            const res = await fetch(`/api/message/active_dates?year_month=${encodeURIComponent(yearMonth)}`);
            if (!res.ok) throw new Error("获取日期失败");
            return await res.json();
        } catch (e) {
            console.error(e);
            return { activeDays: [] };
        }
    }

    // 渲染日历网格
    async function renderCalendar(year, month) {
        const title = document.getElementById("calendar-month-year-title");
        const container = document.getElementById("calendar-days-container");
        if (!title || !container) return;

        title.textContent = `${year}年${String(month + 1).padStart(2, '0')}月`;
        container.innerHTML = "";

        const firstDayOfWeek = new Date(year, month, 1).getDay();
        const totalDays = new Date(year, month + 1, 0).getDate();

        for (let i = 0; i < firstDayOfWeek; i++) {
            const emptyCell = document.createElement("div");
            emptyCell.className = "calendar-day-empty";
            container.appendChild(emptyCell);
        }

        const data = await fetchHistoryDatesFromServer(year, month);
        const activeDays = data.activeDays || [];

        for (let day = 1; day <= totalDays; day++) {
            const cell = document.createElement("div");
            cell.className = "calendar-day-cell";
            cell.textContent = day;

            const dateStr = `${year}/${String(month + 1).padStart(2, '0')}/${String(day).padStart(2, '0')}`;
            cell.setAttribute("data-date", dateStr);

            if (activeDays.includes(dateStr)) {
                cell.classList.add("has-history");
                cell.onclick = () => {
                    document.querySelectorAll(".calendar-day-cell").forEach(c => c.classList.remove("is-selected"));
                    cell.classList.add("is-selected");

                    // 点击日期，直接填充搜索框并触发检索
                    if (keywordInput) {
                        keywordInput.value = dateStr;
                        performKeywordSearch();
                    }
                };
            }
            container.appendChild(cell);
        }
    }
})();