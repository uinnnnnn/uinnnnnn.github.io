/**
 * 指尖工作室 - 預約與客戶管理系統
 * Google Apps Script 後端 API
 *
 * 使用方式：
 *   1. 在 Google 試算表選單點「美業系統 → 初始化試算表」，自動建立四張工作表與範例設定。
 *   2. 部署 → 新增部署作業 → 類型選「網頁應用程式」，執行身分「我」，存取權限「任何人」。
 *   3. 複製部署後的網址，貼到前端系統設定；並把「Settings」工作表裡的 ApiToken 一起貼過去。
 *
 * 所有資料都留在使用者自己的 Google 試算表中，本腳本不會把資料送到任何第三方伺服器。
 */

/* ============================== 基本設定 ============================== */

const SHEET_BOOKINGS = "預約資料";
const SHEET_CUSTOMERS = "客戶資料";
const SHEET_SERVICES = "服務項目";
const SHEET_SETTINGS = "系統設定";
const SHEET_REPORTS = "月報表存底";

// 內部欄位代號：程式邏輯與前端 API 都用這組英文代號，固定不變，
// 不會因為試算表上顯示的中文欄名改變而壞掉。
const BOOKINGS_HEADERS = [
  "BookingID", "Date", "StartTime", "EndTime",
  "CustomerID", "CustomerName", "Phone",
  "Service", "Price", "Status", "Notes",
  "CreatedAt", "UpdatedAt",
  "PaymentMethod", "DepositPaid", "FullyPaid", "TodayAmount", "ExtraAmount", "StoredValueAmount",
  "CancelReason", "StoredValueUsed"
];
const CUSTOMERS_HEADERS = [
  "CustomerID", "Name", "Phone", "Tag",
  "FirstVisitDate", "LastVisitDate", "VisitCount", "TotalSpend",
  "Notes", "CreatedAt",
  "Contact", "Birthday", "StoredValueBalance"
];
const SERVICES_HEADERS = [
  "ServiceID", "Name", "Category", "DurationMin", "Price", "Active"
];
const SETTINGS_HEADERS = ["Key", "Value"];
const REPORTS_HEADERS = [
  "ReportID", "Month", "GeneratedAt",
  "ApptCount", "DoneCount", "CancelCount", "NoShowCount",
  "Revenue", "TopUp", "AvgTicket", "UniqueCustomerCount", "NewCustomerCount", "RepeatRate"
];

// 試算表上實際顯示的中文欄名（僅用於畫面顯示，跟上面的內部代號一一對應）
const BOOKINGS_LABELS = [
  "預約編號", "日期", "開始時間", "結束時間",
  "客戶編號", "客戶姓名", "電話",
  "服務項目", "金額", "狀態", "備註",
  "建立時間", "更新時間",
  "付款方式", "已匯款訂金", "已收全額款項", "今日金額", "其他加項金額", "本次儲值金額",
  "取消原因", "使用儲值金"
];
const CUSTOMERS_LABELS = [
  "客戶編號", "姓名", "電話", "標籤",
  "首次到店日期", "最近到店日期", "到店次數", "累計消費",
  "備註", "建立時間",
  "聯絡方式(LINE/IG)", "生日", "目前儲值金"
];
const SERVICES_LABELS = ["服務編號", "名稱", "分類", "時長(分鐘)", "價格", "啟用"];
const SETTINGS_LABELS = ["設定項目", "值"];
const REPORTS_LABELS = [
  "報表編號", "月份", "產生時間",
  "總預約數", "已完成", "已取消", "未到店",
  "服務營收", "儲值進帳", "平均客單價", "服務客戶數", "新客數", "回客率(%)"
];

// 依工作表名稱查內部欄位代號，讓程式邏輯完全不需要讀取試算表上實際顯示的（中文）欄名
const HEADERS_BY_SHEET_ = {};
HEADERS_BY_SHEET_[SHEET_BOOKINGS] = BOOKINGS_HEADERS;
HEADERS_BY_SHEET_[SHEET_CUSTOMERS] = CUSTOMERS_HEADERS;
HEADERS_BY_SHEET_[SHEET_SERVICES] = SERVICES_HEADERS;
HEADERS_BY_SHEET_[SHEET_SETTINGS] = SETTINGS_HEADERS;
HEADERS_BY_SHEET_[SHEET_REPORTS] = REPORTS_HEADERS;

const BOOKING_STATUSES = ["pending", "confirmed", "deposit", "rescheduled", "cancelled", "noshow"];
// 會計入營收的狀態：待確認／改期／已取消／未到店都不算有實際發生的消費
const REVENUE_STATUSES_ = ["confirmed", "deposit"];
const PAYMENT_METHODS = ["現金", "轉帳", "信用卡", "LINE Pay", "其他"];
const CUSTOMER_TAGS = ["new", "regular", "vip"];
const CANCEL_REASONS = ["客人取消", "店家取消", "改期", "其他"];

// 試算表裡的「狀態」「標籤」下拉選單直接顯示中文字，比較好懂；程式內部邏輯還是統一用英文代號，
// 所以讀取試算表資料時要把中文字轉回英文代號（STATUS_ZH_TO_EN_ / TAG_ZH_TO_EN_）。
const STATUS_LABELS_ZH_ = {
  pending: "待確認", confirmed: "已確認", deposit: "已付訂",
  rescheduled: "改期", cancelled: "已取消", noshow: "未到店",
};
const STATUS_ZH_TO_EN_ = {};
Object.keys(STATUS_LABELS_ZH_).forEach(function (k) { STATUS_ZH_TO_EN_[STATUS_LABELS_ZH_[k]] = k; });

