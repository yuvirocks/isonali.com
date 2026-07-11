/**
 * iSonali Dashboard Backend - Google Apps Script
 * ------------------------------------------------
 * Replaces/extends the existing registration capture script.
 *
 * SETUP (one time):
 * 1. Open script.google.com -> your existing project (or a new one bound to the Sheet).
 * 2. Paste this entire file over the old code.
 * 3. Project Settings -> Script Properties -> add:
 *      DASH_KEY        = the dashboard password you choose (e.g. Sonali@2026!)
 *      RZP_KEY_ID      = (optional) Razorpay Key Id      -> enables payment sync
 *      RZP_KEY_SECRET  = (optional) Razorpay Key Secret  -> enables payment sync
 * 4. Deploy -> Manage deployments -> Edit -> New version -> Deploy
 *    (Execute as: Me | Who has access: Anyone)
 * 5. Copy the /exec URL into dashboard.html (SCRIPT_URL) - it is usually
 *    the same URL the website already uses.
 *
 * Sheets auto-created: Registrations, CRM, InstaPlanner, InstaMetrics, Payments
 */

/* ================= EDIT THESE TWO LINES ================= */
var DASH_PASSWORD = "Shon@2026"; // dashboard login password
var SHEET_ID = "";               // ONLY if script is not attached to the Sheet:
                                 // paste the long id from the Sheet URL
                                 // docs.google.com/spreadsheets/d/THIS_PART/edit
/* ======================================================== */

var SHEETS = {
  REG: "Registrations",
  CRM: "CRM",
  PLAN: "InstaPlanner",
  METRICS: "InstaMetrics",
  PAY: "Payments"
};

var HEADERS = {
  Registrations: ["Timestamp","Name","Email","Phone","City","Role","Program","Price","PaymentStatus"],
  CRM: ["Key","Name","Email","Phone","Status","Tags","Notes","LastContact"],
  InstaPlanner: ["Id","Date","Idea","Caption","Status","PostedUrl","Result"],
  InstaMetrics: ["Date","Followers","Reach","ProfileViews","LinkClicks","Notes"],
  Payments: ["PaymentId","Date","Amount","Currency","Status","Method","Email","Contact","Description"]
};

function spreadsheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    // Standalone script (not bound to the Sheet): set Script Property SHEET_ID
    // to the ID from the Sheet's URL (docs.google.com/spreadsheets/d/<SHEET_ID>/edit)
    var id = SHEET_ID || PropertiesService.getScriptProperties().getProperty("SHEET_ID");
    if (!id) throw new Error("Fill in the SHEET_ID line at the top of this file (script is not attached to a Sheet)");
    ss = SpreadsheetApp.openById(id);
  }
  return ss;
}

function sheet_(name) {
  var ss = spreadsheet_();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.appendRow(HEADERS[name]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function ok_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function authed_(key) {
  var real = PropertiesService.getScriptProperties().getProperty("DASH_KEY") || DASH_PASSWORD;
  return !!real && key === real;
}

/* ---------------- READS (dashboard) ---------------- */

function doGet(e) {
  var p = e.parameter || {};
  if (p.action === "login") {
    return ok_({ ok: authed_(p.key) });
  }
  if (!authed_(p.key)) return ok_({ ok: false, error: "unauthorized" });

  if (p.action === "data") {
    return ok_({
      ok: true,
      registrations: readSheet_(SHEETS.REG),
      crm: readSheet_(SHEETS.CRM),
      planner: readSheet_(SHEETS.PLAN),
      metrics: readSheet_(SHEETS.METRICS),
      payments: readSheet_(SHEETS.PAY),
      razorpayConfigured: !!PropertiesService.getScriptProperties().getProperty("RZP_KEY_ID")
    });
  }
  if (p.action === "syncRazorpay") {
    return ok_(syncRazorpay_());
  }
  return ok_({ ok: false, error: "unknown action" });
}

function readSheet_(name) {
  var sh = sheet_(name);
  var values = sh.getDataRange().getValues();
  var headers = values.shift() || [];
  return values.map(function (row) {
    var o = {};
    headers.forEach(function (h, i) { o[h] = row[i]; });
    return o;
  });
}

/* ---------------- WRITES ---------------- */

function doPost(e) {
  var data = {};
  try { data = JSON.parse(e.postData.contents); } catch (err) { return ok_({ ok: false, error: "bad json" }); }

  // Public: website registration form (no key required - same as before)
  if (!data.action || data.action === "register") {
    sheet_(SHEETS.REG).appendRow([
      data.timestamp || new Date().toISOString(),
      data.name || "", data.email || "", data.phone || "", data.city || "",
      data.role || "", data.program || "", data.displayedPrice || "",
      data.paymentStatus || "PAYMENT_LINK_OPENED_NOT_VERIFIED"
    ]);
    return ok_({ ok: true });
  }

  // Everything else requires the dashboard key
  if (!authed_(data.key)) return ok_({ ok: false, error: "unauthorized" });

  switch (data.action) {
    case "setRegStatus": return ok_(setRegStatus_(data));
    case "upsertCrm":    return ok_(upsertCrm_(data));
    case "addPlan":      return ok_(addPlan_(data));
    case "updatePlan":   return ok_(updatePlan_(data));
    case "addMetrics":   return ok_(addMetrics_(data));
    default:             return ok_({ ok: false, error: "unknown action" });
  }
}

// Mark a registration row paid/unpaid. Row identified by timestamp+phone.
function setRegStatus_(d) {
  var sh = sheet_(SHEETS.REG);
  var values = sh.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === String(d.timestamp) && String(values[r][3]) === String(d.phone)) {
      sh.getRange(r + 1, 9).setValue(d.status);
      return { ok: true };
    }
  }
  return { ok: false, error: "row not found" };
}

