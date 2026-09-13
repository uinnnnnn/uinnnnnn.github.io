(function(){
  "use strict";

  /* ---------- storage ---------- */
  var LS = {
    shop: "od_shop_name",
    materials: "od_materials",
    products: "od_products",
    records: "od_records",
    tutSeen: "od_tutorial_seen"
  };
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

  function loadState(){
    state.shop = load(LS.shop, "");
    state.materials = load(LS.materials, []);
    state.products = load(LS.products, []);
    state.records = load(LS.records, []);
    if(state.records.length === 0 && state.materials.length === 0 && state.products.length === 0 && !state.shop){
      seedExample();
    }
  }

  function seedExample(){
    state.shop = "阿明早餐店";
    state.materials = [
      {id:"m1", name:"鮮奶", unit:"瓶", unitCost:55, note:"每週二、五進貨"},
      {id:"m2", name:"吐司", unit:"條", unitCost:38, note:""},
      {id:"m3", name:"雞蛋", unit:"顆", unitCost:5, note:"一箱 200 顆"}
    ];
    state.products = [
      {id:"p1", name:"蛋餅", unit:"份", price:35, note:""},
      {id:"p2", name:"奶茶", unit:"杯", price:30, note:""},
      {id:"p3", name:"總匯三明治", unit:"份", price:55, note:""}
    ];
    var today = new Date();
    var recs = [];
    for(var i=6;i>=0;i--){
      var d = new Date(today); d.setDate(d.getDate()-i);
      var ds = fmtDate(d);
      var milkQty = 4 + (i%3), eggQty = 40 + i*3;
      var usage = [
        {materialId:"m1", name:"鮮奶", unit:"瓶", unitCost:55, qty:milkQty, subtotal:55*milkQty},
        {materialId:"m3", name:"雞蛋", unit:"顆", unitCost:5, qty:eggQty, subtotal:5*eggQty}
      ];
      var usageTotal = usage[0].subtotal + usage[1].subtotal;
      var eggQ = 28 + i*2, teaQ = 20 + i, sandQ = 8 + (i%4);
      var sales = [
        {productId:"p1", name:"蛋餅", unit:"份", price:35, qty:eggQ, subtotal:35*eggQ},
        {productId:"p2", name:"奶茶", unit:"杯", price:30, qty:teaQ, subtotal:30*teaQ},
        {productId:"p3", name:"總匯三明治", unit:"份", price:55, qty:sandQ, subtotal:55*sandQ}
      ];
      var salesTotal = sales[0].subtotal + sales[1].subtotal + sales[2].subtotal;
      recs.push({
        id:"r"+i, date:ds, revenue:salesTotal,
        revenueExtra:0, salesItems: sales,
        labor: i%2===0 ? 1400 : 900,
        cost: usageTotal,
        costExtra: 0,
        materialUsage: usage,
        other: i===3 ? 350 : 0,
        rent: i===0 ? 18000 : 0,
        note: i===0 ? "範例資料 — 可直接編輯或刪除" : ""
      });
    }
    state.records = recs;
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
  function zhDate(dateStr){
    var parts = dateStr.split("-");
    var d = new Date(parseInt(parts[0]),parseInt(parts[1])-1,parseInt(parts[2]));
    var weekdays = ["日","一","二","三","四","五","六"];
    return parts[1]+"月"+parts[2]+"日 週"+weekdays[d.getDay()];
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
    var base = new Date(today);
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
      return '<div class="rec-item" data-id="'+r.id+'">'+
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
      return '<option value="'+m.id+'"'+(m.id===selectedId?" selected":"")+'>'+escapeHtml(m.name)+(m.unit?" ("+escapeHtml(m.unit)+")":"")+'</option>';
    }).join("");
  }
  function addUsageRow(prefill){
    if(state.materials.length===0) return;
    var rowId = "u"+(usageRowSeq++);
    var row = document.createElement("div");
    row.className = "usage-row";
    row.setAttribute("data-row", rowId);
    var selMaterial = prefill && state.materials.some(function(m){return m.id===prefill.materialId;}) ? prefill.materialId : state.materials[0].id;
    var qty = prefill ? prefill.qty : "";
    row.innerHTML =
      '<select class="usage-select">'+materialOptionsHtml(selMaterial)+'</select>'+
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
      row.setAttribute("data-unitcost", getMaterialUnitCost(sel.value));
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
      return '<option value="'+p.id+'"'+(p.id===selectedId?" selected":"")+'>'+escapeHtml(p.name)+(p.unit?" ("+escapeHtml(p.unit)+")":"")+'</option>';
    }).join("");
  }
  function addSalesRow(prefill){
    if(state.products.length===0) return;
    var rowId = "s"+(salesRowSeq++);
    var row = document.createElement("div");
    row.className = "usage-row";
    row.setAttribute("data-row", rowId);
    var selProduct = prefill && state.products.some(function(p){return p.id===prefill.productId;}) ? prefill.productId : state.products[0].id;
    var qty = prefill ? prefill.qty : "";
    row.innerHTML =
      '<select class="usage-select">'+productOptionsHtml(selProduct)+'</select>'+
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
      row.setAttribute("data-price", getProductPrice(sel.value));
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
        var hasIncome = num(r.revenueExtra)>0 || (r.salesItems||[]).length>0;
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
      var unitCost = parseFloat(row.getAttribute("data-unitcost"))||0;
      materialUsage.push({
        materialId: sel.value,
        name: m ? m.name : "已刪除的材料",
        unit: m ? m.unit : "",
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
      var price = parseFloat(row.getAttribute("data-price"))||0;
      salesItems.push({
        productId: sel.value,
        name: p ? p.name : "已刪除的商品",
        unit: p ? p.unit : "",
        price: price,
        qty: qty,
        subtotal: Math.round(qty*price)
      });
    });
    var materialsSubtotal = materialUsage.reduce(function(s,u){return s+u.subtotal;},0);
    var costExtra = num(document.getElementById("f_cost_extra").value);
    var salesSubtotal = salesItems.reduce(function(s,u){return s+u.subtotal;},0);
    var revenueExtra = num(document.getElementById("f_revenue_extra").value);
    var recDate = document.getElementById("f_date").value || todayStr();
    if(recDate > todayStr()){
      showToast("日期不能選未來，請重新選擇");
      return;
    }
    var rec = {
      id: editingId || uid(),
      date: recDate,
      revenue: salesSubtotal + revenueExtra,
      revenueExtra: revenueExtra,
      salesItems: salesItems,
      labor: num(document.getElementById("f_labor").value),
      cost: materialsSubtotal + costExtra,
      costExtra: costExtra,
      materialUsage: materialUsage,
      other: num(document.getElementById("f_other").value),
      rent: num(document.getElementById("f_rent").value),
      note: document.getElementById("f_note").value.trim()
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
    closeOverlay("recordOverlay");
    askConfirm("刪除這筆紀錄？", "刪除後將無法復原。", function(){
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
      if(m.unitCost>0) meta = '<div class="mat-meta">$'+m.unitCost+(m.unit?" / "+escapeHtml(m.unit):"")+'</div>';
      return '<div class="mat-item" data-id="'+m.id+'">'+
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
    closeOverlay("materialOverlay");
    askConfirm("刪除這項材料？", "已記錄的紀錄不會受影響，但之後記帳將無法再選用這項材料。", function(){
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
      if(p.price>0) meta = '<div class="mat-meta">$'+p.price+(p.unit?" / "+escapeHtml(p.unit):"")+'</div>';
      return '<div class="mat-item" data-id="'+p.id+'">'+
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
    closeOverlay("productOverlay");
    askConfirm("刪除這項商品／品項？", "已記錄的紀錄不會受影響，但之後記帳將無法再選用這個品項。", function(){
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
    var rows = [["日期","當日營業額","人力支出","成本","其他支出","租金","備註"]];
    state.records.slice().sort(function(a,b){return a.date.localeCompare(b.date);}).forEach(function(r){
      rows.push([r.date, r.revenue||0, r.labor||0, r.cost||0, r.other||0, r.rent||0, r.note||""]);
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
      askConfirm("匯入這份備份？", "會覆蓋目前裝置上所有的店家名稱、商品、材料與記帳紀錄，且無法復原。建議先匯出目前資料備份再匯入。", function(){
        state.shop = typeof data.shop==="string" ? data.shop : "";
        state.materials = Array.isArray(data.materials) ? data.materials : [];
        state.products = Array.isArray(data.products) ? data.products : [];
        state.records = Array.isArray(data.records) ? data.records : [];
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

  /* ---------- boot ---------- */
  function renderAll(){
    renderHeader();
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