const TAG_LABELS_ZH_ = { new: "新客", regular: "熟客", vip: "VIP" };
const TAG_ZH_TO_EN_ = {};
Object.keys(TAG_LABELS_ZH_).forEach(function (k) { TAG_ZH_TO_EN_[TAG_LABELS_ZH_[k]] = k; });

// 舊資料裡如果還留著已經拿掉的狀態（例如以前的「已完成」），一律當「已確認」計算，避免營收漏算
function normalizeStatus_(s) { return BOOKING_STATUSES.indexOf(s) > -1 ? s : "confirmed"; }
// 狀態／標籤在程式內部一律用英文代號比對，只有寫回試算表、或試算表讀出來的當下才轉成中文／轉回英文
function zhStatus_(s) { return STATUS_LABELS_ZH_[s] || s; }
function enStatus_(s) { return STATUS_ZH_TO_EN_[s] || s; }
function zhTag_(t) { return TAG_LABELS_ZH_[t] || t; }
function enTag_(t) { return TAG_ZH_TO_EN_[t] || t; }

// 系統設定的「設定項目」欄一樣用中文顯示，內部程式一律用英文代號比對（跟 Status／Tag 用同一套做法）
const SETTINGS_KEY_LABELS_ZH_ = {
  ShopName: "店名",
  BusinessHoursStart: "營業開始時間",
  BusinessHoursEnd: "營業結束時間",
  ApiToken: "API金鑰",
  PinEnabled: "啟用PIN碼鎖定",
  PinCode: "PIN碼",
  PinRecovery: "PIN碼提示",
  AccentTheme: "外觀色系",
  ClosedWeekdays: "固定公休日",
  SpecialHolidays: "特別公休日",
};
const SETTINGS_KEY_ZH_TO_EN_ = {};
Object.keys(SETTINGS_KEY_LABELS_ZH_).forEach(function (k) { SETTINGS_KEY_ZH_TO_EN_[SETTINGS_KEY_LABELS_ZH_[k]] = k; });
function zhSettingsKey_(k) { return SETTINGS_KEY_LABELS_ZH_[k] || k; }
function enSettingsKey_(label) { return SETTINGS_KEY_ZH_TO_EN_[label] || label; }

// 系統設定裡有些鍵值即使舊試算表沒有也要能自動補上，避免舊使用者用不到新功能
const SETTINGS_DEFAULTS_ = {
  PinEnabled: "FALSE", PinCode: "", PinRecovery: "",
  AccentTheme: "cream",
  // ClosedWeekdays：固定公休日，星期幾的數字用逗號隔開（0=週日...6=週六），例如 "0,1" 代表週日、週一公休
  // SpecialHolidays：特別公休日，逗號隔開多筆，單日就是 "2026-10-10"，連續多天用「~」接起來，例如 "2026-10-10~2026-10-12"
  ClosedWeekdays: "", SpecialHolidays: ""
};

/* ============================== 選單 / 初始化 ============================== */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("美業系統")
    .addItem("初始化試算表", "setupSheets")
    .addItem("重新產生 API 金鑰", "regenerateApiToken")
    .addToUi();
}

/**
 * 建立四張工作表（若已存在則略過），寫入表頭、凍結首列、加入下拉選單資料驗證，
 * 並產生一組隨機 API 金鑰寫入 Settings。第一次使用系統前，先手動執行這個函式一次即可。
 */
function setupSheets() {
  const ss = SpreadsheetApp.getActive();

  ensureSheet_(ss, SHEET_BOOKINGS, BOOKINGS_LABELS);
  ensureSheet_(ss, SHEET_CUSTOMERS, CUSTOMERS_LABELS);
  ensureSheet_(ss, SHEET_SERVICES, SERVICES_LABELS);
  ensureSheet_(ss, SHEET_SETTINGS, SETTINGS_LABELS);
  ensureSheet_(ss, SHEET_REPORTS, REPORTS_LABELS);

  // 先把既有資料往上擠，清掉中間的假空白列，之後新資料才不會又被寫到很後面
  compactSheetData_(ss.getSheetByName(SHEET_BOOKINGS));
  compactSheetData_(ss.getSheetByName(SHEET_CUSTOMERS));
  migrateSettingsKeysToChinese_(ss.getSheetByName(SHEET_SETTINGS));

  applyDropdown_(ss.getSheetByName(SHEET_BOOKINGS), 10, BOOKING_STATUSES.map(function (s) { return STATUS_LABELS_ZH_[s]; })); // Status 欄，下拉選單直接顯示中文
  applyDropdown_(ss.getSheetByName(SHEET_CUSTOMERS), 4, CUSTOMER_TAGS.map(function (t) { return TAG_LABELS_ZH_[t]; }));       // Tag 欄，下拉選單直接顯示中文
  applyDropdown_(ss.getSheetByName(SHEET_SERVICES), 6, ["TRUE", "FALSE"]);  // Active 欄
  applyDropdown_(ss.getSheetByName(SHEET_BOOKINGS), BOOKINGS_HEADERS.indexOf("PaymentMethod") + 1, PAYMENT_METHODS); // 付款方式欄
  applyCheckbox_(ss.getSheetByName(SHEET_BOOKINGS), BOOKINGS_HEADERS.indexOf("DepositPaid") + 1);  // 已匯款訂金欄
  applyCheckbox_(ss.getSheetByName(SHEET_BOOKINGS), BOOKINGS_HEADERS.indexOf("FullyPaid") + 1);    // 已收全額款項欄
  applyDropdown_(ss.getSheetByName(SHEET_BOOKINGS), BOOKINGS_HEADERS.indexOf("CancelReason") + 1, CANCEL_REASONS); // 取消原因欄
  applyPlainTextFormat_(ss.getSheetByName(SHEET_BOOKINGS), BOOKINGS_HEADERS.indexOf("Phone") + 1);   // 電話欄位設成純文字，開頭 0 才不會被吃掉
  applyPlainTextFormat_(ss.getSheetByName(SHEET_CUSTOMERS), CUSTOMERS_HEADERS.indexOf("Phone") + 1);

  seedServicesIfEmpty_(ss.getSheetByName(SHEET_SERVICES));
  seedSettingsIfEmpty_(ss.getSheetByName(SHEET_SETTINGS));
  ensureSettingsKeys_(ss.getSheetByName(SHEET_SETTINGS)); // 幫舊試算表補上新版才有的設定鍵值（PIN鎖、外觀色系等）

  // 幫既有客戶把「目前儲值金」欄位重新算一次，補上舊資料（新客戶之後每次異動預約都會自動同步）
  sheetToObjects_(SHEET_CUSTOMERS).forEach(function (c) { syncCustomerStoredValueBalance_(c.CustomerID); });

  // 如果是從 Apps Script 編輯器直接執行（不是從試算表選單），沒有 UI 環境，
  // getUi() 會丟例外；這種情況就不彈提示框，避免顯示紅色錯誤，但前面的初始化都已經完成了。
  try {
    SpreadsheetApp.getUi().alert(
      "初始化完成！\n\n請至「Settings」工作表複製 ApiToken，" +
      "並將本試算表部署為網頁應用程式後，把網址與 ApiToken 一起貼到前端系統設定中。"
    );
  } catch (err) {
    Logger.log("初始化完成（此為直接從編輯器執行，略過彈出視窗）");
  }
}

