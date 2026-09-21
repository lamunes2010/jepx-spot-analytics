/**
 * JEPX Spot Analytics メインアプリケーションロジック
 * 2画面並列・比較 & カレンダー2期間比較分析 & 完全静的オフライン/オンライン両対応
 */

document.addEventListener('DOMContentLoaded', async () => {
    // 状態管理
    const state = {
        dateA: null, // 上段: 基準日
        dateB: null, // 下段: 比較日
        availableDates: [],
        currentTab: 'daily',
        visibleAreas: ['system', 'tokyo', 'kansai', 'kyushu'],
        dayRecordsA: [],
        dayRecordsB: [],
        stats: {},
        // カレンダー分析用ステート
        calendarArea: 'kyushu', // デフォルト: 九州
        calendarStartSlot: 17,  // 08:00 (17コマ目)
        calendarEndSlot: 40,    // 20:00 (40コマ目)
        // 曜日・祝日フィルター (平日・土曜・日曜・祝日)
        dayFilters: {
            weekday: true,
            saturday: true,
            sunday: true,
            holiday: true
        },
        // グラフ比較重ね合わせ
        showCompareChart: false,
        // カレンダー2期間比較ステート
        calStartA: null,
        calEndA: null,
        calStartB: null,
        calEndB: null
    };

    const renderer = new window.EnechangeRenderer();
    const db = window.jepxDB;

    // DOM要素 (上段 A)
    const datePickerA = document.getElementById('date-picker-a');
    const displayBoxA = document.getElementById('current-date-display-a');
    const prevDateBtnA = document.getElementById('btn-prev-date-a');
    const nextDateBtnA = document.getElementById('btn-next-date-a');
    const todayDateBtnA = document.getElementById('btn-today-date-a');
    const dateTextA = document.getElementById('date-text-a');

    // DOM要素 (下段 B)
    const datePickerB = document.getElementById('date-picker-b');
    const displayBoxB = document.getElementById('current-date-display-b');
    const prevDateBtnB = document.getElementById('btn-prev-date-b');
    const nextDateBtnB = document.getElementById('btn-next-date-b');
    const todayDateBtnB = document.getElementById('btn-today-date-b');
    const dateTextB = document.getElementById('date-text-b');
    const comparePrevDayBtn = document.getElementById('btn-compare-prevday');
    const comparePrevWeekBtn = document.getElementById('btn-compare-prevweek');
    const comparePrevYearBtn = document.getElementById('btn-compare-prevyear');

    // カレンダー共通DOM
    const calendarAreaSelect = document.getElementById('calendar-area-select');
    const sliderTimeStart = document.getElementById('slider-time-start');
    const sliderTimeEnd = document.getElementById('slider-time-end');
    const sliderTimeDisplay = document.getElementById('slider-time-display');
    const calPresetBtns = document.querySelectorAll('.cal-preset-btn');
    const calFilterWeekday = document.getElementById('cal-filter-weekday');
    const calFilterSaturday = document.getElementById('cal-filter-saturday');
    const calFilterSunday = document.getElementById('cal-filter-sunday');
    const calFilterHoliday = document.getElementById('cal-filter-holiday');

    // カレンダー期間 A DOM
    const calRangeStartA = document.getElementById('cal-range-start-a');
    const calRangeEndA = document.getElementById('cal-range-end-a');
    const calRangePresetsA = document.querySelectorAll('.cal-range-preset-a');

    // カレンダー期間 B DOM
    const calRangeStartB = document.getElementById('cal-range-start-b');
    const calRangeEndB = document.getElementById('cal-range-end-b');
    const btnCalPrevYear = document.getElementById('btn-cal-prev-year');
    const btnCalPrevPeriod = document.getElementById('btn-cal-prev-period');
    const btnCalPrevMonth = document.getElementById('btn-cal-prev-month');

    // その他共通DOM
    const areaTogglesContainer = document.getElementById('area-toggles');
    const toggleCompareChart = document.getElementById('toggle-compare-chart');
    const tabButtons = document.querySelectorAll('.tab-btn');
    const mobileTabButtons = document.querySelectorAll('.mobile-tab-btn');
    const btnMobileMenuToggle = document.getElementById('btn-mobile-menu-toggle');
    const mobileMenuDropdown = document.getElementById('mobile-menu-dropdown');
    const tabContents = document.querySelectorAll('.tab-content');

    /**
     * 日付文字列が完全な 'YYYY-MM-DD' 形式か検証
     */
    function isValidDateStr(str) {
        if (!str || typeof str !== 'string') return false;
        const match = str.match(/^(\d{4})-(\d{2})-(\d{2})$/);
        if (!match) return false;
        const y = parseInt(match[1], 10);
        const m = parseInt(match[2], 10);
        const d = parseInt(match[3], 10);
        return y >= 2018 && y <= 2035 && m >= 1 && m <= 12 && d >= 1 && d <= 31;
    }

    /**
     * アプリケーション初期化
     */
    async function initApp() {
        try {
            showLoading(true, 'JEPXデータを準備中...');
            await db.init();

            // サーバーの静的データ同期
            await db.syncLatest();

            let dates = await db.getAvailableDates();

            if (dates.length === 0 && window.SampleDataGenerator) {
                const sampleRecords = window.SampleDataGenerator.generate(60);
                await db.bulkInsert(sampleRecords);
                dates = await db.getAvailableDates();
            }

            state.availableDates = dates;

            if (dates.length > 0) {
                // 初期選択日: 上段は最新日、下段は前日
                state.dateA = dates[dates.length - 1];
                state.dateB = dates.length > 1 ? dates[dates.length - 2] : dates[dates.length - 1];

                // カレンダー初期期間: 期間 A 直近30日間
                const latestDateObj = new Date(state.dateA);
                const past30Obj = new Date(latestDateObj);
                past30Obj.setDate(past30Obj.getDate() - 29);
                const past30Str = past30Obj.toISOString().split('T')[0];

                state.calEndA = state.dateA;
                state.calStartA = dates[0] > past30Str ? dates[0] : past30Str;

                // 期間 B: 1年前同期間 (2025年同期間)
                const pastYearEndObj = new Date(latestDateObj);
                pastYearEndObj.setFullYear(pastYearEndObj.getFullYear() - 1);
                const pastYearStartObj = new Date(past30Obj);
                pastYearStartObj.setFullYear(pastYearStartObj.getFullYear() - 1);

                state.calEndB = pastYearEndObj.toISOString().split('T')[0];
                state.calStartB = pastYearStartObj.toISOString().split('T')[0];
            }

            updateDatePickersRange();
            updateCalendarTimeSliders();
            updateCalendarRangeInputs();

            renderAreaToggles();
            setupEventListeners();
            await loadDataA();
            await loadDataB();
            renderCalendarAnalysis(); // 期間比較分析も初期ロードしておく

        } catch (err) {
            console.error('初期化エラー:', err);
        } finally {
            showLoading(false);
        }
    }

    /**
     * 日付選択カレンダーの範囲と表示を更新
     */
    function updateDatePickersRange() {
        const dates = state.availableDates;
        if (!dates || dates.length === 0) return;

        const minDate = dates[0];
        const maxDate = dates[dates.length - 1];

        if (datePickerA) {
            datePickerA.min = minDate;
            datePickerA.max = maxDate;
            datePickerA.value = state.dateA;
        }
        if (datePickerB) {
            datePickerB.min = minDate;
            datePickerB.max = maxDate;
            datePickerB.value = state.dateB;
        }

        updateDateTextDisplay();
    }

    /**
     * 日付ラベルのテキスト表示を更新 (祝日名は非表示、曜日ごとに色分け: 平日=白, 土曜=青, 日曜=赤, 祝日=オレンジ)
     */
    function updateDateTextDisplay() {
        const renderDateHtml = (dateStr) => {
            if (!dateStr) return '--年--月--日 (-)';
            const parts = dateStr.split('-');
            const d = new Date(dateStr);
            const days = ['日', '月', '火', '水', '木', '金', '土'];
            const dayOfWeek = days[d.getDay()];
            const holiday = window.japaneseHolidays ? window.japaneseHolidays.getHolidayName(dateStr) : null;
            
            let colorClass = 'text-slate-100 font-bold'; // 平日: 白
            if (holiday) {
                colorClass = 'text-amber-400 font-extrabold'; // 祝日: オレンジ
            } else if (d.getDay() === 0) {
                colorClass = 'text-rose-400 font-extrabold'; // 日曜: 赤
            } else if (d.getDay() === 6) {
                colorClass = 'text-blue-400 font-extrabold'; // 土曜: 青
            }

            const titleTip = holiday ? `title="祝日: ${holiday}"` : '';
            return `<span class="text-white">${parts[0]}年${parts[1]}月${parts[2]}日</span> <span class="${colorClass}" ${titleTip}>(${dayOfWeek})</span>`;
        };

        if (dateTextA) dateTextA.innerHTML = renderDateHtml(state.dateA);
        if (dateTextB) dateTextB.innerHTML = renderDateHtml(state.dateB);
    }

    /**
     * 上段（基準日 A）のデータを読み込み描画
     */
    async function loadDataA() {
        if (!state.dateA) return;
        state.dayRecordsA = await db.getDayData(state.dateA);
        renderer.renderEnechangeMatrix('enechange-matrix-container-a', state.dayRecordsA);
        updateCharts();
        updateDateTextDisplay();
        setupScrollSync(); // 再描画後に必ずスクロール同期を再接続
    }

    /**
     * 下段（比較日 B）のデータを読み込み描画
     */
    async function loadDataB() {
        if (!state.dateB) return;
        state.dayRecordsB = await db.getDayData(state.dateB);
        renderer.renderEnechangeMatrix('enechange-matrix-container-b', state.dayRecordsB);
        updateCharts();
        updateDateTextDisplay();
        setupScrollSync(); // 再描画後に必ずスクロール同期を再接続
    }

    /**
     * 48コマ価格チャートと約定総量チャートの更新
     */
    function updateCharts() {
        renderer.renderDailyChart(
            'daily-price-chart',
            state.dayRecordsA,
            state.dayRecordsB,
            state.showCompareChart,
            state.visibleAreas,
            state.dateA,
            state.dateB
        );

        renderer.renderVolumeChart('volume-chart', state.dayRecordsA);
    }

    /**
     * カレンダー2期間比較分析の描画
     */
    async function renderCalendarAnalysis() {
        if (!isValidDateStr(state.calStartA) || !isValidDateStr(state.calEndA) ||
            !isValidDateStr(state.calStartB) || !isValidDateStr(state.calEndB)) {
            return;
        }

        // 入力欄のフォーカスを奪わないよう、テーブルエリアのみにインラインローディングを表示
        const containerA = document.getElementById('calendar-container-a');
        const containerB = document.getElementById('calendar-container-b');
        if (containerA) containerA.innerHTML = '<div class="p-8 text-center text-slate-400 font-bold text-sm">期間A データを集計中...</div>';
        if (containerB) containerB.innerHTML = '<div class="p-8 text-center text-slate-400 font-bold text-sm">期間B データを集計中...</div>';

        try {
            const recordsA = await db.getDateRangeData(state.calStartA, state.calEndA);
            const recordsB = await db.getDateRangeData(state.calStartB, state.calEndB);

            renderer.renderCalendarSection(
                'calendar-container-a',
                'calendar-summary-bar-a',
                recordsA,
                state.calendarArea,
                state.calendarStartSlot,
                state.calendarEndSlot,
                (selectedDate) => {
                    state.dateA = selectedDate;
                    switchTab('daily');
                    loadDataA();
                },
                state.dayFilters
            );

            renderer.renderCalendarSection(
                'calendar-container-b',
                'calendar-summary-bar-b',
                recordsB,
                state.calendarArea,
                state.calendarStartSlot,
                state.calendarEndSlot,
                (selectedDate) => {
                    state.dateB = selectedDate;
                    switchTab('daily');
                    loadDataB();
                },
                state.dayFilters
            );
        } catch (e) {
            console.error('カレンダー描画エラー:', e);
        }
    }

    /**
     * カレンダーの時間帯デュアルスライダーの表示更新
     */
    function updateCalendarTimeSliders() {
        if (!sliderTimeStart || !sliderTimeEnd) return;

        sliderTimeStart.value = state.calendarStartSlot;
        sliderTimeEnd.value = state.calendarEndSlot;

        const startTimeStr = window.EnechangeRenderer.formatSlotTime(state.calendarStartSlot, false);
        const endTimeStr = window.EnechangeRenderer.formatSlotTime(state.calendarEndSlot, true);

        if (sliderTimeDisplay) {
            sliderTimeDisplay.textContent = `${startTimeStr} 〜 ${endTimeStr}`;
        }

        const highlight = document.getElementById('dual-slider-highlight');
        if (highlight) {
            const leftPercent = ((state.calendarStartSlot - 1) / 47) * 100;
            const rightPercent = ((state.calendarEndSlot - 1) / 47) * 100;
            const widthPercent = Math.max(0, rightPercent - leftPercent);
            highlight.style.left = `${leftPercent}%`;
            highlight.style.width = `${widthPercent}%`;
        }
    }

    /**
     * カレンダーの期間入力欄を更新
     */
    function updateCalendarRangeInputs() {
        if (calRangeStartA && isValidDateStr(state.calStartA)) calRangeStartA.value = state.calStartA;
        if (calRangeEndA && isValidDateStr(state.calEndA)) calRangeEndA.value = state.calEndA;
        if (calRangeStartB && isValidDateStr(state.calStartB)) calRangeStartB.value = state.calStartB;
        if (calRangeEndB && isValidDateStr(state.calEndB)) calRangeEndB.value = state.calEndB;
    }

    /**
     * 2つのマトリクス表の横スクロール連動（再接続対応）
     */
    let isSyncingScroll = false;
    function setupScrollSync() {
        setTimeout(() => {
            const wrapA = document.querySelector('#enechange-matrix-container-a .matrix-scroll-wrapper');
            const wrapB = document.querySelector('#enechange-matrix-container-b .matrix-scroll-wrapper');

            if (!wrapA || !wrapB) return;

            // 以前のリスナーと混ざらないよう、新しいハンドラーを登録
            wrapA.onscroll = () => {
                if (!isSyncingScroll) {
                    isSyncingScroll = true;
                    wrapB.scrollLeft = wrapA.scrollLeft;
                    requestAnimationFrame(() => { isSyncingScroll = false; });
                }
            };

            wrapB.onscroll = () => {
                if (!isSyncingScroll) {
                    isSyncingScroll = true;
                    wrapA.scrollLeft = wrapB.scrollLeft;
                    requestAnimationFrame(() => { isSyncingScroll = false; });
                }
            };
        }, 100);
    }

    /**
     * グラフのエリア表示トグルボタンの生成
     */
    function renderAreaToggles() {
        if (!areaTogglesContainer) return;
        areaTogglesContainer.innerHTML = '';

        window.ENECHANGE_ROWS.forEach(cfg => {
            const isChecked = state.visibleAreas.includes(cfg.key);
            const label = document.createElement('label');
            label.className = `flex items-center gap-1 text-[11px] px-2 py-0.5 rounded cursor-pointer transition-colors border ${
                isChecked ? 'bg-slate-800 text-white border-slate-600' : 'bg-slate-900/50 text-slate-500 border-slate-800'
            }`;
            label.innerHTML = `
                <input type="checkbox" value="${cfg.key}" ${isChecked ? 'checked' : ''} class="hidden">
                <span class="w-2 h-2 rounded-full" style="background-color: ${cfg.color}"></span>
                <span>${cfg.name}</span>
            `;

            label.querySelector('input').addEventListener('change', (e) => {
                if (e.target.checked) {
                    if (!state.visibleAreas.includes(cfg.key)) state.visibleAreas.push(cfg.key);
                } else {
                    state.visibleAreas = state.visibleAreas.filter(k => k !== cfg.key);
                }
                renderAreaToggles();
                updateCharts();
            });

            areaTogglesContainer.appendChild(label);
        });
    }

    /**
     * タブ切り替え処理
     */
    function switchTab(tabKey) {
        state.currentTab = tabKey;

        tabButtons.forEach(btn => {
            const active = btn.getAttribute('data-tab') === tabKey;
            btn.className = active
                ? 'tab-btn px-4 py-1.5 text-xs md:text-sm font-extrabold rounded-md transition-all border-b-2 border-blue-400 text-blue-400 bg-slate-800/60'
                : 'tab-btn px-4 py-1.5 text-xs md:text-sm font-extrabold rounded-md transition-all border-b-2 border-transparent text-slate-400 hover:text-white hover:bg-slate-800/40';
        });

        mobileTabButtons.forEach(btn => {
            const active = btn.getAttribute('data-tab') === tabKey;
            btn.classList.toggle('active', active);
        });

        tabContents.forEach(content => {
            if (content.id === `tab-content-${tabKey}`) {
                content.classList.remove('hidden');
            } else {
                content.classList.add('hidden');
            }
        });

        if (mobileMenuDropdown) mobileMenuDropdown.classList.add('hidden');

        if (tabKey === 'daily') {
            setupScrollSync();
            updateCharts();
        } else if (tabKey === 'calendar') {
            renderCalendarAnalysis();
        }
    }

    /**
     * イベントリスナーの登録
     */
    function setupEventListeners() {
        // タブ切り替え
        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
        });
        mobileTabButtons.forEach(btn => {
            btn.addEventListener('click', () => switchTab(btn.getAttribute('data-tab')));
        });

        // スマホメニュー開閉
        if (btnMobileMenuToggle && mobileMenuDropdown) {
            btnMobileMenuToggle.addEventListener('click', () => {
                mobileMenuDropdown.classList.toggle('hidden');
            });
        }

        // ================= 上段 A 日付ピッカー操作 =================
        // 表示ボックスクリックでネイティブカレンダーを開く
        if (displayBoxA && datePickerA) {
            displayBoxA.addEventListener('click', () => {
                try {
                    if (typeof datePickerA.showPicker === 'function') {
                        datePickerA.showPicker();
                    } else {
                        datePickerA.focus();
                    }
                } catch (err) {
                    datePickerA.focus();
                }
            });
        }

        if (datePickerA) {
            datePickerA.addEventListener('change', (e) => {
                if (isValidDateStr(e.target.value)) {
                    state.dateA = e.target.value;
                    loadDataA();
                }
            });
        }
        if (prevDateBtnA) {
            prevDateBtnA.addEventListener('click', () => {
                const idx = state.availableDates.indexOf(state.dateA);
                if (idx > 0) {
                    state.dateA = state.availableDates[idx - 1];
                    updateDatePickersRange();
                    loadDataA();
                }
            });
        }
        if (nextDateBtnA) {
            nextDateBtnA.addEventListener('click', () => {
                const idx = state.availableDates.indexOf(state.dateA);
                if (idx < state.availableDates.length - 1) {
                    state.dateA = state.availableDates[idx + 1];
                    updateDatePickersRange();
                    loadDataA();
                }
            });
        }
        if (todayDateBtnA) {
            todayDateBtnA.addEventListener('click', () => {
                state.dateA = state.availableDates[state.availableDates.length - 1];
                updateDatePickersRange();
                loadDataA();
            });
        }

        // ================= 下段 B 日付ピッカー操作 =================
        if (displayBoxB && datePickerB) {
            displayBoxB.addEventListener('click', () => {
                try {
                    if (typeof datePickerB.showPicker === 'function') {
                        datePickerB.showPicker();
                    } else {
                        datePickerB.focus();
                    }
                } catch (err) {
                    datePickerB.focus();
                }
            });
        }

        if (datePickerB) {
            datePickerB.addEventListener('change', (e) => {
                if (isValidDateStr(e.target.value)) {
                    state.dateB = e.target.value;
                    loadDataB();
                }
            });
        }
        if (prevDateBtnB) {
            prevDateBtnB.addEventListener('click', () => {
                const idx = state.availableDates.indexOf(state.dateB);
                if (idx > 0) {
                    state.dateB = state.availableDates[idx - 1];
                    updateDatePickersRange();
                    loadDataB();
                }
            });
        }
        if (nextDateBtnB) {
            nextDateBtnB.addEventListener('click', () => {
                const idx = state.availableDates.indexOf(state.dateB);
                if (idx < state.availableDates.length - 1) {
                    state.dateB = state.availableDates[idx + 1];
                    updateDatePickersRange();
                    loadDataB();
                }
            });
        }
        if (todayDateBtnB) {
            todayDateBtnB.addEventListener('click', () => {
                state.dateB = state.availableDates[state.availableDates.length - 1];
                updateDatePickersRange();
                loadDataB();
            });
        }

        // クイック比較プリセット
        if (comparePrevDayBtn) {
            comparePrevDayBtn.addEventListener('click', () => {
                const d = new Date(state.dateA);
                d.setDate(d.getDate() - 1);
                state.dateB = d.toISOString().split('T')[0];
                updateDatePickersRange();
                loadDataB();
            });
        }
        if (comparePrevWeekBtn) {
            comparePrevWeekBtn.addEventListener('click', () => {
                const d = new Date(state.dateA);
                d.setDate(d.getDate() - 7);
                state.dateB = d.toISOString().split('T')[0];
                updateDatePickersRange();
                loadDataB();
            });
        }
        if (comparePrevYearBtn) {
            comparePrevYearBtn.addEventListener('click', () => {
                const d = new Date(state.dateA);
                d.setFullYear(d.getFullYear() - 1);
                state.dateB = d.toISOString().split('T')[0];
                updateDatePickersRange();
                loadDataB();
            });
        }

        // 比較日グラフ重ね合わせトグル
        if (toggleCompareChart) {
            toggleCompareChart.addEventListener('change', (e) => {
                state.showCompareChart = e.target.checked;
                updateCharts();
            });
        }

        // カレンダーコントロール: エリア
        if (calendarAreaSelect) {
            calendarAreaSelect.addEventListener('change', (e) => {
                state.calendarArea = e.target.value;
                renderCalendarAnalysis();
            });
        }

        // デュアルスライダー
        const handleSliderChange = () => {
            let start = parseInt(sliderTimeStart.value, 10);
            let end = parseInt(sliderTimeEnd.value, 10);

            if (start > end) {
                const tmp = start;
                start = end;
                end = tmp;
            }

            state.calendarStartSlot = start;
            state.calendarEndSlot = end;
            updateCalendarTimeSliders();
            renderCalendarAnalysis();
        };

        if (sliderTimeStart) sliderTimeStart.addEventListener('input', handleSliderChange);
        if (sliderTimeEnd) sliderTimeEnd.addEventListener('input', handleSliderChange);

        // 時間帯プリセット
        calPresetBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                state.calendarStartSlot = parseInt(btn.getAttribute('data-start'), 10);
                state.calendarEndSlot = parseInt(btn.getAttribute('data-end'), 10);
                updateCalendarTimeSliders();
                renderCalendarAnalysis();
            });
        });

        // 曜日・祝日フィルター
        const handleFilterChange = () => {
            state.dayFilters = {
                weekday: calFilterWeekday ? calFilterWeekday.checked : true,
                saturday: calFilterSaturday ? calFilterSaturday.checked : true,
                sunday: calFilterSunday ? calFilterSunday.checked : true,
                holiday: calFilterHoliday ? calFilterHoliday.checked : true
            };
            renderCalendarAnalysis();
        };

        if (calFilterWeekday) calFilterWeekday.addEventListener('change', handleFilterChange);
        if (calFilterSaturday) calFilterSaturday.addEventListener('change', handleFilterChange);
        if (calFilterSunday) calFilterSunday.addEventListener('change', handleFilterChange);
        if (calFilterHoliday) calFilterHoliday.addEventListener('change', handleFilterChange);

        // ================= 期間 A 日付入力 (直接キー入力時の暴走防止) =================
        const handleCalDateChangeA = () => {
            const sVal = calRangeStartA ? calRangeStartA.value : '';
            const eVal = calRangeEndA ? calRangeEndA.value : '';

            // 4桁の完全な日付形式が入った時のみ更新
            if (isValidDateStr(sVal) && isValidDateStr(eVal)) {
                state.calStartA = sVal;
                state.calEndA = eVal;
                renderCalendarAnalysis();
            }
        };

        if (calRangeStartA) {
            calRangeStartA.addEventListener('change', handleCalDateChangeA);
            calRangeStartA.addEventListener('blur', handleCalDateChangeA);
        }
        if (calRangeEndA) {
            calRangeEndA.addEventListener('change', handleCalDateChangeA);
            calRangeEndA.addEventListener('blur', handleCalDateChangeA);
        }

        // 期間 A プリセット
        calRangePresetsA.forEach(btn => {
            btn.addEventListener('click', () => {
                const days = btn.getAttribute('data-days');
                const type = btn.getAttribute('data-type');
                const endObj = new Date(state.availableDates[state.availableDates.length - 1]);
                state.calEndA = endObj.toISOString().split('T')[0];

                if (type === 'all') {
                    state.calStartA = state.availableDates[0];
                } else if (days) {
                    const startObj = new Date(endObj);
                    startObj.setDate(startObj.getDate() - parseInt(days, 10) + 1);
                    state.calStartA = startObj.toISOString().split('T')[0];
                }

                updateCalendarRangeInputs();
                renderCalendarAnalysis();
            });
        });

        // ================= 期間 B 日付入力 (直接キー入力時の暴走防止) =================
        const handleCalDateChangeB = () => {
            const sVal = calRangeStartB ? calRangeStartB.value : '';
            const eVal = calRangeEndB ? calRangeEndB.value : '';

            if (isValidDateStr(sVal) && isValidDateStr(eVal)) {
                state.calStartB = sVal;
                state.calEndB = eVal;
                renderCalendarAnalysis();
            }
        };

        if (calRangeStartB) {
            calRangeStartB.addEventListener('change', handleCalDateChangeB);
            calRangeStartB.addEventListener('blur', handleCalDateChangeB);
        }
        if (calRangeEndB) {
            calRangeEndB.addEventListener('change', handleCalDateChangeB);
            calRangeEndB.addEventListener('blur', handleCalDateChangeB);
        }

        // 期間A/Bの日付入力欄クリック時にカレンダーピッカーを確実に開く
        [calRangeStartA, calRangeEndA, calRangeStartB, calRangeEndB].forEach(input => {
            if (input) {
                input.addEventListener('click', () => {
                    try {
                        if (typeof input.showPicker === 'function') input.showPicker();
                    } catch (e) {}
                });
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') {
                        input.blur();
                    }
                });
            }
        });

        // 期間 B プリセット
        if (btnCalPrevYear) {
            btnCalPrevYear.addEventListener('click', () => {
                const s = new Date(state.calStartA);
                const e = new Date(state.calEndA);
                s.setFullYear(s.getFullYear() - 1);
                e.setFullYear(e.getFullYear() - 1);
                state.calStartB = s.toISOString().split('T')[0];
                state.calEndB = e.toISOString().split('T')[0];
                updateCalendarRangeInputs();
                renderCalendarAnalysis();
            });
        }
        if (btnCalPrevPeriod) {
            btnCalPrevPeriod.addEventListener('click', () => {
                const s = new Date(state.calStartA);
                const e = new Date(state.calEndA);
                const diffDays = Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
                const newEnd = new Date(s);
                newEnd.setDate(newEnd.getDate() - 1);
                const newStart = new Date(newEnd);
                newStart.setDate(newStart.getDate() - diffDays + 1);

                state.calStartB = newStart.toISOString().split('T')[0];
                state.calEndB = newEnd.toISOString().split('T')[0];
                updateCalendarRangeInputs();
                renderCalendarAnalysis();
            });
        }
        if (btnCalPrevMonth) {
            btnCalPrevMonth.addEventListener('click', () => {
                const s = new Date(state.calStartA);
                const e = new Date(state.calEndA);
                s.setMonth(s.getMonth() - 1);
                e.setMonth(e.getMonth() - 1);
                state.calStartB = s.toISOString().split('T')[0];
                state.calEndB = e.toISOString().split('T')[0];
                updateCalendarRangeInputs();
                renderCalendarAnalysis();
            });
        }
    }

    /**
     * ローディング表示の切り替え
     */
    function showLoading(show, text = '読み込み中...') {
        const overlay = document.getElementById('loading-overlay');
        const textEl = document.getElementById('loading-text');
        if (!overlay) return;
        if (textEl && text) textEl.textContent = text;
        overlay.classList.toggle('hidden', !show);
    }

    // アプリ起動
    initApp();
});
