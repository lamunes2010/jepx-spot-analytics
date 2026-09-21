/**
 * ENECHANGE INSIGHT MARKETS 100% 忠実再現 描画エンジン (2期間カレンダー 左右並列1行1レコードリスト & エリア・時間帯分析対応)
 */

const ENECHANGE_ROWS = [
    { key: 'system',   name: 'システム', nextKey: null, color: '#ffffff' },
    { key: 'hokkaido', name: '北海道',   nextKey: 'tohoku', color: '#2563eb' },
    { key: 'tohoku',   name: '東北',     nextKey: 'tokyo', color: '#0d9488' },
    { key: 'tokyo',    name: '東京',     nextKey: 'chubu', color: '#ef4444' },
    { key: 'chubu',    name: '中部',     nextKey: 'hokuriku', color: '#f97316' },
    { key: 'hokuriku', name: '北陸',     nextKey: 'kansai', color: '#eab308' },
    { key: 'kansai',   name: '関西',     nextKey: 'chugoku', color: '#84cc16' },
    { key: 'chugoku',  name: '中国',     nextKey: 'shikoku', color: '#06b6d4' },
    { key: 'shikoku',  name: '四国',     nextKey: 'kyushu', color: '#8b5cf6' },
    { key: 'kyushu',   name: '九州',     nextKey: null, color: '#ec4899' },
];

class EnechangeRenderer {
    constructor() {
        this.dailyChart = null;
        this.volumeChart = null;
    }

    /**
     * 洗練されたプロ向けエネルギートレーディング カラーパレット
     * 22円以上から高騰の度合いに応じて（赤 ➜ 深紅 ➜ 鮮明なマゼンタ ➜ ロイヤルパープル ➜ 濃紫）と明確にコントラストを表現
     */
    static getPriceStyle(price) {
        if (price <= 0.01) {
            return { bg: '#1e1b4b', color: '#e0e7ff' }; // 〜0.01円 (ディープインディゴ / ゼロ円・出力制御)
        } else if (price <= 3.00) {
            return { bg: '#0369a1', color: '#ffffff' }; // 0.01〜3.00円 (サファイアブルー / 極安値)
        } else if (price <= 6.00) {
            return { bg: '#0284c7', color: '#ffffff' }; // 3.00〜6.00円 (スカイブルー / 安値)
        } else if (price <= 9.00) {
            return { bg: '#0d9488', color: '#ffffff' }; // 6.00〜9.00円 (ティール / 安定域)
        } else if (price <= 12.00) {
            return { bg: '#10b981', color: '#042f2e' }; // 9.00〜12.00円 (エメラルド / 適正価格)
        } else if (price <= 15.00) {
            return { bg: '#84cc16', color: '#1a2e05' }; // 12.00〜15.00円 (ライムグリーン / やや高め)
        } else if (price <= 18.00) {
            return { bg: '#eab308', color: '#1c1917' }; // 15.00〜18.00円 (アンバーゴールド / 注意域)
        } else if (price <= 22.00) {
            return { bg: '#f97316', color: '#18181b' }; // 18.00〜22.00円 (コーラルオレンジ / ピーク高値)
        } else if (price <= 26.00) {
            return { bg: '#ef4444', color: '#ffffff' }; // 22.00〜26.00円 (鮮烈なレッド / 警戒域)
        } else if (price <= 33.00) {
            return { bg: '#be123c', color: '#ffffff' }; // 26.00〜33.00円 (深紅・クリムゾンローズ / 30円台前半)
        } else if (price <= 45.00) {
            return { bg: '#c026d3', color: '#ffffff' }; // 33.00〜45.00円 (鮮やかなマゼンタ・フューシャ / 40円前後)
        } else if (price <= 55.00) {
            return { bg: '#7c3aed', color: '#ffffff' }; // 45.00〜55.00円 (鮮明なロイヤルパープル / 50円台)
        } else {
            return { bg: '#3b0764', color: '#ffffff' }; // 55.00円超 (超高騰ディープダークバイオレット)
        }
    }

