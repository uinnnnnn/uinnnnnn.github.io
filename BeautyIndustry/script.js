"use strict";

/* ============================================================
   設定區：Google Apps Script 網頁應用程式網址與 API 金鑰
   ------------------------------------------------------------
   優先讀取瀏覽器本機（localStorage）裡使用者自己在「⚙ 後端設定」
   畫面貼上的值；沒有的話才用下面這組預設值。之後金鑰或網址異動，
   直接在網頁的「後端設定」畫面更新即可，不用再改這個檔案。
   ============================================================ */
const DEFAULT_API_BASE_URL = "https://script.google.com/macros/s/AKfycbyQoMf3hIGoRHgsky8ityzGcx8Qc9ug-TuKpJL9xA96ApNpC01fEFX13qlBhSesgnyO/exec";
const DEFAULT_API_TOKEN = "974fb0eddb474a71bc81746f992bc6e9";
const API_BASE_URL = localStorage.getItem("beautyStudioApiUrl") || DEFAULT_API_BASE_URL;
const API_TOKEN = localStorage.getItem("beautyStudioApiToken") || DEFAULT_API_TOKEN;

/* ============================================================
   Api：與 GAS 後端溝通的薄封裝
   ------------------------------------------------------------
   Google Apps Script 網頁應用程式的回應會先 302 轉址到
   script.googleusercontent.com，轉址過程中瀏覽器的 fetch() 會被
   CORS 擋掉（用瀏覽器網址列直接開網址不受影響，那是整頁導覽、不受
   CORS 限制，跟這裡的情況不一樣）。因此改用 JSONP（動態插入
   <script> 標籤，不受 CORS 限制）呼叫，讀取、寫入都走 GET。

   注意：JSONP 網址裡的 callback 參數，偶爾會被瀏覽器的隱私防護功能
   （例如 Brave Shields、Safari 防跨站追蹤）誤判成追蹤行為而擋掉，
   如果連線失敗，記得先確認瀏覽器的隱私/防護功能有沒有把這個網站擋掉。
   ============================================================ */
let jsonpCounter = 0;

function jsonpRequest(params) {
  return new Promise((resolve, reject) => {
    const callbackName = "__api_cb_" + (jsonpCounter++) + "_" + Date.now();
    const url = new URL(API_BASE_URL);
    url.searchParams.set("token", API_TOKEN);
    url.searchParams.set("callback", callbackName);
    Object.entries(params || {}).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
    });

    const script = document.createElement("script");
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("連線逾時，請確認網路連線或稍後再試"));
    }, 15000);

    function cleanup() {
      clearTimeout(timer);
      delete window[callbackName];
      script.remove();
    }

    window[callbackName] = (json) => {
      cleanup();
      if (!json || !json.ok) reject(new Error((json && (json.message || json.error)) || "未知錯誤"));
      else resolve(json.data);
    };
    script.onerror = () => {
      cleanup();
      reject(new Error("無法連線到後端，請確認網址是否正確、部署權限是否為「任何人」"));
    };
    script.src = url.toString();
    document.head.appendChild(script);
  });
}

const Api = {
  get(action, params) {
    return jsonpRequest({ action, ...params });
  },
  post(action, payload) {
    return jsonpRequest({ action, payload: JSON.stringify(payload || {}) });
  },
};

/* ============================================================
   共用小工具
   ============================================================ */
const tagLabel = { vip: "VIP", regular: "熟客", new: "新客" };
const statusLabel = {
  pending: "待確認", confirmed: "已確認", deposit: "已付訂",
  rescheduled: "改期", cancelled: "已取消", noshow: "未到店",
};
// 會計入營收 / 當日滿載程度的狀態（待確認、改期、未到店、已取消都不算）
const REVENUE_STATUSES = ["confirmed", "deposit"];
const PAYMENT_METHODS = ["現金", "轉帳", "信用卡", "LINE Pay", "其他"];
const CANCEL_REASONS = ["客人取消", "店家取消", "改期", "其他"];
function isChecked(v) { return v === true || v === "TRUE" || v === "true"; }
// 舊資料裡如果還留著已經拿掉的狀態（例如以前的「已完成」），畫面上一律當「已確認」處理，
// 避免顯示 undefined 或樣式跑掉。要徹底清乾淨的話，可以到 Google 試算表把「預約資料」裡
// 殘留的舊狀態文字直接改成 confirmed。
function normalizeStatus(s) { return statusLabel[s] ? s : "confirmed"; }
const weekday = ["日", "一", "二", "三", "四", "五", "六"];

function fmtDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function fmtDateLabel(d) {
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日（星期${weekday[d.getDay()]}）`;
}
function money(n) {
  return "$ " + Math.round(Number(n) || 0).toLocaleString();
}
function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ============================================================
   全域狀態
   ============================================================ */
const state = {
  settings: {},
  services: [],
  customers: [],
  bookings: [],      // 全部預約（未過濾）
  revenue: null,     // getRevenueSummary 回傳結果
  reports: [],       // 月報表存底
  selectedDate: new Date(),
  calView: "day", // "day" | "week" | "month"（平板／電腦用）
  agendaExpanded: false, // 手機議程模式：週列 vs 展開的月曆
  custFilter: "all",
  custSearch: "",
  blStatuses: null,   // null = 不篩選狀態（全部）；否則是已勾選狀態的陣列
  blCategory: "",
  blDateFrom: "",
  blDateTo: "",
};

/* ============================================================
   資料載入
   ============================================================ */
// 個人 Google 帳號的 Apps Script 網頁應用程式，同時處理多個請求時不太穩定
// （常常一次打好幾個請求，其中一個會被拖慢或失敗）。所以這裡改成「依序」呼叫，
// 且每個請求失敗時自動重試一次，避免單一請求偶發性失敗就讓整頁顯示連線失敗。
async function apiGetSafe(action, params) {
  try {
    return await Api.get(action, params);
  } catch (err) {
    await new Promise((r) => setTimeout(r, 800));
    return await Api.get(action, params); // 重試一次，還是失敗就把錯誤往外丟
  }
}

// 服務項目、系統設定幾乎不會變動，先快取在瀏覽器本機，下次開頁不用乾等 API 就能先用舊的顯示，
// 背景還是會重新打一次 API 確認有沒有更新（stale-while-revalidate）。
const CACHE_KEY_SETTINGS = "beautyStudioCache_settings";
const CACHE_KEY_SERVICES = "beautyStudioCache_services";
function loadCachedJSON(key) {
  try { return JSON.parse(localStorage.getItem(key) || "null"); } catch (err) { return null; }
}
function saveCachedJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (err) { /* 存不進去就算了，不影響功能 */ }
}

async function loadAll() {
  setConnStatus("loading");
  try {
    const cachedSettings = loadCachedJSON(CACHE_KEY_SETTINGS);
    const cachedServices = loadCachedJSON(CACHE_KEY_SERVICES);
    // 系統設定攸關 PIN 鎖定畫面，一定要在畫面顯示前確定：有快取就先用快取（快），沒快取才等 API（只有第一次會比較慢）
    state.settings = cachedSettings || (await apiGetSafe("getSettings")) || {};
    if (cachedServices) state.services = cachedServices;
    document.getElementById("brand-name").textContent = state.settings.ShopName || "指尖工作室";
    applyPinLock();

    // 首頁只先抓「今天」的預約，讓今日總覽盡快有資料；日曆／客戶／報表分頁維持原本的「載入中」畫面，
    // 等下面背景把其餘資料全部載完，才會一次重畫整頁。
    const todayStr = fmtDate(new Date());
    const todayBookings = await apiGetSafe("getBookings", { date: todayStr });
    state.bookings = todayBookings || [];
    setConnStatus("ok");
    renderDashboard();

    loadRestInBackground();
  } catch (err) {
    console.error(err);
    setConnStatus("err", err.message);
  }
}

async function loadRestInBackground() {
  try {
    const settings = await apiGetSafe("getSettings");
    const services = await apiGetSafe("getServices");
    const customers = await apiGetSafe("getCustomers");
    const bookings = await apiGetSafe("getBookings"); // 這次才抓全部預約（不只今天）
    const revenue = await apiGetSafe("getRevenueSummary", { months: 6 });
    const reports = await apiGetSafe("getReports");
    state.settings = settings || {};
    state.services = services || [];
    state.customers = customers || [];
    state.bookings = bookings || [];
    state.revenue = revenue;
    state.reports = reports || [];
    saveCachedJSON(CACHE_KEY_SETTINGS, state.settings);
    saveCachedJSON(CACHE_KEY_SERVICES, state.services);
    renderAll();
    applyPinLock(); // 背景資料到齊後再確認一次，避免其他裝置剛好改了 PIN 設定沒同步到
  } catch (err) {
    console.error(err);
    showToast("部分資料背景載入失敗，可重新整理再試一次", true);
  }
}

async function reloadBookingsAndCustomers() {
  const bookings = await apiGetSafe("getBookings");
  const customers = await apiGetSafe("getCustomers");
  const revenue = await apiGetSafe("getRevenueSummary", { months: 6 });
  state.bookings = bookings || [];
  state.customers = customers || [];
  state.revenue = revenue;
  renderAll();
}

function setConnStatus(mode, message) {
  const el = document.getElementById("conn-status");
  el.className = "conn-status";
  if (mode === "loading") { el.textContent = "● 連線中…"; }
  else if (mode === "ok") { el.classList.add("ok"); el.textContent = "● 已連線 Google 試算表"; }
  else { el.classList.add("err"); el.textContent = "● 連線失敗：" + (message || ""); }
}

function renderAll() {
  document.getElementById("brand-name").textContent = state.settings.ShopName || "指尖工作室";
  renderDashboard();
  renderCalendar();
  renderCustomers();
  renderBookingList();
  renderRevenue();
}

/* ============================================================
   Nav / 主題切換
   ============================================================ */
const tabBtns = document.querySelectorAll(".tab-btn");
const views = document.querySelectorAll(".view");
function showView(id) {
  views.forEach((v) => v.classList.toggle("active", v.id === "view-" + id));
  tabBtns.forEach((b) => b.classList.toggle("active", b.dataset.view === id));
  if (id === "systemsettings") renderSystemSettings();
}
tabBtns.forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));
document.querySelectorAll("[data-goto]").forEach((b) => b.addEventListener("click", () => showView(b.dataset.goto)));
// 今日總覽、預約清單頁上的「＋新增預約」以前是先跳去預約日曆頁面，還要再點一次日曆頁自己的
// 「＋新增預約」才會真的跳出新增視窗，等於要點兩次。改成直接開視窗，不用先跳頁。
document.querySelectorAll("[data-open-booking]").forEach((b) => b.addEventListener("click", () => openBookingModal({ date: fmtDate(state.selectedDate) })));

document.querySelectorAll("[data-theme-choice]").forEach((b) => {
  b.addEventListener("click", () => {
    const choice = b.dataset.themeChoice;
    if (choice === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", choice);
    document.querySelectorAll("[data-theme-choice]").forEach((x) => x.classList.toggle("on", x === b));
  });
});

/* ============================================================
   品牌色系選擇（色塊現在畫在「後端設定」視窗裡，每次開視窗都要重新綁定一次）
   ============================================================ */
function wireAccentSwatches() {
  const saved = localStorage.getItem("beautyStudioAccent") || "";
  document.querySelectorAll("[data-accent]").forEach((b) => {
    b.classList.toggle("on", (b.dataset.accent || "") === saved);
    b.addEventListener("click", () => {
      const accent = b.dataset.accent;
      if (accent) document.documentElement.setAttribute("data-accent", accent);
      else document.documentElement.removeAttribute("data-accent");
      localStorage.setItem("beautyStudioAccent", accent);
      document.querySelectorAll("[data-accent]").forEach((x) => x.classList.toggle("on", x === b));
    });
  });
}
(function initAccent() {
  const saved = localStorage.getItem("beautyStudioAccent") || "";
  if (saved) document.documentElement.setAttribute("data-accent", saved);
})();

/* ============================================================
   PIN 碼鎖定畫面
   ============================================================ */
const PIN_UNLOCK_KEY = "beautyStudioPinUnlocked";
function applyPinLock() {
  const overlay = document.getElementById("pin-overlay");
  const enabled = isChecked(state.settings.PinEnabled) && state.settings.PinCode;
  if (!enabled) { overlay.classList.remove("show"); return; }
  const unlocked = sessionStorage.getItem(PIN_UNLOCK_KEY) === "1";
  overlay.classList.toggle("show", !unlocked);
  if (!unlocked) setTimeout(() => document.getElementById("pin-input").focus(), 50);
}
function tryPinUnlock() {
  const input = document.getElementById("pin-input");
  if (input.value === String(state.settings.PinCode || "")) {
    sessionStorage.setItem(PIN_UNLOCK_KEY, "1");
    document.getElementById("pin-overlay").classList.remove("show");
    input.value = "";
  } else {
    showToast("PIN 碼錯誤", true);
    input.value = "";
    input.focus();
  }
}
document.getElementById("pin-unlock-btn").addEventListener("click", tryPinUnlock);
document.getElementById("pin-input").addEventListener("keydown", (e) => { if (e.key === "Enter") tryPinUnlock(); });
document.getElementById("pin-forgot-btn").addEventListener("click", () => {
  const hint = state.settings.PinRecovery;
  showToast(hint ? "提示：" + hint : "請洽店家管理者，於 Google 試算表「系統設定」分頁重設 PIN 碼");
});

/* ============================================================
   後端設定：讓使用者自己在網頁上改網址／金鑰，存在瀏覽器本機
   ============================================================ */
const settingsBackdrop = document.getElementById("settings-modal-backdrop");
const settingsModalBody = document.getElementById("settings-modal-body");

function openSettingsModal() {
  settingsModalBody.innerHTML = `
    <button class="modal-close" id="settings-modal-close" aria-label="關閉">✕</button>
    <h3>後端設定</h3>
    <div class="sub">貼上 Google Apps Script 網頁應用程式網址與 API 金鑰，只會存在這台瀏覽器裡</div>
    <div class="field"><label>網頁應用程式網址（/exec 結尾）</label><input id="set-url" value="${escapeHtml(API_BASE_URL)}"></div>
    <div class="field"><label>API 金鑰</label><input id="set-token" value="${escapeHtml(API_TOKEN)}"></div>
    <div class="modal-section-divider"></div>
    <div class="field">
      <label>外觀色系</label>
      <div class="accent-row" id="accent-row">
        <button class="accent-swatch" data-accent="" style="background:#9c3f52;" title="酒紅（預設）"></button>
        <button class="accent-swatch" data-accent="rose" style="background:#c98a8a;" title="珊瑚粉"></button>
        <button class="accent-swatch" data-accent="plum" style="background:#8a6bb0;" title="藕紫"></button>
        <button class="accent-swatch" data-accent="forest" style="background:#5c8a6b;" title="墨綠"></button>
      </div>
    </div>
    <div class="modal-actions">
      <button class="btn ghost" id="set-reset">還原預設值</button>
      <button class="btn" id="set-save">儲存並重新整理</button>
    </div>
  `;
  document.getElementById("settings-modal-close").addEventListener("click", closeSettingsModal);
  wireAccentSwatches(); // 每次開設定視窗都要重新綁定，因為色塊是剛才用 innerHTML 現畫出來的
  document.getElementById("set-reset").addEventListener("click", () => {
    document.getElementById("set-url").value = DEFAULT_API_BASE_URL;
    document.getElementById("set-token").value = DEFAULT_API_TOKEN;
  });
  document.getElementById("set-save").addEventListener("click", () => {
    const url = document.getElementById("set-url").value.trim();
    const token = document.getElementById("set-token").value.trim();
    if (!url || !token) { showToast("網址與金鑰都要填寫", true); return; }
    localStorage.setItem("beautyStudioApiUrl", url);
    localStorage.setItem("beautyStudioApiToken", token);
    location.reload();
  });
  settingsBackdrop.classList.add("show");
}
function closeSettingsModal() { settingsBackdrop.classList.remove("show"); }
settingsBackdrop.addEventListener("click", (e) => { if (e.target === settingsBackdrop) closeSettingsModal(); });
document.getElementById("open-settings-btn").addEventListener("click", openSettingsModal);

/* ============================================================
   Toast
   ============================================================ */
const toastEl = document.getElementById("toast");
let toastTimer = null;
function showToast(msg, isError) {
  toastEl.textContent = msg;
  toastEl.classList.toggle("err", !!isError);
  toastEl.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2400);
}

/* ============================================================
   自訂確認對話框：取代瀏覽器原生 confirm()
   ------------------------------------------------------------
   原生 confirm() 沒辦法套用自己的視覺風格，會讓畫面突然跳出一個完全
   不一樣風格的系統對話框；而且它是真的整個瀏覽器分頁卡住等使用者回應，
   之前「預約操作教學」被它打斷過導覽流程就是這個緣故。
   改成回傳 Promise<boolean> 的自訂對話框，呼叫端一律用
   `if (await showConfirmDialog("..."))` 取代 `if (confirm("..."))` 即可。
   ============================================================ */
const confirmDialogBackdrop = document.getElementById("confirm-dialog-backdrop");
const confirmDialogBody = document.getElementById("confirm-dialog-body");
function showConfirmDialog(message, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    confirmDialogBody.innerHTML = `
      <p style="margin:0 0 20px;font-size:14px;line-height:1.65;color:var(--ink);">${escapeHtml(message)}</p>
      <div class="modal-actions">
        <button class="btn ghost" id="confirm-dialog-cancel">${escapeHtml(opts.cancelText || "取消")}</button>
        <button class="btn" id="confirm-dialog-ok">${escapeHtml(opts.okText || "確定")}</button>
      </div>
    `;
    confirmDialogBackdrop.classList.add("show");
    const okBtn = document.getElementById("confirm-dialog-ok");
    const cancelBtn = document.getElementById("confirm-dialog-cancel");
    okBtn.focus();
    function finish(result) {
      confirmDialogBackdrop.classList.remove("show");
      okBtn.removeEventListener("click", onOk);
      cancelBtn.removeEventListener("click", onCancel);
      confirmDialogBackdrop.removeEventListener("click", onBackdrop);
      document.removeEventListener("keydown", onKeydown);
      resolve(result);
    }
    function onOk() { finish(true); }
    function onCancel() { finish(false); }
    function onBackdrop(e) { if (e.target === confirmDialogBackdrop) finish(false); }
    function onKeydown(e) { if (e.key === "Escape") finish(false); }
    okBtn.addEventListener("click", onOk);
    cancelBtn.addEventListener("click", onCancel);
    confirmDialogBackdrop.addEventListener("click", onBackdrop);
    document.addEventListener("keydown", onKeydown);
  });
}

/* ============================================================
   業務時間 / 時段輔助
   ============================================================ */
function businessHours() {
  const start = parseInt((state.settings.BusinessHoursStart || "09:00").split(":")[0], 10);
  const end = parseInt((state.settings.BusinessHoursEnd || "20:00").split(":")[0], 10);
  return { start: isNaN(start) ? 9 : start, end: isNaN(end) ? 20 : end };
}
function bookingsOnDate(dateStr) {
  return state.bookings
    .filter((b) => b.Date === dateStr && b.Status !== "cancelled")
    .sort((a, b) => a.StartTime.localeCompare(b.StartTime));
}

// 固定公休日（每週幾）／特別公休日（單日或連續區間）判斷，兩個設定都在「系統設定」子頁面維護
function isClosedWeekday(dateStr) {
  const closed = String(state.settings.ClosedWeekdays || "").split(",").filter(Boolean);
  if (!closed.length) return false;
  const d = new Date(dateStr + "T00:00:00");
  return closed.includes(String(d.getDay()));
}
function isSpecialHoliday(dateStr) {
  const raw = String(state.settings.SpecialHolidays || "").trim();
  if (!raw) return false;
  return raw.split(",").map((s) => s.trim()).filter(Boolean).some((entry) => {
    const [start, end] = entry.split("~");
    return end ? (dateStr >= start && dateStr <= end) : dateStr === start;
  });
}
function isClosedDate(dateStr) {
  return isClosedWeekday(dateStr) || isSpecialHoliday(dateStr);
}

// 當天預約的滿載程度：公休日單獨標示（灰）、完全沒約＝空（綠）、還有空檔＝有約（橘）、營業時間內的時段都被佔滿＝滿約（紅）
function dayLoadClass(dateStr) {
  if (isClosedDate(dateStr)) return "day-closed";
  const items = bookingsOnDate(dateStr);
  if (items.length === 0) return "day-free";
  const { start, end } = businessHours();
  const totalSlots = Math.max(end - start, 0);
  const bookedHours = new Set(items.map((b) => parseInt(b.StartTime.split(":")[0], 10)));
  return totalSlots > 0 && bookedHours.size >= totalSlots ? "day-full" : "day-busy";
}

/* ============================================================
   Dashboard：生日提醒／逾期未跟進提醒／客單價／回客率／本月可預約統計
   ============================================================ */
function parseSheetDateTime(s) {
  if (!s) return null;
  const d = new Date(String(s).replace(" ", "T"));
  return isNaN(d.getTime()) ? null : d;
}
const STALE_STATUSES = ["pending", "confirmed", "deposit"];
const STALE_MS = 24 * 60 * 60 * 1000;
function computeStaleBookings() {
  const now = Date.now();
  return state.bookings.filter((b) => {
    if (!STALE_STATUSES.includes(b.Status)) return false;
    const last = parseSheetDateTime(b.UpdatedAt) || parseSheetDateTime(b.CreatedAt);
    if (!last) return false;
    return now - last.getTime() > STALE_MS;
  });
}
function computeUpcomingBirthdays(days) {
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const results = [];
  state.customers.forEach((c) => {
    if (!c.Birthday) return;
    const bd = new Date(c.Birthday + "T00:00:00");
    if (isNaN(bd.getTime())) return;
    let thisYear = new Date(now.getFullYear(), bd.getMonth(), bd.getDate());
    if (thisYear < now) thisYear = new Date(now.getFullYear() + 1, bd.getMonth(), bd.getDate());
    const diffDays = Math.round((thisYear - now) / 86400000);
    if (diffDays >= 0 && diffDays <= days) results.push({ customer: c, date: thisYear, diffDays });
  });
  results.sort((a, b) => a.diffDays - b.diffDays);
  return results;
}
function computeAvgTicketAndRepeatRate() {
  const revenueBookings = state.bookings.filter((b) => REVENUE_STATUSES.includes(normalizeStatus(b.Status)));
  const total = revenueBookings.reduce((s, b) => s + (Number(b.Price) || 0), 0);
  const avgTicket = revenueBookings.length ? Math.round(total / revenueBookings.length) : 0;
  const byCustomer = {};
  revenueBookings.forEach((b) => { byCustomer[b.CustomerID] = (byCustomer[b.CustomerID] || 0) + 1; });
  const repeatCustomerCount = Object.keys(byCustomer).filter((k) => byCustomer[k] >= 2).length;
  const repeatRate = state.customers.length ? Math.round((repeatCustomerCount / state.customers.length) * 100) : 0;
  return { avgTicket, repeatRate };
}
function computeMonthAvailability(year, month) {
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const { start, end } = businessHours();
  const totalSlotsPerDay = Math.max(end - start, 0);
  let totalSlots = 0, bookedSlots = 0, fullDays = 0, closedDays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (isClosedDate(dateStr)) { closedDays++; continue; } // 公休日不算進可預約時段，統計才會準
    const bookedHours = new Set(bookingsOnDate(dateStr).map((b) => parseInt(b.StartTime.split(":")[0], 10)));
    totalSlots += totalSlotsPerDay;
    bookedSlots += bookedHours.size;
    if (totalSlotsPerDay > 0 && bookedHours.size >= totalSlotsPerDay) fullDays++;
  }
  const openDays = daysInMonth - closedDays;
  const remaining = totalSlots - bookedSlots;
  const usageRate = totalSlots ? Math.round((bookedSlots / totalSlots) * 1000) / 10 : 0;
  return { daysInMonth, closedDays, freeDays: openDays - fullDays, fullDays, totalSlots, bookedSlots, remaining, usageRate };
}
function statCardHtml(label, value) {
  return `<div class="stat"><div class="label">${label}</div><div class="value num">${value}</div><div class="delta"></div></div>`;
}
function renderDashboardAlerts() {
  const stale = computeStaleBookings();
  const birthdays = computeUpcomingBirthdays(7);
  let html = "";
  if (birthdays.length) {
    html += `<div class="reminder-banner">🎂 <b>本週壽星</b>（共 ${birthdays.length} 位）：` +
      birthdays.map((r) => `${escapeHtml(r.customer.Name)}（${r.diffDays === 0 ? "今天" : r.diffDays + "天後"}）`).join("、") +
      `</div>`;
  }
  if (stale.length) {
    html += `<div class="reminder-banner warn">⚠️ 有 <b>${stale.length}</b> 筆待處理預約超過 1 天未更新，建議主動跟進客人</div>`;
  }
  document.getElementById("dashboard-alerts").innerHTML = html;
}
function renderMonthAvailability() {
  const today = new Date();
  const todayStr = fmtDate(today);
  const monthPrefix = todayStr.slice(0, 7);
  const info = computeMonthAvailability(today.getFullYear(), today.getMonth());
  document.getElementById("month-avail-label").textContent = `${today.getFullYear()}年${today.getMonth() + 1}月`;

  // 今日／本月營收：只算「有效」狀態（不含取消）的預約，儲值營收另外抓 StoredValueAmount（本次儲值金額，不是消費金額）
  const isRevenue = (b) => REVENUE_STATUSES.includes(normalizeStatus(b.Status));
  const todayStoredValueRevenue = bookingsOnDate(todayStr).filter(isRevenue).reduce((s, b) => s + (Number(b.StoredValueAmount) || 0), 0);
  const monthBookings = state.bookings.filter((b) => String(b.Date || "").slice(0, 7) === monthPrefix && isRevenue(b));
  const monthTotalRevenue = monthBookings.reduce((s, b) => s + (Number(b.Price) || 0), 0);
  const monthStoredValueRevenue = monthBookings.reduce((s, b) => s + (Number(b.StoredValueAmount) || 0), 0);

  document.getElementById("month-avail-grid").innerHTML =
    statCardHtml("本月天數／空檔天數", `${info.daysInMonth} / ${info.freeDays}`) +
    statCardHtml("可預約時段／已預約時段", `${info.totalSlots} / ${info.bookedSlots}`) +
    statCardHtml("預約使用率", info.usageRate + "%") +
    statCardHtml("今日儲值營收", money(todayStoredValueRevenue)) +
    statCardHtml("本月總營收", money(monthTotalRevenue)) +
    statCardHtml("本月儲值營收", money(monthStoredValueRevenue));
}

function renderDashboard() {
  const today = new Date();
  const todayStr = fmtDate(today);
  const yesterdayStr = fmtDate(new Date(today.getTime() - 86400000));
  document.getElementById("today-date-label").textContent = fmtDateLabel(today);

  const todays = bookingsOnDate(todayStr);
  const revenueToday = todays.filter((b) => REVENUE_STATUSES.includes(normalizeStatus(b.Status))).reduce((s, b) => s + (Number(b.Price) || 0), 0);
  const revenueYesterday = bookingsOnDate(yesterdayStr)
    .filter((b) => REVENUE_STATUSES.includes(normalizeStatus(b.Status)))
    .reduce((s, b) => s + (Number(b.Price) || 0), 0);

  document.getElementById("stat-today-revenue").textContent = money(revenueToday);
  const deltaEl = document.getElementById("stat-today-revenue-delta");
  if (revenueYesterday > 0) {
    const pct = Math.round(((revenueToday - revenueYesterday) / revenueYesterday) * 100);
    deltaEl.textContent = (pct >= 0 ? "▲ " : "▼ ") + "較昨日 " + (pct >= 0 ? "+" : "") + pct + "%";
    deltaEl.classList.toggle("up", pct >= 0);
  } else {
    deltaEl.textContent = "昨日尚無進帳紀錄";
  }

  document.getElementById("stat-today-count").textContent = todays.length + " 位";
  const confirmed = todays.filter((b) => b.Status === "confirmed").length;
  const pending = todays.filter((b) => b.Status === "pending").length;
  document.getElementById("stat-today-count-detail").textContent = `已確認 ${confirmed}・待確認 ${pending}`;

  const thisMonth = fmtDate(today).slice(0, 7);
  const newThisMonth = state.customers.filter((c) => String(c.CreatedAt || "").slice(0, 7) === thisMonth).length;
  document.getElementById("stat-month-new").textContent = newThisMonth + " 位";

  const { avgTicket, repeatRate } = computeAvgTicketAndRepeatRate();
  document.getElementById("stat-avg-ticket").textContent = money(avgTicket);
  document.getElementById("stat-repeat-rate").textContent = repeatRate + " %";

  renderDashboardAlerts();
  renderMonthAvailability();

  // 今日時段清單
  const listEl = document.getElementById("today-list");
  if (todays.length === 0) {
    listEl.innerHTML = `<p class="empty-hint">今天還沒有預約，點右上角「＋ 新增預約」開始安排吧。</p>`;
  } else {
    listEl.innerHTML = todays.map((a) => `
      <div class="appt-row">
        <div class="appt-time">${escapeHtml(a.StartTime)}</div>
        <div class="appt-who"><strong>${escapeHtml(a.CustomerName)}</strong><span>${escapeHtml(a.Service)}</span></div>
        <div class="appt-price num">${money(a.Price)}</div>
        <div class="status-pill ${normalizeStatus(a.Status)}">${statusLabel[normalizeStatus(a.Status)]}</div>
      </div>
    `).join("");
  }

  // 明日預約提醒：手動點「傳送提醒」帶去 LINE 範本頁面，訊息預先填好，複製後自己貼到 LINE 傳給客人
  const tomorrowStr = fmtDate(new Date(today.getTime() + 86400000));
  const tomorrows = bookingsOnDate(tomorrowStr);
  const tomorrowListEl = document.getElementById("tomorrow-list");
  if (tomorrows.length === 0) {
    tomorrowListEl.innerHTML = `<p class="empty-hint">明天還沒有預約</p>`;
  } else {
    tomorrowListEl.innerHTML = tomorrows.map((a) => `
      <div class="appt-row">
        <div class="appt-time">${escapeHtml(a.StartTime)}</div>
        <div class="appt-who"><strong>${escapeHtml(a.CustomerName)}</strong><span>${escapeHtml(a.Service)}</span></div>
        <div class="appt-price num">${money(a.Price)}</div>
        <button class="btn ghost line-remind-btn" data-booking-id="${escapeHtml(a.BookingID)}">📩 傳送提醒</button>
      </div>
    `).join("");
    tomorrowListEl.querySelectorAll(".line-remind-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const b = state.bookings.find((x) => x.BookingID === btn.dataset.bookingId);
        if (b) openLineTemplateFor(b, "reminder");
      });
    });
  }

  // 近 7 日進帳
  const days = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86400000);
    const dStr = fmtDate(d);
    const total = bookingsOnDate(dStr).filter((b) => REVENUE_STATUSES.includes(normalizeStatus(b.Status))).reduce((s, b) => s + (Number(b.Price) || 0), 0);
    days.push({ label: `${d.getMonth() + 1}/${d.getDate()}`, value: total, today: i === 0 });
  }
  const maxVal = Math.max(...days.map((d) => d.value), 1);
  document.getElementById("mini-bars").innerHTML = days.map((d) => `
    <div class="bar ${d.today ? "today" : ""}" style="height:${Math.max(Math.round((d.value / maxVal) * 100), 2)}%;">
      <span>${d.label}</span>
    </div>
  `).join("");
}

/* ============================================================
   Calendar
   ============================================================ */
document.getElementById("cal-prev").addEventListener("click", () => shiftDate(-1));
document.getElementById("cal-next").addEventListener("click", () => shiftDate(1));
document.getElementById("cal-today").addEventListener("click", () => { state.selectedDate = new Date(); renderCalendar(); });
document.querySelectorAll("[data-cal-view]").forEach((btn) => {
  btn.addEventListener("click", () => {
    state.calView = btn.dataset.calView;
    document.querySelectorAll("[data-cal-view]").forEach((b) => b.classList.toggle("active", b === btn));
    renderCalendar();
  });
});

function shiftDate(delta) {
  const unit = state.calView === "week" ? delta * 7 : delta;
  if (state.calView === "month") {
    state.selectedDate = new Date(state.selectedDate.getFullYear(), state.selectedDate.getMonth() + delta, 1);
  } else {
    state.selectedDate = new Date(state.selectedDate.getTime() + unit * 86400000);
  }
  renderCalendar();
}

function goToDay(dateStr) {
  state.selectedDate = new Date(dateStr + "T00:00:00");
  state.calView = "day";
  document.querySelectorAll("[data-cal-view]").forEach((b) => b.classList.toggle("active", b.dataset.calView === "day"));
  renderCalendar();
}

function isMobileLayout() {
  return window.matchMedia("(max-width: 639px)").matches;
}

function renderCalendar() {
  if (isMobileLayout()) {
    renderAgendaView();
    return;
  }
  const d = state.selectedDate;
  if (state.calView === "week") {
    const weekStart = new Date(d.getTime() - d.getDay() * 86400000);
    const weekEnd = new Date(weekStart.getTime() + 6 * 86400000);
    document.getElementById("cal-date-label").textContent =
      `${weekStart.getMonth() + 1}/${weekStart.getDate()} – ${weekEnd.getMonth() + 1}/${weekEnd.getDate()}`;
    renderWeekView(weekStart);
  } else if (state.calView === "month") {
    document.getElementById("cal-date-label").textContent = `${d.getFullYear()}年${d.getMonth() + 1}月`;
    renderMonthView(d);
  } else {
    document.getElementById("cal-date-label").textContent = fmtDateLabel(d);
    renderDayView(d);
  }
}

// 螢幕寬度跨越手機／平板門檻時（例如轉橫向），重新渲染切換版面
let lastIsMobileLayout = isMobileLayout();
window.addEventListener("resize", debounce(() => {
  const now = isMobileLayout();
  if (now !== lastIsMobileLayout) {
    lastIsMobileLayout = now;
    if (document.getElementById("view-calendar").classList.contains("active")) renderCalendar();
  }
}, 200));

function debounce(fn, wait) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/* ---- 手機議程模式：週列／可展開月曆／下方議程清單 ---- */
function renderAgendaView() {
  const selectedStr = fmtDate(state.selectedDate);
  const todayStr = fmtDate(new Date());

  document.getElementById("agenda-month-label").textContent = `${state.selectedDate.getFullYear()}年${state.selectedDate.getMonth() + 1}月`;

  // 週列：以選取日期所在那週的週日到週六
  const weekStart = new Date(state.selectedDate.getTime() - state.selectedDate.getDay() * 86400000);
  const stripEl = document.getElementById("agenda-week-strip");
  stripEl.innerHTML = Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(weekStart.getTime() + i * 86400000);
    const dateStr = fmtDate(dt);
    const loadClass = dayLoadClass(dateStr);
    return `
      <button class="agenda-day-cell ${loadClass} ${dateStr === todayStr ? "today" : ""} ${dateStr === selectedStr ? "selected" : ""}" data-date="${dateStr}">
        <span class="dow">${weekday[dt.getDay()]}</span>
        <span class="num">${dt.getDate()}</span>
      </button>
    `;
  }).join("");
  stripEl.querySelectorAll(".agenda-day-cell").forEach((cell) => {
    cell.addEventListener("click", () => selectAgendaDate(cell.dataset.date));
  });

  const monthGridEl = document.getElementById("agenda-month-grid");
  if (state.agendaExpanded) {
    monthGridEl.innerHTML = buildMonthGridHtml(state.selectedDate, selectedStr);
    monthGridEl.hidden = false;
    stripEl.hidden = true;
    monthGridEl.querySelectorAll(".month-cell").forEach((cell) => {
      cell.addEventListener("click", () => selectAgendaDate(cell.dataset.date, true));
    });
  } else {
    monthGridEl.hidden = true;
    stripEl.hidden = false;
  }

  renderAgendaList(selectedStr);
}

function selectAgendaDate(dateStr, collapseAfter) {
  state.selectedDate = new Date(dateStr + "T00:00:00");
  if (collapseAfter) state.agendaExpanded = false; // 從展開的月曆選日期後，自動收合回週列，不用再另外點拉桿
  renderAgendaView();
  const target = document.querySelector(`.agenda-date-group[data-date="${dateStr}"]`);
  if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
}

function renderAgendaList(anchorDateStr) {
  const anchor = new Date(anchorDateStr + "T00:00:00");
  const todayStr = fmtDate(new Date());
  const WINDOW_BEFORE = 3, WINDOW_AFTER = 30;

  let html = "";
  const flatBookings = []; // 跟畫面上 .agenda-event-row 的順序一一對應，點擊時直接用這筆資料，不要再用 BookingID 重查
  for (let i = -WINDOW_BEFORE; i <= WINDOW_AFTER; i++) {
    const dt = new Date(anchor.getTime() + i * 86400000);
    const dateStr = fmtDate(dt);
    const items = bookingsOnDate(dateStr);
    html += `
      <div class="agenda-date-group" data-date="${dateStr}">
        <div class="agenda-date-header">
          ${dt.getMonth() + 1}月${dt.getDate()}日 星期${weekday[dt.getDay()]}
          ${dateStr === todayStr ? `<span class="today-chip">今天</span>` : ""}
        </div>
        ${items.map((b) => {
      const eff = normalizeStatus(b.Status);
      const cust = state.customers.find((c) => c.CustomerID === b.CustomerID);
      const idx = flatBookings.push(b) - 1;
      return `
          <div class="agenda-event-row ${eff}" data-idx="${idx}" data-booking-id="${escapeHtml(b.BookingID)}">
            <div class="agenda-event-time">${escapeHtml(b.StartTime)}${b.EndTime ? `<span>${escapeHtml(b.EndTime)}</span>` : ""}</div>
            <div class="agenda-event-bar"></div>
            <div class="agenda-event-main">
              <strong>${escapeHtml(b.CustomerName)}${cust ? ` <span class="tag ${cust.Tag}" style="font-size:10px;padding:1px 7px;">${tagLabel[cust.Tag] || cust.Tag}</span>` : ""}</strong>
              <span>${escapeHtml(b.Service)}${b.Price ? "・" + money(b.Price) : ""}</span>
            </div>
            <div class="status-pill ${eff}">${statusLabel[eff]}</div>
          </div>
        `;
    }).join("")}
      </div>
    `;
  }

  const listEl = document.getElementById("agenda-list");
  listEl.innerHTML = html;
  // 手機版：點整列直接跳出詳情彈窗，裡面可以編輯／收款／確認／取消，不用在列表上塞一堆小圖示
  listEl.querySelectorAll(".agenda-event-row[data-idx]").forEach((row) => {
    // 直接用這一列渲染時用的那筆資料開彈窗，不要再用 BookingID 重新查一次——
    // 如果試算表裡不小心出現重複的 BookingID，重新查會查到錯的那筆，點哪筆就該顯示哪筆才對
    row.addEventListener("click", () => openBookingDetailModal(flatBookings[Number(row.dataset.idx)]));
  });
}

// 手機議程清單用：點筆的圖示才跳出「確認／完成／取消」選單，避免小螢幕上三個小按鈕擠在一起容易誤觸
// booking 可以直接傳「那一筆的物件」（畫面上點的就是它，不用再查一次，避免萬一 BookingID 重複時查到別筆）
function openAgendaActionMenu(bookingId, anchorBtn, booking) {
  closeAgendaActionMenu();
  const b = booking || state.bookings.find((x) => x.BookingID === bookingId);
  if (!b) return;

  const menu = document.createElement("div");
  menu.className = "agenda-action-menu";
  const eff = normalizeStatus(b.Status);
  const canCollect = REVENUE_STATUSES.includes(eff) && !isChecked(b.FullyPaid);
  menu.innerHTML = `
    ${eff === "pending" ? `<button data-action="confirm">✓ 確認預約</button>` : ""}
    ${canCollect ? `<button data-action="collect">💰 一鍵收款</button>` : ""}
    ${b.Status !== "cancelled" ? `<button data-action="cancel">✕ 取消預約</button>` : ""}
  `;
  if (!menu.innerHTML.trim()) { menu.remove(); showToast("這筆預約已取消"); return; }
  document.body.appendChild(menu);

  const rect = anchorBtn.getBoundingClientRect();
  menu.style.top = Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8) + "px";
  menu.style.right = Math.max(window.innerWidth - rect.right, 8) + "px";

  function positionMenu() {
    menu.style.top = Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8) + "px";
  }
  function wireButtons() {
    menu.querySelectorAll("[data-action]").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if (action === "cancel") {
          menu.innerHTML = CANCEL_REASONS.map((r) => `<button data-reason="${escapeHtml(r)}">${escapeHtml(r)}</button>`).join("");
          positionMenu();
          menu.querySelectorAll("[data-reason]").forEach((rbtn) => {
            rbtn.addEventListener("click", (ev) => {
              ev.stopPropagation();
              closeAgendaActionMenu();
              changeBookingStatus(bookingId, "cancelled", rbtn.dataset.reason);
            });
          });
          return;
        }
        if (action === "collect") {
          closeAgendaActionMenu();
          collectPayment(bookingId);
          return;
        }
        closeAgendaActionMenu();
        changeBookingStatus(bookingId, "confirmed");
      });
    });
  }
  wireButtons();
  tour2MaybeSpotlightModalAction(bookingId);

  setTimeout(() => document.addEventListener("click", closeAgendaActionMenuOnce), 0);
}
function closeAgendaActionMenu() {
  document.querySelectorAll(".agenda-action-menu").forEach((m) => m.remove());
}
function closeAgendaActionMenuOnce() {
  closeAgendaActionMenu();
  document.removeEventListener("click", closeAgendaActionMenuOnce);
}

// 拖曳（或點擊）灰色拉桿：往下拉展開月曆，往上收合回週列
(function setupAgendaDragHandle() {
  const handle = document.getElementById("agenda-drag-handle");
  let startY = null;

  handle.addEventListener("pointerdown", (e) => {
    startY = e.clientY;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointerup", (e) => {
    if (startY === null) return;
    const deltaY = e.clientY - startY;
    startY = null;
    if (deltaY > 24) state.agendaExpanded = true;
    else if (deltaY < -24) state.agendaExpanded = false;
    else state.agendaExpanded = !state.agendaExpanded; // 移動距離很小就當作點擊，切換展開狀態
    renderAgendaView();
  });
})();

// 未展開時，在週列上下滑動可以直接切換上一週／下一週；滑動距離很小就當成一般點擊日期，不影響原本功能
(function setupWeekStripSwipe() {
  const strip = document.getElementById("agenda-week-strip");
  let startX = null;

  strip.addEventListener("pointerdown", (e) => {
    startX = e.clientX;
    strip.setPointerCapture(e.pointerId);
  });
  strip.addEventListener("pointerup", (e) => {
    if (startX === null) return;
    const deltaX = e.clientX - startX;
    startX = null;
    if (Math.abs(deltaX) < 24) return; // 距離太小，交給日期按鈕自己的點擊事件處理
    const days = deltaX < 0 ? 7 : -7; // 往左滑看下一週，往右滑看上一週
    state.selectedDate = new Date(state.selectedDate.getTime() + days * 86400000);
    renderAgendaView();
  });
})();

document.getElementById("agenda-today").addEventListener("click", () => {
  state.selectedDate = new Date();
  renderAgendaView();
});
// 週列狀態下，‹ › 切換上一週／下一週；展開月曆狀態下，‹ › 切換上一個月／下一個月
function shiftAgendaMonth(delta) {
  const d = state.selectedDate;
  state.selectedDate = state.agendaExpanded
    ? new Date(d.getFullYear(), d.getMonth() + delta, 1)
    : new Date(d.getTime() + delta * 7 * 86400000);
  renderAgendaView();
}
document.getElementById("agenda-prev-month").addEventListener("click", () => shiftAgendaMonth(-1));
document.getElementById("agenda-next-month").addEventListener("click", () => shiftAgendaMonth(1));
document.getElementById("fab-add-btn").addEventListener("click", () => openBookingModal({ date: fmtDate(state.selectedDate) }));

function bookingActionButtons(b) {
  return `
    <button data-action="edit-detail" title="編輯預約內容">✎ 編輯</button>
    <button data-action="edit-menu" title="更改狀態">● 更改狀態</button>
  `;
}

function wireActionButtons(root) {
  root.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      // 優先用這顆按鈕所在事件方塊本來綁定的那筆資料，不要再用 BookingID 重新查一次——
      // 如果試算表裡不小心出現重複的 BookingID，重新查會查到錯的那筆，點哪筆就該操作哪筆才對
      const eventEl = btn.closest(".tg-event, [data-booking-id]");
      const boundBooking = eventEl && eventEl._boundBooking;
      const bookingId = boundBooking ? boundBooking.BookingID : eventEl.dataset.bookingId;
      const action = btn.dataset.action;
      if (action === "edit-menu") { openAgendaActionMenu(bookingId, btn, boundBooking); return; }
      if (action === "edit-detail") {
        const booking = boundBooking || state.bookings.find((b) => b.BookingID === bookingId);
        if (booking) openBookingModal({}, booking);
        return;
      }
      if (action === "collect") { collectPayment(bookingId); return; }
      const status = action === "confirm" ? "confirmed" : "cancelled";
      changeBookingStatus(bookingId, status);
    });
  });
}

/* ---- Teams / Outlook 風格的時間軸：日檢視與週檢視共用同一套排版引擎 ---- */
const ROW_HEIGHT = 56; // 每小時對應的像素高度（跟 styles.css 的 .tg-gutter-spacer/.tg-head-cell 高度需一致）

function timeToMinutes(t) {
  const [h, m] = String(t).split(":").map(Number);
  return h * 60 + (m || 0);
}

// 把預約換算成「距離當天營業開始時間幾分鐘」的區間，並限制在營業時間範圍內
function bookingEventRange(b, startHour, endHour) {
  const totalMin = (endHour - startHour) * 60;
  let s = timeToMinutes(b.StartTime) - startHour * 60;
  let e = (b.EndTime ? timeToMinutes(b.EndTime) : timeToMinutes(b.StartTime) + 45) - startHour * 60;
  s = Math.max(0, Math.min(s, totalMin));
  e = Math.max(s + 18, Math.min(Math.max(e, s + 18), totalMin));
  return { booking: b, start: s, end: e };
}

// 同一天內時間互相重疊的預約，左右並排縮窄顯示（而不是互相蓋住）
function layoutOverlaps(events) {
  const sorted = events.slice().sort((a, b) => a.start - b.start || a.end - b.end);
  const clusters = [];
  let current = [], clusterEnd = -Infinity;
  sorted.forEach((e) => {
    if (current.length && e.start >= clusterEnd) { clusters.push(current); current = []; clusterEnd = -Infinity; }
    current.push(e);
    clusterEnd = Math.max(clusterEnd, e.end);
  });
  if (current.length) clusters.push(current);

  clusters.forEach((cluster) => {
    const laneEnds = [];
    cluster.forEach((e) => {
      let lane = laneEnds.findIndex((end) => end <= e.start);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(e.end); }
      else laneEnds[lane] = e.end;
      e._lane = lane;
    });
    cluster.forEach((e) => { e._laneCount = laneEnds.length; });
  });
  return sorted;
}

function renderEventBlockHtml(item) {
  const b = item.booking;
  const top = (item.start / 60) * ROW_HEIGHT;
  const height = Math.max(((item.end - item.start) / 60) * ROW_HEIGHT - 2, 20);
  const widthPct = 100 / item._laneCount;
  const leftPct = item._lane * widthPct;
  const compact = height < 40;
  return `
    <div class="tg-event ${normalizeStatus(b.Status)} ${compact ? "compact" : ""}" data-booking-id="${escapeHtml(b.BookingID)}"
         style="top:${top}px;height:${height}px;left:${leftPct}%;width:calc(${widthPct}% - 3px);"
         title="${escapeHtml(b.CustomerName)}・${escapeHtml(b.Service)}・${escapeHtml(b.StartTime)}${b.EndTime ? "–" + escapeHtml(b.EndTime) : ""}">
      <div class="tg-event-body">
        <span class="status-pill tg-status-pill ${normalizeStatus(b.Status)}">${statusLabel[normalizeStatus(b.Status)]}</span>
        <strong>${escapeHtml(b.CustomerName)}</strong>
        <span>${escapeHtml(b.StartTime)}${b.EndTime ? "–" + escapeHtml(b.EndTime) : ""}${compact ? "" : "・" + escapeHtml(b.Service)}</span>
      </div>
      <div class="tg-event-actions">${bookingActionButtons(b)}</div>
    </div>
  `;
}

function nowLineHtml(startHour, endHour) {
  const now = new Date();
  const nowMin = now.getHours() * 60 + now.getMinutes() - startHour * 60;
  if (nowMin < 0 || nowMin > (endHour - startHour) * 60) return "";
  const top = (nowMin / 60) * ROW_HEIGHT;
  return `<div class="tg-now-line" style="top:${top}px;"><span class="tg-now-dot"></span></div>`;
}

function renderTimeGrid(days) {
  const { start, end } = businessHours();
  const totalHeight = (end - start) * ROW_HEIGHT;
  const todayStr = fmtDate(new Date());
  const multiDay = days.length > 1;
  const colTemplate = multiDay ? `repeat(${days.length}, minmax(84px, 1fr))` : "1fr";

  let hourLabels = "";
  for (let h = start; h <= end; h++) {
    // 第一格（開始時間）跟最後一格（結束時間）不用置中對齊格線，避免文字被格線切一半、看不清楚
    const edgeCls = h === start ? " first" : h === end ? " last" : "";
    hourLabels += `<div class="tg-hour-label${edgeCls}" style="top:${(h - start) * ROW_HEIGHT}px;">${String(h).padStart(2, "0")}:00</div>`;
  }
  const gutterHtml = `
    <div class="tg-gutter">
      ${multiDay ? `<div class="tg-gutter-spacer"></div>` : ""}
      <div class="tg-hourlabels" style="height:${totalHeight}px;">${hourLabels}</div>
    </div>
  `;

  const headerHtml = multiDay ? `
    <div class="tg-header-row" style="grid-template-columns:${colTemplate};">
      ${days.map((day) => `
        <div class="tg-head-cell ${day.dateStr === todayStr ? "today" : ""}" data-date="${day.dateStr}">
          ${weekday[day.dt.getDay()]}<strong>${day.dt.getDate()}</strong>
        </div>
      `).join("")}
    </div>
  ` : "";

  const allEvents = []; // 跟畫面上 .tg-event 的 DOM 順序一一對應，渲染完之後用來把每個方塊直接綁回它自己的那筆資料
  const colsHtml = days.map((day) => {
    const events = layoutOverlaps(bookingsOnDate(day.dateStr).map((b) => bookingEventRange(b, start, end)));
    events.forEach((item) => allEvents.push(item.booking));
    return `
      <div class="tg-daycol" data-date="${day.dateStr}" style="height:${totalHeight}px;background-size:100% ${ROW_HEIGHT}px;">
        ${events.map(renderEventBlockHtml).join("")}
        ${day.dateStr === todayStr ? nowLineHtml(start, end) : ""}
      </div>
    `;
  }).join("");

  const bodyEl = document.getElementById("calendar-body");
  bodyEl.innerHTML = `
    <div class="tg-wrap">
      ${gutterHtml}
      <div class="tg-scroll">
        ${headerHtml}
        <div class="tg-cols" style="grid-template-columns:${colTemplate};">${colsHtml}</div>
      </div>
    </div>
  `;
  bodyEl.querySelector(".tg-scroll").scrollLeft = 0; // 避免瀏覽器的捲動錨定讓畫面一開始就卡在中間
  bodyEl.querySelectorAll(".tg-event").forEach((el, i) => { el._boundBooking = allEvents[i]; });

  bodyEl.querySelectorAll(".tg-daycol").forEach((col) => {
    col.addEventListener("click", (e) => {
      if (e.target.closest(".tg-event")) return;
      const rect = col.getBoundingClientRect();
      let minutesFromStart = ((e.clientY - rect.top) / ROW_HEIGHT) * 60;
      minutesFromStart = Math.max(0, Math.round(minutesFromStart / 30) * 30); // 靠齊 30 分鐘
      const totalMin = minutesFromStart + start * 60;
      const hh = String(Math.floor(totalMin / 60)).padStart(2, "0");
      const mm = String(totalMin % 60).padStart(2, "0");
      openBookingModal({ date: col.dataset.date, startTime: `${hh}:${mm}` });
    });
  });
  wireActionButtons(bodyEl);
  if (multiDay) {
    bodyEl.querySelectorAll(".tg-event").forEach((el) => {
      el.addEventListener("click", (e) => {
        if (e.target.closest(".tg-event-actions")) return;
        e.stopPropagation();
        goToDay(el.closest(".tg-daycol").dataset.date);
      });
    });
  }
}

function renderDayView(d) {
  renderTimeGrid([{ dateStr: fmtDate(d), dt: d }]);
}

function renderWeekView(weekStart) {
  const days = Array.from({ length: 7 }, (_, i) => {
    const dt = new Date(weekStart.getTime() + i * 86400000);
    return { dt, dateStr: fmtDate(dt) };
  });
  renderTimeGrid(days);
}

// 日曆選單月／手機議程可展開的迷你月曆，共用同一套格子產生邏輯
function buildMonthGridHtml(anchorDate, selectedDateStr) {
  const year = anchorDate.getFullYear(), month = anchorDate.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const gridStart = new Date(firstOfMonth.getTime() - firstOfMonth.getDay() * 86400000);
  const todayStr = fmtDate(new Date());

  const head = weekday.map((w) => `<div class="month-weekday">${w}</div>`).join("");
  let cells = "";
  for (let i = 0; i < 42; i++) {
    const dt = new Date(gridStart.getTime() + i * 86400000);
    const dateStr = fmtDate(dt);
    const items = bookingsOnDate(dateStr);
    const isOtherMonth = dt.getMonth() !== month;
    const shown = items.slice(0, 3);
    const more = items.length - shown.length;
    const loadClass = dayLoadClass(dateStr);

    cells += `
      <div class="month-cell ${loadClass} ${isOtherMonth ? "other-month" : ""} ${dateStr === todayStr ? "today" : ""} ${dateStr === selectedDateStr ? "selected" : ""}" data-date="${dateStr}">
        <span class="month-daynum">${dt.getDate()}</span>
        ${shown.map((b) => `<span class="month-chip ${normalizeStatus(b.Status)}">${escapeHtml(b.StartTime)} ${escapeHtml(b.CustomerName)}</span>`).join("")}
        ${more > 0 ? `<span class="month-more">+${more} 更多</span>` : ""}
      </div>
    `;
  }
  return head + cells;
}

function renderMonthView(anchorDate) {
  const bodyEl = document.getElementById("calendar-body");
  bodyEl.innerHTML = `<div class="month-grid">${buildMonthGridHtml(anchorDate, fmtDate(anchorDate))}</div>`;

  bodyEl.querySelectorAll(".month-cell").forEach((cell) => {
    cell.addEventListener("click", () => goToDay(cell.dataset.date));
  });
}

// 樂觀更新：畫面先變、API 在背景送出，感覺比較快；如果送出失敗再把畫面改回來並告知失敗原因
async function changeBookingStatus(bookingId, status, cancelReason) {
  const booking = state.bookings.find((b) => b.BookingID === bookingId);
  if (!booking) return;
  const prevStatus = booking.Status;
  const prevCancelReason = booking.CancelReason;
  booking.Status = status;
  if (cancelReason !== undefined) booking.CancelReason = cancelReason;
  renderAll();
  showToast("已更新預約狀態為「" + statusLabel[status] + "」");
  if (window.tourOnStatusChanged) window.tourOnStatusChanged(bookingId, status);
  // 剛把預約改成「已確認」，順便問要不要開 LINE 範本傳確認訊息給客人（沒串 LINE API，只能幫忙把訊息準備好）
  // 「預約操作教學」進行中先不要跳這個詢問，不然會被導去 LINE 範本頁面，跟教學步驟對不起來
  if (!tour2Active && prevStatus !== "confirmed" && status === "confirmed") {
    if (await showConfirmDialog(`要開啟 LINE 範本，傳送「預約確認」訊息給 ${booking.CustomerName} 嗎？`)) {
      openLineTemplateFor(booking, "confirm");
    }
  }
  try {
    await Api.post("updateBookingStatus", { bookingId, status, cancelReason });
    // 取消／恢復可能會影響客戶的儲值金餘額等連動資料，背景重新同步一次，不擋畫面
    reloadBookingsAndCustomers().catch((err) => console.error("背景重新整理失敗", err));
  } catch (err) {
    booking.Status = prevStatus;
    booking.CancelReason = prevCancelReason;
    renderAll();
    showToast("更新失敗，已還原：" + err.message, true);
  }
}

async function collectPayment(bookingId) {
  const booking = state.bookings.find((b) => b.BookingID === bookingId);
  if (!booking) return;
  const prevFullyPaid = booking.FullyPaid;
  booking.FullyPaid = true;
  renderAll();
  showToast("已標記收款完成");
  if (window.tourOnPaymentCollected) window.tourOnPaymentCollected(bookingId);
  try {
    await Api.post("collectPayment", { bookingId });
    // 收款會連動更新客戶到店次數／累計消費／儲值金，背景重新同步一次，不擋畫面
    reloadBookingsAndCustomers().catch((err) => console.error("背景重新整理失敗", err));
  } catch (err) {
    booking.FullyPaid = prevFullyPaid;
    renderAll();
    showToast("收款標記失敗，已還原：" + err.message, true);
  }
}

document.getElementById("add-appt-btn").addEventListener("click", () => openBookingModal({ date: fmtDate(state.selectedDate) }));

/* ============================================================
   新增預約 Modal
   ============================================================ */
const bookingBackdrop = document.getElementById("booking-modal-backdrop");
const bookingModalBody = document.getElementById("booking-modal-body");

function openBookingModal(defaults, editingBooking) {
  const isEdit = !!editingBooking;
  // 服務項目可複選：把編輯中預約的服務名稱（用「、」分隔）拆開，比對得到哪些是目前還存在的服務
  const editingServiceNames = isEdit ? String(editingBooking.Service || "").split("、").map((s) => s.trim()).filter(Boolean) : [];
  const matchedNames = new Set();
  const serviceChips = state.services.map((s) => {
    const on = editingServiceNames.includes(s.Name);
    if (on) matchedNames.add(s.Name);
    const durationLabel = Number(s.DurationMin) > 0 ? `・${Number(s.DurationMin)}分` : "・未設定時長"; // 時長沒填的話會導致結束時間算不出來，直接標出來提醒
    return `<button type="button" class="filter-chip service-chip ${on ? "on" : ""}" data-id="${escapeHtml(s.ServiceID)}" data-name="${escapeHtml(s.Name)}" data-price="${s.Price}" data-duration="${s.DurationMin}">${escapeHtml(s.Name)}（${money(s.Price)}${durationLabel}）</button>`;
  }).join("");
  // 編輯時如果原本填的服務名稱已經被刪掉或改名，保留在下面提示文字裡，避免資料憑空消失
  const unmatchedNames = editingServiceNames.filter((n) => !matchedNames.has(n));

  bookingModalBody.dataset.editingId = isEdit ? editingBooking.BookingID : "";
  bookingModalBody.dataset.selectedCustomerId = isEdit ? (editingBooking.CustomerID || "") : "";
  bookingModalBody.innerHTML = `
    <button class="modal-close" id="booking-modal-close" aria-label="關閉">✕</button>
    <h3>${isEdit ? "編輯預約" : "新增預約"}</h3>
    <div class="sub">${isEdit ? "修改後會即時更新 Google 試算表裡的這筆預約" : "填寫客戶與服務資訊，送出後會即時寫入 Google 試算表"}</div>
    <div class="cust-mode-row">
      <button type="button" class="cust-mode-btn on" data-mode="existing">選擇既有客戶</button>
      <button type="button" class="cust-mode-btn" data-mode="new">新增客戶</button>
    </div>
    <div id="bk-cust-search-wrap" class="cust-search-wrap">
      <input id="bk-cust-search" placeholder="輸入姓名或電話搜尋既有客戶…">
      <div id="bk-cust-results" class="cust-search-results" hidden></div>
    </div>
    <div class="field"><label>客戶姓名</label><input id="bk-name" placeholder="例如：陳怡君" value="${escapeHtml(isEdit ? editingBooking.CustomerName : "")}"></div>
    <div class="field"><label>電話</label><input id="bk-phone" placeholder="例如：0912345678" value="${escapeHtml(isEdit ? editingBooking.Phone : "")}"></div>
    <div class="field-row">
      <div class="field"><label>LINE / IG（選填）</label><input id="bk-cust-contact" placeholder="選填"></div>
      <div class="field"><label>客戶生日（選填）</label><input type="date" id="bk-cust-birthday"></div>
    </div>
    <div class="field"><label>日期</label><input type="date" id="bk-date" ${isEdit ? "" : `min="${fmtDate(new Date())}"`} value="${(isEdit ? editingBooking.Date : defaults.date) || fmtDate(new Date())}"></div>
    <div class="field-row">
      <div class="field"><label>開始時間</label><input type="time" id="bk-time" value="${(isEdit ? editingBooking.StartTime : defaults.startTime) || "10:00"}"></div>
      <div class="field"><label>結束時間</label><input type="time" id="bk-end-time" value="${(isEdit ? editingBooking.EndTime : defaults.endTime) || ""}"></div>
    </div>
    <div class="hint" id="bk-end-time-hint" hidden>已選的服務項目沒有設定時長，無法自動算結束時間，請手動填寫，或到「服務項目」試算表補上時長（分鐘）</div>
    <div class="field-warning" id="bk-overlap-warning" hidden></div>
    <div class="field">
      <label>服務項目（可複選）</label>
      <div class="service-dropdown">
        <button type="button" class="service-dropdown-trigger" id="bk-service-trigger" aria-haspopup="true" aria-expanded="false">
          <span id="bk-service-trigger-label">請選擇服務項目</span>
          <svg class="service-dropdown-chevron" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>
        </button>
        <div class="service-dropdown-panel" id="bk-service-panel" hidden>
          <input type="text" id="bk-service-search" class="service-search-input" placeholder="搜尋服務項目…">
          <div class="service-picker" id="bk-service-picker">${serviceChips || '<span class="empty-hint">（尚未設定服務項目）</span>'}</div>
        </div>
      </div>
      ${unmatchedNames.length ? `<div class="hint" id="bk-unmatched-service-hint">原本還有：${unmatchedNames.map(escapeHtml).join("、")}（服務項目已被刪除或改名，繼續使用不勾選任何項目即可保留）</div>` : ""}
    </div>
    <div class="field-row">
      <div class="field">
        <label>付款方式</label>
        <select id="bk-payment-method">
          ${PAYMENT_METHODS.map((m) => `<option value="${m}" ${isEdit && editingBooking.PaymentMethod === m ? "selected" : ""}>${m}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>預約狀態</label>
        <select id="bk-status">
          ${["pending", "confirmed", "deposit", "rescheduled", "cancelled", "noshow"].map((s) => {
    const selected = isEdit ? editingBooking.Status === s : s === "confirmed";
    return `<option value="${s}" ${selected ? "selected" : ""}>${statusLabel[s]}</option>`;
  }).join("")}
        </select>
      </div>
    </div>
    <div class="field" id="bk-cancel-reason-wrap" ${isEdit && editingBooking.Status === "cancelled" ? "" : "hidden"}>
      <label>取消原因</label>
      <select id="bk-cancel-reason">
        ${CANCEL_REASONS.map((r) => `<option value="${r}" ${isEdit && editingBooking.CancelReason === r ? "selected" : ""}>${r}</option>`).join("")}
      </select>
    </div>
    <div class="field-checkbox-row">
      <label class="field-checkbox"><input type="checkbox" id="bk-deposit-paid" ${isEdit && isChecked(editingBooking.DepositPaid) ? "checked" : ""}> 已匯款訂金</label>
      <label class="field-checkbox"><input type="checkbox" id="bk-fully-paid" ${isEdit && isChecked(editingBooking.FullyPaid) ? "checked" : ""}> 已收全額款項</label>
    </div>
    <div class="field-row">
      <div class="field"><label>今日金額 (NT$)</label><input type="number" id="bk-today-amount" placeholder="0" value="${isEdit ? Number(editingBooking.TodayAmount) || "" : ""}"></div>
      <div class="field"><label>其他加項金額 (NT$)</label><input type="number" id="bk-extra-amount" placeholder="0" value="${isEdit ? Number(editingBooking.ExtraAmount) || "" : ""}"></div>
    </div>
    <div class="field"><label>金額（＝今日金額 + 其他加項金額，自動加總）</label><input type="number" id="bk-price" readonly></div>
    <div class="field-row">
      <div class="field"><label>本次儲值金額 (NT$)</label><input type="number" id="bk-stored-value" placeholder="0" value="${isEdit ? Number(editingBooking.StoredValueAmount) || "" : ""}"></div>
      <div class="field"><label>使用儲值金 (NT$)</label><input type="number" id="bk-stored-value-used" placeholder="0" value="${isEdit ? Number(editingBooking.StoredValueUsed) || "" : ""}"></div>
    </div>
    <div class="field"><label>備註</label><textarea id="bk-notes" rows="3" placeholder="選填，如取消細節、客人需求等">${escapeHtml(isEdit ? editingBooking.Notes : "")}</textarea></div>
    <div class="modal-actions">
      <button class="btn ghost" id="bk-cancel">取消</button>
      <button class="btn" id="bk-submit">${isEdit ? "儲存變更" : "建立預約"}</button>
    </div>
  `;

  // 選擇既有客戶／新增客戶：切換模式、搜尋既有客戶自動帶入姓名電話
  const custModeBtns = bookingModalBody.querySelectorAll(".cust-mode-btn");
  const custSearchWrap = document.getElementById("bk-cust-search-wrap");
  const custSearchInput = document.getElementById("bk-cust-search");
  const custResultsEl = document.getElementById("bk-cust-results");
  const bkNameInput = document.getElementById("bk-name");
  const bkPhoneInput = document.getElementById("bk-phone");
  const bkContactInput = document.getElementById("bk-cust-contact");
  const bkBirthdayInput = document.getElementById("bk-cust-birthday");
  const custFieldsToLock = [bkNameInput, bkPhoneInput, bkContactInput, bkBirthdayInput];

  // 選「既有客戶」時，姓名/電話/LINE/生日一律鎖住不能手動改，只能透過上面的搜尋框選客戶，
  // 避免不小心改到既有客戶的資料；切到「新增客戶」才能自己填新客戶的資料。
  function lockCustomerFields(locked) {
    custFieldsToLock.forEach((el) => {
      el.readOnly = locked;
      el.classList.toggle("locked-field", locked);
    });
  }

  custModeBtns.forEach((btn) => {
    btn.addEventListener("click", () => {
      custModeBtns.forEach((b) => b.classList.toggle("on", b === btn));
      const mode = btn.dataset.mode;
      custSearchWrap.hidden = mode !== "existing";
      bookingModalBody.dataset.selectedCustomerId = "";
      custResultsEl.hidden = true;
      custSearchInput.value = "";
      if (mode === "new") {
        lockCustomerFields(false);
        bkNameInput.value = "";
        bkPhoneInput.value = "";
        bkContactInput.value = "";
        bkBirthdayInput.value = "";
      } else {
        lockCustomerFields(true);
      }
    });
  });
  lockCustomerFields(true); // 預設是「選擇既有客戶」模式，一開始就鎖住

  // 點一下（或打字篩選）就列出既有客戶，不用先打字才看得到選項，像下拉選單一樣可以直接點選
  function renderCustResults() {
    const q = custSearchInput.value.trim();
    const sorted = state.customers.slice().sort((a, b) => String(a.Name).localeCompare(String(b.Name), "zh-Hant"));
    const matches = (q ? sorted.filter((c) => String(c.Name).includes(q) || String(c.Phone).includes(q)) : sorted).slice(0, 50);
    if (!matches.length) {
      custResultsEl.innerHTML = `<div class="cust-search-item">找不到符合的客戶</div>`;
    } else {
      custResultsEl.innerHTML = matches.map((c) => `
        <div class="cust-search-item" data-id="${escapeHtml(c.CustomerID)}">${escapeHtml(c.Name)}<small>${escapeHtml(c.Phone)}</small></div>
      `).join("");
    }
    custResultsEl.hidden = false;
  }
  custSearchInput.addEventListener("input", renderCustResults);
  custSearchInput.addEventListener("focus", renderCustResults);
  custSearchInput.addEventListener("click", renderCustResults);
  if (!window._custOutsideClickBound) {
    window._custOutsideClickBound = true;
    document.addEventListener("click", (e) => {
      const wrap = document.getElementById("bk-cust-search-wrap");
      const results = document.getElementById("bk-cust-results");
      if (wrap && results && !results.hidden && !wrap.contains(e.target)) results.hidden = true;
    });
  }
  custResultsEl.addEventListener("click", (e) => {
    const item = e.target.closest(".cust-search-item[data-id]");
    if (!item) return;
    const c = state.customers.find((x) => x.CustomerID === item.dataset.id);
    if (!c) return;
    bkNameInput.value = c.Name;
    bkPhoneInput.value = c.Phone;
    document.getElementById("bk-cust-contact").value = c.Contact || "";
    document.getElementById("bk-cust-birthday").value = c.Birthday || "";
    bookingModalBody.dataset.selectedCustomerId = c.CustomerID;
    custSearchInput.value = `${c.Name}（${c.Phone}）`;
    custResultsEl.hidden = true;
  });
  // 手動改動姓名或電話，就視為跟原本選到的既有客戶脫鉤（避免掛錯客戶編號）
  bkNameInput.addEventListener("input", () => { bookingModalBody.dataset.selectedCustomerId = ""; });
  bkPhoneInput.addEventListener("input", () => { bookingModalBody.dataset.selectedCustomerId = ""; });
  if (isEdit && editingBooking.CustomerID) {
    custSearchInput.value = `${editingBooking.CustomerName}（${editingBooking.Phone}）`;
    bookingModalBody.dataset.selectedCustomerId = editingBooking.CustomerID;
    const linkedCustomer = state.customers.find((x) => x.CustomerID === editingBooking.CustomerID);
    if (linkedCustomer) {
      bkContactInput.value = linkedCustomer.Contact || "";
      bkBirthdayInput.value = linkedCustomer.Birthday || "";
    }
    lockCustomerFields(true);
  } else if (isEdit) {
    // 這筆預約沒有連結到任何既有客戶（少見的舊資料），直接切成「新增客戶」模式讓姓名電話可以編輯
    custModeBtns.forEach((b) => b.classList.toggle("on", b.dataset.mode === "new"));
    custSearchWrap.hidden = true;
    lockCustomerFields(false);
  }

  const servicePickerEl = document.getElementById("bk-service-picker");
  const priceInput = document.getElementById("bk-price");
  const todayAmountInput = document.getElementById("bk-today-amount");
  const extraAmountInput = document.getElementById("bk-extra-amount");
  const startInput = document.getElementById("bk-time");
  const endInput = document.getElementById("bk-end-time");
  const dateInput = document.getElementById("bk-date");
  if (isEdit) endInput.dataset.touched = "1"; // 編輯模式下不要用服務時長覆蓋掉原本已經填好的結束時間

  // 金額＝今日金額＋其他加項金額，自動加總，不能手動改「金額」本身
  function recomputePrice() {
    priceInput.value = (Number(todayAmountInput.value) || 0) + (Number(extraAmountInput.value) || 0);
  }
  todayAmountInput.addEventListener("input", recomputePrice);
  extraAmountInput.addEventListener("input", recomputePrice);
  recomputePrice();

  function selectedServiceChips() {
    return Array.from(servicePickerEl.querySelectorAll(".service-chip.on"));
  }
  const serviceTrigger = document.getElementById("bk-service-trigger");
  const serviceTriggerLabel = document.getElementById("bk-service-trigger-label");
  const servicePanel = document.getElementById("bk-service-panel");
  const serviceSearchInput = document.getElementById("bk-service-search");
  function updateServiceTriggerLabel() {
    if (!serviceTriggerLabel) return;
    const chips = selectedServiceChips();
    if (!chips.length) serviceTriggerLabel.textContent = "請選擇服務項目";
    else if (chips.length === 1) serviceTriggerLabel.textContent = chips[0].dataset.name;
    else serviceTriggerLabel.textContent = `已選 ${chips.length} 項：${chips.map((c) => c.dataset.name).join("、")}`;
  }
  if (serviceTrigger) {
    serviceTrigger.addEventListener("click", (e) => {
      e.stopPropagation();
      servicePanel.hidden = !servicePanel.hidden;
      serviceTrigger.setAttribute("aria-expanded", String(!servicePanel.hidden));
      if (!servicePanel.hidden) serviceSearchInput.focus();
    });
  }
  if (serviceSearchInput) {
    serviceSearchInput.addEventListener("input", () => {
      const q = serviceSearchInput.value.trim().toLowerCase();
      servicePickerEl.querySelectorAll(".service-chip").forEach((chip) => {
        const name = (chip.dataset.name || "").toLowerCase();
        chip.hidden = !!q && !name.includes(q);
      });
    });
  }
  if (!window._serviceDropdownOutsideClickBound) {
    window._serviceDropdownOutsideClickBound = true;
    document.addEventListener("click", (e) => {
      const trigger = document.getElementById("bk-service-trigger");
      const panel = document.getElementById("bk-service-panel");
      if (trigger && panel && !panel.hidden && !panel.contains(e.target) && e.target !== trigger) {
        panel.hidden = true;
        trigger.setAttribute("aria-expanded", "false");
      }
    });
  }
  function computeEndTime() {
    const totalDuration = selectedServiceChips().reduce((s, c) => s + (Number(c.dataset.duration) || 0), 0);
    if (!totalDuration || !startInput.value) return "";
    const [h, m] = startInput.value.split(":").map(Number);
    const end = new Date(2000, 0, 1, h, m + totalDuration);
    return String(end.getHours()).padStart(2, "0") + ":" + String(end.getMinutes()).padStart(2, "0");
  }
  function applyServiceDefaults() {
    const chips = selectedServiceChips();
    if (chips.length) {
      todayAmountInput.value = chips.reduce((s, c) => s + (Number(c.dataset.price) || 0), 0);
      recomputePrice();
    }
    if (!endInput.dataset.touched) endInput.value = computeEndTime();
    const endTimeHint = document.getElementById("bk-end-time-hint");
    endTimeHint.hidden = !(chips.length && !endInput.value);
    updateServiceTriggerLabel();
    checkOverlap();
  }
  servicePickerEl.querySelectorAll(".service-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      chip.classList.toggle("on");
      const hint = document.getElementById("bk-unmatched-service-hint");
      if (hint) hint.remove(); // 只要使用者主動勾選過任何項目，就視為重新選擇，不再保留舊的自訂服務文字
      applyServiceDefaults();
    });
  });
  function checkOverlap() {
    const warnEl = document.getElementById("bk-overlap-warning");
    const date = dateInput.value;
    const start = startInput.value;
    const end = endInput.value || start;
    const messages = [];
    if (date && isClosedDate(date)) messages.push("⚠ 這天是公休日（系統設定裡設定的固定公休或特別公休），確定要在這天約嗎？");
    if (date && start) {
      const conflicts = bookingsOnDate(date).filter((b) => {
        if (isEdit && b.BookingID === editingBooking.BookingID) return false; // 不要跟自己比對重疊
        const bStart = b.StartTime, bEnd = b.EndTime || b.StartTime;
        return start < bEnd && end > bStart; // 時間區間有重疊
      });
      if (conflicts.length) {
        messages.push("⚠ 同一時段已有預約：" + conflicts
          .map((b) => `${escapeHtml(b.CustomerName)}（${escapeHtml(b.StartTime)}${b.EndTime ? "–" + escapeHtml(b.EndTime) : ""}）`)
          .join("、"));
      }
    }
    warnEl.hidden = !messages.length;
    warnEl.innerHTML = messages.join("<br>");
  }
  const statusSelect = document.getElementById("bk-status");
  statusSelect.addEventListener("change", (e) => {
    document.getElementById("bk-cancel-reason-wrap").hidden = e.target.value !== "cancelled";
  });
  // 剛勾了「已匯款訂金」、還沒勾「已收全額款項」、狀態又還是「待確認」的話，通常代表這筆該改成「已付訂」了，跳出來問一下
  document.getElementById("bk-deposit-paid").addEventListener("change", async (e) => {
    const fullyPaidChecked = document.getElementById("bk-fully-paid").checked;
    if (e.target.checked && !fullyPaidChecked && statusSelect.value === "pending") {
      if (await showConfirmDialog('已勾選「已匯款訂金」，要順便把預約狀態改成「已付訂」嗎？')) {
        statusSelect.value = "deposit";
        statusSelect.dispatchEvent(new Event("change"));
      }
    }
  });
  startInput.addEventListener("change", () => { if (!endInput.dataset.touched) endInput.value = computeEndTime(); checkOverlap(); });
  endInput.addEventListener("input", () => { endInput.dataset.touched = "1"; checkOverlap(); }); // 使用者手動改過結束時間後，就不再自動覆蓋
  dateInput.addEventListener("change", checkOverlap);
  updateServiceTriggerLabel();
  if (isEdit) checkOverlap(); else applyServiceDefaults();

  document.getElementById("booking-modal-close").addEventListener("click", closeBookingModal);
  document.getElementById("bk-cancel").addEventListener("click", closeBookingModal);
  document.getElementById("bk-submit").addEventListener("click", submitBooking);

  bookingBackdrop.classList.add("show");
  // 「新增預約」按鈕如果正被導覽圈起來提示，視窗一打開就要把那圈反白拿掉，
  // 不然按鈕的反白效果（連著整片變暗背景）會蓋住剛跳出來的視窗，看起來像沒反應
  tour2Cleanup();
}
function closeBookingModal() { bookingBackdrop.classList.remove("show"); }
bookingBackdrop.addEventListener("click", (e) => { if (e.target === bookingBackdrop) closeBookingModal(); });

