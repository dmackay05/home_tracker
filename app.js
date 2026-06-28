'use strict';

/* ============================================================
   LEDGER — state
   ============================================================ */
const STORAGE_KEY = 'ledger_v1';
const SCRIPT_URL_KEY = 'ledger_script_url';
const LAST_SYNC_KEY = 'ledger_last_sync';

const DEFAULT_CATEGORIES = ['Produce','Dairy & Eggs','Meat & Seafood','Pantry','Frozen','Bakery','Household','Other'];

// Same category color convention as the Cart shopping app
const CATEGORY_COLORS = {
  'Produce': 'var(--cat-produce)',
  'Dairy & Eggs': 'var(--cat-dairy)',
  'Meat & Seafood': 'var(--cat-meat)',
  'Pantry': 'var(--cat-pantry)',
  'Frozen': 'var(--cat-frozen)',
  'Bakery': 'var(--cat-bakery)',
  'Household': 'var(--cat-household)',
  'Other': 'var(--cat-other)'
};
function categoryColor(cat){ return CATEGORY_COLORS[cat] || 'var(--cat-other)'; }

// Person colors — distinct hues against the dark base, reused for chore badges/chips
const PERSON_COLORS = ['#4A86E8','#D77A42','#43D692','#A479E2','#FAD165','#FB4C2F','#7EC8E3','#E07798'];

const DEFAULT_PEOPLE = [
  { id: 'p_david',   name: 'David',   color: PERSON_COLORS[0] },
  { id: 'p_adriana', name: 'Adriana', color: PERSON_COLORS[1] },
  { id: 'p_alexis',  name: 'Alexis',  color: PERSON_COLORS[2] },
  { id: 'p_leila',   name: 'Leila',   color: PERSON_COLORS[3] },
  { id: 'p_natalie', name: 'Natalie', color: PERSON_COLORS[4] }
];

let state = {
  chores: [],      // {id, name, area, intervalDays, notes, history:[isoDateStrings], createdAt, assigneeId}
  cartItems: [],    // {id, name, qty, category, checked, createdAt}
  categories: DEFAULT_CATEGORIES.slice(),
  people: DEFAULT_PEOPLE.slice()
};

let activeTab = 'yard';
let activeFilter = 'all';
let activePersonFilter = null; // null = everyone
let editingChoreId = null;
let detailChoreId = null;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,7); }
function todayISO(){ return new Date().toISOString().slice(0,10); }
function daysBetween(a, b){ return Math.round((new Date(b) - new Date(a)) / 86400000); }

/* ============================================================
   Persistence
   ============================================================ */
function loadState(){
  try{
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const parsed = JSON.parse(raw);
      state = Object.assign(state, parsed);
      if(!state.categories || !state.categories.length) state.categories = DEFAULT_CATEGORIES.slice();
      if(!state.people || !state.people.length) state.people = DEFAULT_PEOPLE.slice();
    }
  }catch(e){ console.error('Failed to load state', e); }
}

function saveState(){
  try{
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }catch(e){ console.error('Failed to save state', e); }
}

/* ============================================================
   Toast
   ============================================================ */
let toastTimer = null;
function showToast(msg){
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> el.classList.remove('show'), 2200);
}

/* ============================================================
   Tabs
   ============================================================ */
function initTabs(){
  $$('.tab').forEach(tab=>{
    tab.addEventListener('click', ()=>{
      activeTab = tab.dataset.tab;
      $$('.tab').forEach(t=>{
        t.classList.toggle('active', t === tab);
        t.setAttribute('aria-selected', t === tab ? 'true' : 'false');
      });
      $('#panel-yard').classList.toggle('active', activeTab === 'yard');
      $('#panel-cart').classList.toggle('active', activeTab === 'cart');
    });
  });
}

/* ============================================================
   Chore logic — intervals stored in days for simplicity
   ============================================================ */
function intervalToDays(value, unit){
  if(unit === 'weeks') return value * 7;
  if(unit === 'months') return value * 30;
  return value;
}

function lastDone(chore){
  if(!chore.history.length) return null;
  return chore.history[chore.history.length - 1];
}

function nextDueDate(chore){
  const last = lastDone(chore);
  if(!last) return todayISO(); // never done = due now
  const d = new Date(last);
  d.setDate(d.getDate() + chore.intervalDays);
  return d.toISOString().slice(0,10);
}

function choreStatus(chore){
  const due = nextDueDate(chore);
  const diff = daysBetween(todayISO(), due); // positive = due in future
  if(diff < 0) return 'overdue';
  if(diff === 0) return 'due';
  return 'upcoming';
}

function currentStreak(chore){
  // Count consecutive completions where each gap <= intervalDays + 2 (small grace window)
  const hist = chore.history;
  if(!hist.length) return 0;
  let streak = 1;
  for(let i = hist.length - 1; i > 0; i--){
    const gap = daysBetween(hist[i-1], hist[i]);
    if(gap <= chore.intervalDays + 2){
      streak++;
    } else {
      break;
    }
  }
  return streak;
}

function isDoneToday(chore){
  return lastDone(chore) === todayISO();
}

function formatDueLabel(chore){
  const status = choreStatus(chore);
  const due = nextDueDate(chore);
  const diff = daysBetween(todayISO(), due);
  if(status === 'overdue') return `${Math.abs(diff)}d overdue`;
  if(status === 'due') return 'Due today';
  if(diff === 1) return 'Due tomorrow';
  return `Due in ${diff}d`;
}

/* ============================================================
   Render: Chore list
   ============================================================ */