// 把「有資料的列」往上擠到緊接標題列下方，清掉中間因下拉選單／checkbox 驗證造成的
// 大量假空白列（曾經讓新資料被寫到第 1000 多列，畫面上方看起來像沒有資料）。
// 只搬動內容，不影響下拉選單／勾選框等格式設定（那些之後會重新套用一次）。
function compactSheetData_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const numCols = sheet.getLastColumn();
  const range = sheet.getRange(2, 1, lastRow - 1, numCols);
  const values = range.getValues();
  const real = values.filter(function (row) { return row[0] !== "" && row[0] !== null; });
  if (real.length === values.length) return; // 沒有多餘空白列，不用搬動
  range.clearContent();
  if (real.length > 0) {
    sheet.getRange(2, 1, real.length, numCols).setValues(real);
  }
}

function ensureSheet_(ss, name, labels) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  // 標題列（第 1 列）每次都重寫成目前的中文欄名，就算是已有資料的舊試算表也會一併更新，
  // 不影響第 2 列以後的既有資料。
  sheet.getRange(1, 1, 1, labels.length).setValues([labels]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, labels.length).setFontWeight("bold").setBackground("#f1eae6");
  sheet.autoResizeColumns(1, labels.length);
  return sheet;
}

function applyDropdown_(sheet, col, options) {
  const rule = SpreadsheetApp.newDataValidation().requireValueInList(options, true).build();
  sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
}

function applyCheckbox_(sheet, col) {
  const rule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
  sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(rule);
}

// 電話號碼欄位設成純文字格式，避免 Google 試算表把它當數字，開頭的 0 被吃掉
function applyPlainTextFormat_(sheet, col) {
  sheet.getRange(2, col, Math.max(sheet.getMaxRows() - 1, 1), 1).setNumberFormat("@");
}

function seedServicesIfEmpty_(sheet) {
  if (sheet.getLastRow() > 1) return;
  const rows = [
    ["S001", "單色手部光療", "美甲", 60, 980, "TRUE"],
    ["S002", "法式美甲", "美甲", 75, 1200, "TRUE"],
    ["S003", "手足光療＋卸甲", "美甲", 90, 1450, "TRUE"],
    ["S004", "嫁接睫毛", "美睫", 120, 2200, "TRUE"],
    ["S005", "嫁接睫毛補模", "美睫", 75, 1600, "TRUE"],
    ["S006", "紋繡霧眉", "紋繡", 150, 6800, "TRUE"],
  ];
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

function seedSettingsIfEmpty_(sheet) {
  if (sheet.getLastRow() > 1) return;
  const token = Utilities.getUuid().replace(/-/g, "");
  const rows = [
    [zhSettingsKey_("ShopName"), "指尖工作室"],
    [zhSettingsKey_("BusinessHoursStart"), "09:00"],
    [zhSettingsKey_("BusinessHoursEnd"), "20:00"],
    [zhSettingsKey_("ApiToken"), token],
  ];
  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

// 幫舊試算表把「設定項目」欄從英文代號改成中文顯示（例如 ApiToken → API金鑰），只改看得到的文字，
// 內部比對用的英文代號完全不受影響，可重複執行
function migrateSettingsKeysToChinese_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return;
  const keys = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  keys.forEach(function (row, i) {
    const zh = SETTINGS_KEY_LABELS_ZH_[row[0]];
    if (zh) sheet.getRange(i + 2, 1).setValue(zh);
  });
}

// 幫已經在用的舊試算表補上新版才新增的設定鍵值（不會動到既有的值），可重複執行
function ensureSettingsKeys_(sheet) {
  const data = sheet.getDataRange().getValues();
  const existingKeys = {};
  for (let i = 1; i < data.length; i++) existingKeys[enSettingsKey_(data[i][0])] = true;
  const rowsToAdd = [];
  Object.keys(SETTINGS_DEFAULTS_).forEach(function (key) {
    if (!existingKeys[key]) rowsToAdd.push([zhSettingsKey_(key), SETTINGS_DEFAULTS_[key]]);
  });
  if (rowsToAdd.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAdd.length, 2).setValues(rowsToAdd);
  }
}