/* ============================================================
   預約詳情彈窗（手機版：點日曆上的預約項目跳出，可以直接編輯／收款／確認／取消）
   ============================================================ */
const bookingDetailBackdrop = document.getElementById("booking-detail-modal-backdrop");
const bookingDetailBody = document.getElementById("booking-detail-modal-body");

// 參數可以直接傳「那一筆預約物件」（畫面上點的就是它，不用再查一次，避免萬一 BookingID 重複時查到別筆），
// 也可以傳 BookingID 字串（找不到對應物件時的備用查法）
function openBookingDetailModal(bookingOrId) {
  const b = (bookingOrId && typeof bookingOrId === "object")
    ? bookingOrId
    : state.bookings.find((x) => x.BookingID === bookingOrId);
  if (!b) return;
  const bookingId = b.BookingID;
  const eff = normalizeStatus(b.Status);
  const cust = state.customers.find((c) => c.CustomerID === b.CustomerID);
  const canCollect = REVENUE_STATUSES.includes(eff) && !isChecked(b.FullyPaid);

  bookingDetailBody.innerHTML = `
    <button class="modal-close" id="booking-detail-close" aria-label="關閉">✕</button>
    <h3>${escapeHtml(b.CustomerName)}${cust ? ` <span class="tag ${cust.Tag}" style="font-size:11px;padding:2px 8px;">${tagLabel[cust.Tag] || cust.Tag}</span>` : ""}</h3>
    <div class="sub">${escapeHtml(b.Date)}・${escapeHtml(b.StartTime)}${b.EndTime ? "－" + escapeHtml(b.EndTime) : ""}</div>
    <div style="margin-top:10px;">
      <div class="kv"><span class="k">狀態</span><span class="status-pill ${eff}">${statusLabel[eff]}</span></div>
      <div class="kv"><span class="k">服務項目</span><span style="text-align:right;">${escapeHtml(b.Service) || "—"}</span></div>
      <div class="kv"><span class="k">金額</span><span>${money(b.Price)}</span></div>
      <div class="kv"><span class="k">電話</span><span>${escapeHtml(b.Phone) || "—"}</span></div>
      <div class="kv"><span class="k">付款方式</span><span>${escapeHtml(b.PaymentMethod) || "—"}</span></div>
      ${b.Notes ? `<div class="kv"><span class="k">備註</span><span style="text-align:right;">${escapeHtml(b.Notes)}</span></div>` : ""}
    </div>
    <div class="modal-actions" id="booking-detail-actions" style="flex-wrap:wrap;">
      ${eff === "pending" ? `<button class="btn ghost" data-action="confirm">✓ 確認預約</button>` : ""}
      ${canCollect ? `<button class="btn ghost" data-action="collect">💰 一鍵收款</button>` : ""}
      ${b.Status !== "cancelled" ? `<button class="btn ghost" data-action="cancel">✕ 取消預約</button>` : ""}
      ${b.Status !== "cancelled" ? `<button class="btn ghost" data-action="line">📩 LINE提醒</button>` : ""}
      <button class="btn" data-action="edit">✎ 編輯</button>
    </div>
  `;
  document.getElementById("booking-detail-close").addEventListener("click", closeBookingDetailModal);
  wireBookingDetailActions(bookingId);
  bookingDetailBackdrop.classList.add("show");
  tour2MaybeSpotlightModalAction(bookingId);
}
function wireBookingDetailActions(bookingId) {
  const actionsEl = document.getElementById("booking-detail-actions");
  actionsEl.querySelectorAll("[data-action]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const action = btn.dataset.action;
      if (action === "edit") {
        closeBookingDetailModal();
        const booking = state.bookings.find((x) => x.BookingID === bookingId);
        if (booking) openBookingModal({}, booking);
        return;
      }
      if (action === "collect") { closeBookingDetailModal(); collectPayment(bookingId); return; }
      if (action === "confirm") { closeBookingDetailModal(); changeBookingStatus(bookingId, "confirmed"); return; }
      if (action === "line") {
        closeBookingDetailModal();
        const booking = state.bookings.find((x) => x.BookingID === bookingId);
        if (booking) openLineTemplateFor(booking, normalizeStatus(booking.Status) === "pending" ? "confirm" : "reminder");
        return;
      }
      if (action === "cancel") {
        actionsEl.innerHTML = CANCEL_REASONS.map((r) => `<button class="btn ghost" data-reason="${escapeHtml(r)}">${escapeHtml(r)}</button>`).join("");
        actionsEl.querySelectorAll("[data-reason]").forEach((rbtn) => {
          rbtn.addEventListener("click", () => {
            closeBookingDetailModal();
            changeBookingStatus(bookingId, "cancelled", rbtn.dataset.reason);
          });
        });
      }
    });
  });
}
function closeBookingDetailModal() { bookingDetailBackdrop.classList.remove("show"); }
bookingDetailBackdrop.addEventListener("click", (e) => { if (e.target === bookingDetailBackdrop) closeBookingDetailModal(); });

