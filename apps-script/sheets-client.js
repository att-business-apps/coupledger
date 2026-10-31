/* ===== Google Sheets backend client: the app data and sign-in client ===== */
const SHEETS_API_URL = 'https://script.google.com/macros/s/AKfycbx7TW8KMS1N_dYZJ86OfZJTcIPINNQf5TcGHbFX1L-zo3w1Cx4L0FPvKWAOTPrDV2394w/exec';
const sb = (function () {
  var SKEY = 'cl-session', subs = [], channels = [], queue = [], timer = 0, pendingRecovery = null;
  function loadSess() { try { var s = JSON.parse(localStorage.getItem(SKEY) || 'null'); return s && s.access_token && s.user ? s : null; } catch (e) { return null; } }
  var sess = loadSess();
  function saveSess(s) { sess = s; try { if (s) localStorage.setItem(SKEY, JSON.stringify(s)); else localStorage.removeItem(SKEY); } catch (e) { } }
  function emit(ev, s) { subs.slice().forEach(function (cb) { try { cb(ev, s); } catch (e) { console.error(e); } }); }
  var NOT_SET = { message: 'The Google Sheets backend is not set up yet. Add your Apps Script web app URL (SHEETS_API_URL).' };

  function post(payload) {
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(SHEETS_API_URL)) return Promise.resolve({ error: NOT_SET.message });
    var ctl = typeof AbortController === 'function' ? new AbortController() : null, t = ctl && setTimeout(function () { ctl.abort(); }, 40000);
    return fetch(SHEETS_API_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload), redirect: 'follow', signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.text(); })
      .then(function (txt) { try { return JSON.parse(txt); } catch (e) { return { error: 'The server sent an unexpected reply. Check the Apps Script deployment.' }; } })
      .catch(function (e) { return { error: e && e.name === 'AbortError' ? 'Network request timed out. Try again.' : 'Failed to fetch' }; })
      .then(function (r) { if (t) clearTimeout(t); return r; });
  }
  function lostSession() { if (sess) { saveSess(null); emit('SIGNED_OUT', null); } }

  /* all queries made in the same moment travel together in one request */
  function flush() {
    timer = 0; var batch = queue; queue = [];
    if (!sess) { batch.forEach(function (b) { b.res({ data: null, error: { message: 'Not signed in' } }); }); return; }
    post({ a: 'q', token: sess.access_token, ops: batch.map(function (b) { return b.op; }) }).then(function (r) {
      if (r.error === 'unauthorized') { lostSession(); batch.forEach(function (b) { b.res({ data: null, error: { message: 'Your session has ended. Please sign in again.' } }); }); return; }
      if (r.error || !r.results) { batch.forEach(function (b) { b.res({ data: null, error: { message: r.error || 'Something went wrong.' } }); }); return; }
      batch.forEach(function (b, i) {
        var x = r.results[i] || { error: { message: 'No answer from the server.' } };
        if (x.error) return b.res({ data: null, error: x.error });
        var d = x.data;
        if (b.single) { if (!d || !d.length) return b.res({ data: null, error: { message: 'No rows returned.' } }); d = d[0]; }
        b.res({ data: d, error: null });
      });
    });
  }
  function send(op, single) { return new Promise(function (res) { queue.push({ op: op, single: single, res: res }); if (!timer) timer = setTimeout(flush, 0); }); }

  function Q(table) { this.t = table; this.k = 'select'; this.f = []; this.o = []; this.cols = '*'; this.l = 0; this._single = false; }
  Q.prototype.select = function (c) { this.cols = c || '*'; return this; };
  Q.prototype.insert = function (row) { this.k = 'insert'; this.row = row; return this; };
  Q.prototype.update = function (patch) { this.k = 'update'; this.patch = patch; return this; };
  Q.prototype.upsert = function (row, opts) { this.k = 'upsert'; this.row = row; this.on = opts && opts.onConflict; return this; };
  Q.prototype.eq = function (c, v) { this.f.push([c, 'eq', v]); return this; };
  Q.prototype.is = function (c, v) { this.f.push([c, 'is', v]); return this; };
  Q.prototype.order = function (c, o) { this.o.push([c, !(o && o.ascending === false)]); return this; };
  Q.prototype.limit = function (n) { this.l = n; return this; };
  Q.prototype.single = function () { this._single = true; return this; };
  Q.prototype.then = function (ok, bad) {
    var op = { k: this.k, t: this.t, cols: this.cols, f: this.f, o: this.o, l: this.l, row: this.row, patch: this.patch, on: this.on };
    return send(op, this._single).then(ok, bad);
  };

  function sessionResult(r) {
    if (r.error) return { data: { session: null, user: null }, error: { message: r.error } };
    saveSess(r.session); return { data: { session: r.session, user: r.session.user }, error: null };
  }
  var auth = {
    signUp: function (a) { return post({ a: 'signUp', email: a.email, password: a.password, name: a.options && a.options.data && a.options.data.name }).then(function (r) { var x = sessionResult(r); if (!x.error) emit('SIGNED_IN', r.session); return x; }); },
    signInWithPassword: function (a) { return post({ a: 'signIn', email: a.email, password: a.password }).then(function (r) { var x = sessionResult(r); if (!x.error) emit('SIGNED_IN', r.session); return x; }); },
    signOut: function () { var tk = sess && sess.access_token; saveSess(null); emit('SIGNED_OUT', null); return (tk ? post({ a: 'signOut', token: tk }) : Promise.resolve()).then(function () { return { error: null }; }); },
    resetPasswordForEmail: function (email, o) { return post({ a: 'forgot', email: email, redirectTo: o && o.redirectTo }).then(function (r) { return { data: {}, error: r.error ? { message: r.error } : null }; }); },
    updateUser: function (a) {
      if (!sess) return Promise.resolve({ data: null, error: { message: 'Not signed in' } });
      return post({ a: 'setPassword', token: sess.access_token, password: a.password }).then(function (r) { if (r.error === 'unauthorized') { lostSession(); return { data: null, error: { message: 'Your session has ended. Please sign in again.' } }; } return { data: r.error ? null : { user: sess.user }, error: r.error ? { message: r.error } : null }; });
    },
    onAuthStateChange: function (cb) {
      subs.push(cb);
      setTimeout(function () { if (pendingRecovery) { var s = pendingRecovery; pendingRecovery = null; cb('PASSWORD_RECOVERY', s); } else cb(sess ? 'SIGNED_IN' : 'INITIAL_SESSION', sess); }, 0);
      return { data: { subscription: { unsubscribe: function () { subs = subs.filter(function (x) { return x !== cb; }); } } } };
    }
  };

  /* live updates are a light check for changes every 8 seconds */
  function Channel() { this.cbs = []; this.last = null; this.timer = 0; }
  Channel.prototype.on = function (a, b, cb) { this.cbs.push(cb); return this; };
  Channel.prototype.subscribe = function () {
    var me = this; channels.push(me);
    me.timer = setInterval(function () {
      if (document.hidden || !sess) return;
      send({ k: 'ver' }, false).then(function (r) { if (r.error || r.data == null) return; if (me.last !== null && r.data !== me.last) me.cbs.forEach(function (cb) { try { cb(); } catch (e) { } }); me.last = r.data; });
    }, (typeof CL_POLL_MS === 'number' ? CL_POLL_MS : 8000));
    return me;
  };

  /* password-reset link: ?reset=TOKEN */
  try {
    var u = new URL(location.href), rt = u.searchParams.get('reset');
    if (rt) { u.searchParams.delete('reset'); history.replaceState(null, '', u.pathname + (u.search || '') + u.hash);
      pendingRecovery = false; var wait = post({ a: 'recover', token: rt }).then(function (r) { if (r.error) { pendingRecovery = null; try { sessionStorage.setItem('cl-reset-error', r.error); } catch (e) { } return; } saveSess(r.session); pendingRecovery = r.session; });
      var origOn = auth.onAuthStateChange; auth.onAuthStateChange = function (cb) { subs.push(cb); wait.then(function () { setTimeout(function () { if (pendingRecovery) { var s = pendingRecovery; pendingRecovery = null; cb('PASSWORD_RECOVERY', s); } else cb(sess ? 'SIGNED_IN' : 'INITIAL_SESSION', sess); }, 0); }); return { data: { subscription: { unsubscribe: function () { subs = subs.filter(function (x) { return x !== cb; }); } } } }; };
    }
  } catch (e) { }

  return {
    from: function (t) { return new Q(t); },
    rpc: function (fn, args) { return send({ k: 'rpc', fn: fn, args: args || {} }, false); },
    auth: auth,
    channel: function () { return new Channel(); },
    removeChannel: function (ch) { if (ch && ch.timer) clearInterval(ch.timer); channels = channels.filter(function (c) { return c !== ch; }); }
  };
})();
