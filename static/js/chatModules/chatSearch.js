import {
    fetchActiveDatesApi,
    searchMessagesApi,
} from '../api/chatApi.js';

function requiredElement(id) {
    const element = document.getElementById(id);

    if (!element) {
        throw new Error(`chatSearch 初始化失败：缺少 #${id}`);
    }

    return element;
}

function requiredSelector(selector) {
    const element = document.querySelector(selector);

    if (!element) {
        throw new Error(`chatSearch 初始化失败：缺少 ${selector}`);
    }

    return element;
}

function getLatestChatMonthAndYear() {
    const timeTags = document.querySelectorAll('.time-tag span');
    const now = new Date();

    for (let index = timeTags.length - 1; index >= 0; index -= 1) {
        const text = timeTags[index].textContent.trim();
        const fullDate = text.match(/^(\d{4})[-/](\d{2})[-/](\d{2})/);

        if (fullDate) {
            return {
                year: Number.parseInt(fullDate[1], 10),
                month: Number.parseInt(fullDate[2], 10) - 1,
            };
        }

        if (text.startsWith('昨天')) {
            const yesterday = new Date(now);
            yesterday.setDate(yesterday.getDate() - 1);

            return {
                year: yesterday.getFullYear(),
                month: yesterday.getMonth(),
            };
        }

        if (/^\d{2}:\d{2}$/.test(text)) {
            return {
                year: now.getFullYear(),
                month: now.getMonth(),
            };
        }
    }

    return {
        year: now.getFullYear(),
        month: now.getMonth(),
    };
}

