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

/* Website reels: videos in this Drive folder play on isonali.com.
   The folder is created automatically on first use - just drop video files in. */
var REELS_FOLDER = "iSonali Website Reels";
/* ======================================================== */

/* ==== OPTIONAL: Instagram publishing + stats (Meta Graph API) ====
   1. developers.facebook.com -> create an App (type: Business).
   2. Add the "Instagram Graph API" product, connect the @isonalidotcom
      Instagram professional account (must be linked to a Facebook Page).
   3. Generate a long-lived Page access token (Graph API Explorer, then
      the token debugger -> "Extend Access Token").
   4. Project Settings -> Script Properties, add:
        IG_BUSINESS_ID   = Instagram Business Account id
                            (Graph API /me/accounts -> instagram_business_account.id)
        IG_ACCESS_TOKEN  = the long-lived token from step 3
   Without these, the Instagram tab still works for planning content —
   posting/stats just won't be available until connected.                */

/* ==== OPTIONAL: Google Meet auto-link generation ====
   In the Apps Script editor: Services (+) -> add "Google Calendar API"
   (advanced service), and enable the Calendar API in the linked Google
   Cloud project (a link appears when you add the service). Without this
   you can still add webinars — just paste the Meet/Zoom/Teams link
   yourself instead of using "Generate Meet Link".                        */

var SHEETS = {
  REG: "Registrations",
  CRM: "CRM",
  CLIENTS: "Clients",
  PLAN: "ContentPlanner",
  METRICS: "InstaMetrics",
  PAY: "Payments",
  WEB: "Webinars",
  ENQ: "Enquiries",
  BATCH: "Batches"
};

var HEADERS = {
  Registrations: ["Timestamp","Name","Email","Phone","City","Role","Program","Price","PaymentStatus"],
  CRM: ["Key","Name","Email","Phone","Status","Tags","Notes","LastContact"],
  Clients: ["Key","Name","Email","Phone","City","Groups","Source","JoinedDate"],
  ContentPlanner: ["Id","Platform","Type","Date","Idea","Caption","Status","Link","Views","Likes","Notes"],
  InstaMetrics: ["Date","Followers","Reach","ProfileViews","LinkClicks","Notes"],
  Payments: ["PaymentId","Date","Amount","Currency","Status","Method","Name","Email","Contact","Description","Program"],
  Webinars: ["Id","Title","DateTime","Platform","JoinLink","Price","Status","Notes","Group"],
  Enquiries: ["Id","Timestamp","Name","Email","Phone","Course","Message","Status","Reply","RepliedAt"],
  Batches: ["Id","Name","Program","DateTime","Platform","JoinLink","Status","Notes","CreatedAt"]
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
  try {
    return doGetInner_(e);
  } catch (err) {
    return ok_({ ok: false, error: "Server error: " + err.message });
  }
}