async function submitBooking() {
  const name = document.getElementById("bk-name").value.trim();
  const phone = document.getElementById("bk-phone").value.trim();
  const date = document.getElementById("bk-date").value;
  const startTime = document.getElementById("bk-time").value;
  const endTime = document.getElementById("bk-end-time").value;
  const selectedChips = Array.from(document.querySelectorAll("#bk-service-picker .service-chip.on"));
  const editingId0 = bookingModalBody.dataset.editingId;
  // 有勾選服務項目就用勾選的（多項用「、」串起來）；編輯時如果什麼都沒勾，保留原本的服務文字（可能是舊資料或已刪除的服務）
  const service = selectedChips.length
    ? selectedChips.map((c) => c.dataset.name).join("、")
    : (editingId0 ? (state.bookings.find((b) => b.BookingID === editingId0) || {}).Service || "" : "");
  const price = Number(document.getElementById("bk-price").value) || 0;
  const status = document.getElementById("bk-status").value;
  const cancelReason = status === "cancelled" ? document.getElementById("bk-cancel-reason").value : "";
  const paymentMethod = document.getElementById("bk-payment-method").value;
  const depositPaid = document.getElementById("bk-deposit-paid").checked;
  const fullyPaid = document.getElementById("bk-fully-paid").checked;
  const todayAmount = Number(document.getElementById("bk-today-amount").value) || 0;
  const extraAmount = Number(document.getElementById("bk-extra-amount").value) || 0;
  const storedValueAmount = Number(document.getElementById("bk-stored-value").value) || 0;
  const storedValueUsed = Number(document.getElementById("bk-stored-value-used").value) || 0;
  const notes = document.getElementById("bk-notes").value.trim();
  const customerContactInput = document.getElementById("bk-cust-contact").value.trim();
  const customerBirthdayInput = document.getElementById("bk-cust-birthday").value;
  const customerId = bookingModalBody.dataset.selectedCustomerId || undefined;
  const editingId = bookingModalBody.dataset.editingId;
  const isEdit = !!editingId;

  if (!name || !phone || !date || !startTime) {
    showToast("請填寫客戶姓名、電話、日期與時間", true);
    return;
  }
  if (!service) {
    showToast("請至少選擇一項服務項目", true);
    return;
  }
  if (!isEdit && date < fmtDate(new Date())) {
    showToast("不能預約已經過去的日期", true);
    return;
  }
  if (endTime && endTime <= startTime) {
    showToast("結束時間必須晚於開始時間", true);
    return;
  }

  const prevStatusForEdit = isEdit ? (state.bookings.find((b) => b.BookingID === editingId) || {}).Status : null;
  const submitBtn = document.getElementById("bk-submit");
  submitBtn.disabled = true;
  submitBtn.textContent = "送出中…";
  try {
    const moneyFields = { paymentMethod, depositPaid, fullyPaid, todayAmount, extraAmount, storedValueAmount, storedValueUsed };
    let savedBookingId = editingId;
    if (isEdit) {
      await Api.post("updateBooking", { bookingId: editingId, customerId, customerName: name, phone, date, startTime, endTime, service, price, notes, cancelReason, ...moneyFields });
      if (prevStatusForEdit !== status) {
        await Api.post("updateBookingStatus", { bookingId: editingId, status, cancelReason });
        if (window.tourOnStatusChanged) window.tourOnStatusChanged(editingId, status);
      }
      showToast("預約已更新");
      if (window.tourOnBookingUpdated) window.tourOnBookingUpdated(editingId);
    } else {
      const customerFields = {};
      if (customerContactInput) customerFields.customerContact = customerContactInput;
      if (customerBirthdayInput) customerFields.customerBirthday = customerBirthdayInput;
      const created = await Api.post("createBooking", { customerId, customerName: name, phone, date, startTime, endTime, service, price, status, notes, cancelReason, ...moneyFields, ...customerFields });
      savedBookingId = created && created.bookingId;
      showToast("預約已建立");
      if (window.tourOnBookingCreated) window.tourOnBookingCreated(savedBookingId, name);
    }
    closeBookingModal();
    if (fmtDate(state.selectedDate) !== date) state.selectedDate = new Date(date + "T00:00:00");
    // 剛把預約存成「已確認」（新建或從別的狀態改過來），問要不要順便開 LINE 範本傳確認訊息給客人
    // 「預約操作教學」進行中先不要跳這個詢問，不然會被導去 LINE 範本頁面，跟教學步驟對不起來
    //
    // 這裡故意不等 reloadBookingsAndCustomers() 跑完才問——那個要連續打 3 個 GAS API
    // （getBookings／getCustomers／getRevenueSummary），Apps Script 本身每次呼叫就有
    // 1~2 秒左右的固定延遲，三個疊起來就是使用者反應「建立完要等三四秒才跳出詢問」的原因。
    // 其實問「要不要傳LINE」根本不需要等重新整理資料——客戶姓名、服務、日期時間剛剛表單上
    // 都填過了，直接拿表單的值組一個輕量物件就能用，資料重新整理改成背景進行、不擋這個詢問。
    const becameConfirmed = !tour2Active && status === "confirmed" && prevStatusForEdit !== "confirmed";
    const savedBookingLite = becameConfirmed ? { CustomerName: name, Service: service, Date: date, StartTime: startTime } : null;
    reloadBookingsAndCustomers().catch((err) => { console.error(err); showToast("背景重新整理資料失敗，可重新整理頁面再試一次", true); }); // 背景重新整理，不 await，不擋下面的詢問
    if (savedBookingLite && (await showConfirmDialog(`要開啟 LINE 範本，傳送「預約確認」訊息給 ${savedBookingLite.CustomerName} 嗎？`))) {
      openLineTemplateFor(savedBookingLite, "confirm");
    } else if (!tour2Active) {
      showView("calendar");
    }
  } catch (err) {
    showToast((isEdit ? "更新失敗：" : "建立失敗：") + err.message, true);
    submitBtn.disabled = false;
    submitBtn.textContent = isEdit ? "儲存變更" : "建立預約";
  }
}