    /**
     * 48コマ時刻文字列 (例: "0000", "0030", "0100") を生成
     */
    static formatSlotHeader(slot) {
        const startMin = (slot - 1) * 30;
        const sh = String(Math.floor(startMin / 60)).padStart(2, '0');
        const sm = String(startMin % 60).padStart(2, '0');
        return `${sh}${sm}`;
    }

    /**
     * コマ番号から日本語時刻表記を生成 (例: slot 17 -> "08:00")
     */
    static formatSlotTime(slot, isEnd = false) {
        const min = isEnd ? slot * 30 : (slot - 1) * 30;
        const h = Math.floor(min / 60);
        const m = min % 60;
        return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    }

    /**
     * 本家 ENECHANGE INSIGHT MARKETS 48コマ マトリクス表を描画
     */
    renderEnechangeMatrix(containerId, slotRecords) {
        const container = document.getElementById(containerId);
        if (!container) return;

        if (!slotRecords || slotRecords.length === 0) {
            container.innerHTML = '<div class="p-6 text-center text-slate-500 font-bold bg-[#1e2530] rounded">この日付のデータはまだありません</div>';
            return;
        }

        const rowStats = {};
        ENECHANGE_ROWS.forEach(row => {
            const prices = slotRecords.map(r => 
                row.key === 'system' ? r.systemPrice : (r.areaPrices && r.areaPrices[row.key] !== undefined ? r.areaPrices[row.key] : r.systemPrice)
            );
            rowStats[row.key] = {
                max: Math.max(...prices),
                min: Math.min(...prices),
                avg: prices.reduce((a, b) => a + b, 0) / prices.length
            };
        });

        let html = `
        <div class="matrix-scroll-wrapper overflow-x-auto custom-scrollbar border border-slate-700 rounded shadow-md bg-[#0b1120]">
            <table class="enein-matrix-table">
                <colgroup>
                    <col style="width: 68px; min-width: 68px; max-width: 68px;">
                    <col style="width: 50px; min-width: 50px; max-width: 50px;">
                    <col style="width: 50px; min-width: 50px; max-width: 50px;">
                    <col style="width: 50px; min-width: 50px; max-width: 50px;">
        `;

        slotRecords.forEach(() => {
            html += `<col style="width: 42px; min-width: 42px; max-width: 42px;">`;
        });

        html += `
                </colgroup>
                <thead>
                    <tr>
                        <th class="col-area">
                            <span class="inline-block px-2 py-0.5 rounded-full bg-slate-900 text-white font-bold text-[10px] border border-slate-600">全国</span>
                        </th>
                        <th class="col-max font-num font-bold">Max</th>
                        <th class="col-min font-num font-bold">Min</th>
                        <th class="col-avg font-num font-bold">Avg</th>
        `;

        slotRecords.forEach(r => {
            const timeCode = EnechangeRenderer.formatSlotHeader(r.slot);
            html += `<th class="col-time">${timeCode}</th>`;
        });
        html += `</tr></thead><tbody>`;

        ENECHANGE_ROWS.forEach(row => {
            const stats = rowStats[row.key];
            const isSystem = row.key === 'system';

            html += `
                <tr>
                    <td class="col-area">
                        <span class="area-badge ${isSystem ? 'border-blue-500 text-blue-400' : ''}">
                            ${row.name}
                        </span>
                    </td>
                    <td class="col-max font-num">${stats.max.toFixed(2)}</td>
                    <td class="col-min font-num">${stats.min.toFixed(2)}</td>
                    <td class="col-avg font-num">${stats.avg.toFixed(2)}</td>
            `;

            slotRecords.forEach(r => {
                const currentPrice = row.key === 'system' ? r.systemPrice : (r.areaPrices && r.areaPrices[row.key] !== undefined ? r.areaPrices[row.key] : r.systemPrice);
                const style = EnechangeRenderer.getPriceStyle(currentPrice);

                let isSplitWithNext = false;
                if (row.nextKey) {
                    const nextPrice = r.areaPrices && r.areaPrices[row.nextKey] !== undefined ? r.areaPrices[row.nextKey] : r.systemPrice;
                    if (Math.abs(currentPrice - nextPrice) > 0.01) {
                        isSplitWithNext = true;
                    }
                }

                html += `
                    <td class="cell-price" style="background-color: ${style.bg}; color: ${style.color};"
                        title="[コマ ${r.slot}] ${r.timeLabel}\n${row.name}: ${currentPrice.toFixed(2)} 円/kWh">
                        ${currentPrice.toFixed(2)}
                        ${isSplitWithNext ? `
                            <div class="split-gap-container">
                                <svg class="split-breaker-svg" viewBox="0 0 42 6" preserveAspectRatio="none">
                                    <line x1="0" y1="3" x2="42" y2="3" stroke="#ffffff" stroke-width="2"/>
                                    <circle cx="14" cy="3" r="2.2" fill="#ffffff" stroke="#000000" stroke-width="0.8"/>
                                    <circle cx="28" cy="3" r="2.2" fill="#ffffff" stroke="#000000" stroke-width="0.8"/>
                                </svg>
                            </div>
                        ` : ''}
                    </td>
                `;
            });

            html += `</tr>`;
        });

        html += `</tbody></table></div>`;
        container.innerHTML = html;
    }