function regenerateApiToken() {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_SETTINGS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (enSettingsKey_(data[i][0]) === "ApiToken") {
      const token = Utilities.getUuid().replace(/-/g, "");
      sheet.getRange(i + 1, 2).setValue(token);
      SpreadsheetApp.getUi().alert("新的 API 金鑰已產生：\n" + token + "\n\n請同步更新前端系統設定。");
      return;
    }
  }
}

/* ============================== Web API 入口 ============================== */

/**
 * Google Apps Script 網頁應用程式的回應會經過一次 302 轉址（到 script.googleusercontent.com），
 * 轉址後的回應不會帶 Access-Control-Allow-Origin，瀏覽器的 fetch() 從別的網域呼叫時會直接被 CORS
 * 擋掉（即使用瀏覽器網址列直接打開網址看起來正常，那是「整頁導覽」不受 CORS 限制，跟 fetch 不一樣）。
 * 因此前端一律改用 GET + JSONP（動態插入 <script> 標籤）呼叫，讀取與寫入都走這個入口，
 * 不再使用 doPost／fetch POST。doPost 仍保留給非瀏覽器（伺服器對伺服器）的呼叫者使用。
 *
 * 讀取範例：.../exec?action=getBookings&date=2026-08-23&token=xxxx&callback=cb
 * 寫入範例：.../exec?action=createBooking&token=xxxx&callback=cb&payload=<encodeURIComponent(JSON字串)>
 */
function doGet(e) {
  return handleRequest_((e && e.parameter) || {});
}

/**
 * 保留給非瀏覽器呼叫者：POST body 格式 { "action": "...", "token": "...", ...其他欄位 }
 */
function doPost(e) {
  let body = {};
  try {
    body = JSON.parse(e.postData.contents);
  } catch (err) {
    return jsonOutput_({ ok: false, error: "BAD_REQUEST", message: "請求內容不是合法的 JSON" }, null);
  }
  return handleRequest_(body);
}

function handleRequest_(params) {
  const callback = sanitizeCallback_(params.callback);
  try {
    if (!checkToken_(params.token)) {
      return jsonOutput_({ ok: false, error: "UNAUTHORIZED", message: "API 金鑰錯誤" }, callback);
    }

    // 寫入類的 action 把完整資料放在 payload（URL 編碼過的 JSON 字串）裡，避免塞一堆零散的網址參數
    let body = params;
    if (params.payload) {
      try {
        body = JSON.parse(params.payload);
      } catch (err) {
        return jsonOutput_({ ok: false, error: "BAD_REQUEST", message: "payload 不是合法的 JSON" }, callback);
      }
    }

    let data;
    switch (params.action) {
      case "ping":
        data = { pong: true, now: new Date().toISOString() };
        break;
      case "getBookings":
        data = getBookings_(params.date, params.from, params.to);
        break;
      case "getCustomers":
        data = getCustomers_(params.search, params.tag);
        break;
      case "getServices":
        data = getServices_();
        break;
      case "getRevenueSummary":
        data = getRevenueSummary_(Number(params.months) || 6);
        break;
      case "getMonthStats":
        data = computeMonthStats_(params.month);
        break;
      case "getSettings":
        data = getPublicSettings_();
        break;
      case "updateSettings":
        data = withLock_(function () { return updateSettings_(body); });
        break;
      case "getReports":
        data = getReports_();
        break;
      case "createBooking":
        data = withLock_(function () { return createBooking_(body); });
        break;
      case "updateBooking":
        data = withLock_(function () { return updateBooking_(body); });
        break;
      case "updateBookingStatus":
        data = withLock_(function () { return updateBookingStatus_(body.bookingId, body.status, body.cancelReason); });
        break;
      case "cancelBooking":
        data = withLock_(function () { return updateBookingStatus_(body.bookingId, "cancelled", body.cancelReason); });
        break;
      case "collectPayment":
        data = withLock_(function () { return collectPayment_(body.bookingId); });
        break;
      case "upsertCustomer":
        data = withLock_(function () { return upsertCustomer_(body); });
        break;
      case "saveReport":
        data = withLock_(function () { return saveReport_(body.month); });
        break;
      case "deleteReport":
        data = withLock_(function () { return deleteReport_(body.reportId); });
        break;
      default:
        return jsonOutput_({ ok: false, error: "UNKNOWN_ACTION", message: "未知的 action：" + params.action }, callback);
    }
    return jsonOutput_({ ok: true, data: data }, callback);
  } catch (err) {
    return jsonOutput_({ ok: false, error: "SERVER_ERROR", message: String(err) }, callback);
  }
}

// 寫入操作一律排隊執行，避免多人同時送出造成資料錯亂
function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(10000); // 最多等待 10 秒
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// JSONP 的 callback 名稱會直接接到回應的 JS 內容裡，先做基本白名單檢查避免被塞入奇怪字元
function sanitizeCallback_(callback) {
  return callback && /^[a-zA-Z0-9_.]{1,80}$/.test(callback) ? callback : null;
}

function checkToken_(token) {
  const validToken = getSetting_("ApiToken");
  return token && validToken && token === validToken;
}

/* ============================== 讀取邏輯 ============================== */

function getBookings_(date, from, to) {
  const rows = sheetToObjects_(SHEET_BOOKINGS);
  return rows.filter(function (b) {
    if (date) return b.Date === date;
    if (from && to) return b.Date >= from && b.Date <= to;
    return true;
  }).sort(function (a, b) {
    return (a.Date + a.StartTime).localeCompare(b.Date + b.StartTime);
  });
}

function getCustomers_(search, tag) {
  const rows = sheetToObjects_(SHEET_CUSTOMERS);
  return rows.filter(function (c) {
    const matchTag = !tag || tag === "all" || c.Tag === tag;
    const matchSearch = !search ||
      String(c.Name).indexOf(search) > -1 ||
      String(c.Phone).indexOf(search) > -1;
    return matchTag && matchSearch;
  });
}

