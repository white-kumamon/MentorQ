const statusEl = document.getElementById("status");
const symbolInput = document.getElementById("symbolInput");
const tickerListInput = document.getElementById("tickerListInput");
const daysBackInput = document.getElementById("daysBackInput");
const saveDirInput = document.getElementById("saveDirInput");

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

async function loadSettings() {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  const settings = stored[SETTINGS_KEY] || {};
  if (settings.tickerList) tickerListInput.value = settings.tickerList;
  if (settings.daysBack) daysBackInput.value = String(settings.daysBack);
  if (settings.saveDir) saveDirInput.value = settings.saveDir;
}

async function saveSettings() {
  const payload = {
    tickerList: tickerListInput.value,
    daysBack: Number(daysBackInput.value || "7"),
    saveDir: normalizeSaveDir(saveDirInput.value)
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
    saveAs: true
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
      setStatus("JSON保存ダイアログを開きました。保存先を選んでください。");
      return;
    }

    const csv = toCsv(record);
    await downloadContent(`${base}.csv`, csv, "text/csv");
    setStatus("CSV保存ダイアログを開きました。保存先を選んでください。");
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
        let clicked = 0;
        clearButtons.forEach((btn) => {
          const rect = btn.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            btn.click();
            clicked += 1;
          }
        });
        return clicked;
      };

      const chooseSearchTickersTab = () => clickByText("button", "Search Tickers");

      const selectTicker = async (ticker) => {
        const input = document.querySelector('input[placeholder*="Search" i], input[type="text"]');
        if (input) {
          input.focus();
          input.value = ticker;
          input.dispatchEvent(new Event("input", { bubbles: true }));
          await sleep(200);
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
        await sleep(200);
        const clicked = clickByText("[role='option'], button, div", "Gamma Levels EOD");
        await sleep(200);
        return clicked;
      };

      const clickSearch = () => clickByText("button", "Search");
      const clickPrevDate = () => clickByText("button", "Prev Date");

      const waitForTextChange = async (prev, timeout = 12000) => {
        const start = Date.now();
        while (Date.now() - start < timeout) {
          const current = getCurrentRawText();
          if (current && current !== prev) return true;
          await sleep(300);
        }
        return false;
      };

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

        await sleep(250);
        chooseSearchTickersTab();
        await sleep(200);
        clearSelectedTickers();

        if (!(await selectTicker(ticker))) {
          perTicker.warnings.push("ticker selection failed");
          output.tickers.push(perTicker);
          clickByText("body", "Search Tickers");
          continue;
        }

        await sleep(200);

        const gammaOk = await ensureGammaEod();
        if (!gammaOk) {
          perTicker.warnings.push("gamma eod selection failed");
        }

        const beforeSearch = getCurrentRawText();
        if (!clickSearch()) {
          perTicker.warnings.push("search click failed");
          output.tickers.push(perTicker);
          continue;
        }

        await waitForTextChange(beforeSearch, 15000);
        let raw = getCurrentRawText();
        let date = getDisplayedDate();
        if (raw) {
          perTicker.records.push({ date: date || "unknown", rawText: raw });
        } else {
          perTicker.warnings.push("search result empty");
        }

        const seenDates = new Set(perTicker.records.map((r) => r.date));

        while (seenDates.size < requestedDaysBack) {
          const prevBefore = getCurrentRawText();
          if (!clickPrevDate()) {
            perTicker.warnings.push("prev date unavailable before enough days");
            break;
          }
          const changed = await waitForTextChange(prevBefore, 15000);
          if (!changed) {
            perTicker.warnings.push("prev date timeout");
            break;
          }
          raw = getCurrentRawText();
          date = getDisplayedDate();
          const key = date || `unknown-${perTicker.records.length + 1}`;
          if (raw && !seenDates.has(key)) {
            perTicker.records.push({ date: key, rawText: raw });
            seenDates.add(key);
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
    saveDirInput.value = saveDir;
    await saveSettings();

    appendStatus(`対象銘柄: ${tickers.join(", ")}`);
    appendStatus(`対象期間: 過去${daysBack}日`);
    appendStatus(`保存先: ${saveDir}/`);

    const result = await runTickerAutomation(tab.id, tickers, daysBack);
    if (!result.ok) {
      setStatus(`自動収集失敗: ${result.error}`);
      return;
    }

    const normalized = {
      generatedAt: result.generatedAt,
      daysBack: result.daysBack,
      tickers: result.tickers.map((t) => ({
        ticker: t.ticker,
        warnings: t.warnings,
        records: t.records.map((r) => ({
          date: r.date,
          ...parseLevels(r.rawText)
        }))
      }))
    };

    const timestamp = new Date().toISOString().replaceAll(":", "-");
    const filename = `${saveDir}/tickers_gamma_eod_${timestamp}.json`;
    await downloadContent(filename, JSON.stringify(normalized, null, 2), "application/json");

    const okCount = normalized.tickers.filter((t) => t.records.length > 0).length;
    appendStatus(`完了: ${okCount}/${normalized.tickers.length} 銘柄を保存`);
    appendStatus("JSON保存ダイアログを開きました。");
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

[tickerListInput, daysBackInput, saveDirInput].forEach((el) => {
  el.addEventListener("change", () => {
    saveSettings().catch(() => {});
  });
});
