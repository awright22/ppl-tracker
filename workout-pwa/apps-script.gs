/**
 * PPL Tracker — Google Sheets backend (Apps Script Web App).
 *
 * Setup (one time, ~5 minutes):
 *  1. Create a Google Sheet (any name, e.g. "PPL Tracker Data").
 *  2. Extensions → Apps Script → delete the sample code, paste this file.
 *  3. Change TOKEN below to your own secret (letters/numbers, no spaces).
 *  4. Deploy → New deployment → type: Web app →
 *       Execute as: Me · Who has access: Anyone   ← "Anyone" is required,
 *       otherwise browsers get a Google login redirect instead of JSON.
 *  5. Authorize when prompted, copy the Web app URL (ends in /exec),
 *     and paste URL + token into the tracker's sync panel (the ☁︎ strip).
 *
 * Storage model: a `kv` tab mirrors the app's key-value records
 * (config, sessions-index, records, weights, session:<id>) — that's what
 * restore uses. `Sessions`, `Sets`, and `Weight` tabs are rebuilt on every
 * push as a readable, pivot-table-friendly view. Don't hand-edit kv; the
 * readable tabs are regenerated, so edit data in the app, not the sheet.
 */

var TOKEN = "CHANGE_ME";

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); }
  catch (err) { return jsonOut({ ok: false, error: "bad json" }); }
  return handle(req);
}

function doGet(e) {
  return handle({ action: (e.parameter.action || "pull"), token: e.parameter.token });
}

function handle(req) {
  if (!req || String(req.token) !== TOKEN) return jsonOut({ ok: false, error: "bad token" });
  var lock = LockService.getScriptLock();
  lock.tryLock(20000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var kv = getTab(ss, "kv", ["key", "json", "updatedAt"]);
    if (req.action === "pull") {
      var values = kv.getDataRange().getValues();
      var rows = [];
      for (var i = 1; i < values.length; i++) {
        if (!values[i][0]) continue;
        rows.push({ key: String(values[i][0]), json: values[i][1] === "" ? null : String(values[i][1]), updatedAt: Number(values[i][2]) || 0 });
      }
      return jsonOut({ ok: true, rows: rows });
    }
    if (req.action === "push") {
      upsert(kv, req.rows || []);
      rebuildReadable(ss, kv);
      return jsonOut({ ok: true, count: (req.rows || []).length });
    }
    return jsonOut({ ok: false, error: "unknown action" });
  } finally {
    lock.releaseLock();
  }
}

function upsert(kv, rows) {
  var values = kv.getDataRange().getValues();
  var indexOfKey = {};
  for (var i = 1; i < values.length; i++) indexOfKey[String(values[i][0])] = i + 1; // 1-based row
  rows.forEach(function (r) {
    if (!r || !r.key) return;
    var rowNum = indexOfKey[r.key];
    var payload = [r.key, r.json == null ? "" : String(r.json), Number(r.updatedAt) || Date.now()];
    if (rowNum) {
      var existingTs = Number(kv.getRange(rowNum, 3).getValue()) || 0;
      if (payload[2] >= existingTs) kv.getRange(rowNum, 1, 1, 3).setValues([payload]);
    } else {
      kv.appendRow(payload);
      indexOfKey[r.key] = kv.getLastRow();
    }
  });
}

function rebuildReadable(ss, kv) {
  var values = kv.getDataRange().getValues();
  var sessions = [];
  var weightsJson = "";
  for (var i = 1; i < values.length; i++) {
    var key = String(values[i][0]);
    if (key === "weights" && values[i][1] !== "") { weightsJson = String(values[i][1]); continue; }
    if (key.indexOf("session:") !== 0 || values[i][1] === "") continue;
    try { sessions.push(JSON.parse(values[i][1])); } catch (e) { /* skip corrupt row */ }
  }
  sessions.sort(function (a, b) { return a.date < b.date ? -1 : 1; });

  var sTab = getTab(ss, "Sessions", ["date", "day", "mode", "sets", "headline", "qlCheck", "id"]);
  var setTab = getTab(ss, "Sets", ["date", "day", "mode", "exercise", "set", "weight", "reps", "repsL", "repsR", "note", "sessionId"]);
  clearBelowHeader(sTab);
  clearBelowHeader(setTab);

  var sRows = [], setRows = [];
  sessions.forEach(function (s) {
    var nSets = 0, headline = "";
    if (s.run) headline = (s.run.miles || 0) + " mi · " + Math.round((s.run.seconds || 0) / 60) + " min";
    (s.exercises || []).forEach(function (ex) {
      (ex.sets || []).forEach(function (st, idx) {
        nSets++;
        setRows.push([s.date, s.dayType, s.mode, ex.name, idx + 1,
          st.weight == null ? "" : st.weight,
          st.reps == null ? "" : st.reps,
          st.repsL == null ? "" : st.repsL,
          st.repsR == null ? "" : st.repsR,
          ex.note || "", s.id]);
      });
      if (!headline && (ex.sets || []).length) headline = ex.name;
    });
    sRows.push([s.date, s.dayType, s.mode, nSets, headline, s.qlCheck || "", s.id]);
  });
  if (sRows.length) sTab.getRange(2, 1, sRows.length, sRows[0].length).setValues(sRows);
  if (setRows.length) setTab.getRange(2, 1, setRows.length, setRows[0].length).setValues(setRows);

  var wTab = getTab(ss, "Weight", ["date", "weight"]);
  clearBelowHeader(wTab);
  var wRows = [];
  if (weightsJson) {
    try {
      var entries = JSON.parse(weightsJson) || [];
      entries.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
      entries.forEach(function (e) {
        if (e && e.date) wRows.push([e.date, e.weight == null ? "" : e.weight]);
      });
    } catch (e) { /* corrupt weights row — leave the tab empty */ }
  }
  if (wRows.length) wTab.getRange(2, 1, wRows.length, wRows[0].length).setValues(wRows);
}

function getTab(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight("bold");
  }
  return sheet;
}

function clearBelowHeader(sheet) {
  var last = sheet.getLastRow();
  if (last > 1) sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).clearContent();
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