function getServices_() {
  return sheetToObjects_(SHEET_SERVICES).filter(function (s) {
    return String(s.Active).toUpperCase() === "TRUE";
  });
}

function getRevenueSummary_(months) {
  const rows = sheetToObjects_(SHEET_BOOKINGS).filter(function (b) {
    return REVENUE_STATUSES_.indexOf(normalizeStatus_(b.Status)) > -1;
  });

  const now = new Date();
  const buckets = {};
  const order = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = Utilities.formatDate(d, Session.getScriptTimeZone(), "yyyy-MM");
    buckets[key] = 0;
    order.push(key);
  }

  rows.forEach(function (b) {
    const key = String(b.Date).slice(0, 7); // yyyy-MM
    if (key in buckets) buckets[key] += Number(b.Price) || 0;
  });

  const series = order.map(function (key) {
    return { month: key, total: buckets[key] };
  });
  const total = series.reduce(function (s, m) { return s + m.total; }, 0);

  return { months: series, totalAmount: total, average: Math.round(total / months) };
}

// 計算指定月份（'yyyy-MM'）的完整經營統計，供「本月 vs 上月」即時比較，以及月報表存底使用
function computeMonthStats_(monthPrefix) {
  const allBookings = sheetToObjects_(SHEET_BOOKINGS);
  const monthBookings = allBookings.filter(function (b) { return String(b.Date).slice(0, 7) === monthPrefix; });
  const revenueBookings = monthBookings.filter(function (b) { return REVENUE_STATUSES_.indexOf(normalizeStatus_(b.Status)) > -1; });
  const revenue = revenueBookings.reduce(function (s, b) { return s + (Number(b.Price) || 0) + (Number(b.ExtraAmount) || 0); }, 0);
  const topUp = revenueBookings.reduce(function (s, b) { return s + (Number(b.StoredValueAmount) || 0); }, 0);
  // 沒有「已完成」狀態了，DoneCount 改成「已確認／已付訂（有實際發生消費）」的預約筆數
  const doneCount = revenueBookings.length;
  const cancelCount = monthBookings.filter(function (b) { return b.Status === "cancelled"; }).length;
  const noShowCount = monthBookings.filter(function (b) { return b.Status === "noshow"; }).length;
  const avgTicket = revenueBookings.length ? Math.round(revenue / revenueBookings.length) : 0;

  const uniqueCustomerIds = {};
  revenueBookings.forEach(function (b) { uniqueCustomerIds[b.CustomerID] = true; });
  const uniqueCustomerCount = Object.keys(uniqueCustomerIds).length;

  // 新客定義：這位客戶「所有計入營收的預約」裡，最早一筆剛好落在這個月
  let newCustomerCount = 0;
  Object.keys(uniqueCustomerIds).forEach(function (cid) {
    let firstDate = null;
    allBookings.forEach(function (b) {
      if (b.CustomerID === cid && REVENUE_STATUSES_.indexOf(normalizeStatus_(b.Status)) > -1) {
        if (!firstDate || b.Date < firstDate) firstDate = b.Date;
      }
    });
    if (firstDate && String(firstDate).slice(0, 7) === monthPrefix) newCustomerCount++;
  });
  const repeatCustomerCount = uniqueCustomerCount - newCustomerCount;
  const repeatRate = uniqueCustomerCount ? Math.round((repeatCustomerCount / uniqueCustomerCount) * 100) : 0;

  return {
    month: monthPrefix, apptCount: monthBookings.length, doneCount: doneCount,
    cancelCount: cancelCount, noShowCount: noShowCount, revenue: revenue, topUp: topUp,
    avgTicket: avgTicket, uniqueCustomerCount: uniqueCustomerCount,
    newCustomerCount: newCustomerCount, repeatRate: repeatRate
  };
}

// 產生（或覆蓋既有同月份的）月報表存底，數字凍結在存檔當下，之後資料異動不會回頭改變存底內容
function saveReport_(monthPrefix) {
  if (!monthPrefix) throw new Error("缺少 month");
  const stats = computeMonthStats_(monthPrefix);
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_REPORTS);
  const headers = getHeaders_(sheet);
  const data = sheet.getDataRange().getValues();
  const monthCol = headers.indexOf("Month");
  let rowIndex = -1;
  for (let i = 1; i < data.length; i++) {
    if (data[i][monthCol] === monthPrefix) { rowIndex = i + 1; break; }
  }
  const reportId = rowIndex === -1 ? generateId_(sheet, "ReportID", "R") : data[rowIndex - 1][headers.indexOf("ReportID")];
  const now = new Date();
  const row = headers.map(function (h) {
    switch (h) {
      case "ReportID": return reportId;
      case "Month": return monthPrefix;
      case "GeneratedAt": return now;
      case "ApptCount": return stats.apptCount;
      case "DoneCount": return stats.doneCount;
      case "CancelCount": return stats.cancelCount;
      case "NoShowCount": return stats.noShowCount;
      case "Revenue": return stats.revenue;
      case "TopUp": return stats.topUp;
      case "AvgTicket": return stats.avgTicket;
      case "UniqueCustomerCount": return stats.uniqueCustomerCount;
      case "NewCustomerCount": return stats.newCustomerCount;
      case "RepeatRate": return stats.repeatRate;
      default: return "";
    }
  });
  if (rowIndex === -1) appendRowSafe_(sheet, row);
  else sheet.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
  return rowToObject_(headers, row);
}

function getReports_() {
  return sheetToObjects_(SHEET_REPORTS).sort(function (a, b) { return String(b.Month).localeCompare(String(a.Month)); });
}