/* ============================================================
   Customers
   ============================================================ */
// 目前儲值金＝該客戶所有（未取消）預約的「本次儲值金額」加總，減去「使用儲值金」加總
function customerStoredValueBalance(customerId) {
  const c = state.customers.find((x) => x.CustomerID === customerId);
  return c ? Number(c.StoredValueBalance) || 0 : 0;
}

function renderCustomers() {
  document.getElementById("cust-count").textContent = state.customers.length;
  const rows = state.customers.filter((c) => {
    const matchFilter = state.custFilter === "all" || c.Tag === state.custFilter;
    const matchSearch = !state.custSearch || String(c.Name).includes(state.custSearch) || String(c.Phone).includes(state.custSearch);
    return matchFilter && matchSearch;
  });

  const tbody = document.getElementById("cust-tbody");
  tbody.innerHTML = rows.map((c) => `
    <tr data-cid="${escapeHtml(c.CustomerID)}">
      <td><div class="cust-name">${escapeHtml(c.Name)}<small>${escapeHtml(c.Phone)}</small></div></td>
      <td><span class="tag ${c.Tag}">${tagLabel[c.Tag] || c.Tag}</span></td>
      <td>${escapeHtml(c.LastVisitDate || "—")}</td>
      <td class="num">${c.VisitCount || 0} 次</td>
      <td class="num">${money(c.TotalSpend)}</td>
      <td class="num">${money(customerStoredValueBalance(c.CustomerID))}</td>
    </tr>
  `).join("") || `<tr><td colspan="6" style="text-align:center;color:var(--ink-muted);padding:24px;">找不到符合的客戶</td></tr>`;

  tbody.querySelectorAll("tr[data-cid]").forEach((tr) => {
    tr.addEventListener("click", () => openCustomerModal(tr.dataset.cid));
  });
}

