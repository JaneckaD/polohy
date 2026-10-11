// Instalace na plochu (PWA) a upozornění, když chybí připojení.
const banner = document.getElementById('install');
const offline = document.getElementById('offline');
let deferred = null;

function dismissed() {
  try {
    return localStorage.getItem('mhd.installDismissed') === '1';
  } catch {
    return false;
  }
}

export function initInstall() {
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e;
    if (!standalone && !dismissed()) banner.hidden = false;
  });

  document.getElementById('install-btn').addEventListener('click', async () => {
    banner.hidden = true;
    if (deferred) {
      deferred.prompt();
      await deferred.userChoice.catch(() => null);
      deferred = null;
    } else {
      // iPhone neumí výzvu k instalaci, jen ruční postup.
      toast('V Safari klepni na Sdílet a pak na „Přidat na plochu“.');
    }
  });

  document.getElementById('install-close').addEventListener('click', () => {
    banner.hidden = true;
    try {
      localStorage.setItem('mhd.installDismissed', '1');
    } catch {
      /* nevadí */
    }
  });

  // iOS Safari: výzvu neposílá, nabídneme návod.
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !standalone;
  if (ios && !dismissed()) banner.hidden = false;

  const updateOnline = () => (offline.hidden = navigator.onLine);
  window.addEventListener('online', updateOnline);
  window.addEventListener('offline', updateOnline);
  updateOnline();
}

let toastTimer = null;
export function toast(text) {
  const el = document.getElementById('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4000);
}
