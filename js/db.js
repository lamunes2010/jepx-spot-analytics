/**
 * JEPXオフラインストレージ管理モジュール (IndexedDB)
 * 過去数年分の48コマスポット価格・分断データをローカルに永続化します。
 * GitHub Pages等の完全静的ホスティングでも100%快適に動作します。
 */

const DB_NAME = 'JEPXMarketDB';
const DB_VERSION = 1;
const STORE_SPOT = 'spot_prices';
const STORE_META = 'metadata';

class JepxDatabase {
    constructor() {
        this.db = null;
        this._yearCache = new Map();
    }

    /**
     * データベースの初期化と初期キャッシュ投入
     */
    async init() {
        if (this.db) return this.db;
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // スポット価格ストア (日付 + コマ番号を主キー、日付インデックス付き)
                if (!db.objectStoreNames.contains(STORE_SPOT)) {
                    const spotStore = db.createObjectStore(STORE_SPOT, { keyPath: 'id' });
                    spotStore.createIndex('date', 'date', { unique: false });
                    spotStore.createIndex('year', 'year', { unique: false });
                    spotStore.createIndex('month', 'month', { unique: false });
                }

                // メタデータストア
                if (!db.objectStoreNames.contains(STORE_META)) {
                    db.createObjectStore(STORE_META, { keyPath: 'key' });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onerror = (event) => {
                console.error('IndexedDBの初期化エラー:', event.target.error);
                reject(event.target.error);
            };
        });
    }

    /**
     * 最新のJEPX静的データを同期してIndexedDBに確実にマージ
     */
    async syncLatest() {
        if (!this.db) await this.init();

        // 1. 直近データの静的キャッシュ事前読み込み (data/recent-spots.json または data/spots-latest.json)
        try {
            const paths = ['./data/recent-spots.json', './data/spots-latest.json', './data/jepx_data.json'];
            for (const p of paths) {
                try {
                    const resp = await fetch(p);
                    if (resp.ok) {
                        const data = await resp.json();
                        const records = data.records || (Array.isArray(data) ? data : null);
                        if (records && records.length > 0) {
                            await this.bulkInsert(records);
                            return records;
                        }
                    }
                } catch (err) {}
            }
        } catch (e) {
            console.warn('静的データ同期スキップ:', e);
        }

        // 2. もしデータが0件なら、サンプルデータを生成して投入
        const currentCount = await this.getRecordCount();
        if (currentCount === 0 && window.SampleDataGenerator) {
            console.log('初期データとしてサンプルデータを投入します');
            const sampleRecords = window.SampleDataGenerator.generate(60);
            await this.bulkInsert(sampleRecords);
            return sampleRecords;
        }

        return [];
    }

    /**
     * 保存されているレコード総数を取得
     */
    async getRecordCount() {
        if (!this.db) await this.init();
        return new Promise((resolve) => {
            try {
                const transaction = this.db.transaction([STORE_SPOT], 'readonly');
                const req = transaction.objectStore(STORE_SPOT).count();
                req.onsuccess = () => resolve(req.result || 0);
                req.onerror = () => resolve(0);
            } catch (e) {
                resolve(0);
            }
        });
    }

    /**
     * 複数件のスポット価格データを一括保存（トランザクション）
     * @param {Array<Object>} records 
     */
    async bulkInsert(records) {
        if (!this.db) await this.init();
        if (!records || records.length === 0) return 0;

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_SPOT, STORE_META], 'readwrite');
            const spotStore = transaction.objectStore(STORE_SPOT);

            records.forEach(record => {
                spotStore.put(record);
            });

            transaction.oncomplete = () => {
                this.updateMetadata();
                resolve(records.length);
            };

            transaction.onerror = (event) => {
                reject(event.target.error);
            };
        });
    }

    /**
     * 年別静的JSONデータのメモリキャッシュ取得
     */
    async getYearData(year) {
        if (!this._yearCache) this._yearCache = new Map();
        if (this._yearCache.has(year)) {
            return this._yearCache.get(year);
        }
        try {
            const paths = [`./data/spots-${year}.json`, `./data/spot_summary_${year}.json`];
            for (const p of paths) {
                try {
                    const resp = await fetch(p);
                    if (resp.ok) {
                        const data = await resp.json();
                        const records = data.records || (Array.isArray(data) ? data : null);
                        if (records && records.length > 0) {
                            this._yearCache.set(year, records);
                            setTimeout(() => {
                                this.bulkInsert(records).catch(() => {});
                            }, 100);
                            return records;
                        }
                    }
                } catch (e) {}
            }
        } catch (e) {}
        return [];
    }

    /**
     * 指定日付の全48コマデータを取得（IndexedDB最優先、なければ年別静的キャッシュから即取得）
     * @param {string} dateStr 'YYYY-MM-DD'
     */
    async getDayData(dateStr) {
        if (!this.db) await this.init();

        const queryLocal = () => new Promise((resolve) => {
            try {
                const transaction = this.db.transaction([STORE_SPOT], 'readonly');
                const spotStore = transaction.objectStore(STORE_SPOT);
                const index = spotStore.index('date');
                const request = index.getAll(IDBKeyRange.only(dateStr));
                request.onsuccess = () => {
                    const results = request.result || [];
                    results.sort((a, b) => a.slot - b.slot);
                    resolve(results);
                };
                request.onerror = () => resolve([]);
            } catch (e) {
                resolve([]);
            }
        });

        // 1. まずローカルIndexedDBから検索
        let localData = await queryLocal();
        if (localData && localData.length >= 48) {
            return localData;
        }

        // 2. ローカルにない場合: 年別データから抽出
        const year = parseInt(dateStr.split('-')[0], 10);
        const yearRecords = await this.getYearData(year);
        if (yearRecords && yearRecords.length > 0) {
            const dayRecords = yearRecords.filter(r => r.date === dateStr);
            if (dayRecords.length > 0) {
                dayRecords.sort((a, b) => a.slot - b.slot);
                return dayRecords;
            }
        }

        return localData || [];
    }

    /**
     * 指定期間（開始日〜終了日）のデータを取得
     * @param {string} startDate 'YYYY-MM-DD'
     * @param {string} endDate 'YYYY-MM-DD'
     */
    async getDateRangeData(startDate, endDate) {
        if (!this.db) await this.init();

        const queryLocalRange = () => new Promise((resolve) => {
            try {
                const transaction = this.db.transaction([STORE_SPOT], 'readonly');
                const spotStore = transaction.objectStore(STORE_SPOT);
                const index = spotStore.index('date');
                const range = IDBKeyRange.bound(startDate, endDate);
                const request = index.getAll(range);

                request.onsuccess = () => {
                    const results = request.result || [];
                    results.sort((a, b) => {
                        if (a.date !== b.date) return a.date.localeCompare(b.date);
                        return a.slot - b.slot;
                    });
                    resolve(results);
                };
                request.onerror = () => resolve([]);
            } catch (e) {
                resolve([]);
            }
        });

        // 1. まずIndexedDBから検索
        const localRecords = await queryLocalRange();
        
        const startD = new Date(startDate);
        const endD = new Date(endDate);
        const expectedDays = Math.max(1, Math.round((endD - startD) / (1000 * 60 * 60 * 24)) + 1);
        
        if (localRecords && localRecords.length >= (expectedDays * 48 * 0.8)) {
            return localRecords;
        }

        // 2. 年別データからロード
        const startYear = parseInt(startDate.split('-')[0], 10);
        const endYear = parseInt(endDate.split('-')[0], 10);
        const yearPromises = [];
        for (let y = startYear; y <= endYear; y++) {
            yearPromises.push(this.getYearData(y));
        }

        const yearsData = await Promise.all(yearPromises);
        const allFetched = yearsData.flat();

        const filtered = allFetched.filter(r => r.date >= startDate && r.date <= endDate);
        filtered.sort((a, b) => {
            if (a.date !== b.date) return a.date.localeCompare(b.date);
            return a.slot - b.slot;
        });

        return filtered.length > 0 ? filtered : localRecords;
    }

    /**
     * 利用可能な全受渡日の一覧を取得
     */
    async getAvailableDates() {
        const datesSet = new Set();

        // 1. 静的 dates.json から読み込み
        try {
            const resp = await fetch('./data/dates.json');
            if (resp.ok) {
                const data = await resp.json();
                if (data.dates && Array.isArray(data.dates)) {
                    data.dates.forEach(d => datesSet.add(d));
                }
            }
        } catch (e) {}

        // 2. ローカルIndexedDBに保存されている日付もマージ
        if (!this.db) await this.init();
        await new Promise((resolve) => {
            try {
                const transaction = this.db.transaction([STORE_SPOT], 'readonly');
                const spotStore = transaction.objectStore(STORE_SPOT);
                const index = spotStore.index('date');
                const request = index.openKeyCursor(null, 'nextunique');
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (cursor) {
                        datesSet.add(cursor.key);
                        cursor.continue();
                    } else {
                        resolve();
                    }
                };
                request.onerror = () => resolve();
            } catch (e) {
                resolve();
            }
        });

        const sortedDates = Array.from(datesSet).sort();
        return sortedDates;
    }

    /**
     * メタデータ（総件数、最新更新日時）を更新
     */
    async updateMetadata() {
        if (!this.db) return;
        const transaction = this.db.transaction([STORE_SPOT, STORE_META], 'readwrite');
        const spotStore = transaction.objectStore(STORE_SPOT);
        const metaStore = transaction.objectStore(STORE_META);

        const countReq = spotStore.count();
        countReq.onsuccess = () => {
            metaStore.put({ key: 'totalRecords', value: countReq.result });
            metaStore.put({ key: 'lastUpdated', value: new Date().toISOString() });
        };
    }

    /**
     * データベース統計情報を取得
     */
    async getStats() {
        if (!this.db) await this.init();
        const dates = await this.getAvailableDates();
        return {
            totalDates: dates.length,
            minDate: dates.length > 0 ? dates[0] : null,
            maxDate: dates.length > 0 ? dates[dates.length - 1] : null,
            totalSlots: dates.length * 48
        };
    }

    /**
     * 全データの削除（リセット用）
     */
    async clearAll() {
        if (!this.db) await this.init();
        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction([STORE_SPOT, STORE_META], 'readwrite');
            transaction.objectStore(STORE_SPOT).clear();
            transaction.objectStore(STORE_META).clear();
            transaction.oncomplete = () => resolve(true);
            transaction.onerror = () => reject(transaction.error);
        });
    }
}

// グローバルインスタンスのエクスポート
window.jepxDB = new JepxDatabase();
