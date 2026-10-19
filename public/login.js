(function () {
  var next = AP.qs('next');
  if (!next || next.charAt(0) !== '/' || next.charAt(1) === '/') next = '/dashboard.html';
  // Already signed in? Go straight in.
  fetch('/api/me', { credentials: 'same-origin' }).then(function (r) { if (r.ok) location.replace(next); });
  var f = document.getElementById('f'), err = document.getElementById('err'), go = document.getElementById('go');
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
