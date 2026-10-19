(function () {
  var next = AP.qs('next');
  if (!next || next.charAt(0) !== '/' || next.charAt(1) === '/') next = '/dashboard.html';
  // Already signed in? Go straight in.
  fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { if (r.ok) location.replace(next); });
  var f = document.getElementById('f'), err = document.getElementById('err'), go = document.getElementById('go');

  // One-click demo accounts (one per role), if the administrator has not removed them.
  AP.api('GET', '/api/auth/demo-accounts').then(function (j) {
    if (!j.enabled || !j.accounts.length) return;
    var list = document.getElementById('demoList');
    list.innerHTML = j.accounts.map(function (a) {
      return '<button type="button" class="demo-btn" data-email="' + AP.esc(a.email) + '"><span class="demo-role">' + AP.esc(a.roleLabel) + '</span>' +
        '<span class="demo-blurb">' + AP.esc(a.blurb) + '</span></button>';
    }).join('');
    document.getElementById('demo').hidden = false;
    list.querySelectorAll('.demo-btn').forEach(function (b) {
      b.onclick = function () {
        err.hidden = true;
        list.querySelectorAll('.demo-btn').forEach(function (x) { x.disabled = true; });
        b.querySelector('.demo-blurb').textContent = 'Signing in…';
        AP.api('POST', '/api/auth/demo', { email: b.dataset.email }).then(function () { location.replace(next); })
          .catch(function (e2) { err.textContent = e2.message; err.hidden = false; list.querySelectorAll('.demo-btn').forEach(function (x) { x.disabled = false; }); });
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
