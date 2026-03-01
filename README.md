# MentorQ

## Chrome拡張: MenthorQ Levels Exporter

`chrome-extension-mentorq-export` は、`app.menthorq.io/en/levels` の結果（`<pre>`のテキスト）をローカルファイルへ保存するためのGoogle Chrome拡張です。

### できること
- 現在表示中の結果を JSON / CSV で保存
- Symbol指定時は `SPX:` のような先頭プレフィックスで対象ブロックを選択
- **指定した銘柄だけを自動巡回し、Gamma Levels EOD を過去N日分まで遡って収集**
  - 日数は任意に入力可能（1日以上）
  - `Prev Date` で遡る際、日付が実際に古くなっているかを検証
  - 必要に応じて `Next Date` で最新日に戻してから収集
  - 保存先ディレクトリ（Downloads配下）を指定可能
  - 出力形式を JSONL / CSV から選択可能
  - **日付＋銘柄ごとに1レコード（1行）で出力**

### 使い方
1. Chromeで `chrome://extensions` を開く
2. 右上の「デベロッパーモード」をON
3. 「パッケージ化されていない拡張機能を読み込む」で `chrome-extension-mentorq-export` を選択
4. `https://app.menthorq.io/en/levels` を開く
5. 拡張アイコンをクリック

#### 単発保存
- 必要ならSymbolを入力して「現在表示をJSONで保存」または「現在表示をCSVで保存」

#### 自動収集（指定銘柄 × Gamma Levels EOD）
- 対象ティッカーをカンマ区切り、または改行で入力（例: `SPY, NQ1!, GLD`）
- 保存日数（過去N日）を入力
- 保存先ディレクトリ（例: `mentorq-levels`）を入力
- 出力形式（JSONL/CSV）を選択
- 「指定銘柄を自動収集（Gamma Levels EOD）」を実行
- 処理後、`<保存先ディレクトリ>/tickers_by_date_*.jsonl` または `.csv` として保存

### ファイル構成
- `chrome-extension-mentorq-export/manifest.json`: 拡張定義（MV3）
- `chrome-extension-mentorq-export/popup.html`: ポップアップUI
- `chrome-extension-mentorq-export/popup.js`: DOM抽出・自動収集・変換・ダウンロード処理

### 注意
- サイトUIが変わると、抽出ロジック（`pre`探索・ボタンクリック探索）を調整する必要があります。
- 銘柄選択ドロップダウンのDOM構造が変更された場合、セレクタ調整が必要です。
- 自動収集はページ操作（ticker選択、Search、Prev Date/Next Date）を行うため、処理中はタブを foreground のままにしてください。
