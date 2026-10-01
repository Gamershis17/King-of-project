(function () {
  var loginPane = document.getElementById('login-pane');
  var opsPane = document.getElementById('ops-pane');
  var loginErr = document.getElementById('login-err');
  var opsErr = document.getElementById('ops-err');

  var REPORT_STATUSES = ['new', 'reviewing', 'fixed', 'closed'];
  var IDEA_STATUSES = ['open', 'planned', 'done', 'dropped'];

  function api(path, opts) {
    return fetch(path, Object.assign({ credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' } }, opts || {}));
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmtTs(ts) {
    try {
      return new Date(Number(ts)).toLocaleString(undefined, {
        year: 'numeric', month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit', second: '2-digit'
      });
    } catch (e) { return ''; }
  }
  function fail(msg) { opsErr.textContent = msg; }

  // ---------- tabs ----------
  var tabBtns = Array.prototype.slice.call(document.querySelectorAll('.tabs button'));
  tabBtns.forEach(function (b) {
    b.addEventListener('click', function () {
      tabBtns.forEach(function (x) { x.classList.remove('active'); });
      b.classList.add('active');
      ['audit', 'bugs', 'feedback', 'ideas'].forEach(function (t) {
        document.getElementById('tab-' + t).classList.toggle('hidden', t !== b.dataset.tab);
      });
      if (b.dataset.tab === 'audit') loadAudit();
      if (b.dataset.tab === 'bugs') loadReports('bug');
      if (b.dataset.tab === 'feedback') loadReports('feedback');
      if (b.dataset.tab === 'ideas') loadIdeas();
    });
  });

  // ---------- audit log ----------
  function loadAudit() {
    api('/api/gm/audit').then(function (r) { return r.json(); }).then(function (j) {
      var entries = (j && j.ok && j.entries) || [];
      document.getElementById('audit-count').textContent = entries.length + ' entries (newest first)';
      var list = document.getElementById('audit-list');
      if (!entries.length) { list.innerHTML = '<div class="empty">No audit entries yet.</div>'; return; }
      list.innerHTML = entries.map(function (e) {
        return '<div class="entry">' +
          '<div class="entry-head"><span class="entry-title">' + esc(e.action) + '</span></div>' +
          (e.detail ? '<div class="entry-body">' + esc(e.detail) + '</div>' : '') +
          '<div class="entry-meta"><b>' + esc(e.actor) + '</b> <span style="color:#7a7094">(' + esc(e.actorRole) + ')</span>' +
          ' → ' + esc(e.target) + ' · ' + esc(fmtTs(e.ts)) + '</div>' +
          '</div>';
      }).join('');
    }).catch(function () { fail('Could not load audit log.'); });
  }

  // ---------- reports inbox ----------
  function statusOptions(statuses, cur) {
    return statuses.map(function (s) {
      return '<option value="' + s + '"' + (s === cur ? ' selected' : '') + '>' + s + '</option>';
    }).join('');
  }
  function reportCard(r) {
    var updated = (r.updated_at && r.updated_at !== r.created_at)
      ? ' · status changed ' + fmtTs(r.updated_at) : '';
    return '<div class="entry" data-id="' + r.id + '">' +
      '<div class="entry-head"><span class="entry-title">' + esc(r.title) + '</span>' +
      '<span class="badge st-' + esc(r.status) + '">' + esc(r.status) + '</span></div>' +
      '<div class="entry-body">' + esc(r.body) + '</div>' +
      '<div class="entry-meta">from <b>' + esc(r.username) + '</b> · sent ' + fmtTs(r.created_at) + updated + '</div>' +
      '<div class="entry-actions"><label style="margin:0">Status:</label>' +
      '<select class="rep-status">' + statusOptions(REPORT_STATUSES, r.status) + '</select></div>' +
      '</div>';
  }
  function loadReports(kind) {
    var listId = kind === 'bug' ? 'bugs-list' : 'feedback-list';
    api('/api/gm/reports?kind=' + kind).then(function (r) { return r.json(); }).then(function (j) {
      var reports = (j && j.ok && j.reports) || [];
      var open = reports.filter(function (r) { return r.status === 'new' || r.status === 'reviewing'; }).length;
      document.getElementById(kind === 'bug' ? 'cnt-bugs' : 'cnt-feedback').textContent = open ? '(' + open + ')' : '';
      var list = document.getElementById(listId);
      if (!reports.length) { list.innerHTML = '<div class="empty">Nothing here yet.</div>'; return; }
      list.innerHTML = reports.map(reportCard).join('');
      Array.prototype.forEach.call(list.querySelectorAll('.entry'), function (card) {
        var sel = card.querySelector('.rep-status');
        sel.addEventListener('change', function () {
          opsErr.textContent = '';
          api('/api/gm/reports/' + card.dataset.id, {
            method: 'PATCH', body: JSON.stringify({ status: sel.value })
          }).then(function (r) { return r.json().then(function (jj) { return { ok: r.ok, j: jj }; }); })
            .then(function (res) {
              if (!res.ok) { fail((res.j && res.j.error) || 'Update failed.'); loadReports(kind); return; }
              card.querySelector('.badge').className = 'badge st-' + res.j.report.status;
              card.querySelector('.badge').textContent = res.j.report.status;
              loadReports(kind);
            })
            .catch(function () { fail('Could not reach server.'); });
        });
      });
    }).catch(function () { fail('Could not load reports.'); });
  }

  // ---------- ideas ----------
  function loadIdeas() {
    api('/api/gm/ideas').then(function (r) { return r.json(); }).then(function (j) {
      var ideas = (j && j.ok && j.ideas) || [];
      var list = document.getElementById('ideas-list');
      if (!ideas.length) { list.innerHTML = '<div class="empty">No ideas yet — add the first one above.</div>'; return; }
      list.innerHTML = ideas.map(function (it) {
        var updated = (it.updated_at && it.updated_at !== it.created_at)
          ? ' · updated ' + fmtTs(it.updated_at) : '';
        return '<div class="entry" data-id="' + it.id + '">' +
          '<div class="entry-head"><span class="entry-title">' + esc(it.title) + '</span>' +
          '<span class="badge st-' + esc(it.status) + '">' + esc(it.status) + '</span></div>' +
          (it.body ? '<div class="entry-body">' + esc(it.body) + '</div>' : '') +
          '<div class="entry-meta">by <b>' + esc(it.username) + '</b> · added ' + fmtTs(it.created_at) + updated + '</div>' +
          '<div class="entry-actions"><label style="margin:0">Status:</label>' +
          '<select class="idea-status">' + statusOptions(IDEA_STATUSES, it.status) + '</select>' +
          '<button class="ghost small idea-del">Delete</button></div>' +
          '</div>';
      }).join('');
      Array.prototype.forEach.call(list.querySelectorAll('.entry'), function (card) {
        var id = card.dataset.id;
        card.querySelector('.idea-status').addEventListener('change', function () {
          opsErr.textContent = '';
          api('/api/gm/ideas/' + id, { method: 'PATCH', body: JSON.stringify({ status: this.value }) })
            .then(function (r) { return r.json().then(function (jj) { return { ok: r.ok }; }); })
            .then(function (res) { if (!res.ok) fail('Update failed.'); loadIdeas(); })
            .catch(function () { fail('Could not reach server.'); });
        });
        card.querySelector('.idea-del').addEventListener('click', function () {
          if (!confirm('Delete this idea?')) return;
          opsErr.textContent = '';
          api('/api/gm/ideas/' + id, { method: 'DELETE' })
            .then(function (r) { return r.json().then(function (jj) { return { ok: r.ok }; }); })
            .then(function (res) { if (!res.ok) fail('Delete failed.'); loadIdeas(); })
            .catch(function () { fail('Could not reach server.'); });
        });
      });
    }).catch(function () { fail('Could not load ideas.'); });
  }

  document.getElementById('idea-add').addEventListener('click', function () {
    var titleEl = document.getElementById('idea-title');
    var bodyEl = document.getElementById('idea-body');
    opsErr.textContent = '';
    var title = titleEl.value.trim();
    if (!title) { fail('Give the idea a title.'); return; }
    var btn = this; btn.disabled = true;
    api('/api/gm/ideas', { method: 'POST', body: JSON.stringify({ title: title, body: bodyEl.value.trim() }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) { fail((res.j && res.j.error) || 'Could not add idea.'); return; }
        titleEl.value = ''; bodyEl.value = '';
        loadIdeas();
      })
      .catch(function () { btn.disabled = false; fail('Could not reach server.'); });
  });

  // ---------- login (owner/admin only) ----------
  function enterOps(username, role) {
    document.getElementById('who').textContent = 'Signed in as ' + username + ' (' + role + ')';
    loginPane.classList.add('hidden');
    opsPane.classList.remove('hidden');
    loadAudit();
    loadReports('bug');
    loadReports('feedback');
    loadNotice();
    wireNotice();
  }

  // ---------- pre-update warning ----------
  function loadNotice() {
    api('/api/status').then(function (r) { return r.json(); }).then(function (st) {
      var el = document.getElementById('notice-current');
      if (st && st.updateNotice && st.updateNotice.message) {
        el.textContent = 'Currently warning: "' + st.updateNotice.message + '"';
      } else {
        el.textContent = 'No warning active.';
      }
    }).catch(function () { /* leave the previous text */ });
  }
  function wireNotice() {
    var warn = document.getElementById('notice-warn');
    var clear = document.getElementById('notice-clear');
    if (warn.dataset.wired) return;
    warn.dataset.wired = '1';
    warn.addEventListener('click', function () {
      var msg = document.getElementById('notice-msg').value.trim();
      if (!msg) { fail('Type the warning message first.'); return; }
      warn.disabled = true;
      api('/api/gm/update-notice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg })
      }).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (x) {
          warn.disabled = false;
          if (!x.ok) { fail(x.j.error || 'Could not set warning.'); return; }
          document.getElementById('notice-msg').value = '';
          loadNotice();
        }).catch(function () { warn.disabled = false; fail('Could not set warning.'); });
    });
    clear.addEventListener('click', function () {
      clear.disabled = true;
      api('/api/gm/update-notice', { method: 'DELETE' })
        .then(function () { clear.disabled = false; loadNotice(); })
        .catch(function () { clear.disabled = false; fail('Could not clear warning.'); });
    });
  }
  document.getElementById('login-btn').addEventListener('click', function () {
    loginErr.textContent = '';
    var u = document.getElementById('su').value.trim();
    var p = document.getElementById('sp').value;
    if (!u || !p) { loginErr.textContent = 'Enter username and password.'; return; }
    var btn = this; btn.disabled = true;
    api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) { loginErr.textContent = (res.j && res.j.error) || 'Login failed.'; return; }
        return api('/api/auth/me').then(function (r) { return r.json(); }).then(function (me) {
          var role = me && me.user && me.user.role;
          if (role !== 'owner' && role !== 'admin') {
            loginErr.textContent = 'This page is for owners and admins only.';
            api('/api/auth/logout', { method: 'POST' });
            return;
          }
          enterOps(me.user.username || u, role);
        });
      })
      .catch(function () { btn.disabled = false; loginErr.textContent = 'Could not reach server.'; });
  });
  document.getElementById('sp').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') document.getElementById('login-btn').click();
  });

  // If already signed in as staff, skip the login form.
  api('/api/auth/me').then(function (r) { return r.ok ? r.json() : null; }).then(function (me) {
    var role = me && me.user && me.user.role;
    if (role === 'owner' || role === 'admin') enterOps(me.user.username || '', role);
  }).catch(function () {});
})();