function renderChores(){
  const list = $('#choreList');
  list.innerHTML = '';

  let chores = state.chores.slice();

  if(activeFilter === 'due'){
    chores = chores.filter(c => ['due','overdue'].includes(choreStatus(c)));
  } else if(activeFilter === 'upcoming'){
    chores = chores.filter(c => choreStatus(c) === 'upcoming');
  }

  if(activePersonFilter){
    chores = chores.filter(c => c.assigneeId === activePersonFilter);
  }

  // sort: overdue first, then due, then upcoming by soonest
  chores.sort((a,b)=>{
    const order = {overdue:0, due:1, upcoming:2};
    const sa = choreStatus(a), sb = choreStatus(b);
    if(order[sa] !== order[sb]) return order[sa] - order[sb];
    return daysBetween(todayISO(), nextDueDate(a)) - daysBetween(todayISO(), nextDueDate(b));
  });

  $('#choreEmpty').hidden = state.chores.length > 0;

  chores.forEach(chore=>{
    const status = choreStatus(chore);
    const streak = currentStreak(chore);
    const li = document.createElement('li');
    li.className = `chore-card ${status === 'due' ? 'is-due' : ''} ${status === 'overdue' ? 'is-overdue' : ''}`;

    const dotsHtml = renderStreakDots(streak);
    const doneToday = isDoneToday(chore);
    const badgeHtml = personBadgeHtml(chore.assigneeId);

    li.innerHTML = `
      <div class="chore-top">
        <div>
          <div class="chore-name">${escapeHtml(chore.name)}</div>
          <div class="chore-area-tag">${chore.area}${badgeHtml ? ' · ' : ''}${badgeHtml}</div>
        </div>
        <div class="chore-due-badge ${status}">${formatDueLabel(chore)}</div>
      </div>
      <div class="chore-bottom">
        <div>
          <div class="streak-row">${dotsHtml}</div>
        </div>
        <button class="chore-done-btn ${doneToday ? 'done-today' : ''}" data-id="${chore.id}">
          ${doneToday ? '✓ Done today' : 'Mark done'}
        </button>
      </div>
    `;

    li.querySelector('.chore-name').addEventListener('click', ()=> openChoreDetail(chore.id));
    li.querySelector('.chore-area-tag').addEventListener('click', ()=> openChoreDetail(chore.id));
    li.querySelector('.chore-due-badge').addEventListener('click', ()=> openChoreDetail(chore.id));
    li.querySelector('.chore-done-btn').addEventListener('click', (e)=>{
      e.stopPropagation();
      toggleDoneToday(chore.id);
    });

    list.appendChild(li);
  });

  updateYardDueCount();
  renderPersonFilterChips();
}

function renderStreakDots(streak){
  const maxDots = 8;
  const shown = Math.min(streak, maxDots);
  let html = '';
  for(let i = 0; i < shown; i++){
    const isRecent = i >= shown - 2;
    html += `<span class="streak-dot filled ${isRecent ? 'recent' : ''}"></span>`;
  }
  if(streak === 0){
    html = `<span class="streak-dot"></span><span class="streak-dot"></span><span class="streak-dot"></span>`;
  } else if(streak > maxDots){
    html += `<span class="chore-streak-label">+${streak - maxDots}</span>`;
  }
  return html;
}

function updateYardDueCount(){
  const dueCount = state.chores.filter(c => ['due','overdue'].includes(choreStatus(c))).length;
  $('#yardDueCount').textContent = dueCount > 0 ? `${dueCount} due` : '';
}

function renderPersonFilterChips(){
  const row = $('#personFilters');
  if(!row) return;
  row.innerHTML = '';

  const allChip = document.createElement('button');
  allChip.className = `chip ${!activePersonFilter ? 'active' : ''}`;
  allChip.textContent = 'Everyone';
  allChip.addEventListener('click', ()=>{ activePersonFilter = null; renderChores(); });
  row.appendChild(allChip);

  state.people.forEach(person=>{
    const chip = document.createElement('button');
    chip.className = `chip person-chip ${activePersonFilter === person.id ? 'active' : ''}`;
    chip.style.setProperty('--person-color', person.color);
    chip.innerHTML = `<span class="person-dot"></span>${escapeHtml(person.name)}`;
    chip.addEventListener('click', ()=>{ activePersonFilter = person.id; renderChores(); });
    row.appendChild(chip);
  });
}