function doGetInner_(e) {
  var p = e.parameter || {};
  if (p.action === "login") {
    return ok_({ ok: authed_(p.key) });
  }
  // Public: reel videos shown on the website (no key needed)
  if (p.action === "instaPosts") {
    return ok_(websiteReels_());
  }
  if (!authed_(p.key)) return ok_({ ok: false, error: "unauthorized" });

  if (p.action === "data") {
    var props = PropertiesService.getScriptProperties();
    return ok_({
      ok: true,
      registrations: readSheet_(SHEETS.REG),
      crm: readSheet_(SHEETS.CRM),
      clients: readSheet_(SHEETS.CLIENTS),
      planner: readSheet_(SHEETS.PLAN),
      metrics: readSheet_(SHEETS.METRICS),
      payments: readSheet_(SHEETS.PAY),
      webinars: readSheet_(SHEETS.WEB),
      enquiries: readSheet_(SHEETS.ENQ),
      batches: readSheet_(SHEETS.BATCH),
      reels: websiteReels_(),
      razorpayConfigured: !!props.getProperty("RZP_KEY_ID"),
      youtubeConfigured: !!YT_API_KEY,
      instagramConfigured: !!(props.getProperty("IG_BUSINESS_ID") && props.getProperty("IG_ACCESS_TOKEN"))
    });
  }
  if (p.action === "syncRazorpay") {
    return ok_(syncRazorpay_());
  }
  if (p.action === "youtube") {
    return ok_(youtubeStats_());
  }
  if (p.action === "igStats") {
    return ok_(igStats_());
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
  try {
    return doPostInner_(e);
  } catch (err) {
    return ok_({ ok: false, error: "Server error: " + err.message });
  }
}

function doPostInner_(e) {
  var data = {};
  try { data = JSON.parse(e.postData.contents); } catch (err) { return ok_({ ok: false, error: "bad json" }); }

  // Public: course enquiry from the website contact form (no key required)
  if (data.action === "enquiry") {
    sheet_(SHEETS.ENQ).appendRow([Utilities.getUuid(),
      data.timestamp || new Date().toISOString(),
      data.name || "", data.email || "", data.phone || "",
      data.course || "", data.message || "", "New", "", ""]);
    return ok_({ ok: true });
  }

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
    case "setRegStatus":   return ok_(setRegStatus_(data));
    case "upsertCrm":      return ok_(upsertCrm_(data));
    case "addPlan":        return ok_(addPlan_(data));
    case "updatePlan":     return ok_(updatePlan_(data));
    case "deletePlan":     return ok_(deletePlan_(data));
    case "addMetrics":     return ok_(addMetrics_(data));
    case "addWebinar":     return ok_(addWebinar_(data));
    case "updateWebinar":  return ok_(updateWebinar_(data));
    case "generateMeetLink": return ok_(generateMeetLink_(data));
    case "notifyWebinarGroup": return ok_(notifyWebinarGroup_(data));
    case "replyEnquiry":   return ok_(replyEnquiry_(data));
    case "removeReel":     return ok_(removeReel_(data));
    case "upsertClient":   return ok_(upsertClient_(data));
    case "sendGroupEmail": return ok_(sendGroupEmail_(data));
    case "addBatch":       return ok_(addBatch_(data));
    case "updateBatch":    return ok_(updateBatch_(data));
    case "deleteBatch":    return ok_(deleteBatch_(data));
    case "setBatchMembers": return ok_(setBatchMembers_(data));
    case "sendBatchLink":  return ok_(sendBatchLink_(data));
    case "syncRazorpay":   return ok_(syncRazorpay_());
    case "resetDatabase":  return ok_(resetDatabase_(data));
    case "igCreateContainer": return ok_(igCreateContainer_(data));
    case "igPublishContainer": return ok_(igPublishContainer_(data));
    default:             return ok_({ ok: false, error: "unknown action" });
  }
}

// Mark a registration row paid/unpaid. Row identified by timestamp+phone.
function setRegStatus_(d) {
  var sh = sheet_(SHEETS.REG);
  var values = sh.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    // Values read from Sheets are Date objects, while the dashboard receives
    // JSON ISO timestamps. Comparing their string representations makes every
    // manual status update miss its row.
    if (timestampsMatch_(values[r][0], d.timestamp) && String(values[r][3]) === String(d.phone)) {
      sh.getRange(r + 1, 9).setValue(d.status);
      if (d.status === "PAID") {
        var row = values[r];
        addToClients_({ name: row[1], email: row[2], phone: row[3], city: row[4], program: row[6] });
      }
      return { ok: true };
    }
  }
  return { ok: false, error: "row not found" };
}

function timestampsMatch_(sheetValue, requestValue) {
  if (String(sheetValue) === String(requestValue)) return true;
  var sheetTime = sheetValue instanceof Date ? sheetValue.getTime() : new Date(sheetValue).getTime();
  var requestTime = new Date(requestValue).getTime();
  // Sheets preserves timestamps at second precision for this workflow.
  return !isNaN(sheetTime) && !isNaN(requestTime) && Math.abs(sheetTime - requestTime) < 1000;
}