export function initChatSearch({ jumpToMessage }) {
    if (typeof jumpToMessage !== 'function') {
        throw new TypeError(
            'chatSearch 初始化失败：jumpToMessage 必须是函数'
        );
    }

    const mask = requiredElement('search-history-mask');
    const closeButton = requiredElement('close-search-history');
    const previousButton = requiredElement('prev-month-btn');
    const nextButton = requiredElement('next-month-btn');
    const keywordInput = requiredElement('history-keyword-input');
    const searchButton = requiredElement('history-search-btn');
    const calendarTitle = requiredElement('calendar-month-year-title');
    const calendarDays = requiredElement('calendar-days-container');

    const calendarContainer = requiredSelector('.calendar-container');
    const searchModalBox = requiredSelector('.search-modal-box');

    const desktopSearchButton =
        document.getElementById('btn-desktop-search');
    const mobileSearchButton =
        document.getElementById('btn-mobile-search');

    let resultsContainer =
        document.getElementById('search-results-container');

    let displayYear = new Date().getFullYear();
    let displayMonth = new Date().getMonth();

    let destroyed = false;
    let calendarRequestGeneration = 0;
    let searchRequestGeneration = 0;

    function getResultsContainer() {
        if (resultsContainer) {
            return resultsContainer;
        }

        resultsContainer = document.createElement('div');
        resultsContainer.id = 'search-results-container';
        resultsContainer.className = 'contact-list-container';
        resultsContainer.style.cssText =
            'flex:1;overflow-y:auto;margin-top:10px;display:none;';

        searchModalBox.appendChild(resultsContainer);
        return resultsContainer;
    }

    function resetSearchView() {
        calendarContainer.style.display = 'flex';
        getResultsContainer().style.display = 'none';
        keywordInput.value = '';
    }

    function close() {
        calendarRequestGeneration += 1;
        searchRequestGeneration += 1;

        mask.style.display = 'none';
        resetSearchView();
    }

    async function open() {
        if (destroyed) {
            return;
        }

        resetSearchView();
        mask.style.display = 'flex';

        const latestDate = getLatestChatMonthAndYear();
        displayYear = latestDate.year;
        displayMonth = latestDate.month;

        await renderCalendar(displayYear, displayMonth);
    }

    function createResultItem(message) {
        const item = document.createElement('div');
        item.className = 'contact-item';
        item.style.cursor = 'pointer';

        const info = document.createElement('div');
        info.className = 'contact-info';

        const sender = document.createElement('div');
        sender.className = 'contact-name';
        sender.style.fontSize = '14px';
        sender.textContent = message.role === 'user' ? '我' : '对方';

        const details = document.createElement('div');
        details.className = 'contact-details';
        details.style.cssText =
            'font-size:13px;color:#333;margin-top:4px;';
        details.textContent = message.text || '';

        const time = document.createElement('div');
        time.style.cssText =
            'font-size:11px;color:var(--text-grey);' +
            'flex-shrink:0;align-self:flex-start;';
        time.textContent = message.time || '';

        info.append(sender, details);
        item.append(info, time);

        item.addEventListener('click', async () => {
            if (
                destroyed ||
                message.id === undefined ||
                message.id === null
            ) {
                return;
            }

            try {
                await jumpToMessage(message.id);

                if (!destroyed) {
                    close();
                }
            } catch (error) {
                console.error('跳转到搜索结果失败:', error);
            }
        });

        return item;
    }

    function showSearchResults(messages) {
        const container = getResultsContainer();

        calendarContainer.style.display = 'none';
        container.style.display = 'block';
        container.replaceChildren();

        if (messages.length === 0) {
            const empty = document.createElement('div');
            empty.textContent = '未找到相关聊天记录';
            empty.style.cssText =
                'text-align:center;color:var(--text-grey);' +
                'margin-top:40px;font-size:14px;';

            container.appendChild(empty);
            return;
        }

        messages.forEach(message => {
            container.appendChild(createResultItem(message));
        });
    }

    async function performKeywordSearch() {
        const query = keywordInput.value.trim();

        if (!query || destroyed) {
            return;
        }

        const generation = ++searchRequestGeneration;
        searchButton.disabled = true;

        try {
            const data = await searchMessagesApi(query);

            if (
                destroyed ||
                generation !== searchRequestGeneration
            ) {
                return;
            }

            const messages = Array.isArray(data?.messages)
                ? data.messages
                : [];

            showSearchResults(messages);
        } catch (error) {
            if (generation === searchRequestGeneration) {
                console.error('搜索聊天记录失败:', error);
            }
        } finally {
            if (
                !destroyed &&
                generation === searchRequestGeneration
            ) {
                searchButton.disabled = false;
            }
        }
    }

    function createCalendarCell(day, activeDays) {
        const cell = document.createElement('div');
        cell.className = 'calendar-day-cell';
        cell.textContent = String(day);

        const date =
            `${displayYear}/` +
            `${String(displayMonth + 1).padStart(2, '0')}/` +
            `${String(day).padStart(2, '0')}`;

        cell.dataset.date = date;

        if (!activeDays.has(date)) {
            return cell;
        }

        cell.classList.add('has-history');

        cell.addEventListener('click', () => {
            calendarDays
                .querySelectorAll('.calendar-day-cell')
                .forEach(element => {
                    element.classList.remove('is-selected');
                });

            cell.classList.add('is-selected');
            keywordInput.value = date;
            performKeywordSearch();
        });

        return cell;
    }

    async function renderCalendar(year, month) {
        const generation = ++calendarRequestGeneration;

        calendarTitle.textContent =
            `${year}年${String(month + 1).padStart(2, '0')}月`;

        calendarDays.replaceChildren();

        const firstDayOfWeek = new Date(year, month, 1).getDay();
        const totalDays = new Date(year, month + 1, 0).getDate();

        try {
            const data = await fetchActiveDatesApi(year, month);

            if (
                destroyed ||
                generation !== calendarRequestGeneration ||
                year !== displayYear ||
                month !== displayMonth
            ) {
                return;
            }

            const activeDays = new Set(
                Array.isArray(data?.activeDays)
                    ? data.activeDays
                    : []
            );

            const fragment = document.createDocumentFragment();

            for (let index = 0; index < firstDayOfWeek; index += 1) {
                const emptyCell = document.createElement('div');
                emptyCell.className = 'calendar-day-empty';
                fragment.appendChild(emptyCell);
            }

            for (let day = 1; day <= totalDays; day += 1) {
                fragment.appendChild(
                    createCalendarCell(day, activeDays)
                );
            }

            calendarDays.appendChild(fragment);
        } catch (error) {
            if (generation === calendarRequestGeneration) {
                console.error('获取聊天活跃日期失败:', error);
            }
        }
    }

    function showPreviousMonth() {
        displayMonth -= 1;

        if (displayMonth < 0) {
            displayMonth = 11;
            displayYear -= 1;
        }

        renderCalendar(displayYear, displayMonth);
    }

    function showNextMonth() {
        displayMonth += 1;

        if (displayMonth > 11) {
            displayMonth = 0;
            displayYear += 1;
        }

        renderCalendar(displayYear, displayMonth);
    }

    function handleMaskClick(event) {
        if (event.target === mask) {
            close();
        }
    }

    function handleKeywordKeydown(event) {
        if (event.key === 'Enter') {
            event.preventDefault();
            performKeywordSearch();
        }
    }

    closeButton.addEventListener('click', close);
    previousButton.addEventListener('click', showPreviousMonth);
    nextButton.addEventListener('click', showNextMonth);
    searchButton.addEventListener('click', performKeywordSearch);
    keywordInput.addEventListener('keydown', handleKeywordKeydown);
    mask.addEventListener('click', handleMaskClick);

    desktopSearchButton?.addEventListener('click', open);
    mobileSearchButton?.addEventListener('click', open);

    function destroy() {
        if (destroyed) {
            return;
        }

        destroyed = true;
        calendarRequestGeneration += 1;
        searchRequestGeneration += 1;

        closeButton.removeEventListener('click', close);
        previousButton.removeEventListener('click', showPreviousMonth);
        nextButton.removeEventListener('click', showNextMonth);
        searchButton.removeEventListener('click', performKeywordSearch);
        keywordInput.removeEventListener(
            'keydown',
            handleKeywordKeydown
        );
        mask.removeEventListener('click', handleMaskClick);

        desktopSearchButton?.removeEventListener('click', open);
        mobileSearchButton?.removeEventListener('click', open);

        mask.style.display = 'none';
    }

    return {
        open,
        close,
        performKeywordSearch,
        destroy,
    };
}
