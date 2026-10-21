AP.boot({
  title: 'Users', nav: 'users', perm: 'users',
  render: function (me, main) {
    var E = AP.esc;
    var ROLE_HELP = {
      admin: 'Everything, including users and claim clean-up',
      intake: 'Submits claims and sees the claims they submitted',
      handler: 'Quick sign-offs: sees only claims routed to quick sign-off',
      senior: 'Detailed reviews: sees only claims routed to detailed review'
    };
    var roles = [];
    main.innerHTML =
      '<div class="page-head"><div><h1>Users</h1><div class="sub">Who can sign in, and what they can do.</div></div><div class="actions"><button class="btn primary" id="add" type="button">Add user</button></div></div>' +
      '<div class="grid-4" id="roles" style="margin-bottom:16px"></div>' +
      '<div class="card" id="list"><div class="loading-page"><span class="spinner"></span></div></div>';

    function roleSelect(cur) { return '<select id="u-role">' + roles.map(function (r) { return '<option value="' + r.id + '"' + (r.id === cur ? ' selected' : '') + '>' + E(r.label) + '</option>'; }).join('') + '</select>'; }

    function load() {
      AP.api('GET', '/api/users').then(function (j) {
        roles = j.roles;
        document.getElementById('roles').innerHTML = roles.map(function (r) {
          var n = j.users.filter(function (u) { return u.role === r.id && u.active; }).length;
          return '<div class="card kpi"><div class="label">' + E(r.label) + '</div><div class="value">' + n + '</div><div class="small muted">' + E(ROLE_HELP[r.id] || '') + '</div></div>';
        }).join('');
        var el = document.getElementById('list');
        el.innerHTML = '<div class="table-wrap"><table class="data cards"><thead><tr><th>Name</th><th>Role</th><th>Status</th><th>Sign-in page</th><th>Last sign-in</th><th></th></tr></thead><tbody>' +
          j.users.map(function (u) {
            return '<tr><td data-label="Name"><div class="primary-cell">' + E(u.name) + (u.email === me.email ? ' <span class="small muted">(you)</span>' : '') + '</div><div class="sub wrap-any">' + E(u.email) + '</div></td>' +
              '<td data-label="Role">' + E(u.roleLabel) + '</td>' +
              '<td data-label="Status">' + (u.active ? '<span class="pill ok">Active</span>' : '<span class="pill">Deactivated</span>') + '</td>' +
              '<td data-label="Sign-in page">' + (MODE_PILL[u.signIn || (u.quickSignIn ? 'oneclick' : 'hidden')] || '') + '</td>' +
              '<td data-label="Last sign-in" class="nowrap">' + (u.lastLoginAt ? AP.fmtRel(u.lastLoginAt) : '<span class="muted">Never</span>') + '</td>' +
              '<td class="right nowrap"><button class="btn small" type="button" data-edit="' + E(u.email) + '">Edit</button>' +
              (u.email === me.email ? '' : ' <button class="btn small danger" type="button" data-del="' + E(u.email) + '">Delete</button>') + '</td></tr>';
          }).join('') + '</tbody></table></div>';
        el.querySelectorAll('[data-del]').forEach(function (b) {
          b.onclick = function () { del(j.users.find(function (u) { return u.email === b.dataset.del; })); };
        });
        el.querySelectorAll('[data-edit]').forEach(function (b) {
          b.onclick = function () { edit(j.users.find(function (u) { return u.email === b.dataset.edit; })); };
        });
      }).catch(function (e) { document.getElementById('list').innerHTML = '<div class="card-body"><div class="alert bad">' + E(e.message) + '</div></div>'; });
    }

    // Three ways to appear on the sign-in page.
    var MODES = [
      ['oneclick', 'Listed – one click, no password', 'Their name is on the sign-in page and one click signs them in.'],
      ['password', 'Listed – must type their password', 'Their name is on the sign-in page; clicking it asks for their password.'],
      ['hidden', 'Not listed', 'They type their email and password to sign in.']
    ];
    var MODE_PILL = { oneclick: '<span class="pill plain info">One click</span>', password: '<span class="pill plain violet">Listed · password</span>', hidden: '<span class="muted small">Not listed</span>' };
    function modePicker(current) {
      return '<fieldset class="field" style="border:0;padding:0;margin:0"><legend style="font-weight:550;font-size:13px;margin-bottom:4px">Sign-in page</legend>' +
        MODES.map(function (m) {
          return '<label style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;cursor:pointer"><input type="radio" name="u-mode" value="' + m[0] + '"' + (m[0] === current ? ' checked' : '') + ' style="margin-top:3px">' +
            '<span><span style="font-weight:550">' + m[1] + '</span><span class="hint" style="display:block">' + m[2] + '</span></span></label>';
        }).join('') + '</fieldset>';
    }
    function pickedMode(back) { var x = back.querySelector('input[name=u-mode]:checked'); return x ? x.value : 'oneclick'; }
    function syncPwHint(back, needOwn) {
      var m = pickedMode(back), h = back.querySelector('#pw-hint'), lab = back.querySelector('#pw-label');
      var need = m !== 'oneclick' && needOwn;
      lab.classList.toggle('req', need);
      h.textContent = m === 'oneclick' ? 'Optional. At least 10 characters; they can also sign in with it by typing their email.' :
        need ? 'Required: they sign in by typing this password. At least 10 characters.' : 'Leave empty to keep their current password. Changing it signs them out.';
    }

    function add() {
      var m = AP.modal('Add user', '<div class="form-grid"><label class="field">Name<input type="text" id="u-name"></label><label class="field">Email<input type="email" id="u-email"></label>' +
        '<label class="field">Role' + roleSelect('intake') + '</label>' +
        modePicker('oneclick') +
        '<label class="field"><span id="pw-label">Password</span><span class="hint" id="pw-hint"></span><input type="text" id="u-pw" autocomplete="off"></label>' +
        '<div class="alert bad" id="u-err" hidden></div></div>', [
        { label: 'Cancel' },
        { label: 'Add user', primary: true, onClick: function (back, close) {
          var err = back.querySelector('#u-err');
          AP.api('POST', '/api/users', { name: back.querySelector('#u-name').value, email: back.querySelector('#u-email').value, role: back.querySelector('#u-role').value, password: back.querySelector('#u-pw').value, signIn: pickedMode(back) })
            .then(function () { close(); AP.toast('User added'); load(); })
            .catch(function (e) { err.textContent = e.message; err.hidden = false; });
          return false;
        } }
      ]);
      wireMode(m.el, true);
    }
    function wireMode(back, needOwn) {
      back.querySelectorAll('input[name=u-mode]').forEach(function (r) { r.onchange = function () { syncPwHint(back, needOwn); }; });
      syncPwHint(back, needOwn);
    }

    function edit(u) {
      var self = u.email === me.email;
      var m = AP.modal('Edit ' + u.name, '<div class="form-grid"><div class="small muted wrap-any">' + E(u.email) + '</div><label class="field">Name<input type="text" id="u-name" value="' + E(u.name) + '"></label>' +
        '<label class="field">Role' + roleSelect(u.role) + (self ? '<span class="hint">You cannot remove your own administrator role.</span>' : '') + '</label>' +
        modePicker(u.signIn || (u.quickSignIn ? 'oneclick' : 'hidden')) +
        '<label class="field"><span id="pw-label">New password</span><span class="hint" id="pw-hint"></span><input type="text" id="u-pw" autocomplete="off"></label>' +
        (self ? '<div class="small muted">You cannot delete or deactivate your own account.</div>' : '<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="u-active"' + (u.active ? ' checked' : '') + '> Active (can sign in)</label>') +
        '<div class="alert bad" id="u-err" hidden></div></div>', [
        { label: 'Cancel' },
        { label: 'Save', primary: true, onClick: function (back, close) {
          var b = { name: back.querySelector('#u-name').value, role: back.querySelector('#u-role').value };
          var pw = back.querySelector('#u-pw').value; if (pw) b.password = pw;
          var act = back.querySelector('#u-active'); if (act) b.active = act.checked;
          b.signIn = pickedMode(back);
          AP.api('PATCH', '/api/users/' + encodeURIComponent(u.email), b)
            .then(function () { close(); AP.toast('Saved'); load(); })
            .catch(function (e) { var err = back.querySelector('#u-err'); err.textContent = e.message; err.hidden = false; });
          return false;
        } }
      ]);
      wireMode(m.el, !u.hasPassword);
    }
    function del(u) {
      AP.modal('Delete ' + u.name + '?', '<p>This permanently removes <strong class="wrap-any">' + E(u.email) + '</strong>. They are signed out and can no longer sign in.' +
        (u.demo ? ' It also disappears from the sign-in page.' : '') + '</p><p class="small muted">Claims and reviews they worked on are kept. To block access but keep the account, use Edit and untick Active instead.</p>' +
        '<div class="alert bad" id="d-err" hidden></div>', [
        { label: 'Cancel' },
        { label: 'Delete account', danger: true, onClick: function (back, close) {
          AP.api('DELETE', '/api/users/' + encodeURIComponent(u.email)).then(function () { close(); AP.toast('Account deleted'); load(); })
            .catch(function (e) { var x = back.querySelector('#d-err'); x.textContent = e.message; x.hidden = false; });
          return false;
        } }
      ]);
    }
    document.getElementById('add').onclick = add;
    load();
  }
});
