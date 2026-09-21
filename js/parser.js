/**
 * JEPX CSV/JSON パーサーおよびデータ正規化モジュール
 * 公式JEPXスポット市場CSV（Shift-JIS/UTF-8）を解析し、分断状況を自動計算します。
 */

const AREA_KEYS = [
    { key: 'hokkaido', name: '北海道', colNames: ['エリアプライス北海道(円/kWh)', '北海道'] },
    { key: 'tohoku',   name: '東北',   colNames: ['エリアプライス東北(円/kWh)', '東北'] },
    { key: 'tokyo',    name: '東京',   colNames: ['エリアプライス東京(円/kWh)', '東京'] },
    { key: 'chubu',    name: '中部',   colNames: ['エリアプライス中部(円/kWh)', '中部'] },
    { key: 'hokuriku', name: '北陸',   colNames: ['エリアプライス北陸(円/kWh)', '北陸'] },
    { key: 'kansai',   name: '関西',   colNames: ['エリアプライス関西(円/kWh)', '関西'] },
    { key: 'chugoku',  name: '中国',   colNames: ['エリアプライス中国(円/kWh)', '中国'] },
    { key: 'shikoku',  name: '四国',   colNames: ['エリアプライス四国(円/kWh)', '四国'] },
    { key: 'kyushu',   name: '九州',   colNames: ['エリアプライス九州(円/kWh)', '九州'] },
];

// 主要連系線定義（エリア間の分断判定用）
const INTERCONNECTIONS = [
    { id: 'kitahon', name: '北本連系線', areaA: 'hokkaido', areaB: 'tohoku' },
    { id: 'tohoku_tokyo', name: '東北-東京', areaA: 'tohoku', areaB: 'tokyo' },
    { id: 'tokyo_chubu', name: '東京-中部(FC)', areaA: 'tokyo', areaB: 'chubu' },
    { id: 'chubu_kansai', name: '中部-関西', areaA: 'chubu', areaB: 'kansai' },
    { id: 'kansai_hokuriku', name: '関西-北陸', areaA: 'kansai', areaB: 'hokuriku' },
    { id: 'kansai_chugoku', name: '関西-中国', areaA: 'kansai', areaB: 'chugoku' },
    { id: 'chugoku_shikoku', name: '中国-四国', areaA: 'chugoku', areaB: 'shikoku' },
    { id: 'chugoku_kyushu', name: '関門(中国-九州)', areaA: 'chugoku', areaB: 'kyushu' },
];

class JepxParser {
    /**
     * コマ番号(1-48)から時刻文字列 (例: "00:00 - 00:30") を生成
     * @param {number} slot 
     */
    static getSlotTimeLabel(slot) {
        const startMin = (slot - 1) * 30;
        const endMin = slot * 30;
        const sh = String(Math.floor(startMin / 60)).padStart(2, '0');
        const sm = String(startMin % 60).padStart(2, '0');
        const eh = String(Math.floor(endMin / 60)).padStart(2, '0');
        const em = String(endMin % 60).padStart(2, '0');
        return `${sh}:${sm} - ${eh}:${em}`;
    }

    /**
     * コマ番号(1-48)から開始時刻 (例: "00:00") を生成
     * @param {number} slot 
     */
    static getSlotStartTime(slot) {
        const startMin = (slot - 1) * 30;
        const sh = String(Math.floor(startMin / 60)).padStart(2, '0');
        const sm = String(startMin % 60).padStart(2, '0');
        return `${sh}:${sm}`;
    }

