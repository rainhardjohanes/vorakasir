// Verified Google Ads WhatsApp-click action: Secondary, One, no monetary value.
// Marketing-only measurement. Neither vendor is contacted before verified opt-in.
export const ADS_MEASUREMENT = Object.freeze({ enabled: true, tagId: 'AW-874675795', label: 'V5VqCMyt3akdENP8iaED' });
// Verified VORAKASIR Website dataset from its manual Pixel setup on 6 November 2026.
export const META_MEASUREMENT = Object.freeze({ enabled: true, pixelId: '1157904039907881' });

export const CONSENT_KEY = 'vora.marketing-measurement.v2';
const LEGACY_CONSENT_KEY = 'vora.marketing-measurement.v1';
const INTENT_KEY = 'vora.marketing-whatsapp-intent.v1';
const META_INTENT_KEY = 'vora.marketing-meta-intents.v2.';
const CONSENT_DAYS = 180;
const HOSTS = new Set(['vorakasir.com', 'www.vorakasir.com']);
const CLICK_IDS = new Set(['gclid', 'gbraid', 'wbraid', 'fbclid']);
const SAFE_REFERRER_PATHS = new Set(['/', '/index.html', '/kebijakan-privasi.html']);
const PUBLIC_AD_REFERRERS = new Set(['google.com', 'www.google.com', 'google.co.id', 'www.google.co.id',
  'facebook.com', 'www.facebook.com', 'm.facebook.com', 'l.facebook.com', 'instagram.com', 'www.instagram.com', 'l.instagram.com']);
const DENIED = Object.freeze({ ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });

function readPreference(storage, now, destinations) {
  try {
    const raw = storage.getItem(CONSENT_KEY);
    const value = JSON.parse(raw);
    const current = record => record && ['accepted', 'declined'].includes(record.choice)
      && Number.isFinite(record.at) && record.at <= now && now - record.at < CONSENT_DAYS * 86400000;
    if (value?.version === 2 && current(value)) {
      if (value.choice === 'declined') return { version: 2, choice: 'declined', at: value.at, destinations };
      if (JSON.stringify(value.destinations) === JSON.stringify(destinations)) return { version: 2, choice: 'accepted', at: value.at, destinations };
    }
    // A prior refusal remains a refusal. A prior Google-only grant is never a
    // grant for Meta; accepted v1 visitors must make a fresh, informed choice.
    if (raw === null) {
      const legacy = JSON.parse(storage.getItem(LEGACY_CONSENT_KEY));
      if (legacy?.version === 1 && legacy.choice === 'declined' && current(legacy)) return { version: 2, choice: 'declined', at: legacy.at, destinations };
    }
  } catch {}
  return null;
}

export function measurementLocation(href) {
  try {
    const url = new URL(href);
    if (url.protocol !== 'https:' || !HOSTS.has(url.hostname) || url.port || url.username || url.password
      || !['/', '/index.html'].includes(url.pathname) || url.searchParams.has('vora_tracking_test')) return null;
    const clean = new URL(url.origin + url.pathname);
    for (const key of CLICK_IDS) {
      const values = url.searchParams.getAll(key);
      if (values.length === 1 && /^[A-Za-z0-9_-]{10,256}$/.test(values[0])) clean.searchParams.set(key, values[0]);
    }
    return clean;
  } catch { return null; }
}

function safeReferrer(raw) {
  if (!raw) return '';
  try {
    const url = new URL(raw);
    // Google tags can read document.referrer independently. If it contains an
    // unknown path or parameters, skip measurement on this page rather than
    // relying only on a Google Analytics-specific override to hide the data.
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
      || !(HOSTS.has(url.hostname) && SAFE_REFERRER_PATHS.has(url.pathname)
        || PUBLIC_AD_REFERRERS.has(url.hostname) && url.pathname === '/')) return null;
    return url.origin + '/';
  } catch { return null; }
}

