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
              '<td data-label="Sign-in page">' + (u.quickSignIn ? '<span class="pill plain info">One-click</span>' : '<span class="muted small">Password only</span>') + '</td>' +
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

    function add() {
      AP.modal('Add user', '<div class="form-grid"><label class="field">Name<input type="text" id="u-name"></label><label class="field">Email<input type="email" id="u-email"></label>' +
        '<label class="field">Role' + roleSelect('intake') + '</label>' +
        '<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="u-quick" checked> Show on the sign-in page (one-click sign-in)</label>' +
        '<label class="field">Password<span class="hint">Optional with one-click sign-in. At least 10 characters; they can change it under Account.</span><input type="text" id="u-pw" autocomplete="off"></label>' +
        '<div class="alert bad" id="u-err" hidden></div></div>', [
        { label: 'Cancel' },
        { label: 'Add user', primary: true, onClick: function (back, close) {
          var err = back.querySelector('#u-err');
          AP.api('POST', '/api/users', { name: back.querySelector('#u-name').value, email: back.querySelector('#u-email').value, role: back.querySelector('#u-role').value, password: back.querySelector('#u-pw').value, quickSignIn: back.querySelector('#u-quick').checked })
            .then(function () { close(); AP.toast('User added'); load(); })
            .catch(function (e) { err.textContent = e.message; err.hidden = false; });
          return false;
        } }
      ]);
    }

    function edit(u) {
      var self = u.email === me.email;
      AP.modal('Edit ' + u.name, '<div class="form-grid"><div class="small muted wrap-any">' + E(u.email) + '</div><label class="field">Name<input type="text" id="u-name" value="' + E(u.name) + '"></label>' +
        '<label class="field">Role' + roleSelect(u.role) + (self ? '<span class="hint">You cannot remove your own administrator role.</span>' : '') + '</label>' +
        '<label class="field">New password<span class="hint">Leave empty to keep the current one. Changing it signs them out.</span><input type="text" id="u-pw" autocomplete="off"></label>' +
        '<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="u-quick"' + (u.quickSignIn ? ' checked' : '') + '> Show on the sign-in page (one-click sign-in)</label>' +
        (self ? '<div class="small muted">You cannot delete or deactivate your own account.</div>' : '<label style="display:flex;gap:8px;align-items:center"><input type="checkbox" id="u-active"' + (u.active ? ' checked' : '') + '> Active (can sign in)</label>') +
        '<div class="alert bad" id="u-err" hidden></div></div>', [
        { label: 'Cancel' },
        { label: 'Save', primary: true, onClick: function (back, close) {
          var b = { name: back.querySelector('#u-name').value, role: back.querySelector('#u-role').value };
          var pw = back.querySelector('#u-pw').value; if (pw) b.password = pw;
          var act = back.querySelector('#u-active'); if (act) b.active = act.checked;
          b.quickSignIn = back.querySelector('#u-quick').checked;
          AP.api('PATCH', '/api/users/' + encodeURIComponent(u.email), b)
            .then(function () { close(); AP.toast('Saved'); load(); })
            .catch(function (e) { var err = back.querySelector('#u-err'); err.textContent = e.message; err.hidden = false; });
          return false;
        } }
      ]);
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