    /**
     * 日付文字列を 'YYYY-MM-DD' に正規化
     * @param {string} dateStr 
     */
    static normalizeDate(dateStr) {
        if (!dateStr) return '';
        const cleaned = dateStr.trim().replace(/\//g, '-');
        const parts = cleaned.split('-');
        if (parts.length === 3) {
            const year = parts[0];
            const month = String(parts[1]).padStart(2, '0');
            const day = String(parts[2]).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }
        return cleaned;
    }

    /**
     * JEPX CSVテキスト（UTF-8または変換済みテキスト）をパース
     * @param {string} csvText 
     */
    static parseCsv(csvText) {
        const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
        if (lines.length === 0) return [];

        // ヘッダー行の特定
        let headerIndex = -1;
        for (let i = 0; i < Math.min(lines.length, 10); i++) {
            if (lines[i].includes('年月日') || lines[i].includes('受渡日') || lines[i].includes('システムプライス') || lines[i].includes('日付')) {
                headerIndex = i;
                break;
            }
        }

        if (headerIndex === -1) {
            throw new Error('JEPX CSVヘッダー行が見つかりませんでした。');
        }

        const headers = lines[headerIndex].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
        
        // カラムインデックスのマップ作成
        const colMap = {
            date: headers.findIndex(h => h.includes('年月日') || h.includes('受渡日') || h.includes('日付')),
            slot: headers.findIndex(h => h.includes('時刻コード') || h.includes('コマ') || h.includes('時刻')),
            sellBid: headers.findIndex(h => h.includes('売り入札量') || h.includes('売り')),
            buyBid: headers.findIndex(h => h.includes('買い入札量') || h.includes('買い')),
            volume: headers.findIndex(h => h.includes('約定総量') || h.includes('約定')),
            systemPrice: headers.findIndex(h => h.includes('システムプライス') || h.includes('システム')),
            areaPrices: {}
        };

        AREA_KEYS.forEach(area => {
            colMap.areaPrices[area.key] = headers.findIndex(h => 
                area.colNames.some(cName => h.includes(cName))
            );
        });

        const records = [];

        for (let i = headerIndex + 1; i < lines.length; i++) {
            const cols = lines[i].split(',').map(c => c.trim().replace(/^["']|["']$/g, ''));
            if (cols.length < 5) continue;

            const rawDate = cols[colMap.date];
            const date = this.normalizeDate(rawDate);
            const slot = parseInt(cols[colMap.slot], 10);

            if (!date || isNaN(slot) || slot < 1 || slot > 48) continue;

            const systemPrice = parseFloat(cols[colMap.systemPrice]) || 0;
            const volume = parseFloat(cols[colMap.volume]) || 0;
            const sellBid = colMap.sellBid !== -1 ? (parseFloat(cols[colMap.sellBid]) || 0) : 0;
            const buyBid = colMap.buyBid !== -1 ? (parseFloat(cols[colMap.buyBid]) || 0) : 0;

            const areaPrices = {};
            let isSplitFromSystem = false;
            const splitAreas = [];

            AREA_KEYS.forEach(area => {
                const idx = colMap.areaPrices[area.key];
                const price = idx !== -1 && !isNaN(parseFloat(cols[idx])) 
                    ? parseFloat(cols[idx]) 
                    : systemPrice;
                
                areaPrices[area.key] = price;

                // システム価格との乖離判定（0.01円以上差がある場合は分断とみなす）
                if (Math.abs(price - systemPrice) > 0.01) {
                    isSplitFromSystem = true;
                    splitAreas.push(area.key);
                }
            });

            // 連系線ごとの分断判定（両端エリアの価格差が0.01円以上）
            const connectionSplits = {};
            let totalLineSplits = 0;
            INTERCONNECTIONS.forEach(conn => {
                const priceA = areaPrices[conn.areaA];
                const priceB = areaPrices[conn.areaB];
                const isLineSplit = Math.abs(priceA - priceB) > 0.01;
                connectionSplits[conn.id] = {
                    split: isLineSplit,
                    spread: parseFloat((priceB - priceA).toFixed(2))
                };
                if (isLineSplit) totalLineSplits++;
            });

            const dateParts = date.split('-');
            const year = parseInt(dateParts[0], 10);
            const month = parseInt(dateParts[1], 10);

            records.push({
                id: `${date}_${slot}`,
                date,
                year,
                month,
                slot,
                timeLabel: this.getSlotTimeLabel(slot),
                startTime: this.getSlotStartTime(slot),
                systemPrice: parseFloat(systemPrice.toFixed(2)),
                volume,
                sellBid,
                buyBid,
                areaPrices,
                isSplit: isSplitFromSystem || totalLineSplits > 0,
                splitAreas,
                splitCount: splitAreas.length,
                connectionSplits,
                totalLineSplits
            });
        }

        return records;
    }
}

// グローバルスコープへの公開
window.JepxParser = JepxParser;
window.AREA_KEYS = AREA_KEYS;
window.INTERCONNECTIONS = INTERCONNECTIONS;
