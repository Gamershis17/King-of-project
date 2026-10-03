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
      stopAdminChatPoll();
      ['audit', 'bugs', 'feedback', 'ideas', 'adminchat', 'inspector'].forEach(function (t) {
        document.getElementById('tab-' + t).classList.toggle('hidden', t !== b.dataset.tab);
      });
      if (b.dataset.tab === 'audit') loadAudit();
      if (b.dataset.tab === 'bugs') loadReports('bug');
      if (b.dataset.tab === 'feedback') loadReports('feedback');
      if (b.dataset.tab === 'ideas') loadIdeas();
      if (b.dataset.tab === 'adminchat') loadAdminChat();
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

  // ---------- Discord #mod-logs webhook ----------
  function refreshWebhookStatus() {
    var statusEl = document.getElementById('webhook-status');
    api('/api/gm/discord-webhook').then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.configured) {
        statusEl.innerHTML = '✅ Connected: <span style="font-family:monospace">' + esc(j.masked || '') + '</span>';
      } else {
        statusEl.textContent = 'Not connected — staff actions stay in the audit log only.';
      }
    }).catch(function () { statusEl.textContent = ''; });
  }
  document.getElementById('webhook-save').addEventListener('click', function () {
    var url = document.getElementById('webhook-url').value;
    api('/api/gm/discord-webhook', { method: 'POST', body: JSON.stringify({ url: url }) })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        if (res.status === 200 && res.body.ok) {
          document.getElementById('webhook-url').value = '';
          refreshWebhookStatus();
          fail('');
        } else {
          fail((res.body && res.body.error) || 'Could not save webhook.');
        }
      }).catch(function () { fail('Could not save webhook.'); });
  });
  document.getElementById('webhook-clear').addEventListener('click', function () {
    api('/api/gm/discord-webhook', { method: 'DELETE' })
      .then(function (r) { return r.json(); })
      .then(function () { refreshWebhookStatus(); fail(''); })
      .catch(function () { fail('Could not disconnect webhook.'); });
  });

  // ---------- Discord #bug-reports + #feedback webhooks ----------
  function wirePlayerWebhook(prefix, path, emptyText) {
    var statusEl = document.getElementById(prefix + '-webhook-status');
    function refresh() {
      api(path).then(function (r) { return r.json(); }).then(function (j) {
        if (j && j.configured) {
          statusEl.innerHTML = '✅ Connected: <span style="font-family:monospace">' + esc(j.masked || '') + '</span>';
        } else {
          statusEl.textContent = emptyText;
        }
      }).catch(function () { statusEl.textContent = ''; });
    }
    refresh();
    document.getElementById(prefix + '-webhook-save').addEventListener('click', function () {
      var url = document.getElementById(prefix + '-webhook-url').value;
      api(path, { method: 'POST', body: JSON.stringify({ url: url }) })
        .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
        .then(function (res) {
          if (res.status === 200 && res.body.ok) {
            document.getElementById(prefix + '-webhook-url').value = '';
            refresh();
            fail('');
          } else {
            fail((res.body && res.body.error) || 'Could not save webhook.');
          }
        }).catch(function () { fail('Could not save webhook.'); });
    });
    document.getElementById(prefix + '-webhook-clear').addEventListener('click', function () {
      api(path, { method: 'DELETE' })
        .then(function (r) { return r.json(); })
        .then(function () { refresh(); fail(''); })
        .catch(function () { fail('Could not disconnect webhook.'); });
    });
  }
  wirePlayerWebhook('bug', '/api/gm/discord-bug-webhook',
    'Not connected — new bug reports stay in the inbox only.');
  wirePlayerWebhook('feedback', '/api/gm/discord-feedback-webhook',
    'Not connected — new feedback stays in the inbox only.');

  // ---------- Discord #patch-notes ----------
  wirePlayerWebhook('patchnotes', '/api/gm/discord-patchnotes-webhook',
    'Not connected — patch notes stay in-game only.');
  // Show which entry the push button will send.
  api('/api/changelog').then(function (r) { return r.json(); }).then(function (j) {
    var latest = j && j.log && j.log[0];
    var el = document.getElementById('patchnotes-latest');
    if (latest) {
      el.textContent = 'Latest entry: ' + (latest.title || '(untitled)') + ' (' + (latest.date || 'undated') + ')';
    } else {
      el.textContent = 'No changelog entries yet.';
    }
  }).catch(function () { /* leave blank */ });
  document.getElementById('patchnotes-push').addEventListener('click', function () {
    var el = document.getElementById('patchnotes-latest');
    api('/api/gm/push-patch-notes', { method: 'POST' })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        if (res.status === 200 && res.body.ok) {
          el.textContent = '✅ Pushed to #patch-notes: ' + (res.body.title || '(untitled)');
          fail('');
        } else {
          fail((res.body && res.body.error) || 'Could not push patch notes.');
        }
      }).catch(function () { fail('Could not push patch notes.'); });

  // ---------- Discord #balance-log ----------
  wirePlayerWebhook('balance', '/api/gm/discord-balance-webhook',
    'Not connected — balance log stays in-game only.');
  // Show which entry the push button will send.
  fetch('data/balance-log.json', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (log) {
    var latest = log && log[0];
    var el = document.getElementById('balance-latest');
    if (latest) {
      el.textContent = 'Latest entry: ' + (latest.title || '(untitled)') + ' (' + (latest.version || 'unversioned') + ')';
    } else {
      el.textContent = 'No balance entries yet.';
    }
  }).catch(function () { /* leave blank */ });
  document.getElementById('balance-push').addEventListener('click', function () {
    var el = document.getElementById('balance-latest');
    api('/api/gm/push-balance-log', { method: 'POST' })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, body: j }; }); })
      .then(function (res) {
        if (res.status === 200 && res.body.ok) {
          el.textContent = '✅ Pushed to #balance-log: ' + (res.body.title || '(untitled)');
          fail('');
        } else {
          fail((res.body && res.body.error) || 'Could not push balance changes.');
        }
      }).catch(function () { fail('Could not push balance changes.'); });
  });
  });

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

  // ---------- admin chat (owner/admin only) ----------
  var adminChatTimer = null;
  var adminChatLastId = 0;
  function stopAdminChatPoll() {
    if (adminChatTimer) { clearInterval(adminChatTimer); adminChatTimer = null; }
  }
  function adminChatMsgHtml(m) {
    var color = m.nameColor ? ' style="color:' + esc(m.nameColor) + '"' : '';
    return '<div class="entry" data-id="' + m.id + '">' +
      '<div class="entry-head"><span class="entry-title"' + color + '>' + esc(m.username) + '</span>' +
      '<button class="ghost small adminchat-del" title="Delete message" aria-label="Delete message">✕</button></div>' +
      '<div class="entry-body">' + esc(m.message) + '</div>' +
      '<div class="entry-meta">sent ' + fmtTs(m.created_at) + '</div>' +
      '</div>';
  }
  function pollAdminChat() {
    var list = document.getElementById('adminchat-list');
    if (!list || document.getElementById('tab-adminchat').classList.contains('hidden')) return;
    api('/api/gm/admin-chat?after=' + adminChatLastId).then(function (r) { return r.json(); }).then(function (j) {
      var msgs = (j && j.ok && j.messages) || [];
      if (!msgs.length) return;
      var empty = list.querySelector('.empty');
      if (empty) list.innerHTML = '';
      for (var i = 0; i < msgs.length; i++) {
        adminChatLastId = Math.max(adminChatLastId, Number(msgs[i].id) || 0);
        list.insertAdjacentHTML('beforeend', adminChatMsgHtml(msgs[i]));
      }
      list.scrollTop = list.scrollHeight;
    }).catch(function () { /* offline-tolerant; keep polling */ });
  }
  function loadAdminChat() {
    adminChatLastId = 0;
    var list = document.getElementById('adminchat-list');
    if (list) list.innerHTML = '<div class="empty">Loading…</div>';
    pollAdminChat();
    stopAdminChatPoll();
    adminChatTimer = setInterval(pollAdminChat, 5000);
  }
  document.getElementById('adminchat-send').addEventListener('click', function () {
    var input = document.getElementById('adminchat-input');
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    opsErr.textContent = '';
    api('/api/gm/admin-chat', { method: 'POST', body: JSON.stringify({ message: text }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { fail((res.j && res.j.error) || 'Could not send.'); input.value = text; return; }
        pollAdminChat();
      })
      .catch(function () { fail('Could not reach server.'); input.value = text; });
  });
  document.getElementById('adminchat-input').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') document.getElementById('adminchat-send').click();
  });
  document.getElementById('adminchat-list').addEventListener('click', function (e) {
    var btn = e.target.closest('.adminchat-del');
    if (!btn) return;
    var card = btn.closest('.entry');
    var id = card && Number(card.dataset.id);
    if (!id) return;
    api('/api/gm/admin-chat/' + id, { method: 'DELETE' })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok) { fail((res.j && res.j.error) || 'Delete failed.'); return; }
        if (card) card.remove();
      })
      .catch(function () { fail('Could not reach server.'); });
  });

  // ---------- 🔍 Player Inspector (owner only) ----------
  var ITEM_STAT_KEYS = ['attack', 'defense', 'maxHp', 'critChance', 'critDamage',
    'parry', 'dodge', 'lifesteal', 'attackSpeed', 'regen', 'goldBonus', 'xpBonus'];
  var inspTarget = null; // username of the currently inspected player

  function fmtNum(v) {
    var n = Number(v);
    if (!isFinite(n)) return '—';
    if (Math.abs(n) >= 1e12) return (n / 1e12).toFixed(2) + 'T';
    if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return String(Math.round(n * 100) / 100);
  }

  document.getElementById('insp-lookup').addEventListener('click', function () {
    var name = document.getElementById('insp-username').value.trim();
    if (!name) { fail('Enter a player username.'); return; }
    opsErr.textContent = '';
    var box = document.getElementById('insp-results');
    box.innerHTML = '<div class="empty">Searching…</div>';
    api('/api/gm/players?search=' + encodeURIComponent(name) + '&limit=10')
      .then(function (r) { return r.json(); })
      .then(function (j) {
        var players = (j && j.players) || [];
        if (!players.length) { box.innerHTML = '<div class="empty">No player found for "' + esc(name) + '".</div>'; return; }
        box.innerHTML = players.map(function (p) {
          var onlinePill = p.online
            ? '<span class="badge" style="background:#16a34a;color:#fff;">🟢 Online</span>'
            : '<span class="badge" style="background:#6b7280;color:#fff;">🔴 Offline</span>';
          return '<div class="entry"><div class="entry-head"><span class="entry-title">' + esc(p.username) + '</span>' +
            onlinePill +
            '<span class="badge st-open">' + esc(p.role || 'player') + '</span></div>' +
            '<div class="entry-meta">Lv ' + esc(p.level) + ' · Stage ' + esc(p.stage) +
            (p.playerClass ? ' · ' + esc(p.playerClass) : '') + '</div>' +
            '<div class="entry-actions"><button class="small insp-pick" data-u="' + esc(p.username) + '">📋 Inspect</button></div></div>';
        }).join('');
        Array.prototype.forEach.call(box.querySelectorAll('.insp-pick'), function (btn) {
          btn.addEventListener('click', function () {
            document.getElementById('insp-username').value = btn.dataset.u;
            loadDossier(btn.dataset.u);
          });
        });
      })
      .catch(function () { fail('Could not search players.'); });
  });

  document.getElementById('insp-dossier').addEventListener('click', function () {
    var name = document.getElementById('insp-username').value.trim();
    if (!name) { fail('Enter a player username.'); return; }
    loadDossier(name);
  });
  document.getElementById('insp-username').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') document.getElementById('insp-dossier').click();
  });

  function loadDossier(username) {
    opsErr.textContent = '';
    var box = document.getElementById('insp-results');
    box.innerHTML = '<div class="empty">Loading dossier…</div>';
    api('/api/gm/inspect', { method: 'POST', body: JSON.stringify({ username: username }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        if (!res.ok || !res.j.ok) { fail((res.j && res.j.error) || 'Dossier load failed.'); box.innerHTML = ''; return; }
        inspTarget = username;
        box.innerHTML = renderDossier(res.j.dossier || {});
        wireDossier(box);
      })
      .catch(function () { fail('Could not reach server.'); });
  }

  function renderDossier(d) {
    var html = '';
    // Presence
    var pres = d.presence || {};
    var online = !!pres.online;
    html += '<div class="insp-sec"><span class="insp-presence ' + (online ? 'insp-online' : 'insp-offline') + '">' +
      (online ? '🟢 Online' : '🔴 Offline') + '</span> ' +
      '<span class="entry-meta">last seen ' + esc(pres.lastSeen ? fmtTs(pres.lastSeen) : 'unknown') + '</span></div>';
    // Identity
    html += '<div class="insp-sec"><h3>👤 ' + esc(d.username || '—') + ' <span class="badge st-open">' + esc(d.role || 'player') + '</span></h3>' +
      '<div class="entry-meta">' + esc(d.playerClass || '') + (d.spec ? ' · ' + esc(d.spec) : '') + '</div></div>';
    // Stats
    var fs = d.fullStats || {};
    var stats = [
      ['DPS', fmtNum(fs.dps)], ['HP', fmtNum(fs.hp) + ' / ' + fmtNum(fs.maxHp)],
      ['Gold', fmtNum(fs.gold != null ? fs.gold : d.gold)], ['Stage', fmtNum(fs.stage != null ? fs.stage : d.stage)],
      ['Level', fmtNum(fs.level != null ? fs.level : d.level)], ['Attack', fmtNum(fs.attack)],
      ['Defense', fmtNum(fs.defense)], ['Crit', fmtNum(fs.critChance) + '%']
    ];
    html += '<div class="insp-sec"><h3>📊 Stats</h3><div class="insp-grid">' +
      stats.map(function (s) {
        return '<div class="insp-stat"><div class="k">' + esc(s[0]) + '</div><div class="v">' + esc(s[1]) + '</div></div>';
      }).join('') + '</div></div>';
    // Equipped gear
    var gear = d.equippedGear || d.equipped || {};
    html += '<div class="insp-sec"><h3>⚔️ Equipped Gear</h3>';
    var slots = Object.keys(gear);
    if (!slots.length) {
      html += '<div class="empty">Nothing equipped.</div>';
    } else {
      html += slots.map(function (slot) {
        var it = gear[slot] || {};
        var nm = (it && it.name) || String(it) || '—';
        var id = (it && (it.id || it.itemId || it.uid)) || '';
        return '<div class="gear-row" data-slot="' + esc(slot) + '" data-id="' + esc(id) + '">' +
          '<span class="slot">' + esc(slot) + '</span><span class="nm">' + esc(nm) + '</span>' +
          '<span class="acts"><button class="small insp-mod-item">✏️ Mod</button></span></div>';
      }).join('');
    }
    html += '</div>';
    // Pets
    var pets = d.petInspector || d.pets || {};
    var petList = Array.isArray(pets) ? pets : (Array.isArray(pets.active) ? pets.active : []);
    html += '<div class="insp-sec"><h3>🐾 Pets</h3>';
    if (!petList.length) {
      html += '<div class="empty">No pets.</div>';
    } else {
      html += petList.map(function (p) {
        var nm = (p && (p.name || p.species)) || 'pet';
        var uid = (p && (p.uid || p.id)) || '';
        var meta = 'Lv ' + (p && p.level != null ? p.level : '?');
        return '<div class="pet-row" data-uid="' + esc(uid) + '">' +
          '<span class="slot">pet</span><span class="nm">' + esc(nm) + ' <span class="entry-meta">(' + esc(meta) + ')</span></span>' +
          '<span class="acts"><button class="small insp-mod-pet">✏️ Mod</button>' +
          '<button class="small danger insp-rm-pet">🗑 Remove</button></span></div>';
      }).join('');
    }
    html += '</div>';
    return html;
  }

  function wireDossier(box) {
    // Mod item
    Array.prototype.forEach.call(box.querySelectorAll('.insp-mod-item'), function (btn) {
      btn.addEventListener('click', function () {
        var row = btn.closest('.gear-row');
        openItemModal(inspTarget, row.dataset.slot, row.dataset.id,
          row.querySelector('.nm').textContent.trim());
      });
    });
    // Mod pet
    Array.prototype.forEach.call(box.querySelectorAll('.insp-mod-pet'), function (btn) {
      btn.addEventListener('click', function () {
        var row = btn.closest('.pet-row');
        openPetModal(inspTarget, row.dataset.uid);
      });
    });
    // Remove pet
    Array.prototype.forEach.call(box.querySelectorAll('.insp-rm-pet'), function (btn) {
      btn.addEventListener('click', function () {
        var row = btn.closest('.pet-row');
        var uid = row.dataset.uid;
        if (!uid) { fail('Pet has no id — cannot remove.'); return; }
        if (!confirm('Remove this pet from ' + inspTarget + '? This cannot be undone.')) return;
        opsErr.textContent = '';
        api('/api/gm/remove-pet', { method: 'POST', body: JSON.stringify({ username: inspTarget, petUid: uid }) })
          .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
          .then(function (res) {
            if (!res.ok) { fail((res.j && res.j.error) || 'Remove failed.'); return; }
            loadDossier(inspTarget);
          })
          .catch(function () { fail('Could not reach server.'); });
      });
    });
  }

  // ---------- modals ----------
  function closeModal() {
    document.getElementById('insp-modal-root').innerHTML = '';
  }
  function openModal(title, bodyHtml, onSave) {
    var root = document.getElementById('insp-modal-root');
    root.innerHTML = '<div class="modal-backdrop"><div class="modal"><h3>' + esc(title) + '</h3>' +
      bodyHtml +
      '<div class="actions"><button id="insp-modal-save">💾 Save</button>' +
      '<button id="insp-modal-cancel" class="ghost">Cancel</button></div></div></div>';
    document.getElementById('insp-modal-cancel').addEventListener('click', closeModal);
    root.querySelector('.modal-backdrop').addEventListener('click', function (e) {
      if (e.target === this) closeModal();
    });
    document.getElementById('insp-modal-save').addEventListener('click', onSave);
  }

  function openItemModal(username, slot, itemId, curName) {
    var fields = ITEM_STAT_KEYS.map(function (k) {
      return '<div class="fld"><label for="im-' + k + '">' + esc(k) + ' <span style="color:#7a7094">(blank = leave)</span></label>' +
        '<input id="im-' + k + '" type="number" step="any" placeholder="—"></div>';
    }).join('');
    var body = '<div class="fld"><label for="im-name">Custom name (optional)</label>' +
      '<input id="im-name" type="text" maxlength="60" placeholder="' + esc(curName || '') + '"></div>' +
      '<p class="entry-meta" style="margin-bottom:10px">Slot: <b>' + esc(slot) + '</b> · Item id: <b>' + esc(itemId || '—') + '</b></p>' +
      fields;
    openModal('✏️ Mod item — ' + username, body, function () {
      var stats = {};
      ITEM_STAT_KEYS.forEach(function (k) {
        var v = document.getElementById('im-' + k).value.trim();
        if (v !== '' && isFinite(Number(v))) stats[k] = Number(v);
      });
      var name = document.getElementById('im-name').value.trim();
      if (!Object.keys(stats).length && !name) { fail('Enter at least one stat or a name.'); return; }
      opsErr.textContent = '';
      api('/api/gm/mod-item', { method: 'POST', body: JSON.stringify({ username: username, itemId: itemId, stats: stats, name: name || undefined }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok) { fail((res.j && res.j.error) || 'Mod failed.'); return; }
          closeModal();
          loadDossier(username);
        })
        .catch(function () { fail('Could not reach server.'); });
    });
  }

  function openPetModal(username, petUid) {
    var body =
      '<div class="fld"><label for="pm-level">Level</label><input id="pm-level" type="number" step="1" min="1" placeholder="—"></div>' +
      '<div class="fld"><label for="pm-species">Species (optional)</label><input id="pm-species" type="text" maxlength="40" placeholder="—" autocapitalize="none"></div>' +
      '<div class="fld"><label for="pm-hunger">Hunger (0–100)</label><input id="pm-hunger" type="number" step="1" min="0" max="100" placeholder="—"></div>' +
      '<div class="fld"><label for="pm-xp">XP</label><input id="pm-xp" type="number" step="1" min="0" placeholder="—"></div>' +
      '<p class="entry-meta">Pet id: <b>' + esc(petUid || '—') + '</b></p>';
    openModal('✏️ Mod pet — ' + username, body, function () {
      var mods = {};
      var lv = document.getElementById('pm-level').value.trim();
      var sp = document.getElementById('pm-species').value.trim();
      var hu = document.getElementById('pm-hunger').value.trim();
      var xp = document.getElementById('pm-xp').value.trim();
      if (lv !== '' && isFinite(Number(lv))) mods.level = Math.max(1, Math.floor(Number(lv)));
      if (sp !== '') mods.species = sp;
      if (hu !== '' && isFinite(Number(hu))) mods.hunger = Math.max(0, Math.min(100, Number(hu)));
      if (xp !== '' && isFinite(Number(xp))) mods.xp = Math.max(0, Number(xp));
      if (!Object.keys(mods).length) { fail('Enter at least one field.'); return; }
      opsErr.textContent = '';
      api('/api/gm/mod-pet', { method: 'POST', body: JSON.stringify({ username: username, petUid: petUid, mods: mods }) })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (!res.ok) { fail((res.j && res.j.error) || 'Mod failed.'); return; }
          closeModal();
          loadDossier(username);
        })
        .catch(function () { fail('Could not reach server.'); });
    });
  }

  // ---------- login (owner/admin only) ----------
  var currentRole = null;
  function enterOps(username, role) {
    currentRole = role;
    document.getElementById('who').textContent = 'Signed in as ' + username + ' (' + role + ')';
    loginPane.classList.add('hidden');
    opsPane.classList.remove('hidden');
    // Inspector tab is owner-only.
    var inspBtn = document.getElementById('tabbtn-inspector');
    if (inspBtn) inspBtn.classList.toggle('hidden', role !== 'owner');
    loadAudit();
    loadReports('bug');
    loadReports('feedback');
    loadNotice();
    wireNotice();
    refreshWebhookStatus();
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