document.getElementById("cust-search").addEventListener("input", (e) => {
  state.custSearch = e.target.value.trim();
  renderCustomers();
});
document.querySelectorAll(".filter-chip[data-filter]").forEach((chip) => {
  chip.addEventListener("click", () => {
    state.custFilter = chip.dataset.filter;
    document.querySelectorAll(".filter-chip[data-filter]").forEach((c) => c.classList.toggle("on", c === chip));
    renderCustomers();
  });
});

/* ============================================================
   預約清單：狀態／服務分類／日期範圍篩選
   ============================================================ */
(function initBookingListStatusChips() {
  const wrap = document.getElementById("bl-status-chips");
  const allChip = `<button class="filter-chip on" data-bl-status="">全部狀態</button>`;
  const statusChips = Object.keys(statusLabel).map((s) =>
    `<button class="filter-chip" data-bl-status="${s}">${statusLabel[s]}</button>`
  ).join("");
  wrap.innerHTML = allChip + statusChips;
  wrap.querySelectorAll("[data-bl-status]").forEach((chip) => {
    chip.addEventListener("click", () => {
      const s = chip.dataset.blStatus;
      if (!s) {
        state.blStatuses = null; // 「全部狀態」：清空篩選
      } else if (state.blStatuses === null) {
        state.blStatuses = [s]; // 目前是「全部」，點一個特定狀態時改成只選這一個
      } else {
        const cur = state.blStatuses.slice();
        const idx = cur.indexOf(s);
        if (idx > -1) cur.splice(idx, 1); else cur.push(s);
        // 選到空的或選滿全部，都直接視為「全部狀態」
        state.blStatuses = (cur.length === 0 || cur.length === Object.keys(statusLabel).length) ? null : cur;
      }
      blPage = 1;
      renderBookingList();
    });
  });
})();
document.getElementById("bl-date-from").addEventListener("change", (e) => { state.blDateFrom = e.target.value; blPage = 1; renderBookingList(); });
document.getElementById("bl-date-to").addEventListener("change", (e) => { state.blDateTo = e.target.value; blPage = 1; renderBookingList(); });
document.getElementById("bl-category-select").addEventListener("change", (e) => { state.blCategory = e.target.value; blPage = 1; renderBookingList(); });
document.getElementById("bl-clear-filters-btn").addEventListener("click", () => {
  state.blStatuses = null; state.blCategory = ""; state.blDateFrom = ""; state.blDateTo = "";
  document.getElementById("bl-date-from").value = "";
  document.getElementById("bl-date-to").value = "";
  document.getElementById("bl-category-select").value = "";
  document.querySelectorAll("#bl-status-chips [data-bl-status]").forEach((c) => c.classList.toggle("on", c.dataset.blStatus === ""));
  blPage = 1;
  renderBookingList();
});

/* 預約清單分頁：資料（state.bookings）其實還是一次全部從後端載入的，這裡只是「畫面上」
   一次只顯示 10 筆，不用整頁一次塞幾百列進 DOM，捲動、渲染都會比較輕鬆，資料愈多愈明顯。
   篩選條件改變時都要把頁碼重置回第 1 頁（見上面幾個篩選的 change/click 監聽器）。 */
const BL_PAGE_SIZE = 10;
let blPage = 1;
document.getElementById("bl-prev-btn").addEventListener("click", () => { blPage = Math.max(1, blPage - 1); renderBookingList(); });
document.getElementById("bl-next-btn").addEventListener("click", () => { blPage++; renderBookingList(); });

function renderBookingList() {
  const tbody = document.getElementById("bl-tbody");
  if (!tbody) return;

  // 服務分類下拉選單（依目前的服務項目資料動態產生，保留使用者目前選的值）
  const categorySelect = document.getElementById("bl-category-select");
  const categories = Array.from(new Set(state.services.map((s) => s.Category).filter(Boolean)));
  const curCategory = state.blCategory;
  categorySelect.innerHTML = `<option value="">全部服務分類</option>` +
    categories.map((c) => `<option value="${escapeHtml(c)}" ${c === curCategory ? "selected" : ""}>${escapeHtml(c)}</option>`).join("");

  document.querySelectorAll("#bl-status-chips [data-bl-status]").forEach((chip) => {
    const s = chip.dataset.blStatus;
    chip.classList.toggle("on", s ? !!(state.blStatuses && state.blStatuses.includes(s)) : state.blStatuses === null);
  });

  const serviceCategoryByName = {};
  state.services.forEach((s) => { serviceCategoryByName[s.Name] = s.Category; });

  const rows = state.bookings.filter((b) => {
    if (state.blStatuses && !state.blStatuses.includes(normalizeStatus(b.Status))) return false;
    if (state.blCategory) {
      // Service 欄位可能是多項服務用「、」串起來，只要其中一項符合分類就算符合
      const names = String(b.Service || "").split("、").map((n) => n.trim());
      if (!names.some((n) => serviceCategoryByName[n] === state.blCategory)) return false;
    }
    if (state.blDateFrom && b.Date < state.blDateFrom) return false;
    if (state.blDateTo && b.Date > state.blDateTo) return false;
    return true;
  }).sort((a, b) => (b.Date + b.StartTime).localeCompare(a.Date + a.StartTime));

  document.getElementById("bl-count").textContent = rows.length;

  const totalPages = Math.max(1, Math.ceil(rows.length / BL_PAGE_SIZE));
  if (blPage > totalPages) blPage = totalPages;
  const pageRows = rows.slice((blPage - 1) * BL_PAGE_SIZE, blPage * BL_PAGE_SIZE);
  document.getElementById("bl-page-label").textContent = `第 ${blPage} / ${totalPages} 頁`;
  document.getElementById("bl-prev-btn").disabled = blPage <= 1;
  document.getElementById("bl-next-btn").disabled = blPage >= totalPages;

  tbody.innerHTML = pageRows.map((b) => `
    <tr data-booking-id="${escapeHtml(b.BookingID)}">
      <td>${escapeHtml(b.Date)}</td>
      <td>${escapeHtml(b.StartTime)}</td>
      <td>${escapeHtml(b.CustomerName)}</td>
      <td>${escapeHtml(b.Phone)}</td>
      <td>${escapeHtml(b.Service)}</td>
      <td class="num">${money(b.Price)}</td>
      <td><span class="status-pill ${normalizeStatus(b.Status)}">${statusLabel[normalizeStatus(b.Status)]}</span></td>
    </tr>
  `).join("") || `<tr><td colspan="7" style="text-align:center;color:var(--ink-muted);padding:24px;">找不到符合篩選條件的預約</td></tr>`;

  tbody.querySelectorAll("tr[data-booking-id]").forEach((tr) => {
    tr.addEventListener("click", () => {
      const booking = state.bookings.find((b) => b.BookingID === tr.dataset.bookingId);
      if (booking) openBookingModal({}, booking);
    });
  });
}

const modalBackdrop = document.getElementById("modal-backdrop");
const modalBody = document.getElementById("modal-body");
function birthdayLabel(b) {
  if (!b) return "";
  const parts = String(b).split("-");
  if (parts.length !== 3) return b;
  return `${Number(parts[1])}/${Number(parts[2])}`;
}
function openCustomerModal(customerId, editMode) {
  const c = state.customers.find((x) => x.CustomerID === customerId);
  if (!c) return;
  const history = state.bookings
    .filter((b) => b.CustomerID === customerId && b.Status !== "cancelled")
    .sort((a, b) => (b.Date + b.StartTime).localeCompare(a.Date + a.StartTime));
  const storedValueTopUp = history.reduce((s, b) => s + (Number(b.StoredValueAmount) || 0), 0);
  const storedValueUsedTotal = history.reduce((s, b) => s + (Number(b.StoredValueUsed) || 0), 0);
  const storedValueBalance = customerStoredValueBalance(customerId); // 直接讀「客戶資料」試算表裡同步好的目前儲值金
  // 儲值紀錄：每一筆有儲值或使用儲值的預約各拆成一列，方便看每次進出的明細
  const storedValueLedger = [];
  history.forEach((b) => {
    if (Number(b.StoredValueAmount) > 0) storedValueLedger.push({ date: b.Date, type: "topup", amount: Number(b.StoredValueAmount), booking: b });
    if (Number(b.StoredValueUsed) > 0) storedValueLedger.push({ date: b.Date, type: "used", amount: Number(b.StoredValueUsed), booking: b });
  });

  const infoBlock = editMode ? `
    <div class="field"><label>客戶姓名</label><input id="cm-name" value="${escapeHtml(c.Name)}"></div>
    <div class="field"><label>電話</label><input id="cm-phone" value="${escapeHtml(c.Phone)}"></div>
    <div class="field"><label>LINE / IG</label><input id="cm-contact" placeholder="選填" value="${escapeHtml(c.Contact || "")}"></div>
    <div class="field"><label>生日</label><input type="date" id="cm-birthday" value="${escapeHtml(c.Birthday || "")}"></div>
    <div class="field"><label>備註</label><textarea id="cm-notes" rows="2" placeholder="選填">${escapeHtml(c.Notes || "")}</textarea></div>
    <div class="modal-actions">
      <button class="btn ghost" id="cm-cancel-edit">取消</button>
      <button class="btn" id="cm-save">儲存</button>
    </div>
  ` : `
    <div class="sub">${escapeHtml(c.Phone)}${c.Contact ? "・" + escapeHtml(c.Contact) : ""}・<span class="tag ${c.Tag}" style="margin-left:2px;">${tagLabel[c.Tag] || c.Tag}</span></div>
    <div class="kv"><span class="k">到店次數</span><span class="num">${c.VisitCount || 0} 次</span></div>
    <div class="kv"><span class="k">累計消費</span><span class="num">${money(c.TotalSpend)}</span></div>
    ${storedValueTopUp ? `<div class="kv"><span class="k">目前儲值金</span><span class="num">${money(storedValueBalance)}</span></div>` : ""}
    ${storedValueTopUp ? `<div class="kv"><span class="k">累計儲值／已使用</span><span class="num">${money(storedValueTopUp)}／${money(storedValueUsedTotal)}</span></div>` : ""}
    <div class="kv"><span class="k">最近到店</span><span>${escapeHtml(c.LastVisitDate || "—")}</span></div>
    ${c.Birthday ? `<div class="kv"><span class="k">生日</span><span>${birthdayLabel(c.Birthday)}</span></div>` : ""}
    ${c.Notes ? `<div class="kv"><span class="k">備註</span><span>${escapeHtml(c.Notes)}</span></div>` : ""}
  `;

  modalBody.innerHTML = `
    <button class="modal-close" id="modal-close-btn" aria-label="關閉">✕</button>
    <h3>${escapeHtml(c.Name)}${!editMode ? ` <button class="btn ghost btn-inline-edit" id="cm-edit-btn">✎ 編輯資料</button>` : ""}</h3>
    ${infoBlock}
    ${!editMode ? `
      ${storedValueLedger.length ? `
        <h3 style="font-size:14.5px;margin-top:18px;margin-bottom:6px;color:var(--ink-secondary);">儲值紀錄</h3>
        ${storedValueLedger.map((t) => `
          <div class="hist-row"><span>${escapeHtml(t.date)}・${t.type === "topup" ? "儲值" : "使用"}・${escapeHtml(t.booking.Service || "")}</span><span class="num" style="color:${t.type === "topup" ? "var(--success)" : "var(--danger)"};">${t.type === "topup" ? "+" : "－"}${money(t.amount)}</span></div>
        `).join("")}
      ` : ""}
      <h3 style="font-size:14.5px;margin-top:18px;margin-bottom:6px;color:var(--ink-secondary);">預約紀錄</h3>
      ${history.length ? history.map((h) => `
        <div class="hist-row"><span>${escapeHtml(h.Date)}・${escapeHtml(h.Service)}・<span class="status-pill ${normalizeStatus(h.Status)}" style="padding:1px 6px;">${statusLabel[normalizeStatus(h.Status)]}</span></span><span class="num">${money(h.Price)}</span></div>
      `).join("") : `<p class="empty-hint">尚無紀錄</p>`}
    ` : ""}
  `;
  modalBackdrop.classList.add("show");
  document.getElementById("modal-close-btn").addEventListener("click", () => modalBackdrop.classList.remove("show"));
  if (!editMode) {
    document.getElementById("cm-edit-btn").addEventListener("click", () => openCustomerModal(customerId, true));
  } else {
    document.getElementById("cm-cancel-edit").addEventListener("click", () => openCustomerModal(customerId, false));
    document.getElementById("cm-save").addEventListener("click", async () => {
      const name = document.getElementById("cm-name").value.trim();
      const phone = document.getElementById("cm-phone").value.trim();
      if (!name || !phone) { showToast("請填寫姓名與電話", true); return; }
      try {
        await Api.post("upsertCustomer", {
          customerId,
          name, phone,
          contact: document.getElementById("cm-contact").value.trim(),
          birthday: document.getElementById("cm-birthday").value,
          notes: document.getElementById("cm-notes").value.trim(),
        });
        showToast("已更新客戶資料");
        await reloadBookingsAndCustomers();
        openCustomerModal(customerId, false);
      } catch (err) {
        showToast("更新失敗：" + err.message, true);
      }
    });
  }
}
modalBackdrop.addEventListener("click", (e) => { if (e.target === modalBackdrop) modalBackdrop.classList.remove("show"); });

/* ============================================================
   Revenue chart
   ============================================================ */
function renderRevenue() {
  if (!state.revenue) return;
  const months = state.revenue.months || [];

  document.getElementById("rev-total").textContent = money(state.revenue.totalAmount);
  document.getElementById("rev-avg").textContent = money(state.revenue.average);

  const rangeStart = months[0] ? months[0].month + "-01" : null;
  const ordersInRange = rangeStart
    ? state.bookings.filter((b) => b.Status !== "cancelled" && b.Date >= rangeStart)
    : [];
  const perOrder = ordersInRange.length ? Math.round(state.revenue.totalAmount / ordersInRange.length) : 0;
  document.getElementById("rev-per-order").textContent = perOrder ? money(perOrder) : "—";

  const wrap = document.getElementById("revenue-chart");
  const W = 900, H = 260, padL = 46, padB = 32, padT = 16, padR = 12;
  const max = Math.max(...months.map((d) => d.total), 1);
  const niceMax = Math.ceil(max / 10000) * 10000 || 10000;
  const plotW = W - padL - padR, plotH = H - padT - padB;
  const gap = 0.38;
  const bw = (plotW / months.length) * (1 - gap);
  const step = plotW / months.length;

  let gridLines = "", gridLabels = "";
  const ticks = 4;
  for (let i = 0; i <= ticks; i++) {
    const val = (niceMax / ticks) * i;
    const y = padT + plotH - (val / niceMax) * plotH;
    gridLines += `<line class="grid-line" x1="${padL}" x2="${W - padR}" y1="${y}" y2="${y}"/>`;
    gridLabels += `<text class="axis-label" x="${padL - 8}" y="${y + 4}" text-anchor="end">${Math.round(val / 1000)}k</text>`;
  }

  let bars = "";
  months.forEach((d, i) => {
    const x = padL + step * i + (step - bw) / 2;
    const h = (d.total / niceMax) * plotH;
    const y = padT + plotH - h;
    const [yy, mm] = d.month.split("-");
    bars += `
      <g class="bar-g" data-idx="${i}">
        <rect class="bar-fill" x="${x}" y="${y}" width="${bw}" height="${h}" rx="4"/>
        <rect x="${x}" y="${padT}" width="${bw}" height="${plotH}" fill="transparent"/>
        <text class="bar-value" x="${x + bw / 2}" y="${y - 8}" text-anchor="middle">${(d.total / 1000).toFixed(1)}k</text>
        <text class="bar-label" x="${x + bw / 2}" y="${H - padB + 18}" text-anchor="middle">${Number(mm)}月</text>
      </g>
    `;
  });

  wrap.innerHTML = `
    <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;display:block;" role="img" aria-label="近六個月月營收長條圖">
      ${gridLines}${gridLabels}${bars}
    </svg>
    <div class="tooltip-box" id="rev-tooltip"></div>
  `;

  const tooltip = document.getElementById("rev-tooltip");
  wrap.querySelectorAll(".bar-g").forEach((g) => {
    const rect = g.querySelector(".bar-fill");
    g.addEventListener("mouseenter", () => {
      rect.classList.add("hover");
      const d = months[g.dataset.idx];
      tooltip.textContent = `${d.month}：${money(d.total)}`;
      tooltip.style.opacity = "1";
    });
    g.addEventListener("mousemove", (e) => {
      const bounds = wrap.getBoundingClientRect();
      tooltip.style.left = e.clientX - bounds.left + 12 + "px";
      tooltip.style.top = e.clientY - bounds.top - 36 + "px";
    });
    g.addEventListener("mouseleave", () => { rect.classList.remove("hover"); tooltip.style.opacity = "0"; });
  });

  renderMonthCompare();
  renderReportList();
}

/* ============================================================
   本月 vs 上月、月報表存底
   ============================================================ */
