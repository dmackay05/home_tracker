/**
 * LEDGER — Apps Script backend
 * Bind this script to the Google Sheet you want to use as the data store.
 * Deploy as a Web App: Execute as "Me", Access "Anyone with the link".
 *
 * Stores the full JSON blob in a "_data" tab (chunked if needed),
 * and rebuilds two human-readable tabs on every save: "Chores" and "Cart".
 */

const DATA_SHEET_NAME = '_data';
const CHUNK_SIZE = 45000;

function doGet(e){
  const action = e.parameter.action;
  const callback = e.parameter.callback;

  if(action === 'load'){
    const data = loadData();
    const json = JSON.stringify(data);
    if(callback){
      return ContentService.createTextOutput(`${callback}(${json})`)
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
  }

  return ContentService.createTextOutput('Ledger sync endpoint. Use ?action=load or POST action=save.');
}

function doPost(e){
  try{
    const payload = JSON.parse(e.parameter.payload);
    if(payload.action === 'save'){
      saveData({
        chores: payload.chores || [],
        cartItems: payload.cartItems || [],
        categories: payload.categories || [],
        people: payload.people || []
      });
      return ContentService.createTextOutput(JSON.stringify({ ok:true }))
        .setMimeType(ContentService.MimeType.JSON);
    }
  }catch(err){
    return ContentService.createTextOutput(JSON.stringify({ ok:false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  return ContentService.createTextOutput(JSON.stringify({ ok:false, error:'Unknown action' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function getDataSheet(){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(DATA_SHEET_NAME);
  if(!sheet){
    sheet = ss.insertSheet(DATA_SHEET_NAME);
    sheet.hideSheet();
  }
  return sheet;
}

function loadData(){
  const sheet = getDataSheet();
  const lastRow = sheet.getLastRow();
  if(lastRow === 0) return { chores: [], cartItems: [], categories: [], people: [] };

  const values = sheet.getRange(1, 1, lastRow, 1).getValues();
  const jsonStr = values.map(r => r[0]).join('');
  if(!jsonStr) return { chores: [], cartItems: [], categories: [], people: [] };

  try{
    return JSON.parse(jsonStr);
  }catch(e){
    return { chores: [], cartItems: [], categories: [], people: [] };
  }
}

function saveData(data){
  const sheet = getDataSheet();
  sheet.clear();

  const jsonStr = JSON.stringify(data);
  const chunks = [];
  for(let i = 0; i < jsonStr.length; i += CHUNK_SIZE){
    chunks.push([jsonStr.slice(i, i + CHUNK_SIZE)]);
  }
  if(chunks.length){
    sheet.getRange(1, 1, chunks.length, 1).setValues(chunks);
  }

  rebuildReadableTabs(data);
}

function rebuildReadableTabs(data){
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const peopleById = {};
  (data.people || []).forEach(p => { peopleById[p.id] = p.name; });

  // Chores tab
  let choreSheet = ss.getSheetByName('Chores');
  if(!choreSheet) choreSheet = ss.insertSheet('Chores');
  choreSheet.clear();
  choreSheet.getRange(1,1,1,7).setValues([['Name','Area','Repeats (days)','Assigned To','Notes','Last Done','Current Streak']]);
  const choreRows = (data.chores || []).map(c=>{
    const hist = c.history || [];
    const last = hist.length ? hist[hist.length-1] : '';
    const assignee = c.assigneeId ? (peopleById[c.assigneeId] || '') : '';
    return [c.name, c.area, c.intervalDays, assignee, c.notes || '', last, computeStreak(c)];
  });
  if(choreRows.length) choreSheet.getRange(2,1,choreRows.length,7).setValues(choreRows);
  choreSheet.getRange(1,1,1,7).setFontWeight('bold');

  // Cart tab
  let cartSheet = ss.getSheetByName('Cart');
  if(!cartSheet) cartSheet = ss.insertSheet('Cart');
  cartSheet.clear();
  cartSheet.getRange(1,1,1,8).setValues([['Item','Qty','Category','Checked','Calories/100g','Protein/100g','Carbs/100g','Fat/100g']]);
  const cartRows = (data.cartItems || []).map(i=>{
    const n = i.nutrition;
    return [
      i.name, i.qty || '', i.category, i.checked ? 'Yes' : 'No',
      n ? Math.round(n.calories) : '',
      n ? n.protein : '',
      n ? n.carbs : '',
      n ? n.fat : ''
    ];
  });
  if(cartRows.length) cartSheet.getRange(2,1,cartRows.length,8).setValues(cartRows);
  cartSheet.getRange(1,1,1,8).setFontWeight('bold');

  // People tab
  let peopleSheet = ss.getSheetByName('People');
  if(!peopleSheet) peopleSheet = ss.insertSheet('People');
  peopleSheet.clear();
  peopleSheet.getRange(1,1,1,2).setValues([['Name','Color']]);
  const peopleRows = (data.people || []).map(p => [p.name, p.color]);
  if(peopleRows.length) peopleSheet.getRange(2,1,peopleRows.length,2).setValues(peopleRows);
  peopleSheet.getRange(1,1,1,2).setFontWeight('bold');
}

function computeStreak(chore){
  const hist = (chore.history || []).slice().sort();
  if(!hist.length) return 0;
  let streak = 1;
  for(let i = hist.length - 1; i > 0; i--){
    const gapDays = Math.round((new Date(hist[i]) - new Date(hist[i-1])) / 86400000);
    if(gapDays <= chore.intervalDays + 2) streak++;
    else break;
  }
  return streak;
}