// Adds/updates a client in the Main Database once they're a paying customer.
// Keyed by phone. Starting Group = their program name (rename/regroup anytime from the dashboard).
function addToClients_(info) {
  var sh = sheet_(SHEETS.CLIENTS);
  var key = String(info.phone || info.email || "");
  if (!key) return false;
  var values = sh.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === key) {
      // already a client - keep their existing Groups, just refresh contact details
      sh.getRange(r + 1, 2, 1, 4).setValues([[info.name || values[r][1], info.email || values[r][2],
        info.phone || values[r][3], info.city || values[r][4]]]);
      return false; // existing member, nothing new
    }
  }
  sh.appendRow([key, info.name || "", info.email || "", info.phone || "", info.city || "",
    info.program || "", "Registration", new Date().toISOString().slice(0, 10)]);
  return true; // brand new member
}

function upsertClient_(d) {
  var sh = sheet_(SHEETS.CLIENTS);
  var key = d.key || d.phone;
  if (!key) return { ok: false, error: "phone/key required" };
  var values = sh.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === String(key)) {
      sh.getRange(r + 1, 1, 1, 6).setValues([[key, d.name || values[r][1], d.email || values[r][2],
        d.phone || values[r][3], d.city || values[r][4], d.groups != null ? d.groups : values[r][5]]]);
      return { ok: true };
    }
  }
  sh.appendRow([key, d.name || "", d.email || "", d.phone || "", d.city || "", d.groups || "",
    d.source || "Manual", new Date().toISOString().slice(0, 10)]);
  return { ok: true };
}