function deleteReport_(reportId) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_REPORTS);
  const rowIndex = findRowIndexById_(sheet, "ReportID", reportId);
  if (rowIndex === -1) throw new Error("找不到報表：" + reportId);
  sheet.deleteRow(rowIndex);
  return { reportId: reportId };
}

function getPublicSettings_() {
  const all = sheetToObjects_(SHEET_SETTINGS);
  const out = {};
  all.forEach(function (row) {
    const key = enSettingsKey_(row.Key); // 「設定項目」欄現在顯示中文，讀出來要先轉回英文代號給前端用
    if (key !== "ApiToken") out[key] = row.Value; // 金鑰本身不對外回傳
  });
  return out;
}

// 前端「系統設定」子頁面用：只允許改這幾個鍵值，ApiToken 等敏感/系統用的鍵不開放從前端寫入
function updateSettings_(body) {
  const ALLOWED_SETTINGS_KEYS_ = ["BusinessHoursStart", "BusinessHoursEnd", "ClosedWeekdays", "SpecialHolidays"];
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_SETTINGS);
  const data = sheet.getDataRange().getValues();
  const rowByKey = {};
  for (let i = 1; i < data.length; i++) rowByKey[enSettingsKey_(data[i][0])] = i + 1;
  ALLOWED_SETTINGS_KEYS_.forEach(function (key) {
    if (!(key in body)) return;
    const value = String(body[key] == null ? "" : body[key]);
    if (rowByKey[key]) {
      sheet.getRange(rowByKey[key], 2).setValue(value);
    } else {
      appendRowSafe_(sheet, [zhSettingsKey_(key), value]);
    }
  });
  return getPublicSettings_();
}

function getSetting_(key) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_SETTINGS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (enSettingsKey_(data[i][0]) === key) return data[i][1];
  }
  return null;
}

/* ============================== 寫入邏輯 ============================== */

function createBooking_(body) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_BOOKINGS);
  const now = new Date();

  // 依電話比對是否為既有客戶，沒有的話自動建立新客戶
  const customer = upsertCustomer_({
    customerId: body.customerId,
    name: body.customerName,
    phone: body.phone,
    contact: body.customerContact,
    birthday: body.customerBirthday,
    tag: body.customerId ? undefined : "new",
  }, /*skipVisitBump=*/true);

  const bookingId = generateId_(sheet, "BookingID", "B");
  const row = [
    bookingId, body.date, body.startTime, body.endTime || "",
    customer.CustomerID, customer.Name, customer.Phone,
    body.service, body.price || 0, zhStatus_(body.status || "pending"), body.notes || "",
    now, now,
    body.paymentMethod || "", !!body.depositPaid, !!body.fullyPaid,
    body.todayAmount || 0, body.extraAmount || 0, body.storedValueAmount || 0,
    body.status === "cancelled" ? (body.cancelReason || "") : "",
    body.storedValueUsed || 0
  ];
  appendRowSafe_(sheet, row);
  syncCustomerStoredValueBalance_(customer.CustomerID);

  return { bookingId: bookingId, customer: customer };
}

// 編輯既有預約的內容（日期／時間／服務／金額／客戶姓名電話／備註），只改這筆預約本身，不動客戶的到店次數統計
function updateBooking_(body) {
  if (!body.bookingId) throw new Error("缺少 bookingId");
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_BOOKINGS);
  const rowIndex = findRowIndexById_(sheet, "BookingID", body.bookingId);
  if (rowIndex === -1) throw new Error("找不到預約：" + body.bookingId);

  const headers = getHeaders_(sheet);
  const fields = {
    Date: body.date, StartTime: body.startTime, EndTime: body.endTime || "",
    CustomerName: body.customerName, Phone: body.phone,
    Service: body.service, Price: body.price || 0, Notes: body.notes || "",
    PaymentMethod: body.paymentMethod || "", DepositPaid: !!body.depositPaid, FullyPaid: !!body.fullyPaid,
    TodayAmount: body.todayAmount || 0, ExtraAmount: body.extraAmount || 0, StoredValueAmount: body.storedValueAmount || 0,
    StoredValueUsed: body.storedValueUsed || 0,
  };
  if (body.cancelReason !== undefined) fields.CancelReason = body.cancelReason;
  if (body.customerId) fields.CustomerID = body.customerId; // 編輯時如果重新選了既有客戶，一併更新關聯的客戶編號

  // 沒有「已完成」狀態了，改用「已收全額款項」從沒勾到勾上這個轉換點，順便更新客戶到店次數與累計消費
  const beforeValues = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  const before = rowToObject_(headers, beforeValues);
  const wasFullyPaid = before.FullyPaid === true || before.FullyPaid === "TRUE" || before.FullyPaid === "true";

  Object.keys(fields).forEach(function (key) {
    if (fields[key] === undefined) return;
    sheet.getRange(rowIndex, headers.indexOf(key) + 1).setValue(fields[key]);
  });
  sheet.getRange(rowIndex, headers.indexOf("UpdatedAt") + 1).setValue(new Date());

  if (!wasFullyPaid && fields.FullyPaid === true) {
    bumpCustomerVisit_(before.CustomerID, fields.Date || before.Date, Number(fields.Price != null ? fields.Price : before.Price) || 0);
  }

  const rowValues = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  const updated = rowToObject_(headers, rowValues);
  updated.Status = enStatus_(updated.Status);
  syncCustomerStoredValueBalance_(updated.CustomerID);
  return updated;
}

