/**
 * 玉荷包荔枝 LIFF 訂購頁
 * ------------------------------------------------------------
 * CONFIG（使用 deploy/deploy.mjs 部署時會自動填入 API_URL）：
 *   API_URL  ：Google Apps Script 網頁應用程式的 /exec 網址
 *   LIFF_ID  ：可留空，會自動從後端設定取得（「一鍵設定 LINE」建立 LIFF 後產生）
 *
 * 本機預覽：網址加上 ?mock=1（或 API_URL 尚未設定）會使用模擬資料，不連線 LINE 與 GAS。
 * 注意：前端計算的金額僅供顯示，實際金額一律由後端重新計算。
 */
const CONFIG = {
  LIFF_ID: '',
  API_URL: 'https://script.google.com/macros/s/AKfycbwj5D8JDk8L9P2Owy0S8c3Zis8V_EEV-5Dde4aHvBVbWDT0obhwy5_MdFM_eIv9oYfK/exec',
};

const MOCK = new URLSearchParams(location.search).has('mock') || CONFIG.API_URL.includes('YOUR_');
const PROFILE_KEY = 'lychee_profile_v1';
const PHONE_RE = /^(09\d{8}|0[2-8]\d{7,8})$/;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;

const state = {
  cfg: null,
  step: 1,
  qty5: 0,
  qty10: 0,
  requestId: newRequestId(),
  submitting: false,
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function newRequestId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}
const money = (n) => 'NT$' + Number(n || 0).toLocaleString('en-US');
const normPhone = (v) => {
  let p = String(v || '').replace(/[\s\-()（）]/g, '');
  if (p.startsWith('+886')) p = '0' + p.slice(4);
  return p;
};

// ------------------------------------------------------------
// API
// ------------------------------------------------------------