// Email everyone in a given group (Groups column contains a comma-separated list).
function sendGroupEmail_(d) {
  if (!d.group || !d.subject || !d.message) return { ok: false, error: "group, subject, and message are required" };
  var rows = readSheet_(SHEETS.CLIENTS);
  var target = rows.filter(function (c) {
    return String(c.Groups || "").split(",").map(function (g) { return g.trim(); }).indexOf(d.group) !== -1;
  });
  var sent = 0;
  target.forEach(function (c) {
    if (!c.Email) return;
    try {
      MailApp.sendEmail({
        to: c.Email,
        subject: d.subject,
        body: "Hi " + (c.Name || "") + ",\n\n" + d.message +
          "\n\nWarm regards,\nSonali\nisonali.com | WhatsApp: +91 94213 57124",
        name: "Sonali - isonali.com"
      });
      sent++;
    } catch (err) { /* quota or bad address - skip */ }
  });
  return { ok: true, sent: sent, total: target.length };
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

function deletePlan_(d) {
  var sh = sheet_(SHEETS.PLAN);
  var values = sh.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === String(d.id)) {
      sh.deleteRow(r + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: "idea not found" };
}

// Webinars: Id, Title, DateTime, Platform, JoinLink, Price, Status, Notes, Group
function addWebinar_(d) {
  var id = Utilities.getUuid();
  sheet_(SHEETS.WEB).appendRow([id, d.title || "", d.dateTime || "",
    d.platform || "Google Meet", d.joinLink || "", d.price || "",
    d.status || "Planned", d.notes || "", d.group || ""]);
  return { ok: true, id: id };
}

function updateWebinar_(d) {
  var sh = sheet_(SHEETS.WEB);
  var values = sh.getDataRange().getValues();
  var cols = { title:2, dateTime:3, platform:4, joinLink:5, price:6, status:7, notes:8, group:9 };
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

// Requires the "Google Calendar API" advanced service to be enabled (see setup note at top).
function generateMeetLink_(d) {
  try {
    var start = new Date(d.dateTime);
    var end = new Date(start.getTime() + 60 * 60 * 1000);
    var event = {
      summary: d.title || "iSonali Webinar",
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      conferenceData: { createRequest: { requestId: Utilities.getUuid(), conferenceSolutionKey: { type: "hangoutsMeet" } } }
    };
    var created = Calendar.Events.insert(event, "primary", { conferenceDataVersion: 1 });
    return { ok: true, joinLink: created.hangoutLink, eventId: created.id };
  } catch (err) {
    return { ok: false, error: "Enable the Google Calendar API advanced service first (Services + in the Apps Script editor). " + err.message };
  }
}

// Emails + generates WhatsApp links for a group of clients about a specific webinar.
function notifyWebinarGroup_(d) {
  var webinars = readSheet_(SHEETS.WEB);
  var webinar = webinars.filter(function (w) { return String(w.Id) === String(d.webinarId); })[0];
  if (!webinar) return { ok: false, error: "webinar not found" };

  var clients = readSheet_(SHEETS.CLIENTS).filter(function (c) {
    return String(c.Groups || "").split(",").map(function (g) { return g.trim(); }).indexOf(d.group) !== -1;
  });

  var subject = "New webinar: " + webinar.Title;
  var body = "Hi {name},\n\nSonali is hosting a new session: \"" + webinar.Title + "\"\n" +
    "When: " + webinar.DateTime + "\nPlatform: " + webinar.Platform +
    (webinar.JoinLink ? "\nJoin link: " + webinar.JoinLink : "") +
    (webinar.Price ? "\nPrice: " + webinar.Price : "") +
    "\n\nSee you there!\nSonali";

  var emailed = 0;
  clients.forEach(function (c) {
    if (!c.Email) return;
    try {
      MailApp.sendEmail({ to: c.Email, subject: subject, body: body.replace("{name}", c.Name || ""), name: "Sonali - isonali.com" });
      emailed++;
    } catch (err) {}
  });

  var whatsappLinks = clients.filter(function (c) { return c.Phone; }).map(function (c) {
    var last10 = String(c.Phone).replace(/\D/g, "").slice(-10);
    var msg = body.replace("{name}", c.Name || "").replace(/\n/g, " ");
    return { name: c.Name, link: "https://wa.me/91" + last10 + "?text=" + encodeURIComponent(msg) };
  });

  return { ok: true, emailed: emailed, total: clients.length, whatsappLinks: whatsappLinks };
}

function addMetrics_(d) {
  sheet_(SHEETS.METRICS).appendRow([d.date || new Date().toISOString().slice(0, 10),
    d.followers || "", d.reach || "", d.profileViews || "", d.linkClicks || "", d.notes || ""]);
  return { ok: true };
}

// Reply to an enquiry: saves the reply, marks status, and (if the person left an
// email) sends the reply from Sonali's Gmail automatically.
function replyEnquiry_(d) {
  var sh = sheet_(SHEETS.ENQ);
  var values = sh.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === String(d.id)) {
      var email = values[r][3], name = values[r][2], course = values[r][5];
      if (d.reply != null) sh.getRange(r + 1, 9).setValue(d.reply);
      sh.getRange(r + 1, 8).setValue(d.status || "Replied");
      sh.getRange(r + 1, 10).setValue(new Date().toISOString());
      var emailSent = false;
      if (d.sendEmail && d.reply && email) {
        try {
          MailApp.sendEmail({
            to: email,
            subject: "Re: your enquiry about " + (course || "iSonali coaching"),
            body: "Hi " + (name || "") + ",\n\n" + d.reply +
              "\n\nWarm regards,\nSonali\nisonali.com | WhatsApp: +91 94213 57124",
            name: "Sonali - isonali.com"
          });
          emailSent = true;
        } catch (err) { /* mail quota or invalid address - reply is still saved */ }
      }
      return { ok: true, emailSent: emailSent };
    }
  }
  return { ok: false, error: "enquiry not found" };
}

/* ---------------- BATCHES (group members by date & time) ----------------
   A batch is simply a named group with a date/time and a join link.
   Membership lives in the Clients sheet's "Groups" column (comma separated),
   so a member can belong to more than one batch.                         */

function groupList_(value) {
  return String(value || "").split(",").map(function (g) { return g.trim(); })
    .filter(function (g) { return g.length; });
}

function addBatch_(d) {
  if (!d.name) return { ok: false, error: "Batch name is required" };
  var id = Utilities.getUuid();
  sheet_(SHEETS.BATCH).appendRow([id, d.name, d.program || "", d.dateTime || "",
    d.platform || "Google Meet", d.joinLink || "", d.status || "Scheduled",
    d.notes || "", new Date().toISOString()]);
  return { ok: true, id: id };
}