    /**
     * 48コマ 折れ線グラフ (基準日実線 & 比較日破線 重ね合わせ対応)
     */
    renderDailyChart(canvasId, slotRecordsA, slotRecordsB = null, showCompare = false, visibleAreas = ['system', 'tokyo', 'kansai', 'kyushu'], dateA = '', dateB = '') {
        const ctx = document.getElementById(canvasId);
        if (!ctx || !slotRecordsA || slotRecordsA.length === 0) return;

        if (this.dailyChart) {
            this.dailyChart.destroy();
        }

        const labels = slotRecordsA.map(r => EnechangeRenderer.formatSlotHeader(r.slot));
        const datasets = [];

        const colors = {
            system: '#ffffff',
            hokkaido: '#2563eb',
            tohoku: '#0d9488',
            tokyo: '#ef4444',
            chubu: '#f97316',
            hokuriku: '#eab308',
            kansai: '#84cc16',
            chugoku: '#06b6d4',
            shikoku: '#8b5cf6',
            kyushu: '#ec4899',
        };

        // 1. 基準日のデータセット (実線)
        ENECHANGE_ROWS.forEach(cfg => {
            if (visibleAreas.includes(cfg.key)) {
                const isSys = cfg.key === 'system';
                const labelName = showCompare && dateA ? `${cfg.name} (基準 ${dateA.slice(5)})` : cfg.name;
                datasets.push({
                    label: labelName,
                    data: slotRecordsA.map(r => isSys ? r.systemPrice : (r.areaPrices && r.areaPrices[cfg.key] !== undefined ? r.areaPrices[cfg.key] : r.systemPrice)),
                    borderColor: colors[cfg.key],
                    backgroundColor: isSys ? 'rgba(255, 255, 255, 0.08)' : 'transparent',
                    borderWidth: isSys ? 3 : 2,
                    tension: 0.15,
                    pointRadius: 1,
                    pointHoverRadius: 5
                });
            }
        });

        // 2. 比較日のデータセット (破線・点線)
        if (showCompare && slotRecordsB && slotRecordsB.length > 0) {
            ENECHANGE_ROWS.forEach(cfg => {
                if (visibleAreas.includes(cfg.key)) {
                    const isSys = cfg.key === 'system';
                    const labelName = dateB ? `${cfg.name} (比較 ${dateB.slice(5)})` : `${cfg.name} (比較日)`;
                    datasets.push({
                        label: labelName,
                        data: slotRecordsB.map(r => isSys ? r.systemPrice : (r.areaPrices && r.areaPrices[cfg.key] !== undefined ? r.areaPrices[cfg.key] : r.systemPrice)),
                        borderColor: colors[cfg.key],
                        backgroundColor: 'transparent',
                        borderWidth: isSys ? 2.5 : 1.8,
                        borderDash: [5, 4], // 破線表示
                        tension: 0.15,
                        pointRadius: 1,
                        pointHoverRadius: 5
                    });
                }
            });
        }

        this.dailyChart = new Chart(ctx, {
            type: 'line',
            data: { labels, datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        display: showCompare,
                        position: 'top',
                        labels: {
                            color: '#cbd5e1',
                            font: { size: 10 },
                            boxWidth: 14,
                            usePointStyle: false
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        borderColor: '#334155',
                        borderWidth: 1,
                        padding: 10,
                        titleFont: { size: 12, weight: 'bold' },
                        bodyFont: { size: 11 },
                        callbacks: {
                            label: (ctx) => ` ${ctx.dataset.label}: ${Number(ctx.raw).toFixed(2)} 円/kWh`
                        }
                    }
                },
                scales: {
                    x: { grid: { color: 'rgba(255, 255, 255, 0.05)' }, ticks: { color: '#94a3b8', font: { family: "'Oswald'" } } },
                    y: { title: { display: true, text: '価格 (円/kWh)', color: '#94a3b8' }, beginAtZero: true, grid: { color: 'rgba(255, 255, 255, 0.08)' }, ticks: { color: '#cbd5e1', font: { family: "'Oswald'" } } }
                }
            }
        });
    }

    /**
     * 約定総量・入札量チャート
     */
    renderVolumeChart(canvasId, slotRecords) {
        const ctx = document.getElementById(canvasId);
        if (!ctx || !slotRecords || slotRecords.length === 0) return;

        if (this.volumeChart) {
            this.volumeChart.destroy();
        }

        const labels = slotRecords.map(r => EnechangeRenderer.formatSlotHeader(r.slot));

        this.volumeChart = new Chart(ctx, {
            type: 'bar',
            data: {
                labels,
                datasets: [
                    {
                        label: '売り入札量 (万kWh)',
                        data: slotRecords.map(r => Math.round(r.sellBid / 10000)),
                        type: 'line',
                        borderColor: '#22c55e',
                        borderWidth: 2,
                        pointRadius: 0,
                        order: 1
                    },
                    {
                        label: '買い入札量 (万kWh)',
                        data: slotRecords.map(r => Math.round(r.buyBid / 10000)),
                        type: 'line',
                        borderColor: '#f59e0b',
                        borderWidth: 2,
                        pointRadius: 0,
                        order: 2
                    },
                    {
                        label: '約定総量 (万kWh)',
                        data: slotRecords.map(r => Math.round(r.volume / 10000)),
                        backgroundColor: 'rgba(56, 189, 248, 0.7)',
                        borderRadius: 2,
                        order: 3
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: {
                    mode: 'index',
                    intersect: false
                },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            color: '#cbd5e1',
                            font: { size: 11 },
                            boxWidth: 14
                        }
                    },
                    tooltip: {
                        mode: 'index',
                        intersect: false,
                        backgroundColor: 'rgba(15, 23, 42, 0.95)',
                        borderColor: '#334155',
                        borderWidth: 1,
                        padding: 10,
                        titleFont: { size: 12, weight: 'bold' },
                        bodyFont: { size: 11 },
                        itemSort: (a, b) => a.datasetIndex - b.datasetIndex,
                        callbacks: {
                            label: (ctx) => {
                                const label = ctx.dataset.label.replace(' (万kWh)', '');
                                return ` ${label}: ${Number(ctx.raw).toLocaleString()} 万kWh`;
                            }
                        }
                    }
                },
                scales: {
                    x: { grid: { display: false }, ticks: { color: '#94a3b8', font: { family: "'Oswald'" } } },
                    y: { title: { display: true, text: '電力量 (万kWh)', color: '#94a3b8' }, ticks: { color: '#cbd5e1', font: { family: "'Oswald'" } } }
                }
            }
        });
    }

    /**
     * 1行1レコード形式のカレンダーリストを描画 (曜日・祝日フィルター & 祝日自動判定対応)
     */
    renderCalendarSection(containerId, summaryBarId, dateRangeRecords, areaKey = 'kyushu', startSlot = 17, endSlot = 40, onDateSelect, dayFilters = { weekday: true, saturday: true, sunday: true, holiday: true }) {
        const container = document.getElementById(containerId);
        const summaryBar = document.getElementById(summaryBarId);
        if (!container) return null;

        if (!dateRangeRecords || dateRangeRecords.length === 0) {
            container.innerHTML = '<div class="p-8 text-center text-slate-400 font-bold text-sm bg-[#18202c] rounded">指定された期間のデータがありません</div>';
            if (summaryBar) summaryBar.innerHTML = '';
            return null;
        }

        const areaConfig = ENECHANGE_ROWS.find(r => r.key === areaKey) || { key: 'kyushu', name: '九州' };

        const dailyMap = {};
        dateRangeRecords.forEach(r => {
            if (!dailyMap[r.date]) {
                dailyMap[r.date] = { 
                    date: r.date, 
                    allPrices: [], 
                    rangePrices: [], 
                    splitSlots: 0, 
                    totalSlots: 0 
                };
            }

            const price = areaKey === 'system' 
                ? r.systemPrice 
                : (r.areaPrices && r.areaPrices[areaKey] !== undefined ? r.areaPrices[areaKey] : r.systemPrice);

            dailyMap[r.date].allPrices.push(price);

            if (r.slot >= startSlot && r.slot <= endSlot) {
                dailyMap[r.date].rangePrices.push(price);
            }

            if (r.isSplit) dailyMap[r.date].splitSlots++;
            dailyMap[r.date].totalSlots++;
        });

        // 曜日・祝日フィルターの適用
        let dates = Object.keys(dailyMap).sort().reverse();
        if (dayFilters) {
            dates = dates.filter(d => {
                const dayType = window.japaneseHolidays ? window.japaneseHolidays.getDayType(d) : (new Date(d).getDay() === 0 ? 'sunday' : new Date(d).getDay() === 6 ? 'saturday' : 'weekday');
                return dayFilters[dayType] !== false;
            });
        }

        if (dates.length === 0) {
            container.innerHTML = '<div class="p-8 text-center text-slate-400 font-bold text-sm bg-[#18202c] rounded">選択された曜日・祝日条件に合致するデータがありません</div>';
            if (summaryBar) summaryBar.innerHTML = '';
            return null;
        }

        let grandAllPrices = [];
        let grandRangePrices = [];
        dates.forEach(d => {
            grandAllPrices = grandAllPrices.concat(dailyMap[d].allPrices);
            grandRangePrices = grandRangePrices.concat(dailyMap[d].rangePrices);
        });

        const periodAllAvg = grandAllPrices.length > 0 ? (grandAllPrices.reduce((a, b) => a + b, 0) / grandAllPrices.length) : 0;
        const periodRangeAvg = grandRangePrices.length > 0 ? (grandRangePrices.reduce((a, b) => a + b, 0) / grandRangePrices.length) : 0;
        const periodMin = grandAllPrices.length > 0 ? Math.min(...grandAllPrices) : 0;
        const periodMax = grandAllPrices.length > 0 ? Math.max(...grandAllPrices) : 0;

        const startTimeStr = EnechangeRenderer.formatSlotTime(startSlot, false);
        const endTimeStr = EnechangeRenderer.formatSlotTime(endSlot, false);

        // サマリーバーの描画
        if (summaryBar) {
            summaryBar.innerHTML = `
                <div class="bg-[#18202c] p-2.5 rounded-md border border-slate-700 flex flex-col justify-between">
                    <div class="text-[11px] font-bold text-slate-400 uppercase">エリア / 日数</div>
                    <div class="font-bold text-white text-sm mt-1 flex items-center justify-between">
                        <span class="px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-700 text-xs">${areaConfig.name}</span>
                        <span class="text-slate-200 font-num text-sm">${dates.length} 日分</span>
                    </div>
                </div>
                <div class="bg-[#18202c] p-2.5 rounded-md border border-slate-700 flex flex-col justify-between">
                    <div class="text-[11px] font-bold text-slate-400 uppercase">期間 全日平均 (24h)</div>
                    <div class="font-num font-bold text-white text-base md:text-lg mt-0.5">
                        ${periodAllAvg.toFixed(2)} <span class="text-xs font-normal text-slate-400">円/kWh</span>
                    </div>
                </div>
                <div class="bg-[#18202c] p-2.5 rounded-md border border-blue-900/60 bg-blue-950/20 flex flex-col justify-between">
                    <div class="text-[11px] font-bold text-blue-300 uppercase flex items-center justify-between">
                        <span>指定時間帯平均</span>
                        <span class="text-blue-400 font-num text-[10px]">${startTimeStr}〜${endTimeStr}</span>
                    </div>
                    <div class="font-num font-bold text-blue-300 text-base md:text-lg mt-0.5">
                        ${periodRangeAvg.toFixed(2)} <span class="text-xs font-normal text-blue-400">円/kWh</span>
                    </div>
                </div>
                <div class="bg-[#18202c] p-2.5 rounded-md border border-slate-700 flex flex-col justify-between">
                    <div class="text-[11px] font-bold text-slate-400 uppercase">期間 最安 / 最高</div>
                    <div class="font-num font-bold text-xs md:text-sm mt-1 flex justify-between">
                        <span class="text-emerald-400">安: ${periodMin.toFixed(1)}</span>
                        <span class="text-rose-400">高: ${periodMax.toFixed(1)}</span>
                    </div>
                </div>
            `;
        }

        // 1行1レコードのテーブル形式リスト
        let html = `
        <div class="calendar-scroll-wrapper overflow-x-auto max-h-[550px] overflow-y-auto custom-scrollbar border border-slate-700 rounded-lg shadow-md bg-[#0b1120]">
            <table class="w-full text-left border-collapse text-xs md:text-sm">
                <thead class="bg-[#18202c] text-slate-200 sticky top-0 z-10 border-b border-slate-700 font-bold text-xs">
                    <tr>
                        <th class="py-2.5 px-3 text-slate-200 min-w-[90px]">受渡日</th>
                        <th class="py-2.5 px-2.5 text-right min-w-[90px]">全日平均</th>
                        <th class="py-2.5 px-2.5 text-right text-blue-300 min-w-[110px]">指定時間帯平均</th>
                        <th class="py-2.5 px-2.5 text-right min-w-[60px]">最安</th>
                        <th class="py-2.5 px-2.5 text-right min-w-[60px]">最高</th>
                        <th class="py-2.5 px-2 text-center min-w-[50px]">詳細</th>
                    </tr>
                </thead>
                <tbody class="divide-y divide-slate-800">
        `;

        dates.forEach(d => {
            const item = dailyMap[d];
            const allAvg = item.allPrices.length > 0 ? (item.allPrices.reduce((a, b) => a + b, 0) / item.allPrices.length) : 0;
            const rangeAvg = item.rangePrices.length > 0 ? (item.rangePrices.reduce((a, b) => a + b, 0) / item.rangePrices.length) : 0;
            const min = item.allPrices.length > 0 ? Math.min(...item.allPrices) : 0;
            const max = item.allPrices.length > 0 ? Math.max(...item.allPrices) : 0;

            const dObj = new Date(d);
            const dayOfWeek = ['日', '月', '火', '水', '木', '金', '土'][dObj.getDay()];
            const isSun = dObj.getDay() === 0;
            const isSat = dObj.getDay() === 6;

            const holidayName = window.japaneseHolidays ? window.japaneseHolidays.getHolidayName(d) : null;
            let dateColorClass = 'text-slate-100 font-bold'; // 平日: 白
            const dateLabel = `${d.slice(5)} (${dayOfWeek})`;

            if (holidayName) {
                dateColorClass = 'text-amber-400 font-extrabold'; // 祝日: オレンジ
            } else if (isSun) {
                dateColorClass = 'text-rose-400 font-extrabold'; // 日曜: 赤
            } else if (isSat) {
                dateColorClass = 'text-blue-400 font-extrabold'; // 土曜: 青
            }

            const allAvgStyle = EnechangeRenderer.getPriceStyle(allAvg);
            const rangeAvgStyle = EnechangeRenderer.getPriceStyle(rangeAvg);

            html += `
                <tr class="hover:bg-slate-800/90 cursor-pointer transition-colors calendar-day-row" data-date="${d}" title="クリックして${d}の電力スポット価格へ移動${holidayName ? `【${holidayName}】` : ''}">
                    
                    <!-- 受渡日 (曜日・祝日) -->
                    <td class="py-2 px-3 font-num whitespace-nowrap text-xs md:text-sm">
                        <span class="${dateColorClass}" title="${holidayName ? `国民の祝日: ${holidayName}` : ''}">
                            ${dateLabel}
                        </span>
                    </td>

                    <!-- 全日平均 (24h) -->
                    <td class="py-2 px-2.5 text-right font-num font-bold whitespace-nowrap">
                        <span class="inline-block w-[60px] text-center py-0.5 rounded text-xs md:text-sm shadow-sm" style="background-color: ${allAvgStyle.bg}; color: ${allAvgStyle.color};">
                            ${allAvg.toFixed(2)}
                        </span>
                    </td>

                    <!-- 指定時間帯平均 -->
                    <td class="py-2 px-2.5 text-right font-num font-bold whitespace-nowrap">
                        <span class="inline-block w-[60px] text-center py-0.5 rounded text-xs md:text-sm shadow-sm" style="background-color: ${rangeAvgStyle.bg}; color: ${rangeAvgStyle.color};">
                            ${rangeAvg.toFixed(2)}
                        </span>
                    </td>

                    <!-- 最安値 -->
                    <td class="py-2 px-2 text-right font-num font-bold text-emerald-400 text-xs md:text-sm whitespace-nowrap">
                        ${min.toFixed(1)}
                    </td>

                    <!-- 最高値 -->
                    <td class="py-2 px-2 text-right font-num font-bold text-rose-400 text-xs md:text-sm whitespace-nowrap">
                        ${max.toFixed(1)}
                    </td>

                    <!-- 移動ボタン -->
                    <td class="py-2 px-2 text-center whitespace-nowrap">
                        <button class="px-2 py-0.5 rounded bg-blue-900/60 hover:bg-blue-800 text-blue-300 font-bold text-xs border border-blue-700/60 transition-colors shadow-sm">
                            ➔
                        </button>
                    </td>

                </tr>
            `;
        });

        html += `</tbody></table></div>`;
        container.innerHTML = html;

        container.querySelectorAll('.calendar-day-row').forEach(el => {
            el.addEventListener('click', () => {
                const date = el.getAttribute('data-date');
                if (onDateSelect) onDateSelect(date);
            });
        });

        return {
            periodAllAvg,
            periodRangeAvg,
            periodMin,
            periodMax,
            datesCount: dates.length
        };
    }
}

window.EnechangeRenderer = EnechangeRenderer;
window.ENECHANGE_ROWS = ENECHANGE_ROWS;
window.AREA_CONFIG = ENECHANGE_ROWS;
