(function () {
  var next = AP.qs('next');
  if (!next || next.charAt(0) !== '/' || next.charAt(1) === '/') next = '/dashboard.html';
  // Already signed in? Go straight in.
  fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { if (r.ok) location.replace(next); });
  var f = document.getElementById('f'), err = document.getElementById('err'), go = document.getElementById('go');
  document.getElementById('supportBtn').onclick = function () { AP.openSupport(null); };
  document.getElementById('supportLink').onclick = function () { AP.openSupport(null); };

  // Accounts listed on the sign-in page. One click signs in, unless the administrator chose
  // "must type their password": then the click fills in the email and asks for the password.
  AP.api('GET', '/api/auth/demo-accounts').then(function (j) {
    if (!j.enabled || !j.accounts.length) return;
    var list = document.getElementById('demoList');
    list.innerHTML = j.accounts.map(function (a) {
      var initial = String(a.name || '?').trim().charAt(0).toUpperCase();
      return '<button type="button" class="account' + (a.needsPassword ? ' needs-password' : '') + '" data-email="' + AP.esc(a.email) + '" data-name="' + AP.esc(a.name) + '"' + (a.needsPassword ? ' data-pw="1"' : '') + ' title="' + AP.esc(a.blurb || '') + '">' +
        '<span class="avatar role-' + AP.esc(a.role) + '">' + AP.esc(initial) + '</span>' +
        '<span class="account-who"><strong>' + AP.esc(a.name) + '</strong><small>' + AP.esc(a.email) + '</small>' + (a.needsPassword ? '<small class="needs-pw">Password required</small>' : '') + '</span>' +
        '<span class="pill plain account-role">' + AP.esc(a.roleLabel) + '</span></button>';
    }).join('');
    document.getElementById('demo').hidden = false;
    list.querySelectorAll('.account').forEach(function (b) {
      b.onclick = function () {
        err.hidden = true;
        if (b.dataset.pw) {
          list.querySelectorAll('.account').forEach(function (x) { x.classList.toggle('selected', x === b); });
          document.getElementById('email').value = b.dataset.email;
          var note = document.getElementById('pwNote');
          note.textContent = 'Enter the password for ' + b.dataset.name + ' to sign in.'; note.hidden = false;
          var pw = document.getElementById('pw'); pw.value = ''; pw.focus();
          pw.scrollIntoView({ behavior: 'smooth', block: 'center' });
          return;
        }
        list.querySelectorAll('.account').forEach(function (x) { x.disabled = true; });
        b.classList.add('busy');
        AP.api('POST', '/api/auth/demo', { email: b.dataset.email }).then(function () { location.replace(next); })
          .catch(function (e2) { err.textContent = e2.message; err.hidden = false; list.querySelectorAll('.account').forEach(function (x) { x.disabled = false; }); b.classList.remove('busy'); });
      };
    });
  }).catch(function () {});

  f.addEventListener('submit', function (e) {
    e.preventDefault();
    err.hidden = true;
    var email = document.getElementById('email').value.trim(), pw = document.getElementById('pw').value;
    if (!email || !pw) { err.textContent = 'Enter your email and password.'; err.hidden = false; return; }
    go.disabled = true; go.textContent = 'Signing in…';
    AP.api('POST', '/api/auth/login', { email: email, password: pw }).then(function () {
      location.replace(next);
    }).catch(function (e2) {
      err.textContent = e2.message; err.hidden = false; go.disabled = false; go.textContent = 'Sign in';
    });
  });
})();