function escapeHtml(str){
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function getPerson(id){ return state.people.find(p => p.id === id) || null; }
function personBadgeHtml(assigneeId){
  const person = getPerson(assigneeId);
  if(!person) return '';
  return `<span class="person-badge" style="--person-color:${person.color}">${escapeHtml(person.name)}</span>`;
}

/* ============================================================
   Chore actions
   ============================================================ */
function toggleDoneToday(id){
  const chore = state.chores.find(c => c.id === id);
  if(!chore) return;
  const today = todayISO();
  const idx = chore.history.indexOf(today);
  if(idx >= 0){
    chore.history.splice(idx, 1);
    showToast(`Unmarked "${chore.name}"`);
  } else {
    chore.history.push(today);
    chore.history.sort();
    showToast(`"${chore.name}" marked done`);
  }
  saveState();
  renderChores();
  if(detailChoreId === id) renderChoreDetail(id);
}

let selectedAssigneeId = null;

function openChoreSheet(choreId){
  editingChoreId = choreId || null;
  const overlay = $('#choreOverlay');
  const isEdit = !!choreId;
  $('#choreSheetTitle').textContent = isEdit ? 'Edit chore' : 'New chore';
  $('#choreDeleteBtn').hidden = !isEdit;

  if(isEdit){
    const chore = state.chores.find(c => c.id === choreId);
    $('#f_choreName').value = chore.name;
    $('#f_choreNotes').value = chore.notes || '';
    setSegActive('#f_choreArea', chore.area);
    const days = chore.intervalDays;
    if(days % 30 === 0 && days >= 30){
      $('#f_choreInterval').value = days / 30;
      setSegActive('#f_choreUnit', 'months');
    } else if(days % 7 === 0 && days >= 7){
      $('#f_choreInterval').value = days / 7;
      setSegActive('#f_choreUnit', 'weeks');
    } else {
      $('#f_choreInterval').value = days;
      setSegActive('#f_choreUnit', 'days');
    }
    selectedAssigneeId = chore.assigneeId || null;
  } else {
    $('#f_choreName').value = '';
    $('#f_choreNotes').value = '';
    $('#f_choreInterval').value = 7;
    setSegActive('#f_choreArea', 'yard');
    setSegActive('#f_choreUnit', 'days');
    selectedAssigneeId = null;
  }

  renderAssigneePicker();
  openSheet(overlay);
  setTimeout(()=> $('#f_choreName').focus(), 250);
}

function renderAssigneePicker(){
  const grid = $('#f_choreAssignee');
  grid.innerHTML = '';

  const noneChip = document.createElement('button');
  noneChip.className = `person-chip-pick ${!selectedAssigneeId ? 'active' : ''}`;
  noneChip.textContent = 'Unassigned';
  noneChip.addEventListener('click', ()=>{ selectedAssigneeId = null; renderAssigneePicker(); });
  grid.appendChild(noneChip);

  state.people.forEach(person=>{
    const chip = document.createElement('button');
    chip.className = `person-chip-pick ${selectedAssigneeId === person.id ? 'active' : ''}`;
    chip.style.setProperty('--person-color', person.color);
    chip.innerHTML = `<span class="person-dot"></span>${escapeHtml(person.name)}`;
    chip.addEventListener('click', ()=>{ selectedAssigneeId = person.id; renderAssigneePicker(); });
    grid.appendChild(chip);
  });
}

function setSegActive(containerSel, val){
  $$(`${containerSel} .seg-btn`).forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.val === val);
  });
}
function getSegActive(containerSel){
  const btn = document.querySelector(`${containerSel} .seg-btn.active`);
  return btn ? btn.dataset.val : null;
}

function saveChoreFromSheet(){
  const name = $('#f_choreName').value.trim();
  if(!name){ showToast('Give the chore a name'); return; }

  const area = getSegActive('#f_choreArea');
  const unit = getSegActive('#f_choreUnit');
  const intervalValue = Math.max(1, parseInt($('#f_choreInterval').value, 10) || 1);
  const intervalDays = intervalToDays(intervalValue, unit);
  const notes = $('#f_choreNotes').value.trim();

  if(editingChoreId){
    const chore = state.chores.find(c => c.id === editingChoreId);
    chore.name = name;
    chore.area = area;
    chore.intervalDays = intervalDays;
    chore.notes = notes;
    chore.assigneeId = selectedAssigneeId;
    showToast('Chore updated');
  } else {
    state.chores.push({
      id: uid(),
      name, area, intervalDays, notes,
      history: [],
      createdAt: todayISO(),
      assigneeId: selectedAssigneeId
    });
    showToast('Chore added');
  }

  saveState();
  renderChores();
  closeSheet($('#choreOverlay'));
}

function deleteChore(){
  if(!editingChoreId) return;
  state.chores = state.chores.filter(c => c.id !== editingChoreId);
  saveState();
  renderChores();
  closeSheet($('#choreOverlay'));
  showToast('Chore deleted');
}

/* ============================================================
   Chore detail sheet
   ============================================================ */
function openChoreDetail(id){
  detailChoreId = id;
  renderChoreDetail(id);
  openSheet($('#choreDetailOverlay'));
}

function renderChoreDetail(id){
  const chore = state.chores.find(c => c.id === id);
  if(!chore) return;

  $('#detailChoreName').textContent = chore.name;
  const person = getPerson(chore.assigneeId);
  const assigneeText = person ? ` · ${person.name}` : '';
  $('#detailChoreMeta').textContent = `${chore.area} · every ${formatInterval(chore.intervalDays)} · ${formatDueLabel(chore)}${assigneeText}`;

  const streak = currentStreak(chore);
  $('#detailStreakRow').innerHTML = renderStreakDots(streak);
  $('#detailStreakCount').textContent = streak;

  if(chore.notes){
    $('#detailChoreNotes').hidden = false;
    $('#detailChoreNotes').textContent = chore.notes;
  } else {
    $('#detailChoreNotes').hidden = true;
  }

  const historyEl = $('#detailHistory');
  historyEl.innerHTML = '';
  const recent = chore.history.slice().reverse().slice(0, 12);
  recent.forEach(dateStr=>{
    const row = document.createElement('div');
    row.className = 'history-row';
    row.innerHTML = `<span>Completed</span><span class="hr-date">${formatDateShort(dateStr)}</span>`;
    historyEl.appendChild(row);
  });

  const doneToday = isDoneToday(chore);
  $('#detailCompleteBtn').textContent = doneToday ? '✓ Done today' : 'Mark done today';
  $('#detailCompleteBtn').classList.toggle('done-today', doneToday);
}

function formatInterval(days){
  if(days % 30 === 0 && days >= 30) return `${days/30} month${days/30 > 1 ? 's' : ''}`;
  if(days % 7 === 0 && days >= 7) return `${days/7} week${days/7 > 1 ? 's' : ''}`;
  return `${days} day${days > 1 ? 's' : ''}`;
}

