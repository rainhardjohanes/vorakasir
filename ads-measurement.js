// Verified Google Ads WhatsApp-click action: Secondary, One, no monetary value.
// Consent is still required before any Google script or measurement is loaded.
export const ADS_MEASUREMENT = Object.freeze({ enabled: true, tagId: 'AW-874675795', label: 'V5VqCMyt3akdENP8iaED' });

const CONSENT_KEY = 'vora.marketing-measurement.v1';
const INTENT_KEY = 'vora.marketing-whatsapp-intent.v1';
const CONSENT_DAYS = 180;
const HOSTS = new Set(['vorakasir.com', 'www.vorakasir.com']);
const CLICK_IDS = new Set(['gclid', 'gbraid', 'wbraid']);
const SAFE_REFERRER_PATHS = new Set(['/', '/index.html', '/kebijakan-privasi.html']);
const DENIED = Object.freeze({ ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });

function readPreference(storage, now) {
  try {
    const value = JSON.parse(storage.getItem(CONSENT_KEY));
    if (value?.version === 1 && ['accepted', 'declined'].includes(value.choice)
      && Number.isFinite(value.at) && value.at <= now && now - value.at < CONSENT_DAYS * 86400000) return value.choice;
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
      || !(url.pathname === '/' || HOSTS.has(url.hostname) && SAFE_REFERRER_PATHS.has(url.pathname))) return null;
    return url.origin + '/';
  } catch { return null; }
}

function clearAdCookies(document, hostname) {
  try {
    for (const part of document.cookie.split(';')) {
      const name = part.trim().split('=')[0];
      if (!/^_gcl_[A-Za-z0-9_]+$/.test(name)) continue;
      for (const domain of ['', `; Domain=${hostname}`, '; Domain=vorakasir.com', '; Domain=.vorakasir.com']) {
        document.cookie = `${name}=; Max-Age=0; Path=/${domain}; Secure; SameSite=Lax`;
      }
    }
  } catch {}
}

export function createAdsMeasurement({ window, document, config = ADS_MEASUREMENT, now = Date.now }) {
  const initialLocation = measurementLocation(window.location.href);
  const referrer = safeReferrer(document.referrer);
  const configured = config.enabled === true && /^AW-[0-9]{6,20}$/.test(config.tagId)
    && /^[A-Za-z0-9_-]{6,80}$/.test(config.label);
  const enabled = !!initialLocation && referrer !== null && configured;
  let choice = null;
  try { choice = readPreference(window.localStorage, now()); } catch {}
  let loaded = false;
  let failed = false;
  let revoked = false;
  let script;
  let intentRecorded = false;
  try { intentRecorded = window.sessionStorage.getItem(INTENT_KEY) === 'recorded'; } catch {}
  const panel = document.querySelector('#ads-consent');
  const settings = document.querySelector('#ads-consent-settings');
  const status = document.querySelector('#ads-consent-status');

  function setStatus(text) { if (status) status.textContent = text; }
  function showPanel(show) {
    if (panel) panel.hidden = !show;
    if (settings) settings.setAttribute('aria-expanded', String(show));
  }
  function persist(next) {
    choice = next;
    try { window.localStorage.setItem(CONSENT_KEY, JSON.stringify({ version: 1, choice: next, at: now() })); } catch {}
  }
  function tag() { window.dataLayer.push(arguments); }
  function start() {
    if (!enabled || choice !== 'accepted' || loaded || failed || revoked) return;
    const clean = measurementLocation(window.location.href);
    if (!clean) return;
    try {
      // Remove arbitrary query parameters and all fragments before a third-party
      // script can inspect location. Only bounded advertising click IDs remain.
      window.history.replaceState(window.history.state, '', clean.href);
      if (window.location.href !== clean.href) return;
    } catch { return; }
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
  function accept() {
    if (!enabled || revoked) return;
    persist('accepted');
    start();
    setStatus('Pilihan disimpan. Cookie diizinkan.');
    showPanel(false);
  }
  function decline(options = {}) {
    if (options.persistChoice !== false) persist('declined');
    else choice = 'declined';
    setStatus('Pilihan disimpan. Anda tetap dapat berkonsultasi dan mengunduh aplikasi.');
    showPanel(false);
    if (!loaded) return;
    revoked = true;
    window['ga-disable-' + config.tagId] = true;
    script?.remove();
    window.dataLayer.length = 0;
    clearAdCookies(document, window.location.hostname);
    // Reload unloads the already-consented third-party code. The saved refusal
    // prevents it from loading again. Previously transmitted events cannot be recalled.
    window.location.reload();
  }
  function recordIntent() {
    if (!enabled || choice !== 'accepted' || !loaded || failed || revoked || intentRecorded) return false;
    const current = measurementLocation(window.location.href);
    if (!current) return false;
    try {
      // A visitor may have used the FAQ/pricing anchor since granting consent.
      // Clean location again without changing scroll or delaying the WA link.
      window.history.replaceState(window.history.state, '', current.href);
      if (current.href !== window.location.href) return false;
    } catch { return false; }
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
  function whatsappTarget(value) {
    try { const url = new URL(value); return url.protocol === 'https:' && url.hostname === 'wa.me'
      && !url.port && !url.username && !url.password && url.pathname === '/6289636974140'; } catch { return false; }
  }
  function click(event) {
    if (event.isTrusted !== true || event.defaultPrevented || event.button !== 0) return;
    const anchor = event.target?.closest?.('a[href]');
    if (anchor && whatsappTarget(anchor.href)) recordIntent();
  }
  function submit(event) {
    if (event.isTrusted !== true || event.defaultPrevented || event.target?.id !== 'demo-form') return;
    if (whatsappTarget(event.target.action) && event.target.checkValidity()) recordIntent();
  }
  if (settings) settings.hidden = !enabled;
  showPanel(enabled && choice === null);
  document.querySelector('#ads-consent-accept')?.addEventListener('click', accept);
  document.querySelector('#ads-consent-decline')?.addEventListener('click', decline);
  document.querySelector('#ads-consent-close')?.addEventListener('click', () => showPanel(false));
  settings?.addEventListener('click', () => { showPanel(true); document.querySelector('#ads-consent-decline')?.focus(); });
  document.addEventListener('click', click);
  document.addEventListener('submit', submit);
  window.addEventListener('storage', event => {
    try {
      if (event.key === CONSENT_KEY && choice !== 'declined' && readPreference(window.localStorage, now()) === 'declined') {
        // A different tab already saved this choice. Do not write it again and
        // bounce new storage events between tabs before they finish reloading.
        decline({ persistChoice: false });
      }
    } catch {}
  });
  if (enabled && choice === 'accepted') start();
  return { accept, decline, getState: () => ({ enabled, choice, loaded, failed, revoked, intentRecorded }) };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') createAdsMeasurement({ window, document });
