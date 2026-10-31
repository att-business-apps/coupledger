/**
 * Coupledger backend on Google Sheets (Google Apps Script web app)
 * ------------------------------------------------------------------
 * Setup: open a new Google Sheet > Extensions > Apps Script > paste this file >
 * run setup() once and approve the permissions > Deploy > New deployment > Web app:
 *   Execute as: Me      Who has access: Anyone
 * Copy the web app URL into the app (SHEETS_API_URL).
 *
 * Tabs (created automatically): Users, Sessions, Resets, Households, Members,
 * Invites, Accounts, Categories, Entries, Settings.
 * Do not edit the tabs by hand while people are using the app.
 */

const APP_URL = 'https://demo.amortree.com/Coupledger/'; // where the web app lives (used in password-reset emails)
const APP_NAME = 'Coupledger';
const SESSION_DAYS = 60;
const PW_ROUNDS = 600;          // password hashing rounds (iterated HMAC-SHA256)
const MAX_FAILS = 8, LOCK_MIN = 15;

// column types: s = text, n = number, b = true/false
const SCHEMA = {
  Users:      { id:'s', email:'s', name:'s', salt:'s', hash:'s', created_at:'s', fails:'n', locked_until:'n' },
  Sessions:   { hash:'s', user_id:'s', expires:'n' },
  Resets:     { hash:'s', user_id:'s', expires:'n' },
  Households: { id:'s', name:'s', currency:'s', max_members:'n', created_by:'s', created_at:'s' },
  Members:    { household_id:'s', user_id:'s', display_name:'s', role:'s', joined_at:'s' },
  Invites:    { id:'s', household_id:'s', code:'s', role:'s', created_by:'s', expires_at:'n', accepted_by:'s', accepted_at:'s' },
  Accounts:   { id:'s', household_id:'s', owner_id:'s', name:'s', kind:'s', opening_balance_minor:'n', archived:'b', created_at:'s' },
  Categories: { id:'s', household_id:'s', kind:'s', name:'s', emoji:'s', sort:'n', archived:'b' },
  Entries:    { id:'s', household_id:'s', account_id:'s', member_id:'s', kind:'s', amount_minor:'n', occurred_on:'s', category_id:'s', note:'s', created_by:'s', created_at:'s', updated_at:'s', deleted_at:'s' },
  Settings:   { household_id:'s', key:'s', value:'s', updated_by:'s', updated_at:'s' }
};
// public table names used by the app  ->  tab
const TABLE = { members:'Members', accounts:'Accounts', categories:'Categories', entries:'Entries', household_settings:'Settings', invites:'Invites', account_balances:null };
const KINDS = ['cash','bank','upi','card','wallet'];
const DEFAULT_EXPENSE = [['Groceries','🛒'],['Food','🍽️'],['Bills','💡'],['Rent','🏠'],['Transport','🚌'],['Health','💊'],['Shopping','🛍️'],['EMI','💸'],['School Fee','📚'],['Other','✨']];
const DEFAULT_INCOME = [['Salary','💼'],['Payment','💰'],['Other','✨']];

/* ---------------- entry points ---------------- */
function setup() { Object.keys(SCHEMA).forEach(function (n) { tab_(n); }); secret_(); try { MailApp.getRemainingDailyQuota(); } catch (e) {} return 'Ready'; }

function doGet() { return out_({ ok: true, app: APP_NAME, note: 'Coupledger API is running. Use the app to talk to it.' }); }

function doPost(e) {
  var b;
  try { b = JSON.parse(e.postData.contents); } catch (x) { return out_({ error: 'Bad request' }); }
  var write = b.a !== 'q' || (b.ops || []).some(function (o) { return o.k !== 'select' && o.k !== 'ver'; });
  var lock = LockService.getScriptLock();
  if (write) lock.waitLock(25000);
  try { return out_(route_(b)); }
  catch (err) { return out_({ error: (err && err.userMessage) || 'Something went wrong on the server.', detail: err && err.userMessage ? undefined : String(err) }); }
  finally { if (write) lock.releaseLock(); }
}