function formatDateShort(iso){
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString(undefined, { month:'short', day:'numeric' });
}

/* ============================================================
   Cart logic
   ============================================================ */
function renderCart(){
  const container = $('#cartCategories');
  container.innerHTML = '';

  const items = state.cartItems;
  $('#cartEmpty').hidden = items.length > 0;

  const checkedCount = items.filter(i => i.checked).length;
  if(items.length > 0){
    $('#cartProgress').hidden = false;
    $('#cartProgressText').textContent = `${checkedCount} of ${items.length} picked up`;
    $('#cartProgressFill').style.width = items.length ? `${(checkedCount/items.length)*100}%` : '0%';
  } else {
    $('#cartProgress').hidden = true;
  }

  // group by category, preserving category order; unchecked first within group, checked items pushed but kept visible
  const grouped = {};
  items.forEach(item=>{
    if(!grouped[item.category]) grouped[item.category] = [];
    grouped[item.category].push(item);
  });

  const orderedCats = state.categories.filter(c => grouped[c]);
  Object.keys(grouped).forEach(c => { if(!orderedCats.includes(c)) orderedCats.push(c); });

  orderedCats.forEach(cat=>{
    const groupItems = grouped[cat].slice().sort((a,b)=> (a.checked === b.checked) ? 0 : (a.checked ? 1 : -1));
    const groupEl = document.createElement('div');
    const titleEl = document.createElement('div');
    titleEl.className = 'cat-group-title';
    titleEl.innerHTML = `<span class="cat-dot" style="--cat-color:${categoryColor(cat)}"></span>${escapeHtml(cat)}`;
    groupEl.appendChild(titleEl);

    const ul = document.createElement('ul');
    ul.className = 'cat-items';

    groupItems.forEach(item=>{
      const li = document.createElement('li');
      li.className = `cart-item ${item.checked ? 'checked' : ''}`;
      li.style.setProperty('--cat-color', categoryColor(item.category));
      const calsTag = item.nutrition ? `<div class="cart-item-nutrition-tag">${Math.round(item.nutrition.calories)} cal</div>` : '';
      li.innerHTML = `
        <div class="cart-checkbox">${item.checked ? '✓' : ''}</div>
        <div class="cart-item-name">${escapeHtml(item.name)}</div>
        ${item.qty ? `<div class="cart-item-qty">${escapeHtml(item.qty)}</div>` : ''}
        ${calsTag}
        <button class="cart-item-del" data-id="${item.id}" aria-label="Remove">✕</button>
      `;
      li.querySelector('.cart-checkbox').addEventListener('click', ()=> toggleCartChecked(item.id));
      li.querySelector('.cart-item-name').addEventListener('click', ()=>{
        if(item.nutrition) openNutritionDetail(item.id);
        else toggleCartChecked(item.id);
      });
      const tagEl = li.querySelector('.cart-item-nutrition-tag');
      if(tagEl) tagEl.addEventListener('click', (e)=>{ e.stopPropagation(); openNutritionDetail(item.id); });
      li.querySelector('.cart-item-del').addEventListener('click', (e)=>{
        e.stopPropagation();
        deleteCartItem(item.id);
      });
      ul.appendChild(li);
    });

    groupEl.appendChild(ul);
    container.appendChild(groupEl);
  });

  updateCartCount();
}

function updateCartCount(){
  const remaining = state.cartItems.filter(i => !i.checked).length;
  $('#cartCount').textContent = remaining > 0 ? `${remaining} to get` : '';
}

function toggleCartChecked(id){
  const item = state.cartItems.find(i => i.id === id);
  if(!item) return;
  item.checked = !item.checked;
  saveState();
  renderCart();
}

function deleteCartItem(id){
  state.cartItems = state.cartItems.filter(i => i.id !== id);
  saveState();
  renderCart();
}

function clearCheckedCartItems(){
  const before = state.cartItems.length;
  state.cartItems = state.cartItems.filter(i => !i.checked);
  saveState();
  renderCart();
  const removed = before - state.cartItems.length;
  showToast(removed > 0 ? `Cleared ${removed} item${removed>1?'s':''}` : 'Nothing to clear');
}

function openCartSheet(){
  $('#f_cartName').value = '';
  $('#f_cartQty').value = '';
  $('#f_cartCategoryCustom').value = '';
  $('#f_cartCategoryCustom').hidden = true;
  renderCategoryGrid();
  resetUsdaMatch();
  openSheet($('#cartOverlay'));
  setTimeout(()=> $('#f_cartName').focus(), 250);
}

function renderCategoryGrid(selected){
  const grid = $('#f_cartCategory');
  grid.innerHTML = '';
  state.categories.forEach(cat=>{
    const chip = document.createElement('button');
    chip.className = `cat-chip ${cat === (selected || state.categories[0]) ? 'active' : ''}`;
    chip.textContent = cat;
    chip.dataset.val = cat;
    chip.style.setProperty('--chip-color', categoryColor(cat));
    chip.addEventListener('click', ()=>{
      $$('#f_cartCategory .cat-chip').forEach(c=> c.classList.remove('active'));
      chip.classList.add('active');
      $('#f_cartCategoryCustom').hidden = true;
    });
    grid.appendChild(chip);
  });
  const addChip = document.createElement('button');
  addChip.className = 'cat-chip';
  addChip.textContent = '+ New';
  addChip.addEventListener('click', ()=>{
    $$('#f_cartCategory .cat-chip').forEach(c=> c.classList.remove('active'));
    $('#f_cartCategoryCustom').hidden = false;
    $('#f_cartCategoryCustom').focus();
  });
  grid.appendChild(addChip);
}