// CRM keyed by phone (fallback email)
function upsertCrm_(d) {
  var sh = sheet_(SHEETS.CRM);
  var key = d.crmKey;
  var values = sh.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === String(key)) {
      sh.getRange(r + 1, 1, 1, 8).setValues([[key, d.name || values[r][1], d.email || values[r][2],
        d.phone || values[r][3], d.status || values[r][4], d.tags != null ? d.tags : values[r][5],
        d.notes != null ? d.notes : values[r][6], d.lastContact || values[r][7]]]);
      return { ok: true };
    }
  }
  sh.appendRow([key, d.name || "", d.email || "", d.phone || "", d.status || "Lead",
    d.tags || "", d.notes || "", d.lastContact || ""]);
  return { ok: true };
}

function addPlan_(d) {
  sheet_(SHEETS.PLAN).appendRow([Utilities.getUuid(), d.date || "", d.idea || "",
    d.caption || "", d.status || "Idea", "", ""]);
  return { ok: true };
}

function updatePlan_(d) {
  var sh = sheet_(SHEETS.PLAN);
  var values = sh.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === String(d.id)) {
      if (d.date != null) sh.getRange(r + 1, 2).setValue(d.date);
      if (d.idea != null) sh.getRange(r + 1, 3).setValue(d.idea);
      if (d.caption != null) sh.getRange(r + 1, 4).setValue(d.caption);
      if (d.status != null) sh.getRange(r + 1, 5).setValue(d.status);
      if (d.postedUrl != null) sh.getRange(r + 1, 6).setValue(d.postedUrl);
      if (d.result != null) sh.getRange(r + 1, 7).setValue(d.result);
      return { ok: true };
    }
  }
  return { ok: false, error: "plan not found" };
}

function addMetrics_(d) {
  sheet_(SHEETS.METRICS).appendRow([d.date || new Date().toISOString().slice(0, 10),
    d.followers || "", d.reach || "", d.profileViews || "", d.linkClicks || "", d.notes || ""]);
  return { ok: true };
}

/* ---------------- RAZORPAY SYNC (optional) ---------------- */

function syncRazorpay_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("RZP_KEY_ID"), secret = props.getProperty("RZP_KEY_SECRET");
  if (!id || !secret) return { ok: false, error: "Razorpay keys not configured" };

  var resp = UrlFetchApp.fetch("https://api.razorpay.com/v1/payments?count=100", {
    headers: { Authorization: "Basic " + Utilities.base64Encode(id + ":" + secret) },
    muteHttpExceptions: true
  });
  if (resp.getResponseCode() !== 200) return { ok: false, error: "Razorpay API " + resp.getResponseCode() };

  var items = JSON.parse(resp.getContentText()).items || [];
  var sh = sheet_(SHEETS.PAY);
  var existing = {};
  sh.getDataRange().getValues().slice(1).forEach(function (row) { existing[row[0]] = true; });

  var added = 0;
  items.forEach(function (pmt) {
    if (existing[pmt.id]) return;
    sh.appendRow([pmt.id, new Date(pmt.created_at * 1000).toISOString(),
      pmt.amount / 100, pmt.currency, pmt.status, pmt.method || "",
      pmt.email || "", pmt.contact || "", pmt.description || ""]);
    added++;
  });
  return { ok: true, added: added, total: items.length };
}
