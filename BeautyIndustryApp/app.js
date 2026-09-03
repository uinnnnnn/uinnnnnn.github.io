"use strict";
/* ============================================================
   小工作室預約本（純本機版）
   ------------------------------------------------------------
   沒有任何後端、沒有網路連線需求，所有資料只存在這台裝置、這個瀏覽器的
   localStorage 裡。換裝置、換瀏覽器、清除瀏覽器資料都會讓資料消失，
   所以「設定」頁裡有「備份與還原」，建議定期匯出備份檔存起來。
   ============================================================ */

const DB_KEY = "biStudioLiteData_v1";
const STATUSES = ["pending", "confirmed", "deposit", "paidFull", "cancelled", "noshow"];
const STATUS_LABEL = { pending: "待確認", confirmed: "已確認", deposit: "已付訂", paidFull: "已收全額", rescheduled: "改期", cancelled: "已取消", noshow: "未到店" };
const REVENUE_STATUSES = ["confirmed", "deposit", "paidFull"];
const TAG_LABEL = { new: "新客", regular: "熟客", vip: "VIP" };
const PAYMENT_METHODS = ["現金", "轉帳", "信用卡", "LINE Pay", "其他"];
const CANCEL_REASONS = ["客人取消", "店家取消", "改期", "其他"];
const WEEKDAY_LABEL = ["日", "一", "二", "三", "四", "五", "六"];

/* ============================================================
   手機主畫面圖示（apple-touch-icon）
   全部存在本機 localStorage，沒有網址長度限制，但還是壓縮到合理大小，
   避免佔用太多 localStorage 空間。
   ============================================================ */