function saveCartItemFromSheet(){
  const name = $('#f_cartName').value.trim();
  if(!name){ showToast('Give the item a name'); return; }
  const qty = $('#f_cartQty').value.trim();

  let category = getSelectedCategory();
  const customVal = $('#f_cartCategoryCustom').value.trim();
  if(!$('#f_cartCategoryCustom').hidden && customVal){
    category = customVal;
    if(!state.categories.includes(category)) state.categories.push(category);
  }
  if(!category) category = 'Other';

  state.cartItems.push({
    id: uid(), name, qty, category, checked: false, createdAt: todayISO(),
    fdcId: pendingMatch ? pendingMatch.fdcId : null,
    nutrition: pendingMatch ? pendingMatch.nutrition : null,
    nutritionSource: pendingMatch ? pendingMatch.description : null
  });
  saveState();
  renderCart();
  closeSheet($('#cartOverlay'));
  showToast(`Added "${name}"`);
}

function getSelectedCategory(){
  const active = document.querySelector('#f_cartCategory .cat-chip.active');
  return active ? active.dataset.val : null;
}

/* ============================================================
   Sheet open/close helpers
   ============================================================ */
function openSheet(overlay){ overlay.classList.add('open'); }
function closeSheet(overlay){ overlay.classList.remove('open'); }

function initSheetDismiss(){
  $$('.sheet-overlay').forEach(overlay=>{
    overlay.addEventListener('click', (e)=>{
      if(e.target === overlay) closeSheet(overlay);
    });
  });
}

/* ============================================================
   USDA FoodData Central — nutrition matching
   Per-100g profile cached on the cart item once matched.
   Auto-suggests on name input (debounced), swappable via search sheet.
   ============================================================ */
const USDA_KEY_STORAGE = 'ledger_usda_key';
const USDA_API_BASE = 'https://api.nal.usda.gov/fdc/v1';

let pendingMatch = null;       // { fdcId, description, nutrition } for the item being added
let usdaSuggestTimer = null;
let usdaSearchContext = 'add'; // 'add' | 'change' (which flow opened the search sheet)
let usdaChangeForItemId = null; // when changing match on an existing cart item

function getUsdaKey(){ return localStorage.getItem(USDA_KEY_STORAGE) || ''; }
function setUsdaKey(key){ localStorage.setItem(USDA_KEY_STORAGE, key); }

// Nutrient name mapping — same as the proven pattern from the fitness tracker.
// USDA's foods/search schema nests under item.nutrient.name; some legacy
// shapes use item.nutrientName directly. Handle both.
const NUTRIENT_NAME_MAP = {
  'Protein': 'protein',
  'Total lipid (fat)': 'fat',
  'Carbohydrate, by difference': 'carbs',
  'Fiber, total dietary': 'fiber',
  'Sugars, total including NLEA': 'sugar',
  'Sugars, total': 'sugar',
  'Sodium, Na': 'sodium'
};

function extractNutrition(foodNutrients){
  const out = { calories:0, protein:0, carbs:0, fat:0, fiber:0, sugar:0, sodium:0 };
  if(!Array.isArray(foodNutrients)) return out;
  let gotKcal = false, atwater = 0;

  foodNutrients.forEach(item=>{
    const ni = item.nutrient || {};
    const name = ni.name || item.nutrientName || '';
    const unit = (ni.unitName || item.unitName || '').toUpperCase();
    const amount = (item.amount !== undefined) ? item.amount : (item.value !== undefined ? item.value : 0);

    if(name === 'Energy'){
      if(unit === 'KCAL'){ out.calories = amount; gotKcal = true; }
    } else if(name === 'Energy (Atwater General Factors)' && unit === 'KCAL'){
      atwater = amount;
    } else if(NUTRIENT_NAME_MAP[name]){
      out[NUTRIENT_NAME_MAP[name]] = amount;
    }
  });

  if(!gotKcal && atwater) out.calories = atwater;
  return out;
}

async function usdaSearch(query){
  const key = getUsdaKey();
  if(!key || !query.trim()) return [];
  const url = `${USDA_API_BASE}/foods/search?api_key=${encodeURIComponent(key)}&query=${encodeURIComponent(query)}&pageSize=8&dataType=Foundation,SR%20Legacy,Branded`;
  const resp = await fetch(url);
  if(!resp.ok) throw new Error(`USDA search failed (${resp.status})`);
  const data = await resp.json();
  const foods = data.foods || [];

  // Foundation / SR Legacy first — canonical per-100g profiles; Branded after
  const rank = { 'Foundation':0, 'SR Legacy':1, 'Survey (FNDDS)':2, 'Branded':3 };
  foods.sort((a,b)=> (rank[a.dataType] ?? 9) - (rank[b.dataType] ?? 9));

  return foods.map(f=>({
    fdcId: f.fdcId,
    description: f.description,
    nutrition: extractNutrition(f.foodNutrients)
  }));
}

// --- Auto-suggest on name input (Add to Cart sheet) ---
function initUsdaAutosuggest(){
  $('#f_cartName').addEventListener('input', (e)=>{
    const query = e.target.value.trim();
    clearTimeout(usdaSuggestTimer);
    if(!query){ resetUsdaMatch(); return; }
    if(!getUsdaKey()){ showUsdaMatchEmpty(); return; }
    showUsdaMatchLoading();
    usdaSuggestTimer = setTimeout(async ()=>{
      try{
        const results = await usdaSearch(query);
        if(results.length){
          setPendingMatch(results[0]);
        } else {
          showUsdaMatchNone();
        }
      }catch(err){
        console.error(err);
        showUsdaMatchNone();
      }
    }, 600);
  });

  $('#usdaMatchChangeBtn').addEventListener('click', ()=> openUsdaSearchSheet('add'));
  $('#usdaMatchSearchBtn').addEventListener('click', ()=> openUsdaSearchSheet('add'));
}

