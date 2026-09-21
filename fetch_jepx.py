"""
JEPX スポット市場 CSV 自動取得・差分検知・データ整形スクリプト
2018年度〜最新年度までの過去一括取得および日次スマート差分追従に対応
外部ライブラリ不要（Python標準ライブラリのみで高速動作）
"""

import sys
import os
import csv
import json
import time
import argparse
import urllib.request
import urllib.parse
from datetime import datetime, timezone, timedelta

# JST タイムゾーン定義
JST = timezone(timedelta(hours=9))

# JEPX エンドポイント
JEPX_DOWNLOAD_URL = "https://www.jepx.jp/_download.php"

# エリア定義
AREA_KEYS = [
    {"key": "hokkaido", "name": "北海道", "col_names": ["エリアプライス北海道(円/kWh)", "北海道"]},
    {"key": "tohoku",   "name": "東北",   "col_names": ["エリアプライス東北(円/kWh)", "東北"]},
    {"key": "tokyo",    "name": "東京",   "col_names": ["エリアプライス東京(円/kWh)", "東京"]},
    {"key": "chubu",    "name": "中部",   "col_names": ["エリアプライス中部(円/kWh)", "中部"]},
    {"key": "hokuriku", "name": "北陸",   "col_names": ["エリアプライス北陸(円/kWh)", "北陸"]},
    {"key": "kansai",   "name": "関西",   "col_names": ["エリアプライス関西(円/kWh)", "関西"]},
    {"key": "chugoku",  "name": "中国",   "col_names": ["エリアプライス中国(円/kWh)", "中国"]},
    {"key": "shikoku",  "name": "四国",   "col_names": ["エリアプライス四国(円/kWh)", "四国"]},
    {"key": "kyushu",   "name": "九州",   "col_names": ["エリアプライス九州(円/kWh)", "九州"]},
]

def get_current_fiscal_year(target_date: datetime = None) -> int:
    """現在の日本電力年度（4月1日〜翌年3月31日）を算出"""
    if target_date is None:
        target_date = datetime.now(JST)
    return target_date.year if target_date.month >= 4 else target_date.year - 1