function computeMonthStatsClient(year, month) {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const items = state.bookings.filter((b) => b.Date && b.Date.startsWith(prefix));
  const revenueItems = items.filter((b) => REVENUE_STATUSES.includes(normalizeStatus(b.Status)));
  const revenue = revenueItems.reduce((s, b) => s + (Number(b.Price) || 0), 0);
  const topUp = items.reduce((s, b) => s + (Number(b.StoredValueAmount) || 0), 0);
  const doneCount = revenueItems.length;
  const cancelCount = items.filter((b) => b.Status === "cancelled").length;
  const avgTicket = revenueItems.length ? Math.round(revenue / revenueItems.length) : 0;
  const cancelRate = items.length ? Math.round((cancelCount / items.length) * 100) : 0;
  const newCustomerCount = state.customers.filter((c) => String(c.CreatedAt || "").startsWith(prefix)).length;
  return { apptCount: items.length, doneCount, cancelCount, revenue, topUp, avgTicket, cancelRate, newCustomerCount };
}
function renderMonthCompare() {
  const el = document.getElementById("month-compare-grid");
  if (!el) return;
  const now = new Date();
  const cur = computeMonthStatsClient(now.getFullYear(), now.getMonth());
  const prevDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prev = computeMonthStatsClient(prevDate.getFullYear(), prevDate.getMonth());
  function deltaLabel(curVal, prevVal) {
    if (!prevVal) return "";
    const pct = Math.round(((curVal - prevVal) / prevVal) * 100);
    return (pct >= 0 ? "▲ +" : "▼ ") + pct + "%（較上月）";
  }
  // 除了營收／預約數／客單價，美業還會在意「這個月有沒有拉到新客」「取消率是不是變差」「儲值金收得順不順」，
  // 這幾個比較能直接反映經營狀況，跟今日總覽只看單日的數字互補。
  el.innerHTML =
    statCardHtml("本月營收", money(cur.revenue)) +
    statCardHtml("本月預約數", cur.apptCount) +
    statCardHtml("本月客單價", cur.avgTicket ? money(cur.avgTicket) : "—") +
    statCardHtml("本月新客數", cur.newCustomerCount + " 位") +
    statCardHtml("本月取消率", cur.cancelRate + "%") +
    statCardHtml("本月儲值營收", money(cur.topUp));
  const cards = el.querySelectorAll(".stat .delta");
  if (cards[0]) cards[0].textContent = deltaLabel(cur.revenue, prev.revenue);
  if (cards[1]) cards[1].textContent = deltaLabel(cur.apptCount, prev.apptCount);
  if (cards[2]) cards[2].textContent = deltaLabel(cur.avgTicket, prev.avgTicket);
  if (cards[3]) cards[3].textContent = deltaLabel(cur.newCustomerCount, prev.newCustomerCount);
  if (cards[4]) {
    const diff = cur.cancelRate - prev.cancelRate;
    cards[4].textContent = `${diff <= 0 ? "▼ " : "▲ +"}${diff} 個百分點（較上月）`;
    cards[4].classList.toggle("up", diff <= 0); // 取消率是「越低越好」，下降才用醒目色標示
  }
  if (cards[5]) cards[5].textContent = deltaLabel(cur.topUp, prev.topUp);
}
function renderReportList() {
  const el = document.getElementById("report-list");
  if (!el) return;
  const reports = (state.reports || []).slice().sort((a, b) => (a.Month < b.Month ? 1 : -1));
  if (!reports.length) { el.innerHTML = `<p class="empty-hint">尚未存檔任何月報表</p>`; return; }
  el.innerHTML = reports.map((r) => `
    <div class="report-row" data-report-id="${escapeHtml(r.ReportID)}">
      <div class="report-row-main">
        <b>${escapeHtml(r.Month)}</b>
        <span class="hint">預約 ${r.ApptCount} 筆・完成 ${r.DoneCount}・取消 ${r.CancelCount}・營收 ${money(r.Revenue)}・客單價 ${money(r.AvgTicket)}・回客率 ${r.RepeatRate}%</span>
      </div>
      <button class="icon-btn report-delete-btn" title="刪除此存檔" data-report-id="${escapeHtml(r.ReportID)}">🗑</button>
    </div>
  `).join("");
  el.querySelectorAll(".report-delete-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirmInline(btn, "再點一次確認刪除")) return;
      try {
        await Api.post("deleteReport", { reportId: btn.dataset.reportId });
        state.reports = state.reports.filter((r) => r.ReportID !== btn.dataset.reportId);
        renderReportList();
        showToast("已刪除月報表存檔");
      } catch (err) {
        showToast("刪除失敗：" + err.message, true);
      }
    });
  });
}
/* ============================================================
   系統設定：營業時間／固定公休日／特別公休日
   ============================================================ */
function parseHolidays(str) {
  return String(str || "").split(",").map((s) => s.trim()).filter(Boolean).map((entry) => {
    const [start, end] = entry.split("~");
    return { start, end: end || "" };
  });
}
function formatHolidays(list) {
  return list.map((h) => (h.end ? `${h.start}~${h.end}` : h.start)).join(",");
}
async function saveSettingsFields(fields, successMsg) {
  try {
    const updated = await Api.post("updateSettings", fields);
    state.settings = updated || { ...state.settings, ...fields };
    saveCachedJSON(CACHE_KEY_SETTINGS, state.settings);
    renderSystemSettings();
    renderCalendar(); // 公休日／營業時間變了，日曆的滿載顏色要跟著重畫
    showToast(successMsg || "已儲存");
  } catch (err) {
    showToast("儲存失敗：" + err.message, true);
  }
}
function renderHolidayList() {
  const el = document.getElementById("ss-holiday-list");
  if (!el) return;
  const list = parseHolidays(state.settings.SpecialHolidays);
  if (!list.length) { el.innerHTML = `<p class="empty-hint">尚未設定特別公休日</p>`; return; }
  el.innerHTML = list.map((h, i) => `
    <div class="report-row">
      <div class="report-row-main"><b>${h.end ? `${escapeHtml(h.start)} ～ ${escapeHtml(h.end)}` : escapeHtml(h.start)}</b></div>
      <button class="icon-btn ss-holiday-delete-btn" title="刪除" data-idx="${i}">🗑</button>
    </div>
  `).join("");
  el.querySelectorAll(".ss-holiday-delete-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const list2 = parseHolidays(state.settings.SpecialHolidays);
      list2.splice(Number(btn.dataset.idx), 1);
      saveSettingsFields({ SpecialHolidays: formatHolidays(list2) }, "已刪除公休日");
    });
  });
}
function renderSystemSettings() {
  const s = state.settings || {};
  const startEl = document.getElementById("ss-hours-start");
  const endEl = document.getElementById("ss-hours-end");
  if (startEl && document.activeElement !== startEl) startEl.value = s.BusinessHoursStart || "09:00";
  if (endEl && document.activeElement !== endEl) endEl.value = s.BusinessHoursEnd || "20:00";

  const closedSet = new Set(String(s.ClosedWeekdays || "").split(",").filter(Boolean));
  document.querySelectorAll("#ss-weekday-picker input[type=checkbox]").forEach((cb) => {
    cb.checked = closedSet.has(cb.value);
  });

  renderHolidayList();
}
document.getElementById("ss-hours-save").addEventListener("click", () => {
  const start = document.getElementById("ss-hours-start").value || "09:00";
  const end = document.getElementById("ss-hours-end").value || "20:00";
  if (end <= start) { showToast("結束時間要比開始時間晚", true); return; }
  saveSettingsFields({ BusinessHoursStart: start, BusinessHoursEnd: end }, "已儲存營業時間");
});
document.getElementById("ss-weekday-save").addEventListener("click", () => {
  const checked = Array.from(document.querySelectorAll("#ss-weekday-picker input:checked")).map((cb) => cb.value);
  saveSettingsFields({ ClosedWeekdays: checked.join(",") }, "已儲存固定公休日");
});
document.getElementById("ss-holiday-add").addEventListener("click", () => {
  const startEl = document.getElementById("ss-holiday-start");
  const endEl = document.getElementById("ss-holiday-end");
  const start = startEl.value;
  const end = endEl.value;
  if (!start) { showToast("請先選擇開始日期", true); return; }
  if (end && end < start) { showToast("結束日期不能早於開始日期", true); return; }
  const list = parseHolidays(state.settings.SpecialHolidays);
  list.push({ start, end: end || "" });
  startEl.value = "";
  endEl.value = "";
  saveSettingsFields({ SpecialHolidays: formatHolidays(list) }, "已新增公休日");
});

// 用兩段式點擊取代 confirm()：第一次點擊只是標記待確認狀態，第二次點擊才真的執行
function confirmInline(btn, msg) {
  if (btn.dataset.confirming === "1") { btn.dataset.confirming = ""; return true; }
  btn.dataset.confirming = "1";
  const original = btn.title;
  btn.title = msg;
  btn.classList.add("danger-pending");
  setTimeout(() => { btn.dataset.confirming = ""; btn.title = original; btn.classList.remove("danger-pending"); }, 3000);
  return false;
}
document.getElementById("generate-report-btn").addEventListener("click", async () => {
  const picker = document.getElementById("report-month-picker");
  const month = picker.value || fmtDate(new Date()).slice(0, 7);
  const btn = document.getElementById("generate-report-btn");
  btn.disabled = true;
  try {
    const report = await Api.post("saveReport", { month });
    const idx = state.reports.findIndex((r) => r.Month === month);
    if (idx >= 0) state.reports[idx] = report; else state.reports.push(report);
    renderReportList();
    showToast(`已存檔 ${month} 月報表`);
  } catch (err) {
    showToast("存檔失敗：" + err.message, true);
  } finally {
    btn.disabled = false;
  }
});
(function initReportMonthPicker() {
  const picker = document.getElementById("report-month-picker");
  if (picker && !picker.value) picker.value = fmtDate(new Date()).slice(0, 7);
})();

/* ============================================================
   CSV 匯出
   ============================================================ */
