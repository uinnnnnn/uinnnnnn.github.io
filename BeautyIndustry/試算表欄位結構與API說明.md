# 指尖工作室 — GAS 後端欄位結構與 API 說明

本文件搭配 `Code.gs` 使用，說明 Google 試算表的欄位結構、部署步驟，以及前端可呼叫的 API 清單。所有資料留在使用者自己的 Google 試算表中，不經過任何第三方伺服器。

## 一、試算表欄位結構

系統會自動建立四張工作表（執行選單「美業系統 → 初始化試算表」即可產生）。試算表上實際看到的欄名都是中文；程式內部仍用英文代號存取資料（下表「內部代號」欄），兩者由 `Code.gs` 開頭的 `*_LABELS` 對照表自動綁定，您不需要手動對應。

### 預約資料（工作表分頁：預約資料）

| 顯示欄名 | 內部代號 | 型別 | 說明 |
|---|---|---|---|
| 預約編號 | BookingID | 文字 | 系統自動產生，如 `B0001` |
| 日期 | Date | 日期字串 | `yyyy-MM-dd` |
| 開始時間 | StartTime | 文字 | `HH:mm` |
| 結束時間 | EndTime | 文字 | `HH:mm`，可留空 |
| 客戶編號 | CustomerID | 文字 | 對應「客戶資料」工作表 |
| 客戶姓名 | CustomerName | 文字 | 冗餘存一份，方便直接讀取不用查表 |
| 電話 | Phone | 文字 | 客戶電話 |
| 服務項目 | Service | 文字 | 服務項目名稱 |
| 金額 | Price | 數字 | 該筆消費金額 |
| 狀態 | Status | 下拉選單 | `pending` 待確認 / `confirmed` 已確認 / `completed` 已完成 / `cancelled` 已取消 |
| 備註 | Notes | 文字 | 備註 |
| 建立時間 / 更新時間 | CreatedAt / UpdatedAt | 時間戳記 | 系統自動寫入 |

### 客戶資料（工作表分頁：客戶資料）

| 顯示欄名 | 內部代號 | 型別 | 說明 |
|---|---|---|---|
| 客戶編號 | CustomerID | 文字 | 系統自動產生，如 `C0001` |
| 姓名 | Name | 文字 | 姓名 |
| 電話 | Phone | 文字 | 電話（也作為比對既有客戶的依據） |
| 標籤 | Tag | 下拉選單 | `new` 新客 / `regular` 熟客 / `vip` VIP |
| 首次到店日期 / 最近到店日期 | FirstVisitDate / LastVisitDate | 日期字串 | 首次與最近到店日期 |
| 到店次數 | VisitCount | 數字 | 到店次數，預約狀態變更為 `completed` 時自動 +1 |
| 累計消費 | TotalSpend | 數字 | 累計消費，同上自動累加 |
| 備註 | Notes | 文字 | 備註（膚況、偏好色系等） |
| 建立時間 | CreatedAt | 時間戳記 | 建檔時間 |

標籤自動升等規則（寫在 `bumpCustomerVisit_`，可依需求調整）：到店 2 次以上由「新客」升為「熟客」，累計 15 次以上升為「VIP」。

### 服務項目（工作表分頁：服務項目）

| 顯示欄名 | 內部代號 | 型別 | 說明 |
|---|---|---|---|
| 服務編號 | ServiceID | 文字 | 如 `S001` |
| 名稱 | Name | 文字 | 服務名稱 |
| 分類 | Category | 文字 | 美甲／美睫／紋繡等分類 |
| 時長(分鐘) | DurationMin | 數字 | 預估時長（分鐘） |
| 價格 | Price | 數字 | 建議售價 |
| 啟用 | Active | 下拉選單 | `TRUE` / `FALSE`，停用的項目不會出現在前端服務清單 |

初始化時會自動帶入 6 筆範例服務，可直接於試算表刪改。

### 系統設定（工作表分頁：系統設定）

顯示欄名是「設定項目」「值」兩欄，內部代號仍是 `Key`／`Value`。這張表本身是 Key-Value 清單，`Key` 欄實際填入的內容（例如 `ShopName`、`ApiToken`）是程式讀取設定用的識別碼，維持英文以免程式碼要跟著改，初始化時會自動產生：

| Key（設定項目欄裡的值） | 說明 |
|---|---|
| ShopName | 店名，顯示於前端 |
| BusinessHoursStart / BusinessHoursEnd | 營業時間，決定日曆時間軸的顯示範圍 |
| ApiToken | **API 金鑰**，前端每次呼叫都要帶這組值，請勿外流 |
| LineTemplateConfirm / LineTemplateReminder | LINE 訊息範本，`{name}` `{time}` `{service}` 會被前端取代成實際內容 |