function resetUsdaMatch(){
  pendingMatch = null;
  $('#usdaMatchEmpty').hidden = false;
  $('#usdaMatchLoading').hidden = true;
  $('#usdaMatchResult').hidden = true;
  $('#usdaMatchNone').hidden = true;
}
function showUsdaMatchEmpty(){
  pendingMatch = null;
  $('#usdaMatchEmpty').hidden = false;
  $('#usdaMatchLoading').hidden = true;
  $('#usdaMatchResult').hidden = true;
  $('#usdaMatchNone').hidden = true;
}
function showUsdaMatchLoading(){
  $('#usdaMatchEmpty').hidden = true;
  $('#usdaMatchLoading').hidden = false;
  $('#usdaMatchResult').hidden = true;
  $('#usdaMatchNone').hidden = true;
}
function showUsdaMatchNone(){
  pendingMatch = null;
  $('#usdaMatchEmpty').hidden = true;
  $('#usdaMatchLoading').hidden = true;
  $('#usdaMatchResult').hidden = true;
  $('#usdaMatchNone').hidden = false;
}
function setPendingMatch(match){
  pendingMatch = match;
  $('#usdaMatchEmpty').hidden = true;
  $('#usdaMatchLoading').hidden = true;
  $('#usdaMatchNone').hidden = true;
  $('#usdaMatchResult').hidden = false;
  $('#usdaMatchName').textContent = match.description;
  $('#usdaMatchCals').textContent = `${Math.round(match.nutrition.calories)} cal / 100g`;
}

// --- Manual search sheet (used for initial "Change"/"Search" and for changing an existing item's match) ---
function openUsdaSearchSheet(context, itemId){
  usdaSearchContext = context;
  usdaChangeForItemId = itemId || null;
  $('#f_usdaSearchInput').value = (context === 'add') ? $('#f_cartName').value.trim() : '';
  $('#usdaResultsList').innerHTML = '';
  $('#usdaResultsEmpty').hidden = true;
  $('#usdaResultsLoading').hidden = true;
  openSheet($('#usdaSearchOverlay'));
  setTimeout(()=>{
    $('#f_usdaSearchInput').focus();
    if($('#f_usdaSearchInput').value) runUsdaSearchSheetQuery();
  }, 250);
}

function runUsdaSearchSheetQuery(){
  const query = $('#f_usdaSearchInput').value.trim();
  const list = $('#usdaResultsList');
  list.innerHTML = '';
  $('#usdaResultsEmpty').hidden = true;

  if(!query){ return; }
  if(!getUsdaKey()){
    showToast('Add your USDA API key in Settings first');
    return;
  }

  $('#usdaResultsLoading').hidden = false;
  usdaSearch(query).then(results=>{
    $('#usdaResultsLoading').hidden = true;
    if(!results.length){ $('#usdaResultsEmpty').hidden = false; return; }
    results.forEach(match=>{
      const row = document.createElement('div');
      row.className = 'usda-result-row';
      row.innerHTML = `
        <div class="usda-result-name">${escapeHtml(match.description)}</div>
        <div class="usda-result-cals">${Math.round(match.nutrition.calories)} cal</div>
      `;
      row.addEventListener('click', ()=> selectUsdaSearchResult(match));
      list.appendChild(row);
    });
  }).catch(err=>{
    console.error(err);
    $('#usdaResultsLoading').hidden = true;
    $('#usdaResultsEmpty').hidden = false;
  });
}

function selectUsdaSearchResult(match){
  if(usdaSearchContext === 'add'){
    setPendingMatch(match);
    closeSheet($('#usdaSearchOverlay'));
  } else if(usdaSearchContext === 'change' && usdaChangeForItemId){
    const item = state.cartItems.find(i => i.id === usdaChangeForItemId);
    if(item){
      item.fdcId = match.fdcId;
      item.nutrition = match.nutrition;
      item.nutritionSource = match.description;
      saveState();
      renderCart();
    }
    closeSheet($('#usdaSearchOverlay'));
    if(item) openNutritionDetail(item.id);
  }
}

let usdaSearchInputTimer = null;
function initUsdaSearchSheet(){
  $('#f_usdaSearchInput').addEventListener('input', ()=>{
    clearTimeout(usdaSearchInputTimer);
    usdaSearchInputTimer = setTimeout(runUsdaSearchSheetQuery, 450);
  });
  $('#usdaSkipBtn').addEventListener('click', ()=>{
    if(usdaSearchContext === 'add'){
      showUsdaMatchEmpty();
    }
    closeSheet($('#usdaSearchOverlay'));
  });
}

// --- Nutrition detail sheet (tap-to-expand on a matched cart item) ---
function openNutritionDetail(itemId){
  const item = state.cartItems.find(i => i.id === itemId);
  if(!item || !item.nutrition) return;
  usdaChangeForItemId = itemId;

  $('#nutritionItemName').textContent = item.name;
  $('#nutritionSourceName').textContent = item.nutritionSource || '';
  $('#nutritionBasis').textContent = 'Values per 100g, from USDA FoodData Central';

  const n = item.nutrition;
  const stats = [
    { label:'Calories', value: `${Math.round(n.calories)}`, cls:'cals' },
    { label:'Protein', value: `${n.protein.toFixed(1)}g` },
    { label:'Carbs', value: `${n.carbs.toFixed(1)}g` },
    { label:'Fat', value: `${n.fat.toFixed(1)}g` },
    { label:'Fiber', value: `${n.fiber.toFixed(1)}g` },
    { label:'Sugar', value: `${n.sugar.toFixed(1)}g` },
    { label:'Sodium', value: `${Math.round(n.sodium)}mg` }
  ];

  const panel = $('#nutritionPanel');
  panel.innerHTML = stats.map(s => `
    <div class="nutrition-stat ${s.cls || ''}">
      <div class="nutrition-stat-label">${s.label}</div>
      <div class="nutrition-stat-value">${s.value}</div>
    </div>
  `).join('');

  openSheet($('#nutritionDetailOverlay'));
}