const DEFAULT_APPLE_ICON_HREF = document.getElementById("apple-touch-icon-link").getAttribute("href");
const APP_ICON_BASE64_BUDGET = 60000;
function applyAppIcon(dataUrl) {
  const link = document.getElementById("apple-touch-icon-link");
  if (link) link.setAttribute("href", dataUrl || DEFAULT_APPLE_ICON_HREF);
}
function processIconFile(file) {
  return new Promise((resolve, reject) => {
    if (!file.type || !file.type.startsWith("image/")) { reject(new Error("請選擇圖片檔案")); return; }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("讀取圖片失敗，請換一張再試"));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("這個檔案看起來不是有效的圖片"));
      img.onload = () => {
        const sizes = [180, 140, 110, 90];
        const qualities = [0.85, 0.7, 0.55, 0.4, 0.25];
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        for (const size of sizes) {
          const canvas = document.createElement("canvas");
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext("2d");
          ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size); // 置中裁切成正方形，避免變形
          for (const q of qualities) {
            const dataUrl = canvas.toDataURL("image/jpeg", q);
            const base64Len = dataUrl.length - (dataUrl.indexOf(",") + 1);
            if (base64Len <= APP_ICON_BASE64_BUDGET) { resolve(dataUrl); return; }
          }
        }
        reject(new Error("這張圖片壓縮後還是太大，請換一張比較簡單／檔案較小的圖片再試一次"));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

/* ---------------- 資料層：全部存在 localStorage ---------------- */
function defaultData() {
  return {
    settings: {
      shopName: "我的工作室",
      hoursStart: "10:00",
      hoursEnd: "20:00",
      closedWeekdays: "",
      specialHolidays: "",
      appIconDataUrl: "",
      themeColor: "",
      pinEnabled: false,
      pinCode: "",
      theme: "light",
    },
    services: [],
    customers: [],
    bookings: [],
  };
}
let DB = loadDB();
function loadDB() {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (!raw) return defaultData();
    const parsed = JSON.parse(raw);
    return Object.assign(defaultData(), parsed, {
      settings: Object.assign(defaultData().settings, parsed.settings || {}),
    });
  } catch (err) {
    console.error("讀取本機資料失敗，改用空白資料", err);
    return defaultData();
  }
}
function saveDB() {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(DB));
  } catch (err) {
    showToast("儲存失敗，可能是瀏覽器儲存空間已滿", true);
  }
}
function nextId(prefix, list) {
  let max = 0;
  list.forEach((it) => {
    const n = parseInt(String(it.id).replace(prefix, ""), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return prefix + String(max + 1).padStart(4, "0");
}

/* ---------------- 共用小工具 ---------------- */
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function money(n) {
  return "NT$" + Math.round(Number(n) || 0).toLocaleString("zh-Hant");
}
// 金額類欄位一律不能是負數（今日金額、其他加項、儲值金、初始儲值金…）
function nonNeg(v) {
  return Math.max(0, Number(v) || 0);
}
function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
// 兩個時段是否重疊；沒有填結束時間的當作只佔用 1 分鐘，這樣兩筆都沒填結束時間、
// 開始時間又剛好一樣時，還是能判斷出「同時段」
function timeRangesOverlap(aStart, aEnd, bStart, bEnd) {
  const aS = timeToMinutes(aStart), bS = timeToMinutes(bStart);
  const aE = aEnd ? timeToMinutes(aEnd) : aS + 1;
  const bE = bEnd ? timeToMinutes(bEnd) : bS + 1;
  return aS < bE && bS < aE;
}
// 找出同一天、同一時段已經重疊的其他預約（不算已取消的，也不算自己這筆正在編輯的）
function findBookingConflict(date, startTime, endTime, excludeId) {
  return DB.bookings.find((b) =>
    b.id !== excludeId && b.date === date && b.status !== "cancelled" &&
    timeRangesOverlap(startTime, endTime, b.startTime, b.endTime)
  );
}

/* ============================================================
   服務項目選擇器（新增預約 / 結算共用）
   5 項以內用可複選的標籤，方便一眼看到全部；超過 5 項改用可捲動的勾選清單——
   單純點一下就切換勾選，不用像原生下拉選單那樣要按著 Ctrl/Cmd 才能多選
   ============================================================ */
function svcPickerHtml(pickerId, selectedNames) {
  const services = DB.services.filter((s) => s.active !== false);
  if (!services.length) return `<p class="empty">尚未設定服務項目，請先到「設定」新增</p>`;
  if (services.length > 5) {
    const rows = services.map((s) => {
      const on = selectedNames.includes(s.name);
      return `<label class="svc-check-row"><input type="checkbox" data-name="${escapeHtml(s.name)}" data-price="${s.price}" data-duration="${s.durationMin || 0}" ${on ? "checked" : ""}><span>${escapeHtml(s.name)}（${money(s.price)}）</span></label>`;
    }).join("");
    return `<div class="svc-checklist" id="${pickerId}">${rows}</div>`;
  }
  const chips = services.map((s) => {
    const on = selectedNames.includes(s.name);
    return `<button type="button" class="svc-chip ${on ? "on" : ""}" data-id="${s.id}" data-name="${escapeHtml(s.name)}" data-price="${s.price}" data-duration="${s.durationMin || 0}">${escapeHtml(s.name)}（${money(s.price)}）</button>`;
  }).join("");
  return `<div class="svc-picker" id="${pickerId}">${chips}</div>`;
}
function getSelectedServices(pickerId) {
  const el = document.getElementById(pickerId);
  if (!el) return [];
  if (el.classList.contains("svc-checklist")) {
    return Array.from(el.querySelectorAll("input:checked")).map((cb) => ({
      name: cb.dataset.name, price: Number(cb.dataset.price) || 0, duration: Number(cb.dataset.duration) || 0,
    }));
  }
  return Array.from(el.querySelectorAll(".svc-chip.on")).map((c) => ({
    name: c.dataset.name, price: Number(c.dataset.price) || 0, duration: Number(c.dataset.duration) || 0,
  }));
}
function wireSvcPicker(pickerId, onChange) {
  const el = document.getElementById(pickerId);
  if (!el) return;
  if (el.classList.contains("svc-checklist")) {
    el.addEventListener("change", onChange);
  } else {
    el.querySelectorAll(".svc-chip").forEach((chip) => chip.addEventListener("click", () => { chip.classList.toggle("on"); onChange(); }));
  }
}
function fmtDate(d) {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, "0"), day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function todayStr() { return fmtDate(new Date()); }
function niceDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAY_LABEL[d.getDay()]}）`;
}
function mmddWithWeekday(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const [yyyy, mm, dd] = dateStr.split("-");
  return `${yyyy.slice(2)}/${mm}/${dd} (${WEEKDAY_LABEL[d.getDay()]})`;
}
function isClosedWeekday(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const closed = String(DB.settings.closedWeekdays || "").split(",").filter(Boolean);
  return closed.includes(String(d.getDay()));
}
function parseHolidays(raw) {
  return String(raw || "").split(",").map((s) => s.trim()).filter(Boolean).map((entry) => {
    const [start, end] = entry.split("~");
    return { start, end: end || "" };
  });
}
function formatHolidays(list) {
  return list.map((h) => (h.end ? `${h.start}~${h.end}` : h.start)).join(",");
}
function isSpecialHoliday(dateStr) {
  return parseHolidays(DB.settings.specialHolidays).some((h) => (h.end ? (dateStr >= h.start && dateStr <= h.end) : dateStr === h.start));
}
function isClosedDate(dateStr) {
  return isClosedWeekday(dateStr) || isSpecialHoliday(dateStr);
}
function customerById(id) { return DB.customers.find((c) => c.id === id); }
function serviceById(id) { return DB.services.find((s) => s.id === id); }
// 客戶目前儲值金：新增客戶時填的「初始儲值金」（例如從舊系統搬過來的既有餘額）
// ＋ 之後所有「非取消」預約的（本次儲值金額－使用儲值金）加總，永遠是即時對得起來的數字，
// 不用另外存一份、也不用擔心哪裡忘記同步。
function storedValueBalance(customerId) {
  const c = customerById(customerId);
  const initial = c ? (Number(c.initialStoredValue) || 0) : 0;
  return initial + DB.bookings
    .filter((b) => b.customerId === customerId && b.status !== "cancelled")
    .reduce((s, b) => s + (Number(b.storedValueAmount) || 0) - (Number(b.storedValueUsed) || 0), 0);
}
function bookingsOnDate(dateStr) {
  return DB.bookings.filter((b) => b.date === dateStr).sort((a, b) => a.startTime.localeCompare(b.startTime));
}
// 當天預約的滿載程度：公休日（灰）、完全沒約＝可預約（綠）、還有空檔＝有預約（橘）、營業時間內每個時段都被佔滿＝已滿約（紅）
function dayLoadClass(dateStr) {
  if (isClosedDate(dateStr)) return "day-closed";
  const items = bookingsOnDate(dateStr).filter((b) => b.status !== "cancelled");
  if (!items.length) return "day-free";
  const start = parseInt(String(DB.settings.hoursStart || "10:00").split(":")[0], 10);
  const end = parseInt(String(DB.settings.hoursEnd || "20:00").split(":")[0], 10);
  const totalSlots = Math.max(end - start, 0);
  const bookedHours = new Set(items.map((b) => parseInt(String(b.startTime).split(":")[0], 10)));
  return totalSlots > 0 && bookedHours.size >= totalSlots ? "day-full" : "day-busy";
}
function buildCalendarHtml(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  const firstOfMonth = new Date(y, m - 1, 1);
  const gridStart = new Date(firstOfMonth.getTime() - firstOfMonth.getDay() * 86400000);
  const today = todayStr();
  const hasSelection = !!(state.blFrom || state.blTo);
  const head = WEEKDAY_LABEL.map((w) => `<div class="cal-weekday">${w}</div>`).join("");
  let cells = "";
  for (let i = 0; i < 42; i++) {
    const dt = new Date(gridStart.getTime() + i * 86400000);
    const dateStr = fmtDate(dt);
    const isOtherMonth = dt.getMonth() !== m - 1;
    const loadClass = dayLoadClass(dateStr);
    const isSelected = hasSelection && (!state.blFrom || dateStr >= state.blFrom) && (!state.blTo || dateStr <= state.blTo);
    const isToday = dateStr === today;
    cells += `<button type="button" class="cal-cell ${loadClass} ${isOtherMonth ? "other-month" : ""} ${isToday ? "today" : ""} ${isSelected ? "selected" : ""}" data-cal-date="${dateStr}">${isToday ? "今天" : dt.getDate()}</button>`;
  }
  return `
    <div class="card">
      <div class="cal-head">
        <button type="button" class="icon-btn" id="cal-prev">‹</button>
        <div class="cal-label">${y}年${m}月</div>
        <button type="button" class="icon-btn" id="cal-next">›</button>
      </div>
      <div class="cal-grid">${head}${cells}</div>
      <button type="button" class="btn ghost sm block" id="cal-today-btn" style="margin-top:10px;">回到今天</button>
      <div class="cal-legend">
        <span><i class="free"></i>可預約</span>
        <span><i class="busy"></i>有預約</span>
        <span><i class="full"></i>已滿約</span>
        <span><i class="closed"></i>公休</span>
      </div>
    </div>`;
}

/* ---------------- Toast / Confirm ---------------- */
let toastTimer = null;
function showToast(msg, isErr) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.toggle("err", !!isErr);
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
}
function showConfirm(message, opts) {
  opts = opts || {};
  return new Promise((resolve) => {
    const backdrop = document.getElementById("confirm-backdrop");
    const box = document.getElementById("confirm-box");
    box.innerHTML = `
      <p>${escapeHtml(message)}</p>
      <div class="btn-row">
        <button class="btn ghost" id="confirm-cancel">${escapeHtml(opts.cancelText || "取消")}</button>
        <button class="btn ${opts.danger ? "danger" : ""}" id="confirm-ok">${escapeHtml(opts.okText || "確定")}</button>
      </div>`;
    backdrop.classList.add("show");
    function finish(v) {
      backdrop.classList.remove("show");
      backdrop.removeEventListener("click", onBackdrop);
      resolve(v);
    }
    function onBackdrop(e) { if (e.target === backdrop) finish(false); }
    document.getElementById("confirm-ok").addEventListener("click", () => finish(true));
    document.getElementById("confirm-cancel").addEventListener("click", () => finish(false));
    backdrop.addEventListener("click", onBackdrop);
  });
}

/* ---------------- Sheet（底部彈出視窗）共用開關 ---------------- */
const sheetBackdrop = document.getElementById("sheet-backdrop");
const sheetBody = document.getElementById("sheet-body");
function openSheet(html) {
  sheetBody.innerHTML = `<button class="sheet-close" id="sheet-close-btn" aria-label="關閉">✕</button><div class="sheet-handle"></div>${html}`;
  sheetBackdrop.classList.add("show");
  document.getElementById("sheet-close-btn").addEventListener("click", closeSheet);
}
function closeSheet() {
  sheetBackdrop.classList.remove("show");
  // 「填寫預約資料」那一步關掉表單時，浮動導覽面板是被隱藏的（説明改插在表單裡），
  // 如果使用者沒填完就直接關掉表單，要把面板還原，導覽才不會卡住不見
  if (tour2PanelEl && tour2PanelEl.style.display === "none") tour2PanelEl.style.display = "";
}
sheetBackdrop.addEventListener("click", (e) => { if (e.target === sheetBackdrop) closeSheet(); });

/* ---------------- 圖示（極簡手繪 SVG，無外部依賴） ---------------- */
const ICONS = {
  dash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></svg>`,
  bookings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="17" rx="3"/><path d="M8 2v4M16 2v4M3 10h18"/></svg>`,
  customers: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="8" r="3.3"/><path d="M3.5 20c.8-3.4 3-5.2 5.5-5.2s4.7 1.8 5.5 5.2"/><circle cx="17.5" cy="8.5" r="2.5"/><path d="M15.8 14.3c2.1.2 3.9 1.8 4.6 4.9"/></svg>`,
  report: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20V10M11 20V4M18 20v-7"/></svg>`,
  settings: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 13a7.6 7.6 0 0 0 0-2l2-1.5-2-3.4-2.3.8a7.7 7.7 0 0 0-1.8-1L15 3.6h-4l-.3 2.3a7.7 7.7 0 0 0-1.8 1l-2.3-.8-2 3.4L6.6 11a7.6 7.6 0 0 0 0 2l-2 1.5 2 3.4 2.3-.8a7.7 7.7 0 0 0 1.8 1l.3 2.4h4l.3-2.3a7.7 7.7 0 0 0 1.8-1l2.3.8 2-3.4z"/></svg>`,
  sun: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.5M12 19.5V22M4.2 4.2l1.8 1.8M18 18l1.8 1.8M2 12h2.5M19.5 12H22M4.2 19.8 6 18M18 6l1.8-1.8"/></svg>`,
  moon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a6.8 6.8 0 0 0 10.5 10.5z"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12.5 9.5 18 20 5.5"/></svg>`,
  cash: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9v0M18 15v0"/></svg>`,
};

/* ============================================================
   路由 / 分頁
   ============================================================ */
const TABS = [
  { key: "dash", label: "今日" },
  { key: "bookings", label: "預約" },
  { key: "customers", label: "客戶" },
  { key: "report", label: "報表" },
  { key: "settings", label: "設定" },
];
let state = {
  view: "dash",
  blStatus: "all",
  blSearch: "",
  blFrom: "",
  blTo: "",
  calMonth: fmtDate(new Date()).slice(0, 7),
  custSearch: "",
  custTag: "all",
  reportMonth: fmtDate(new Date()).slice(0, 7),
  reportCategory: "all",
};

function initTabbar() {
  const bar = document.querySelector(".tabbar");
  bar.innerHTML = TABS.map((t) => `<button class="tab-btn" data-view="${t.key}">${ICONS[t.key]}<span>${t.label}</span></button>`).join("");
  bar.querySelectorAll(".tab-btn").forEach((btn) => btn.addEventListener("click", () => showView(btn.dataset.view)));
}
function showView(view) {
  state.view = view;
  document.querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  document.getElementById("fab-add").classList.toggle("hidden", view !== "bookings" && view !== "dash");
  const titles = { dash: ["今日總覽", ""], bookings: ["預約清單", ""], customers: ["客戶管理", ""], report: ["營收報表", ""], settings: ["設定", ""] };
  document.getElementById("page-title").textContent = titles[view][0];
  document.getElementById("page-sub").textContent = DB.settings.shopName || "";
  renderView();
}
function renderView() {
  const main = document.getElementById("main");
  if (state.view === "dash") main.innerHTML = renderDash();
  else if (state.view === "bookings") main.innerHTML = renderBookings();
  else if (state.view === "customers") main.innerHTML = renderCustomers();
  else if (state.view === "report") main.innerHTML = renderReport();
  else if (state.view === "settings") main.innerHTML = renderSettings();
  wireView();
}

/* ============================================================
   今日總覽
   ============================================================ */
function renderDash() {
  const today = todayStr();
  const tomorrow = fmtDate(new Date(Date.now() + 86400000));
  const list = bookingsOnDate(today).filter((b) => b.status !== "cancelled");
  const tomorrowList = bookingsOnDate(tomorrow).filter((b) => b.status !== "cancelled");
  const revenue = list.filter((b) => REVENUE_STATUSES.includes(b.status)).reduce((s, b) => s + (Number(b.price) || 0), 0);
  const pendingCount = list.filter((b) => b.status === "pending").length;
  const closedNote = isClosedDate(today) ? `<p class="hint warn">今天是設定裡的公休日</p>` : "";
  const tomorrowClosedNote = isClosedDate(tomorrow) ? `<p class="hint warn">明天是設定裡的公休日</p>` : "";
  const rows = list.length
    ? list.map(bookingRowHtml).join("")
    : `<p class="empty">今天還沒有預約</p>`;
  const tomorrowRows = tomorrowList.length
    ? tomorrowList.map(bookingRowHtml).join("")
    : `<p class="empty">明天還沒有預約</p>`;
  return `
    <div class="stat-grid">
      <div class="stat"><div class="label">今日預約</div><div class="value">${list.length}<small> 筆</small></div></div>
      <div class="stat"><div class="label">今日營收</div><div class="value">${money(revenue)}</div></div>
    </div>
    ${pendingCount ? `<p class="hint" style="margin:-6px 0 12px;">有 ${pendingCount} 筆待確認</p>` : ""}
    ${closedNote}
    <div class="card"><h2>${niceDate(today)} 的預約</h2>${rows}</div>
    <div class="card">
      <h2>明天・${niceDate(tomorrow)} 的預約</h2>
      ${tomorrowClosedNote}
      ${tomorrowRows}
    </div>
  `;
}
// 狀態標籤只負責「顯示現在是什麼狀態」，維持單純的資訊呈現（不可點、藥丸形）；
// 待確認／已確認／已付訂這幾個「還在進行中」的狀態，旁邊另外放一顆有文字的按鈕——
// 純圖示（例如只有一個打勾）容易被誤讀成「已經是這個狀態了」，跟「已收全額」旁邊那種純狀態勾號混淆，
// 所以直接寫「確認」「收款」兩個字，不用猜。方形（非藥丸）＋實心顏色＋文字，明確就是「按鈕」不是「標籤」。
// 顏色沿用「按下去之後會變成的狀態」的顏色（待確認→已確認是藍色、已確認/已付訂→已收全額是綠色）
// settle:true（今日總覽用）時，已確認／已付訂旁邊改放「結算」按鈕，開一個小視窗填實際金額、付款方式再結清；
// 一般預約清單維持原本的「收款」一鍵按鈕（直接照原本金額結清，不用另外填）
function bookingActionHtml(b, opts) {
  opts = opts || {};
  const pill = `<span class="status-pill ${b.status}">${STATUS_LABEL[b.status]}</span>`;
  if (b.status === "pending") {
    return `<div class="b-status">${pill}<button type="button" class="status-action confirm" data-quick-confirm="${b.id}" aria-label="標記為已確認">${ICONS.check}確認</button></div>`;
  }
  if (b.status === "confirmed" || b.status === "deposit") {
    if (opts.settle) {
      return `<div class="b-status">${pill}<button type="button" class="status-action paid" data-settle="${b.id}" aria-label="結算">${ICONS.cash}結算</button></div>`;
    }
    return `<div class="b-status">${pill}<button type="button" class="status-action paid" data-quick-paid="${b.id}" aria-label="標記為已收全額">${ICONS.cash}收款</button></div>`;
  }
  return pill;
}
function quickUpdateStatus(bookingId, newStatus) {
  const b = DB.bookings.find((x) => x.id === bookingId);
  if (!b) return;
  const wasPaidFull = b.status === "paidFull";
  b.status = newStatus;
  b.updatedAt = new Date().toISOString();
  if (!wasPaidFull && newStatus === "paidFull") bumpCustomerVisit(b.customerId, b.date, b.price);
  saveDB();
  showToast(newStatus === "confirmed" ? "已確認預約" : "已收全額");
  if (window.tourOnBookingUpdated) window.tourOnBookingUpdated(b.id, newStatus);
  renderView();
}
// 今日總覽的預約列——這裡不再點列就開編輯，只保留「確認」「結算」這兩個明確的操作按鈕
function bookingRowHtml(b) {
  return `
    <div class="b-row no-click">
      <div class="b-time">${b.startTime}<span>${b.endTime || ""}</span></div>
      <div class="b-main">
        <div class="name">${escapeHtml(b.customerName)}</div>
        <div class="svc">${escapeHtml(b.service)}</div>
      </div>
      ${bookingActionHtml(b, { settle: true })}
    </div>`;
}

/* ============================================================
   預約清單
   ============================================================ */
function filteredBookings() {
  const q = state.blSearch.trim();
  return DB.bookings
    .filter((b) => (state.blStatus === "all" ? true : b.status === state.blStatus))
    .filter((b) => (state.blFrom ? b.date >= state.blFrom : true))
    .filter((b) => (state.blTo ? b.date <= state.blTo : true))
    .filter((b) => (q ? b.customerName.includes(q) || String(b.phone).includes(q) : true))
    .sort((a, b) => (b.date + b.startTime).localeCompare(a.date + a.startTime));
}
function renderBookings() {
  const rows = filteredBookings();
  const statusChips = ["all", ...STATUSES].map((s) => `<button class="chip ${state.blStatus === s ? "on" : ""}" data-status="${s}">${s === "all" ? "全部" : STATUS_LABEL[s]}</button>`).join("");
  const list = rows.length
    ? rows.map((b) => `
        <div class="b-row" data-open-booking="${b.id}">
          <div class="b-time">${mmddWithWeekday(b.date)}<span>${b.startTime}</span></div>
          <div class="b-main">
            <div class="name">${escapeHtml(b.customerName)}</div>
            <div class="svc">${escapeHtml(b.service)}</div>
          </div>
          ${bookingActionHtml(b)}
        </div>`).join("")
    : `<p class="empty">沒有符合條件的預約</p>`;
  return `
    ${buildCalendarHtml(state.calMonth)}
    <input class="search-input" id="bl-search" placeholder="搜尋客戶姓名或電話…" value="${escapeHtml(state.blSearch)}">
    <div class="chip-row">${statusChips}</div>
    <div class="field-row" style="margin-bottom:12px;">
      <div class="field" style="margin-bottom:0;"><label>從</label><input type="date" id="bl-from" value="${state.blFrom}"></div>
      <div class="field" style="margin-bottom:0;"><label>到</label><input type="date" id="bl-to" value="${state.blTo}"></div>
    </div>
    <div class="card">${list}</div>
  `;
}

/* ============================================================
   新增／編輯預約（Sheet）
   ============================================================ */
function openBookingSheet(defaults, editingBooking) {
  const isEdit = !!editingBooking;
  const bookedNames = isEdit ? String(editingBooking.service || "").split("、").map((x) => x.trim()) : [];

  openSheet(`
    <h3>${isEdit ? "編輯預約" : "新增預約"}</h3>
    <div class="sub">${isEdit ? "修改後直接更新這筆預約" : "填寫客戶與服務資訊"}</div>
    <div class="btn-row" style="margin-bottom:12px;">
      <button type="button" class="btn ${!isEdit ? "" : "ghost"}" id="mode-existing" style="background:${'var(--accent)'};color:var(--accent-ink);">選擇既有客戶</button>
      <button type="button" class="btn ghost" id="mode-new">新增客戶</button>
    </div>
    <div id="cust-search-wrap">
      <input class="search-input" id="cust-search" placeholder="輸入姓名或電話搜尋既有客戶…">
      <div class="cust-results hidden" id="cust-results"></div>
    </div>
    <p class="hint" id="cust-balance-hint" hidden></p>
    <div class="field"><label>客戶姓名</label><input id="bk-name" value="${escapeHtml(isEdit ? editingBooking.customerName : "")}"></div>
    <div class="field"><label>電話</label><input id="bk-phone" value="${escapeHtml(isEdit ? editingBooking.phone : "")}"></div>
    <div class="field"><label>日期</label><input type="date" id="bk-date" value="${(isEdit ? editingBooking.date : defaults.date) || todayStr()}"></div>
    <div class="field-row">
      <div class="field"><label>開始時間</label><input type="time" id="bk-start" value="${(isEdit ? editingBooking.startTime : defaults.startTime) || "10:00"}"></div>
      <div class="field"><label>結束時間</label><input type="time" id="bk-end" value="${(isEdit ? editingBooking.endTime : "") || ""}"></div>
    </div>
    <p class="hint warn" id="bk-hours-hint" hidden></p>
    <div class="field"><label>服務項目（可複選）</label>${svcPickerHtml("svc-picker", bookedNames)}</div>
    <div class="field"><label>狀態</label>
      <select id="bk-status">${STATUSES.map((s) => `<option value="${s}" ${isEdit ? (editingBooking.status === s ? "selected" : "") : (s === "confirmed" ? "selected" : "")}>${STATUS_LABEL[s]}</option>`).join("")}</select>
    </div>
    <div class="field hidden" id="bk-cancel-wrap"><label>取消原因</label>
      <select id="bk-cancel-reason">${CANCEL_REASONS.map((r) => `<option ${isEdit && editingBooking.cancelReason === r ? "selected" : ""}>${r}</option>`).join("")}</select>
    </div>
    <div id="bk-payment-wrap" ${isEdit ? "" : "hidden"}>
      <div class="field"><label>付款方式</label>
        <select id="bk-payment">${PAYMENT_METHODS.map((m) => `<option ${isEdit && editingBooking.paymentMethod === m ? "selected" : ""}>${m}</option>`).join("")}</select>
      </div>
      <div class="field-row">
        <div class="field"><label>今日金額</label><input type="number" min="0" id="bk-today-amount" value="${isEdit ? (editingBooking.todayAmount || "") : ""}"></div>
        <div class="field"><label>其他加項</label><input type="number" min="0" id="bk-extra-amount" value="${isEdit ? (editingBooking.extraAmount || "") : ""}"></div>
      </div>
      <div class="field"><label>金額（今日＋加項－使用儲值金，自動算）</label><input type="number" min="0" id="bk-price" readonly></div>
      <div class="field-row">
        <div class="field"><label>本次儲值金額</label><input type="number" min="0" id="bk-stored-amount" value="${isEdit ? (editingBooking.storedValueAmount || "") : ""}"></div>
        <div class="field"><label>使用儲值金</label><input type="number" min="0" id="bk-stored-used" value="${isEdit ? (editingBooking.storedValueUsed || "") : ""}">
          <p class="hint" id="stored-used-hint"></p>
        </div>
      </div>
    </div>
    ${!isEdit ? `<p class="hint" style="margin:-6px 0 13px;">💡 金額、付款方式通常要等服務結束才知道，之後點開這筆預約按「編輯」就會出現，現在可以先不填。</p>` : ""}
    <div class="field"><label>備註</label><textarea id="bk-notes" rows="2">${escapeHtml(isEdit ? editingBooking.notes : "")}</textarea></div>
    <div class="btn-row">
      <button class="btn" id="bk-submit">${isEdit ? "儲存變更" : "建立預約"}</button>
    </div>
  `);

  let selectedCustomerId = isEdit ? (editingBooking.customerId || "") : "";
  let mode = "existing";
  const nameInput = document.getElementById("bk-name");
  const phoneInput = document.getElementById("bk-phone");
  const custSearchWrap = document.getElementById("cust-search-wrap");
  const custSearchInput = document.getElementById("cust-search");
  const custResultsEl = document.getElementById("cust-results");
  const balanceHintEl = document.getElementById("cust-balance-hint");
  const storedUsedHintEl = document.getElementById("stored-used-hint");
  const storedUsedInput = document.getElementById("bk-stored-used");
  const todayAmountInput = document.getElementById("bk-today-amount");
  const extraAmountInput = document.getElementById("bk-extra-amount");
  const storedAmountInput = document.getElementById("bk-stored-amount");
  const priceInput = document.getElementById("bk-price");
  const startInput = document.getElementById("bk-start");
  const endInput = document.getElementById("bk-end");
  const hoursHintEl = document.getElementById("bk-hours-hint");
  let endTouched = isEdit;

  // 只是提醒，不擋送出——填的時段超出「設定」裡的營業時間時，在時間欄位下面顯示一行提醒
  function checkHoursHint() {
    const hoursStart = DB.settings.hoursStart || "10:00";
    const hoursEnd = DB.settings.hoursEnd || "20:00";
    const s = startInput.value, e = endInput.value;
    const outOfHours = s && (s < hoursStart || s >= hoursEnd || (e && e > hoursEnd));
    hoursHintEl.hidden = !outOfHours;
    if (outOfHours) hoursHintEl.textContent = `⚠️ 這個時段超出營業時間（${hoursStart}–${hoursEnd}）了，確定要這樣約嗎？`;
  }
  startInput.addEventListener("input", checkHoursHint);
  endInput.addEventListener("input", checkHoursHint);
  checkHoursHint();

  function setMode(m) {
    mode = m;
    document.getElementById("mode-existing").className = "btn " + (m === "existing" ? "" : "ghost");
    document.getElementById("mode-existing").style.cssText = m === "existing" ? "background:var(--accent);color:var(--accent-ink);" : "";
    document.getElementById("mode-new").className = "btn " + (m === "new" ? "" : "ghost");
    document.getElementById("mode-new").style.cssText = m === "new" ? "background:var(--accent);color:var(--accent-ink);" : "";
    custSearchWrap.classList.toggle("hidden", m !== "existing");
    if (m === "new") {
      selectedCustomerId = "";
      nameInput.value = "";
      phoneInput.value = "";
      nameInput.readOnly = false;
      phoneInput.readOnly = false;
    } else {
      nameInput.readOnly = true;
      phoneInput.readOnly = true;
    }
    updateStoredValueUI();
  }
  document.getElementById("mode-existing").addEventListener("click", () => setMode("existing"));
  document.getElementById("mode-new").addEventListener("click", () => setMode("new"));

  function renderCustResults() {
    const q = custSearchInput.value.trim();
    const list = DB.customers
      .filter((c) => !q || c.name.includes(q) || String(c.phone).includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"))
      .slice(0, 40);
    custResultsEl.innerHTML = list.length
      ? list.map((c) => `<div class="cust-item" data-id="${c.id}">${escapeHtml(c.name)}<small>${escapeHtml(c.phone)}</small></div>`).join("")
      : `<div class="cust-item">找不到符合的客戶</div>`;
    custResultsEl.classList.remove("hidden");
  }
  custSearchInput.addEventListener("focus", renderCustResults);
  custSearchInput.addEventListener("input", renderCustResults);
  custResultsEl.addEventListener("click", (e) => {
    const item = e.target.closest(".cust-item[data-id]");
    if (!item) return;
    const c = customerById(item.dataset.id);
    if (!c) return;
    selectedCustomerId = c.id;
    nameInput.value = c.name;
    phoneInput.value = c.phone;
    custSearchInput.value = `${c.name}（${c.phone}）`;
    custResultsEl.classList.add("hidden");
    updateStoredValueUI();
  });

  function availableStoredValue() {
    if (!selectedCustomerId) return 0;
    let bal = storedValueBalance(selectedCustomerId);
    if (isEdit && editingBooking.customerId === selectedCustomerId) bal += Number(editingBooking.storedValueUsed) || 0;
    return bal;
  }
  function updateStoredValueUI() {
    if (selectedCustomerId) {
      balanceHintEl.textContent = `目前儲值金：${money(storedValueBalance(selectedCustomerId)).replace(/^NT\$\s?/, "")}`;
      balanceHintEl.hidden = false;
    } else {
      balanceHintEl.hidden = true;
    }
    const cap = availableStoredValue();
    storedUsedHintEl.textContent = selectedCustomerId ? (cap > 0 ? `最多可使用 ${money(cap)}` : "此客戶目前沒有可用儲值金") : "";
    if (Number(storedUsedInput.value) < 0) storedUsedInput.value = "0";
    if (Number(storedUsedInput.value) > cap) {
      storedUsedInput.value = cap || "";
      showToast(`使用儲值金不能超過目前儲值金（${money(cap)}）`, true);
    }
    recomputePrice();
  }
  function recomputePrice() {
    // 今日金額、其他加項、儲值金相關欄位一律不能是負數，這裡統一夾到最小 0
    [todayAmountInput, extraAmountInput, storedAmountInput].forEach((el) => {
      if (Number(el.value) < 0) el.value = "0";
    });
    const used = nonNeg(storedUsedInput.value);
    priceInput.value = Math.max(0, nonNeg(todayAmountInput.value) + nonNeg(extraAmountInput.value) - used);
  }
  function selectedChips() { return getSelectedServices("svc-picker"); }
  function computeEndTime() {
    const totalDuration = selectedChips().reduce((s, c) => s + (Number(c.duration) || 0), 0);
    if (!totalDuration || !startInput.value) return "";
    const [h, m] = startInput.value.split(":").map(Number);
    const end = new Date(2000, 0, 1, h, m + totalDuration);
    return String(end.getHours()).padStart(2, "0") + ":" + String(end.getMinutes()).padStart(2, "0");
  }
  wireSvcPicker("svc-picker", () => {
    const chips = selectedChips();
    if (chips.length) {
      todayAmountInput.value = chips.reduce((s, c) => s + (Number(c.price) || 0), 0);
    }
    if (!endTouched) endInput.value = computeEndTime();
    recomputePrice();
    checkHoursHint();
  });
  todayAmountInput.addEventListener("input", recomputePrice);
  extraAmountInput.addEventListener("input", recomputePrice);
  storedAmountInput.addEventListener("input", recomputePrice);
  storedUsedInput.addEventListener("input", updateStoredValueUI);
  startInput.addEventListener("change", () => { if (!endTouched) endInput.value = computeEndTime(); checkHoursHint(); });
  endInput.addEventListener("input", () => { endTouched = true; });
  nameInput.addEventListener("input", () => { selectedCustomerId = ""; updateStoredValueUI(); });
  phoneInput.addEventListener("input", () => { selectedCustomerId = ""; updateStoredValueUI(); });

  const statusSelect = document.getElementById("bk-status");
  statusSelect.addEventListener("change", () => {
    document.getElementById("bk-cancel-wrap").classList.toggle("hidden", statusSelect.value !== "cancelled");
  });
  statusSelect.dispatchEvent(new Event("change"));

  if (isEdit && editingBooking.customerId) {
    const c = customerById(editingBooking.customerId);
    if (c) custSearchInput.value = `${c.name}（${c.phone}）`;
    nameInput.readOnly = true;
    phoneInput.readOnly = true;
  } else if (isEdit) {
    setMode("new");
  } else {
    // 新增預約預設就是「選擇既有客戶」模式，姓名/電話要鎖住（readonly）才符合畫面上顯示的狀態，
    // 不然使用者會以為可以直接打字，其實應該用上面的搜尋框選人
    nameInput.readOnly = true;
    phoneInput.readOnly = true;
  }
  recomputePrice();
  updateStoredValueUI();

  document.getElementById("bk-submit").addEventListener("click", () => {
    const name = nameInput.value.trim();
    const phone = phoneInput.value.trim();
    const date = document.getElementById("bk-date").value;
    const startTime = startInput.value;
    const endTime = endInput.value;
    const chips = selectedChips();
    const service = chips.length ? chips.map((c) => c.name).join("、") : (isEdit ? editingBooking.service : "");
    if (!name || !phone || !date || !startTime) { showToast("請填寫客戶姓名、電話、日期與時間", true); return; }
    if (!service) { showToast("請至少選擇一項服務項目", true); return; }
    if (endTime && endTime <= startTime) { showToast("結束時間必須晚於開始時間", true); return; }
    const conflict = findBookingConflict(date, startTime, endTime, isEdit ? editingBooking.id : null);
    if (conflict) { showToast(`這個時段跟「${conflict.customerName}」${conflict.startTime}${conflict.endTime ? "–" + conflict.endTime : ""}的預約重疊了，請改一下時間`, true); return; }
    // 「新增預約操作教學」的②這步一定要是「待確認」＋今天，不然後面「確認」按鈕不會出現、
    // 「結算」那步在「今日」總覽也會找不到這筆，與其等使用者卡住才發現，不如送出前先擋下來提醒
    if (!isEdit && tour2Active && tour2Idx === 2) {
      if (statusSelect.value !== "pending") { showToast("教學這步「狀態」要選「待確認」，才能示範下一步的確認動作", true); return; }
      if (date !== todayStr()) { showToast("教學這步「日期」要保持今天，才能在「今日」總覽找到這筆示範預約", true); return; }
    }

    const storedValueUsed = nonNeg(storedUsedInput.value);
    if (storedValueUsed > availableStoredValue()) {
      showToast(`使用儲值金不能超過目前儲值金（${money(availableStoredValue())}）`, true);
      return;
    }

    let customerId = selectedCustomerId;
    if (!customerId) {
      const existingByPhone = DB.customers.find((c) => c.phone === phone);
      if (existingByPhone) {
        customerId = existingByPhone.id;
        existingByPhone.name = name;
      } else {
        customerId = nextId("C", DB.customers);
        DB.customers.push({ id: customerId, name, phone, tag: "new", firstVisit: "", lastVisit: "", visitCount: 0, totalSpend: 0, notes: "", contact: "", birthday: "" });
      }
    } else {
      const c = customerById(customerId);
      if (c) { c.name = name; c.phone = phone; }
    }

    const status = statusSelect.value;
    const cancelReason = status === "cancelled" ? document.getElementById("bk-cancel-reason").value : "";
    const price = nonNeg(priceInput.value);
    const now = new Date().toISOString();

    if (isEdit) {
      const wasPaidFull = editingBooking.status === "paidFull";
      Object.assign(editingBooking, {
        customerId, customerName: name, phone, date, startTime, endTime, service, status, cancelReason, price,
        paymentMethod: document.getElementById("bk-payment").value,
        todayAmount: nonNeg(todayAmountInput.value),
        extraAmount: nonNeg(extraAmountInput.value),
        storedValueAmount: nonNeg(storedAmountInput.value),
        storedValueUsed,
        notes: document.getElementById("bk-notes").value.trim(),
        updatedAt: now,
      });
      if (!wasPaidFull && status === "paidFull") bumpCustomerVisit(customerId, date, price);
      showToast("已更新預約");
      if (window.tourOnBookingUpdated) window.tourOnBookingUpdated(editingBooking.id, status);
    } else {
      const booking = {
        id: nextId("B", DB.bookings), customerId, customerName: name, phone, date, startTime, endTime, service, status, cancelReason, price,
        paymentMethod: document.getElementById("bk-payment").value,
        todayAmount: nonNeg(todayAmountInput.value),
        extraAmount: nonNeg(extraAmountInput.value),
        storedValueAmount: nonNeg(storedAmountInput.value),
        storedValueUsed,
        notes: document.getElementById("bk-notes").value.trim(),
        createdAt: now, updatedAt: now,
      };
      DB.bookings.push(booking);
      if (status === "paidFull") bumpCustomerVisit(customerId, date, price);
      showToast("已建立預約");
      // 新增後直接跳轉到這一天，讓使用者在日曆／清單馬上看到剛建立的這筆，不用自己找日期、也不會被舊的狀態篩選擋住
      state.calMonth = date.slice(0, 7);
      state.blFrom = date;
      state.blTo = date;
      state.blStatus = "all";
      if (window.tourOnBookingCreated) window.tourOnBookingCreated(booking.id, name);
    }
    saveDB();
    closeSheet();
    if (!isEdit) showView("bookings"); else renderView();
  });
}
function bumpCustomerVisit(customerId, date, amount) {
  const c = customerById(customerId);
  if (!c) return;
  c.visitCount = (Number(c.visitCount) || 0) + 1;
  c.totalSpend = (Number(c.totalSpend) || 0) + amount;
  if (!c.firstVisit) c.firstVisit = date;
  c.lastVisit = date;
  if (c.tag === "new" && c.visitCount >= 2) c.tag = "regular";
  if (c.visitCount >= 15) c.tag = "vip";
}

/* ============================================================
   結算（今日總覽的「結算」按鈕）——比完整編輯表單更輕量的收款小視窗，
   只顯示客戶資訊跟金額欄位，填完按「確認結算」直接把這筆變成已收全額
   ============================================================ */
function openSettlementSheet(booking, prefill) {
  const b = booking;
  // prefill：從「複製 LINE 訊息」畫面按返回時，帶回使用者剛剛還沒存檔就填好的內容，
  // 不然一去 LINE 訊息畫面、只能按 X 關掉整張表單，剛剛填的東西就全部不見了
  const f = prefill || {};
  const bookedNames = f.serviceNames || String(b.service || "").split("、").map((x) => x.trim());
  // 這筆本來就有填過的儲值金使用，加回去才是「目前真的可以用」的上限（跟完整編輯表單同一套邏輯）
  const cap = storedValueBalance(b.customerId) + nonNeg(b.storedValueUsed);
  // 欄位順序：客戶資訊 → 服務項目 → 付款方式 → 今日金額/其他加項 → 儲值金額（倒數第三）→ 總金額（倒數第二）→ 備註（最後）
  openSheet(`
    <h3>結算</h3>
    <div class="sub">${niceDate(b.date)} ${b.startTime}${b.endTime ? "–" + b.endTime : ""}</div>
    <div class="card">
      <div class="kv"><span class="k">客戶姓名</span><span>${escapeHtml(b.customerName)}</span></div>
      <div class="kv"><span class="k">電話</span><span>${escapeHtml(b.phone)}</span></div>
      <div class="kv"><span class="k">目前儲值金</span><span>${money(storedValueBalance(b.customerId))}</span></div>
    </div>
    <div class="field"><label>服務項目（可複選）</label>${svcPickerHtml("st-svc-picker", bookedNames)}</div>
    <div class="field"><label>付款方式</label>
      <select id="st-payment">${PAYMENT_METHODS.map((m) => `<option ${(f.paymentMethod || b.paymentMethod) === m ? "selected" : ""}>${m}</option>`).join("")}</select>
    </div>
    <div class="field-row">
      <div class="field"><label>今日金額</label><input type="number" min="0" id="st-today-amount" value="${f.todayAmount != null ? f.todayAmount : (b.todayAmount || "")}"></div>
      <div class="field"><label>其他加項</label><input type="number" min="0" id="st-extra-amount" value="${f.extraAmount != null ? f.extraAmount : (b.extraAmount || "")}"></div>
    </div>
    <div class="field-row">
      <div class="field"><label>本次儲值金額</label><input type="number" min="0" id="st-stored-amount" value="${f.storedValueAmount != null ? f.storedValueAmount : (b.storedValueAmount || "")}"></div>
      <div class="field"><label>使用儲值金</label><input type="number" min="0" id="st-stored-used" value="${f.storedValueUsed != null ? f.storedValueUsed : (b.storedValueUsed || "")}">
        <p class="hint" id="st-stored-hint"></p>
      </div>
    </div>
    <div class="field"><label>總金額（今日＋加項－使用儲值金，自動算）</label><input type="number" min="0" id="st-price" readonly></div>
    <div class="field"><label>備註</label><textarea id="st-notes" rows="2">${escapeHtml(f.notes != null ? f.notes : (b.notes || ""))}</textarea></div>
    <div class="btn-row">
      <button class="btn ghost" id="st-line-btn" type="button">複製 LINE 訊息</button>
      <button class="btn" id="st-submit">確認結算</button>
    </div>
  `);
  const todayEl = document.getElementById("st-today-amount");
  const extraEl = document.getElementById("st-extra-amount");
  const storedAmountEl = document.getElementById("st-stored-amount");
  const storedUsedEl = document.getElementById("st-stored-used");
  const priceEl = document.getElementById("st-price");
  const hintEl = document.getElementById("st-stored-hint");
  function selectedChips() { return getSelectedServices("st-svc-picker"); }
  function recompute() {
    [todayEl, extraEl, storedAmountEl].forEach((el) => { if (Number(el.value) < 0) el.value = "0"; });
    if (Number(storedUsedEl.value) < 0) storedUsedEl.value = "0";
    if (Number(storedUsedEl.value) > cap) {
      storedUsedEl.value = cap || "";
      showToast(`使用儲值金不能超過目前儲值金（${money(cap)}）`, true);
    }
    hintEl.textContent = cap > 0 ? `最多可使用 ${money(cap)}` : "此客戶目前沒有可用儲值金";
    const used = nonNeg(storedUsedEl.value);
    priceEl.value = Math.max(0, nonNeg(todayEl.value) + nonNeg(extraEl.value) - used);
  }
  wireSvcPicker("st-svc-picker", () => {
    const chips = selectedChips();
    if (chips.length) todayEl.value = chips.reduce((s, c) => s + (Number(c.price) || 0), 0);
    recompute();
  });
  [todayEl, extraEl, storedAmountEl, storedUsedEl].forEach((el) => el.addEventListener("input", recompute));
  recompute();
  document.getElementById("st-line-btn").addEventListener("click", () => {
    const chips = selectedChips();
    const serviceNames = chips.length ? chips.map((c) => c.name) : bookedNames;
    const service = serviceNames.join("、");
    // 訊息要反映「現在表單上填的內容」，不是還沒存檔的舊資料；儲值金餘額也要先扣舊的、加新的，
    // 才是這次結算完成後客戶實際會有的餘額（這時候都還沒按「確認結算」，DB 裡還是舊值）
    const oldAmt = nonNeg(b.storedValueAmount), oldUsed = nonNeg(b.storedValueUsed);
    const newAmt = nonNeg(storedAmountEl.value), newUsed = nonNeg(storedUsedEl.value);
    const previewBalance = storedValueBalance(b.customerId) - oldAmt + oldUsed + newAmt - newUsed;
    const snapshot = Object.assign({}, b, {
      service,
      price: nonNeg(priceEl.value),
      storedValueUsed: newUsed,
      storedValueAmount: newAmt,
    });
    // 把現在表單上填的內容整包記住，按「返回結算」才能原封不動帶回去，不會像關掉表單一樣全部重填
    const prefillSnapshot = {
      serviceNames,
      paymentMethod: document.getElementById("st-payment").value,
      todayAmount: todayEl.value,
      extraAmount: extraEl.value,
      storedValueAmount: storedAmountEl.value,
      storedValueUsed: storedUsedEl.value,
      notes: document.getElementById("st-notes").value,
    };
    openLineMessageSheet(snapshot, "receipt", previewBalance, () => openSettlementSheet(b, prefillSnapshot));
    if (window.tourOnLineOpened) window.tourOnLineOpened();
  });
  document.getElementById("st-submit").addEventListener("click", () => {
    const wasPaidFull = b.status === "paidFull";
    const chips = selectedChips();
    const service = chips.length ? chips.map((c) => c.name).join("、") : b.service;
    Object.assign(b, {
      service,
      status: "paidFull",
      paymentMethod: document.getElementById("st-payment").value,
      todayAmount: nonNeg(todayEl.value),
      extraAmount: nonNeg(extraEl.value),
      storedValueAmount: nonNeg(storedAmountEl.value),
      storedValueUsed: nonNeg(storedUsedEl.value),
      price: nonNeg(priceEl.value),
      notes: document.getElementById("st-notes").value.trim(),
      updatedAt: new Date().toISOString(),
    });
    if (!wasPaidFull) bumpCustomerVisit(b.customerId, b.date, b.price);
    saveDB();
    closeSheet();
    showToast("已結算");
    if (window.tourOnBookingUpdated) window.tourOnBookingUpdated(b.id, "paidFull");
    renderView();
  });
}

/* ---------------- 預約詳情（唯讀摘要 + 開啟編輯 / 傳訊息） ---------------- */
function openBookingDetail(bookingId) {
  const b = DB.bookings.find((x) => x.id === bookingId);
  if (!b) return;
  openSheet(`
    <h3>${escapeHtml(b.customerName)}</h3>
    <div class="sub">${niceDate(b.date)} ${b.startTime}${b.endTime ? "–" + b.endTime : ""}</div>
    <div class="card">
      <div class="kv"><span class="k">服務項目</span><span>${escapeHtml(b.service)}</span></div>
      <div class="kv"><span class="k">電話</span><span>${escapeHtml(b.phone)}</span></div>
      <div class="kv"><span class="k">狀態</span><span class="status-pill ${b.status}">${STATUS_LABEL[b.status]}</span></div>
      <div class="kv"><span class="k">金額</span><span>${money(b.price)}</span></div>
      ${b.notes ? `<div class="kv"><span class="k">備註</span><span>${escapeHtml(b.notes)}</span></div>` : ""}
    </div>
    <div class="btn-row">
      <button class="btn ghost" id="detail-line-btn">複製 LINE 訊息</button>
      <button class="btn" id="detail-edit-btn">編輯</button>
    </div>
  `);
  document.getElementById("detail-edit-btn").addEventListener("click", () => openBookingSheet({}, b));
  document.getElementById("detail-line-btn").addEventListener("click", () => openLineMessageSheet(b, undefined, undefined, () => openBookingDetail(b.id)));
}
function openLineMessageSheet(b, defaultTpl, balanceOverride, onBack) {
  defaultTpl = defaultTpl && ["confirm", "reminder", "followup", "receipt"].includes(defaultTpl) ? defaultTpl : "confirm";
  const shop = DB.settings.shopName || "我們";
  // 消費明細：這次做了什麼、總金額、這次用了多少儲值金、這次儲值了多少、目前還剩多少儲值金——
  // 儲值金相關的兩行只有「這次真的有用到」才顯示，沒用到就不用列出來，訊息比較乾淨
  const receiptLines = [`${b.customerName} 您好😊 這是您這次的消費明細：`, ``, `服務項目：${b.service}`, `總金額：${money(b.price)}`];
  if (nonNeg(b.storedValueUsed) > 0) receiptLines.push(`本次使用儲值金：${money(b.storedValueUsed)}`);
  if (nonNeg(b.storedValueAmount) > 0) receiptLines.push(`本次儲值金額：${money(b.storedValueAmount)}`);
  const currentBalance = typeof balanceOverride === "number" ? balanceOverride : storedValueBalance(b.customerId);
  receiptLines.push(`目前儲值金餘額：${money(currentBalance)}`);
  receiptLines.push(``, `感謝您的支持與愛護💕 —${shop}`);
  const templates = {
    confirm: `${b.customerName} 您好😊\n已為您預約成功！\n\n📅 時間：${niceDate(b.date)} ${b.startTime}\n💅 項目：${b.service}\n\n若時間需要調整，請提前告知，謝謝您的預約🙏`,
    reminder: `${b.customerName} 您好，提醒您的預約唷～\n\n📅 時間：${niceDate(b.date)} ${b.startTime}\n💅 項目：${b.service}\n\n請於時間前 5-10 分鐘到店即可，期待與您見面✨`,
    followup: `${b.customerName} 您好，感謝您蒞臨體驗「${b.service}」🌸\n如果對這次的服務滿意，歡迎再次預約，也歡迎分享給朋友唷！\n祝您有美好的一天💕 —${shop}`,
    receipt: receiptLines.join("\n"),
  };
  openSheet(`
    ${onBack ? `<button type="button" class="btn ghost" id="line-back-btn" style="margin-bottom:12px;">‹ 返回</button>` : ""}
    <h3>LINE 訊息範本</h3>
    <div class="sub">點選文字即可複製，貼到 LINE 傳給客人</div>
    <div class="chip-row">
      <button class="chip ${defaultTpl === "confirm" ? "on" : ""}" data-tpl="confirm">預約確認</button>
      <button class="chip ${defaultTpl === "reminder" ? "on" : ""}" data-tpl="reminder">前一天提醒</button>
      <button class="chip ${defaultTpl === "followup" ? "on" : ""}" data-tpl="followup">服務後感謝</button>
      <button class="chip ${defaultTpl === "receipt" ? "on" : ""}" data-tpl="receipt">消費明細</button>
    </div>
    <textarea id="line-text" rows="8" style="width:100%;padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--surface);color:var(--ink);font-size:13.5px;">${escapeHtml(templates[defaultTpl])}</textarea>
    <button class="btn block" id="line-copy-btn" style="margin-top:12px;">複製訊息</button>
  `);
  if (onBack) document.getElementById("line-back-btn").addEventListener("click", () => {
    // 順序很重要：要先讓 onBack() 把結算視窗的內容重新畫出來，教學提示才能插到「新」畫面上，
    // 不然提示會插到舊的 LINE 訊息畫面，下一秒又被整個換掉
    onBack();
    if (window.tourOnLineBack) window.tourOnLineBack();
  });
  const textarea = document.getElementById("line-text");
  document.querySelectorAll("[data-tpl]").forEach((chip) => {
    chip.addEventListener("click", () => {
      document.querySelectorAll("[data-tpl]").forEach((c) => c.classList.remove("on"));
      chip.classList.add("on");
      textarea.value = templates[chip.dataset.tpl];
    });
  });
  document.getElementById("line-copy-btn").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(textarea.value);
      showToast("已複製，貼到 LINE 傳送即可");
    } catch (err) {
      textarea.select();
      showToast("請手動選取文字後複製", true);
    }
  });
}