async function api(action, payload = {}) {
  if (MOCK) return mockApi(action, payload);
  const body = { action, ...payload };
  if (action !== 'config') {
    body.idToken = liff.getIDToken();
    if (!body.idToken) throw Object.assign(new Error('無法取得 LINE 登入資訊，請重新開啟頁面'), { code: 'AUTH' });
  }
  let res;
  try {
    // 使用 text/plain 避免 CORS 預檢（GAS 不支援 OPTIONS）
    res = await fetch(CONFIG.API_URL + '?route=api', {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw Object.assign(new Error('網路連線不穩定，請稍後再試'), { code: 'NETWORK' });
  }
  let json;
  try { json = await res.json(); } catch (e) {
    throw Object.assign(new Error('伺服器回應異常，請稍後再試'), { code: 'NETWORK' });
  }
  if (!json.ok) throw Object.assign(new Error(json.message || '發生錯誤'), { code: json.error });
  return json.data;
}

// ---- 模擬資料（本機預覽用） ----
const MOCK_CFG = {
  shopName: '○○果園 大樹玉荷包（預覽模式）',
  price5: 1200, price10: 2200, maxQty: 20,
  timeSlots: ['不指定', '13 時前', '14–18 時'],
  shippingNote: '含運（台灣本島），依採收狀況陸續出貨',
  open: true, closedMessage: '', closeAt: '2026/12/04 23:59', oaId: '@demo', contact: '07-000-0000',
};
let mockSeq = 0;
async function mockApi(action, p) {
  await new Promise((r) => setTimeout(r, 400));
  if (action === 'config') return MOCK_CFG;
  if (action === 'createOrder') {
    const o = p.order;
    mockSeq += 1;
    return {
      duplicated: false,
      order: {
        orderId: 'LY261104-' + String(mockSeq).padStart(4, '0'),
        createdAt: new Date().toLocaleString('zh-TW', { hour12: false }),
        qty5: o.qty5, qty10: o.qty10,
        amt5: o.qty5 * MOCK_CFG.price5, amt10: o.qty10 * MOCK_CFG.price10,
        total: o.qty5 * MOCK_CFG.price5 + o.qty10 * MOCK_CFG.price10,
        rcptName: o.rcptName, rcptAddr: o.rcptAddr, timeSlot: o.timeSlot, concierge: o.concierge,
        payStatus: '未付款', status: '已成立', payDeadline: '2026/11/07',
        paymentInfo: '銀行：○○銀行（代碼 000）○○分行\n帳號：000-000-000000\n戶名：○○○',
      },
    };
  }
  throw new Error('mock: unknown action');
}

// ------------------------------------------------------------
// 初始化
// ------------------------------------------------------------

async function init() {
  loading(true, '載入中…');
  try {
    state.cfg = await api('config'); // 公開設定不需登入，內含 LIFF ID
    if (!MOCK) {
      const liffId = CONFIG.LIFF_ID || state.cfg.liffId;
      if (!liffId) throw new Error('系統尚未完成 LINE 設定，請稍後再試');
      await liff.init({ liffId });
      if (!liff.isLoggedIn()) {
        liff.login({ redirectUri: location.href });
        return;
      }
    }
    renderConfig();
    restoreProfile();
    bindEvents();
    updateTotals();
    checkFriendship();
  } catch (e) {
    showBanner(e.message || '頁面載入失敗，請關閉後重新開啟', true);
    $('#btnNext').disabled = true;
  } finally {
    loading(false);
  }
}

function renderConfig() {
  const c = state.cfg;
  $('#shopName').textContent = c.shopName;
  document.title = c.shopName + '｜禮盒訂購';
  $('#shipNote').textContent = c.shippingNote || '';
  $('#price5').textContent = money(c.price5) + '／盒';
  $('#price10').textContent = money(c.price10) + '／盒';
  $('#qty5').max = c.maxQty;
  $('#qty10').max = c.maxQty;
  $('#closeHint').textContent = c.closeAt ? '接單至 ' + c.closeAt + ' 止，售完為止。' : '';

  const box = $('#timeSlots');
  box.textContent = '';
  c.timeSlots.forEach((slot, i) => {
    const label = document.createElement('label');
    label.className = 'chip';
    const input = document.createElement('input');
    input.type = 'radio'; input.name = 'timeSlot'; input.value = slot;
    if (i === 0) input.checked = true;
    const span = document.createElement('span');
    span.textContent = slot;
    label.append(input, span);
    box.append(label);
  });

  if (!c.open) {
    showBanner(c.closedMessage || '目前未開放訂購', true);
    $('#btnNext').disabled = true;
  }
}

async function checkFriendship() {
  if (MOCK || !liff.getFriendship) return;
  try {
    const f = await liff.getFriendship();
    if (!f.friendFlag && state.cfg.oaId) {
      const b = $('#banner');
      b.className = 'banner';
      b.textContent = '請先加入官方帳號好友，才能收到訂單與付款通知。 ';
      const a = document.createElement('a');
      a.href = 'https://line.me/R/ti/p/' + encodeURIComponent(state.cfg.oaId);
      a.textContent = '立即加入 ›';
      b.append(a);
      b.hidden = false;
    }
  } catch (e) { /* 未授權 profile 等情況忽略 */ }
}

// ------------------------------------------------------------
// 事件
// ------------------------------------------------------------

function bindEvents() {
  $$('.product').forEach((card) => {
    const sku = card.dataset.sku;
    const input = card.querySelector('input');
    card.querySelector('.minus').addEventListener('click', () => setQty(sku, state['qty' + sku] - 1));
    card.querySelector('.plus').addEventListener('click', () => setQty(sku, state['qty' + sku] + 1));
    input.addEventListener('input', () => setQty(sku, parseInt(input.value, 10) || 0, true));
    input.addEventListener('blur', () => setQty(sku, state['qty' + sku]));
  });

  $('#sameAsBuyer').addEventListener('change', syncRecipient);
  ['#name', '#phone'].forEach((s) => $(s).addEventListener('input', () => {
    if ($('#sameAsBuyer').checked) syncRecipient();
  }));
  $('#note').addEventListener('input', () => { $('#noteCount').textContent = $('#note').value.length; });
  $$('.field input, .field textarea').forEach((el) => el.addEventListener('input', () => clearErr(el)));

  $('#btnNext').addEventListener('click', next);
  $('#btnPrev').addEventListener('click', () => goStep(state.step - 1));
  $('#btnClose').addEventListener('click', () => {
    if (!MOCK && liff.isInClient()) liff.closeWindow(); else toast('已完成，可關閉此頁面');
  });
  $('#btnAgain').addEventListener('click', resetForAnother);
}

function setQty(sku, n, typing) {
  const max = state.cfg.maxQty;
  n = Math.max(0, Math.min(max, Number.isFinite(n) ? n : 0));
  state['qty' + sku] = n;
  const input = $('#qty' + sku);
  if (!typing || String(n) !== input.value) input.value = n;
  updateTotals();
}

function updateTotals() {
  const c = state.cfg;
  if (!c) return;
  const a5 = state.qty5 * c.price5;
  const a10 = state.qty10 * c.price10;
  $('#sub5').textContent = money(a5);
  $('#sub10').textContent = money(a10);
  $('#total').textContent = money(a5 + a10);
  $('.product[data-sku="5"]').classList.toggle('selected', state.qty5 > 0);
  $('.product[data-sku="10"]').classList.toggle('selected', state.qty10 > 0);
}

function syncRecipient() {
  const same = $('#sameAsBuyer').checked;
  if (same) {
    $('#rcptName').value = $('#name').value;
    $('#rcptPhone').value = $('#phone').value;
    clearErr($('#rcptName')); clearErr($('#rcptPhone'));
  }
  $('#rcptName').readOnly = same;
  $('#rcptPhone').readOnly = same;
}

// ------------------------------------------------------------
// 步驟與驗證
// ------------------------------------------------------------

function goStep(n) {
  state.step = n;
  $$('.panel').forEach((p) => { p.hidden = p.dataset.panel !== String(n); });
  $$('.steps li').forEach((li) => {
    const s = Number(li.dataset.step);
    li.classList.toggle('active', s === n);
    li.classList.toggle('done', n === 'done' || s < n);
  });
  $('#btnPrev').hidden = !(n > 1 && n !== 'done');
  $('#bar').hidden = n === 'done';
  $('#btnNext').textContent = n === 4 ? '確認送出' : '下一步';
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function next() {
  if (state.step === 1) {
    if (state.qty5 + state.qty10 < 1) return toast('請至少選購 1 盒');
    return goStep(2);
  }
  if (state.step === 2) {
    if (!validateStep2()) return toast('請檢查標示紅色的欄位');
    return goStep(3);
  }
  if (state.step === 3) {
    if (!radio('timeSlot')) return toast('請選擇希望到貨時段');
    if (!radio('concierge')) return toast('請選擇是否由管理室代收');
    renderSummary($('#summary'), collectOrder(), true);
    return goStep(4);
  }
  if (state.step === 4) return submit();
}

function validateStep2() {
  let ok = true;
  const req = (sel, msg, test) => {
    const el = $(sel);
    const v = el.value.trim();
    if (!(test ? test(v) : v)) { setErr(el, msg); ok = false; }
  };
  req('#name', '請填寫姓名');
  req('#phone', '請輸入正確電話，例如 0912345678', (v) => PHONE_RE.test(normPhone(v)));
  req('#email', 'E-mail 格式不正確', (v) => !v || EMAIL_RE.test(v));
  req('#rcptName', '請填寫收件人姓名');
  req('#rcptPhone', '請輸入正確電話', (v) => PHONE_RE.test(normPhone(v)));
  req('#rcptAddr', '請填寫完整地址（含縣市、區、門牌）', (v) => v.length >= 8);
  if (!ok) { const first = document.querySelector('.field.invalid input, .field.invalid textarea'); if (first) first.focus(); }
  return ok;
}

function setErr(el, msg) {
  const f = el.closest('.field');
  f.classList.add('invalid');
  let e = f.querySelector('.err');
  if (!e) { e = document.createElement('span'); e.className = 'err'; f.append(e); }
  e.textContent = msg;
}
function clearErr(el) {
  const f = el.closest('.field');
  if (!f) return;
  f.classList.remove('invalid');
  const e = f.querySelector('.err');
  if (e) e.remove();
}

const radio = (name) => { const r = document.querySelector('input[name="' + name + '"]:checked'); return r ? r.value : ''; };

function collectOrder() {
  return {
    qty5: state.qty5,
    qty10: state.qty10,
    name: $('#name').value.trim(),
    phone: normPhone($('#phone').value),
    email: $('#email').value.trim(),
    rcptName: $('#rcptName').value.trim(),
    rcptPhone: normPhone($('#rcptPhone').value),
    rcptAddr: $('#rcptAddr').value.trim(),
    timeSlot: radio('timeSlot'),
    concierge: radio('concierge'),
    note: $('#note').value.trim(),
  };
}

/** 以 DOM API 產生摘要（使用 textContent，避免 XSS） */
function renderSummary(container, o, withBuyer) {
  const c = state.cfg;
  const a5 = o.amt5 != null ? o.amt5 : o.qty5 * c.price5;
  const a10 = o.amt10 != null ? o.amt10 : o.qty10 * c.price10;
  const total = o.total != null ? o.total : a5 + a10;
  const rows = [];
  rows.push(['group', '訂購內容']);
  if (o.qty5) rows.push(['5 台斤裝 × ' + o.qty5, money(a5)]);
  if (o.qty10) rows.push(['10 台斤裝 × ' + o.qty10, money(a10)]);
  rows.push(['訂單總價', money(total), 'total']);
  if (withBuyer) {
    rows.push(['group', '訂購人']);
    rows.push(['姓名', o.name]);
    rows.push(['電話', o.phone]);
    if (o.email) rows.push(['E-mail', o.email]);
  }
  rows.push(['group', '收件資訊']);
  rows.push(['收件人', o.rcptName + (o.rcptPhone ? '　' + o.rcptPhone : '')]);
  rows.push(['地址', o.rcptAddr]);
  rows.push(['到貨時段', o.timeSlot]);
  rows.push(['管理室代收', o.concierge]);
  if (o.note) rows.push(['備註', o.note]);

  const dl = document.createElement('dl');
  rows.forEach(([k, v, cls]) => {
    if (k === 'group') {
      const g = document.createElement('div'); g.className = 'group'; g.textContent = v; dl.append(g); return;
    }
    const row = document.createElement('div');
    row.className = 'row' + (cls ? ' ' + cls : '');
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    row.append(dt, dd);
    dl.append(row);
  });
  container.textContent = '';
  container.append(dl);
}

// ------------------------------------------------------------
// 送出
// ------------------------------------------------------------

async function submit() {
  if (state.submitting) return;
  if (!$('#consent').checked) return toast('請勾選同意個人資料使用說明');
  state.submitting = true;
  $('#btnNext').disabled = true;
  loading(true, '訂單送出中，請勿關閉…');
  const order = collectOrder();
  try {
    // 同一份訂單重送時沿用同一 requestId，後端會回傳原訂單而不重複建立
    const res = await api('createOrder', { requestId: state.requestId, order });
    saveProfile(order);
    showDone(res.order);
  } catch (e) {
    if (e.code === 'NETWORK' || e.code === 'BUSY' || e.code === 'SERVER_ERROR') {
      toast(e.message + '\n再按一次「確認送出」即可，不會重複下單。');
    } else if (e.code === 'VALIDATION' || e.code === 'SOLD_OUT') {
      toast(e.message);
      goStep(e.code === 'SOLD_OUT' ? 1 : 2);
      state.requestId = newRequestId(); // 內容需修改，視為新的一筆
    } else {
      toast(e.message);
    }
  } finally {
    state.submitting = false;
    $('#btnNext').disabled = false;
    loading(false);
  }
}

function showDone(o) {
  $('#doneOrderId').textContent = '訂單編號 ' + o.orderId;
  renderSummary($('#doneSummary'), o, false);
  $('#donePayInfo').textContent = o.paymentInfo || '';
  $('#doneDeadline').textContent = '請於 ' + o.payDeadline + ' 前完成匯款。';
  goStep('done');
}

function resetForAnother() {
  state.requestId = newRequestId();
  setQty('5', 0); setQty('10', 0);
  $('#note').value = ''; $('#noteCount').textContent = '0';
  $('#consent').checked = false;
  goStep(1);
}

// ------------------------------------------------------------
// 記住資料（僅存在使用者手機的 localStorage）
// ------------------------------------------------------------

function saveProfile(o) {
  try {
    if (!$('#remember').checked) { localStorage.removeItem(PROFILE_KEY); return; }
    const p = { name: o.name, phone: o.phone, email: o.email, rcptName: o.rcptName, rcptPhone: o.rcptPhone,
      rcptAddr: o.rcptAddr, same: $('#sameAsBuyer').checked };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(p));
  } catch (e) { /* 私密模式等情況忽略 */ }
}

function restoreProfile() {
  try {
    const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
    if (!p) return;
    ['name', 'phone', 'email', 'rcptName', 'rcptPhone', 'rcptAddr'].forEach((k) => { if (p[k]) $('#' + k).value = p[k]; });
    $('#sameAsBuyer').checked = !!p.same;
    syncRecipient();
  } catch (e) { /* ignore */ }
}

// ------------------------------------------------------------
// UI 小工具
// ------------------------------------------------------------

function loading(on, text) {
  $('#loading').hidden = !on;
  if (text) $('#loadingText').textContent = text;
}

let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3500);
}

function showBanner(msg, isError) {
  const b = $('#banner');
  b.className = 'banner' + (isError ? ' error' : '');
  b.textContent = msg;
  b.hidden = false;
}

document.addEventListener('DOMContentLoaded', init);
