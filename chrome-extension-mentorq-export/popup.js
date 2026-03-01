const statusEl = document.getElementById("status");
const symbolInput = document.getElementById("symbolInput");
const tickerListInput = document.getElementById("tickerListInput");
const daysBackInput = document.getElementById("daysBackInput");
const saveDirInput = document.getElementById("saveDirInput");
const outputFormatSelect = document.getElementById("outputFormat");

const SETTINGS_KEY = "mentorqExporterSettings";

function setStatus(message) {
  statusEl.textContent = message;
}

function appendStatus(message) {
  statusEl.textContent = `${statusEl.textContent}\n${message}`.trim();
}

function parseTickerList(input) {
  const list = input
    .split(/[\n,\s]+/)
    .map((v) => v.trim().toUpperCase())
    .filter(Boolean)
    .filter((v) => /^[A-Z0-9!._-]{1,15}$/.test(v));
  return [...new Set(list)];
}

function normalizeSaveDir(dir) {
  const sanitized = (dir || "mentorq-levels")
    .replace(/\\+/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.replace(/[^\w.-]/g, "_"))
    .filter(Boolean)
    .join("/");
  return sanitized || "mentorq-levels";
}

function parseDate(value) {
  if (!value) return null;
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

function flattenRows(result) {
  const rows = [];
  for (const tickerData of result.tickers) {
    const warning = tickerData.warnings.join("; ");
    for (const record of tickerData.records) {
      const parsed = parseLevels(record.rawText);
      rows.push({
        date: record.date,
        requestedTicker: tickerData.ticker,
        symbol: parsed.symbol,
        capturedAt: parsed.capturedAt,
        rawText: parsed.rawText,
        items: parsed.items,
        warning
      });
    }
  }
  return rows;
}

function toAutomationCsv(rows) {
  const escape = (v) => `"${String(v ?? "").replaceAll('"', '""')}"`;
  const header = ["date", "requested_ticker", "symbol", "captured_at", "raw_text", "items_json", "warning"];
  const lines = rows.map((row) => [
    row.date,
    row.requestedTicker,
    row.symbol,
    row.capturedAt,
    row.rawText,
    JSON.stringify(row.items),
    row.warning
  ]);
  return [header, ...lines].map((line) => line.map(escape).join(",")).join("\n");
}

function toAutomationJsonl(rows) {
  return rows
    .map((row) => JSON.stringify({
      date: row.date,
      requestedTicker: row.requestedTicker,
      symbol: row.symbol,
      capturedAt: row.capturedAt,
      rawText: row.rawText,
      items: row.items,
      warning: row.warning
    }))
    .join("\n");
}

async function loadSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = stored[SETTINGS_KEY] || {};
  if (settings.tickerList) tickerListInput.value = settings.tickerList;
  if (settings.daysBack) daysBackInput.value = String(settings.daysBack);
  if (settings.saveDir) saveDirInput.value = settings.saveDir;
  if (settings.outputFormat) outputFormatSelect.value = settings.outputFormat;
}

async function saveSettings() {
  const payload = {
    tickerList: tickerListInput.value,
    daysBack: Number(daysBackInput.value || "7"),
    saveDir: normalizeSaveDir(saveDirInput.value),
    outputFormat: outputFormatSelect.value
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: payload });
}

function parseLevels(rawText) {
  const clean = rawText.replace(/^\s*"?|"?\s*$/g, "");
  const [symbolPart, ...restParts] = clean.split(":");
  const payload = restParts.join(":").trim();
  const items = payload
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  return {
    symbol: symbolPart?.trim() || "UNKNOWN",
    capturedAt: new Date().toISOString(),
    rawText: clean,
    items
  };
}