function updateBatch_(d) {
  var sh = sheet_(SHEETS.BATCH);
  var values = sh.getDataRange().getValues();
  var cols = { name: 2, program: 3, dateTime: 4, platform: 5, joinLink: 6, status: 7, notes: 8 };
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) !== String(d.id)) continue;
    var oldName = String(values[r][1]);
    for (var k in cols) if (d[k] != null) sh.getRange(r + 1, cols[k]).setValue(d[k]);
    // Keep membership intact when a batch is renamed.
    if (d.name && d.name !== oldName) renameGroupEverywhere_(oldName, d.name);
    return { ok: true };
  }
  return { ok: false, error: "batch not found" };
}

function deleteBatch_(d) {
  var sh = sheet_(SHEETS.BATCH);
  var values = sh.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]) === String(d.id)) {
      renameGroupEverywhere_(String(values[r][1]), null); // null = remove
      sh.deleteRow(r + 1);
      return { ok: true };
    }
  }
  return { ok: false, error: "batch not found" };
}

// Rename (or remove, when newName is null) a group across every client row.
function renameGroupEverywhere_(oldName, newName) {
  var sh = sheet_(SHEETS.CLIENTS);
  var values = sh.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    var groups = groupList_(values[r][5]);
    if (groups.indexOf(oldName) === -1) continue;
    groups = groups.map(function (g) { return g === oldName ? newName : g; })
      .filter(function (g) { return g; });
    sh.getRange(r + 1, 6).setValue(groups.join(", "));
  }
}

// Replace a batch's member list in one shot. d.keys = array of client keys (phone).
function setBatchMembers_(d) {
  if (!d.batchName) return { ok: false, error: "batchName required" };
  var wanted = {};
  (d.keys || []).forEach(function (k) { wanted[String(k)] = true; });

  var sh = sheet_(SHEETS.CLIENTS);
  var values = sh.getDataRange().getValues();
  var changed = 0;
  for (var r = 1; r < values.length; r++) {
    var key = String(values[r][0]);
    var groups = groupList_(values[r][5]);
    var has = groups.indexOf(d.batchName) !== -1;
    if (wanted[key] && !has) groups.push(d.batchName);
    else if (!wanted[key] && has) groups = groups.filter(function (g) { return g !== d.batchName; });
    else continue;
    sh.getRange(r + 1, 6).setValue(groups.join(", "));
    changed++;
  }
  return { ok: true, changed: changed, members: Object.keys(wanted).length };
}

// Send a batch's session details by email, and return ready-to-click WhatsApp
// links. d.keys (optional) limits the send to specific people; without it the
// whole batch is contacted.
function sendBatchLink_(d) {
  var batch = readSheet_(SHEETS.BATCH).filter(function (b) { return String(b.Id) === String(d.batchId); })[0];
  if (!batch) return { ok: false, error: "batch not found" };

  var only = null;
  if (d.keys && d.keys.length) {
    only = {};
    d.keys.forEach(function (k) { only[String(k)] = true; });
  }

  var members = readSheet_(SHEETS.CLIENTS).filter(function (c) {
    if (only) return !!only[String(c.Key)];
    return groupList_(c.Groups).indexOf(batch.Name) !== -1;
  });
  if (!members.length) return { ok: false, error: "no members in this batch yet" };

  var when = batch.DateTime
    ? Utilities.formatDate(new Date(batch.DateTime), Session.getScriptTimeZone(), "EEE, d MMM yyyy 'at' h:mm a")
    : "";
  var subject = d.subject || ("Your session: " + batch.Name);
  var template = d.message || ("Hi {name},\n\nHere are the details for your session" +
    (batch.Program ? " (" + batch.Program + ")" : "") + ".\n\n" +
    "Batch: " + batch.Name + "\n" +
    (when ? "When: " + when + "\n" : "") +
    (batch.Platform ? "Where: " + batch.Platform + "\n" : "") +
    (batch.JoinLink ? "Join link: " + batch.JoinLink + "\n" : "") +
    (batch.Notes ? "\n" + batch.Notes + "\n" : "") +
    "\nSee you there!\nSonali\nisonali.com");

  var emailed = 0, failed = [];
  var whatsappLinks = [];
  members.forEach(function (c) {
    var body = template.replace(/\{name\}/g, c.Name || "there");
    if (c.Email) {
      try {
        MailApp.sendEmail({ to: c.Email, subject: subject, body: body, name: "Sonali - isonali.com" });
        emailed++;
      } catch (err) { failed.push(c.Name || c.Email); }
    }
    if (c.Phone) {
      var last10 = String(c.Phone).replace(/\D/g, "").slice(-10);
      whatsappLinks.push({
        name: c.Name || last10,
        link: "https://wa.me/91" + last10 + "?text=" + encodeURIComponent(body)
      });
    }
  });

  return { ok: true, emailed: emailed, total: members.length, failed: failed, whatsappLinks: whatsappLinks };
}