---

## 二、部署三步驟

1. **建立試算表副本**：開啟範本 Google 試算表 → 檔案 → 建立副本，存到自己的 Google Drive。
2. **貼上程式碼並部署**：
   - 副本試算表 → 擴充功能 → Apps Script，新建一個 `Code.gs`，貼上本次提供的完整程式碼並儲存。
   - 回到試算表重新整理，選單會出現「美業系統」，點「初始化試算表」（第一次會跳出授權視窗，允許即可）。
   - 在 Apps Script 編輯器點「部署 → 新增部署作業」，類型選「網頁應用程式」，執行身分選「我」，存取權限選「任何人」，完成後複製產生的網址（結尾為 `/exec`）。
3. **回填前端設定**：把 `/exec` 網址與「系統設定」工作表裡的 `ApiToken` 一起貼到系統的「後端設定」欄位即可開始使用。日後若修改程式碼，需要「管理部署作業 → 編輯 → 新版本」重新部署，網址才會套用最新程式。

> 若擔心金鑰外洩，可隨時在選單點「重新產生 API 金鑰」，並同步更新前端設定。

---

## 三、API 一覽

呼叫網址格式：`https://script.google.com/macros/s/{部署ID}/exec`

所有請求都需要帶上 `token`（即 ApiToken）。回傳格式一律為 `{ ok: boolean, data 或 error/message }`。

### 讀取（GET，token 放在網址參數）

| action | 參數 | 說明 |
|---|---|---|
| `ping` | — | 測試連線是否成功 |
| `getBookings` | `date`（單日）或 `from`+`to`（區間） | 取得預約列表 |
| `getCustomers` | `search`（姓名/電話關鍵字）、`tag`（篩選標籤） | 取得客戶列表 |
| `getServices` | — | 取得啟用中的服務項目 |
| `getRevenueSummary` | `months`（預設 6） | 取得近 N 個月營收加總 |
| `getSettings` | — | 取得公開設定（不含 ApiToken） |

範例：
```
GET /exec?action=getBookings&date=2026-08-23&token=xxxxxxxx
```

### 寫入（POST，Content-Type: text/plain，body 為 JSON 字串）

| action | 必要欄位 | 說明 |
|---|---|---|
| `createBooking` | `date`, `startTime`, `service`, `price`, `customerName`, `phone` | 新增預約；若電話號碼比對到既有客戶會自動關聯，否則自動建立新客戶 |
| `updateBookingStatus` | `bookingId`, `status` | 變更預約狀態；改為 `completed` 時會自動更新該客戶的到店次數與累計消費 |
| `cancelBooking` | `bookingId` | 等同 `updateBookingStatus` 並將狀態設為 `cancelled` |
| `upsertCustomer` | `phone` 或 `customerId`；`name`、`tag`、`notes` 選填 | 新增或更新客戶資料 |

範例：
```js
fetch(WEBAPP_URL, {
  method: "POST",
  headers: { "Content-Type": "text/plain" }, // 用 text/plain 可避免瀏覽器發送 CORS 預檢請求而失敗
  body: JSON.stringify({
    action: "createBooking",
    token: API_TOKEN,
    date: "2026-08-25",
    startTime: "14:30",
    service: "手足光療＋卸甲",
    price: 1450,
    customerName: "陳怡君",
    phone: "0912345678",
    status: "confirmed",
  }),
});
```

### 錯誤格式

```json
{ "ok": false, "error": "UNAUTHORIZED", "message": "API 金鑰錯誤" }
```

常見錯誤代碼：`UNAUTHORIZED`（金鑰錯誤）、`UNKNOWN_ACTION`（action 打錯）、`BAD_REQUEST`（JSON 格式錯誤）、`SERVER_ERROR`（其他例外，訊息會附上原始錯誤內容）。

---

## 四、與前端 Demo 對接的建議

前一版純前端 Demo 目前是把資料寫死在 JavaScript 陣列中。串接這組後端時，建議：

- 頁面載入時呼叫 `getBookings`、`getCustomers`、`getRevenueSummary` 取代原本的假資料陣列。
- 新增預約表單改為呼叫 `createBooking`，送出成功後重新呼叫 `getBookings` 刷新畫面。
- 因為 Apps Script 網頁應用程式的回應速度約 1–2 秒，建議前端在請求進行中顯示 loading 狀態，並把最近一次成功取得的資料快取在 LocalStorage，離線或網路較慢時可先顯示快取內容。
