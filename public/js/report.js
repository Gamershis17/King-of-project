// /report.html — staff-only feedback inbox + Discord link for players.
(function () {
  var signinPane = document.getElementById('signin-pane');
  var deniedPane = document.getElementById('denied-pane');
  var inboxPane = document.getElementById('inbox-pane');
  var signinErr = document.getElementById('signin-err');
  var inboxErr = document.getElementById('inbox-err');

  var REPORT_STATUSES = ['new', 'reviewing', 'fixed', 'closed'];

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
        hour: 'numeric', minute: '2-digit'
      });
    } catch (e) { return ''; }
  }

  function showOnly(el) {
    [signinPane, deniedPane, inboxPane].forEach(function (p) {
      p.classList.toggle('hidden', p !== el);
    });
  }

  function statusOptions(cur) {
    return REPORT_STATUSES.map(function (s) {
      return '<option value="' + s + '"' + (s === cur ? ' selected' : '') + '>' + s + '</option>';
    }).join('');
  }

  function loadFeedback() {
    api('/api/gm/reports?kind=feedback').then(function (r) { return r.json(); }).then(function (j) {
      var reports = (j && j.ok && j.reports) || [];
      var open = reports.filter(function (r) { return r.status === 'new' || r.status === 'reviewing'; }).length;
      document.getElementById('fb-count').textContent = open ? '(' + open + ' open)' : '';
      var list = document.getElementById('feedback-list');
      if (!reports.length) { list.innerHTML = '<div class="empty">No feedback yet.</div>'; return; }
      list.innerHTML = reports.map(function (r) {
        var updated = (r.updated_at && r.updated_at !== r.created_at)
          ? ' · status changed ' + fmtTs(r.updated_at) : '';
        return '<div class="rep" data-id="' + r.id + '">' +
          '<div class="rep-head"><span class="rep-title">' + esc(r.title) + '</span>' +
          '<span class="badge st-' + esc(r.status) + '">' + esc(r.status) + '</span></div>' +
          '<div class="rep-body">' + esc(r.body) + '</div>' +
          '<div class="rep-meta">from <b>' + esc(r.username) + '</b> · sent ' + fmtTs(r.created_at) + updated + '</div>' +
          '<div class="rep-actions"><label>Status:</label>' +
          '<select class="rep-status">' + statusOptions(r.status) + '</select></div>' +
          '</div>';
      }).join('');
      Array.prototype.forEach.call(list.querySelectorAll('.rep'), function (card) {
        card.querySelector('.rep-status').addEventListener('change', function () {
          inboxErr.textContent = '';
          api('/api/gm/reports/' + card.dataset.id, {
            method: 'PATCH', body: JSON.stringify({ status: this.value })
          }).then(function (r) { return r.json().then(function (jj) { return { ok: r.ok, j: jj }; }); })
            .then(function (res) {
              if (!res.ok) { inboxErr.textContent = (res.j && res.j.error) || 'Update failed.'; }
              loadFeedback();
            })
            .catch(function () { inboxErr.textContent = 'Could not reach server.'; });
        });
      });
    }).catch(function () { inboxErr.textContent = 'Could not load feedback.'; });
  }

  function enterInbox(username, role) {
    document.getElementById('who').textContent = 'Signed in as ' + username + ' (' + role + ')';
    showOnly(inboxPane);
    loadFeedback();
  }

  document.getElementById('signin-btn').addEventListener('click', function () {
    signinErr.textContent = '';
    var u = document.getElementById('ru').value.trim();
    var p = document.getElementById('rp').value;
    if (!u || !p) { signinErr.textContent = 'Enter username and password.'; return; }
    var btn = this; btn.disabled = true;
    api('/api/auth/login', { method: 'POST', body: JSON.stringify({ username: u, password: p }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) { signinErr.textContent = (res.j && res.j.error) || 'Sign-in failed.'; return; }
        return api('/api/auth/me').then(function (r) { return r.json(); }).then(function (me) {
          var role = me && me.user && me.user.role;
          if (role !== 'owner' && role !== 'admin') {
            // Signed in, but not staff: show the players-only view.
            document.getElementById('denied-who').textContent =
              'Signed in as ' + (me.user.username || u) + ' (player)';
            showOnly(deniedPane);
            return;
          }
          enterInbox(me.user.username || u, role);
        });
      })
      .catch(function () { btn.disabled = false; signinErr.textContent = 'Could not reach server.'; });
  });
  document.getElementById('rp').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') document.getElementById('signin-btn').click();
  });

  // Route on load: staff -> inbox, signed-in player -> denied view, signed out -> staff sign-in.
  api('/api/auth/me').then(function (r) { return r.ok ? r.json() : null; }).then(function (me) {
    var role = me && me.user && me.user.role;
    if (role === 'owner' || role === 'admin') { enterInbox(me.user.username || '', role); return; }
    if (me && me.user) {
      document.getElementById('denied-who').textContent =
        'Signed in as ' + (me.user.username || '') + ' (player)';
      showOnly(deniedPane);
    }
    // else: signed out — staff sign-in form stays visible.
  }).catch(function () {});
})();