/* ---------------- DATABASE RESET ----------------
   Wipes every data tab and rebuilds the paid/registered list straight from
   Razorpay, so the dashboard only ever shows people who actually paid.
   Guarded by the dashboard key AND an explicit confirmation string.       */

function resetDatabase_(d) {
  if (String(d.confirm) !== "DELETE") {
    return { ok: false, error: 'Confirmation missing - type DELETE to proceed' };
  }
  var ss = spreadsheet_();
  var wiped = [];
  [SHEETS.REG, SHEETS.CRM, SHEETS.CLIENTS, SHEETS.PAY, SHEETS.ENQ].forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (sh) ss.deleteSheet(sh);      // delete + recreate guarantees fresh headers
    sheet_(name);
    wiped.push(name);
  });
  var sync = syncRazorpay_();
  return {
    ok: true,
    wiped: wiped,
    rebuilt: sync.ok ? sync.added : 0,
    registered: sync.ok ? sync.registered : 0,
    syncError: sync.ok ? null : sync.error
  };
}

/* ---------------- RAZORPAY SYNC (optional) ---------------- */

function syncRazorpay_() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty("RZP_KEY_ID"), secret = props.getProperty("RZP_KEY_SECRET");
  if (!id || !secret) return { ok: false, error: "Razorpay keys not configured" };

  // Pull up to 500 payments, newest first (Razorpay caps each page at 100).
  var items = [], page;
  for (page = 0; page < 5; page++) {
    var url = "https://api.razorpay.com/v1/payments?count=100&skip=" + (page * 100);
    var resp = UrlFetchApp.fetch(url, {
      headers: { Authorization: "Basic " + Utilities.base64Encode(id + ":" + secret) },
      muteHttpExceptions: true
    });
    if (resp.getResponseCode() !== 200) {
      if (page === 0) return { ok: false, error: "Razorpay API " + resp.getResponseCode() };
      break; // keep whatever we already fetched
    }
    var batch = JSON.parse(resp.getContentText()).items || [];
    items = items.concat(batch);
    if (batch.length < 100) break;
  }

  var sh = sheet_(SHEETS.PAY);
  upgradePaymentsHeader_(sh);

  var existing = {};
  sh.getDataRange().getValues().slice(1).forEach(function (row) { existing[row[0]] = true; });

  var added = 0, registered = 0, captured = 0;
  var rows = [];

  items.forEach(function (pmt) {
    var name = rzpName_(pmt);
    var program = rzpProgram_(pmt);

    // Only append rows we have never stored before...
    if (!existing[pmt.id]) {
      rows.push([pmt.id, new Date(pmt.created_at * 1000).toISOString(),
        pmt.amount / 100, pmt.currency, pmt.status, pmt.method || "",
        name, pmt.email || "", pmt.contact || "", pmt.description || "", program]);
      added++;
    }

    // ...but ALWAYS reconcile captured payments into the member list. Payments
    // synced by an older version of this script were recorded without ever
    // creating a client, so this backfills them. addToClients_ is keyed by
    // phone and returns true only when someone is genuinely new.
    if (pmt.status === "captured") {
      captured++;
      var isNew = addToClients_({ name: name, email: pmt.email || "", phone: pmt.contact || "",
        city: "", program: program });
      if (isNew) registered++;
      markRegistrationPaid_(pmt);
    }
  });

  if (rows.length) {
    sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }
  return { ok: true, added: added, total: items.length, captured: captured,
    registered: registered, reconciled: registered };
}