function route_(b) {
  var ctx = { cache: {}, now: Date.now() };
  switch (b.a) {
    case 'signUp':      return signUp_(ctx, b);
    case 'signIn':      return signIn_(ctx, b);
    case 'forgot':      return forgot_(ctx, b);
    case 'recover':     return recover_(ctx, b);
    case 'signOut':     return signOut_(ctx, b);
    case 'setPassword': return setPassword_(ctx, b);
    case 'q':           return query_(ctx, b);
  }
  throw fail_('Unknown request');
}

/* ---------------- tiny helpers ---------------- */
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function fail_(m) { var e = new Error(m); e.userMessage = m; return e; }
function uuid_() { return Utilities.getUuid(); }
function iso_(ms) { return new Date(ms).toISOString(); }
function hex_(bytes) { return bytes.map(function (x) { return ('0' + ((x + 256) % 256).toString(16)).slice(-2); }).join(''); }
function sha_(s) { return hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)); }
function secret_() {
  var p = PropertiesService.getScriptProperties(), s = p.getProperty('SECRET');
  if (!s) { s = uuid_() + uuid_(); p.setProperty('SECRET', s); }
  return s;
}
function hashPw_(pw, salt) {
  var key = secret_(), h = salt + pw;
  for (var i = 0; i < PW_ROUNDS; i++) h = hex_(Utilities.computeHmacSha256Signature(h, key));
  return h;
}
function newToken_() { return uuid_().replace(/-/g, '') + uuid_().replace(/-/g, ''); }
function validEmail_(e) { return typeof e === 'string' && e.length <= 120 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e); }

/* ---------------- sheet storage ---------------- */
function tab_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    var cols = Object.keys(SCHEMA[name]);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]);
    sh.getRange(1, 1, sh.getMaxRows(), cols.length).setNumberFormat('@'); // keep everything as plain text
    sh.setFrozenRows(1);
  }
  return sh;
}
function conv_(type, v) {
  if (Object.prototype.toString.call(v) === '[object Date]') v = v.toISOString().slice(0, 10); // safety: never let Sheets turn text into dates
  if (type === 'n') return v === '' || v === null || v === undefined ? 0 : Number(v);
  if (type === 'b') return String(v).toLowerCase() === 'true';
  return v === null || v === undefined ? '' : String(v);
}
function load_(ctx, name) {
  if (ctx.cache[name]) return ctx.cache[name];
  var sh = tab_(name), cols = Object.keys(SCHEMA[name]), n = sh.getLastRow(), rows = [];
  if (n > 1) {
    var vals = sh.getRange(2, 1, n - 1, cols.length).getValues();
    for (var i = 0; i < vals.length; i++) {
      if (vals[i][0] === '' && vals[i][1] === '') continue;
      var o = { _row: i + 2 };
      for (var j = 0; j < cols.length; j++) o[cols[j]] = conv_(SCHEMA[name][cols[j]], vals[i][j]);
      rows.push(o);
    }
  }
  return (ctx.cache[name] = { sh: sh, cols: cols, rows: rows });
}
function cells_(name, o) {
  var s = SCHEMA[name];
  return Object.keys(s).map(function (c) {
    var v = o[c];
    if (v === undefined || v === null) return '';
    return s[c] === 'b' ? (v ? 'TRUE' : 'FALSE') : String(v);
  });
}
function add_(ctx, name, o) {
  var t = load_(ctx, name), row = cells_(name, o);
  var at = t.sh.getLastRow() + 1;
  t.sh.getRange(at, 1, 1, t.cols.length).setNumberFormat('@').setValues([row]); // plain text so dates stay text
  o._row = at; t.rows.push(o); return o;
}
function save_(ctx, name, o) {
  var t = load_(ctx, name);
  t.sh.getRange(o._row, 1, 1, t.cols.length).setValues([cells_(name, o)]);
}
function del_(ctx, name, o) {
  var t = load_(ctx, name);
  t.sh.deleteRow(o._row);
  t.rows = t.rows.filter(function (r) { return r !== o; });
  t.rows.forEach(function (r) { if (r._row > o._row) r._row--; });
}
function rows_(ctx, name) { return load_(ctx, name).rows; }