function updateBookingStatus_(bookingId, status, cancelReason) {
  if (BOOKING_STATUSES.indexOf(status) === -1) {
    throw new Error("不合法的狀態：" + status);
  }
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_BOOKINGS);
  const rowIndex = findRowIndexById_(sheet, "BookingID", bookingId);
  if (rowIndex === -1) throw new Error("找不到預約：" + bookingId);

  const headers = getHeaders_(sheet);
  sheet.getRange(rowIndex, headers.indexOf("Status") + 1).setValue(zhStatus_(status));
  sheet.getRange(rowIndex, headers.indexOf("UpdatedAt") + 1).setValue(new Date());
  if (status === "cancelled" && cancelReason) {
    sheet.getRange(rowIndex, headers.indexOf("CancelReason") + 1).setValue(cancelReason);
  }

  // 狀態改成取消／從取消改回來，會影響儲值金的計算範圍（已取消的預約不算），所以要重新同步一次
  const rowValues = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  const customerId = rowToObject_(headers, rowValues).CustomerID;
  syncCustomerStoredValueBalance_(customerId);

  return { bookingId: bookingId, status: status };
}

// 一鍵收款：把「已收全額款項」勾起來；沒有「已完成」狀態了，改成用「首次收全額款項」這個時間點，
// 順便更新客戶的到店次數與累計消費（用 FullyPaid 從沒勾到勾上這個轉換點判斷，避免重複計算）
function collectPayment_(bookingId) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_BOOKINGS);
  const rowIndex = findRowIndexById_(sheet, "BookingID", bookingId);
  if (rowIndex === -1) throw new Error("找不到預約：" + bookingId);
  const headers = getHeaders_(sheet);
  const rowValues = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  const record = rowToObject_(headers, rowValues);
  const wasFullyPaid = record.FullyPaid === true || record.FullyPaid === "TRUE" || record.FullyPaid === "true";

  sheet.getRange(rowIndex, headers.indexOf("FullyPaid") + 1).setValue(true);
  sheet.getRange(rowIndex, headers.indexOf("UpdatedAt") + 1).setValue(new Date());

  if (!wasFullyPaid) {
    bumpCustomerVisit_(record.CustomerID, record.Date, Number(record.Price) || 0);
  }
  return { bookingId: bookingId, fullyPaid: true };
}

/**
 * 新增或更新客戶。以 CustomerID 優先比對，沒有則以電話比對，都沒有則視為新客戶。
 */
function upsertCustomer_(body, skipVisitBump) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_CUSTOMERS);
  const headers = getHeaders_(sheet);
  let rowIndex = -1;

  if (body.customerId) {
    rowIndex = findRowIndexById_(sheet, "CustomerID", body.customerId);
  }
  if (rowIndex === -1 && body.phone) {
    const data = sheet.getDataRange().getValues();
    for (let i = 1; i < data.length; i++) {
      if (data[i][headers.indexOf("Phone")] === body.phone) { rowIndex = i + 1; break; }
    }
  }

  const now = new Date();

  if (rowIndex === -1) {
    // 新客戶
    const customerId = generateId_(sheet, "CustomerID", "C");
    const row = headers.map(function (h) {
      switch (h) {
        case "CustomerID": return customerId;
        case "Name": return body.name || "";
        case "Phone": return body.phone || "";
        case "Tag": return zhTag_(body.tag || "new");
        case "FirstVisitDate": return "";
        case "LastVisitDate": return "";
        case "VisitCount": return 0;
        case "TotalSpend": return 0;
        case "Notes": return body.notes || "";
        case "CreatedAt": return now;
        case "Contact": return body.contact || "";
        case "Birthday": return body.birthday || "";
        default: return "";
      }
    });
    appendRowSafe_(sheet, row);
    const created = rowToObject_(headers, row);
    created.Tag = enTag_(created.Tag); // 回傳給前端一律用英文代號
    return created;
  }

  // 更新既有客戶（僅更新有提供的欄位）
  const currentValues = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  const current = rowToObject_(headers, currentValues);
  current.Tag = enTag_(current.Tag); // 讀出來先轉回英文代號，後面比對／回傳才不會出錯
  if (body.name) current.Name = body.name;
  if (body.tag) current.Tag = body.tag;
  if (body.notes !== undefined) current.Notes = body.notes;
  if (body.contact !== undefined) current.Contact = body.contact;
  if (body.birthday !== undefined) current.Birthday = body.birthday;
  if (body.phone) current.Phone = body.phone;

  const updatedRow = headers.map(function (h) { return h === "Tag" ? zhTag_(current.Tag) : current[h]; });
  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([updatedRow]);
  return current;
}

// 把「目前儲值金」重新算過一次（累計儲值 － 累計已使用，不含已取消的預約）並寫回客戶資料，
// 每次跟儲值有關的預約異動後都呼叫這個，保證這一欄永遠是從最新的預約資料重新算出來，不會累加出漏洞。
function syncCustomerStoredValueBalance_(customerId) {
  if (!customerId) return;
  const bookings = sheetToObjects_(SHEET_BOOKINGS).filter(function (b) { return b.CustomerID === customerId && b.Status !== "cancelled"; });
  const balance = bookings.reduce(function (s, b) {
    return s + (Number(b.StoredValueAmount) || 0) - (Number(b.StoredValueUsed) || 0);
  }, 0);

  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_CUSTOMERS);
  const headers = getHeaders_(sheet);
  const rowIndex = findRowIndexById_(sheet, "CustomerID", customerId);
  if (rowIndex === -1) return;
  sheet.getRange(rowIndex, headers.indexOf("StoredValueBalance") + 1).setValue(balance);
}