// Older versions of this script wrote 9 columns to Payments. The current
// version writes 11 (Name and Program were added). If the sheet still has the
// old header row, every value after "Method" would be read under the wrong
// name - so rewrite the header and shuffle the old rows into place first.
function upgradePaymentsHeader_(sh) {
  var want = HEADERS.Payments;
  var lastCol = sh.getLastColumn();
  var header = lastCol ? sh.getRange(1, 1, 1, lastCol).getValues()[0] : [];
  if (String(header[6]) === "Name" && String(header[10]) === "Program") return; // already current

  var lastRow = sh.getLastRow();
  if (lastRow > 1) {
    // Old order: ...Method, Email, Contact, Description
    // New order: ...Method, Name, Email, Contact, Description, Program
    var old = sh.getRange(2, 1, lastRow - 1, Math.max(lastCol, 9)).getValues();
    var moved = old.map(function (r) {
      return [r[0], r[1], r[2], r[3], r[4], r[5], "", r[6] || "", r[7] || "", r[8] || "", r[8] || ""];
    });
    sh.getRange(2, 1, moved.length, want.length).setValues(moved);
  }
  sh.getRange(1, 1, 1, want.length).setValues([want]);
  sh.setFrozenRows(1);
}

// Razorpay puts the payer's name in different places depending on the method.
function rzpName_(pmt) {
  var notes = pmt.notes || {};
  var fromNotes = notes.name || notes.Name || notes.full_name || notes.customer_name || "";
  if (fromNotes) return String(fromNotes);
  if (pmt.card && pmt.card.name) return String(pmt.card.name);
  if (pmt.email) return String(pmt.email).split("@")[0].replace(/[._-]+/g, " ");
  return "";
}

// The program name comes from the ?description= we attach to each payment link.
function rzpProgram_(pmt) {
  var notes = pmt.notes || {};
  return String(notes.program || notes.Program || pmt.description || "");
}

// Legacy support: if an old website-form registration exists for this payer,
// flip it to PAID so nothing looks unpaid twice.
function markRegistrationPaid_(pmt) {
  var sh = sheet_(SHEETS.REG);
  var values = sh.getDataRange().getValues();
  var last10 = String(pmt.contact || "").replace(/\D/g, "").slice(-10);
  var email = String(pmt.email || "").toLowerCase();
  for (var r = 1; r < values.length; r++) {
    if (values[r][8] === "PAID") continue;
    var regPhone = String(values[r][3] || "").replace(/\D/g, "").slice(-10);
    var regEmail = String(values[r][2] || "").toLowerCase();
    if ((last10 && regPhone === last10) || (email && regEmail === email)) {
      sh.getRange(r + 1, 9).setValue("PAID");
      return;
    }
  }
}

// Website reels: served from a Drive folder so videos play natively on the
// site with no Instagram player, buttons or banners.
function reelsFolder_() {
  var it = DriveApp.getFoldersByName(REELS_FOLDER);
  return it.hasNext() ? it.next() : DriveApp.createFolder(REELS_FOLDER);
}

