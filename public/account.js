AP.boot({
  title: 'Account', nav: null,
  render: function (me, main) {
    var E = AP.esc;
    main.innerHTML =
      '<div class="page-head"><div><h1>Account</h1><div class="sub">' + E(me.name) + ' · ' + E(me.email) + ' · ' + E(me.roleLabel) + '</div></div></div>' +
      '<form class="card card-pad form-grid" id="f" style="max-width:460px" novalidate><h2>Change password</h2>' +
      '<label class="field">Current password<input type="password" id="cur" autocomplete="current-password"></label>' +
      '<label class="field">New password<span class="hint">At least 10 characters</span><input type="password" id="nxt" autocomplete="new-password"></label>' +
      '<label class="field">Repeat new password<input type="password" id="nxt2" autocomplete="new-password"></label>' +
      '<div class="alert bad" id="err" hidden></div><button class="btn primary" type="submit">Change password</button></form>';
    document.getElementById('f').addEventListener('submit', function (e) {
      e.preventDefault();
      var err = document.getElementById('err'); err.hidden = true;
      var n = document.getElementById('nxt').value;
      if (n !== document.getElementById('nxt2').value) { err.textContent = 'The new passwords do not match.'; err.hidden = false; return; }
      AP.api('POST', '/api/account/password', { current: document.getElementById('cur').value, next: n })
        .then(function () { AP.toast('Password changed'); e.target.reset(); })
        .catch(function (x) { err.textContent = x.message; err.hidden = false; });
    });
  }
});
