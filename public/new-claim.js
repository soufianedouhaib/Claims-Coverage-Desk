AP.boot({
  title: 'New claim', nav: 'new', perm: 'submit',
  render: function (me, main) {
    var E = AP.esc;
    var MAX = 10 * 1024 * 1024;
    var SLOTS = [
      { key: 'fnol', title: 'Claim notification (FNOL)', hint: 'The first notice of loss form, PDF', accept: '.pdf' },
      { key: 'schedule', title: 'Policy schedule or certificate', hint: 'Shows the insured, period, covers, sums insured and excess, PDF', accept: '.pdf' },
      { key: 'wording', title: 'Policy wording or PDS', hint: 'The full policy terms used to interpret cover, PDF', accept: '.pdf' }
    ];
    var picked = { fnol: null, schedule: null, wording: null, evidence: [] };
    var icon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';

    main.innerHTML =
      '<div class="page-head"><div><div class="crumb"><a href="/claims.html">Claims</a> / New</div><h1>Submit a claim for coverage assessment</h1>' +
      '<div class="sub">Add the three documents. The assessment reads them, checks the policy, interprets the wording and proposes a coverage position for a handler to confirm.</div></div></div>' +
      '<section class="card samples" id="samples" aria-labelledby="samplesTitle"><div class="card-head"><div><h2 id="samplesTitle">Samples</h2>' +
      '<div class="small muted">Complete claim packs, each showing a different route. One click uploads all the documents and starts the assessment.</div></div>' +
      '<div class="route-legend">' + AP.routeChip('quick') + AP.routeChip('detailed') + '</div></div>' +
      '<div class="card-body"><div class="sample-grid" id="sampleGrid"><div class="muted small">Loading samples…</div></div></div></section>' +
      '<form id="f" class="split" novalidate>' +
      '<div class="stack">' +
      '<div class="card card-pad form-grid"><h2>Documents</h2>' +
      SLOTS.map(function (s) {
        return '<div class="drop" data-slot="' + s.key + '"><div class="icon">' + icon + '</div><div class="body"><div class="title req">' + s.title + '</div><div class="file" id="name-' + s.key + '">' + s.hint + '</div></div>' +
          '<label class="btn small">Choose<input type="file" accept="' + s.accept + '" data-input="' + s.key + '"></label></div>';
      }).join('') +
      '</div>' +
      '<div class="card card-pad form-grid"><div><h2>Supporting evidence</h2><div class="small muted">Optional. Photos, invoices, repair quotes. Up to 10 MB each.</div></div>' +
      '<div class="drop" data-slot="evidence"><div class="icon">' + icon + '</div><div class="body"><div class="title">Add evidence files</div><div class="file">Drop files here or choose them</div></div>' +
      '<label class="btn small">Choose<input type="file" multiple accept=".pdf,.png,.jpg,.jpeg,.heic,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt,.eml,.msg" data-input="evidence"></label></div>' +
      '<ul class="filelist" id="evList"></ul></div>' +
      '</div>' +
      '<div class="stack sticky">' +
      '<div class="card card-pad form-grid"><h2>Details</h2>' +
      '<label class="field">Title<span class="hint">How this claim appears in the list until the claim reference is read. Optional.</span><input type="text" id="title" maxlength="120" placeholder="e.g. Burst pipe, kitchen"></label>' +
      '<label class="field">Notes for the handler<span class="hint">Optional</span><textarea id="notes" maxlength="2000"></textarea></label>' +
      '<div class="sample-badge small" id="sampleBadge" hidden></div>' +
      '<div class="alert bad" id="err" role="alert" hidden></div>' +
      '<div id="prog" hidden><div class="small" id="progText">Uploading…</div><div class="bar" style="margin-top:6px"><span id="progBar" style="width:0%"></span></div></div>' +
      '<button class="btn primary" type="submit" id="go">Start assessment</button>' +
      '<p class="small muted" style="margin:0">The assessment proposes a coverage position only. It never authorises payment; a claims handler confirms every decision.</p>' +
      '</div></div></form>';

    var err = document.getElementById('err');
    function showErr(m) { err.textContent = m; err.hidden = !m; }

    var currentSample = null;
    function setFile(slot, files, keepSample) {
      showErr('');
      if (!keepSample) { currentSample = null; markSample(); }
      var list = Array.prototype.slice.call(files || []);
      var bad = list.filter(function (f) { return f.size > MAX; });
      if (bad.length) showErr(bad.map(function (f) { return f.name; }).join(', ') + ' is larger than 10 MB.');
      list = list.filter(function (f) { return f.size <= MAX && f.size > 0; });
      if (slot === 'evidence') { picked.evidence = picked.evidence.concat(list); renderEvidence(); return; }
      if (!list.length) return;
      var f = list[0];
      if (!/\.pdf$/i.test(f.name)) { showErr(f.name + ' is not a PDF.'); return; }
      picked[slot] = f;
      document.getElementById('name-' + slot).textContent = f.name + ' · ' + size(f.size);
      document.querySelector('.drop[data-slot="' + slot + '"]').classList.add('has');
    }
    function size(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
    function renderEvidence() {
      var ul = document.getElementById('evList');
      ul.innerHTML = picked.evidence.map(function (f, i) {
        return '<li><span class="n">' + E(f.name) + '</span><span class="small muted">' + size(f.size) + '</span><button type="button" data-rm="' + i + '" aria-label="Remove ' + E(f.name) + '">Remove</button></li>';
      }).join('');
      ul.querySelectorAll('[data-rm]').forEach(function (b) { b.onclick = function () { picked.evidence.splice(Number(b.dataset.rm), 1); currentSample = null; markSample(); renderEvidence(); }; });
    }

    main.querySelectorAll('input[type=file]').forEach(function (inp) {
      inp.addEventListener('change', function () { setFile(inp.dataset.input, inp.files); inp.value = ''; });
    });
    main.querySelectorAll('.drop').forEach(function (d) {
      d.addEventListener('dragover', function (e) { e.preventDefault(); d.classList.add('over'); });
      d.addEventListener('dragleave', function () { d.classList.remove('over'); });
      d.addEventListener('drop', function (e) { e.preventDefault(); d.classList.remove('over'); setFile(d.dataset.slot, e.dataTransfer.files); });
    });

    // Upload one file: straight to storage when the browser allows it, otherwise through the server.
    function upload(file) {
      return AP.api('POST', '/api/uploads/presign', { name: file.name, size: file.size, type: file.type }).then(function (p) {
        return fetch(p.presignedUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file })
          .then(function (r) { if (!r.ok) throw new Error('direct upload ' + r.status); return { name: file.name, size: file.size, fileUrl: p.fileUrl }; })
          .catch(function () { return viaServer(file); });
      });
    }
    function viaServer(file) {
      if (file.size > 4.3 * 1024 * 1024) return Promise.reject(new Error(file.name + ' could not be uploaded directly, and is too large (over 4 MB) to send through the server.'));
      return fetch('/api/uploads/direct', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name), 'x-file-type': file.type || 'application/octet-stream' }, body: file })
        .then(function (r) { return r.text().then(function (t) { var j = null; try { j = JSON.parse(t); } catch (e) {} if (!r.ok) throw new Error((j && j.error) || ('Upload failed (' + r.status + ').')); return { name: file.name, size: file.size, fileUrl: j.fileUrl }; }); });
    }

    document.getElementById('f').addEventListener('submit', function (e) {
      e.preventDefault();
      showErr('');
      var miss = SLOTS.filter(function (s) { return !picked[s.key]; }).map(function (s) { return s.title; });
      if (miss.length) { showErr('Please add: ' + miss.join(', ') + '.'); return; }
      var go = document.getElementById('go');
      go.disabled = true;
      var all = [['fnol', picked.fnol], ['schedule', picked.schedule], ['wording', picked.wording]].concat(picked.evidence.map(function (f) { return ['evidence', f]; }));
      var done = 0, out = { evidence: [] };
      var prog = document.getElementById('prog'), pt = document.getElementById('progText'), pb = document.getElementById('progBar');
      prog.hidden = false;
      function step() { pt.textContent = 'Uploading documents (' + done + ' of ' + all.length + ')…'; pb.style.width = Math.round(done / (all.length + 1) * 100) + '%'; }
      step();
      var chain = Promise.resolve();
      all.forEach(function (pair) {
        chain = chain.then(function () { return upload(pair[1]); }).then(function (ref) {
          if (pair[0] === 'evidence') out.evidence.push(ref); else out[pair[0]] = ref;
          done++; step();
        });
      });
      chain.then(function () {
        pt.textContent = 'Starting the assessment…'; pb.style.width = '92%';
        return AP.api('POST', '/api/claims', { title: document.getElementById('title').value, notes: document.getElementById('notes').value, files: out, sampleId: currentSample ? currentSample.id : null });
      }).then(function (j) {
        pb.style.width = '100%';
        location.href = '/claim.html?id=' + encodeURIComponent(j.claim.id) + '&new=1';
      }).catch(function (e2) {
        showErr(e2.message); go.disabled = false; prog.hidden = true;
        document.querySelectorAll('#sampleGrid button').forEach(function (x) { x.disabled = false; if (x.dataset.run) x.textContent = 'Run sample'; });
      });
    });

    // ---------- samples ----------
    var samples = [];
    function markSample() {
      document.querySelectorAll('.sample-card').forEach(function (c) { c.classList.toggle('selected', !!currentSample && c.dataset.id === currentSample.id); });
      var badge = document.getElementById('sampleBadge');
      if (badge) { badge.hidden = !currentSample; if (currentSample) badge.innerHTML = 'Using the sample <strong>' + E(currentSample.title) + '</strong> ' + AP.routeChip(currentSample.route); }
    }
    function fetchFile(s, name) {
      return fetch('/samples/' + s.id + '/' + encodeURIComponent(name)).then(function (r) {
        if (!r.ok) throw new Error('Could not load the sample file ' + name + '.');
        return r.blob();
      }).then(function (b) { return new File([b], name, { type: 'application/pdf' }); });
    }
    function loadSample(s) {
      var names = [s.files.fnol, s.files.schedule, s.files.wording].concat(s.files.evidence);
      return Promise.all(names.map(function (n) { return fetchFile(s, n); })).then(function (fs) {
        picked.evidence = [];
        setFile('fnol', [fs[0]], true); setFile('schedule', [fs[1]], true); setFile('wording', [fs[2]], true);
        setFile('evidence', fs.slice(3), true);
        document.getElementById('title').value = s.title;
        currentSample = s; markSample();
      });
    }
    function sampleCard(s) {
      var base = '/samples/' + s.id + '/';
      var files = [['Claim notification', s.files.fnol], ['Policy schedule', s.files.schedule], ['Policy wording', s.files.wording]]
        .concat(s.files.evidence.map(function (n) { return ['Evidence', n]; }));
      return '<article class="sample-card route-' + s.route + '" data-id="' + E(s.id) + '">' +
        '<div class="sample-top"><span class="sample-num">Sample</span><span class="small muted">' + E(s.claimReference) + '</span></div>' +
        '<h3>' + E(s.title) + '</h3><div class="small muted">' + E(s.place) + ' · ' + E(s.peril) + '</div>' +
        '<div class="sample-route">' + AP.routeChip(s.route, true) + '</div>' +
        '<dl class="sample-facts"><dt>Built to show</dt><dd>' + AP.decisionPill(s.expectedDecision) + '</dd><dt>Claimed</dt><dd>' + E(s.claimed) + '</dd><dt>If confirmed</dt><dd>' + E(s.expectedSettlement) + '</dd></dl>' +
        '<p class="small muted" style="margin:6px 0 0">The assessment decides for itself and can ask for more information first.</p>' +
        '<p class="small sample-why">' + E(s.why) + '</p>' +
        '<details class="sample-more"><summary>What the assessment should find</summary><ul class="plain small">' + s.checks.map(function (c) { return '<li>' + E(c) + '</li>'; }).join('') + '</ul>' +
        '<div class="small muted" style="margin:8px 0 4px">Documents (' + files.length + ')</div><ul class="plain small">' +
        files.map(function (f) { return '<li><a href="' + base + encodeURIComponent(f[1]) + '" target="_blank" rel="noopener">' + E(f[0]) + '</a> <span class="muted wrap-any">' + E(f[1]) + '</span></li>'; }).join('') + '</ul></details>' +
        '<div class="sample-actions"><button type="button" class="btn primary small" data-run="' + E(s.id) + '">Run sample</button><button type="button" class="btn small" data-fill="' + E(s.id) + '">Fill the form</button></div>' +
        '</article>';
    }
    fetch('/samples/samples.json', { cache: 'no-cache' }).then(function (r) { return r.json(); }).then(function (j) {
      samples = j.samples || [];
      var grid = document.getElementById('sampleGrid');
      grid.innerHTML = samples.map(sampleCard).join('');
      function find(id) { return samples.find(function (x) { return x.id === id; }); }
      grid.querySelectorAll('[data-fill]').forEach(function (b) {
        b.onclick = function () {
          b.disabled = true;
          loadSample(find(b.dataset.fill)).then(function () { AP.toast('Sample loaded. Check the documents, then start the assessment.'); document.getElementById('f').scrollIntoView({ behavior: 'smooth' }); })
            .catch(function (e) { showErr(e.message); }).finally(function () { b.disabled = false; });
        };
      });
      grid.querySelectorAll('[data-run]').forEach(function (b) {
        b.onclick = function () {
          grid.querySelectorAll('button').forEach(function (x) { x.disabled = true; });
          b.textContent = 'Starting…';
          loadSample(find(b.dataset.run)).then(function () {
            document.getElementById('prog').scrollIntoView({ behavior: 'smooth', block: 'center' });
            document.getElementById('f').requestSubmit();
          }).catch(function (e) {
            showErr(e.message); grid.querySelectorAll('button').forEach(function (x) { x.disabled = false; }); b.textContent = 'Run sample';
          });
        };
      });
    }).catch(function () { document.getElementById('samples').hidden = true; });
  }
});
