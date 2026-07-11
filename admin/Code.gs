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
var SHEET_ID = "145sNrUGAKGSHSKyNz9g0sdWRB-WHkytSbySGw5J-87Y"; // ONLY if script is not attached to the Sheet:
                                 // paste the long id from the Sheet URL
                                 // docs.google.com/spreadsheets/d/THIS_PART/edit
/* ==== OPTIONAL: YouTube (fills the video views table automatically) ====
   1. console.cloud.google.com -> create project -> enable "YouTube Data API v3"
   2. Credentials -> Create API key -> paste below
   3. Put the channel handle (like @isonalidotcom) below                    */
var YT_API_KEY = "";
var YT_CHANNEL = ""; // example: "@isonalidotcom"
/* ======================================================== */

var SHEETS = {
  REG: "Registrations",
  CRM: "CRM",
  PLAN: "ContentPlanner",
  METRICS: "InstaMetrics",
  PAY: "Payments",
  WEB: "Webinars"
};

var HEADERS = {
  Registrations: ["Timestamp","Name","Email","Phone","City","Role","Program","Price","PaymentStatus"],
  CRM: ["Key","Name","Email","Phone","Status","Tags","Notes","LastContact"],
  ContentPlanner: ["Id","Platform","Type","Date","Idea","Caption","Status","Link","Views","Likes","Notes"],
  InstaMetrics: ["Date","Followers","Reach","ProfileViews","LinkClicks","Notes"],
  Payments: ["PaymentId","Date","Amount","Currency","Status","Method","Email","Contact","Description"],
  Webinars: ["Id","Title","DateTime","Platform","JoinLink","Price","Status","Notes"]
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
      webinars: readSheet_(SHEETS.WEB),
      razorpayConfigured: !!PropertiesService.getScriptProperties().getProperty("RZP_KEY_ID"),
      youtubeConfigured: !!YT_API_KEY
    });
  }
  if (p.action === "syncRazorpay") {
    return ok_(syncRazorpay_());
  }
  if (p.action === "youtube") {
    return ok_(youtubeStats_());
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
    case "addWebinar":   return ok_(addWebinar_(data));
    case "updateWebinar":return ok_(updateWebinar_(data));
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

// Content planner: Id, Platform, Type, Date, Idea, Caption, Status, Link, Views, Likes, Notes
function addPlan_(d) {
  sheet_(SHEETS.PLAN).appendRow([Utilities.getUuid(), d.platform || "Instagram",
    d.type || "Post", d.date || "", d.idea || "", d.caption || "",
    d.status || "Idea", d.link || "", d.views || "", d.likes || "", d.notes || ""]);
  return { ok: true };
}

function updatePlan_(d) {
  var sh = sheet_(SHEETS.PLAN);
  var values = sh.getDataRange().getValues();
  var cols = { platform:2, type:3, date:4, idea:5, caption:6, status:7, link:8, views:9, likes:10, notes:11 };
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === String(d.id)) {
      for (var k in cols) {
        if (d[k] != null) sh.getRange(r + 1, cols[k]).setValue(d[k]);
      }
      return { ok: true };
    }
  }
  return { ok: false, error: "plan not found" };
}

// Webinars: Id, Title, DateTime, Platform, JoinLink, Price, Status, Notes
function addWebinar_(d) {
  var id = Utilities.getUuid();
  sheet_(SHEETS.WEB).appendRow([id, d.title || "", d.dateTime || "",
    d.platform || "Google Meet", d.joinLink || "", d.price || "",
    d.status || "Planned", d.notes || ""]);
  return { ok: true, id: id };
}

function updateWebinar_(d) {
  var sh = sheet_(SHEETS.WEB);
  var values = sh.getDataRange().getValues();
  var cols = { title:2, dateTime:3, platform:4, joinLink:5, price:6, status:7, notes:8 };
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === String(d.id)) {
      for (var k in cols) {
        if (d[k] != null) sh.getRange(r + 1, cols[k]).setValue(d[k]);
      }
      return { ok: true };
    }
  }
  return { ok: false, error: "webinar not found" };
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

/* ---------------- YOUTUBE STATS (optional) ---------------- */

function youtubeStats_() {
  if (!YT_API_KEY || !YT_CHANNEL) return { ok: false, error: "YouTube not configured" };
  var base = "https://www.googleapis.com/youtube/v3/";
  var key = "&key=" + YT_API_KEY;

  // 1. Find the channel (by @handle or channel id)
  var chUrl = base + "channels?part=contentDetails,statistics,snippet" +
    (YT_CHANNEL.charAt(0) === "@" ? "&forHandle=" + encodeURIComponent(YT_CHANNEL)
                                  : "&id=" + encodeURIComponent(YT_CHANNEL)) + key;
  var ch = fetchJson_(chUrl);
  if (!ch.items || !ch.items.length) return { ok: false, error: "channel not found" };
  var channel = ch.items[0];
  var uploads = channel.contentDetails.relatedPlaylists.uploads;

  // 2. Latest 25 uploads
  var pl = fetchJson_(base + "playlistItems?part=contentDetails&maxResults=25&playlistId=" + uploads + key);
  var ids = (pl.items || []).map(function (i) { return i.contentDetails.videoId; }).join(",");
  if (!ids) return { ok: true, channel: channelInfo_(channel), videos: [] };

  // 3. Stats for those videos
  var vids = fetchJson_(base + "videos?part=snippet,statistics,contentDetails&id=" + ids + key);
  var videos = (vids.items || []).map(function (v) {
    return {
      id: v.id,
      title: v.snippet.title,
      publishedAt: v.snippet.publishedAt,
      thumbnail: (v.snippet.thumbnails.medium || v.snippet.thumbnails.default || {}).url || "",
      views: +(v.statistics.viewCount || 0),
      likes: +(v.statistics.likeCount || 0),
      comments: +(v.statistics.commentCount || 0),
      isShort: isShort_(v.contentDetails.duration)
    };
  });
  return { ok: true, channel: channelInfo_(channel), videos: videos };
}

function channelInfo_(c) {
  return {
    title: c.snippet.title,
    subscribers: +(c.statistics.subscriberCount || 0),
    totalViews: +(c.statistics.viewCount || 0),
    videoCount: +(c.statistics.videoCount || 0)
  };
}

function isShort_(isoDuration) {
  // Shorts are 3 minutes or less (PT#M#S)
  var m = String(isoDuration || "").match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if (!m) return false;
  var secs = (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0);
  return secs > 0 && secs <= 180;
}

function fetchJson_(url) {
  return JSON.parse(UrlFetchApp.fetch(url, { muteHttpExceptions: true }).getContentText());
}