function downloadCsv(filename, rows) {
  const csv = rows.map((row) => row.map((cell) => {
    const s = cell === null || cell === undefined ? "" : String(cell);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
document.getElementById("export-bookings-csv-btn").addEventListener("click", () => {
  const header = ["日期", "開始時間", "結束時間", "客戶姓名", "電話", "服務項目", "金額", "狀態", "付款方式", "備註"];
  const rows = state.bookings
    .slice()
    .sort((a, b) => (a.Date + a.StartTime).localeCompare(b.Date + b.StartTime))
    .map((b) => [b.Date, b.StartTime, b.EndTime, b.CustomerName, b.Phone, b.Service, b.Price, statusLabel[normalizeStatus(b.Status)], b.PaymentMethod, b.Notes]);
  downloadCsv(`預約紀錄_${fmtDate(new Date())}.csv`, [header, ...rows]);
});

/* ============================================================
   LINE 訊息範本
   ============================================================ */
const tplChips = document.querySelectorAll("[data-tpl]");
let activeTpl = "confirm";
const nameEl = document.getElementById("tpl-name");
const serviceEl = document.getElementById("tpl-service");
const timeEl = document.getElementById("tpl-time");
const extraEl = document.getElementById("tpl-extra");
const extraFieldEl = document.getElementById("tpl-extra-field");
const previewEl = document.getElementById("tpl-preview");

// 每個範本除了共用的「客戶稱呼」，有些還需要額外一個欄位（例如儲值金提醒要填餘額），沒有需要的範本就把這欄藏起來
const TPL_EXTRA_LABEL = { storedValueMoney: "儲值金餘額 (NT$)" };

function buildMessage() {
  const name = nameEl.value.trim() || "客人";
  const service = serviceEl.value.trim() || "預約項目";
  const time = timeEl.value.trim() || "預約時間";
  const extra = extraEl.value.trim() || "0";

  const fallback = {
    confirm: `${name} 您好😊\n已為您預約成功！\n\n📅 時間：${time}\n💅 項目：${service}\n\n若時間需要調整，請提前告知我們，謝謝您的預約 🙏`,
    reminder: `${name} 您好，提醒您明天的預約唷～\n\n📅 時間：${time}\n💅 項目：${service}\n\n請於時間前 5-10 分鐘到店即可，期待與您見面 ✨`,
    followup: `${name} 您好，感謝今天蒞臨體驗「${service}」🌸\n如果對這次的服務滿意，歡迎再次預約，也歡迎分享給朋友唷！\n祝您有美好的一天 💕`,
    storedValueMoney: `${name} 您好😊\n提醒您目前帳戶還有儲值金 $${extra} 尚未使用喔～\n\n下次來店消費都可以直接扣抵，歡迎盡快預約使用，期待與您相見 💕`,
    birthday: `${name} 您好🎂\n祝您生日快樂，天天開心又美麗！\n本月壽星享有專屬生日優惠，歡迎預約來店慶祝一下 🎉`,
  };

  previewEl.textContent = fallback[activeTpl];
}
[nameEl, serviceEl, timeEl, extraEl].forEach((el) => el.addEventListener("input", buildMessage));
function applyTplChoice(key) {
  activeTpl = key;
  tplChips.forEach((c) => c.classList.toggle("on", c.dataset.tpl === key));
  const extraLabel = TPL_EXTRA_LABEL[key];
  extraFieldEl.hidden = !extraLabel;
  if (extraLabel) document.getElementById("tpl-extra-label").textContent = extraLabel;
  buildMessage();
}
tplChips.forEach((chip) => {
  chip.addEventListener("click", () => applyTplChoice(chip.dataset.tpl));
});

// 從預約資料快速跳到 LINE 範本頁面，客戶稱呼／服務項目／預約時間先幫忙填好，複製後自己貼到 LINE 傳給客人
// （沒有串 LINE 官方 API，這裡只能做到「幫你把訊息準備好」，實際傳送還是要自己動手貼過去）
function openLineTemplateFor(booking, tplKey) {
  showView("linegen");
  nameEl.value = booking.CustomerName || "";
  serviceEl.value = booking.Service || "";
  if (booking.Date) {
    const d = new Date(booking.Date + "T00:00:00");
    timeEl.value = `${d.getMonth() + 1}/${d.getDate()}（${weekday[d.getDay()]}）${booking.StartTime || ""}`;
  } else {
    timeEl.value = booking.StartTime || "";
  }
  applyTplChoice(tplKey);
  showToast("已幫你把訊息填好，複製後貼到 LINE 傳送給客人");
}

document.getElementById("copy-btn").addEventListener("click", () => {
  const text = previewEl.textContent;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => showToast("已複製訊息，可貼到 LINE 傳送")).catch(() => showToast("複製失敗，請手動選取文字", true));
  } else {
    showToast("此瀏覽器不支援自動複製，請手動選取文字", true);
  }
});

/* ============================================================
   新手導覽：帶著使用者實際點過一輪最常用的 5 件事
   純前端引導，不會動到任何資料，跳過或關掉隨時可以重來
   ============================================================ */
const TOUR_STEPS = [
  {
    title: "歡迎使用指尖工作室 👋",
    text: "花 1 分鐘帶你認識最常用的幾個地方，中途想離開的話按右下角「跳過導覽」就可以了。",
  },
  {
    selectors: ["#open-settings-btn"],
    title: "① 後端設定：連上你的試算表",
    text: "第一次使用要先點這裡，把 Google 試算表的網址跟金鑰貼進去，手機、電腦才連得到你的預約資料。點「下一步」我直接幫你打開看看。",
  },
  {
    onEnter: () => openSettingsModal(),
    selectors: ["#set-url"],
    title: "貼上網頁應用程式網址",
    text: "去 Apps Script「部署」拿到的網址（/exec 結尾），貼在這一格。",
  },
  {
    selectors: ["#set-token"],
    title: "貼上 API 金鑰",
    text: "網址跟金鑰都貼好之後，按「儲存並重新整理」就完成連線設定了。之後金鑰異動，回來這裡改就好，不用動到程式碼。",
    onExit: () => closeSettingsModal(),
  },
  {
    onEnter: () => showView("systemsettings"),
    selectors: ['[data-view="systemsettings"]'],
    title: "「系統設定」頁籤",
    text: "營業時間、公休日都是在這裡設定，之後想改隨時可以回來點這個頁籤。",
  },
  {
    selectors: ["#ss-hours-start", ".field-row"],
    title: "② 設定營業時間、公休日",
    text: "填好營業開始／結束時間，按「儲存營業時間」。日曆的滿載提醒、可預約時段都是照這個時間算的。",
  },
  {
    selectors: ["#ss-weekday-picker"],
    title: "固定公休日",
    text: "勾選每週固定公休的星期幾（例如每週一），按「儲存固定公休日」即可。",
  },
  {
    selectors: ["#ss-holiday-add", "#ss-holiday-start"],
    title: "特別公休日",
    text: "遇到連假或臨時休診，就填日期加進來——只填「開始日期」代表休一天，填到「結束日期」就是連續休好幾天，按「＋新增公休日」送出。",
  },
  {
    onEnter: () => showView("calendar"),
    selectors: ["#fab-add-btn", "#add-appt-btn"],
    title: "③ 客人要預約，怎麼點？",
    text: "點「＋新增預約」，或直接點時間軸上的空白時段，就會跳出新增預約視窗，填客人資料、選服務項目送出即可。",
  },
  {
    onEnter: () => showView("bookinglist"),
    selectors: ["#view-bookinglist"],
    title: "④ 確認預約時間",
    text: "點開一筆狀態還在「待確認」的預約，會看到「✓ 確認預約」按鈕，點一下狀態就變成已確認（這時候也會問你要不要順便傳 LINE 提醒給客人）。",
  },
  {
    selectors: ["#view-bookinglist"],
    title: "⑤ 服務結束後結帳",
    text: "一樣點開那筆預約，會看到「💰 一鍵收款」按鈕，點下去就完成收款、狀態自動更新，這筆預約就算完成了。",
  },
  {
    title: "完成了 🎉",
    text: "五個重點都逛過一輪了。之後想再看一次，按左下角的「教學導覽」隨時可以重開。祝生意興隆！",
  },
];

/* ---------- 客戶管理導覽 ---------- */
const TOUR_CUSTOMERS_STEPS = [
  {
    title: "客戶管理導覽 ◈",
    text: "帶你認識客戶管理頁面的幾個重點，中途想離開按右下角「跳過導覽」即可。",
  },
  {
    onEnter: () => showView("customers"),
    selectors: ['[data-view="customers"]'],
    title: "「客戶管理」頁籤",
    text: "所有預約過的客戶都會自動出現在這裡，不用手動一個個新增。",
  },
  {
    selectors: ["#cust-search"],
    title: "搜尋、篩選客戶",
    text: "可以直接搜尋姓名或電話，也可以用上面的「全部／VIP／熟客／新客」標籤篩選。",
  },
  {
    selectors: [".table-wrap"],
    title: "客戶列表",
    text: "每位客戶的到店次數、累計消費、目前儲值金一眼就能看到，方便掌握熟客狀況。",
  },
  {
    selectors: [".table-wrap"],
    title: "點客戶看消費歷史",
    text: "點列表裡任一位客戶，會跳出這位客戶完整的預約紀錄跟儲值金明細（儲值多少、用掉多少）。",
  },
  {
    title: "怎麼新增客戶？",
    text: "客戶管理頁面本身沒有「新增客戶」按鈕——新客戶是在「＋新增預約」的視窗裡，選「新增客戶」模式填資料建立的，預約建立後就會自動出現在這份客戶清單裡。",
  },
  {
    title: "完成了 🎉",
    text: "客戶管理的重點都逛過一輪了。之後想再看一次，按左下角的「教學導覽」隨時可以重開。",
  },
];

/* ---------- 月報表導覽 ---------- */
const TOUR_REVENUE_STEPS = [
  {
    title: "月報表導覽 ▲",
    text: "帶你認識營收報表頁面的幾個重點，中途想離開按右下角「跳過導覽」即可。",
  },
  {
    onEnter: () => showView("revenue"),
    selectors: ['[data-view="revenue"]'],
    title: "「營收報表」頁籤",
    text: "想看生意做得怎麼樣，來這裡就對了，近 6 個月的營收趨勢都在這一頁。",
  },
  {
    selectors: [".stat-row"],
    title: "整體數字",
    text: "近 6 個月總營收、單月平均、客單價，這三個數字會即時依照目前的預約資料計算。",
  },
  {
    selectors: ["#revenue-chart"],
    title: "月營收長條圖",
    text: "滑鼠移到長條上可以看到那個月的詳細金額，一眼比較每個月的高低。",
  },
  {
    selectors: ["#month-compare-grid"],
    title: "本月 vs 上月",
    text: "直接比較這個月跟上個月的營收差異，掌握生意是變好還是變差。",
  },
  {
    selectors: ["#report-month-picker", "#generate-report-btn"],
    title: "月報表存底",
    text: "選好月份按「產生此月報表存檔」，數字就會固定下來、之後預約資料再變動也不會跟著改，適合對帳留底用。",
  },
  {
    selectors: ["#export-bookings-csv-btn"],
    title: "匯出",
    text: "「匯出預約 CSV」可以把預約資料另存成表格；",
  },
  {
    title: "完成了 🎉",
    text: "月報表的重點都逛過一輪了。之後想再看一次，按左下角的「教學導覽」隨時可以重開。",
  },
];

let tourIndex = -1;
let activeTourSteps = TOUR_STEPS;
let tourBlockerEl = null, tourTooltipEl = null, tourTargetEl = null;

function tourFindTarget(selectors) {
  if (!selectors) return null;
  for (const sel of selectors) {
    const el = document.querySelector(sel);
    // 注意：position:fixed 的元素在所有瀏覽器裡 offsetParent 永遠是 null（規格如此，
    // 不代表沒顯示），手機版的「＋新增預約」圓形按鈕就是 fixed 定位，
    // 用 offsetParent 判斷會誤判成「找不到」。改用 getBoundingClientRect() 的寬高
    // 加上 getComputedStyle 的 display/visibility 才能正確判斷元素是否真的顯示中。
    if (el && tourIsVisible_(el)) return el;
  }
  return null;
}

function tourIsVisible_(el) {
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  const style = getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden";
}

// 反白圈的 CSS（.tour-spotlight / .tour-spotlight-live）需要元素是「非 static 定位」
// 才能疊在最上層。以前直接在 CSS 裡寫死 position:relative，結果如果目標本身是
// position:fixed（例如手機版「＋新增預約」圓形按鈕），會被蓋成 relative，
// 整顆按鈕就從畫面右下角「固定位置」變成跑到文件正常排版的位置，等於位置跑掉、UI 壞掉。
// 改成只在元素本來就是 static 時才臨時加上 relative，本來就是 fixed/absolute 的完全不動它。
function tourSpotlightOn(el, cls) {
  if (getComputedStyle(el).position === "static") {
    el.dataset.tourPosPatched = "1";
    el.style.position = "relative";
  }
  el.classList.add(cls);
}
function tourSpotlightOff(el, cls) {
  el.classList.remove(cls);
  if (el.dataset.tourPosPatched) {
    el.style.position = "";
    delete el.dataset.tourPosPatched;
  }
}

function tourCleanupTarget() {
  if (tourTargetEl) { tourSpotlightOff(tourTargetEl, "tour-spotlight"); tourTargetEl = null; }
  const dim = document.querySelector(".tour-dim");
  if (dim) dim.remove();
}

function tourRenderStep() {
  const step = activeTourSteps[tourIndex];
  if (!step) { endTour(); return; }
  tourCleanupTarget();
  if (step.onEnter) step.onEnter();
  requestAnimationFrame(() => {
    const target = tourFindTarget(step.selectors);
    if (target) {
      target.scrollIntoView({ block: "center", behavior: "instant" });
      tourSpotlightOn(target, "tour-spotlight");
      tourTargetEl = target;
    } else {
      const dim = document.createElement("div");
      dim.className = "tour-dim";
      document.body.appendChild(dim);
    }
    requestAnimationFrame(() => tourPositionTooltip(target, step));
  });
}

function tourPositionTooltip(target, step) {
  const isLast = tourIndex === activeTourSteps.length - 1;
  const isFirst = tourIndex === 0;
  tourTooltipEl.innerHTML = `
    <div class="tour-progress">${tourIndex + 1} / ${activeTourSteps.length}</div>
    <h4>${escapeHtml(step.title)}</h4>
    <p>${escapeHtml(step.text)}</p>
    <div class="tour-actions">
      <button class="btn ghost tour-skip" id="tour-skip">跳過導覽</button>
      <div class="tour-right">
        ${!isFirst ? `<button class="btn ghost" id="tour-prev">上一步</button>` : ""}
        <button class="btn" id="tour-next">${isLast ? "開始使用" : "下一步"}</button>
      </div>
    </div>
  `;
  document.getElementById("tour-skip").addEventListener("click", endTour);
  document.getElementById("tour-next").addEventListener("click", tourNext);
  const prevBtn = document.getElementById("tour-prev");
  if (prevBtn) prevBtn.addEventListener("click", tourPrev);

  // 定位：有目標就貼在目標旁邊，沒有目標（開場/結尾）就置中
  const tw = tourTooltipEl.offsetWidth || 300, th = tourTooltipEl.offsetHeight || 140;
  const margin = 14;
  if (!target) {
    tourTooltipEl.style.left = Math.max(margin, (window.innerWidth - tw) / 2) + "px";
    tourTooltipEl.style.top = Math.max(margin, (window.innerHeight - th) / 2) + "px";
    return;
  }
  const r = target.getBoundingClientRect();
  let top = r.bottom + margin;
  if (top + th > window.innerHeight - margin) top = Math.max(margin, r.top - th - margin);
  let left = r.left;
  if (left + tw > window.innerWidth - margin) left = window.innerWidth - tw - margin;
  if (left < margin) left = margin;
  tourTooltipEl.style.left = left + "px";
  tourTooltipEl.style.top = top + "px";
}

function tourNext() {
  const step = activeTourSteps[tourIndex];
  if (step && step.onExit) step.onExit();
  tourIndex++;
  if (tourIndex >= activeTourSteps.length) { endTour(); return; }
  tourRenderStep();
}
function tourPrev() {
  const step = activeTourSteps[tourIndex];
  if (step && step.onExit) step.onExit();
  tourIndex = Math.max(0, tourIndex - 1);
  tourRenderStep();
}
// steps 沒帶的話預設跑「新手導覽」，這樣舊的呼叫方式（不帶參數）還是能動
function startTour(steps) {
  activeTourSteps = steps || TOUR_STEPS;
  tourIndex = 0;
  tourBlockerEl = document.createElement("div");
  tourBlockerEl.className = "tour-blocker";
  tourTooltipEl = document.createElement("div");
  tourTooltipEl.className = "tour-tooltip";
  document.body.appendChild(tourBlockerEl);
  document.body.appendChild(tourTooltipEl);
  tourRenderStep();
}
function endTour() {
  const step = activeTourSteps[tourIndex];
  if (step && step.onExit) step.onExit();
  tourCleanupTarget();
  if (tourBlockerEl) { tourBlockerEl.remove(); tourBlockerEl = null; }
  if (tourTooltipEl) { tourTooltipEl.remove(); tourTooltipEl = null; }
  tourIndex = -1;
}
window.addEventListener("resize", () => {
  if (tourIndex >= 0 && tourTooltipEl) tourPositionTooltip(tourTargetEl, activeTourSteps[tourIndex]);
});

/* ============================================================
   第二個導覽：「預約操作教學」——真的讓使用者自己動手做一遍
   不擋任何點擊，跟著提示實際操作，系統偵測到真的完成該步驟
   （真的建立／更新／確認／收款／刪除了）才會自動進到下一步
   ============================================================ */
const TOUR2_STEPS = [
  { key: "intro", title: "預約操作教學 🔄", text: "接下來要你自己實際操作一遍，跟著提示動手做，我不會幫你點，完成該步驟就會自動進到下一步。", cta: "開始" },
  { key: "create", title: "① 建立預約" },
  { key: "edit", title: "② 更新預約" },
  { key: "confirm", title: "③ 點擊「已確認」" },
  { key: "collect", title: "④ 點擊「一鍵收款」" },
  { key: "cancel", title: "⑤ 取消預約" },
  { key: "done", title: "完成了 🎉", text: "你已經實際操作過建立、更新、確認、收款、取消整個流程了！之後想再練習，按左下角「教學導覽」選單裡的「預約操作教學」隨時可以重開。", cta: "結束" },
];
let tour2Active = false;
let tour2Idx = -1;
let tour2BookingId = null;
let tour2CustomerName = "";
let tour2PanelEl = null;
let tour2SpotlightTarget = null;

function tour2StepText(step) {
  const who = tour2CustomerName ? `『${tour2CustomerName}』` : "剛剛那筆";
  switch (step.key) {
    case "create": return "手機版點畫面右下角的圓形「＋」按鈕，\n電腦版點左側「＋新增預約」（或時間軸上的空白時段），\n填好客人資料——「預約狀態」記得選「待確認」，才能示範下一步的確認動作，\n填好後按「建立預約」送出。";
    case "edit": return `會自動跳轉到你剛建立的${who}預約，按「✎ 編輯」，改個內容（例如金額或備註）後按「更新」儲存。`;
    case "confirm": return `手機版點同一筆 ${who}預約項目，\n電腦版需要按 ${who}預約 的「● 更改狀態」，\n如果狀態還是待確認，會看到「✓ 確認預約」按鈕，點一下。`;
    case "collect": return `手機版點同一筆 ${who}預約項目，\n電腦版需要按按 ${who}預約 的「● 更改狀態」，\n會看到「💰 一鍵收款」按鈕，點下去完成收款。`;
    case "cancel": return `這筆${who}預約是示範用的，點開它，按「✕ 取消預約」，\n 選一個取消原因練習看看，狀態就會變成已取消。\n💡 小提醒：取消只是改狀態，紀錄還在；如果要把某筆預約或某位客戶的資料整筆永久刪除，系統目前沒有一鍵刪除的按鈕（避免誤刪），要直接到 Google 試算表裡的「預約資料」或「客戶資料」分頁，找到那一列刪掉就可以了。`;
    default: return step.text || "";
  }
}

function tour2Cleanup() {
  if (tour2SpotlightTarget) { tourSpotlightOff(tour2SpotlightTarget, "tour-spotlight-live"); tour2SpotlightTarget = null; }
}

function tour2Render() {
  tour2Cleanup();
  const step = TOUR2_STEPS[tour2Idx];
  if (!step) { endTour2(); return; }
  const text = tour2StepText(step);
  // 這幾步會請使用者點開預約詳情彈窗，彈窗的操作按鈕在畫面下方，
  // 跟面板原本固定的左下角位置會疊在一起、把按鈕蓋住點不到，
  // 所以這幾步改把面板移到畫面上方，讓下方彈窗按鈕完全空出來
  const needsModal = ["edit", "confirm", "collect", "cancel"].includes(step.key);
  tour2PanelEl.classList.toggle("tour2-panel-top", needsModal);
  tour2PanelEl.innerHTML = `
    <div class="tour-progress">${tour2Idx + 1} / ${TOUR2_STEPS.length}</div>
    <h4>${escapeHtml(step.title)}</h4>
    <p>${escapeHtml(text)}</p>
    <div class="tour-actions">
      <button class="btn ghost tour-skip" id="tour2-skip">結束導覽</button>
      ${step.cta
      ? `<button class="btn" id="tour2-cta">${escapeHtml(step.cta)}</button>`
      : `<span class="hint" style="font-size:11.5px;color:var(--ink-muted);">完成後會自動跳下一步</span>`}
    </div>
  `;
  document.getElementById("tour2-skip").addEventListener("click", endTour2);
  const ctaBtn = document.getElementById("tour2-cta");
  if (ctaBtn) ctaBtn.addEventListener("click", () => {
    if (step.key === "done") { endTour2(); return; }
    tour2Idx++;
    tour2Render();
  });

  // 「①建立預約」這步改用純文字說明（手機圓形＋按鈕位置比較特殊，反白圈容易被其他元素蓋住看不到，
  // 直接用文字講清楚點哪裡比較穩定），不再對這顆按鈕加反白圈
  if (step.key === "create") {
    showView("calendar");
  }
}

// 使用者實際打開某筆預約的詳情彈窗時，如果那筆正好是導覽追蹤的那筆、目前步驟又需要點某個按鈕，就順手把那顆按鈕圈起來
function tour2MaybeSpotlightModalAction(bookingId) {
  if (!tour2Active || bookingId !== tour2BookingId) return;
  const step = TOUR2_STEPS[tour2Idx];
  const actionMap = { edit: "edit", confirm: "confirm", collect: "collect", cancel: "cancel" };
  const action = step && actionMap[step.key];
  if (!action) return;
  requestAnimationFrame(() => {
    // 手機版詳情彈窗（#booking-detail-actions）跟桌面版時間軸的小選單（.agenda-action-menu）是兩套不同的畫面，都要找
    const btn = document.querySelector(`#booking-detail-actions [data-action="${action}"], .agenda-action-menu [data-action="${action}"]`);
    if (btn) { tourSpotlightOn(btn, "tour-spotlight-live"); tour2SpotlightTarget = btn; }
  });
}

function startTour2() {
  tour2Active = true;
  tour2Idx = 0;
  tour2BookingId = null;
  tour2CustomerName = "";
  tour2PanelEl = document.createElement("div");
  tour2PanelEl.className = "tour-tooltip tour2-panel";
  document.body.appendChild(tour2PanelEl);
  window.tourOnBookingCreated = (bookingId, name) => {
    if (!tour2Active || tour2Idx !== 1) return;
    tour2BookingId = bookingId;
    tour2CustomerName = name;
    tour2Idx = 2;
    tour2Render();
  };
  window.tourOnBookingUpdated = (bookingId) => {
    if (!tour2Active || tour2Idx !== 2 || bookingId !== tour2BookingId) return;
    tour2Idx = 3;
    tour2Render();
  };
  window.tourOnStatusChanged = (bookingId, status) => {
    if (!tour2Active || bookingId !== tour2BookingId) return;
    if (tour2Idx === 3 && status === "confirmed") { tour2Idx = 4; tour2Render(); return; }
    if (tour2Idx === 5 && status === "cancelled") { tour2Idx = 6; tour2Render(); return; }
  };
  window.tourOnPaymentCollected = (bookingId) => {
    if (!tour2Active || tour2Idx !== 4 || bookingId !== tour2BookingId) return;
    tour2Idx = 5;
    tour2Render();
  };
  tour2Render();
}
function endTour2() {
  tour2Active = false;
  tour2Cleanup();
  window.tourOnBookingCreated = null;
  window.tourOnBookingUpdated = null;
  window.tourOnStatusChanged = null;
  window.tourOnPaymentCollected = null;
  if (tour2PanelEl) { tour2PanelEl.remove(); tour2PanelEl = null; }
  tour2Idx = -1;
}
// 「教學導覽」下拉選單：把所有教學集合在同一顆按鈕底下，點了展開選單，選哪個就跑哪個
(function wireTourMenu() {
  const menuBtn = document.getElementById("tour-menu-btn");
  const menu = document.getElementById("tour-menu");
  if (!menuBtn || !menu) return;
  const TOUR_RUNNERS = {
    basic: () => startTour(TOUR_STEPS),
    booking: () => startTour2(),
    customers: () => startTour(TOUR_CUSTOMERS_STEPS),
    revenue: () => startTour(TOUR_REVENUE_STEPS),
  };
  menuBtn.setAttribute("aria-haspopup", "true");
  menuBtn.setAttribute("aria-expanded", "false");
  menuBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
    menuBtn.setAttribute("aria-expanded", String(!menu.hidden));
  });
  menu.querySelectorAll("[data-tour]").forEach((btn) => {
    btn.addEventListener("click", () => {
      menu.hidden = true;
      menuBtn.setAttribute("aria-expanded", "false");
      const run = TOUR_RUNNERS[btn.dataset.tour];
      if (run) run();
    });
  });
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== menuBtn) {
      menu.hidden = true;
      menuBtn.setAttribute("aria-expanded", "false");
    }
  });
})();

/* ============================================================
   啟動
   ============================================================ */
buildMessage();
loadAll();
