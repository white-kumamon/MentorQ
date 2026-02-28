# MentorQ

## Chrome拡張: MenthorQ Levels Exporter

`chrome-extension-mentorq-export` は、`app.menthorq.io/en/levels` の結果（`<pre>`のテキスト）をローカルファイルへ保存するためのGoogle Chrome拡張です。

### できること
- 現在表示中の結果を JSON / CSV で保存
- Symbol指定時は `SPX:` のような先頭プレフィックスで対象ブロックを選択
- **Watchlist全体を自動巡回し、Gamma Levels EOD を過去N日分（既定: 7日）まで遡って収集**
  - `Prev Date` を押して不足日を補完
  - 銘柄ごとに複数日データを1つのJSONで保存

### 使い方
1. Chromeで `chrome://extensions` を開く
2. 右上の「デベロッパーモード」をON
3. 「パッケージ化されていない拡張機能を読み込む」で `chrome-extension-mentorq-export` を選択
4. `https://app.menthorq.io/en/levels` を開く
5. 拡張アイコンをクリック

#### 単発保存
- 必要ならSymbolを入力して「現在表示をJSONで保存」または「現在表示をCSVで保存」

#### 自動収集（Watchlist × Gamma Levels EOD）
- 日数（5/7/10日）を選択
- 「Watchlistを自動収集（Gamma Levels EOD）」を実行
- 処理後、`mentorq-levels/watchlist_gamma_eod_*.json` として保存

### ファイル構成
- `chrome-extension-mentorq-export/manifest.json`: 拡張定義（MV3）
- `chrome-extension-mentorq-export/popup.html`: ポップアップUI
- `chrome-extension-mentorq-export/popup.js`: DOM抽出・自動収集・変換・ダウンロード処理

### 注意
- サイトUIが変わると、抽出ロジック（`pre`探索・ボタンクリック探索）を調整する必要があります。
- Watchlist / ドロップダウンのDOM構造が変更された場合も、セレクタ調整が必要です。
- 自動収集はページ操作（ticker選択、Search、Prev Date）を行うため、処理中はタブを foreground のままにしてください。
