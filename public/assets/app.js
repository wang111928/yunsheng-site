/* ============================================================
   云声 Yunsheng — 官网逻辑 v2
   数据源优先级：
     1) 同源快照 data/releases.json （update-releases.mjs 生成，最稳）
     2) 直连 api.github.com （快照缺失时兜底）
     3) HTML 里写死的静态文案 （两者都失败时，页面照常可读）
   另含：滚动进度条、入场动画、唱片倾斜微交互
   ============================================================ */

(function () {
  'use strict';

  var OWNER = 'wang111928';
  var REPO = 'yunsheng-player';
  var LOCAL = 'data/releases.json';
  var REMOTE = 'https://api.github.com/repos/' + OWNER + '/' + REPO + '/releases?per_page=6';
  var CACHE_KEY = 'ys_rel_v2';
  var TTL = 30 * 60 * 1000;

  var $ = function (id) { return document.getElementById(id); };

  /* ---------------- 工具 ---------------- */

  function fmtDate(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function fmtSize(bytes) {
    if (!bytes || bytes < 0) return '';
    return (bytes / 1000000).toFixed(2) + ' MB'; // 与发布说明的十进制 MB 对齐
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function inline(s) {
    return s
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener">$1</a>');
  }

  /* 极简 Markdown：标题→粗体段，列表→带红线的 li，代码块→pre */
  function md(src) {
    if (!src) return '';
    var lines = esc(src).split(/\r?\n/);
    var out = [];
    var inList = false;
    var inCode = false;

    function closeList() {
      if (inList) { out.push('</ul>'); inList = false; }
    }

    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].replace(/\s+$/, '');

      if (/^```/.test(line)) {
        closeList();
        out.push(inCode ? '</code></pre>' : '<pre><code>');
        inCode = !inCode;
        continue;
      }
      if (inCode) { out.push(line); continue; }
      if (!line.trim()) { closeList(); continue; }

      var h = line.match(/^#{1,6}\s+(.*)$/);
      if (h) { closeList(); out.push('<p><strong>' + inline(h[1]) + '</strong></p>'); continue; }

      var li = line.match(/^\s*[-*+]\s+(.*)$/);
      if (li) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push('<li>' + inline(li[1]) + '</li>');
        continue;
      }

      closeList();
      out.push('<p>' + inline(line) + '</p>');
    }
    closeList();
    if (inCode) out.push('</code></pre>');
    return out.join('\n');
  }

  /* ---------------- 归一化：本地快照 / GitHub 原生两种格式 ---------------- */

  function normalize(payload) {
    var arr = Array.isArray(payload)
      ? payload
      : (payload && Array.isArray(payload.releases) ? payload.releases : []);

    return arr
      .filter(function (r) { return r && !r.draft; })
      .map(function (r) {
        var apk = r.apk || null;
        if (!apk && Array.isArray(r.assets)) {
          for (var i = 0; i < r.assets.length; i++) {
            if (/\.apk$/i.test(r.assets[i].name)) {
              apk = {
                name: r.assets[i].name,
                url: r.assets[i].browser_download_url,
                size: r.assets[i].size || 0
              };
              break;
            }
          }
        }
        var body = r.body || '';
        var sha = r.sha256 ||
          (body.match(/SHA-?256[：:]\s*`?([A-Fa-f0-9]{64})`?/) || [])[1] || null;

        return {
          tag: (r.tag || r.tag_name || '').replace(/^v/i, ''),
          name: r.name || '',
          published_at: r.published_at || '',
          html_url: r.html_url || ('https://github.com/' + OWNER + '/' + REPO + '/releases'),
          prerelease: !!r.prerelease,
          body: body,
          apk: apk,
          sha: sha
        };
      });
  }

  function latestOf(list) {
    if (!list.length) return null;
    for (var i = 0; i < list.length; i++) {
      if (!list[i].prerelease) return list[i];
    }
    return list[0];
  }

  /* ---------------- 渲染 ---------------- */

  function applyLatest(rel) {
    if (!rel) return;
    var url = rel.apk ? rel.apk.url : rel.html_url;

    ['dl-main', 'dl-bottom', 'nav-dl'].forEach(function (id) {
      var el = $(id);
      if (el) el.href = url;
    });

    var set = function (id, txt) {
      var el = $(id);
      if (el && txt) el.textContent = txt;
    };

    set('pill-ver', rel.tag ? 'v' + rel.tag : '');
    set('dl-ver', 'v' + (rel.tag || ''));
    set('meta-ver', rel.tag);
    set('p-ver', rel.tag);
    set('p-date', fmtDate(rel.published_at));

    if (rel.apk && rel.apk.size) {
      set('meta-size', fmtSize(rel.apk.size));
      set('p-size', fmtSize(rel.apk.size));
    }

    var sha = $('p-sha');
    if (sha) {
      if (rel.sha) {
        sha.textContent = rel.sha.slice(0, 12) + '…' + rel.sha.slice(-8);
        sha.title = rel.sha;
      } else {
        sha.textContent = '见发布页';
      }
    }

    var y = $('year');
    var year = new Date(rel.published_at).getFullYear();
    if (y && year) y.textContent = String(year);
  }

  function renderLog(list) {
    var box = $('releases');
    if (!box) return;

    if (!list || !list.length) {
      box.innerHTML = '<div class="log-empty">暂时读不到发布记录，请到 ' +
        '<a href="https://github.com/' + OWNER + '/' + REPO + '/releases" target="_blank" ' +
        'rel="noopener" style="color:var(--red-2)">GitHub Releases</a> 查看更新。</div>';
      return;
    }

    box.innerHTML = list.slice(0, 5).map(function (r, i) {
      var html = md(r.body);
      var body = html.slice(0, 3800);
      if (html.length > 3800) {
        body += '<p style="color:var(--paper-4);font-size:12px">…完整说明见 GitHub 发布页</p>';
      }
      var tag = i === 0 ? '<span class="log-tag">LATEST</span>' : '';
      var folded = i > 0 ? ' is-collapsed' : '';
      var more = i > 0
        ? '<span class="log-more-btn">展开全文' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" ' +
          'stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg></span>'
        : '';
      return '' +
        '<article class="log' + folded + '">' +
        '  <div class="log-left">' +
        '    <span class="log-ver">v' + esc(r.tag) + '</span>' +
        '    <span class="log-date">' + fmtDate(r.published_at) + '</span>' +
        '    ' + tag +
        '  </div>' +
        '  <div>' +
        '    <h3 class="log-title">' + esc(r.name || ('云声 ' + r.tag)) + '</h3>' +
        '    <div class="log-body">' + body + '</div>' +
        '    ' + more +
        '  </div>' +
        '</article>';
    }).join('');

    // 折叠态点击展开（一次展开后不再折叠）
    Array.prototype.forEach.call(box.querySelectorAll('.log.is-collapsed'), function (el) {
      el.addEventListener('click', function () { el.classList.remove('is-collapsed'); });
    });
  }

  /* ---------------- 取数 ---------------- */

  function readCache() {
    try {
      var raw = localStorage.getItem(CACHE_KEY);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || !o.t || !o.d || !Array.isArray(o.d) || !o.d.length) return null;
      if (Date.now() - o.t > TTL) return null;
      return o.d;
    } catch (e) { return null; }
  }

  function writeCache(list) {
    try { localStorage.setItem(CACHE_KEY, JSON.stringify({ t: Date.now(), d: list })); }
    catch (e) { /* 隐私模式忽略 */ }
  }

  function getJSON(url) {
    return fetch(url, { headers: { Accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function paint(list) {
    var rels = normalize(list);
    if (!rels.length) throw new Error('empty');
    writeCache(rels);
    applyLatest(latestOf(rels));
    renderLog(rels);
  }

  function boot() {
    var cached = readCache();
    if (cached) {
      var c = normalize(cached);
      applyLatest(latestOf(c));
      renderLog(c);
      return;
    }

    getJSON(LOCAL)
      .then(paint)
      .catch(function () { return getJSON(REMOTE).then(paint); })
      .catch(function () {
        renderLog(null);
        var sha = $('p-sha');
        if (sha && sha.textContent === '读取中…') sha.textContent = '见发布页';
      });
  }

  /* ---------------- 滚动进度 ---------------- */

  function progressBar() {
    var bar = $('progress');
    if (!bar) return;
    var raf = 0;

    function update() {
      raf = 0;
      var h = document.documentElement.scrollHeight - window.innerHeight;
      var pct = h > 0 ? (window.scrollY / h) * 100 : 0;
      bar.style.width = Math.min(100, Math.max(0, pct)) + '%';
    }

    window.addEventListener('scroll', function () {
      if (!raf) raf = requestAnimationFrame(update);
    }, { passive: true });
    window.addEventListener('resize', update, { passive: true });
    update();
  }

  /* ---------------- 入场动画 ---------------- */

  function reveal() {
    var nodes = document.querySelectorAll('.rv');
    if (!('IntersectionObserver' in window)) {
      Array.prototype.forEach.call(nodes, function (n) { n.classList.add('in'); });
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          e.target.classList.add('in');
          io.unobserve(e.target);
        }
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.05 });
    Array.prototype.forEach.call(nodes, function (n) { io.observe(n); });
  }

  /* ---------------- 唱片随指针轻倾（桌面端） ---------------- */

  function vinylTilt() {
    var stage = document.querySelector('.vinyl-stage');
    if (!stage) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    // 倾斜加在舞台上（唱片本身有 rotate 动画，inline transform 会被动画覆盖）
    stage.addEventListener('pointermove', function (e) {
      var b = stage.getBoundingClientRect();
      var dx = (e.clientX - (b.left + b.width / 2)) / b.width;
      var dy = (e.clientY - (b.top + b.height / 2)) / b.height;
      stage.style.transform =
        'perspective(900px) rotateY(' + (dx * 6).toFixed(2) + 'deg) rotateX(' +
        (-dy * 6).toFixed(2) + 'deg) translateZ(0)';
    });

    stage.addEventListener('pointerleave', function () {
      stage.style.transform = '';
    });
  }

  /* ---------------- 主题切换 ---------------- */

  function themeToggle() {
    var btn = $('theme-btn');
    var root = document.documentElement;

    function syncMeta(theme) {
      var m = document.querySelector('meta[name="theme-color"]');
      if (m) m.setAttribute('content', theme === 'light' ? '#f6f3ec' : '#07070a');
    }

    if (btn) {
      btn.addEventListener('click', function () {
        var next = root.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
        root.setAttribute('data-theme', next);
        syncMeta(next);
        try { localStorage.setItem('ys_theme', next); } catch (e) { /* 忽略 */ }
      });
    }

    // 用户没手动选过时，跟着系统走
    var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: light)') : null;
    if (mq) {
      var follow = function (e) {
        var saved = null;
        try { saved = localStorage.getItem('ys_theme'); } catch (err) { /* 忽略 */ }
        if (saved) return;
        var t = e.matches ? 'light' : 'dark';
        root.setAttribute('data-theme', t);
        syncMeta(t);
      };
      if (mq.addEventListener) mq.addEventListener('change', follow);
      else if (mq.addListener) mq.addListener(follow);
    }

    // 页脚「跟随系统主题」：清掉手动选择，回到自动
    var followBtn = $('theme-follow');
    if (followBtn) {
      followBtn.addEventListener('click', function () {
        try { localStorage.removeItem('ys_theme'); } catch (e) { /* 忽略 */ }
        var t = (mq && mq.matches) ? 'light' : 'dark';
        root.setAttribute('data-theme', t);
        syncMeta(t);
        followBtn.textContent = '已跟随系统';
        setTimeout(function () { followBtn.textContent = '跟随系统主题'; }, 1800);
      });
    }
  }

  // 图廊：自动滚动 + 进度滑块（手动一碰就停）
  function shotsAuto() {
    var box = document.getElementById('shots');
    var track = document.getElementById('bar-track');
    var thumb = document.getElementById('bar-thumb');
    var btn = document.getElementById('bar-play');
    var txt = document.getElementById('bar-txt');
    var idxEl = document.getElementById('bar-idx');
    var capEl = document.getElementById('bar-cap');
    if (!box || !track || !thumb || !btn) return;

    var figs = [].slice.call(box.querySelectorAll('.shot'));
    if (!figs.length) return;

    var CAPS = figs.map(function (f) {
      var cap = f.querySelector('figcaption');
      return cap ? cap.textContent.replace(/^\s*\d+\s*/, '').trim() : '';
    });

    // 克隆一份放在后面，滚到一半时减掉，形成无缝循环
    figs.forEach(function (f) {
      var c = f.cloneNode(true);
      c.className = 'shot shot-clone';
      c.setAttribute('aria-hidden', 'true');
      var im = c.querySelector('img');
      if (im) { im.setAttribute('loading', 'eager'); im.setAttribute('alt', ''); }
      var a = c.querySelector('a');
      if (a) { a.removeAttribute('href'); a.setAttribute('tabindex', '-1'); }
      box.appendChild(c);
    });

    var half = 0, acc = 0, rafId = 0, last = 0, auto = false, visible = true, dragging = false;
    var SPEED = 0.034; // px 每毫秒，约 34px/s
    var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function pad(n) { return (n < 10 ? '0' : '') + n; }

    function measure() {
      half = box.scrollWidth / 2;
      paint();
    }

    function wrapScroll() {
      if (!half) return;
      if (box.scrollLeft >= half) box.scrollLeft -= half;
      else if (box.scrollLeft < 0) box.scrollLeft += half;
    }

    function paint() {
      if (!half) return;
      var span = half - box.clientWidth;
      if (span <= 0) span = half;
      var p = box.scrollLeft / span;
      if (p > 1) p = 1;
      if (p < 0) p = 0;
      var tw = track.clientWidth - thumb.offsetWidth;
      thumb.style.transform = 'translateX(' + (p * tw).toFixed(1) + 'px)';
      track.setAttribute('aria-valuenow', Math.round(p * 100));
      var i = Math.min(figs.length - 1, Math.round(p * (figs.length - 1)));
      if (idxEl) idxEl.textContent = pad(i + 1);
      if (capEl && CAPS[i] && capEl.textContent !== CAPS[i]) capEl.textContent = CAPS[i];
    }

    function tick(t) {
      if (!auto || !visible) { rafId = 0; return; }
      if (!last) last = t;
      var dt = Math.min(64, t - last);
      last = t;
      acc += SPEED * dt;
      if (acc >= 1) {
        var step = Math.floor(acc);
        acc -= step;
        box.scrollLeft += step;
      }
      wrapScroll();
      paint();
      rafId = requestAnimationFrame(tick);
    }

    function play() {
      if (rafId) return;
      auto = true;
      last = 0;
      acc = 0;
      btn.setAttribute('aria-pressed', 'true');
      if (txt) txt.textContent = '暂停';
      if (visible) rafId = requestAnimationFrame(tick);
    }

    function pause() {
      auto = false;
      last = 0;
      acc = 0;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
      btn.setAttribute('aria-pressed', 'false');
      if (txt) txt.textContent = '继续';
    }

    function halt() { if (auto) pause(); }

    box.addEventListener('pointerdown', halt);
    box.addEventListener('touchstart', halt, { passive: true });
    box.addEventListener('wheel', function (e) {
      if (Math.abs(e.deltaX) > 0.6) halt();
    }, { passive: true });
    box.addEventListener('scroll', paint, { passive: true });

    btn.addEventListener('click', function () {
      if (btn.getAttribute('aria-pressed') === 'true') pause(); else play();
    });

    function seekTo(clientX) {
      var r = track.getBoundingClientRect();
      var tw = track.clientWidth - thumb.offsetWidth;
      var p = (clientX - r.left - thumb.offsetWidth / 2) / tw;
      if (p < 0) p = 0;
      if (p > 1) p = 1;
      var span = half - box.clientWidth;
      if (span <= 0) span = half;
      box.scrollLeft = p * span;
      paint();
    }

    track.addEventListener('pointerdown', function (e) {
      dragging = true;
      halt();
      try { track.setPointerCapture(e.pointerId); } catch (err) {}
      seekTo(e.clientX);
    });
    track.addEventListener('pointermove', function (e) { if (dragging) seekTo(e.clientX); });
    track.addEventListener('pointerup', function (e) {
      dragging = false;
      try { track.releasePointerCapture(e.pointerId); } catch (err) {}
    });
    track.addEventListener('pointercancel', function () { dragging = false; });

    track.addEventListener('keydown', function (e) {
      var step = Math.round(box.clientWidth * 0.6);
      if (e.key === 'ArrowRight') { box.scrollLeft += step; halt(); paint(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft') { box.scrollLeft -= step; halt(); paint(); e.preventDefault(); }
      else if (e.key === 'Home') { box.scrollLeft = 0; halt(); paint(); e.preventDefault(); }
      else if (e.key === 'End') { box.scrollLeft = half - box.clientWidth; halt(); paint(); e.preventDefault(); }
    });

    window.addEventListener('resize', measure);
    if (window.ResizeObserver) new ResizeObserver(measure).observe(box);

    // 只在图廊进入视口时跑，滚走就停掉 rAF
    if (window.IntersectionObserver) {
      new IntersectionObserver(function (entries) {
        visible = entries[0].isIntersecting;
        if (!visible) {
          last = 0;
          if (rafId) cancelAnimationFrame(rafId);
          rafId = 0;
        } else if (auto && !rafId) {
          last = 0;
          rafId = requestAnimationFrame(tick);
        }
      }, { rootMargin: '180px' }).observe(box);
    }

    document.addEventListener('shotsonopen', halt);

    document.addEventListener('visibilitychange', function () {
      if (document.hidden) {
        if (rafId) cancelAnimationFrame(rafId);
        rafId = 0;
        last = 0;
      } else if (auto && visible && !rafId) {
        last = 0;
        rafId = requestAnimationFrame(tick);
      }
    });

    measure();

    if (reduced) {
      btn.setAttribute('aria-pressed', 'false');
      if (txt) txt.textContent = '自动滚动';
    } else {
      play();
    }
  }

  // 截图大图查看
  function shotLightbox() {
    var dlg = document.getElementById('lightbox');
    var img = document.getElementById('lb-img');
    var closeBtn = document.getElementById('lb-close');
    if (!dlg || !img || !dlg.showModal) return;

    var links = document.querySelectorAll('.shot-link');
    for (var i = 0; i < links.length; i++) {
      (function (a) {
        a.addEventListener('click', function (e) {
          e.preventDefault();
          var full = a.getAttribute('data-full') || a.getAttribute('href');
          var thumb = a.querySelector('img');
          img.src = full;
          img.alt = thumb ? thumb.getAttribute('alt') : '';
          document.dispatchEvent(new CustomEvent('shotsonopen'));
          dlg.showModal();
        });
      })(links[i]);
    }

    if (closeBtn) closeBtn.addEventListener('click', function () { dlg.close(); });

    dlg.addEventListener('click', function (e) {
      if (e.target === dlg) dlg.close();
    });

    dlg.addEventListener('close', function () { img.removeAttribute('src'); });
  }

  function start() {
    boot();
    reveal();
    progressBar();
    vinylTilt();
    themeToggle();
    shotLightbox();
    shotsAuto();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();