/* ---------------- accounts and sessions ---------------- */
function sessionFor_(ctx, user) {
  var token = newToken_();
  add_(ctx, 'Sessions', { hash: sha_(token), user_id: user.id, expires: ctx.now + SESSION_DAYS * 864e5 });
  return { access_token: token, user: { id: user.id, email: user.email, user_metadata: { name: user.name } } };
}
function userByEmail_(ctx, email) {
  email = String(email || '').trim().toLowerCase();
  return rows_(ctx, 'Users').filter(function (u) { return u.email === email; })[0];
}
function auth_(ctx, token) {
  if (!token) throw fail_('unauthorized');
  var h = sha_(String(token)), s = rows_(ctx, 'Sessions').filter(function (r) { return r.hash === h && r.expires > ctx.now; })[0];
  if (!s) throw fail_('unauthorized');
  var u = rows_(ctx, 'Users').filter(function (x) { return x.id === s.user_id; })[0];
  if (!u) throw fail_('unauthorized');
  return u;
}
function signUp_(ctx, b) {
  if (!validEmail_(b.email)) throw fail_('Enter a valid email address.');
  if (typeof b.password !== 'string' || b.password.length < 8 || b.password.length > 200) throw fail_('Use at least 8 characters for the password.');
  if (userByEmail_(ctx, b.email)) throw fail_('User already registered');
  var salt = uuid_(), u = add_(ctx, 'Users', { id: uuid_(), email: String(b.email).trim().toLowerCase(), name: String(b.name || '').trim().slice(0, 40), salt: salt, hash: hashPw_(b.password, salt), created_at: iso_(ctx.now), fails: 0, locked_until: 0 });
  return { session: sessionFor_(ctx, u) };
}
function signIn_(ctx, b) {
  var u = userByEmail_(ctx, b.email), bad = fail_('Invalid login credentials');
  if (!u) throw bad;
  if (u.locked_until > ctx.now) throw fail_('Too many attempts. Try again in a few minutes.');
  if (hashPw_(String(b.password || ''), u.salt) !== u.hash) {
    u.fails = (u.fails || 0) + 1; if (u.fails >= MAX_FAILS) { u.locked_until = ctx.now + LOCK_MIN * 6e4; u.fails = 0; }
    save_(ctx, 'Users', u); throw bad;
  }
  if (u.fails) { u.fails = 0; save_(ctx, 'Users', u); }
  return { session: sessionFor_(ctx, u) };
}
function signOut_(ctx, b) {
  var h = sha_(String(b.token || '')), s = rows_(ctx, 'Sessions').filter(function (r) { return r.hash === h; })[0];
  if (s) del_(ctx, 'Sessions', s);
  return { ok: true };
}
function forgot_(ctx, b) {
  var u = userByEmail_(ctx, b.email);
  if (u) {
    var token = newToken_(), base = String(b.redirectTo || '').match(/^https:\/\//) ? b.redirectTo : APP_URL;
    add_(ctx, 'Resets', { hash: sha_(token), user_id: u.id, expires: ctx.now + 36e5 });
    var link = base + (base.indexOf('?') < 0 ? '?' : '&') + 'reset=' + token;
    try {
      MailApp.sendEmail({ to: u.email, name: APP_NAME, subject: APP_NAME + ': reset your password',
        body: 'Hi' + (u.name ? ' ' + u.name : '') + ',\n\nUse this link to choose a new password (valid for 1 hour):\n' + link + '\n\nIf you did not ask for this, you can ignore this email.' });
    } catch (e) { /* mail quota reached: the user can try again later */ }
  }
  return { ok: true }; // same answer whether or not the email exists
}
function recover_(ctx, b) {
  var h = sha_(String(b.token || '')), r = rows_(ctx, 'Resets').filter(function (x) { return x.hash === h && x.expires > ctx.now; })[0];
  if (!r) throw fail_('This reset link is invalid or has expired.');
  var u = rows_(ctx, 'Users').filter(function (x) { return x.id === r.user_id; })[0];
  if (!u) throw fail_('This reset link is invalid or has expired.');
  del_(ctx, 'Resets', r);
  return { session: sessionFor_(ctx, u) };
}
function setPassword_(ctx, b) {
  var u = auth_(ctx, b.token);
  if (typeof b.password !== 'string' || b.password.length < 8 || b.password.length > 200) throw fail_('Use at least 8 characters for the password.');
  u.salt = uuid_(); u.hash = hashPw_(b.password, u.salt); u.fails = 0; u.locked_until = 0; save_(ctx, 'Users', u);
  return { ok: true };
}

/* ---------------- data queries (same shape the app already uses) ---------------- */
function myHouseholds_(ctx, uid) {
  return rows_(ctx, 'Members').filter(function (m) { return m.user_id === uid; });
}
function isMember_(ctx, uid, hid) { return myHouseholds_(ctx, uid).some(function (m) { return m.household_id === hid; }); }
function bump_(hid) {
  var c = CacheService.getScriptCache(), k = 'v_' + hid;
  c.put(k, String(Number(c.get(k) || 0) + 1), 21600);
}
function query_(ctx, b) {
  var user = auth_(ctx, b.token), results = [];
  var ops = b.ops || [];
  if (ops.length > 25) throw fail_('Too many operations in one request.');
  for (var i = 0; i < ops.length; i++) {
    try { results.push({ data: runOp_(ctx, user, ops[i]) }); }
    catch (e) { results.push({ error: { message: (e && e.userMessage) || 'Something went wrong on the server.' } }); }
  }
  return { results: results };
}
function runOp_(ctx, user, o) {
  switch (o.k) {
    case 'ver':    return myHouseholds_(ctx, user.id).map(function (m) { return CacheService.getScriptCache().get('v_' + m.household_id) || '0'; }).join('.');
    case 'rpc':    return rpc_(ctx, user, o);
    case 'select': return select_(ctx, user, o);
    case 'insert': return insert_(ctx, user, o);
    case 'update': return update_(ctx, user, o);
    case 'upsert': return upsert_(ctx, user, o);
  }
  throw fail_('Unknown operation');
}
function pick_(row, cols) {
  if (!cols || cols === '*') { var c = {}; Object.keys(row).forEach(function (k) { if (k !== '_row') c[k] = row[k]; }); return c; }
  var out = {};
  String(cols).split(',').forEach(function (k) {
    k = k.trim(); if (!k || k.indexOf('(') >= 0) return;
    out[k] = (row[k] === '' && (k === 'deleted_at' || k === 'category_id')) ? null : row[k];
  });
  return out;
}
function filterOk_(row, filters) {
  return (filters || []).every(function (f) {
    var c = f[0], op = f[1], v = f[2], x = row[c];
    if (op === 'is') return v === null ? (x === '' || x === null || x === undefined) : x === v;
    if (op === 'eq') return String(x) === String(v);
    return false;
  });
}
function sortRows_(rows, order) {
  if (!order || !order.length) return rows;
  return rows.slice().sort(function (a, b) {
    for (var i = 0; i < order.length; i++) {
      var c = order[i][0], asc = order[i][1] !== false, x = a[c], y = b[c];
      if (x === y) continue;
      var r = x < y ? -1 : 1; return asc ? r : -r;
    }
    return 0;
  });
}
function householdFilter_(filters) {
  var f = (filters || []).filter(function (x) { return x[0] === 'household_id' && x[1] === 'eq'; })[0];
  return f ? String(f[2]) : null;
}
function visible_(ctx, user, table, filters) {
  var mine = myHouseholds_(ctx, user.id).map(function (m) { return m.household_id; });
  var want = householdFilter_(filters);
  if (want && mine.indexOf(want) < 0) return [];
  var inMine = function (r) { return mine.indexOf(r.household_id) >= 0; };
  var rows;
  if (table === 'account_balances') return balances_(ctx, mine, want);
  rows = rows_(ctx, TABLE[table]).filter(inMine);
  if (table === 'invites') rows = rows.filter(function (r) { return isOwner_(ctx, user.id, r.household_id); });
  return rows;
}
function select_(ctx, user, o) {
  if (!(o.t in TABLE)) throw fail_('Unknown table');
  var rows = visible_(ctx, user, o.t, o.f).filter(function (r) { return filterOk_(r, o.f); });
  rows = sortRows_(rows, o.o);
  if (o.l) rows = rows.slice(0, Math.min(Number(o.l) || 1000, 5000));
  var hh = null;
  if (o.t === 'members') hh = rows_(ctx, 'Households');
  return rows.map(function (r) {
    var p = pick_(r, o.cols);
    if (hh && String(o.cols).indexOf('households(') >= 0) { var h = hh.filter(function (x) { return x.id === r.household_id; })[0]; p.households = { name: h ? h.name : '' }; }
    return p;
  });
}
function balances_(ctx, mine, want) {
  var accts = rows_(ctx, 'Accounts').filter(function (a) { return mine.indexOf(a.household_id) >= 0 && (!want || a.household_id === want) && !a.archived; });
  var sums = {};
  rows_(ctx, 'Entries').forEach(function (e) { if (e.deleted_at === '' && mine.indexOf(e.household_id) >= 0) sums[e.account_id] = (sums[e.account_id] || 0) + (e.kind === 'income' ? e.amount_minor : -e.amount_minor); });
  return accts.map(function (a) { return { account_id: a.id, household_id: a.household_id, owner_id: a.owner_id, kind: a.kind, name: a.name, balance_minor: a.opening_balance_minor + (sums[a.id] || 0) }; });
}
function isOwner_(ctx, uid, hid) { return myHouseholds_(ctx, uid).some(function (m) { return m.household_id === hid && m.role === 'owner'; }); }
function need_(cond, msg) { if (!cond) throw fail_(msg); }
function validId_(id) { return typeof id === 'string' && /^[A-Za-z0-9-]{8,64}$/.test(id); }

function insert_(ctx, user, o) {
  need_(o.t in TABLE && TABLE[o.t], 'Unknown table');
  var r = o.row || {}, hid = String(r.household_id || '');
  need_(isMember_(ctx, user.id, hid), 'new row violates row-level security policy');
  var row;
  if (o.t === 'entries') {
    need_(r.kind === 'income' || r.kind === 'expense', 'Invalid entry type.');
    var amt = Number(r.amount_minor); need_(isFinite(amt) && amt > 0 && amt <= 1e11 && Math.floor(amt) === amt, 'Enter an amount above zero.');
    need_(/^\d{4}-\d{2}-\d{2}$/.test(String(r.occurred_on)), 'Invalid date.');
    var acct = rows_(ctx, 'Accounts').filter(function (a) { return a.id === r.account_id && a.household_id === hid; })[0]; need_(acct, 'Unknown account.');
    if (r.category_id) need_(rows_(ctx, 'Categories').some(function (c) { return c.id === r.category_id && c.household_id === hid; }), 'Unknown category.');
    need_(!r.member_id || isMember_(ctx, r.member_id, hid), 'Unknown member.');
    var id = validId_(r.id) ? r.id : uuid_();
    need_(!rows_(ctx, 'Entries').some(function (e) { return e.id === id; }), 'duplicate key value violates unique constraint');
    row = add_(ctx, 'Entries', { id: id, household_id: hid, account_id: r.account_id, member_id: r.member_id || user.id, kind: r.kind, amount_minor: amt, occurred_on: r.occurred_on, category_id: r.category_id || '', note: String(r.note || '').slice(0, 200), created_by: user.id, created_at: iso_(ctx.now), updated_at: iso_(ctx.now), deleted_at: '' });
  } else if (o.t === 'accounts') {
    need_(KINDS.indexOf(r.kind) >= 0, 'invalid input value for enum account kind');
    var nm = String(r.name || '').trim(); need_(nm && nm.length <= 40, 'Give the account a name.');
    row = add_(ctx, 'Accounts', { id: uuid_(), household_id: hid, owner_id: user.id, name: nm, kind: r.kind, opening_balance_minor: 0, archived: false, created_at: iso_(ctx.now) });
  } else if (o.t === 'categories') {
    var cn = String(r.name || '').trim(); need_(cn && cn.length <= 24, 'Give the category a name.');
    need_(!rows_(ctx, 'Categories').some(function (c) { return c.household_id === hid && c.kind === (r.kind || 'expense') && c.name.toLowerCase() === cn.toLowerCase() && !c.archived; }), 'duplicate key value violates unique constraint');
    row = add_(ctx, 'Categories', { id: uuid_(), household_id: hid, kind: r.kind === 'income' ? 'income' : 'expense', name: cn, emoji: String(r.emoji || '🏷️').slice(0, 8), sort: Number(r.sort) || 0, archived: false });
  } else if (o.t === 'invites') {
    need_(isOwner_(ctx, user.id, hid), 'new row violates row-level security policy');
    row = add_(ctx, 'Invites', { id: uuid_(), household_id: hid, code: newToken_().slice(0, 18), role: 'adult', created_by: user.id, expires_at: ctx.now + 7 * 864e5, accepted_by: '', accepted_at: '' });
  } else throw fail_('You cannot add rows to that table.');
  bump_(hid);
  return [pick_(row, o.cols)];
}
function update_(ctx, user, o) {
  need_(o.t in TABLE && TABLE[o.t], 'Unknown table');
  var allowed = { entries: ['account_id','kind','amount_minor','occurred_on','note','category_id','deleted_at'], accounts: ['name','archived'], categories: ['name','emoji','archived','sort'] }[o.t];
  need_(allowed, 'You cannot change rows in that table.');
  var p = o.patch || {}, upd = [];
  Object.keys(p).forEach(function (k) { need_(allowed.indexOf(k) >= 0, 'You cannot change that field.'); });
  var rows = visible_(ctx, user, o.t, o.f).filter(function (r) { return filterOk_(r, o.f); });
  rows.forEach(function (r) {
    if (o.t === 'entries' && r.created_by !== user.id) return; // only the person who added an entry can change it
    if (p.kind !== undefined) need_(p.kind === 'income' || p.kind === 'expense', 'Invalid entry type.');
    if (p.amount_minor !== undefined) { var a = Number(p.amount_minor); need_(isFinite(a) && a > 0 && a <= 1e11 && Math.floor(a) === a, 'Enter an amount above zero.'); }
    if (p.occurred_on !== undefined) need_(/^\d{4}-\d{2}-\d{2}$/.test(String(p.occurred_on)), 'Invalid date.');
    if (p.account_id) need_(rows_(ctx, 'Accounts').some(function (x) { return x.id === p.account_id && x.household_id === r.household_id; }), 'Unknown account.');
    if (p.category_id) need_(rows_(ctx, 'Categories').some(function (x) { return x.id === p.category_id && x.household_id === r.household_id; }), 'Unknown category.');
    Object.keys(p).forEach(function (k) {
      var v = p[k]; if (v === null) v = (SCHEMA[TABLE[o.t]][k] === 'b') ? false : '';
      if (k === 'note') v = String(v).slice(0, 200); if (k === 'name') v = String(v).slice(0, 40); if (k === 'emoji') v = String(v).slice(0, 8);
      if (SCHEMA[TABLE[o.t]][k] === 'n') v = Number(v);
      r[k] = v;
    });
    if (o.t === 'entries') r.updated_at = iso_(ctx.now);
    save_(ctx, TABLE[o.t], r); bump_(r.household_id); upd.push(r);
  });
  return upd.map(function (r) { return pick_(r, o.cols || 'id'); });
}
function upsert_(ctx, user, o) {
  need_(o.t === 'household_settings', 'You cannot change that table.');
  var r = o.row || {}, hid = String(r.household_id || '');
  need_(isMember_(ctx, user.id, hid), 'new row violates row-level security policy');
  var key = String(r.key || ''); need_(/^[a-z0-9_]{1,40}$/.test(key), 'Invalid setting name.');
  var val = typeof r.value === 'string' ? r.value : JSON.stringify(r.value === undefined ? '' : r.value);
  need_(val.length <= 40000, 'That setting is too large.');
  var ex = rows_(ctx, 'Settings').filter(function (s) { return s.household_id === hid && s.key === key; })[0], row;
  if (ex) { ex.value = val; ex.updated_by = user.id; ex.updated_at = iso_(ctx.now); save_(ctx, 'Settings', ex); row = ex; }
  else row = add_(ctx, 'Settings', { household_id: hid, key: key, value: val, updated_by: user.id, updated_at: iso_(ctx.now) });
  bump_(hid);
  return [pick_(row, o.cols || 'key')];
}

/* ---------------- household actions ---------------- */
function rpc_(ctx, user, o) {
  var a = o.args || {};
  if (o.fn === 'create_household') {
    var name = String(a.p_name || '').trim(), dn = String(a.p_display_name || '').trim();
    need_(name && name.length <= 60, 'Enter a household name.'); need_(dn && dn.length <= 40, 'Enter your name.');
    need_(myHouseholds_(ctx, user.id).length < 5, 'You are already in the maximum number of households.');
    var hid = uuid_();
    add_(ctx, 'Households', { id: hid, name: name, currency: 'INR', max_members: 2, created_by: user.id, created_at: iso_(ctx.now) });
    add_(ctx, 'Members', { household_id: hid, user_id: user.id, display_name: dn, role: 'owner', joined_at: iso_(ctx.now) });
    starterAccounts_(ctx, hid, user.id);
    DEFAULT_EXPENSE.forEach(function (c, i) { add_(ctx, 'Categories', { id: uuid_(), household_id: hid, kind: 'expense', name: c[0], emoji: c[1], sort: i + 1, archived: false }); });
    DEFAULT_INCOME.forEach(function (c, i) { add_(ctx, 'Categories', { id: uuid_(), household_id: hid, kind: 'income', name: c[0], emoji: c[1], sort: i + 1, archived: false }); });
    bump_(hid); return hid;
  }
  if (o.fn === 'accept_invite') {
    var code = String(a.p_code || '').trim(), dn2 = String(a.p_display_name || '').trim();
    need_(code && dn2 && dn2.length <= 40, 'Enter the invite code and your name.');
    var inv = rows_(ctx, 'Invites').filter(function (i) { return i.code === code && !i.accepted_at && i.expires_at > ctx.now; })[0];
    need_(inv, 'This invite is invalid or has expired');
    need_(!isMember_(ctx, user.id, inv.household_id), 'You are already in this household');
    var h = rows_(ctx, 'Households').filter(function (x) { return x.id === inv.household_id; })[0];
    need_(h && rows_(ctx, 'Members').filter(function (m) { return m.household_id === h.id; }).length < h.max_members, 'This household is full');
    add_(ctx, 'Members', { household_id: h.id, user_id: user.id, display_name: dn2, role: inv.role, joined_at: iso_(ctx.now) });
    starterAccounts_(ctx, h.id, user.id);
    inv.accepted_by = user.id; inv.accepted_at = iso_(ctx.now); save_(ctx, 'Invites', inv);
    bump_(h.id); return h.id;
  }
  throw fail_('Unknown action');
}
function starterAccounts_(ctx, hid, uid) {
  add_(ctx, 'Accounts', { id: uuid_(), household_id: hid, owner_id: uid, name: 'Cash', kind: 'cash', opening_balance_minor: 0, archived: false, created_at: iso_(ctx.now) });
  add_(ctx, 'Accounts', { id: uuid_(), household_id: hid, owner_id: uid, name: 'Bank / UPI', kind: 'bank', opening_balance_minor: 0, archived: false, created_at: iso_(ctx.now) });
}

/* ---------------- housekeeping (optional: add a daily trigger for this function) ---------------- */
function cleanup() {
  var ctx = { cache: {}, now: Date.now() };
  ['Sessions', 'Resets'].forEach(function (n) { rows_(ctx, n).slice().forEach(function (r) { if (r.expires < ctx.now) del_(ctx, n, r); }); });
}