function clearAdCookies(document, hostname) {
  try {
    for (const part of document.cookie.split(';')) {
      const name = part.trim().split('=')[0];
      if (!/^_gcl_[A-Za-z0-9_]+$/.test(name) && !['_fbp', '_fbc'].includes(name)) continue;
      for (const domain of ['', `; Domain=${hostname}`, '; Domain=vorakasir.com', '; Domain=.vorakasir.com']) {
        document.cookie = `${name}=; Max-Age=0; Path=/${domain}; Secure; SameSite=Lax`;
      }
    }
  } catch {}
}

export function createAdsMeasurement({ window, document, config = ADS_MEASUREMENT, metaConfig = META_MEASUREMENT, now = Date.now }) {
  const initialLocation = measurementLocation(window.location.href);
  const referrer = safeReferrer(document.referrer);
  const googleConfigured = config.enabled === true && /^AW-[0-9]{6,20}$/.test(config.tagId)
    && /^[A-Za-z0-9_-]{6,80}$/.test(config.label);
  const metaConfigured = metaConfig.enabled === true && /^[1-9][0-9]{5,24}$/.test(metaConfig.pixelId);
  const destinations = [googleConfigured ? `google_ads:${config.tagId}/${config.label}` : null,
    metaConfigured ? `meta_pixel:${metaConfig.pixelId}` : null].filter(Boolean).sort();
  const enabled = !!initialLocation && referrer !== null && destinations.length > 0;
  let preference = null;
  try { preference = readPreference(window.localStorage, now(), destinations); } catch {}
  let choice = preference?.choice || null;
  let loaded = false;
  let failed = false;
  let metaLoaded = false;
  let metaFailed = false;
  let metaPageViewQueued = false;
  let metaCommand;
  let revoked = false;
  let script;
  let metaScript;
  let intentRecorded = false;
  try { intentRecorded = window.sessionStorage.getItem(INTENT_KEY) === 'recorded'; } catch {}
  const metaIntents = new Set();
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(META_INTENT_KEY + metaConfig.pixelId));
    if (Array.isArray(saved)) for (const name of saved) if (['VoraConsultationClick', 'VoraSignupClick'].includes(name)) metaIntents.add(name);
  } catch {}
  const panel = document.querySelector('#ads-consent');
  const settings = document.querySelector('#ads-consent-settings');
  const status = document.querySelector('#ads-consent-status');

  function setStatus(text) { if (status) status.textContent = text; }
  function showPanel(show) {
    if (panel) panel.hidden = !show;
    if (settings) settings.setAttribute('aria-expanded', String(show));
  }
  function persist(next, record = null) {
    const value = record || { version: 2, choice: next, at: now(), destinations };
    try {
      const raw = JSON.stringify(value);
      window.localStorage.setItem(CONSENT_KEY, raw);
      if (window.localStorage.getItem(CONSENT_KEY) !== raw) return false;
      preference = value; choice = next;
      return true;
    } catch { return false; }
  }
  function tag() { window.dataLayer.push(arguments); }
  function cleanLocation() {
    const clean = measurementLocation(window.location.href);
    if (!clean) return null;
    try {
      // Remove arbitrary query parameters and all fragments before a third-party
      // script can inspect location. Only bounded advertising click IDs remain.
      window.history.replaceState(window.history.state, '', clean.href);
      return window.location.href === clean.href ? clean : null;
    } catch { return null; }
  }
  function startGoogle(clean) {
    if (!googleConfigured || loaded || failed) return;
    // The marketing page has its own data layer; never reuse an existing tracker
    // that may already have user-data or account settings attached.
    if (window.gtag || window.dataLayer) { failed = true; return; }
    window.dataLayer = [];
    window.gtag = tag;
    tag('consent', 'default', { ...DENIED });
    tag('set', 'ads_data_redaction', true);
    tag('set', 'url_passthrough', false);
    tag('set', 'allow_ad_personalization_signals', false);
    tag('set', 'allow_google_signals', false);
    tag('set', 'user_data', {});
    tag('consent', 'update', { ...DENIED, ad_storage: 'granted', ad_user_data: 'granted' });
    tag('js', new Date(now()));
    tag('config', config.tagId, {
      send_page_view: false,
      allow_enhanced_conversions: false,
      allow_ad_personalization_signals: false,
      cookie_domain: window.location.hostname,
      page_location: clean.href,
      page_referrer: referrer,
      user_data: {},
    });
    script = document.createElement('script');
    script.async = true;
    script.referrerPolicy = 'no-referrer';
    script.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(config.tagId);
    script.addEventListener('error', () => { failed = true; });
    document.head.append(script);
    loaded = true;
  }
  function startMeta() {
    if (!metaConfigured || metaLoaded || metaFailed) return;
    // Never append to an unknown pixel or matching configuration left by
    // another integration. This page owns only this explicit, scoped dataset.
    if (window.fbq || window._fbq) { metaFailed = true; return; }
    const fbq = function () { if (fbq.callMethod) fbq.callMethod.apply(fbq, arguments); else fbq.queue.push(arguments); };
    fbq.queue = []; fbq.push = fbq; fbq.loaded = true; fbq.version = '2.0';
    window.fbq = fbq; window._fbq = fbq; metaCommand = fbq;
    fbq('consent', 'revoke');
    fbq('set', 'autoConfig', false, metaConfig.pixelId);
    // No advanced matching object, form values, customer ID or custom data.
    fbq('init', metaConfig.pixelId);
    fbq('consent', 'grant');
    fbq('trackSingle', metaConfig.pixelId, 'PageView');
    metaPageViewQueued = true;
    metaScript = document.createElement('script');
    metaScript.async = true; metaScript.referrerPolicy = 'no-referrer';
    metaScript.src = 'https://connect.facebook.net/en_US/fbevents.js';
    metaScript.addEventListener('error', () => { metaFailed = true; });
    document.head.append(metaScript); metaLoaded = true;
  }
  function start() {
    if (!enabled || choice !== 'accepted' || revoked) return;
    // Even a returning grant must still be writable. A blocked/full storage
    // cannot revive an old grant after a failed withdrawal on a previous page.
    if (!persist('accepted', preference)) { choice = null; setStatus('Pilihan belum dapat disimpan. Anda tetap bisa menggunakan website tanpa cookie.'); showPanel(true); return; }
    const clean = cleanLocation();
    if (!clean) return;
    try { startGoogle(clean); } catch { failed = true; }
    try { startMeta(); } catch { metaFailed = true; }
  }
  function accept() {
    if (!enabled || revoked) return;
    if (!persist('accepted')) { choice = null; setStatus('Pilihan belum dapat disimpan. Anda tetap bisa menggunakan website tanpa cookie.'); showPanel(true); return; }
    start();
    setStatus('Pilihan disimpan. Cookie diizinkan.');
    showPanel(false);
  }
  function decline(options = {}) {
    const saved = options.persistChoice === false || persist('declined');
    choice = 'declined';
    setStatus('Pilihan disimpan. Anda tetap dapat berkonsultasi dan mengunduh aplikasi.');
    showPanel(false);
    if (revoked || !loaded && !metaLoaded) return;
    revoked = true;
    if (metaCommand) {
      // An unexecuted download must never later flush its queued PageView or
      // grant after withdrawal. A loaded pixel receives revoke immediately.
      if (!metaCommand.callMethod) metaCommand.queue.length = 0;
      metaCommand('consent', 'revoke');
    }
    if (loaded) window['ga-disable-' + config.tagId] = true;
    script?.remove();
    metaScript?.remove();
    if (loaded) window.dataLayer.length = 0;
    clearAdCookies(document, window.location.hostname);
    // Reload unloads the already-consented third-party code. The saved refusal
    // prevents it from loading again. Previously transmitted events cannot be recalled.
    if (saved) window.location.reload();
    else setStatus('Cookie dihentikan pada halaman ini. Pilihan belum dapat disimpan di browser Anda.');
  }
  function recordIntent() {
    if (!enabled || choice !== 'accepted' || !loaded || failed || revoked || intentRecorded) return false;
    const current = cleanLocation();
    if (!current) return false;
    // Fixed fields only: no link URL, form values, account ID, email or user data.
    tag('event', 'conversion', {
      send_to: config.tagId + '/' + config.label,
      page_location: current.href,
      page_referrer: referrer,
      user_data: {},
    });
    intentRecorded = true;
    try { window.sessionStorage.setItem(INTENT_KEY, 'recorded'); } catch {}
    return true;
  }
  function recordMetaIntent(name) {
    if (!enabled || choice !== 'accepted' || revoked || !metaLoaded || metaFailed || metaIntents.has(name) ||
      !['VoraConsultationClick', 'VoraSignupClick'].includes(name) || !cleanLocation()) return false;
    // Fixed custom click names only. These deliberately are NOT Lead,
    // CompleteRegistration or Purchase, and contain no form/link parameters.
    metaCommand('trackSingleCustom', metaConfig.pixelId, name);
    metaIntents.add(name);
    try { window.sessionStorage.setItem(META_INTENT_KEY + metaConfig.pixelId, JSON.stringify([...metaIntents])); } catch {}
    return true;
  }
  function whatsappTarget(value) {
    try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'wa.me'
      && !url.port && !url.username && !url.password && url.pathname === '/6285755180005'; } catch { return false; }
  }
  function signupTarget(value) {
    try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'dashboard.vorakasir.com'
      && !url.port && !url.username && !url.password && url.pathname === '/dashboard/' && !url.search && url.hash === '#signup'; } catch { return false; }
  }
  function click(event) {
    if (event.isTrusted !== true || event.defaultPrevented || event.button !== 0) return;
    const anchor = event.target?.closest?.('a[href]');
    if (anchor && whatsappTarget(anchor.href)) { recordIntent(); recordMetaIntent('VoraConsultationClick'); }
    else if (anchor && signupTarget(anchor.href)) recordMetaIntent('VoraSignupClick');
  }
  function submit(event) {
    if (event.isTrusted !== true || event.defaultPrevented || event.target?.id !== 'demo-form') return;
    if (whatsappTarget(event.target.action) && event.target.checkValidity()) { recordIntent(); recordMetaIntent('VoraConsultationClick'); }
  }
  if (settings) settings.hidden = !enabled;
  showPanel(enabled && choice === null);
  document.querySelector('#ads-consent-accept')?.addEventListener('click', event => { if (event.isTrusted === true) accept(); });
  document.querySelector('#ads-consent-decline')?.addEventListener('click', event => { if (event.isTrusted === true) decline(); });
  document.querySelector('#ads-consent-close')?.addEventListener('click', () => showPanel(false));
  settings?.addEventListener('click', () => { showPanel(true); document.querySelector('#ads-consent-decline')?.focus(); });
  document.addEventListener('click', click);
  document.addEventListener('submit', submit);
  window.addEventListener('storage', event => {
    try {
      const remote = readPreference(window.localStorage, now(), destinations);
      if ((event.key === CONSENT_KEY || event.key === null) && choice === 'accepted' && remote?.choice !== 'accepted') {
        // A different tab already saved this choice. Do not write it again and
        // bounce new storage events between tabs before they finish reloading.
        decline({ persistChoice: false });
      }
    } catch {}
  });
  if (enabled && choice === 'accepted') start();
  return { accept, decline, getState: () => ({ enabled, choice, loaded, failed, revoked, intentRecorded,
    metaLoaded, metaFailed, metaPageViewQueued, metaIntents: [...metaIntents] }) };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') createAdsMeasurement({ window, document });