/* ============================================================
   客戶管理
   ============================================================ */
function renderCustomers() {
  const q = state.custSearch.trim();
  const list = DB.customers
    .filter((c) => (state.custTag === "all" ? true : c.tag === state.custTag))
    .filter((c) => (q ? c.name.includes(q) || String(c.phone).includes(q) : true))
    .sort((a, b) => a.name.localeCompare(b.name, "zh-Hant"));
  const tagChips = ["all", "new", "regular", "vip"].map((t) => `<button class="chip ${state.custTag === t ? "on" : ""}" data-tag="${t}">${t === "all" ? "全部" : TAG_LABEL[t]}</button>`).join("");
  const rows = list.length
    ? list.map((c) => {
      const balance = storedValueBalance(c.id);
      return `
        <div class="b-row" data-open-customer="${c.id}">
          <div class="b-main">
            <div class="name">${escapeHtml(c.name)}</div>
            <div class="svc">${escapeHtml(c.phone)} · 到店 ${c.visitCount || 0} 次${balance > 0 ? ` · 儲值 ${money(balance)}` : ""}</div>
          </div>
          <span class="tag-pill ${c.tag}">${TAG_LABEL[c.tag] || c.tag}</span>
        </div>`;
    }).join("")
    : `<p class="empty">沒有符合條件的客戶</p>`;
  return `
    <input class="search-input" id="cust-list-search" placeholder="搜尋姓名或電話…" value="${escapeHtml(state.custSearch)}">
    <div class="chip-row">${tagChips}</div>
    <div class="card">${rows}</div>
    <button class="btn block ghost" id="add-customer-btn">＋ 手動新增客戶</button>
  `;
}
function openCustomerDetail(customerId) {
  const c = customerById(customerId);
  if (!c) return;
  const balance = storedValueBalance(customerId);
  const history = DB.bookings.filter((b) => b.customerId === customerId).sort((a, b) => b.date.localeCompare(a.date));
  openSheet(`
    <h3>${escapeHtml(c.name)}</h3>
    <div class="sub">${escapeHtml(c.phone)}</div>
    <div class="card">
      <div class="kv"><span class="k">標籤</span><span class="tag-pill ${c.tag}">${TAG_LABEL[c.tag] || c.tag}</span></div>
      <div class="kv"><span class="k">到店次數</span><span>${c.visitCount || 0} 次</span></div>
      <div class="kv"><span class="k">累計消費</span><span>${money(c.totalSpend)}</span></div>
      <div class="kv"><span class="k">目前儲值金</span><span>${money(balance)}</span></div>
      ${c.contact ? `<div class="kv"><span class="k">LINE/IG</span><span>${escapeHtml(c.contact)}</span></div>` : ""}
      ${c.notes ? `<div class="kv"><span class="k">備註</span><span>${escapeHtml(c.notes)}</span></div>` : ""}
    </div>
    <div class="btn-row" style="margin-bottom:14px;">
      <button class="btn ghost" id="cust-edit-btn">編輯資料</button>
      <button class="btn danger" id="cust-delete-btn">刪除客戶</button>
    </div>
    <div class="card">
      <h2>預約紀錄</h2>
      ${history.length ? history.map((b) => `
        <div class="kv"><span class="k">${niceDate(b.date)}・${escapeHtml(b.service)}</span><span class="status-pill ${b.status}">${STATUS_LABEL[b.status]}</span></div>
      `).join("") : `<p class="empty">尚無預約紀錄</p>`}
    </div>
  `);
  document.getElementById("cust-edit-btn").addEventListener("click", () => openCustomerEditSheet(c));
  document.getElementById("cust-delete-btn").addEventListener("click", async () => {
    const hasBookings = DB.bookings.some((b) => b.customerId === customerId);
    if (hasBookings) { showToast("這位客戶還有預約紀錄，不能刪除", true); return; }
    if (!(await showConfirm(`確定要刪除客戶「${c.name}」嗎？`, { danger: true, okText: "刪除" }))) return;
    DB.customers = DB.customers.filter((x) => x.id !== customerId);
    saveDB();
    closeSheet();
    renderView();
    showToast("已刪除客戶");
  });
}
function openCustomerEditSheet(existing) {
  const isEdit = !!existing;
  openSheet(`
    <h3>${isEdit ? "編輯客戶" : "新增客戶"}</h3>
    <div class="field"><label>姓名</label><input id="c-name" value="${escapeHtml(isEdit ? existing.name : "")}"></div>
    <div class="field"><label>電話</label><input id="c-phone" value="${escapeHtml(isEdit ? existing.phone : "")}"></div>
    <div class="field"><label>LINE / IG（選填）</label><input id="c-contact" value="${escapeHtml(isEdit ? existing.contact || "" : "")}"></div>
    <div class="field"><label>生日（選填）</label><input type="date" id="c-birthday" value="${isEdit ? existing.birthday || "" : ""}"></div>
    <div class="field"><label>標籤</label>
      <select id="c-tag">${Object.keys(TAG_LABEL).map((t) => `<option value="${t}" ${isEdit && existing.tag === t ? "selected" : ""}>${TAG_LABEL[t]}</option>`).join("")}</select>
    </div>
    ${!isEdit ? `<div class="field"><label>初始儲值金（選填）</label><input type="number" min="0" id="c-initial-stored" placeholder="0"><p class="hint">例如從舊紀錄搬過來的既有儲值餘額，沒有的話留空即可</p></div>` : ""}
    <div class="field"><label>備註</label><textarea id="c-notes" rows="2">${escapeHtml(isEdit ? existing.notes || "" : "")}</textarea></div>
    <button class="btn block" id="c-save-btn">儲存</button>
  `);
  const initialStoredInput = document.getElementById("c-initial-stored");
  if (initialStoredInput) initialStoredInput.addEventListener("input", () => {
    if (Number(initialStoredInput.value) < 0) initialStoredInput.value = "0";
  });
  document.getElementById("c-save-btn").addEventListener("click", () => {
    const name = document.getElementById("c-name").value.trim();
    const phone = document.getElementById("c-phone").value.trim();
    if (!name || !phone) { showToast("請填寫姓名與電話", true); return; }
    if (isEdit) {
      Object.assign(existing, {
        name, phone,
        contact: document.getElementById("c-contact").value.trim(),
        birthday: document.getElementById("c-birthday").value,
        tag: document.getElementById("c-tag").value,
        notes: document.getElementById("c-notes").value.trim(),
      });
      DB.bookings.forEach((b) => { if (b.customerId === existing.id) { b.customerName = name; b.phone = phone; } });
    } else {
      DB.customers.push({
        id: nextId("C", DB.customers), name, phone,
        contact: document.getElementById("c-contact").value.trim(),
        birthday: document.getElementById("c-birthday").value,
        tag: document.getElementById("c-tag").value,
        notes: document.getElementById("c-notes").value.trim(),
        initialStoredValue: nonNeg(document.getElementById("c-initial-stored").value),
        firstVisit: "", lastVisit: "", visitCount: 0, totalSpend: 0,
      });
    }
    saveDB();
    closeSheet();
    renderView();
    showToast("已儲存");
  });
}