function initNutritionDetailSheet(){
  $('#nutritionChangeBtn').addEventListener('click', ()=>{
    closeSheet($('#nutritionDetailOverlay'));
    setTimeout(()=> openUsdaSearchSheet('change', usdaChangeForItemId), 200);
  });
  $('#nutritionRemoveBtn').addEventListener('click', ()=>{
    const item = state.cartItems.find(i => i.id === usdaChangeForItemId);
    if(item){
      item.nutrition = null;
      item.fdcId = null;
      item.nutritionSource = null;
      saveState();
      renderCart();
    }
    closeSheet($('#nutritionDetailOverlay'));
    showToast('Nutrition match removed');
  });
}

/* ============================================================
   Sync — Google Sheets via iframe POST (write) + JSONP (read)
   Same pattern as the rest of the dmackay05 PWA suite.
   ============================================================ */
function getScriptUrl(){ return localStorage.getItem(SCRIPT_URL_KEY) || ''; }
function setScriptUrl(url){ localStorage.setItem(SCRIPT_URL_KEY, url); }

function updateSyncStatusText(){
  const last = localStorage.getItem(LAST_SYNC_KEY);
  const url = getScriptUrl();
  if(!url){
    $('#syncStatusText').textContent = 'Not configured yet. Paste your Apps Script URL above.';
  } else if(last){
    $('#syncStatusText').innerHTML = `Connected. Last synced: <span class="ts">${new Date(Number(last)).toLocaleString()}</span>`;
  } else {
    $('#syncStatusText').textContent = 'Connected, but not synced yet.';
  }
}

function pushToSheet(){
  const url = getScriptUrl();
  if(!url){ showToast('Add your Apps Script URL first'); return; }

  const payload = JSON.stringify({ action:'save', chores: state.chores, cartItems: state.cartItems, categories: state.categories, people: state.people });

  const iframe = document.createElement('iframe');
  iframe.name = 'ledger-sync-frame';
  iframe.style.display = 'none';
  document.body.appendChild(iframe);

  const form = document.createElement('form');
  form.method = 'POST';
  form.action = url;
  form.target = 'ledger-sync-frame';

  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = 'payload';
  input.value = payload;
  form.appendChild(input);

  document.body.appendChild(form);
  form.submit();

  setTimeout(()=>{
    document.body.removeChild(form);
    document.body.removeChild(iframe);
    localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
    updateSyncStatusText();
    showToast('Pushed to sheet');
  }, 1200);
}

function pullFromSheet(silent){
  const url = getScriptUrl();
  if(!url){ if(!silent){ showToast('Add your Apps Script URL first'); } return; }

  const callbackName = 'ledgerSyncCb_' + Date.now();
  window[callbackName] = function(data){
    try{
      if(data && (Array.isArray(data.chores) || Array.isArray(data.cartItems))){
        state.chores = data.chores || [];
        state.cartItems = data.cartItems || [];
        if(Array.isArray(data.categories) && data.categories.length) state.categories = data.categories;
        if(Array.isArray(data.people) && data.people.length) state.people = data.people;
        saveState();
        renderChores();
        renderCart();
        localStorage.setItem(LAST_SYNC_KEY, String(Date.now()));
        updateSyncStatusText();
        if(!silent) showToast('Pulled from sheet');
      } else if(!silent){
        showToast('Sheet looked empty');
      }
    }catch(e){ console.error(e); if(!silent) showToast('Pull failed'); }
    delete window[callbackName];
    script.remove();
  };

  const script = document.createElement('script');
  script.src = `${url}?action=load&callback=${callbackName}`;
  script.onerror = function(){
    if(!silent) showToast('Pull failed — check URL');
    delete window[callbackName];
    script.remove();
  };
  document.body.appendChild(script);
}

/* ============================================================
   Settings sheet wiring
   ============================================================ */
function openSettingsSheet(){
  $('#f_scriptUrl').value = getScriptUrl();
  $('#f_usdaKey').value = getUsdaKey();
  updateSyncStatusText();
  renderPeopleList();
  openSheet($('#settingsOverlay'));
}

/* ============================================================
   People manager (Settings sheet)
   ============================================================ */
function renderPeopleList(){
  const list = $('#peopleList');
  list.innerHTML = '';

  if(!state.people.length){
    const empty = document.createElement('p');
    empty.className = 'sync-status';
    empty.textContent = 'No one added yet.';
    list.appendChild(empty);
    return;
  }

  state.people.forEach(person=>{
    const row = document.createElement('div');
    row.className = 'person-row';
    row.innerHTML = `
      <span class="person-dot" style="--person-color:${person.color}"></span>
      <span class="person-row-name">${escapeHtml(person.name)}</span>
      <button class="person-row-del" data-id="${person.id}" aria-label="Remove">✕</button>
    `;
    row.querySelector('.person-row-del').addEventListener('click', ()=> deletePerson(person.id));
    list.appendChild(row);
  });
}

