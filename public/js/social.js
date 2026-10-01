// /social.html — staff-only social feed: profiles, posts, pictures.
(function () {
  var signinPane = document.getElementById('signin-pane');
  var deniedPane = document.getElementById('denied-pane');
  var mainPane = document.getElementById('main-pane');
  var signinErr = document.getElementById('signin-err');

  var myUsername = '';
  var myRole = '';
  var postMedia = [];   // data URLs attached to the composer
  var newAvatar = null; // data URL picked in the profile editor (null = unchanged)

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
    [signinPane, deniedPane, mainPane].forEach(function (p) {
      p.classList.toggle('hidden', p !== el);
    });
  }
  function avatarHtml(url, cls) {
    if (url) return '<img class="' + cls + '" src="' + url + '" alt="">';
    return '<div class="' + cls + '" style="display:flex;align-items:center;justify-content:center;font-size:28px">🛡️</div>';
  }

  // Shrink a picked picture in the browser so uploads stay small.
  function resizeImage(file, maxDim, quality) {
    return new Promise(function (resolve, reject) {
      if (!file || file.type.indexOf('image/') !== 0) { reject(new Error('not-image')); return; }
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        try {
          var scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          URL.revokeObjectURL(url);
          resolve(c.toDataURL('image/jpeg', quality));
        } catch (e) { URL.revokeObjectURL(url); reject(e); }
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('bad-image')); };
      img.src = url;
    });
  }

  var ACCENTS = ['gold', 'purple', 'blue', 'green', 'red'];
  function accentClass(a) { return 'accent-' + (ACCENTS.indexOf(a) >= 0 ? a : 'gold'); }

  // ---------- profile ----------
  function renderProfile(p) {
    var ac = accentClass(p.accent);
    document.getElementById('p-avatar').outerHTML =
      avatarHtml(p.avatar, 'avatar ' + ac).replace('class="avatar ', 'id="p-avatar" class="avatar ');
    document.getElementById('p-name').textContent = p.display_name || p.username;
    document.getElementById('p-role').textContent = myRole;
    var st = document.getElementById('p-status');
    st.textContent = p.status || '';
    st.style.display = p.status ? '' : 'none';
    st.className = 'p-status ' + ac;
    document.getElementById('p-bio').textContent = p.bio || '';
  }
  function loadProfile() {
    api('/api/social/profile').then(function (r) { return r.json(); }).then(function (j) {
      if (j && j.ok) renderProfile(j.profile);
    }).catch(function () {});
  }
  document.getElementById('edit-profile-btn').addEventListener('click', function () {
    newAvatar = null;
    api('/api/social/profile').then(function (r) { return r.json(); }).then(function (j) {
      if (!(j && j.ok)) return;
      var p = j.profile;
      document.getElementById('pe-avatar-preview').outerHTML =
        avatarHtml(p.avatar, 'avatar').replace('class="avatar"', 'id="pe-avatar-preview" class="avatar"');
      document.getElementById('pe-name').value = p.display_name || '';
      document.getElementById('pe-status').value = p.status || '';
      document.getElementById('pe-bio').value = p.bio || '';
      markAccent(p.accent);
      document.getElementById('profile-editor').classList.remove('hidden');
    }).catch(function () {});
  });
  document.getElementById('pe-avatar').addEventListener('change', function () {
    var f = this.files[0];
    if (!f) return;
    resizeImage(f, 256, 0.85).then(function (url) {
      newAvatar = url;
      document.getElementById('pe-avatar-preview').outerHTML =
        avatarHtml(url, 'avatar').replace('class="avatar"', 'id="pe-avatar-preview" class="avatar"');
    }).catch(function () {
      document.getElementById('profile-err').textContent = 'That picture could not be read.';
    });
    this.value = '';
  });
  document.getElementById('cancel-profile-btn').addEventListener('click', function () {
    document.getElementById('profile-editor').classList.add('hidden');
    document.getElementById('profile-err').textContent = '';
  });
  var selAccent = 'gold';
  function markAccent(a) {
    selAccent = ACCENTS.indexOf(a) >= 0 ? a : 'gold';
    var dots = document.querySelectorAll('#pe-accents .accent-dot');
    for (var i = 0; i < dots.length; i++) {
      dots[i].classList.toggle('sel', dots[i].getAttribute('data-accent') === selAccent);
    }
  }
  document.querySelectorAll('#pe-accents .accent-dot').forEach(function (d) {
    d.addEventListener('click', function () { markAccent(d.getAttribute('data-accent')); });
  });
  document.getElementById('save-profile-btn').addEventListener('click', function () {
    var errEl = document.getElementById('profile-err');
    errEl.textContent = '';
    var payload = {
      display_name: document.getElementById('pe-name').value,
      status: document.getElementById('pe-status').value,
      bio: document.getElementById('pe-bio').value,
      accent: selAccent
    };
    if (newAvatar) payload.avatar = newAvatar;
    var btn = this; btn.disabled = true;
    api('/api/social/profile', { method: 'PUT', body: JSON.stringify(payload) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) { errEl.textContent = (res.j && res.j.error) || 'Could not save.'; return; }
        document.getElementById('profile-editor').classList.add('hidden');
        loadProfile();
      })
      .catch(function () { btn.disabled = false; errEl.textContent = 'Could not reach server.'; });
  });

  // ---------- composer ----------
  function renderPreviews() {
    var box = document.getElementById('post-previews');
    box.innerHTML = '';
    postMedia.forEach(function (url, i) {
      var d = document.createElement('div');
      d.className = 'preview';
      var img = document.createElement('img');
      img.src = url; img.alt = '';
      var x = document.createElement('button');
      x.type = 'button'; x.textContent = '×';
      x.addEventListener('click', function () { postMedia.splice(i, 1); renderPreviews(); });
      d.appendChild(img); d.appendChild(x);
      box.appendChild(d);
    });
  }
  document.getElementById('post-files').addEventListener('change', function () {
    var files = Array.prototype.slice.call(this.files || []).slice(0, 4 - postMedia.length);
    var errEl = document.getElementById('post-err');
    var jobs = files.map(function (f) { return resizeImage(f, 1280, 0.8); });
    Promise.all(jobs).then(function (urls) {
      postMedia = postMedia.concat(urls).slice(0, 4);
      renderPreviews();
    }).catch(function () { errEl.textContent = 'One of those pictures could not be read.'; });
    this.value = '';
  });
  document.getElementById('post-btn').addEventListener('click', function () {
    var errEl = document.getElementById('post-err');
    errEl.textContent = '';
    var body = document.getElementById('post-body').value.trim();
    if (!body && !postMedia.length) { errEl.textContent = 'Write something or add a picture.'; return; }
    var btn = this; btn.disabled = true;
    api('/api/social/posts', { method: 'POST', body: JSON.stringify({ body: body, media: postMedia }) })
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
      .then(function (res) {
        btn.disabled = false;
        if (!res.ok) { errEl.textContent = (res.j && res.j.error) || 'Could not post.'; return; }
        document.getElementById('post-body').value = '';
        postMedia = []; renderPreviews();
        loadFeed();
      })
      .catch(function () { btn.disabled = false; errEl.textContent = 'Could not reach server.'; });
  });

  // ---------- feed ----------
  function loadFeed() {
    api('/api/social/posts').then(function (r) { return r.json(); }).then(function (j) {
      var posts = (j && j.ok && j.posts) || [];
      var feed = document.getElementById('feed');
      if (!posts.length) { feed.innerHTML = '<div class="empty">No posts yet — say hi to the team!</div>'; return; }
      feed.innerHTML = posts.map(function (p) {
        var media = (p.media || []).map(function (m) {
          return '<img src="' + m + '" alt="" loading="lazy">';
        }).join('');
        var canDel = (p.username === myUsername) || (myRole === 'owner');
        var ac = accentClass(p.accent);
        return '<div class="post ' + ac + '" data-id="' + p.id + '">' +
          '<div class="post-head">' + avatarHtml(p.avatar, 'avatar sm ' + ac) +
          '<div class="p-info"><div><span class="p-name ' + ac + '" style="color:var(--ac)">' + esc(p.display_name || p.username) + '</span>' +
          '<span class="p-role">' + esc(p.role) + '</span></div>' +
          '<div class="post-ts">' + fmtTs(p.created_at) + '</div></div>' +
          (canDel ? '<button class="post-del" type="button">Delete</button>' : '') +
          '</div>' +
          (p.body ? '<div class="post-body">' + esc(p.body) + '</div>' : '') +
          (media ? '<div class="post-media' + (p.media.length === 1 ? ' single' : '') + '">' + media + '</div>' : '') +
          '</div>';
      }).join('');
      Array.prototype.forEach.call(feed.querySelectorAll('.post'), function (card) {
        var del = card.querySelector('.post-del');
        if (!del) return;
        del.addEventListener('click', function () {
          if (!confirm('Delete this post?')) return;
          api('/api/social/posts/' + card.dataset.id, { method: 'DELETE' })
            .then(function (r) { return r.json(); })
            .then(function () { loadFeed(); })
            .catch(function () {});
        });
      });
    }).catch(function () {
      document.getElementById('feed').innerHTML = '<div class="empty">Could not load feed.</div>';
    });
  }

  // ---------- sign-in (staff only) ----------
  function enterMain(username, role) {
    myUsername = username; myRole = role;
    document.getElementById('who').textContent = 'Signed in as ' + username + ' (' + role + ')';
    showOnly(mainPane);
    loadProfile();
    loadFeed();
  }
  document.getElementById('signin-btn').addEventListener('click', function () {
    signinErr.textContent = '';
    var u = document.getElementById('su').value.trim();
    var p = document.getElementById('sp').value;
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
            document.getElementById('denied-who').textContent =
              'Signed in as ' + (me.user.username || u) + ' (player)';
            showOnly(deniedPane);
            return;
          }
          enterMain(me.user.username || u, role);
        });
      })
      .catch(function () { btn.disabled = false; signinErr.textContent = 'Could not reach server.'; });
  });
  document.getElementById('sp').addEventListener('keydown', function (e) {
    if (e.key === 'Enter') document.getElementById('signin-btn').click();
  });

  api('/api/auth/me').then(function (r) { return r.ok ? r.json() : null; }).then(function (me) {
    var role = me && me.user && me.user.role;
    if (role === 'owner' || role === 'admin') { enterMain(me.user.username || '', role); return; }
    if (me && me.user) {
      document.getElementById('denied-who').textContent =
        'Signed in as ' + (me.user.username || '') + ' (player)';
      showOnly(deniedPane);
    }
  }).catch(function () {});
})();
