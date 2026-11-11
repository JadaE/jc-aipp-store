/* JC-28 developer submission form: client-side validation, honeypot, and a POST to this site's Site Data collection.
   Everything the browser checks is checked again by the daily batch; this is only for a friendly form. */
(function () {
  var form = document.getElementById('submit-form');
  if (!form) return;
  var summary = document.getElementById('error-summary');
  var status = document.getElementById('form-status');
  var button = form.querySelector('button[type="submit"]');
  var HP = 'hp_website';
  var sent = false;

  function controls() { return Array.prototype.slice.call(form.querySelectorAll('input[name], select[name], textarea[name]')); }
  function labelOf(el) {
    var g = el.closest('[data-group]');
    if (g) return g.querySelector('legend').textContent.replace(/\s*\*\s*$/, '');
    var l = form.querySelector('label[for="' + el.id + '"]');
    return l ? l.textContent.replace(/\s*\*\s*$/, '') : el.name;
  }
  function errEl(el) { var g = el.closest('[data-group]'); return document.getElementById((g ? g.id : el.id) + '-err'); }
  function setError(el, msg) {
    var e = errEl(el), g = el.closest('[data-group]');
    (g ? g.querySelectorAll('input') : [el]).forEach(function (x) { if (msg) x.setAttribute('aria-invalid', 'true'); else x.removeAttribute('aria-invalid'); });
    if (e) { e.textContent = msg || ''; e.hidden = !msg; }
  }
  function isHttps(v) { try { var u = new URL(v); return u.protocol === 'https:' && !!u.hostname && u.hostname.indexOf('.') > 0; } catch (e) { return false; } }

  function check(el) {
    var v = el.type === 'checkbox' ? el.checked : el.value.trim();
    if (el.closest('[data-group]')) {
      var any = form.querySelectorAll('input[name="' + el.name + '"]:checked').length;
      return any ? '' : 'Choose at least one platform.';
    }
    if (el.type === 'checkbox') return el.required && !v ? 'Please tick this box to continue.' : '';
    var pair = el.getAttribute('data-pairs-with');
    if (!v) {
      if (el.required) return 'This field is required.';
      if (pair && form.elements[pair] && form.elements[pair].value.trim()) return 'Add alt text for this screenshot.';
      return '';
    }
    var min = +el.getAttribute('minlength') || 0, max = +el.getAttribute('maxlength') || 0;
    if (min && v.length < min) return 'Use at least ' + min + ' characters.';
    if (max && v.length > max) return 'Use ' + max + ' characters or fewer.';
    if (el.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v)) return 'Enter an email address like name@example.com.';
    if (el.type === 'url') {
      if (!isHttps(v)) return 'Enter a full https:// link.';
      if (el.name !== 'icon_url' && !/^shot\d_url$/.test(el.name) && /\.apk(?:[?#]|$)/i.test(v)) return 'Link to your release page, not straight to the .apk file.';
    }
    var p = el.getAttribute('data-pattern');
    if (p && !new RegExp(p).test(v)) return el.name === 'version' ? 'Use numbers like 1.2.0.' : el.name === 'repo_url' ? 'Use https://github.com/your-handle/your-app.' : el.name === 'github_handle' ? 'Use your GitHub handle, letters, numbers and dashes only.' : 'Check the format of this field.';
    if (el.name === 'about' && v.split(/\n\s*\n/).filter(Boolean).length > 3) return 'Use 3 paragraphs or fewer.';
    if (el.name === 'whats_new' && v.split('\n').filter(function (l) { return l.trim(); }).length > 5) return 'Use 5 bullets or fewer.';
    if (el.name === 'repo_url') {
      var h = form.elements.github_handle && form.elements.github_handle.value.trim().toLowerCase();
      var m = v.match(/^https:\/\/github\.com\/([^/]+)\//i);
      if (h && m && m[1].toLowerCase() !== h) return 'The repo must belong to the GitHub handle above.';
    }
    return '';
  }

  function collect() {
    var data = { form_version: +form.getAttribute('data-form-version') || 1 };
    controls().forEach(function (el) {
      if (el.name === HP) return;
      if (el.closest('[data-group]')) return;
      if (el.type === 'checkbox') { data[el.name] = el.checked; return; }
      var v = el.value.trim();
      if (v) data[el.name] = v;
    });
    var plats = Array.prototype.map.call(form.querySelectorAll('[data-group] input:checked'), function (x) { return x.value; });
    if (plats.length) data.platforms = plats.join(',');
    return data;
  }

  function uuid() { try { return crypto.randomUUID(); } catch (e) { return 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2); } }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    if (sent) return;
    // Honeypot: a person never sees this field. If it is filled, act as if it worked and send nothing.
    if (form.elements[HP] && form.elements[HP].value) { status.textContent = 'Thanks! Your app was submitted.'; form.reset(); return; }
    var seen = {}, problems = [];
    controls().forEach(function (el) {
      if (el.name === HP) return;
      var key = el.closest('[data-group]') ? el.name : el.id;
      if (seen[key]) return; seen[key] = true;
      var msg = check(el);
      setError(el, msg);
      if (msg) problems.push({ el: el, msg: msg });
    });
    var list = summary.querySelector('ul');
    list.textContent = '';
    if (problems.length) {
      problems.forEach(function (p) {
        var li = document.createElement('li'), a = document.createElement('a');
        var target = p.el.closest('[data-group]') ? p.el.closest('[data-group]').querySelector('input') : p.el;
        a.href = '#' + target.id; a.textContent = labelOf(p.el) + ': ' + p.msg;
        a.addEventListener('click', function (e) { e.preventDefault(); target.focus(); });
        li.appendChild(a); list.appendChild(li);
      });
      summary.hidden = false; summary.focus();
      status.textContent = '';
      return;
    }
    summary.hidden = true;
    var data = collect();
    var body = JSON.stringify(data);
    var maxBytes = +form.getAttribute('data-max-bytes') || 16384;
    if (new Blob([body]).size > maxBytes) { status.textContent = 'This submission is too long. Please shorten the About or What\'s new text.'; return; }
    button.disabled = true;
    status.textContent = 'Sending…';
    fetch(form.getAttribute('data-endpoint'), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'Idempotency-Key': uuid() },
      body: body,
    }).then(function (res) {
      if (res.ok) { sent = true; form.reset(); status.textContent = 'Thanks! Your app was submitted. You will get an email with your app ID after review.'; return; }
      button.disabled = false;
      if (res.status === 429) status.textContent = 'Too many submissions from this connection. Please try again in an hour.';
      else status.textContent = 'Something went wrong (' + res.status + '). Please check the fields and try again.';
    }).catch(function () { button.disabled = false; status.textContent = 'Could not reach the store. Please try again later.'; });
  });
})();
