(function(){
  "use strict";

  /* ---------- storage ---------- */
  var LS = {
    shop: "od_shop_name",
    materials: "od_materials",
    products: "od_products",
    records: "od_records",
    tutSeen: "od_tutorial_seen",
    version: "od_data_version",
    theme: "od_theme",
    posCart: "od_pos_cart"
  };
  var DATA_VERSION = 2;
  function load(key, fallback){
    try{
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    }catch(e){ return fallback; }
  }
  function save(key, value){
    try{ localStorage.setItem(key, JSON.stringify(value)); }catch(e){}
  }

  var state = {
    shop: "",
    materials: [],
    products: [],
    records: []
  };

  /* ---------- data sanitizing (used for localStorage load and JSON import) ---------- */
  var DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  function str(v){ return v==null ? "" : String(v); }
  function pos(v){ var n = parseFloat(v); return isFinite(n) && n>0 ? n : 0; }
  function objs(v){ return Array.isArray(v) ? v.filter(function(x){ return x && typeof x==="object"; }) : []; }
  function cleanData(data){
    data = data && typeof data==="object" ? data : {};
    var seq = 0;
    return {
      shop: str(data.shop),
      materials: objs(data.materials).map(function(m){
        return {id:str(m.id)||("m"+Date.now()+(seq++)), name:str(m.name), unit:str(m.unit), unitCost:pos(m.unitCost), note:str(m.note)};
      }),
      products: objs(data.products).map(function(p){
        return {id:str(p.id)||("p"+Date.now()+(seq++)), name:str(p.name), unit:str(p.unit), price:pos(p.price), note:str(p.note)};
      }),
      records: objs(data.records).filter(function(r){ return DATE_RE.test(str(r.date)); }).map(function(r){
        return {
          id: str(r.id) || (uid()+(seq++)),
          date: str(r.date),
          revenue: num(r.revenue),
          revenueExtra: num(r.revenueExtra),
          discountCount: num(r.discountCount),
          discount: num(r.discount),
          salesItems: objs(r.salesItems).map(function(s){
            return {productId:str(s.productId), name:str(s.name), unit:str(s.unit), price:pos(s.price), qty:pos(s.qty), subtotal:num(s.subtotal)};
          }),
          labor: num(r.labor),
          cost: num(r.cost),
          costExtra: num(r.costExtra),
          materialUsage: objs(r.materialUsage).map(function(u){
            return {materialId:str(u.materialId), name:str(u.name), unit:str(u.unit), unitCost:pos(u.unitCost), qty:pos(u.qty), subtotal:num(u.subtotal)};
          }),
          other: num(r.other),
          rent: num(r.rent),
          note: str(r.note),
          fromPos: r.fromPos === true
        };
      })
    };
  }

  function loadState(){
    var clean = cleanData({
      shop: load(LS.shop, ""),
      materials: load(LS.materials, []),
      products: load(LS.products, []),
      records: load(LS.records, [])
    });
    state.shop = clean.shop;
    state.materials = clean.materials;
    state.products = clean.products;
    state.records = clean.records;
    var isEmpty = state.records.length === 0 && state.materials.length === 0 && state.products.length === 0 && !state.shop;
    /* 舊版留下的資料沒有版本標記；不是芭樂店清單的就整份換成芭樂店預設 */
    var isOldVersion = load(LS.version, 0) < DATA_VERSION &&
      !state.products.some(function(p){ return p.name === "芭樂小"; });
    if(isEmpty || isOldVersion){
      seedExample();
    }
    save(LS.version, DATA_VERSION);
  }

  var DISCOUNT_UNIT = 10; /* 每次優惠折抵金額 */

  function seedExample(){
    state.shop = "芭樂店";
    /* 進貨成本：單位「元」、單價 1，記帳時「用量」直接填當天進貨金額 */
    var costNote = "記帳時用量直接填進貨金額";
    state.materials = [
      {id:"m1", name:"番茄", unit:"元", unitCost:1, note:costNote},
      {id:"m2", name:"芭樂", unit:"元", unitCost:1, note:costNote},
      {id:"m3", name:"果汁", unit:"元", unitCost:1, note:costNote},
      {id:"m4", name:"其他", unit:"元", unitCost:1, note:costNote}
    ];
    state.products = [
      {id:"p1", name:"芭樂小", unit:"份", price:60, note:""},
      {id:"p2", name:"芭樂大", unit:"份", price:110, note:""},
      {id:"p3", name:"芭樂特大", unit:"份", price:170, note:""},
      {id:"p4", name:"蜜餞番茄小", unit:"份", price:60, note:""}
    ];
    state.records = [];
    save(LS.shop, state.shop);
    save(LS.materials, state.materials);
    save(LS.products, state.products);
    save(LS.records, state.records);
  }

  /* ---------- helpers ---------- */
  function fmtDate(d){
    var y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,"0"), day=String(d.getDate()).padStart(2,"0");
    return y+"-"+m+"-"+day;
  }
  function todayStr(){ return fmtDate(new Date()); }
  function monthKey(dateStr){ return dateStr.slice(0,7); }
  function money(n){
    n = Math.round(n||0);
    return "$"+n.toLocaleString("en-US");
  }
  function num(v){ var n = parseFloat(v); return isFinite(n) && n>0 ? Math.round(n) : 0; }
  function uid(){ return "r"+Date.now()+Math.floor(Math.random()*1000); }
  /* parse "YYYY-MM-DD" as a LOCAL date (new Date("YYYY-MM-DD") is UTC and shifts days west of UTC) */
  function parseDate(dateStr){
    var parts = dateStr.split("-");
    return new Date(parseInt(parts[0],10), parseInt(parts[1],10)-1, parseInt(parts[2],10));
  }
  function zhDate(dateStr){
    var parts = dateStr.split("-");
    var d = parseDate(dateStr);
    var weekdays = ["日","一","二","三","四","五","六"];
    return escapeHtml(parts[1]+"月"+parts[2]+"日 週"+weekdays[d.getDay()]);
  }
  function showToast(msg){
    var t = document.getElementById("toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function(){ t.classList.remove("show"); }, 1800);
  }

  /* ---------- rendering: header ---------- */
  function renderHeader(){
    document.getElementById("shopNameDisplay").textContent = state.shop || "我的店家";
    var d = new Date();
    var weekdays = ["日","一","二","三","四","五","六"];
    document.getElementById("todayLabel").textContent =
      (d.getMonth()+1)+"月"+d.getDate()+"日 星期"+weekdays[d.getDay()];
    document.getElementById("shopNameInput").value = state.shop;
  }

  /* ---------- overview ---------- */
  function computeMonthTotals(mKey){
    var t = {revenue:0, labor:0, cost:0, other:0, rent:0, count:0};
    state.records.forEach(function(r){
      if(monthKey(r.date) === mKey){
        t.revenue += num(r.revenue); t.labor += num(r.labor);
        t.cost += num(r.cost); t.other += num(r.other); t.rent += num(r.rent);
        t.count++;
      }
    });
    return t;
  }

  var selectedMonthKey = monthKey(todayStr());
  function shiftMonthKey(mKey, delta){
    var y = parseInt(mKey.slice(0,4),10), m = parseInt(mKey.slice(5,7),10);
    var d = new Date(y, m-1+delta, 1);
    return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
  }
  function monthLabel(mKey){
    return mKey.slice(0,4)+"年"+parseInt(mKey.slice(5,7),10)+"月";
  }

  function renderOverview(){
    var today = todayStr();
    var todayRevenue = state.records.filter(function(r){return r.date===today;})
      .reduce(function(s,r){return s+num(r.revenue);},0);
    var todayCount = state.records.filter(function(r){return r.date===today;}).length;

    document.getElementById("kpiToday").textContent = money(todayRevenue);
    document.getElementById("kpiTodayNote").textContent = todayCount>0 ? "今日已記錄 "+todayCount+" 筆" : "尚無今日紀錄";

    document.getElementById("monthNavLabel").textContent = monthLabel(selectedMonthKey);
    document.getElementById("monthNextBtn").disabled = (selectedMonthKey >= monthKey(today));

    var mt = computeMonthTotals(selectedMonthKey);
    var totalExpense = mt.labor+mt.cost+mt.other+mt.rent;
    var profit = mt.revenue - totalExpense;
    var margin = mt.revenue>0 ? (profit/mt.revenue*100) : 0;

    document.getElementById("kpiMonthRevenue").textContent = money(mt.revenue);
    document.getElementById("kpiMonthNote").textContent = "累計 "+mt.count+" 筆紀錄";

    var profitEl = document.getElementById("kpiProfit");
    profitEl.textContent = (profit<0?"-":"")+money(Math.abs(profit));
    var trendEl = document.getElementById("kpiProfitTrend");
    if(mt.revenue>0 || totalExpense>0){
      trendEl.innerHTML = '<span class="trend-chip '+(profit>=0?"up":"down")+'">'+
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">'+
        (profit>=0 ? '<path d="M4 16 12 8l8 8"/>' : '<path d="M4 8l8 8 8-8"/>') +
        '</svg>'+(profit>=0?"獲利":"虧損")+'</span>';
    } else {
      trendEl.textContent = "本月尚無資料";
    }
    document.getElementById("kpiMargin").textContent = (mt.revenue>0 ? margin.toFixed(1) : "0.0")+"%";

    renderExpenseBars(mt, totalExpense);
    renderTrendChart(today);
  }

  document.getElementById("monthPrevBtn").addEventListener("click", function(){
    selectedMonthKey = shiftMonthKey(selectedMonthKey, -1);
    renderOverview();
  });
  document.getElementById("monthNextBtn").addEventListener("click", function(){
    var next = shiftMonthKey(selectedMonthKey, 1);
    if(next > monthKey(todayStr())) return;
    selectedMonthKey = next;
    renderOverview();
  });

  function renderExpenseBars(mt, totalExpense){
    document.getElementById("totalExpenseLabel").textContent = "共 "+money(totalExpense);
    var cats = [
      {key:"labor", name:"人力支出", val:mt.labor, color:"var(--cat-labor)"},
      {key:"cost", name:"成本", val:mt.cost, color:"var(--cat-cost)"},
      {key:"other", name:"其他支出", val:mt.other, color:"var(--cat-other)"},
      {key:"rent", name:"租金", val:mt.rent, color:"var(--cat-rent)"}
    ];
    var max = Math.max.apply(null, cats.map(function(c){return c.val;}).concat([1]));
    var html = cats.map(function(c){
      var pct = totalExpense>0 ? (c.val/totalExpense*100) : 0;
      var w = max>0 ? (c.val/max*100) : 0;
      return '<div class="bar-row">'+
        '<span class="bar-name">'+c.name+'</span>'+
        '<div class="bar-track"><div class="bar-fill" style="width:'+w+'%;background:'+c.color+';"></div></div>'+
        '<div><div class="bar-val num">'+money(c.val)+'</div><div class="bar-pct num">'+pct.toFixed(0)+'%</div></div>'+
      '</div>';
    }).join("");
    document.getElementById("expenseBars").innerHTML = html || "";
    if(totalExpense === 0){
      document.getElementById("expenseBars").innerHTML = '<p style="font-size:12.5px;color:var(--muted);margin:4px 2px;">本月尚無支出紀錄</p>';
    }
  }

  var selectedTrendDate = null;

  function renderTrendChart(today){
    var days = [];
    var base = parseDate(today);
    for(var i=6;i>=0;i--){
      var d = new Date(base); d.setDate(d.getDate()-i);
      var ds = fmtDate(d);
      var rev = state.records.filter(function(r){return r.date===ds;}).reduce(function(s,r){return s+num(r.revenue);},0);
      days.push({date:ds, rev:rev, isToday: ds===today, weekday:["日","一","二","三","四","五","六"][d.getDay()]});
    }
    var activeDate = selectedTrendDate || today;
    var max = Math.max.apply(null, days.map(function(d){return d.rev;}).concat([1]));
    var html = days.map(function(d){
      var h = max>0 ? Math.max(d.rev/max*100, d.rev>0?6:0) : 0;
      var isActive = d.date === activeDate;
      return '<button type="button" class="trend-col" data-date="'+d.date+'">'+
        '<div class="trend-bar-wrap">'+
          (isActive ? '<span class="trend-label num">'+ (d.rev>0? money(d.rev):"$0") +'</span>' : '') +
          '<div class="trend-bar'+(d.isToday?" today":"")+(isActive?" selected":"")+'" style="height:'+h+'%;"></div>'+
        '</div>'+
        '<span class="trend-day'+(isActive?" selected":"")+'">'+(d.isToday?"今日":d.weekday)+'</span>'+
      '</button>';
    }).join("");
    document.getElementById("trendChart").innerHTML = html;
    Array.prototype.forEach.call(document.querySelectorAll(".trend-col"), function(el){
      el.addEventListener("click", function(){
        var ds = el.getAttribute("data-date");
        selectedTrendDate = (ds === today) ? null : ds;
        renderTrendChart(today);
      });
    });
    renderDayDetail(activeDate, today);
  }

  function renderDayDetail(dateStr, today){
    var dayRecs = state.records.filter(function(r){return r.date===dateStr;});
    var t = {revenue:0, labor:0, cost:0, other:0, rent:0};
    dayRecs.forEach(function(r){
      t.revenue += num(r.revenue); t.labor += num(r.labor);
      t.cost += num(r.cost); t.other += num(r.other); t.rent += num(r.rent);
    });
    var tags = "";
    if(t.labor>0) tags += tag("人力", "var(--cat-labor)", t.labor);
    if(t.cost>0) tags += tag("成本", "var(--cat-cost)", t.cost);
    if(t.other>0) tags += tag("其他", "var(--cat-other)", t.other);
    if(t.rent>0) tags += tag("租金", "var(--cat-rent)", t.rent);
    if(!tags) tags = '<span class="rec-tag">'+(dayRecs.length? "本日無支出" : "尚無紀錄")+'</span>';
    document.getElementById("dayDetail").innerHTML =
      '<div class="day-detail-head">'+
        '<span class="day-detail-date">'+zhDate(dateStr)+(dateStr===today?"（今日）":"")+'</span>'+
        '<span class="day-detail-revenue num">'+money(t.revenue)+'</span>'+
      '</div>'+
      '<div class="rec-tags">'+tags+'</div>';
  }

  /* ---------- records ---------- */
  var editingId = null;

  function renderRecords(){
    var sorted = state.records.slice().sort(function(a,b){ return b.date.localeCompare(a.date) || (b.id>a.id?1:-1); });
    var list = document.getElementById("recordsList");
    if(sorted.length === 0){
      list.innerHTML = '<div class="empty-state">'+
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M9 3.5h4.5L18 8v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/></svg>'+
        '<p>還沒有記帳紀錄，點上方按鈕新增第一筆</p>'+
      '</div>';
      return;
    }
    var html = sorted.map(function(r){
      var expense = num(r.labor)+num(r.cost)+num(r.other)+num(r.rent);
      var tags = "";
      if(num(r.labor)>0) tags += tag("人力", "var(--cat-labor)", r.labor);
      if(num(r.cost)>0) tags += tag("成本", "var(--cat-cost)", r.cost);
      if(num(r.other)>0) tags += tag("其他", "var(--cat-other)", r.other);
      if(num(r.rent)>0) tags += tag("租金", "var(--cat-rent)", r.rent);
      if(!tags) tags = '<span class="rec-tag">本日無支出</span>';
      return '<div class="rec-item" data-id="'+escapeHtml(r.id)+'">'+
        '<div class="rec-item-top">'+
          '<span class="rec-date">'+zhDate(r.date)+'</span>'+
          '<span class="rec-revenue num">'+money(r.revenue)+'</span>'+
        '</div>'+
        '<div class="rec-tags">'+tags+'</div>'+
      '</div>';
    }).join("");
    list.innerHTML = html;
    Array.prototype.forEach.call(list.querySelectorAll(".rec-item"), function(el){
      el.addEventListener("click", function(){ openRecordForm(el.getAttribute("data-id")); });
    });
  }
  function tag(name, color, val){
    return '<span class="rec-tag"><span class="dot" style="background:'+color+';"></span>'+name+' '+money(val)+'</span>';
  }

  /* -- material usage rows inside the record form -- */
  var usageRowSeq = 0;
  function materialOptionsHtml(selectedId){
    if(state.materials.length===0) return '';
    return state.materials.map(function(m){
      return '<option value="'+escapeHtml(m.id)+'"'+(m.id===selectedId?" selected":"")+'>'+escapeHtml(m.name)+(m.unit?" ("+escapeHtml(m.unit)+")":"")+'</option>';
    }).join("");
  }
  /* an option for an item that was deleted from the list, so editing an old record keeps its original name/price */
  function orphanOptionHtml(id, name, unit, cost, fallbackName){
    return '<option value="'+escapeHtml(id)+'" selected data-orphan="1" data-name="'+escapeHtml(name||fallbackName)+'" data-unit="'+escapeHtml(unit||"")+'" data-cost="'+escapeHtml(cost||0)+'">'+
      escapeHtml(name||fallbackName)+'（已刪除）</option>';
  }
  function selectedCost(sel, lookup){
    var opt = sel.options[sel.selectedIndex];
    if(opt && opt.hasAttribute("data-orphan")) return parseFloat(opt.getAttribute("data-cost"))||0;
    return lookup(sel.value);
  }
  function addUsageRow(prefill){
    if(!prefill && state.materials.length===0) return;
    var rowId = "u"+(usageRowSeq++);
    var row = document.createElement("div");
    row.className = "usage-row";
    row.setAttribute("data-row", rowId);
    var known = prefill && state.materials.some(function(m){return m.id===prefill.materialId;});
    var selMaterial = prefill ? prefill.materialId : state.materials[0].id;
    var qty = prefill ? prefill.qty : "";
    var orphan = (prefill && !known) ? orphanOptionHtml(prefill.materialId, prefill.name, prefill.unit, prefill.unitCost, "已刪除的材料") : "";
    row.innerHTML =
      '<select class="usage-select">'+orphan+materialOptionsHtml(selMaterial)+'</select>'+
      '<input type="number" class="usage-qty" inputmode="decimal" min="0" step="any" placeholder="數量" value="'+(qty||"")+'">'+
      '<span class="usage-sub num">$0</span>'+
      '<button type="button" class="usage-del" aria-label="移除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';
    document.getElementById("usageRows").appendChild(row);
    var sel = row.querySelector(".usage-select");
    var qtyInput = row.querySelector(".usage-qty");
    var subEl = row.querySelector(".usage-sub");
    var unitCost = prefill ? prefill.unitCost : getMaterialUnitCost(selMaterial);
    row.setAttribute("data-unitcost", unitCost);
    function updateSub(){
      var q = parseFloat(qtyInput.value)||0;
      var sub = Math.round(q * parseFloat(row.getAttribute("data-unitcost")||0));
      subEl.textContent = money(sub);
      recomputeUsageTotal();
    }
    sel.addEventListener("change", function(){
      row.setAttribute("data-unitcost", selectedCost(sel, getMaterialUnitCost));
      updateSub();
    });
    qtyInput.addEventListener("input", updateSub);
    row.querySelector(".usage-del").addEventListener("click", function(){
      row.remove();
      recomputeUsageTotal();
    });
    updateSub();
  }
  function getMaterialUnitCost(id){
    var m = state.materials.find(function(x){return x.id===id;});
    return m ? (parseFloat(m.unitCost)||0) : 0;
  }
  function recomputeUsageTotal(){
    var total = 0;
    Array.prototype.forEach.call(document.querySelectorAll("#usageRows .usage-row"), function(row){
      var qty = parseFloat(row.querySelector(".usage-qty").value)||0;
      total += Math.round(qty * parseFloat(row.getAttribute("data-unitcost")||0));
    });
    document.getElementById("usageSubtotal").textContent = money(total);
    return total;
  }
  function resetUsageRows(){
    document.getElementById("usageRows").innerHTML = "";
    usageRowSeq = 0;
    var hasMaterials = state.materials.length>0;
    document.getElementById("usageEmptyHint").style.display = hasMaterials ? "none" : "";
    document.getElementById("addUsageBtn").style.display = hasMaterials ? "" : "none";
    recomputeUsageTotal();
  }
  document.getElementById("addUsageBtn").addEventListener("click", function(){ addUsageRow(null); });

  /* -- sales item rows inside the record form (drives 當日營業額) -- */
  var salesRowSeq = 0;
  function productOptionsHtml(selectedId){
    if(state.products.length===0) return '';
    return state.products.map(function(p){
      return '<option value="'+escapeHtml(p.id)+'"'+(p.id===selectedId?" selected":"")+'>'+escapeHtml(p.name)+(p.unit?" ("+escapeHtml(p.unit)+")":"")+'</option>';
    }).join("");
  }
  function addSalesRow(prefill){
    if(!prefill && state.products.length===0) return;
    var rowId = "s"+(salesRowSeq++);
    var row = document.createElement("div");
    row.className = "usage-row";
    row.setAttribute("data-row", rowId);
    var known = prefill && state.products.some(function(p){return p.id===prefill.productId;});
    var selProduct = prefill ? prefill.productId : state.products[0].id;
    var qty = prefill ? prefill.qty : "";
    var orphan = (prefill && !known) ? orphanOptionHtml(prefill.productId, prefill.name, prefill.unit, prefill.price, "已刪除的商品") : "";
    row.innerHTML =
      '<select class="usage-select">'+orphan+productOptionsHtml(selProduct)+'</select>'+
      '<input type="number" class="usage-qty" inputmode="decimal" min="0" step="any" placeholder="數量" value="'+(qty||"")+'">'+
      '<span class="usage-sub num">$0</span>'+
      '<button type="button" class="usage-del" aria-label="移除"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6 6 18"/></svg></button>';
    document.getElementById("salesRows").appendChild(row);
    var sel = row.querySelector(".usage-select");
    var qtyInput = row.querySelector(".usage-qty");
    var subEl = row.querySelector(".usage-sub");
    var price = prefill ? prefill.price : getProductPrice(selProduct);
    row.setAttribute("data-price", price);
    function updateSub(){
      var q = parseFloat(qtyInput.value)||0;
      var sub = Math.round(q * parseFloat(row.getAttribute("data-price")||0));
      subEl.textContent = money(sub);
      recomputeSalesTotal();
    }
    sel.addEventListener("change", function(){
      row.setAttribute("data-price", selectedCost(sel, getProductPrice));
      updateSub();
    });
    qtyInput.addEventListener("input", updateSub);
    row.querySelector(".usage-del").addEventListener("click", function(){
      row.remove();
      recomputeSalesTotal();
    });
    updateSub();
  }
  function getProductPrice(id){
    var p = state.products.find(function(x){return x.id===id;});
    return p ? (parseFloat(p.price)||0) : 0;
  }
  function recomputeSalesTotal(){
    var total = 0;
    Array.prototype.forEach.call(document.querySelectorAll("#salesRows .usage-row"), function(row){
      var qty = parseFloat(row.querySelector(".usage-qty").value)||0;
      total += Math.round(qty * parseFloat(row.getAttribute("data-price")||0));
    });
    document.getElementById("salesSubtotal").textContent = money(total);
    return total;
  }
  function resetSalesRows(){
    document.getElementById("salesRows").innerHTML = "";
    salesRowSeq = 0;
    var hasProducts = state.products.length>0;
    document.getElementById("salesEmptyHint").style.display = hasProducts ? "none" : "";
    document.getElementById("addSalesBtn").style.display = hasProducts ? "" : "none";
    recomputeSalesTotal();
  }
  document.getElementById("addSalesBtn").addEventListener("click", function(){ addSalesRow(null); });

  /* ---------- 收入／支出分頁 ---------- */
  function setRecordTab(tab){
    Array.prototype.forEach.call(document.querySelectorAll(".record-tab-btn"), function(btn){
      btn.classList.toggle("active", btn.getAttribute("data-tab")===tab);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".record-tab-panel"), function(panel){
      panel.classList.toggle("active", panel.getAttribute("data-tab")===tab);
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll(".record-tab-btn"), function(btn){
    btn.addEventListener("click", function(){ setRecordTab(btn.getAttribute("data-tab")); });
  });

  function openRecordForm(id, preferTab){
    editingId = id || null;
    clearFormDirty("recordOverlay");
    var form = document.getElementById("recordForm");
    form.reset();
    resetUsageRows();
    resetSalesRows();
    document.getElementById("recordDeleteBtn").style.display = "none";
    document.getElementById("f_date").max = todayStr();
    var tab = preferTab || "income";
    if(id){
      var r = state.records.find(function(x){return x.id===id;});
      if(!r) return;
      document.getElementById("recordSheetTitle").textContent = "編輯記帳";
      document.getElementById("f_date").value = r.date;
      document.getElementById("f_revenue_extra").value = r.revenueExtra || "";
      document.getElementById("f_discount_count").value = r.discountCount || "";
      document.getElementById("f_labor").value = r.labor || "";
      document.getElementById("f_cost_extra").value = r.costExtra || "";
      document.getElementById("f_other").value = r.other || "";
      document.getElementById("f_rent").value = r.rent || "";
      document.getElementById("f_note").value = r.note || "";
      (r.materialUsage||[]).forEach(function(u){ addUsageRow(u); });
      (r.salesItems||[]).forEach(function(s){ addSalesRow(s); });
      document.getElementById("recordDeleteBtn").style.display = "";
      if(!preferTab){
        var hasExpense = num(r.labor)>0 || num(r.costExtra)>0 || num(r.other)>0 || num(r.rent)>0 || (r.materialUsage||[]).length>0;
        var hasIncome = num(r.revenueExtra)>0 || num(r.discountCount)>0 || (r.salesItems||[]).length>0;
        if(hasExpense && !hasIncome) tab = "expense";
      }
    } else {
      document.getElementById("recordSheetTitle").textContent = "新增記帳";
      document.getElementById("f_date").value = todayStr();
    }
    setRecordTab(tab);
    openOverlay("recordOverlay");
  }

  document.getElementById("recordForm").addEventListener("submit", function(e){
    e.preventDefault();
    var materialUsage = [];
    Array.prototype.forEach.call(document.querySelectorAll("#usageRows .usage-row"), function(row){
      var sel = row.querySelector(".usage-select");
      var qty = parseFloat(row.querySelector(".usage-qty").value)||0;
      if(qty<=0) return;
      var m = state.materials.find(function(x){return x.id===sel.value;});
      var opt = sel.options[sel.selectedIndex];
      var unitCost = parseFloat(row.getAttribute("data-unitcost"))||0;
      materialUsage.push({
        materialId: sel.value,
        name: m ? m.name : ((opt && opt.getAttribute("data-name")) || "已刪除的材料"),
        unit: m ? m.unit : ((opt && opt.getAttribute("data-unit")) || ""),
        unitCost: unitCost,
        qty: qty,
        subtotal: Math.round(qty*unitCost)
      });
    });
    var salesItems = [];
    Array.prototype.forEach.call(document.querySelectorAll("#salesRows .usage-row"), function(row){
      var sel = row.querySelector(".usage-select");
      var qty = parseFloat(row.querySelector(".usage-qty").value)||0;
      if(qty<=0) return;
      var p = state.products.find(function(x){return x.id===sel.value;});
      var opt = sel.options[sel.selectedIndex];
      var price = parseFloat(row.getAttribute("data-price"))||0;
      salesItems.push({
        productId: sel.value,
        name: p ? p.name : ((opt && opt.getAttribute("data-name")) || "已刪除的商品"),
        unit: p ? p.unit : ((opt && opt.getAttribute("data-unit")) || ""),
        price: price,
        qty: qty,
        subtotal: Math.round(qty*price)
      });
    });
    var materialsSubtotal = materialUsage.reduce(function(s,u){return s+u.subtotal;},0);
    var costExtra = num(document.getElementById("f_cost_extra").value);
    var salesSubtotal = salesItems.reduce(function(s,u){return s+u.subtotal;},0);
    var revenueExtra = num(document.getElementById("f_revenue_extra").value);
    var discountCount = num(document.getElementById("f_discount_count").value);
    var discount = discountCount * DISCOUNT_UNIT;
    var recDate = document.getElementById("f_date").value || todayStr();
    if(recDate > todayStr()){
      showToast("日期不能選未來，請重新選擇");
      return;
    }
    if(discount > salesSubtotal + revenueExtra){
      showToast("優惠折抵超過當日營業額，請確認次數");
      return;
    }
    var rec = {
      id: editingId || uid(),
      date: recDate,
      revenue: salesSubtotal + revenueExtra - discount,
      revenueExtra: revenueExtra,
      discountCount: discountCount,
      discount: discount,
      salesItems: salesItems,
      labor: num(document.getElementById("f_labor").value),
      cost: materialsSubtotal + costExtra,
      costExtra: costExtra,
      materialUsage: materialUsage,
      other: num(document.getElementById("f_other").value),
      rent: num(document.getElementById("f_rent").value),
      note: document.getElementById("f_note").value.trim(),
      fromPos: !!(editingId && state.records.some(function(x){ return x.id===editingId && x.fromPos; }))
    };
    var isAllEmpty = rec.revenue===0 && rec.labor===0 && rec.cost===0 && rec.other===0 && rec.rent===0 && !rec.note;
    if(isAllEmpty){
      showToast("請至少填寫一項金額或備註");
      return;
    }
    if(editingId){
      var idx = state.records.findIndex(function(x){return x.id===editingId;});
      if(idx>-1) state.records[idx] = rec;
    } else {
      state.records.push(rec);
    }
    save(LS.records, state.records);
    clearFormDirty("recordOverlay");
    closeOverlay("recordOverlay");
    renderAll();
    showToast(editingId ? "已更新紀錄" : "已新增紀錄");
  });

  document.getElementById("recordDeleteBtn").addEventListener("click", function(){
    if(!editingId) return;
    askConfirm("刪除這筆紀錄？", "刪除後將無法復原。", function(){
      clearFormDirty("recordOverlay");
      closeOverlay("recordOverlay");
      state.records = state.records.filter(function(x){return x.id!==editingId;});
      save(LS.records, state.records);
      renderAll();
      showToast("已刪除紀錄");
    });
  });

  document.getElementById("addRecordBtn").addEventListener("click", function(){ openRecordForm(null); });
  document.getElementById("quickAddIncomeBtn").addEventListener("click", function(){ openRecordForm(null, "income"); });
  document.getElementById("quickAddExpenseBtn").addEventListener("click", function(){ openRecordForm(null, "expense"); });
  document.getElementById("recordCloseBtn").addEventListener("click", function(){ requestCloseOverlay("recordOverlay"); });

  /* ---------- materials & shop ---------- */
  function escapeHtml(s){
    return String(s).replace(/[&<>"']/g, function(c){
      return ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[c];
    });
  }

  /* unit picker: a real <select> built from units already in use, plus "+ 新增單位" to type a new one */
  function populateUnitSelect(selectId, items, currentUnit){
    var units = [];
    items.forEach(function(it){
      var u = (it.unit||"").trim();
      if(u && units.indexOf(u)===-1) units.push(u);
    });
    if(currentUnit && units.indexOf(currentUnit)===-1) units.push(currentUnit);
    var sel = document.getElementById(selectId);
    sel.innerHTML = '<option value="">(無)</option>' +
      units.map(function(u){ return '<option value="'+escapeHtml(u)+'">'+escapeHtml(u)+'</option>'; }).join("") +
      '<option value="__new__">+ 新增單位…</option>';
    sel.value = currentUnit || "";
    var customInput = document.getElementById(selectId+"_custom");
    customInput.style.display = "none";
    customInput.value = "";
  }
  function wireUnitSelect(selectId){
    var sel = document.getElementById(selectId);
    var customInput = document.getElementById(selectId+"_custom");
    sel.addEventListener("change", function(){
      if(sel.value === "__new__"){
        customInput.style.display = "";
        customInput.focus();
      } else {
        customInput.style.display = "none";
        customInput.value = "";
      }
    });
  }
  function readUnitSelect(selectId){
    var sel = document.getElementById(selectId);
    if(sel.value === "__new__"){
      return document.getElementById(selectId+"_custom").value.trim();
    }
    return sel.value;
  }
  wireUnitSelect("f_mat_unit");
  wireUnitSelect("f_prod_unit");

  function renderMaterials(){
    var list = document.getElementById("materialsList");
    if(state.materials.length === 0){
      list.innerHTML = '<p style="font-size:12.5px;color:var(--muted);margin:4px 2px;">還沒有材料，點上方「新增材料」開始建立清單</p>';
      return;
    }
    list.innerHTML = state.materials.map(function(m){
      var meta = "";
      if(m.unitCost>0) meta = '<div class="mat-meta">$'+escapeHtml(m.unitCost)+(m.unit?" / "+escapeHtml(m.unit):"")+'</div>';
      return '<div class="mat-item" data-id="'+escapeHtml(m.id)+'">'+
        '<div><div class="mat-name">'+escapeHtml(m.name)+'</div>'+meta+(m.note?'<div class="mat-note">'+escapeHtml(m.note)+'</div>':'')+'</div>'+
        '<span class="mat-chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span>'+
      '</div>';
    }).join("");
    Array.prototype.forEach.call(list.querySelectorAll(".mat-item"), function(el){
      el.addEventListener("click", function(){ openMaterialForm(el.getAttribute("data-id")); });
    });
  }

  var editingMaterialId = null;
  function openMaterialForm(id){
    editingMaterialId = id || null;
    clearFormDirty("materialOverlay");
    var form = document.getElementById("materialForm");
    form.reset();
    document.getElementById("materialDeleteBtn").style.display = "none";
    if(id){
      var m = state.materials.find(function(x){return x.id===id;});
      if(!m) return;
      document.getElementById("materialSheetTitle").textContent = "編輯材料";
      document.getElementById("f_mat_name").value = m.name;
      populateUnitSelect("f_mat_unit", state.materials, m.unit || "");
      document.getElementById("f_mat_cost").value = m.unitCost || "";
      document.getElementById("f_mat_note").value = m.note || "";
      document.getElementById("materialDeleteBtn").style.display = "";
    } else {
      document.getElementById("materialSheetTitle").textContent = "新增材料";
      populateUnitSelect("f_mat_unit", state.materials, "");
    }
    openOverlay("materialOverlay");
  }
  document.getElementById("addMaterialBtn").addEventListener("click", function(){ openMaterialForm(null); });
  document.getElementById("materialCloseBtn").addEventListener("click", function(){ requestCloseOverlay("materialOverlay"); });

  function saveMaterial(mat){
    if(editingMaterialId){
      var idx = state.materials.findIndex(function(x){return x.id===editingMaterialId;});
      if(idx>-1) state.materials[idx] = mat;
    } else {
      state.materials.push(mat);
    }
    save(LS.materials, state.materials);
    clearFormDirty("materialOverlay");
    closeOverlay("materialOverlay");
    renderMaterials();
    showToast(editingMaterialId ? "已更新材料" : "已新增材料");
  }
  document.getElementById("materialForm").addEventListener("submit", function(e){
    e.preventDefault();
    var name = document.getElementById("f_mat_name").value.trim();
    if(!name) return;
    var dupMat = state.materials.some(function(m){ return m.id!==editingMaterialId && m.name===name; });
    if(dupMat){
      showToast("已有相同名稱的材料，請用不同名稱區分");
      document.getElementById("f_mat_name").focus();
      return;
    }
    var mat = {
      id: editingMaterialId || ("m"+Date.now()),
      name: name,
      unit: readUnitSelect("f_mat_unit"),
      unitCost: parseFloat(document.getElementById("f_mat_cost").value)||0,
      note: document.getElementById("f_mat_note").value.trim()
    };
    if(mat.unitCost<=0){
      askConfirm("尚未填寫單價？", "單價目前是 0 元，之後用這項材料記帳，成本也會算成 0 元。確定要這樣儲存嗎？", function(){
        saveMaterial(mat);
      });
      return;
    }
    saveMaterial(mat);
  });
  document.getElementById("materialDeleteBtn").addEventListener("click", function(){
    if(!editingMaterialId) return;
    askConfirm("刪除這項材料？", "已記錄的紀錄不會受影響，但之後記帳將無法再選用這項材料。", function(){
      clearFormDirty("materialOverlay");
      closeOverlay("materialOverlay");
      state.materials = state.materials.filter(function(m){return m.id!==editingMaterialId;});
      save(LS.materials, state.materials);
      renderMaterials();
      showToast("已刪除材料");
    });
  });

  /* ---------- products (drive 營業額 in the record form) ---------- */
  function renderProducts(){
    var list = document.getElementById("productsList");
    if(state.products.length === 0){
      list.innerHTML = '<p style="font-size:12.5px;color:var(--muted);margin:4px 2px;">還沒有商品／品項，點上方「新增商品／品項」開始建立清單</p>';
      return;
    }
    list.innerHTML = state.products.map(function(p){
      var meta = "";
      if(p.price>0) meta = '<div class="mat-meta">$'+escapeHtml(p.price)+(p.unit?" / "+escapeHtml(p.unit):"")+'</div>';
      return '<div class="mat-item" data-id="'+escapeHtml(p.id)+'">'+
        '<div><div class="mat-name">'+escapeHtml(p.name)+'</div>'+meta+(p.note?'<div class="mat-note">'+escapeHtml(p.note)+'</div>':'')+'</div>'+
        '<span class="mat-chev"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span>'+
      '</div>';
    }).join("");
    Array.prototype.forEach.call(list.querySelectorAll(".mat-item"), function(el){
      el.addEventListener("click", function(){ openProductForm(el.getAttribute("data-id")); });
    });
  }

  var editingProductId = null;
  function openProductForm(id){
    editingProductId = id || null;
    clearFormDirty("productOverlay");
    var form = document.getElementById("productForm");
    form.reset();
    document.getElementById("productDeleteBtn").style.display = "none";
    if(id){
      var p = state.products.find(function(x){return x.id===id;});
      if(!p) return;
      document.getElementById("productSheetTitle").textContent = "編輯商品／品項";
      document.getElementById("f_prod_name").value = p.name;
      populateUnitSelect("f_prod_unit", state.products, p.unit || "");
      document.getElementById("f_prod_price").value = p.price || "";
      document.getElementById("f_prod_note").value = p.note || "";
      document.getElementById("productDeleteBtn").style.display = "";
    } else {
      document.getElementById("productSheetTitle").textContent = "新增商品／品項";
      populateUnitSelect("f_prod_unit", state.products, "");
    }
    openOverlay("productOverlay");
  }
  document.getElementById("addProductBtn").addEventListener("click", function(){ openProductForm(null); });
  document.getElementById("productCloseBtn").addEventListener("click", function(){ requestCloseOverlay("productOverlay"); });

  function saveProduct(prod){
    if(editingProductId){
      var idx = state.products.findIndex(function(x){return x.id===editingProductId;});
      if(idx>-1) state.products[idx] = prod;
    } else {
      state.products.push(prod);
    }
    save(LS.products, state.products);
    clearFormDirty("productOverlay");
    closeOverlay("productOverlay");
    renderProducts();
    showToast(editingProductId ? "已更新商品" : "已新增商品");
  }
  document.getElementById("productForm").addEventListener("submit", function(e){
    e.preventDefault();
    var name = document.getElementById("f_prod_name").value.trim();
    if(!name) return;
    var dupProd = state.products.some(function(p){ return p.id!==editingProductId && p.name===name; });
    if(dupProd){
      showToast("已有相同名稱的商品／品項，請用不同名稱區分");
      document.getElementById("f_prod_name").focus();
      return;
    }
    var prod = {
      id: editingProductId || ("p"+Date.now()),
      name: name,
      unit: readUnitSelect("f_prod_unit"),
      price: parseFloat(document.getElementById("f_prod_price").value)||0,
      note: document.getElementById("f_prod_note").value.trim()
    };
    if(prod.price<=0){
      askConfirm("尚未填寫售價？", "售價目前是 0 元，之後用這個品項記帳，營業額也會算成 0 元。確定要這樣儲存嗎？", function(){
        saveProduct(prod);
      });
      return;
    }
    saveProduct(prod);
  });
  document.getElementById("productDeleteBtn").addEventListener("click", function(){
    if(!editingProductId) return;
    askConfirm("刪除這項商品／品項？", "已記錄的紀錄不會受影響，但之後記帳將無法再選用這個品項。", function(){
      clearFormDirty("productOverlay");
      closeOverlay("productOverlay");
      state.products = state.products.filter(function(p){return p.id!==editingProductId;});
      save(LS.products, state.products);
      renderProducts();
      showToast("已刪除商品");
    });
  });

  document.getElementById("shopNameInput").addEventListener("input", function(e){
    state.shop = e.target.value;
    save(LS.shop, state.shop);
    document.getElementById("shopNameDisplay").textContent = state.shop || "我的店家";
  });

  /* ---------- export ---------- */
  var downloadsNS = null;
  function ensureDownloads(){
    if(window.claude && window.claude.use){
      return claude.use("downloads").then(function(ns){ downloadsNS = ns; return ns; });
    }
    return Promise.resolve(null);
  }
  ensureDownloads();

  function browserDownload(filename, blob, successMsg){
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(function(){ URL.revokeObjectURL(url); }, 1000);
    showToast(successMsg);
  }

  function offerDownload(filename, content, mime, successMsg){
    var blob = new Blob([content], {type:mime});
    var go = function(ns){
      if(!ns){
        browserDownload(filename, blob, successMsg);
        return;
      }
      ns.save({filename:filename, data:blob}).then(function(res){
        showToast(successMsg);
      }).catch(function(err){
        if(err && err.code==="declined") return;
        if(err && err.code==="rate_limited"){ showToast("請稍候再試一次"); return; }
        if(err && err.code==="unavailable"){ browserDownload(filename, blob, successMsg); return; }
        showToast("匯出失敗，請稍後再試");
      });
    };
    if(downloadsNS){ go(downloadsNS); }
    else { ensureDownloads().then(go); }
  }

  function csvField(v){
    v = String(v==null ? "" : v).replace(/[\r\n]+/g," ");
    if(/[",]/.test(v)){ v = '"'+v.replace(/"/g,'""')+'"'; }
    return v;
  }
  document.getElementById("exportCsvBtn").addEventListener("click", function(){
    var rows = [["日期","當日營業額","優惠折抵","人力支出","成本","其他支出","租金","備註"]];
    state.records.slice().sort(function(a,b){return a.date.localeCompare(b.date);}).forEach(function(r){
      rows.push([r.date, r.revenue||0, r.discount||0, r.labor||0, r.cost||0, r.other||0, r.rent||0, r.note||""]);
    });
    var csv = "﻿" + rows.map(function(row){ return row.map(csvField).join(","); }).join("\r\n");
    offerDownload((state.shop||"營運帳本")+"_記帳資料_"+todayStr()+".csv", csv, "text/csv;charset=utf-8;", "已匯出 CSV");
  });
  document.getElementById("exportJsonBtn").addEventListener("click", function(){
    var payload = {shop:state.shop, materials:state.materials, products:state.products, records:state.records, exportedAt:new Date().toISOString()};
    offerDownload((state.shop||"營運帳本")+"_備份_"+todayStr()+".json", JSON.stringify(payload,null,2), "application/json", "已匯出 JSON 備份");
  });
  document.getElementById("importJsonBtn").addEventListener("click", function(){
    document.getElementById("importFileInput").click();
  });
  document.getElementById("importFileInput").addEventListener("change", function(e){
    var file = e.target.files[0];
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(){
      var data;
      try{ data = JSON.parse(reader.result); }
      catch(err){ showToast("檔案格式錯誤，無法讀取"); e.target.value=""; return; }
      if(!data || typeof data!=="object" || !Array.isArray(data.records)){
        showToast("這不是有效的備份檔案");
        e.target.value = "";
        return;
      }
      var clean = cleanData(data);
      var skipped = data.records.length - clean.records.length;
      askConfirm("匯入這份備份？", "會覆蓋目前裝置上所有的店家名稱、商品、材料與記帳紀錄，且無法復原。建議先匯出目前資料備份再匯入。"+
        (skipped>0 ? "（有 "+skipped+" 筆紀錄日期格式錯誤，將略過不匯入）" : ""), function(){
        state.shop = clean.shop;
        state.materials = clean.materials;
        state.products = clean.products;
        state.records = clean.records;
        save(LS.shop, state.shop);
        save(LS.materials, state.materials);
        save(LS.products, state.products);
        save(LS.records, state.records);
        renderAll();
        showToast("已匯入備份資料");
      });
      e.target.value = "";
    };
    reader.onerror = function(){ showToast("讀取檔案失敗"); e.target.value=""; };
    reader.readAsText(file);
  });

  document.getElementById("resetBtn").addEventListener("click", function(){
    askConfirm("清除所有資料？", "店家名稱、材料清單與所有記帳紀錄都會被刪除，且無法復原。建議先匯出備份。", function(){
      state = {shop:"", materials:[], products:[], records:[]};
      save(LS.shop, ""); save(LS.materials, []); save(LS.products, []); save(LS.records, []);
      renderAll();
      showToast("資料已清除");
    });
  });

  /* ---------- overlays ---------- */
  function openOverlay(id){ document.getElementById(id).classList.add("show"); }
  function closeOverlay(id){ document.getElementById(id).classList.remove("show"); }

  var confirmCb = null;
  function askConfirm(title, text, cb){
    document.getElementById("confirmTitle").textContent = title;
    document.getElementById("confirmText").textContent = text;
    confirmCb = cb;
    openOverlay("confirmOverlay");
  }
  document.getElementById("confirmCancelBtn").addEventListener("click", function(){ closeOverlay("confirmOverlay"); confirmCb=null; });
  document.getElementById("confirmOkBtn").addEventListener("click", function(){
    closeOverlay("confirmOverlay");
    if(confirmCb) confirmCb();
    confirmCb = null;
  });

  /* ---------- 未儲存變更保護（記帳／材料／商品表單） ---------- */
  var GUARDED_OVERLAYS = ["recordOverlay","materialOverlay","productOverlay"];
  var dirtyForms = {};
  function markFormDirty(overlayId){ dirtyForms[overlayId] = true; }
  function clearFormDirty(overlayId){ dirtyForms[overlayId] = false; }
  function requestCloseOverlay(id){
    if(dirtyForms[id]){
      askConfirm("放棄這次編輯？", "目前輸入的內容尚未儲存，離開後將會遺失。", function(){
        clearFormDirty(id);
        closeOverlay(id);
      });
    } else {
      closeOverlay(id);
    }
  }
  GUARDED_OVERLAYS.forEach(function(overlayId){
    var sheet = document.querySelector("#"+overlayId+" .sheet");
    if(!sheet) return;
    sheet.addEventListener("input", function(){ markFormDirty(overlayId); });
    sheet.addEventListener("change", function(){ markFormDirty(overlayId); });
    sheet.addEventListener("click", function(e){
      if(e.target.closest(".usage-del, #addUsageBtn, #addSalesBtn")) markFormDirty(overlayId);
    });
  });

  Array.prototype.forEach.call(document.querySelectorAll(".overlay"), function(ov){
    ov.addEventListener("click", function(e){
      if(e.target!==ov) return;
      if(GUARDED_OVERLAYS.indexOf(ov.id)>-1){ requestCloseOverlay(ov.id); }
      else { ov.classList.remove("show"); }
    });
  });

  /* ---------- KPI 說明 ---------- */
  var KPI_INFO = {
    profit: {
      title: "淨利怎麼算？",
      body: "淨利是這個月的營業額，扣掉所有支出後實際留下的錢。",
      formula: "淨利 = 營業額 −（人力支出 + 成本 + 其他支出 + 租金）"
    },
    margin: {
      title: "毛利率怎麼算？",
      body: "毛利率代表每 100 元營業額中，扣除支出後留下多少比例，數字越高代表賺得越多。",
      formula: "毛利率 = 淨利 ÷ 營業額 × 100%"
    }
  };
  function openKpiInfo(key){
    var info = KPI_INFO[key];
    if(!info) return;
    document.getElementById("infoTitle").textContent = info.title;
    document.getElementById("infoBody").textContent = info.body;
    document.getElementById("infoFormula").textContent = info.formula;
    openOverlay("infoOverlay");
  }
  Array.prototype.forEach.call(document.querySelectorAll(".kpi-info-btn"), function(btn){
    btn.addEventListener("click", function(e){
      e.stopPropagation();
      openKpiInfo(btn.getAttribute("data-info"));
    });
  });
  document.getElementById("infoCloseBtn").addEventListener("click", function(){ closeOverlay("infoOverlay"); });
  document.getElementById("infoOkBtn").addEventListener("click", function(){ closeOverlay("infoOverlay"); });

  /* ---------- nav ---------- */
  function setView(name){
    Array.prototype.forEach.call(document.querySelectorAll(".view"), function(v){ v.classList.remove("active"); });
    document.getElementById("view-"+name).classList.add("active");
    Array.prototype.forEach.call(document.querySelectorAll(".navlink"), function(nl){
      var on = nl.getAttribute("data-view")===name;
      nl.classList.toggle("active", on);
      nl.setAttribute("aria-selected", on ? "true":"false");
    });
    document.querySelector("main").scrollTop = 0;
    window.scrollTo({top:0, behavior:"auto"});
  }
  Array.prototype.forEach.call(document.querySelectorAll(".navlink"), function(nl){
    nl.addEventListener("click", function(){ setView(nl.getAttribute("data-view")); });
  });

  /* ---------- scroll shadow ---------- */
  window.addEventListener("scroll", function(){
    document.getElementById("topbar").classList.toggle("scrolled", window.scrollY>4);
  });

  /* ---------- tutorial ---------- */
  var tutSteps = [
    {
      icon:'<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v8.5a1 1 0 0 0 1 1H10a1 1 0 0 0 1-1V15a1 1 0 0 1 1-1h0a1 1 0 0 1 1 1v3.5a1 1 0 0 0 1 1h3.5a1 1 0 0 0 1-1V10"/>',
      title:"歡迎使用營運帳本",
      body:"這是一個為店家設計的簡易營運看板，幫助你快速掌握每日營業額、支出與獲利狀況。所有資料只存在這台裝置的瀏覽器中，不會上傳到任何伺服器。"
    },
    {
      icon:'<rect x="3.5" y="9" width="17" height="11" rx="2"/><path d="M7 9V5.5a1 1 0 0 1 1-1h8a1 1 0 0 1 1 1V9M7.5 13h2M11 13h2M14.5 13h2"/>',
      title:"「收銀」在攤位記賣出的東西",
      body:"賣出一份就點一下那個商品；客人用優惠券就按「客人用優惠券」。下面大大的數字就是要收的錢，收好錢按「收好錢了，存起來」就記好了。"
    },
    {
      icon:'<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v8.5a1 1 0 0 0 1 1H10a1 1 0 0 0 1-1V15a1 1 0 0 1 1-1h0a1 1 0 0 1 1 1v3.5a1 1 0 0 0 1 1h3.5a1 1 0 0 0 1-1V10"/>',
      title:"「總覽」看懂經營狀況",
      body:"上方是今日營業額。「月份總覽」可用左右箭頭切換查看不同月份的營業額、淨利與毛利率。往下滑可以看到支出結構，以及近 7 日營業額走勢 — 點任一根柱子都能看到當天的明細，不只今日。"
    },
    {
      icon:'<path d="M9 3.5h4.5L18 8v11a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/><path d="M13.5 3.5V8H18M10.5 12h5M10.5 15h5M10.5 18h3"/>',
      title:"「記帳」新增每日紀錄",
      body:"點選「新增一筆記帳」。營業額可以「新增品項銷售」，選商品、填賣出數量，系統用售價自動算出營業額；成本則用「新增材料用量」，選材料填用量自動加總。兩邊都有「其他營業額／其他成本」可以填未列出的項目。點列表中任一筆紀錄可以編輯或刪除。"
    },
    {
      icon:'<path d="M4 10 5.5 4h13L20 10"/><path d="M4 10a2.2 2.2 0 0 0 4.3.8A2.2 2.2 0 0 0 12 10a2.2 2.2 0 0 0 3.7.8A2.2 2.2 0 0 0 20 10"/><path d="M5.5 10.5V19a1 1 0 0 0 1 1H10a1 1 0 0 0 1-1v-3.5a1 1 0 0 1 1-1h0a1 1 0 0 1 1 1V19a1 1 0 0 0 1 1h3.5a1 1 0 0 0 1-1v-8.5"/>',
      title:"「資料」設定店家、商品與材料",
      body:"在這裡輸入店家名稱（會顯示在頂端），並分別建立「商品／品項」與「材料」清單。填上售價／單價後，記帳時就能直接選取算出營業額和成本，不用每次手動加總。點任一項目可以編輯或刪除。"
    },
    {
      icon:'<path d="M12 4v11"/><path d="m7.5 11 4.5 4.5L16.5 11"/><path d="M5 17.5V19a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 19v-1.5"/>',
      title:"「匯出」備份你的資料",
      body:"隨時可以一鍵匯出 CSV（可用 Excel 開啟）或 JSON（完整備份）。建議定期匯出保存，避免清除瀏覽器資料時遺失紀錄。需要重新開始時也可以在此清除所有資料。"
    }
  ];
  var tutIndex = 0;
  function renderTutorial(){
    document.getElementById("tutSteps").innerHTML = tutSteps.map(function(s,i){
      return '<div class="tut-step'+(i===0?" active":"")+'" data-i="'+i+'">'+
        '<div class="tut-icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">'+s.icon+'</svg></div>'+
        '<h3>'+s.title+'</h3><p>'+s.body+'</p>'+
      '</div>';
    }).join("");
    document.getElementById("tutDots").innerHTML = tutSteps.map(function(_,i){
      return '<span class="tut-dot'+(i===0?" active":"")+'" data-i="'+i+'"></span>';
    }).join("");
  }
  function showTutStep(i){
    tutIndex = Math.max(0, Math.min(tutSteps.length-1, i));
    Array.prototype.forEach.call(document.querySelectorAll(".tut-step"), function(el){
      el.classList.toggle("active", parseInt(el.getAttribute("data-i"))===tutIndex);
    });
    Array.prototype.forEach.call(document.querySelectorAll(".tut-dot"), function(el){
      el.classList.toggle("active", parseInt(el.getAttribute("data-i"))===tutIndex);
    });
    document.getElementById("tutPrevBtn").style.visibility = tutIndex===0 ? "hidden":"visible";
    document.getElementById("tutNextBtn").textContent = tutIndex===tutSteps.length-1 ? "開始使用" : "下一步";
  }
  document.getElementById("tutPrevBtn").addEventListener("click", function(){ showTutStep(tutIndex-1); });
  document.getElementById("tutNextBtn").addEventListener("click", function(){
    if(tutIndex===tutSteps.length-1){
      closeOverlay("tutorialOverlay");
      save(LS.tutSeen, true);
    } else {
      showTutStep(tutIndex+1);
    }
  });
  document.getElementById("tutCloseBtn").addEventListener("click", function(){
    closeOverlay("tutorialOverlay");
    save(LS.tutSeen, true);
  });
  document.getElementById("helpBtn").addEventListener("click", function(){
    showTutStep(0);
    openOverlay("tutorialOverlay");
  });

  /* ---------- 收銀頁：點商品 +1，存起來就加進今天的紀錄 ---------- */
  var posCart = {items:{}, coupons:0};
  (function(){
    var saved = load(LS.posCart, null);
    if(saved && typeof saved==="object"){
      posCart.items = saved.items && typeof saved.items==="object" ? saved.items : {};
      posCart.coupons = num(saved.coupons);
    }
  })();
  function posSaveCart(){ save(LS.posCart, posCart); }
  function posLines(){
    return state.products.filter(function(p){ return num(posCart.items[p.id])>0; }).map(function(p){
      var qty = num(posCart.items[p.id]);
      return {product:p, qty:qty, subtotal:Math.round(qty*(parseFloat(p.price)||0))};
    });
  }
  function posSubtotal(){ return posLines().reduce(function(s,l){ return s+l.subtotal; },0); }
  function todayIncome(){
    var today = todayStr();
    return state.records.filter(function(r){ return r.date===today; }).reduce(function(s,r){ return s+num(r.revenue); },0);
  }

  function renderPos(){
    var grid = document.getElementById("posGrid");
    if(state.products.length===0){
      grid.innerHTML = '<p class="pos-sub" style="grid-column:1/-1;">還沒有商品。請大人到「資料」頁新增商品和價錢。</p>';
    } else {
      grid.innerHTML = state.products.map(function(p){
        var qty = num(posCart.items[p.id]);
        return '<div class="pos-item'+(qty>0?" has-count":"")+'">'+
          '<button type="button" class="pos-add" data-id="'+escapeHtml(p.id)+'" aria-label="'+escapeHtml(p.name)+' 加一份">'+
            '<span class="pos-name">'+escapeHtml(p.name)+'</span>'+
            '<span class="pos-price num">'+money(p.price)+'</span>'+
            '<span class="pos-count num">'+qty+'</span>'+
          '</button>'+
          '<button type="button" class="pos-minus" data-id="'+escapeHtml(p.id)+'" aria-label="'+escapeHtml(p.name)+' 減一份"'+(qty>0?"":" disabled")+'>−</button>'+
        '</div>';
      }).join("");
    }
    var sub = posSubtotal();
    var discount = posCart.coupons * DISCOUNT_UNIT;
    var total = Math.max(0, sub - discount);
    document.getElementById("posCoupon").classList.toggle("has-count", posCart.coupons>0);
    document.getElementById("posCouponCount").textContent = posCart.coupons;
    document.getElementById("posCouponMinus").disabled = posCart.coupons===0;
    document.getElementById("posTotal").textContent = money(total);
    var lines = posLines();
    document.getElementById("posTotalDetail").textContent = lines.length===0 ? "還沒點任何東西" :
      lines.map(function(l){ return l.product.name+" × "+l.qty; }).join("、") +
      (discount>0 ? "，優惠券少收 "+money(discount) : "");
    var todaySum = todayIncome();
    document.getElementById("posToday").textContent = todaySum>0 ? "今天已經存了 "+money(todaySum) : "今天還沒有賣出紀錄";
  }

  function posAdd(id, delta){
    var qty = num(posCart.items[id]) + delta;
    if(qty>0) posCart.items[id] = qty; else delete posCart.items[id];
    /* 東西變少後，優惠券不能比要收的錢多 */
    while(posCart.coupons>0 && posCart.coupons*DISCOUNT_UNIT > posSubtotal()) posCart.coupons--;
    posSaveCart();
    renderPos();
  }
  function posCoupon(delta){
    if(delta>0){
      if(posSubtotal()===0){ showToast("先點賣出的東西，才能用優惠券"); return; }
      if((posCart.coupons+1)*DISCOUNT_UNIT > posSubtotal()){ showToast("優惠券不能比要收的錢還多"); return; }
    }
    posCart.coupons = Math.max(0, posCart.coupons + delta);
    posSaveCart();
    renderPos();
  }
  function posClear(){
    posCart = {items:{}, coupons:0};
    posSaveCart();
    renderPos();
  }
  function posCommit(){
    var lines = posLines();
    if(lines.length===0){ showToast("還沒點任何東西喔"); return; }
    var today = todayStr();
    var rec = state.records.filter(function(r){ return r.date===today && r.fromPos; })[0];
    if(!rec){
      rec = {id:uid(), date:today, revenue:0, revenueExtra:0, discountCount:0, discount:0, salesItems:[],
        labor:0, cost:0, costExtra:0, materialUsage:[], other:0, rent:0, note:"收銀頁記錄", fromPos:true};
      state.records.push(rec);
    }
    lines.forEach(function(l){
      var price = parseFloat(l.product.price)||0;
      var item = rec.salesItems.filter(function(s){ return s.productId===l.product.id && s.price===price; })[0];
      if(item){ item.qty += l.qty; item.subtotal = Math.round(item.qty*price); }
      else rec.salesItems.push({productId:l.product.id, name:l.product.name, unit:l.product.unit, price:price, qty:l.qty, subtotal:l.subtotal});
    });
    rec.discountCount = num(rec.discountCount) + posCart.coupons;
    rec.discount = rec.discountCount * DISCOUNT_UNIT;
    var sales = rec.salesItems.reduce(function(s,i){ return s+num(i.subtotal); },0);
    rec.revenue = Math.max(0, sales + num(rec.revenueExtra) - rec.discount);
    save(LS.records, state.records);
    posClear();
    renderAll();
    showToast("存好了！今天一共收了 "+money(todayIncome()));
  }

  document.getElementById("posGrid").addEventListener("click", function(e){
    var add = e.target.closest(".pos-add");
    var minus = e.target.closest(".pos-minus");
    if(add) posAdd(add.getAttribute("data-id"), 1);
    else if(minus && !minus.disabled) posAdd(minus.getAttribute("data-id"), -1);
  });
  document.getElementById("posCouponBtn").addEventListener("click", function(){ posCoupon(1); });
  document.getElementById("posCouponMinus").addEventListener("click", function(){ posCoupon(-1); });
  document.getElementById("posSaveBtn").addEventListener("click", posCommit);
  document.getElementById("posClearBtn").addEventListener("click", function(){
    if(posLines().length===0 && posCart.coupons===0) return;
    askConfirm("全部清掉？", "這次點的東西都會清掉，還沒存的不會記到帳上。", posClear);
  });

  /* ---------- 外觀：跟隨系統／淺色／深色 ---------- */
  function applyTheme(theme){
    if(theme==="light" || theme==="dark") document.documentElement.setAttribute("data-theme", theme);
    else { theme = "system"; document.documentElement.removeAttribute("data-theme"); }
    Array.prototype.forEach.call(document.querySelectorAll("#themeSeg button"), function(btn){
      var on = btn.getAttribute("data-theme-opt")===theme;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-checked", on ? "true" : "false");
    });
  }
  Array.prototype.forEach.call(document.querySelectorAll("#themeSeg button"), function(btn){
    btn.addEventListener("click", function(){
      var theme = btn.getAttribute("data-theme-opt");
      save(LS.theme, theme);
      applyTheme(theme);
    });
  });
  applyTheme(load(LS.theme, "system"));

  /* ---------- 互動導覽：逐步高亮並實際操作每個功能 ---------- */
  var TOUR_NOTE = "導覽示範紀錄（導覽結束會自動刪除）";
  var tour = {i:0, recordId:null};

  function $(sel){ return document.querySelector(sel); }
  function closeAllOverlays(){
    GUARDED_OVERLAYS.forEach(clearFormDirty);
    Array.prototype.forEach.call(document.querySelectorAll(".overlay.show"), function(ov){ ov.classList.remove("show"); });
  }
  function pickByName(list, name){
    return list.filter(function(x){ return x.name===name; })[0] || list[0];
  }
  /* 在記帳表單加一列，選好項目、填好數量（跟手動操作走同一條路，會觸發小計計算） */
  function tourFillRow(addFn, rowsSel, item, qty){
    addFn(null);
    var rows = document.querySelectorAll(rowsSel+" .usage-row");
    var row = rows[rows.length-1];
    if(!row) return;
    var sel = row.querySelector(".usage-select");
    sel.value = item.id;
    sel.dispatchEvent(new Event("change", {bubbles:true}));
    var q = row.querySelector(".usage-qty");
    q.value = qty;
    q.dispatchEvent(new Event("input", {bubbles:true}));
  }
  function tourSetInput(id, val){
    var el = document.getElementById(id);
    el.value = val;
    el.dispatchEvent(new Event("input", {bubbles:true}));
  }
  function hasProducts(){ return state.products.length>0; }
  function hasMaterials(){ return state.materials.length>0; }

  var tourSteps = [
    {target:".navpill", title:"底部選單",
     body:"App 分成五頁：「收銀」在攤位記賣出的東西、「總覽」看經營狀況、「記帳」看每日紀錄、「資料」設定商品和材料、「匯出」備份資料。接下來會帶你實際操作每個功能。",
     run:function(){ setView("pos"); }},
    {target:".pos-grid", title:"收銀：點一下就 +1",
     body:"在攤位上最常用這頁。賣出一份就點一下那個商品，右上角的數字會加 1；點錯了按下面的「−」。這裡示範點了兩份芭樂小。",
     skip:function(){ return !hasProducts(); },
     run:function(){
       setView("pos");
       posCart = {items:{}, coupons:0};
       var p = pickByName(state.products, "芭樂小");
       posAdd(p.id, 1); posAdd(p.id, 1);
     }},
    {target:".pos-coupon", title:"客人用優惠券",
     body:"客人拿優惠券，就按這裡，每張少收 $10。",
     skip:function(){ return !hasProducts(); },
     run:function(){ posCoupon(1); }},
    {target:".pos-total-card", title:"這次要收多少",
     body:"大大的數字就是要跟客人收的錢。收好錢後按「收好錢了，存起來」，就會記到今天的帳上，畫面也會清空，換下一位客人。（導覽中不會真的存。）",
     skip:function(){ return !hasProducts(); }},
    {target:".quick-add-row", title:"記一筆收入／支出",
     body:"「總覽」頁上方這兩顆按鈕，可以一次記比較完整的帳，例如人力和進貨。我們先點「記一筆收入」，示範記一筆帳。",
     run:function(){ posCart = {items:{}, coupons:0}; renderPos(); setView("overview"); }},
    {target:".record-tabs", title:"收入與支出分頁",
     body:"記帳表單分成「收入」和「支出」兩頁，同一筆紀錄可以兩邊都填。上方日期預設是今天，也可以補記之前的日子。",
     run:function(){ openRecordForm(null, "income"); }},
    {target:"#salesRows .usage-row:last-child", title:"新增品項銷售",
     body:"點「新增品項銷售」，選商品、填賣出數量，系統用售價自動算小計。這裡示範賣出芭樂大 2 份。",
     skip:function(){ return !hasProducts(); },
     run:function(){ tourFillRow(addSalesRow, "#salesRows", pickByName(state.products, "芭樂大"), 2); }},
    {target:"#salesSubtotal", pad:10, title:"品項小計自動加總",
     body:"可以加很多列。再加一列芭樂小 1 份，下方「品項小計」會自動加總。",
     skip:function(){ return !hasProducts(); },
     run:function(){ tourFillRow(addSalesRow, "#salesRows", pickByName(state.products, "芭樂小"), 1); }},
    {target:"#f_revenue_extra", title:"其他營業額",
     body:"賣了清單上沒有的東西，例如臨時加賣的品項，把金額直接填在這裡。"},
    {target:"#f_discount_count", title:"優惠折抵",
     body:"有客人用優惠時，填使用次數，每次折 $10，會從當日營業額扣掉。這裡示範用了 1 次。",
     skip:function(){ return !hasProducts(); },
     run:function(){ tourSetInput("f_discount_count", 1); }},
    {target:"#f_labor", title:"支出：人力成本",
     body:"切到「支出」頁，填當天的人力費用。示範填 $800。",
     run:function(){ setRecordTab("expense"); tourSetInput("f_labor", 800); }},
    {target:"#usageRows .usage-row:last-child", title:"進貨成本",
     body:"點「新增材料用量」，選進貨分類（番茄、芭樂、果汁、其他）。單位是「元」，所以數量欄直接填進貨金額。示範芭樂進貨 $300。",
     skip:function(){ return !hasMaterials(); },
     run:function(){ setRecordTab("expense"); tourFillRow(addUsageRow, "#usageRows", pickByName(state.materials, "芭樂"), 300); }},
    {target:".record-tab-panel.active .field-row", title:"其他支出與租金",
     body:"雜支、袋子、瓦斯等填「其他支出」；租金在繳的那天填一次就好，其他天留空。",
     run:function(){ setRecordTab("expense"); }},
    {target:"#f_note", title:"備註",
     body:"可以記下當天狀況，例如下雨客人少。",
     run:function(){ tourSetInput("f_note", TOUR_NOTE); }},
    {target:"#recordForm button[type=submit]", title:"儲存",
     body:"按「儲存」就記好了。按下一步會幫你實際儲存這筆示範紀錄。"},
    {target:".kpi-tile.accent", title:"今日營業額",
     body:"儲存後回到總覽，今日營業額已經算好了：品項銷售扣掉優惠折抵。",
     run:function(){
       var before = state.records.map(function(r){ return r.id; });
       editingId = null;
       document.getElementById("recordForm").dispatchEvent(new Event("submit", {cancelable:true}));
       var added = state.records.filter(function(r){ return before.indexOf(r.id)===-1; })[0];
       if(added) tour.recordId = added.id;
       closeAllOverlays();
       selectedMonthKey = monthKey(todayStr());
       renderOverview();
       setView("overview");
     }},
    {target:".month-switch-row", title:"月份總覽",
     body:"用左右箭頭切換月份，下方顯示該月的營業額、淨利和毛利率。"},
    {target:"#infoOverlay .sheet", title:"看懂每個數字",
     body:"淨利、毛利率旁邊的「!」可以看計算方式。",
     run:function(){ openKpiInfo("profit"); }},
    {target:"#expenseBars", pad:10, title:"支出結構",
     body:"本月的人力、成本、其他支出、租金各占多少，一眼就看得出來。",
     run:function(){ closeOverlay("infoOverlay"); }},
    {target:"#trendChart", pad:8, title:"近 7 日營業額",
     body:"每根柱子是一天的營業額。點任一根，下方會顯示那天的明細。"},
    {target:"#dayDetail", pad:8, title:"當天明細",
     body:"這裡顯示選到那天的營業額，以及人力、成本等支出。"},
    {target:"#recordsList .rec-item", title:"記帳列表",
     body:"「記帳」頁會列出所有紀錄，最新的在上面。點任一筆可以重新編輯或刪除。",
     run:function(){ setView("records"); }},
    {target:"#recordDeleteBtn", title:"編輯與刪除",
     body:"點開紀錄後可以修改內容再儲存，或按「刪除」移除。這筆示範紀錄會在導覽結束時自動刪掉。",
     run:function(){ if(tour.recordId) openRecordForm(tour.recordId); }},
    {target:"#shopNameInput", title:"店家名稱",
     body:"「資料」頁可以改店家名稱，會顯示在畫面頂端。",
     run:function(){ closeAllOverlays(); setView("shop"); }},
    {target:"#productOverlay .sheet", title:"商品／品項",
     body:"點「新增商品／品項」可以加新商品；點清單上的商品可以改名稱、售價或刪除。售價改了以後，只影響之後的新紀錄。",
     skip:function(){ return !hasProducts(); },
     run:function(){ openProductForm(state.products[0].id); }},
    {target:"#materialOverlay .sheet", title:"材料／進貨分類",
     body:"進貨分類也能在這裡新增或修改。想改成照斤數算，可以把單位改成「斤」、填上每斤單價。",
     skip:function(){ return !hasMaterials(); },
     run:function(){ closeAllOverlays(); openMaterialForm(state.materials[0].id); }},
    {target:".export-grid", pad:8, title:"匯出備份",
     body:"「匯出 CSV」可以用 Excel 開；「匯出 JSON」是完整備份。資料只存在這台裝置，建議定期匯出。",
     run:function(){ closeAllOverlays(); setView("export"); }},
    {target:"#importJsonBtn", title:"還原資料",
     body:"換手機時，用「匯入 JSON 備份」把之前匯出的檔案還原回來。"},
    {target:"#resetBtn", title:"清除所有資料",
     body:"要重新開始時用這個。清除後會回到芭樂店的預設清單（導覽不會按它）。"},
    {target:"#helpBtn", pad:4, title:"導覽完成",
     body:"想再看一次，點右上角的「?」就能重新開啟教學和導覽。按「完成」會刪掉示範紀錄，回到收銀頁。",
     run:function(){ setView("overview"); }}
  ];

  function tourVisibleSteps(){
    return tourSteps.filter(function(s){ return !(s.skip && s.skip()); });
  }
  function tourPosition(){
    var steps = tourVisibleSteps();
    var step = steps[tour.i];
    var spot = document.getElementById("tourSpot");
    var card = document.getElementById("tourCard");
    var el = step && $(step.target);
    if(!el){ spot.style.width = "0px"; spot.style.height = "0px"; return; }
    var pad = step.pad || 6;
    var r = el.getBoundingClientRect();
    spot.style.top = (r.top-pad)+"px";
    spot.style.left = (r.left-pad)+"px";
    spot.style.width = (r.width+pad*2)+"px";
    spot.style.height = (r.height+pad*2)+"px";
    var inTopHalf = (r.top + r.height/2) < window.innerHeight/2;
    card.classList.toggle("at-bottom", inTopHalf);
    card.classList.toggle("at-top", !inTopHalf);
  }
  function tourShow(){
    var steps = tourVisibleSteps();
    var step = steps[tour.i];
    if(step.run) step.run();
    document.getElementById("tourProgress").textContent = (tour.i+1)+" / "+steps.length;
    document.getElementById("tourTitle").textContent = step.title;
    document.getElementById("tourBody").textContent = step.body;
    document.getElementById("tourNextBtn").textContent = tour.i===steps.length-1 ? "完成" : "下一步";
    var el = $(step.target);
    if(el && el.scrollIntoView) el.scrollIntoView({block:"center", behavior:"auto"});
    tourPosition();
    setTimeout(tourPosition, 260); /* 等表單滑入動畫結束再對位 */
  }
  function startTour(){
    closeAllOverlays();
    tour.i = 0; tour.recordId = null;
    tour.savedCart = JSON.parse(JSON.stringify(posCart));
    document.body.classList.add("tour-on");
    document.getElementById("tourLayer").classList.add("show");
    tourShow();
  }
  function endTour(){
    document.body.classList.remove("tour-on");
    document.getElementById("tourLayer").classList.remove("show");
    closeAllOverlays();
    if(tour.recordId){
      state.records = state.records.filter(function(r){ return r.id!==tour.recordId; });
      save(LS.records, state.records);
      tour.recordId = null;
      showToast("導覽完成，示範紀錄已刪除");
    }
    selectedTrendDate = null;
    if(tour.savedCart){ posCart = tour.savedCart; tour.savedCart = null; posSaveCart(); }
    renderAll();
    setView("pos");
  }
  document.getElementById("tourNextBtn").addEventListener("click", function(){
    if(tour.i >= tourVisibleSteps().length-1){ endTour(); return; }
    tour.i++;
    tourShow();
  });
  document.getElementById("tourExitBtn").addEventListener("click", endTour);
  document.getElementById("tourStartBtn").addEventListener("click", function(){
    closeOverlay("tutorialOverlay");
    save(LS.tutSeen, true);
    startTour();
  });
  function tourReposition(){ if(document.getElementById("tourLayer").classList.contains("show")) tourPosition(); }
  window.addEventListener("resize", tourReposition);
  window.addEventListener("scroll", tourReposition, true);

  /* ---------- boot ---------- */
  function renderAll(){
    renderHeader();
    renderPos();
    renderOverview();
    renderRecords();
    renderMaterials();
    renderProducts();
  }

  function start(hotData){
    loadState();
    renderTutorial();
    renderAll();
    if(!load(LS.tutSeen, false)){
      setTimeout(function(){ showTutStep(0); openOverlay("tutorialOverlay"); }, 400);
    }
  }

  if(window.claude && window.claude.hot){
    window.claude.hot.ready ? window.claude.hot.ready(start) : start(window.claude.hot.data || {});
  } else {
    start({});
  }
})();