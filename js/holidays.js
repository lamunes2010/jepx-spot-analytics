/**
 * 日本の祝日（国民の祝日・振替休日・国民の休日）判定 & オンライン自動同期エンジン
 */

class JapaneseHolidays {
    constructor() {
        this.onlineHolidays = {};
        this.loadCachedHolidays();
        this.fetchOnlineHolidays();
    }

    /**
     * ローカルストレージにキャッシュされた祝日データの読み込み
     */
    loadCachedHolidays() {
        try {
            const cached = localStorage.getItem('jepx_japan_holidays');
            if (cached) {
                this.onlineHolidays = JSON.parse(cached);
            }
        } catch (e) {
            console.warn('祝日キャッシュ読み込み失敗:', e);
        }
    }

    /**
     * オンライン公式/オープンデータ (holidays-jp API) から最新祝日データを非同期取得
     */
    async fetchOnlineHolidays() {
        try {
            const resp = await fetch('https://holidays-jp.github.io/api/v1/date.json');
            if (resp.ok) {
                const data = await resp.json();
                if (data && typeof data === 'object') {
                    this.onlineHolidays = data;
                    localStorage.setItem('jepx_japan_holidays', JSON.stringify(data));
                    // 祝日データ取得完了時にカレンダーが描画中なら再描画を通知
                    if (window.dispatchEvent) {
                        window.dispatchEvent(new CustomEvent('holidays_updated'));
                    }
                }
            }
        } catch (e) {
            // オフラインまたはCORS制限時は内蔵の計算ロジックを使用
            console.log('祝日オンライン取得はスキップ（内蔵祝日判定エンジンを使用します）');
        }
    }

    /**
     * 春分の日（3月）の計算
     */
    getVernalEquinox(year) {
        if (year < 1980 || year > 2099) return 20;
        return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
    }

    /**
     * 秋分の日（9月）の計算
     */
    getAutumnEquinox(year) {
        if (year < 1980 || year > 2099) return 23;
        return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
    }

    /**
     * 指定された第N月曜日の日付を取得
     */
    getHappyMonday(year, month, nth) {
        const firstDay = new Date(year, month - 1, 1).getDay();
        const firstMonday = firstDay <= 1 ? (1 - firstDay) + 1 : (8 - firstDay) + 1;
        return firstMonday + (nth - 1) * 7;
    }

    /**
     * 年ごとの祝日マップを動的計算（オフラインでも100%動作）
     */
    calculateHolidaysForYear(year) {
        const holidays = {};

        const add = (m, d, name) => {
            const dateStr = `${year}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            holidays[dateStr] = name;
        };

        // 固定祝日
        add(1, 1, '元日');
        add(2, 11, '建国記念の日');
        add(2, 23, '天皇誕生日');
        add(4, 29, '昭和の日');
        add(5, 3, '憲法記念日');
        add(5, 4, 'みどりの日');
        add(5, 5, 'こどもの日');
        add(8, 11, '山の日');
        add(11, 3, '文化の日');
        add(11, 23, '勤労感謝の日');

        // ハッピーマンデー (第N月曜日)
        add(1, this.getHappyMonday(year, 1, 2), '成人の日');
        add(7, this.getHappyMonday(year, 7, 3), '海の日');
        add(9, this.getHappyMonday(year, 9, 3), '敬老の日');
        add(10, this.getHappyMonday(year, 10, 2), 'スポーツの日');

        // 春分の日・秋分の日
        add(3, this.getVernalEquinox(year), '春分の日');
        add(9, this.getAutumnEquinox(year), '秋分の日');

        // 国民の休日 (祝日に挟まれた平日: 例 敬老の日と秋分の日の間)
        const septKeiroDay = this.getHappyMonday(year, 9, 3);
        const septShubunDay = this.getAutumnEquinox(year);
        if (septShubunDay - septKeiroDay === 2) {
            add(9, septKeiroDay + 1, '国民の休日');
        }

        // 振替休日判定 (祝日が日曜日の場合、翌日以降の最も近い平日が振替休日)
        const dateKeys = Object.keys(holidays).sort();
        dateKeys.forEach(dateStr => {
            const d = new Date(dateStr);
            if (d.getDay() === 0) { // 日曜日
                let substitute = new Date(d);
                let found = false;
                while (!found) {
                    substitute.setDate(substitute.getDate() + 1);
                    const subStr = substitute.toISOString().split('T')[0];
                    if (!holidays[subStr]) {
                        holidays[subStr] = '振替休日';
                        found = true;
                    }
                }
            }
        });

        return holidays;
    }

    /**
     * 日付文字列 (YYYY-MM-DD) が日本の祝日かどうか判定
     * @returns {string|null} 祝日名 または null
     */
    getHolidayName(dateStr) {
        if (!dateStr) return null;

        // 1. オンライン取得キャッシュがあれば優先
        if (this.onlineHolidays && this.onlineHolidays[dateStr]) {
            return this.onlineHolidays[dateStr];
        }

        // 2. なければ計算エンジンで即座に判定
        const year = parseInt(dateStr.split('-')[0], 10);
        if (!year) return null;

        if (!this.calculatedCache) this.calculatedCache = {};
        if (!this.calculatedCache[year]) {
            this.calculatedCache[year] = this.calculateHolidaysForYear(year);
        }

        return this.calculatedCache[year][dateStr] || null;
    }

    /**
     * 日付の種別を判定 ('holiday' | 'sunday' | 'saturday' | 'weekday')
     */
    getDayType(dateStr) {
        const holiday = this.getHolidayName(dateStr);
        if (holiday) return 'holiday';

        const dObj = new Date(dateStr);
        const day = dObj.getDay();
        if (day === 0) return 'sunday';
        if (day === 6) return 'saturday';
        return 'weekday';
    }
}

window.japaneseHolidays = new JapaneseHolidays();