function websiteReels_() {
  // Drive is optional. A missing Drive authorization must not stop the public
  // website or the rest of the dashboard from loading.
  try {
    var cache = CacheService.getScriptCache();
    var hit = cache.get("reels_v1");
    if (hit) return JSON.parse(hit);
    var folder = reelsFolder_();
    var files = folder.getFiles();
    var list = [];
    while (files.hasNext()) {
      var f = files.next();
      if (String(f.getMimeType()).indexOf("video/") !== 0) continue;
      try { f.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (err) {}
      list.push({ id: f.getId(), name: f.getName(), added: f.getDateCreated().toISOString() });
    }
    list.sort(function (a, b) { return a.added < b.added ? 1 : -1; });
    var res = { ok: true, videos: list, folderUrl: folder.getUrl() };
    cache.put("reels_v1", JSON.stringify(res), 300); // 5 min cache
    return res;
  } catch (err) {
    return { ok: false, videos: [], folderUrl: "", error: "Drive access has not been authorized" };
  }
}

function removeReel_(d) {
  try {
    DriveApp.getFileById(String(d.id)).setTrashed(true);
    CacheService.getScriptCache().remove("reels_v1");
    return { ok: true };
  } catch (err) {
    return { ok: false, error: "could not remove video" };
  }
}

/* ---------------- INSTAGRAM (optional, needs Meta app - see setup note at top) ---------------- */

function igCreds_() {
  var props = PropertiesService.getScriptProperties();
  return { igId: props.getProperty("IG_BUSINESS_ID"), token: props.getProperty("IG_ACCESS_TOKEN") };
}

function igStats_() {
  var creds = igCreds_();
  if (!creds.igId || !creds.token) return { ok: false, error: "Instagram not connected yet" };
  var base = "https://graph.facebook.com/v19.0/";
  var account = fetchJson_(base + creds.igId + "?fields=username,followers_count,media_count&access_token=" + creds.token);
  var media = fetchJson_(base + creds.igId + "/media?fields=id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count&limit=25&access_token=" + creds.token);

  var totalViews = 0;
  var items = (media.data || []).map(function (m) {
    var views = null, reach = null;
    // "views" is the current unified metric for video/reels/image insights (Graph API v20+).
    try {
      var metric = (m.media_type === "IMAGE") ? "views,reach" : "views,reach,saved,shares";
      var insights = fetchJson_(base + m.id + "/insights?metric=" + metric + "&access_token=" + creds.token);
      (insights.data || []).forEach(function (row) {
        var val = row.values && row.values[0] ? row.values[0].value : (row.total_value ? row.total_value.value : null);
        if (row.name === "views") views = val;
        if (row.name === "reach") reach = val;
      });
    } catch (err) { /* older media or unsupported metric for this type - skip insights */ }
    if (typeof views === "number") totalViews += views;
    return { id: m.id, caption: m.caption || "", type: m.media_type, thumbnail: m.thumbnail_url || m.media_url,
      permalink: m.permalink, timestamp: m.timestamp, likes: m.like_count || 0, comments: m.comments_count || 0,
      views: views, reach: reach };
  });
  return { ok: true, account: account, media: items, totalViews: totalViews };
}

// Step 1 of publishing: create a media container (Instagram then needs a few
// seconds - longer for video/reels - to process it before it can be published).
function igCreateContainer_(d) {
  var creds = igCreds_();
  if (!creds.igId || !creds.token) return { ok: false, error: "Instagram not connected yet" };
  if (!d.mediaUrl) return { ok: false, error: "mediaUrl (a public https link to the image/video) is required" };

  var params = { caption: d.caption || "", access_token: creds.token };
  var isVideo = d.mediaType === "VIDEO" || d.mediaType === "REELS";
  params[isVideo ? "video_url" : "image_url"] = d.mediaUrl;
  if (d.mediaType === "REELS") params.media_type = "REELS";

  var resp = UrlFetchApp.fetch("https://graph.facebook.com/v19.0/" + creds.igId + "/media", {
    method: "post", payload: params, muteHttpExceptions: true
  });
  var json = JSON.parse(resp.getContentText());
  if (!json.id) return { ok: false, error: "Could not create post: " + resp.getContentText() };
  return { ok: true, containerId: json.id, isVideo: isVideo };
}

// Step 2: publish a container created above. For video/reels, call this again
// (a few seconds later) if it returns "still processing".
function igPublishContainer_(d) {
  var creds = igCreds_();
  if (!creds.igId || !creds.token) return { ok: false, error: "Instagram not connected yet" };
  if (!d.containerId) return { ok: false, error: "containerId required" };

  var statusResp = fetchJson_("https://graph.facebook.com/v19.0/" + d.containerId + "?fields=status_code&access_token=" + creds.token);
  if (statusResp.status_code === "IN_PROGRESS") return { ok: false, error: "Instagram is still processing this media - try Publish again in a moment", stillProcessing: true };
  if (statusResp.status_code === "ERROR") return { ok: false, error: "Instagram could not process this media" };

  var resp = UrlFetchApp.fetch("https://graph.facebook.com/v19.0/" + creds.igId + "/media_publish", {
    method: "post", payload: { creation_id: d.containerId, access_token: creds.token }, muteHttpExceptions: true
  });
  var json = JSON.parse(resp.getContentText());
  if (!json.id) return { ok: false, error: "Publish failed: " + resp.getContentText() };
  return { ok: true, postId: json.id };
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
