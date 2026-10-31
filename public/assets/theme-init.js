/* 首屏渲染前确定主题，避免闪白/闪黑。
   必须在 <head> 里同步加载，不要加 defer/async。 */
(function () {
  'use strict';
  var root = document.documentElement;
  var theme = 'dark';
  try {
    var saved = localStorage.getItem('ys_theme');
    if (saved === 'light' || saved === 'dark') {
      theme = saved;
    } else if (window.matchMedia &&
      window.matchMedia('(prefers-color-scheme: light)').matches) {
      theme = 'light';
    }
  } catch (e) { /* 隐私模式：用默认 */ }

  root.setAttribute('data-theme', theme);

  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#f6f3ec' : '#07070a');
})();