/* ============================================================
   營收報表
   ============================================================ */
function computeMonthStats(monthPrefix) {
  const monthBookings = DB.bookings.filter((b) => b.date.slice(0, 7) === monthPrefix);
  const revenueBookings = monthBookings.filter((b) => REVENUE_STATUSES.includes(b.status));
  const revenue = revenueBookings.reduce((s, b) => s + (Number(b.price) || 0), 0);
  const topUp = revenueBookings.reduce((s, b) => s + (Number(b.storedValueAmount) || 0), 0);
  const cancelCount = monthBookings.filter((b) => b.status === "cancelled").length;
  const noShowCount = monthBookings.filter((b) => b.status === "noshow").length;
  const avgTicket = revenueBookings.length ? Math.round(revenue / revenueBookings.length) : 0;
  const uniqueCustomers = new Set(revenueBookings.map((b) => b.customerId));
  const apptCount = monthBookings.filter((b) => b.status !== "cancelled").length;
  const paidFullCount = monthBookings.filter((b) => b.status === "paidFull").length;
  return { apptCount, paidFullCount, doneCount: revenueBookings.length, cancelCount, noShowCount, revenue, topUp, avgTicket, uniqueCustomerCount: uniqueCustomers.size };
}
// 回客率：全部客戶裡，累計有 2 次（含）以上實際消費的比例——跟客戶的長期關係有關，所以不分月份、算全部歷史資料
function computeRepeatRate() {
  const byCustomer = {};
  DB.bookings.filter((b) => REVENUE_STATUSES.includes(b.status)).forEach((b) => {
    byCustomer[b.customerId] = (byCustomer[b.customerId] || 0) + 1;
  });
  const repeatCount = Object.values(byCustomer).filter((n) => n >= 2).length;
  return DB.customers.length ? Math.round((repeatCount / DB.customers.length) * 100) : 0;
}
// 各類服務營收佔比：一筆預約如果同時選了好幾項服務，營收金額平均分攤給每個項目所屬的分類（或服務項目）
const DONUT_COLORS = ["#7c9473", "#c69a3a", "#d98a6b", "#c0604f", "#6b8fa3", "#9a7bc4", "#4f9e8f", "#b3789a"];
function computeServiceRevenueBreakdown(monthPrefix) {
  const revenueBookings = DB.bookings.filter((b) => b.date.slice(0, 7) === monthPrefix && REVENUE_STATUSES.includes(b.status));
  const totals = {};
  revenueBookings.forEach((b) => {
    const names = String(b.service || "").split("、").map((s) => s.trim()).filter(Boolean);
    const price = Number(b.price) || 0;
    if (!names.length) { totals["其他"] = (totals["其他"] || 0) + price; return; }
    const share = price / names.length;
    names.forEach((name) => {
      const svc = DB.services.find((s) => s.name === name);
      const cat = (svc && svc.category) || "未分類";
      totals[cat] = (totals[cat] || 0) + share;
    });
  });
  const total = Object.values(totals).reduce((s, v) => s + v, 0);
  return Object.entries(totals)
    .map(([category, amount]) => ({ category, amount, pct: total ? (amount / total) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount);
}
// 指定分類裡，各服務項目自己的營收佔比（只挑屬於這個分類的項目分攤金額）
function computeServiceRevenueByCategory(monthPrefix, category) {
  const revenueBookings = DB.bookings.filter((b) => b.date.slice(0, 7) === monthPrefix && REVENUE_STATUSES.includes(b.status));
  const totals = {};
  revenueBookings.forEach((b) => {
    const names = String(b.service || "").split("、").map((s) => s.trim()).filter(Boolean);
    if (!names.length) return;
    const share = (Number(b.price) || 0) / names.length;
    names.forEach((name) => {
      const svc = DB.services.find((s) => s.name === name);
      const cat = (svc && svc.category) || "未分類";
      if (cat !== category) return;
      totals[name] = (totals[name] || 0) + share;
    });
  });
  const total = Object.values(totals).reduce((s, v) => s + v, 0);
  return Object.entries(totals)
    .map(([service, amount]) => ({ service, amount, pct: total ? (amount / total) * 100 : 0 }))
    .sort((a, b) => b.amount - a.amount);
}
let reportChartInstance = null;
function renderDonutChart() {
  const canvas = document.getElementById("report-donut-canvas");
  if (!canvas) return;
  if (reportChartInstance) { reportChartInstance.destroy(); reportChartInstance = null; }
  const month = state.reportMonth;
  const isDark = DB.settings.theme === "dark";
  const rows = state.reportCategory === "all"
    ? computeServiceRevenueBreakdown(month).map((r) => ({ label: r.category, amount: r.amount }))
    : computeServiceRevenueByCategory(month, state.reportCategory).map((r) => ({ label: r.service, amount: r.amount }));
  if (!rows.length) return;
  reportChartInstance = new Chart(canvas, {
    type: "doughnut",
    data: {
      labels: rows.map((r) => r.label),
      datasets: [{
        data: rows.map((r) => Math.round(r.amount)),
        backgroundColor: rows.map((_, i) => DONUT_COLORS[i % DONUT_COLORS.length]),
        borderColor: isDark ? "#2a2824" : "#ffffff",
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: "bottom", labels: { color: isDark ? "#f1ede4" : "#33312c", boxWidth: 11, padding: 12, font: { size: 12 } } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const total = ctx.dataset.data.reduce((s, v) => s + v, 0);
              const pct = total ? Math.round((ctx.parsed / total) * 100) : 0;
              return `${ctx.label}：${money(ctx.parsed)}（${pct}%）`;
            },
          },
        },
      },
    },
  });
}
function renderReport() {
  const month = state.reportMonth;
  const stats = computeMonthStats(month);
  const [y, m] = month.split("-").map(Number);
  const prevMonth = new Date(y, m - 2, 1);
  const prevStats = computeMonthStats(fmtDate(prevMonth).slice(0, 7));
  const diff = stats.revenue - prevStats.revenue;
  const diffLabel = diff === 0 ? "與上月持平" : (diff > 0 ? `比上月多 ${money(diff)}` : `比上月少 ${money(-diff)}`);
  const repeatRate = computeRepeatRate();
  const breakdown = computeServiceRevenueBreakdown(month);
  const categories = breakdown.map((r) => r.category);
  if (state.reportCategory !== "all" && !categories.includes(state.reportCategory)) state.reportCategory = "all";
  const catOptions = `<option value="all" ${state.reportCategory === "all" ? "selected" : ""}>全部分類（各分類佔比）</option>`
    + categories.map((c) => `<option value="${escapeHtml(c)}" ${state.reportCategory === c ? "selected" : ""}>指定分類：${escapeHtml(c)}</option>`).join("");
  const hasChartData = state.reportCategory === "all"
    ? breakdown.length > 0
    : computeServiceRevenueByCategory(month, state.reportCategory).length > 0;
  const donutHtml = hasChartData
    ? `<div class="donut-wrap"><canvas id="report-donut-canvas"></canvas></div>`
    : `<p class="empty">本月還沒有已收款的預約，尚無法統計</p>`;

  return `
    <div class="field"><label>選擇月份</label><input type="month" id="report-month" value="${month}"></div>
    <div class="stat-grid">
      <div class="stat"><div class="label">本月營收</div><div class="value">${money(stats.revenue)}</div></div>
      <div class="stat"><div class="label">與上月比較</div><div class="value" style="font-size:14px;">${diffLabel}</div></div>
      <div class="stat"><div class="label">預約 / 已收全款</div><div class="value">${stats.apptCount}/${stats.paidFullCount}<small> 筆</small></div></div>
      <div class="stat"><div class="label">平均客單價</div><div class="value">${money(stats.avgTicket)}</div></div>
      <div class="stat"><div class="label">回客率</div><div class="value">${repeatRate}<small> %</small></div></div>
      <div class="stat"><div class="label">取消 / 未到店</div><div class="value">${stats.cancelCount}/${stats.noShowCount}<small> 筆</small></div></div>
    </div>
    <div class="card">
      <h2>各類服務營收佔比</h2>
      <div class="field"><label>檢視範圍</label><select id="report-cat-select">${catOptions}</select></div>
      ${donutHtml}
    </div>
  `;
}

