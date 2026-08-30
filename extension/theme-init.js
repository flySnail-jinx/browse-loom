/* Runs synchronously in <head> so stored appearance choices are applied
   before the body paints — avoids a flash of the default palette on reload. */
(function () {
  document.documentElement.dataset.theme = 'system';
  document.documentElement.dataset.background = 'mountain';
  document.documentElement.dataset.defaultWorkspace = 'tabs';
  try {
    var themes = ['system', 'white', 'material', 'cupertino', 'warm', 'midnight', 'arctic', 'forest', 'graphite', 'coast', 'plum', 'matcha', 'ember', 'lavender'];
    var t = localStorage.getItem('tab-out-theme');
    if (themes.indexOf(t) !== -1) document.documentElement.dataset.theme = t;
  } catch (e) { /* localStorage unavailable — fall back to default */ }

  try {
    var defaultWorkspace = localStorage.getItem('tab-out-default-workspace');
    if (defaultWorkspace === 'tabs' || defaultWorkspace === 'bookmarks') {
      document.documentElement.dataset.defaultWorkspace = defaultWorkspace;
    }
  } catch (e) { /* localStorage unavailable — fall back to tab management */ }

  try {
    var backgrounds = ['mountain', 'liquid-ether', 'light-rays', 'prism', 'static'];
    var background = localStorage.getItem('tab-out-background');
    if (backgrounds.indexOf(background) !== -1) {
      document.documentElement.dataset.background = background;
      document.documentElement.dataset.backgroundId = background;
    } else if (typeof background === 'string' && background.indexOf('user:') === 0) {
      document.documentElement.dataset.background = 'user-wallpaper-loading';
      document.documentElement.dataset.backgroundId = background;
    }
  } catch (e) { /* localStorage unavailable — fall back to default */ }

  try {
    var storedCardOpacity = localStorage.getItem('tab-out-card-opacity');
    var cardOpacity = storedCardOpacity === null ? 60 : Number(storedCardOpacity);
    if (!Number.isFinite(cardOpacity)) cardOpacity = 60;
    cardOpacity = Math.min(100, Math.max(40, Math.round(cardOpacity)));
    document.documentElement.style.setProperty('--content-card-opacity', cardOpacity + '%');
    document.documentElement.dataset.cardOpacity = String(cardOpacity);
  } catch (e) { /* localStorage unavailable — use the CSS default */ }

  try {
    var lang = localStorage.getItem('tab-out-language');
    if (lang === 'zh' || lang === 'en') {
      document.documentElement.dataset.lang = lang;
      document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
    }
  } catch (e) { /* localStorage unavailable — fall back to default */ }

  try {
    var fontPreset = localStorage.getItem('tab-out-font-preset');
    if (['system', 'readable', 'compact', 'editorial'].indexOf(fontPreset) !== -1) {
      document.documentElement.dataset.fontPreset = fontPreset;
    }
  } catch (e) { /* localStorage unavailable — fall back to default */ }

  try {
    var rawSizes = localStorage.getItem('tab-out-font-size-overrides');
    var sizes = rawSizes ? JSON.parse(rawSizes) : {};
    var values = ['small', 'default', 'large'];
    ['header', 'cards', 'tabs'].forEach(function (area) {
      var value = sizes && values.indexOf(sizes[area]) !== -1 ? sizes[area] : 'default';
      var key = 'size' + area.charAt(0).toUpperCase() + area.slice(1);
      document.documentElement.dataset[key] = value;
    });
  } catch (e) { /* localStorage unavailable — fall back to default */ }
})();