function addPerson(){
  const input = $('#f_newPersonName');
  const name = input.value.trim();
  if(!name){ showToast('Enter a name'); return; }

  const usedColors = state.people.map(p => p.color);
  const nextColor = PERSON_COLORS.find(c => !usedColors.includes(c)) || PERSON_COLORS[state.people.length % PERSON_COLORS.length];

  state.people.push({ id: 'p_' + uid(), name, color: nextColor });
  saveState();
  input.value = '';
  renderPeopleList();
  showToast(`Added ${name}`);
}

function deletePerson(id){
  state.people = state.people.filter(p => p.id !== id);
  // unassign any chores that pointed at this person
  state.chores.forEach(c=>{ if(c.assigneeId === id) c.assigneeId = null; });
  saveState();
  renderPeopleList();
  renderChores();
  showToast('Person removed');
}

/* ============================================================
   Starter chores pack
   ============================================================ */
const STARTER_CHORES = [
  { name: 'Mow the lawn', area: 'yard', intervalDays: 7 },
  { name: 'Water plants/garden', area: 'yard', intervalDays: 3 },
  { name: 'Pull weeds', area: 'yard', intervalDays: 14 },
  { name: 'Trim hedges/bushes', area: 'yard', intervalDays: 30 },
  { name: 'Rake leaves', area: 'yard', intervalDays: 14 },
  { name: 'Take out trash', area: 'house', intervalDays: 7 },
  { name: 'Take out recycling', area: 'house', intervalDays: 14 },
  { name: 'Vacuum house', area: 'house', intervalDays: 7 },
  { name: 'Clean bathrooms', area: 'house', intervalDays: 7 },
  { name: 'Change HVAC filter', area: 'house', intervalDays: 90 },
  { name: 'Clean gutters', area: 'house', intervalDays: 180 },
  { name: 'Wipe down kitchen counters/appliances', area: 'house', intervalDays: 7 },
  { name: 'Wash bedsheets', area: 'house', intervalDays: 14 },
  { name: 'Dust furniture', area: 'house', intervalDays: 14 },
  { name: 'Check smoke detector batteries', area: 'house', intervalDays: 180 }
];

function loadStarterChores(){
  const existingNames = new Set(state.chores.map(c => c.name.toLowerCase().trim()));
  let added = 0;

  STARTER_CHORES.forEach(starter=>{
    if(existingNames.has(starter.name.toLowerCase().trim())) return;
    state.chores.push({
      id: uid(),
      name: starter.name,
      area: starter.area,
      intervalDays: starter.intervalDays,
      notes: '',
      history: [],
      createdAt: todayISO(),
      assigneeId: null
    });
    added++;
  });

  saveState();
  renderChores();
  showToast(added > 0 ? `Loaded ${added} chore${added > 1 ? 's' : ''}` : 'Already loaded — nothing new to add');
}

/* ============================================================
   Init
   ============================================================ */
function init(){
  loadState();
  initTabs();
  initSheetDismiss();
  renderChores();
  renderCart();

  // Filter chips
  $$('#yardFilters .chip').forEach(chip=>{
    chip.addEventListener('click', ()=>{
      activeFilter = chip.dataset.filter;
      $$('#yardFilters .chip').forEach(c => c.classList.toggle('active', c === chip));
      renderChores();
    });
  });

  // Segmented controls (area / unit) — generic toggle
  $$('#f_choreArea .seg-btn, #f_choreUnit .seg-btn').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      btn.parentElement.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // FAB — context aware
  $('#fabBtn').addEventListener('click', ()=>{
    if(activeTab === 'yard') openChoreSheet(null);
    else openCartSheet();
  });

  // Chore sheet
  $('#choreSaveBtn').addEventListener('click', saveChoreFromSheet);
  $('#choreDeleteBtn').addEventListener('click', deleteChore);

  // Chore detail sheet
  $('#detailEditBtn').addEventListener('click', ()=>{
    closeSheet($('#choreDetailOverlay'));
    setTimeout(()=> openChoreSheet(detailChoreId), 200);
  });
  $('#detailCompleteBtn').addEventListener('click', ()=>{
    toggleDoneToday(detailChoreId);
  });

  // Cart sheet
  $('#cartSaveBtn').addEventListener('click', saveCartItemFromSheet);
  initUsdaAutosuggest();
  initUsdaSearchSheet();
  initNutritionDetailSheet();

  // Settings
  $('#settingsBtn').addEventListener('click', openSettingsSheet);
  $('#f_scriptUrl').addEventListener('change', (e)=>{
    setScriptUrl(e.target.value.trim());
    updateSyncStatusText();
  });
  $('#f_usdaKey').addEventListener('change', (e)=>{
    setUsdaKey(e.target.value.trim());
    showToast('USDA key saved');
  });
  $('#pushBtn').addEventListener('click', pushToSheet);
  $('#pullBtn').addEventListener('click', ()=> pullFromSheet(false));
  $('#clearCheckedBtn').addEventListener('click', clearCheckedCartItems);
  $('#addPersonBtn').addEventListener('click', addPerson);
  $('#f_newPersonName').addEventListener('keydown', (e)=>{
    if(e.key === 'Enter') addPerson();
  });
  $('#loadStarterBtn').addEventListener('click', loadStarterChores);

  // Auto-pull only if local state is completely empty (new device scenario)
  if(state.chores.length === 0 && state.cartItems.length === 0 && getScriptUrl()){
    pullFromSheet(true);
  }

  // Register service worker
  if('serviceWorker' in navigator){
    window.addEventListener('load', ()=>{
      navigator.serviceWorker.register('sw.js').catch(e => console.error('SW registration failed', e));
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