def download_jepx_csv(year: int) -> str:
    """JEPXから指定年度のスポット市場CSVをダウンロード"""
    filename = f"spot_summary_{year}.csv"
    data = urllib.parse.urlencode({
        "dir": "spot_summary",
        "file": filename
    }).encode("utf-8")

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.jepx.jp/electricpower/market-data/spot/"
    }

    req = urllib.request.Request(JEPX_DOWNLOAD_URL, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            content_bytes = resp.read()
    except Exception as e:
        print(f"[エラー] {year}年度のJEPX CSVダウンロードに失敗しました: {e}", file=sys.stderr)
        return ""

    for enc in ["cp932", "shift_jis", "utf-8"]:
        try:
            return content_bytes.decode(enc)
        except UnicodeDecodeError:
            continue

    return content_bytes.decode("cp932", errors="ignore")

def parse_jepx_csv(csv_text: str):
    """JEPX CSVテキストをパースして構造化レコードリストを生成"""
    if not csv_text:
        return []

    lines = [line for line in csv_text.splitlines() if line.strip()]
    if not lines:
        return []

    header_idx = -1
    for i in range(min(15, len(lines))):
        if any(keyword in lines[i] for keyword in ["年月日", "受渡日", "システムプライス", "日付"]):
            header_idx = i
            break

    if header_idx == -1:
        return []

    reader = csv.reader(lines[header_idx:])
    headers = [h.strip() for h in next(reader)]

    def find_col(candidates):
        for c in candidates:
            for idx, h in enumerate(headers):
                if c in h:
                    return idx
        return -1

    date_col = find_col(["年月日", "受渡日", "日付"])
    slot_col = find_col(["時刻コード", "コマ", "時刻"])
    volume_col = find_col(["約定総量", "約定"])
    system_col = find_col(["システムプライス", "システム"])
    sell_col = find_col(["売り入札量", "売り"])
    buy_col = find_col(["買い入札量", "買い"])

    area_cols = {}
    for a in AREA_KEYS:
        area_cols[a["key"]] = find_col(a["col_names"])

    records = []
    for row in reader:
        if len(row) <= max(date_col, slot_col, system_col):
            continue

        raw_date = row[date_col].strip().replace("/", "-")
        date_parts = raw_date.split("-")
        if len(date_parts) == 3:
            date_str = f"{date_parts[0]}-{int(date_parts[1]):02d}-{int(date_parts[2]):02d}"
        else:
            date_str = raw_date

        try:
            slot = int(row[slot_col].strip())
        except ValueError:
            continue

        if slot < 1 or slot > 48:
            continue

        try:
            sys_price = float(row[system_col].strip())
        except ValueError:
            sys_price = 0.0

        try:
            volume = float(row[volume_col].strip()) if volume_col != -1 else 0.0
        except ValueError:
            volume = 0.0

        try:
            sell_bid = float(row[sell_col].strip()) if sell_col != -1 else 0.0
        except ValueError:
            sell_bid = 0.0

        try:
            buy_bid = float(row[buy_col].strip()) if buy_col != -1 else 0.0
        except ValueError:
            buy_bid = 0.0

        area_prices = {}
        split_areas = []
        is_split = False

        for a in AREA_KEYS:
            c_idx = area_cols[a["key"]]
            if c_idx != -1 and c_idx < len(row):
                try:
                    p = float(row[c_idx].strip())
                except ValueError:
                    p = sys_price
            else:
                p = sys_price

            area_prices[a["key"]] = round(p, 2)
            if abs(p - sys_price) > 0.01:
                is_split = True
                split_areas.append(a["key"])

        # 連系線判定
        interconns = [
            ("hokkaido", "tohoku"),
            ("tohoku", "tokyo"),
            ("tokyo", "chubu"),
            ("chubu", "kansai"),
            ("kansai", "hokuriku"),
            ("kansai", "chugoku"),
            ("chugoku", "shikoku"),
            ("chugoku", "kyushu"),
        ]
        line_splits = 0
        for a1, a2 in interconns:
            if abs(area_prices.get(a1, 0) - area_prices.get(a2, 0)) > 0.01:
                line_splits += 1
                is_split = True

        start_min = (slot - 1) * 30
        end_min = slot * 30
        sh, sm = divmod(start_min, 60)
        eh, em = divmod(end_min, 60)
        time_label = f"{sh:02d}:{sm:02d} - {eh:02d}:{em:02d}"
        start_time = f"{sh:02d}:{sm:02d}"

        year_val = int(date_parts[0]) if len(date_parts) == 3 else 2026
        month_val = int(date_parts[1]) if len(date_parts) == 3 else 1

        records.append({
            "id": f"{date_str}_{slot}",
            "date": date_str,
            "year": year_val,
            "month": month_val,
            "slot": slot,
            "timeLabel": time_label,
            "startTime": start_time,
            "systemPrice": round(sys_price, 2),
            "volume": volume,
            "sellBid": sell_bid,
            "buyBid": buy_bid,
            "areaPrices": area_prices,
            "isSplit": is_split,
            "splitAreas": split_areas,
            "splitCount": len(split_areas),
            "totalLineSplits": line_splits
        })

    return records

def fetch_single_year(year: int, data_dir: str):
    """単一年度のデータをダウンロード・パースして spots-{year}.json に保存"""
    print(f"[{datetime.now(JST).strftime('%H:%M:%S')}] {year}年度データ取得中...")
    csv_text = download_jepx_csv(year)
    if not csv_text:
        print(f"[スキップ] {year}年度のデータは取得できませんでした。")
        return []

    records = parse_jepx_csv(csv_text)
    if not records:
        print(f"[スキップ] {year}年度のレコードは0件でした。")
        return []

    year_file = os.path.join(data_dir, f"spots-{year}.json")
    with open(year_file, "w", encoding="utf-8") as f:
        json.dump({"records": records}, f, ensure_ascii=False)

    dates = sorted(list({r["date"] for r in records}))
    print(f"  -> {year}年度: {len(records)}コマ ({len(dates)}日分) 保存完了 ({dates[0]} 〜 {dates[-1]})")
    return dates

def update_dates_index(data_dir: str):
    """保存されている全年度の spots-*.json から日付一覧 dates.json を生成"""
    all_dates = set()
    for fname in os.listdir(data_dir):
        if fname.startswith("spots-") and fname.endswith(".json") and fname != "spots-latest.json":
            fpath = os.path.join(data_dir, fname)
            try:
                with open(fpath, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    for r in data.get("records", []):
                        all_dates.add(r["date"])
            except Exception:
                continue

    sorted_dates = sorted(list(all_dates))
    dates_file = os.path.join(data_dir, "dates.json")
    with open(dates_file, "w", encoding="utf-8") as f:
        json.dump({"dates": sorted_dates}, f, ensure_ascii=False)

    print(f">> 全受渡日インデックス更新完了: 計 {len(sorted_dates)} 日分 ({sorted_dates[0]} 〜 {sorted_dates[-1]})")
    return sorted_dates

def main():
    parser = argparse.ArgumentParser(description="JEPXスポット市場データ取得ツール")
    parser.add_argument("--start-year", type=int, default=None, help="取得開始年度 (例: 2018)")
    parser.add_argument("--end-year", type=int, default=None, help="取得終了年度 (例: 2026)")
    parser.add_argument("--all", action="store_true", help="2018年度から当年度までの全データを一括取得")
    args = parser.parse_args()

    base_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(base_dir, "data")
    os.makedirs(data_dir, exist_ok=True)

    current_year = get_current_fiscal_year()

    # --all または --start-year が指定された場合の一括取得
    if args.all or args.start_year is not None:
        start_year = args.start_year if args.start_year else 2018
        end_year = args.end_year if args.end_year else current_year

        print(f"==================================================")
        print(f"JEPX 過去データ一括取得モード: {start_year}年度 〜 {end_year}年度")
        print(f"==================================================")

        for y in range(start_year, end_year + 1):
            fetch_single_year(y, data_dir)
            time.sleep(1) # サーバー負荷防止のインターバル

        # 当年度分を spots-latest.json にもコピー
        current_year_file = os.path.join(data_dir, f"spots-{current_year}.json")
        if os.path.exists(current_year_file):
            with open(current_year_file, "r", encoding="utf-8") as f_src:
                latest_data = json.load(f_src)
            with open(os.path.join(data_dir, "spots-latest.json"), "w", encoding="utf-8") as f_dst:
                json.dump(latest_data, f_dst, ensure_ascii=False)

        # 全日付インデックスの更新
        update_dates_index(data_dir)
        print(">> 過去データの一括取得がすべて完了しました！")
        return

    # 日常の定期実行（当年度スマート差分追従モード）
    status_file = os.path.join(data_dir, "latest_status.json")
    last_status = {}
    if os.path.exists(status_file):
        try:
            with open(status_file, "r", encoding="utf-8") as f:
                last_status = json.load(f)
        except Exception:
            last_status = {}

    print(f"[{datetime.now(JST).strftime('%Y-%m-%d %H:%M:%S')}] JEPX {current_year}年度データ定期チェック中...")
    csv_text = download_jepx_csv(current_year)
    if not csv_text:
        print("[警告] JEPXからのCSV取得に失敗しました。")
        sys.exit(1)

    records = parse_jepx_csv(csv_text)
    if not records:
        print("[警告] CSVのパース結果が0件でした。")
        sys.exit(1)

    all_dates = sorted(list({r["date"] for r in records}))
    latest_date = all_dates[-1] if all_dates else ""
    prev_latest_date = last_status.get("latestDate", "")

    print(f"取得レコード数: {len(records)} 件 (対象日数: {len(all_dates)} 日)")
    print(f"最新受渡日: {latest_date} (前回記録: {prev_latest_date})")

    is_updated = (latest_date != prev_latest_date) or (len(records) != last_status.get("recordCount", 0))

    if not is_updated and len(records) > 0 and os.path.exists(os.path.join(data_dir, "spots-latest.json")):
        print(">> 新規受渡データの追加はありませんでした (差分なし・スキップ)")
        if "GITHUB_OUTPUT" in os.environ:
            with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as gh_out:
                gh_out.write("updated=false\n")
        return

    print(">> 新規データまたは更新を検知！JSONファイルを保存します...")

    # 当年度年別ファイル & spots-latest.json
    for out_name in [f"spots-{current_year}.json", "spots-latest.json"]:
        with open(os.path.join(data_dir, out_name), "w", encoding="utf-8") as f:
            json.dump({"records": records}, f, ensure_ascii=False)

    update_dates_index(data_dir)

    status_data = {
        "updatedAt": datetime.now(JST).isoformat(),
        "fiscalYear": current_year,
        "latestDate": latest_date,
        "totalDays": len(all_dates),
        "recordCount": len(records)
    }
    with open(status_file, "w", encoding="utf-8") as f:
        json.dump(status_data, f, ensure_ascii=False, indent=2)

    print(f">> 保存完了！最新受渡日: {latest_date}")

    if "GITHUB_OUTPUT" in os.environ:
        with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as gh_out:
            gh_out.write("updated=true\n")
            gh_out.write(f"latest_date={latest_date}\n")

if __name__ == "__main__":
    main()