function toCsv(record) {
  const escape = (v) => `"${String(v).replaceAll('"', '""')}"`;
  const header = ["symbol", "captured_at", "item_index", "item"];
  const rows = record.items.map((item, idx) => [record.symbol, record.capturedAt, idx + 1, item]);
  return [header, ...rows].map((row) => row.map(escape).join(",")).join("\n");
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function runInPage(tabId, func, args = []) {
  const [{ result }] = await chrome.scripting.executeScript({
    target: { tabId },
    func,
    args
  });
  return result;
}

async function extractRawText(tabId, preferredSymbol) {
  return runInPage(
    tabId,
    (symbol) => {
      const blocks = Array.from(document.querySelectorAll("pre"));
      if (!blocks.length) {
        return { ok: false, error: "pre要素が見つかりません。Search実行後に再度試してください。" };
      }

      const bySymbol = symbol
        ? blocks.find((b) => b.textContent?.toUpperCase().startsWith(`${symbol.toUpperCase()}:`))
        : null;

      const selected = bySymbol || blocks[0];
      const rawText = selected.textContent?.trim();
      if (!rawText) {
        return { ok: false, error: "結果テキストが空です。" };
      }

      return { ok: true, rawText };
    },
    [preferredSymbol]
  );
}

function downloadContent(filename, content, mime) {
  const url = `data:${mime};charset=utf-8,${encodeURIComponent(content)}`;
  return chrome.downloads.download({
    url,
    filename,
    saveAs: false
  });
}

async function exportFile(format) {
  try {
    const tab = await getActiveTab();
    if (!tab?.id || !tab.url?.includes("app.menthorq.io/en/levels")) {
      setStatus("MenthorQ の levels ページを開いてから実行してください。");
      return;
    }

    const preferredSymbol = symbolInput.value.trim();
    const extracted = await extractRawText(tab.id, preferredSymbol);
    if (!extracted.ok) {
      setStatus(`抽出失敗: ${extracted.error}`);
      return;
    }

    const record = parseLevels(extracted.rawText);
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    const base = `mentorq-levels/${record.symbol}_${timestamp}`;

    if (format === "json") {
      await downloadContent(`${base}.json`, JSON.stringify(record, null, 2), "application/json");
      setStatus("JSONを自動ダウンロードしました。");
      return;
    }

    const csv = toCsv(record);
    await downloadContent(`${base}.csv`, csv, "text/csv");
    setStatus("CSVを自動ダウンロードしました。");
  } catch (error) {
    setStatus(`エラー: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function runTickerAutomation(tabId, tickers, daysBack) {
  return runInPage(
    tabId,
    async (requestedTickers, requestedDaysBack) => {
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

      const clickByText = (selector, text) => {
        const node = Array.from(document.querySelectorAll(selector)).find((el) =>
          el.textContent?.trim().includes(text)
        );
        if (node) {
          node.click();
          return true;
        }
        return false;
      };

      const getDisplayedDate = () => {
        const datePattern = /\d{4}-\d{2}-\d{2}/;
        const node = Array.from(document.querySelectorAll("*"))
          .find((el) => el.children.length === 0 && datePattern.test(el.textContent || ""));
        const text = node?.textContent || "";
        return text.match(datePattern)?.[0] || null;
      };

      const getCurrentRawText = () => {
        const pre = document.querySelector("pre");
        return pre?.textContent?.trim() || null;
      };

      const openTickerDropdown = () => {
        const triggers = Array.from(document.querySelectorAll('button[role="combobox"]'));
        const trigger = triggers.find((el) => /select tickers/i.test(el.textContent || "")) || triggers[0];
        if (!trigger) return false;
        trigger.click();
        return true;
      };

      const clearSelectedTickers = () => {
        const clearButtons = Array.from(document.querySelectorAll("button"))
          .filter((btn) => /remove|clear|×|x/i.test((btn.getAttribute("aria-label") || "") + (btn.textContent || "")));
        clearButtons.forEach((btn) => {
          const rect = btn.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            btn.click();
          }
        });
      };

      const chooseSearchTickersTab = () => clickByText("button", "Search Tickers");

      const selectTicker = async (ticker) => {
        const input = document.querySelector('input[placeholder*="Search" i], input[type="text"]');
        if (input) {
          input.focus();
          input.value = ticker;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          await sleep(120);
        }

        const option = Array.from(document.querySelectorAll('[role="option"], [cmdk-item], button, div')).find((el) => {
          const txt = (el.textContent || "").trim().toUpperCase();
          return txt === ticker.toUpperCase();
        });
        if (!option) return false;
        option.click();
        return true;
      };

      const ensureGammaEod = async () => {
        const okOpen = Array.from(document.querySelectorAll('button[role="combobox"]')).some((btn) => {
          const txt = (btn.textContent || "").toLowerCase();
          if (txt.includes("gamma") || txt.includes("type")) {
            btn.click();
            return true;
          }
          return false;
        });
        if (!okOpen) return false;
        await sleep(120);
        return clickByText("[role='option'], button, div", "Gamma Levels EOD");
      };

      const clickSearch = () => clickByText("button", "Search");
      const clickPrevDate = () => clickByText("button", "Prev Date");
      const clickNextDate = () => clickByText("button", "Next Date");

      const waitForResultUpdate = async ({ prevRaw, prevDate, timeout = 12000 }) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const currentRaw = getCurrentRawText();
          const currentDate = getDisplayedDate();
          if (currentRaw && (currentRaw !== prevRaw || (currentDate && currentDate !== prevDate))) {
            return { changed: true, currentRaw, currentDate };
          }
          await sleep(180);
        }
        return { changed: false, currentRaw: getCurrentRawText(), currentDate: getDisplayedDate() };
      };

      const normalizeSymbolInPage = (symbol) => String(symbol || "").replace(/^\$/, "").trim().toUpperCase();

      const output = {
        ok: true,
        daysBack: requestedDaysBack,
        requestedTickers,
        generatedAt: new Date().toISOString(),
        tickers: []
      };

      for (const ticker of requestedTickers) {
        const perTicker = { ticker, records: [], warnings: [] };

        if (!openTickerDropdown()) {
          perTicker.warnings.push("ticker dropdown open failed");
          output.tickers.push(perTicker);
          continue;
        }

        chooseSearchTickersTab();
        clearSelectedTickers();

        if (!(await selectTicker(ticker))) {
          perTicker.warnings.push("ticker selection failed");
          output.tickers.push(perTicker);
          clickByText("body", "Search Tickers");
          continue;
        }

        const gammaOk = await ensureGammaEod();
        if (!gammaOk) {
          perTicker.warnings.push("gamma eod selection failed");
        }

        const beforeSearchRaw = getCurrentRawText();
        const beforeSearchDate = getDisplayedDate();
        if (!clickSearch()) {
          perTicker.warnings.push("search click failed");
          output.tickers.push(perTicker);
          continue;
        }

        const firstUpdate = await waitForResultUpdate({ prevRaw: beforeSearchRaw, prevDate: beforeSearchDate, timeout: 15000 });
        if (!firstUpdate.changed || !firstUpdate.currentRaw) {
          perTicker.warnings.push("search result timeout or empty");
          output.tickers.push(perTicker);
          continue;
        }

        let lastRaw = firstUpdate.currentRaw;
        let lastDate = firstUpdate.currentDate;

        const firstSymbol = normalizeSymbolInPage(firstUpdate.currentRaw.split(":")[0]);
        if (firstSymbol !== normalizeSymbolInPage(ticker)) {
          perTicker.warnings.push(`symbol mismatch after search: expected ${ticker}, got ${firstSymbol || "UNKNOWN"}`);
          output.tickers.push(perTicker);
          continue;
        }

        if (lastDate) {
          // 可能なら最新日まで進めてから収集開始
          for (let i = 0; i < 30; i += 1) {
            const prevDate = getDisplayedDate();
            const prevRaw = getCurrentRawText();
            if (!clickNextDate()) break;
            const next = await waitForResultUpdate({ prevRaw, prevDate, timeout: 5000 });
            if (!next.changed) break;
            const nextDateTs = Date.parse(next.currentDate || "");
            const prevDateTs = Date.parse(prevDate || "");
            if (!Number.isNaN(nextDateTs) && !Number.isNaN(prevDateTs) && nextDateTs < prevDateTs) {
              perTicker.warnings.push("next date moved backward unexpectedly");
              break;
            }
            lastRaw = next.currentRaw || lastRaw;
            lastDate = next.currentDate || lastDate;
          }
        }

        if (lastRaw) {
          perTicker.records.push({ date: lastDate || "unknown", rawText: lastRaw });
        }

        const seenDates = new Set(perTicker.records.map((r) => r.date));
        let prevDateTs = parseDate(lastDate);

        while (seenDates.size < requestedDaysBack) {
          const beforePrevRaw = getCurrentRawText();
          const beforePrevDate = getDisplayedDate();
          if (!clickPrevDate()) {
            perTicker.warnings.push("prev date unavailable before enough days");
            break;
          }

          const moved = await waitForResultUpdate({ prevRaw: beforePrevRaw, prevDate: beforePrevDate, timeout: 15000 });
          if (!moved.changed || !moved.currentRaw) {
            perTicker.warnings.push("prev date timeout");
            break;
          }

          const movedDateTs = parseDate(moved.currentDate);
          if (prevDateTs && movedDateTs && movedDateTs >= prevDateTs) {
            perTicker.warnings.push("prev date did not move to older date");
            break;
          }

          const currentSymbol = normalizeSymbolInPage(moved.currentRaw.split(":")[0]);
          if (currentSymbol !== normalizeSymbolInPage(ticker)) {
            perTicker.warnings.push(`symbol mismatch on prev date: expected ${ticker}, got ${currentSymbol || "UNKNOWN"}`);
            break;
          }

          const key = moved.currentDate || `unknown-${perTicker.records.length + 1}`;
          if (!seenDates.has(key)) {
            perTicker.records.push({ date: key, rawText: moved.currentRaw });
            seenDates.add(key);
            prevDateTs = movedDateTs || prevDateTs;
          }
        }

        output.tickers.push(perTicker);
      }

      return output;
    },
    [tickers, daysBack]
  );
}

async function autoCollectTickers() {
  try {
    setStatus("自動収集を開始します...");
    const tab = await getActiveTab();
    if (!tab?.id || !tab.url?.includes("app.menthorq.io/en/levels")) {
      setStatus("MenthorQ の levels ページを開いてから実行してください。");
      return;
    }

    const tickers = parseTickerList(tickerListInput.value);
    if (!tickers.length) {
      setStatus("対象ティッカーを1つ以上入力してください（例: SPY, NQ1!）。");
      return;
    }

    const daysBack = Math.max(1, Number(daysBackInput.value || "7"));
    const saveDir = normalizeSaveDir(saveDirInput.value);
    const outputFormat = outputFormatSelect.value === "csv" ? "csv" : "jsonl";
    saveDirInput.value = saveDir;
    await saveSettings();

    appendStatus(`対象銘柄: ${tickers.join(", ")}`);
    appendStatus(`対象期間: 過去${daysBack}日`);
    appendStatus(`保存先: ${saveDir}/`);
    appendStatus(`出力形式: ${outputFormat.toUpperCase()}`);

    const result = await runTickerAutomation(tab.id, tickers, daysBack);
    if (!result.ok) {
      setStatus(`自動収集失敗: ${result.error}`);
      return;
    }

    const rows = flattenRows(result);
    const timestamp = new Date().toISOString().replaceAll(":", "-");
    if (outputFormat === "csv") {
      const csv = toAutomationCsv(rows);
      await downloadContent(`${saveDir}/tickers_by_date_${timestamp}.csv`, csv, "text/csv");
    } else {
      const jsonl = toAutomationJsonl(rows);
      await downloadContent(`${saveDir}/tickers_by_date_${timestamp}.jsonl`, jsonl, "application/x-ndjson");
    }

    const okCount = result.tickers.filter((t) => t.records.length > 0).length;
    appendStatus(`完了: ${okCount}/${result.tickers.length} 銘柄を保存`);
    const warningCount = result.tickers.reduce((acc, t) => acc + t.warnings.length, 0);
    if (warningCount > 0) {
      appendStatus(`警告: ${warningCount} 件（詳細は出力行の warning 列/項目を確認）`);
    }
    appendStatus("ファイルを自動ダウンロードしました。");
  } catch (error) {
    setStatus(`エラー: ${error instanceof Error ? error.message : String(error)}`);
  }
}

document.getElementById("exportJson").addEventListener("click", () => exportFile("json"));
document.getElementById("exportCsv").addEventListener("click", () => exportFile("csv"));
document.getElementById("runTickerAuto").addEventListener("click", autoCollectTickers);

loadSettings().catch((error) => {
  setStatus(`設定読み込みエラー: ${error instanceof Error ? error.message : String(error)}`);
});

[tickerListInput, daysBackInput, saveDirInput, outputFormatSelect].forEach((el) => {
  el.addEventListener("change", () => {
    saveSettings().catch(() => {});
  });
});