function bumpCustomerVisit_(customerId, visitDate, amount) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_CUSTOMERS);
  const headers = getHeaders_(sheet);
  const rowIndex = findRowIndexById_(sheet, "CustomerID", customerId);
  if (rowIndex === -1) return;

  const values = sheet.getRange(rowIndex, 1, 1, headers.length).getValues()[0];
  const record = rowToObject_(headers, values);
  record.Tag = enTag_(record.Tag); // 讀出來先轉回英文代號才能正確比對

  record.VisitCount = (Number(record.VisitCount) || 0) + 1;
  record.TotalSpend = (Number(record.TotalSpend) || 0) + amount;
  if (!record.FirstVisitDate) record.FirstVisitDate = visitDate;
  record.LastVisitDate = visitDate;
  if (record.Tag === "new" && record.VisitCount >= 2) record.Tag = "regular";
  if (record.VisitCount >= 15) record.Tag = "vip";

  const updatedRow = headers.map(function (h) { return h === "Tag" ? zhTag_(record.Tag) : record[h]; });
  sheet.getRange(rowIndex, 1, 1, headers.length).setValues([updatedRow]);
}

/* ============================== 共用工具 ============================== */

function getHeaders_(sheet) {
  // 優先用固定的內部欄位代號，不受試算表上實際顯示的（中文）欄名影響；
  // 遇到不認得的工作表名稱時，才退回直接讀取該表的第一列。
  return HEADERS_BY_SHEET_[sheet.getName()] || sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
}

function sheetToObjects_(sheetName) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sheet || sheet.getLastRow() < 2) return [];
  const headers = getHeaders_(sheet);
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues();
  // getLastRow() 會被下拉選單／核取方塊的資料驗證範圍拉長（就算那些列其實完全沒填資料），
  // 所以這裡再用「第一欄（都是各分頁的編號欄）有沒有值」濾掉這些空白列，避免出現一堆假資料。
  const objects = data.filter(function (row) { return row[0] !== "" && row[0] !== null; })
    .map(function (row) { return rowToObject_(headers, row); });

  // 「狀態」「標籤」欄位在試算表上是中文下拉選單，讀出來要轉回程式內部用的英文代號
  if (sheetName === SHEET_BOOKINGS) {
    objects.forEach(function (o) { o.Status = enStatus_(o.Status); });
  }
  if (sheetName === SHEET_CUSTOMERS) {
    objects.forEach(function (o) { o.Tag = enTag_(o.Tag); });
  }
  return objects;
}

function rowToObject_(headers, row) {
  const obj = {};
  headers.forEach(function (h, i) {
    let v = row[i];
    if (v instanceof Date) v = formatSheetDate_(v);
    obj[h] = v;
  });
  return obj;
}

/**
 * 試算表儲存格只要看起來像日期或時間（例如 Settings 裡填 09:00），
 * Google Sheets 會自動存成 Date 物件，而不是純文字。這裡依情況把它還原成
 * 合理的字串格式，避免「純時間」被誤判成完整日期時間（年份變成 1899）。
 *   - 純時間（Sheets 內部以 1899-12-30 為時間序列的基準日）→ "HH:mm"
 *   - 時間部分是 00:00:00 的純日期 → "yyyy-MM-dd"
 *   - 其餘（例如 CreatedAt/UpdatedAt 時間戳記）→ "yyyy-MM-dd HH:mm:ss"
 */
function formatSheetDate_(v) {
  const tz = Session.getScriptTimeZone();
  const isTimeOnlyEpoch = v.getFullYear() === 1899 && v.getMonth() === 11 && v.getDate() === 30;
  if (isTimeOnlyEpoch) return Utilities.formatDate(v, tz, "HH:mm");
  const isMidnight = v.getHours() === 0 && v.getMinutes() === 0 && v.getSeconds() === 0;
  if (isMidnight) return Utilities.formatDate(v, tz, "yyyy-MM-dd");
  return Utilities.formatDate(v, tz, "yyyy-MM-dd HH:mm:ss");
}

function findRowIndexById_(sheet, idColumnName, id) {
  const headers = getHeaders_(sheet);
  const idCol = headers.indexOf(idColumnName);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if (data[i][idCol] === id) return i + 1; // 試算表列號從 1 開始
  }
  return -1;
}

// sheet.getLastRow() 會被下拉選單／checkbox 的格式驗證灌水（驗證套用到 getMaxRows()-1 列，
// 即使是空白列也會被算進「有內容」），導致 appendRow() 把新資料寫到很後面（例如第 1007 列），
// 使用者在試算表上方看起來像「沒有資料」。這裡改成實際掃描第一欄（ID 欄），找到真正最後一列
// 有資料的位置，再寫在它的下一列，避免新資料越寫越後面。
function findRealLastRow_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 1;
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues();
  let real = 1; // 找不到資料時，代表只有標題列
  for (let i = 0; i < ids.length; i++) {
    if (ids[i][0] !== "" && ids[i][0] !== null) real = i + 2;
  }
  return real;
}

function appendRowSafe_(sheet, row) {
  const targetRow = findRealLastRow_(sheet) + 1;
  sheet.getRange(targetRow, 1, 1, row.length).setValues([row]);
}

function generateId_(sheet, idColumnName, prefix) {
  const headers = getHeaders_(sheet);
  const idCol = headers.indexOf(idColumnName);
  const lastRow = sheet.getLastRow();
  let maxNum = 0;
  if (lastRow >= 2) {
    const ids = sheet.getRange(2, idCol + 1, lastRow - 1, 1).getValues();
    ids.forEach(function (r) {
      const n = parseInt(String(r[0]).replace(prefix, ""), 10);
      if (!isNaN(n) && n > maxNum) maxNum = n;
    });
  }
  return prefix + String(maxNum + 1).padStart(4, "0");
}

/* ============================== JSON 回應輔助 ============================== */

// callback 有值就輸出 JSONP（callback(...)，MIME 為 JS，走 <script> 標籤不受 CORS 限制）；
// 沒有 callback 就輸出一般 JSON（給直接用瀏覽器網址列測試，或非瀏覽器呼叫者使用）。
function jsonOutput_(obj, callback) {
  const json = JSON.stringify(obj);
  if (callback) {
    return ContentService.createTextOutput(callback + "(" + json + ");")
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