/* ============================================================
   設定
   ============================================================ */
function renderSettings() {
  const s = DB.settings;
  const closedSet = new Set(String(s.closedWeekdays || "").split(",").filter(Boolean));
  const holidayList = parseHolidays(s.specialHolidays);
  const holidayRows = holidayList.length
    ? holidayList.map((h, i) => `
        <div class="b-row">
          <div class="b-main"><div class="name">${h.end ? `${escapeHtml(h.start)} ～ ${escapeHtml(h.end)}` : escapeHtml(h.start)}</div></div>
          <button type="button" class="btn ghost sm" data-del-holiday="${i}">刪除</button>
        </div>`).join("")
    : `<p class="empty">尚未設定特別公休日</p>`;
  const svcRows = DB.services.length
    ? DB.services.map((sv) => `
        <div class="b-row" data-edit-service="${sv.id}">
          <div class="b-main">
            <div class="name">${escapeHtml(sv.name)}${sv.active === false ? "（停用）" : ""}</div>
            <div class="svc">${escapeHtml(sv.category || "未分類")} · ${money(sv.price)}${sv.durationMin ? `・${sv.durationMin}分` : ""}</div>
          </div>
        </div>`).join("")
    : `<p class="empty">尚未新增服務項目</p>`;
  return `
    <div class="card">
      <h2>工作室資訊</h2>
      <div class="field"><label>工作室名稱</label><input id="s-shop-name" value="${escapeHtml(s.shopName)}"></div>
      <div class="field-row">
        <div class="field"><label>營業開始</label><input type="time" id="s-hours-start" value="${s.hoursStart}"></div>
        <div class="field"><label>營業結束</label><input type="time" id="s-hours-end" value="${s.hoursEnd}"></div>
      </div>
      <div class="field"><label>固定公休日</label>
        <div class="chip-row" id="s-weekday-picker">
          ${WEEKDAY_LABEL.map((label, i) => `<button type="button" class="chip ${closedSet.has(String(i)) ? "on" : ""}" data-day="${i}">週${label}</button>`).join("")}
        </div>
      </div>
      <div class="field">
        <label>手機主畫面圖示</label>
        <p class="hint" style="margin-bottom:10px;">用手機瀏覽器開啟本頁後點「加入主畫面」，顯示的圖示可以換成自己的 Logo（會自動壓縮成適合的大小）</p>
        <div class="app-icon-row">
          <img id="s-icon-preview" class="app-icon-preview" alt="目前圖示預覽" src="${escapeHtml(s.appIconDataUrl || DEFAULT_APPLE_ICON_HREF)}">
          <div class="app-icon-actions">
            <label class="btn ghost sm" for="s-icon-file">選擇圖片</label>
            <input type="file" id="s-icon-file" accept="image/*" hidden>
            <button class="btn sm" id="s-icon-save" disabled>儲存新圖示</button>
            <button class="btn ghost sm" id="s-icon-reset">還原預設圖示</button>
          </div>
        </div>
        <p class="hint" id="s-icon-hint" style="margin-top:8px;"></p>
      </div>
      <div class="field">
        <label>主題顏色</label>
        <div class="theme-color-row">
          <input type="color" id="s-theme-color" value="${s.themeColor || DEFAULT_THEME_COLOR}">
          <button class="btn ghost sm" id="s-theme-color-reset">還原預設顏色</button>
        </div>
      </div>
      <button class="btn block" id="s-save-shop-btn">儲存</button>
    </div>

    <div class="card">
      <h2>特別公休日</h2>
      <p class="hint" style="margin-bottom:10px;">單日只填開始日期即可；連續多天請同時填開始與結束日期</p>
      <div class="field-row">
        <div class="field"><label>開始日期</label><input type="date" id="s-holiday-start"></div>
        <div class="field"><label>結束日期（選填）</label><input type="date" id="s-holiday-end"></div>
      </div>
      <button class="btn block ghost" id="s-holiday-add" style="margin-bottom:10px;">＋ 新增公休日</button>
      ${holidayRows}
    </div>

    <div class="card">
      <h2>服務項目</h2>
      ${svcRows}
      <button class="btn block ghost" id="s-add-service-btn" style="margin-top:10px;">＋ 新增服務項目</button>
    </div>

    <div class="card">
      <h2>PIN 碼鎖定</h2>
      <label class="field-checkbox"><input type="checkbox" id="s-pin-enabled" ${s.pinEnabled ? "checked" : ""}> 開啟後每次打開都要輸入 4 碼 PIN</label>
      <div class="field" id="s-pin-set-wrap" style="margin-top:10px;${s.pinEnabled ? "" : "display:none;"}">
        <label>設定 4 碼 PIN</label>
        <input inputmode="numeric" maxlength="4" id="s-pin-code" placeholder="＊＊＊＊" value="${s.pinCode || ""}">
      </div>
      <button class="btn block" id="s-save-pin-btn" style="margin-top:10px;">儲存 PIN 設定</button>
    </div>

    <div class="card">
      <h2>教學導覽</h2>
      <p class="hint" style="margin-bottom:10px;">忘記怎麼操作的話，隨時可以回來這裡重看一次。</p>
      <div class="btn-row">
        <button class="btn ghost" id="s-tour-basic-btn">新手教學導覽</button>
        <button class="btn ghost" id="s-tour-booking-btn">新增預約操作教學</button>
      </div>
    </div>

    <div class="card">
      <h2>資料備份與還原</h2>
      <p class="hint">所有資料只存在這台裝置的瀏覽器裡，換裝置、換瀏覽器或清除瀏覽器資料都會遺失，請定期匯出備份檔保存。</p>
      <div class="btn-row" style="margin-top:10px;">
        <button class="btn ghost" id="s-export-btn">匯出備份檔</button>
        <button class="btn ghost" id="s-import-btn">還原備份檔</button>
      </div>
      <input type="file" id="s-import-file" accept="application/json" hidden>
    </div>
  `;
}
function openServiceEditSheet(existing) {
  const isEdit = !!existing;
  openSheet(`
    <h3>${isEdit ? "編輯服務項目" : "新增服務項目"}</h3>
    <div class="field"><label>名稱</label><input id="sv-name" value="${escapeHtml(isEdit ? existing.name : "")}"></div>
    <div class="field"><label>分類（選填）</label><input id="sv-category" value="${escapeHtml(isEdit ? existing.category || "" : "")}"></div>
    <div class="field-row">
      <div class="field"><label>價格</label><input type="number" id="sv-price" value="${isEdit ? existing.price : ""}"></div>
      <div class="field"><label>時長（分鐘）</label><input type="number" id="sv-duration" value="${isEdit ? existing.durationMin || "" : ""}"></div>
    </div>
    <label class="field-checkbox" style="margin-bottom:14px;"><input type="checkbox" id="sv-active" ${!isEdit || existing.active !== false ? "checked" : ""}> 啟用中</label>
    <div class="btn-row">
      ${isEdit ? `<button class="btn danger" id="sv-delete-btn">刪除</button>` : ""}
      <button class="btn" id="sv-save-btn">儲存</button>
    </div>
  `);
  document.getElementById("sv-save-btn").addEventListener("click", () => {
    const name = document.getElementById("sv-name").value.trim();
    if (!name) { showToast("請填寫服務名稱", true); return; }
    const fields = {
      name,
      category: document.getElementById("sv-category").value.trim(),
      price: Number(document.getElementById("sv-price").value) || 0,
      durationMin: Number(document.getElementById("sv-duration").value) || 0,
      active: document.getElementById("sv-active").checked,
    };
    if (isEdit) Object.assign(existing, fields);
    else DB.services.push(Object.assign({ id: nextId("S", DB.services) }, fields));
    saveDB();
    closeSheet();
    renderView();
    showToast("已儲存");
  });
  if (isEdit) {
    document.getElementById("sv-delete-btn").addEventListener("click", async () => {
      if (!(await showConfirm(`確定要刪除服務項目「${existing.name}」嗎？`, { danger: true, okText: "刪除" }))) return;
      DB.services = DB.services.filter((s) => s.id !== existing.id);
      saveDB();
      closeSheet();
      renderView();
      showToast("已刪除");
    });
  }
}
function exportBackup() {
  const blob = new Blob([JSON.stringify(DB, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const stamp = todayStr().replace(/-/g, "");
  a.href = url;
  a.download = `預約本備份_${stamp}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  showToast("已開始下載備份檔");
}
function importBackup(file) {
  const reader = new FileReader();
  reader.onload = async () => {
    try {
      const parsed = JSON.parse(reader.result);
      if (!parsed || typeof parsed !== "object") throw new Error("格式錯誤");
      if (!(await showConfirm("還原備份檔會覆蓋掉目前這台裝置上的所有資料，確定要繼續嗎？", { danger: true, okText: "還原" }))) return;
      DB = Object.assign(defaultData(), parsed, { settings: Object.assign(defaultData().settings, parsed.settings || {}) });
      saveDB();
      applyTheme();
      renderView();
      showToast("已還原備份");
    } catch (err) {
      showToast("這個檔案看起來不是有效的備份檔", true);
    }
  };
  reader.readAsText(file);
}

/* ============================================================
   畫面事件綁定（每次 renderView 後重新綁一次）
   ============================================================ */
function wireView() {
  document.querySelectorAll("[data-open-booking]").forEach((el) => el.addEventListener("click", () => openBookingDetail(el.dataset.openBooking)));
  document.querySelectorAll("[data-open-customer]").forEach((el) => el.addEventListener("click", () => openCustomerDetail(el.dataset.openCustomer)));
  document.querySelectorAll("[data-quick-confirm]").forEach((btn) => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    quickUpdateStatus(btn.dataset.quickConfirm, "confirmed");
  }));
  document.querySelectorAll("[data-quick-paid]").forEach((btn) => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    quickUpdateStatus(btn.dataset.quickPaid, "paidFull");
  }));
  document.querySelectorAll("[data-settle]").forEach((btn) => btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const b = DB.bookings.find((x) => x.id === btn.dataset.settle);
    if (b) openSettlementSheet(b);
    if (window.tourOnSettleOpened) window.tourOnSettleOpened(btn.dataset.settle);
  }));

  if (state.view === "bookings") {
    document.getElementById("bl-search").addEventListener("input", (e) => {
      state.blSearch = e.target.value;
      const pos = e.target.selectionStart;
      renderView();
      const el = document.getElementById("bl-search");
      if (el) { el.focus(); el.setSelectionRange(pos, pos); }
    });
    document.getElementById("bl-from").addEventListener("change", (e) => { state.blFrom = e.target.value; renderView(); });
    document.getElementById("bl-to").addEventListener("change", (e) => { state.blTo = e.target.value; renderView(); });
    document.querySelectorAll("[data-status]").forEach((chip) => chip.addEventListener("click", () => { state.blStatus = chip.dataset.status; renderView(); }));
    document.getElementById("cal-prev").addEventListener("click", () => {
      const [y, m] = state.calMonth.split("-").map(Number);
      const d = new Date(y, m - 2, 1);
      state.calMonth = fmtDate(d).slice(0, 7);
      renderView();
    });
    document.getElementById("cal-next").addEventListener("click", () => {
      const [y, m] = state.calMonth.split("-").map(Number);
      const d = new Date(y, m, 1);
      state.calMonth = fmtDate(d).slice(0, 7);
      renderView();
    });
    document.querySelectorAll("[data-cal-date]").forEach((cell) => {
      cell.addEventListener("click", () => {
        const d = cell.dataset.calDate;
        state.blFrom = d;
        state.blTo = d;
        renderView();
      });
    });
    document.getElementById("cal-today-btn").addEventListener("click", () => {
      const today = todayStr();
      state.calMonth = today.slice(0, 7);
      state.blFrom = today;
      state.blTo = today;
      renderView();
    });
  }
  if (state.view === "customers") {
    document.getElementById("cust-list-search").addEventListener("input", (e) => {
      state.custSearch = e.target.value;
      const pos = e.target.selectionStart;
      renderView();
      const el = document.getElementById("cust-list-search");
      if (el) { el.focus(); el.setSelectionRange(pos, pos); }
    });
    document.querySelectorAll("[data-tag]").forEach((chip) => chip.addEventListener("click", () => { state.custTag = chip.dataset.tag; renderView(); }));
    document.getElementById("add-customer-btn").addEventListener("click", () => openCustomerEditSheet(null));
  }
  if (state.view === "report") {
    document.getElementById("report-month").addEventListener("change", (e) => { state.reportMonth = e.target.value; renderView(); });
    const catSelect = document.getElementById("report-cat-select");
    if (catSelect) catSelect.addEventListener("change", (e) => { state.reportCategory = e.target.value; renderView(); });
    renderDonutChart();
  }
  if (state.view === "settings") {
    document.getElementById("s-save-shop-btn").addEventListener("click", () => {
      DB.settings.shopName = document.getElementById("s-shop-name").value.trim() || "我的工作室";
      DB.settings.hoursStart = document.getElementById("s-hours-start").value || "10:00";
      DB.settings.hoursEnd = document.getElementById("s-hours-end").value || "20:00";
      saveDB();
      showToast("已儲存");
      document.getElementById("page-sub").textContent = DB.settings.shopName;
    });
    document.querySelectorAll("#s-weekday-picker [data-day]").forEach((chip) => {
      chip.addEventListener("click", () => {
        chip.classList.toggle("on");
        const days = Array.from(document.querySelectorAll("#s-weekday-picker .chip.on")).map((c) => c.dataset.day);
        DB.settings.closedWeekdays = days.join(",");
        saveDB();
      });
    });
    document.getElementById("s-holiday-add").addEventListener("click", () => {
      const startEl = document.getElementById("s-holiday-start");
      const endEl = document.getElementById("s-holiday-end");
      const start = startEl.value;
      const end = endEl.value;
      if (!start) { showToast("請先選擇開始日期", true); return; }
      if (end && end < start) { showToast("結束日期不能早於開始日期", true); return; }
      const list = parseHolidays(DB.settings.specialHolidays);
      list.push({ start, end: end || "" });
      DB.settings.specialHolidays = formatHolidays(list);
      saveDB();
      showToast("已新增公休日");
      renderView();
    });
    document.querySelectorAll("[data-del-holiday]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const list = parseHolidays(DB.settings.specialHolidays);
        list.splice(Number(btn.dataset.delHoliday), 1);
        DB.settings.specialHolidays = formatHolidays(list);
        saveDB();
        showToast("已刪除公休日");
        renderView();
      });
    });
    document.querySelectorAll("[data-edit-service]").forEach((el) => el.addEventListener("click", () => openServiceEditSheet(serviceById(el.dataset.editService))));
    document.getElementById("s-add-service-btn").addEventListener("click", () => openServiceEditSheet(null));
    let pendingIconDataUrl = null;
    document.getElementById("s-icon-file").addEventListener("change", async (e) => {
      const file = e.target.files[0];
      const hint = document.getElementById("s-icon-hint");
      const saveBtn = document.getElementById("s-icon-save");
      if (!file) return;
      hint.textContent = "處理中…";
      saveBtn.disabled = true;
      pendingIconDataUrl = null;
      try {
        const dataUrl = await processIconFile(file);
        pendingIconDataUrl = dataUrl;
        document.getElementById("s-icon-preview").src = dataUrl;
        hint.textContent = "預覽如上，確定後請按「儲存新圖示」";
        saveBtn.disabled = false;
      } catch (err) {
        hint.textContent = err.message;
      }
    });
    document.getElementById("s-icon-save").addEventListener("click", () => {
      if (!pendingIconDataUrl) return;
      const dataUrl = pendingIconDataUrl;
      pendingIconDataUrl = null;
      DB.settings.appIconDataUrl = dataUrl;
      saveDB();
      applyAppIcon(dataUrl);
      document.getElementById("s-icon-save").disabled = true;
      document.getElementById("s-icon-hint").textContent = "已儲存，重新「加入主畫面」就會套用新圖示";
      showToast("已更新主畫面圖示");
    });
    document.getElementById("s-icon-reset").addEventListener("click", async () => {
      if (!(await showConfirm("要還原成預設圖示嗎？"))) return;
      DB.settings.appIconDataUrl = "";
      saveDB();
      applyAppIcon("");
      // 確認視窗開著的這段等待期間，理論上使用者不會、也點不到別的頁面（確認視窗蓋住了整個畫面），
      // 但保險起見還是先確認這幾個欄位還在畫面上，才不會因為頁面剛好被換掉而噴錯
      const preview = document.getElementById("s-icon-preview");
      const hintEl = document.getElementById("s-icon-hint");
      if (preview) preview.src = DEFAULT_APPLE_ICON_HREF;
      if (hintEl) hintEl.textContent = "已還原預設圖示，重新「加入主畫面」就會套用";
      showToast("已還原預設圖示");
    });
    document.getElementById("s-theme-color").addEventListener("input", (e) => applyThemeColor(e.target.value));
    document.getElementById("s-theme-color").addEventListener("change", (e) => {
      DB.settings.themeColor = e.target.value;
      saveDB();
      showToast("已更新主題顏色");
    });
    document.getElementById("s-theme-color-reset").addEventListener("click", () => {
      DB.settings.themeColor = "";
      saveDB();
      applyThemeColor("");
      document.getElementById("s-theme-color").value = DEFAULT_THEME_COLOR;
      showToast("已還原預設顏色");
    });
    document.getElementById("s-pin-enabled").addEventListener("change", (e) => {
      document.getElementById("s-pin-set-wrap").style.display = e.target.checked ? "" : "none";
    });
    document.getElementById("s-save-pin-btn").addEventListener("click", () => {
      const enabled = document.getElementById("s-pin-enabled").checked;
      const code = document.getElementById("s-pin-code").value.trim();
      if (enabled && !/^\d{4}$/.test(code)) { showToast("PIN 碼要是 4 位數字", true); return; }
      DB.settings.pinEnabled = enabled;
      DB.settings.pinCode = enabled ? code : "";
      saveDB();
      showToast("已儲存 PIN 設定");
    });
    document.getElementById("s-tour-basic-btn").addEventListener("click", () => startTour(TOUR_STEPS));
    document.getElementById("s-tour-booking-btn").addEventListener("click", () => startTour2());
    document.getElementById("s-export-btn").addEventListener("click", exportBackup);
    document.getElementById("s-import-btn").addEventListener("click", () => document.getElementById("s-import-file").click());
    document.getElementById("s-import-file").addEventListener("change", (e) => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ""; });
  }
}

/* ============================================================
   主題切換
   ============================================================ */
function setTheme(t) {
  DB.settings.theme = t;
  saveDB();
  applyTheme();
}
function applyTheme() {
  const t = DB.settings.theme === "dark" ? "dark" : "light";
  document.documentElement.setAttribute("data-theme", t);
  document.getElementById("theme-toggle-btn").innerHTML = t === "dark" ? ICONS.sun : ICONS.moon;
}
const DEFAULT_THEME_COLOR = "#7c9473";
function hexToRgb(hex) {
  hex = String(hex || "").replace("#", "");
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const num = parseInt(hex, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}
// 自訂主題顏色：直接改 CSS 變數（inline style 優先度比淺色/深色主題各自的設定都高，兩種模式都會套用）
function applyThemeColor(hex) {
  const root = document.documentElement;
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (!hex) {
    root.style.removeProperty("--accent");
    root.style.removeProperty("--accent-ink");
    root.style.removeProperty("--accent-soft");
    if (metaTheme) metaTheme.setAttribute("content", DEFAULT_THEME_COLOR);
    return;
  }
  const { r, g, b } = hexToRgb(hex);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  root.style.setProperty("--accent", hex);
  root.style.setProperty("--accent-ink", luminance > 0.6 ? "#26291f" : "#ffffff");
  root.style.setProperty("--accent-soft", `rgba(${r}, ${g}, ${b}, 0.16)`);
  if (metaTheme) metaTheme.setAttribute("content", hex);
}
document.getElementById("theme-toggle-btn").addEventListener("click", () => {
  setTheme(DB.settings.theme === "dark" ? "light" : "dark");
  if (state.view === "report") renderDonutChart();
});

/* ============================================================
   PIN 鎖定畫面
   ============================================================ */
function applyPinLock() {
  const screen = document.getElementById("pin-screen");
  if (!DB.settings.pinEnabled || !DB.settings.pinCode) { screen.classList.add("hidden"); return; }
  screen.classList.remove("hidden");
  let entered = "";
  const dotsEl = document.getElementById("pin-dots");
  const padEl = document.getElementById("pin-pad");
  function renderDots() {
    dotsEl.innerHTML = Array.from({ length: 4 }).map((_, i) => `<div class="pin-dot ${i < entered.length ? "filled" : ""}"></div>`).join("");
  }
  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0", "⌫"];
  padEl.innerHTML = keys.map((k) => k ? `<button class="pin-key ${k === "⌫" ? "wide" : ""}" data-key="${k}">${k}</button>` : `<div></div>`).join("");
  padEl.querySelectorAll("[data-key]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const k = btn.dataset.key;
      if (k === "⌫") { entered = entered.slice(0, -1); renderDots(); return; }
      if (entered.length >= 4) return;
      entered += k;
      renderDots();
      if (entered.length === 4) {
        if (entered === DB.settings.pinCode) {
          screen.classList.add("hidden");
        } else {
          showToast("PIN 碼錯誤", true);
          entered = "";
          setTimeout(renderDots, 200);
        }
      }
    });
  });
  document.getElementById("pin-forgot").onclick = async () => {
    if (await showConfirm("忘記 PIN 碼的話，只能直接關閉 PIN 鎖定功能（不會刪除任何預約/客戶資料），確定要關閉嗎？", { okText: "關閉PIN鎖定" })) {
      DB.settings.pinEnabled = false;
      DB.settings.pinCode = "";
      saveDB();
      screen.classList.add("hidden");
    }
  };
  renderDots();
}

document.getElementById("fab-add").addEventListener("click", () => {
  if (!DB.services.length) { showToast("請先到「設定」新增至少一項服務項目", true); return; }
  if (typeof tour2Cleanup === "function") tour2Cleanup();
  openBookingSheet({ date: todayStr() });
});

/* ============================================================
   新手教學導覽：帶著使用者把所有功能、卡片都看過一輪
   純前端引導、不會動到任何資料，隨時可以跳過或重來
   ============================================================ */
const TOUR_STEPS = [
  { title: "歡迎使用指尖工作室 👋", text: "第一次使用建議先到「設定」把基本資料建好，之後排預約才會順。花 2 分鐘帶你設定一遍，中途想離開按右下角「跳過導覽」就可以了。" },
  { onEnter: () => showView("settings"), selectors: ['[data-view="settings"]'], title: "先到「設定」頁籤", text: "工作室的基本資料、服務項目、PIN 鎖定都在這裡，建議先設定好這三項再開始排預約。" },
  { selectors: ["#s-shop-name"], title: "① 設定工作室資訊", text: "工作室名稱、營業時間、固定公休日、手機主畫面圖示、主題顏色都在這張卡片設定，填好按「儲存」。" },
  { selectors: ["#s-holiday-add"], title: "特別公休日", text: "遇到連假或臨時休診，可以在這裡加入日期，日曆會自動顯示成公休。" },
  { selectors: ["#s-add-service-btn"], title: "② 設定服務項目", text: "接著把有提供的服務項目和價格建起來，之後新增預約時才可以直接勾選、自動帶入金額——這步沒做的話會沒辦法新增預約唷。" },
  { selectors: ["#s-pin-enabled"], title: "③ PIN 碼是否要鎖定", text: "最後決定要不要開啟 PIN 鎖定。怕手機被別人打開看到預約資料，可以開啟這個功能，之後每次打開都要輸入 4 碼 PIN；不需要的話保持關閉即可。" },
  { selectors: ["#s-export-btn"], title: "資料備份與還原", text: "所有資料只存在這台裝置的瀏覽器裡，記得定期按「匯出備份檔」保存，換裝置時用「還原備份檔」就能把資料搬過去。" },
  { onEnter: () => showView("dash"), selectors: ["#main .card"], title: "④「今日」頁籤", text: "設定好了，接下來看看怎麼用。一打開就會看到今天的預約清單，下面還有「明天」的預約，方便提前準備。" },
  { onEnter: () => showView("bookings"), selectors: ['[data-view="bookings"]'], title: "⑤「預約」頁籤", text: "所有預約都在這裡管理，也能用月曆掌握空檔。" },
  { selectors: [".cal-grid"], title: "預約日曆", text: "綠色代表當天還可預約、橘色代表已有預約、紅色代表滿約、灰色是公休日。點日期可以框選（也能選一段範圍），右上角「回到今天」隨時跳回今天。" },
  { selectors: ["#fab-add"], title: "新增預約", text: "點右下角圓形「＋」，或直接點日曆上的日期，就會跳出新增預約的表單。表單只需要填客人、時間、大概的服務項目——金額、付款方式這些等服務結束後再填就好，畫面會比較簡單。" },
  { selectors: ["#bl-search", ".chip-row"], title: "搜尋、篩選預約", text: "可以搜尋客戶姓名或電話，也可以用上面的狀態標籤（待確認／已確認／已收全額…）篩選清單。待確認、已確認的預約旁邊還會有「確認」「收款」快速按鈕，不用點進去就能一鍵推進狀態。" },
  { onEnter: () => showView("customers"), selectors: ['[data-view="customers"]'], title: "⑥「客戶」頁籤", text: "有預約過的客戶都會自動出現在這裡，不用手動新增；也可以按最下面「手動新增客戶」，如果客人本來就有儲值金，可以在新增時順便填「初始儲值金」。" },
  { selectors: ["#cust-list-search", ".chip-row"], title: "搜尋、篩選客戶", text: "可以搜尋姓名電話，或用「新客／熟客／VIP」標籤篩選。有儲值金的客戶，清單上就會直接看到餘額；點進去可以看完整的消費紀錄與儲值明細。" },
  { onEnter: () => showView("report"), selectors: ['[data-view="report"]'], title: "⑦「報表」頁籤", text: "掌握生意狀況的地方，可以切換月份看每個月的數字。" },
  { selectors: [".stat-grid"], title: "本月統計", text: "本月營收、與上月比較、預約／已收全款筆數、平均客單價、回客率、取消／未到店筆數，一眼就看得到。" },
  { selectors: ["#report-donut-canvas", ".card"], title: "各類服務營收佔比", text: "圓餅圖顯示各類服務的營收比例，也可以切換成只看某一類底下、各服務項目的佔比。" },
  { title: "完成了 🎉", text: "所有功能都逛過一輪了。之後想再看一次，到「設定」頁最下面的「教學導覽」隨時可以重開。" },
];

let tourIndex = -1;
let activeTourSteps = TOUR_STEPS;
let tourBlockerEl = null, tourTooltipEl = null, tourTargetEl = null;

function tourFindTarget(selectors) {
  if (!selectors) return null;
  for (const sel of selectors) {
    const el = document.querySelector(sel);
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
// 反白圈需要元素是「非 static 定位」才能疊在最上層；只在元素本來就是 static 時才臨時加上 relative，
// 本來就是 fixed/absolute 的（例如右下角圓形＋按鈕）完全不動它，避免位置跑掉
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
    // 這兩層 requestAnimationFrame 排隊等待畫面重繪的過程中，使用者可能已經很快點了
    // 「跳過導覽」或連續點「下一步」把導覽結束掉（tourTooltipEl 會被移除、tourIndex 變回 -1），
    // 排隊中的這次渲染還是會執行，要先確認導覽還在進行中，不然會對已經不存在的元素操作而噴錯
    if (tourIndex < 0 || !tourTooltipEl) return;
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
  if (tourIndex < 0 || !tourTooltipEl) return;
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
  tourIndex++;
  if (tourIndex >= activeTourSteps.length) { endTour(); return; }
  tourRenderStep();
}
function tourPrev() {
  tourIndex = Math.max(0, tourIndex - 1);
  tourRenderStep();
}
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
  tourCleanupTarget();
  if (tourBlockerEl) { tourBlockerEl.remove(); tourBlockerEl = null; }
  if (tourTooltipEl) { tourTooltipEl.remove(); tourTooltipEl = null; }
  tourIndex = -1;
}
window.addEventListener("resize", () => {
  if (tourIndex >= 0 && tourTooltipEl) tourPositionTooltip(tourTargetEl, activeTourSteps[tourIndex]);
});

/* ============================================================
   新增預約操作教學：真的讓使用者自己動手操作一遍
   不擋任何點擊，系統偵測到真的完成該步驟才會自動進到下一步
   ============================================================ */
const TOUR2_STEPS = [
  { key: "intro", title: "新增預約操作教學 🔄", text: "接下來要你自己實際操作一遍，跟著提示動手做，完成該步驟就會自動進到下一步。", cta: "開始" },
  { key: "openForm", title: "① 點「＋」新增預約" },
  { key: "fillForm", title: "② 填寫預約資料" },
  { key: "confirm", title: "③ 確認預約" },
  { key: "openSettle", title: "④ 點「結算」" },
  { key: "fillSettle", title: "⑤ 填寫結算資料" },
  { key: "copyLine", title: "⑥ 複製 LINE 訊息" },
  { key: "confirmSettle", title: "⑦ 確認結算" },
  { key: "cancel", title: "⑧ 取消預約" },
  { key: "done", title: "完成了 🎉", text: "你已經實際操作過建立、確認、結算、複製 LINE 訊息、取消整個流程了！剛剛示範用的這筆預約按「結束」後會自動清掉，不會留在正式資料裡。之後想再練習，到「設定」頁的「教學導覽」隨時可以重開。", cta: "結束" },
];
let tour2Active = false;
let tour2Idx = -1;
let tour2BookingId = null;
let tour2CustomerName = "";
let tour2PanelEl = null;
let tour2SpotlightTarget = null;
let tour2FieldHighlightEls = [];
// fab-add、分頁按鈕這些元素不會因為換頁重畫而重新建立，如果一次教學中途被結束、沒點到
// 圈起來的按鈕，掛在上面等著點擊的監聽器就會一直留著；下次再開新一輪教學、剛好又圈到同一顆
// 按鈕，舊的監聽器可能會在使用者點擊時跟著誤觸發。用一個遞增的「場次編號」讓監聽器只認自己
// 那一輪教學，跨場次的舊監聽器點了也不會有反應
let tour2Session = 0;
function tour2Cleanup() {
  if (tour2SpotlightTarget) { tourSpotlightOff(tour2SpotlightTarget, "tour-spotlight-live"); tour2SpotlightTarget = null; }
  tour2FieldHighlightEls.forEach((el) => el.classList.remove("tour2-field-highlight"));
  tour2FieldHighlightEls = [];
}
// 通用：圈起一個元素請使用者自己點，點下去當下先清掉反白圈（避免圈圈疊在點下去之後開的視窗上），
// 再視情況執行下一步。expectedIdx 是為了防止使用者已經用別的方式跳到下一步後，這個舊的監聽還留著誤觸發
function tour2GuideClick(selector, expectedIdx, onClicked) {
  const el = document.querySelector(selector);
  if (!el) return;
  const session = tour2Session;
  tourSpotlightOn(el, "tour-spotlight-live");
  tour2SpotlightTarget = el;
  el.addEventListener("click", () => {
    if (!tour2Active || tour2Session !== session || tour2Idx !== expectedIdx) return;
    tour2Cleanup();
    if (onClicked) onClicked();
  }, { once: true });
}

function tour2StepText(step) {
  const who = tour2CustomerName ? `『${tour2CustomerName}』` : "剛剛那筆";
  switch (step.key) {
    case "openForm": return "點畫面右下角圓形「＋」按鈕（或日曆上的空白日期），就會跳出新增預約的表單。";
    case "fillForm": return "填好客人、時間、大概的服務項目——現在的表單比較精簡，金額、付款方式不用填。「日期」預設是今天，教學要示範「今日」總覽的結算流程，記得保持今天別改掉；「狀態」記得選「待確認」，才能示範下一步的確認動作。填好後按「建立預約」送出。";
    case "confirm": return `會自動跳轉到你剛建立的${who}預約，直接點它旁邊的「確認」按鈕，一鍵就會變成已確認，不用另外開編輯視窗。`;
    case "openSettle": return `${who}預約已經確認了，點下方「今日」分頁切過去，再點這筆預約旁邊的「結算」按鈕。`;
    case "fillSettle": return "結算視窗可以看到客戶資訊、填實際金額和付款方式。內容先不用管對不對，直接點「複製 LINE 訊息」看下一步。";
    case "copyLine": return "這裡是要傳給客人的消費明細，可以按「複製訊息」複製起來。準備好後按左上角「‹ 返回」，會原封不動回到結算視窗，剛剛填的資料都還在。";
    case "confirmSettle": return "回到結算視窗了，剛剛填的都還在。按「確認結算」送出，這筆就會直接變成已收全額。";
    case "cancel": return `點下方「預約」分頁切過去，先點「回到今天」，再找到${who}預約點開它、按「編輯」，把「狀態」改成「已取消」、選一個取消原因，按「儲存變更」完成。\n💡 平常正式使用時這裡沒有刪除功能，取消只是改狀態、紀錄還在；不過這筆是教學示範用的，離開教學後會自動清掉，不會留在正式資料裡。`;
    default: return step.text || "";
  }
}
// 表單／小視窗幾乎佔滿整個畫面的步驟（填寫預約資料、填結算資料…），浮動導覽面板不管放
// 上面還下面都會剛好蓋到表單裡的按鈕或欄位。這種步驟改成把說明文字直接插進表單內容最上方、
// 跟著表單一起捲動，不會蓋住任何可以點的地方；樣式沿用跟浮動面板完全一樣的 class（.tour-tooltip
// 裡面的 .tour-progress / h4 / p / .tour-actions），只是拿掉 position:fixed，看起來才會一致。
function injectInlineTourHint(idx, total, title, text, onSkip) {
  const sheet = document.getElementById("sheet-body");
  if (!sheet) return;
  const hint = document.createElement("div");
  hint.className = "tour-tooltip tour2-inline-hint";
  hint.innerHTML = `
    <div class="tour-progress">${idx} / ${total}</div>
    <h4>${escapeHtml(title)}</h4>
    <p>${escapeHtml(text)}</p>
    <div class="tour-actions">
      <button class="btn ghost tour-skip" id="tour-inline-skip">結束導覽</button>
      <span class="hint">完成後會自動跳下一步</span>
    </div>
  `;
  sheet.insertBefore(hint, sheet.firstChild);
  document.getElementById("tour-inline-skip").addEventListener("click", onSkip);
}
function tour2Render() {
  tour2Cleanup();
  const step = TOUR2_STEPS[tour2Idx];
  if (!step) { endTour2(); return; }
  const text = tour2StepText(step);
  if (step.key === "fillForm" || step.key === "fillSettle" || step.key === "copyLine" || step.key === "confirmSettle") {
    if (tour2PanelEl) tour2PanelEl.style.display = "none";
    injectInlineTourHint(tour2Idx + 1, TOUR2_STEPS.length, step.title, text, endTour2);
    if (step.key === "fillForm") {
      // 「日期」要保持今天，後面「結算」那步是靠「今日」總覽找這筆預約，日期改掉就會找不到；
      // 「狀態」預設是已確認，最容易被忽略掉沒改成待確認。兩個都用一圈顏色框起來提醒；
      // 這步表單裡還有很多其他欄位要填，不能像結算／取消那種單一按鈕一樣整個畫面壓暗，
      // 不然會擋到使用者填其他欄位，所以只單純框顏色，不壓暗背景
      tour2FieldHighlightEls = [document.getElementById("bk-date"), document.getElementById("bk-status")].filter(Boolean);
      tour2FieldHighlightEls.forEach((el) => el.classList.add("tour2-field-highlight"));
    }
    return;
  }
  if (!tour2PanelEl) return;
  tour2PanelEl.style.display = "";
  // 固定顯示在畫面最上方——放左下角的話常常會剛好蓋到預約列表裡要點的按鈕或表單欄位，
  // 放最上方比較不會擋到操作的東西
  tour2PanelEl.classList.add("tour2-panel-top");
  tour2PanelEl.innerHTML = `
    <div class="tour-progress">${tour2Idx + 1} / ${TOUR2_STEPS.length}</div>
    <h4>${escapeHtml(step.title)}</h4>
    <p>${escapeHtml(text)}</p>
    <div class="tour-actions">
      <button class="btn ghost tour-skip" id="tour2-skip">結束導覽</button>
      ${step.cta
      ? `<button class="btn" id="tour2-cta">${escapeHtml(step.cta)}</button>`
      : `<span class="hint">完成後會自動跳下一步</span>`}
    </div>
  `;
  document.getElementById("tour2-skip").addEventListener("click", endTour2);
  const ctaBtn = document.getElementById("tour2-cta");
  if (ctaBtn) ctaBtn.addEventListener("click", () => {
    if (step.key === "done") { endTour2(); return; }
    tour2Idx++;
    tour2Render();
  });
  if (step.key === "openForm") {
    showView("bookings");
    // 「新增預約」的圓形＋按鈕是 position:fixed，反白圈不會動到它的定位，可以放心圈起來提示，
    // 讓使用者一眼就看到要點哪裡（跟新手教學導覽同一顆按鈕的圈法一致）；
    // 點下＋之後表單就會開啟，馬上進到「填寫預約資料」這一步
    requestAnimationFrame(() => {
      tour2GuideClick("#fab-add", 1, () => { tour2Idx = 2; tour2Render(); });
    });
  }
  if (step.key === "confirm") {
    // 圈起剛建立那筆的「確認」按鈕，點下去會觸發 tourOnBookingUpdated 這個共用 hook 自動進下一步，
    // 這裡只需要負責圈起來、點下去清掉反白圈就好，不用自己處理進度
    requestAnimationFrame(() => {
      tour2GuideClick(`[data-quick-confirm="${tour2BookingId}"]`, 3);
    });
  }
  if (step.key === "openSettle") {
    // 不自動幫使用者跳頁——直接跳轉會讓畫面忽然變了，使用者搞不清楚發生什麼事。
    // 改成圈起「今日」分頁請他自己點過去，點過去之後畫面已經換成今日總覽，再把反白圈換到「結算」按鈕上
    requestAnimationFrame(() => {
      tour2GuideClick('.tab-btn[data-view="dash"]', 4, () => {
        requestAnimationFrame(() => tour2GuideClick(`[data-settle="${tour2BookingId}"]`, 4));
      });
    });
  }
  if (step.key === "cancel") {
    // 跟「結算」那步同一套：先圈「預約」分頁、再圈「回到今天」，最後才圈這筆預約，
    // 一步一步接力點過去，每點一步反白圈就換下一個目標
    requestAnimationFrame(() => {
      tour2GuideClick('.tab-btn[data-view="bookings"]', 8, () => {
        requestAnimationFrame(() => {
          tour2GuideClick("#cal-today-btn", 8, () => {
            requestAnimationFrame(() => tour2GuideClick(`[data-open-booking="${tour2BookingId}"]`, 8));
          });
        });
      });
    });
  }
}
function startTour2() {
  // 如果上一輪教學還沒正常結束就又被重新點開（例如很快連點兩次教學按鈕），
  // 先把上一輪收乾淨，不然舊的浮動面板、示範預約會一直留著沒清掉
  if (tour2Active) endTour2();
  tour2Session++;
  tour2Active = true;
  tour2Idx = 0;
  tour2BookingId = null;
  tour2CustomerName = "";
  tour2PanelEl = document.createElement("div");
  tour2PanelEl.className = "tour-tooltip tour2-panel";
  document.body.appendChild(tour2PanelEl);
  window.tourOnBookingCreated = (bookingId, name) => {
    if (!tour2Active || tour2Idx !== 2) return;
    tour2BookingId = bookingId;
    tour2CustomerName = name;
    tour2Idx = 3;
    tour2Render();
  };
  window.tourOnBookingUpdated = (bookingId, status) => {
    if (!tour2Active || bookingId !== tour2BookingId) return;
    if (tour2Idx === 3 && status === "confirmed") { tour2Idx = 4; tour2Render(); return; }
    if (tour2Idx === 7 && status === "paidFull") { tour2Idx = 8; tour2Render(); return; }
    if (tour2Idx === 8 && status === "cancelled") { tour2Idx = 9; tour2Render(); return; }
  };
  window.tourOnSettleOpened = (bookingId) => {
    if (!tour2Active || tour2Idx !== 4 || bookingId !== tour2BookingId) return;
    tour2Idx = 5;
    tour2Render();
  };
  window.tourOnLineOpened = () => {
    if (!tour2Active || tour2Idx !== 5) return;
    tour2Idx = 6;
    tour2Render();
  };
  window.tourOnLineBack = () => {
    if (!tour2Active || tour2Idx !== 6) return;
    tour2Idx = 7;
    tour2Render();
  };
  tour2Render();
}
// 教學結束時（不管是真的走完還是中途按「結束導覽」跳出）都要把示範用的這筆預約刪掉，
// 不然每次練習教學都會在正式資料裡多留一筆測試預約
function tour2DeleteDemoBooking() {
  if (!tour2BookingId) return;
  const idx = DB.bookings.findIndex((b) => b.id === tour2BookingId);
  if (idx !== -1) { DB.bookings.splice(idx, 1); saveDB(); }
  tour2BookingId = null;
}
function endTour2() {
  tour2Active = false;
  tour2Cleanup();
  tour2DeleteDemoBooking();
  closeSheet();
  window.tourOnBookingCreated = null;
  window.tourOnBookingUpdated = null;
  window.tourOnSettleOpened = null;
  window.tourOnLineOpened = null;
  window.tourOnLineBack = null;
  if (tour2PanelEl) { tour2PanelEl.remove(); tour2PanelEl = null; }
  tour2Idx = -1;
  renderView();
}

/* ============================================================
   手機瀏覽器底部導覽列跑版修正
   手機瀏覽器（尤其網址列會自動收合/展開的情況）在頁面內容較短、不需要捲動時，
   position:fixed 的元素有時會被排到「網址列收合後」那個比較高的可視範圍去算位置，
   導致底部導覽列跟畫面實際可見範圍對不齊，看起來像是被往下推、跑版了；
   內容夠長需要捲動的頁面則不會有這個落差。
   用 visualViewport 量出目前瀏覽器介面吃掉的高度，即時校正導覽列的 bottom 位置。
   ============================================================ */
function initMobileNavFix() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const offset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty("--vv-bottom-offset", offset + "px");
  };
  vv.addEventListener("resize", update);
  vv.addEventListener("scroll", update);
  update();
}

/* ============================================================
   啟動
   ============================================================ */
initTabbar();
initMobileNavFix();
applyTheme();
applyAppIcon(DB.settings.appIconDataUrl);
applyThemeColor(DB.settings.themeColor);
showView("dash");
applyPinLock();