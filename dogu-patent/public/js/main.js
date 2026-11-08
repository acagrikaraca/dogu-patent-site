// ===== DOĞU PATENT - MAIN JS =====

// Mobile Navigation Toggle
function initMobileNav() {
  const hamburger = document.querySelector('.nav-hamburger');
  const mobileNav = document.querySelector('.nav-mobile');
  
  if (hamburger && mobileNav) {
    hamburger.addEventListener('click', () => {
      mobileNav.classList.toggle('open');
      const icon = hamburger.querySelector('.material-symbols-outlined');
      icon.textContent = mobileNav.classList.contains('open') ? 'close' : 'menu';
    });
  }
}

// Toast Notification
function showToast(message, isError = false) {
  let toast = document.querySelector('.toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  
  requestAnimationFrame(() => {
    toast.classList.add('show');
  });
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 4000);
}

// ===== Talep kaynağı (ilk ve son temas) =====
// Reklam/gönderi bağlantısındaki UTM, gclid, fbclid bilgisi formla birlikte gönderilir.
// Kişisel veri saklanmaz; tarayıcı depolaması kapalıysa form yine çalışır.
const DP_KAYNAK_ALANLARI = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'];
function dpKaynakOku(anahtar) {
  try { return JSON.parse(localStorage.getItem(anahtar) || 'null'); } catch (e) { return null; }
}
function dpKaynakYaz(anahtar, deger) {
  try { localStorage.setItem(anahtar, JSON.stringify(deger)); } catch (e) {}
}
function dpKaynakYakala() {
  const params = new URLSearchParams(window.location.search);
  const temas = {};
  DP_KAYNAK_ALANLARI.forEach(k => { const v = params.get(k); if (v) temas[k] = v.slice(0, 200); });
  let yonlendiren = '';
  try {
    if (document.referrer) {
      const r = new URL(document.referrer);
      if (r.hostname !== window.location.hostname) yonlendiren = r.hostname;
    }
  } catch (e) {}
  const yeniTemas = Object.keys(temas).length > 0 || !!yonlendiren;
  if (!yeniTemas && dpKaynakOku('dp_kaynak_ilk')) return;
  if (yonlendiren) temas.yonlendiren = yonlendiren;
  temas.giris_sayfasi = window.location.pathname.slice(0, 200);
  temas.zaman = new Date().toISOString();
  if (!dpKaynakOku('dp_kaynak_ilk')) dpKaynakYaz('dp_kaynak_ilk', temas);
  if (yeniTemas) dpKaynakYaz('dp_kaynak_son', temas);
}
function dpKaynak() {
  return { ilk: dpKaynakOku('dp_kaynak_ilk'), son: dpKaynakOku('dp_kaynak_son') };
}
function dpDonusum(formTuru) {
  // Analytics önerilen olayı; kişisel veri gönderilmez.
  try { if (typeof gtag === 'function') gtag('event', 'generate_lead', { form_turu: formTuru }); } catch (e) {}
}
dpKaynakYakala();

// ===== Site sayacı =====
// Hangi sayfanın kaç kez görüntülendiğini ve sayfanın ekranda ne kadar açık kaldığını ölçer.
// Sayfada hiçbir şey göstermez; sonuçları yalnız yönetici paneli ve şirketin ajan sistemi okur.
// Çerez, kalıcı kimlik veya kişisel veri yoktur: rastgele kimlik yalnız bu sayfa açılışının
// süre güncellemelerini birleştirir ve tarayıcıda saklanmaz.
(function dpSayac() {
  try {
    if (navigator.webdriver) return;
    try { if (localStorage.getItem('dp_sayma') === '1') return; } catch (e) {}
    var ADRES = '/api/olcum';
    var id = '';
    try {
      var rastgele = new Uint8Array(8);
      crypto.getRandomValues(rastgele);
      id = Array.prototype.map.call(rastgele, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
    } catch (e) {
      id = (Date.now().toString(36) + Math.random().toString(36).slice(2)).replace(/[^a-z0-9]/g, '').slice(0, 20);
    }
    // Reklam karşılama sayfası ana sayfa adresinden açılsa da ayrı sayılır (sayfa kendi yolunu meta etiketiyle verir).
    var yolEtiketi = document.querySelector('meta[name="dp-sayac-yol"]');
    var yol = ((yolEtiketi && yolEtiketi.getAttribute('content')) || window.location.pathname).slice(0, 200);
    var gorunur = null, birikmis = 0, derinlik = 0, sonGonderilen = '', basladi = false, bekleyen = false, formBasladi = false;
    function simdi() { return (window.performance && performance.now) ? performance.now() : Date.now(); }
    function sure() { return Math.round((birikmis + (gorunur === null ? 0 : simdi() - gorunur)) / 1000); }
    function olcDerinlik() {
      var kok = document.documentElement, govde = document.body;
      var yukseklik = Math.max(kok.scrollHeight, govde ? govde.scrollHeight : 0);
      var alt = (window.scrollY || window.pageYOffset || 0) + (window.innerHeight || kok.clientHeight || 0);
      var yuzde = yukseklik > 0 ? Math.min(100, Math.round(alt / yukseklik * 100)) : 100;
      if (yuzde > derinlik) derinlik = yuzde;
    }
    function gonder(veri) {
      var metin = JSON.stringify(veri);
      try { if (navigator.sendBeacon && navigator.sendBeacon(ADRES, metin)) return; } catch (e) {}
      try {
        fetch(ADRES, { method: 'POST', body: metin, keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'text/plain' } }).catch(function () {});
      } catch (e) {}
    }
    function ilkGorunum() {
      if (basladi) return;
      basladi = true;
      var ic = false, gelen = '';
      try {
        if (document.referrer) {
          var r = new URL(document.referrer);
          if (r.hostname === window.location.hostname) ic = true; else gelen = r.hostname;
        }
      } catch (e) {}
      var q = new URLSearchParams(window.location.search), etiket = {};
      ['utm_source', 'utm_medium', 'utm_campaign'].forEach(function (a) { var v = q.get(a); if (v) etiket[a.slice(4, 5)] = v.slice(0, 80); });
      if (q.get('gclid')) etiket.gclid = 1;
      if (q.get('fbclid')) etiket.fbclid = 1;
      var en = window.innerWidth || 0;
      var dokunmatik = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
      var cihaz = en < 768 ? 'mobil' : (dokunmatik && en < 1200 ? 'tablet' : 'masaustu');
      // Bağlantı sayfanın içindeki bir bölüme (#...) atlattıysa derinlik okumayı göstermez; sunucu bu açılışta derinliği saymaz.
      var capa = 0;
      try { capa = window.location.hash.length > 1 && document.getElementById(decodeURIComponent(window.location.hash.slice(1))) ? 1 : 0; } catch (e) {}
      olcDerinlik();
      var ilk = { v: 1, t: 'g', i: id, p: yol, r: gelen, ic: ic ? 1 : 0, k: etiket, c: cihaz };
      if (capa) ilk.a = 1;
      gonder(ilk);
    }
    function guncelle() {
      if (!basladi) return;
      olcDerinlik();
      var s = sure(), anahtar = s + ':' + derinlik;
      if (anahtar === sonGonderilen) return;
      sonGonderilen = anahtar;
      gonder({ v: 1, t: 's', i: id, p: yol, s: s, d: derinlik });
    }
    function durdur() { if (gorunur !== null) { birikmis += simdi() - gorunur; gorunur = null; } }
    // Arka planda açılıp hiç görülmeyen sekme sayılmaz; görüntülenme sayfa ilk kez ekrana gelince başlar.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { if (gorunur === null) gorunur = simdi(); ilkGorunum(); }
      else { durdur(); guncelle(); }
    });
    window.addEventListener('pagehide', function () { durdur(); guncelle(); });
    window.addEventListener('pageshow', function (e) {
      if (e.persisted && document.visibilityState === 'visible' && gorunur === null) gorunur = simdi();
    });
    // Forma dokunma: bir form alanına ilk kez girildiğinde tek olay. Yazılan içerik gönderilmez.
    document.addEventListener('focusin', function (e) {
      if (formBasladi || !basladi || !e.target || !e.target.closest) return;
      if (!e.target.closest('form.marka-arastirma-form, form.iletisim-form')) return;
      formBasladi = true;
      gonder({ v: 1, t: 'f', i: id, p: yol });
    });
    window.addEventListener('scroll', function () {
      if (bekleyen) return;
      bekleyen = true;
      (window.requestAnimationFrame || setTimeout)(function () { bekleyen = false; olcDerinlik(); });
    }, { passive: true });
    if (document.visibilityState === 'visible') { gorunur = simdi(); ilkGorunum(); }
  } catch (e) {}
})();

// Marka Ön Araştırma Form
function initMarkaForm() {
  const forms = document.querySelectorAll('.marka-arastirma-form');
  
  forms.forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      
      const btn = form.querySelector('button[type="submit"]');
      const originalText = btn.textContent;
      btn.textContent = 'GÖNDERİLİYOR...';
      btn.disabled = true;
      
      const formData = {
        markaAdi: form.querySelector('[name="markaAdi"]').value,
        sektör: form.querySelector('[name="sektor"]')?.value || '',
        adSoyad: form.querySelector('[name="adSoyad"]').value,
        telefon: form.querySelector('[name="telefon"]').value,
        eposta: form.querySelector('[name="eposta"]').value,
        il: form.querySelector('[name="il"]')?.value || '',
        ekNot: form.querySelector('[name="ekNot"]')?.value || '',
        kvkkOkundu: form.querySelector('[name="kvkkOkundu"]')?.checked === true,
        kvkkVersiyon: form.dataset.kvkkVersiyon,
        kaynak: dpKaynak()
      };
      
      try {
        const res = await fetch('/api/marka-arastirma', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        });
        
        const data = await res.json();
        
        if (data.success) {
          showToast(data.message);
          dpDonusum('on_arastirma');
          form.reset();
          // Karşılama sayfası: form yerine kalıcı teşekkür kutusu gösterilir.
          const basari = form.dataset.basari && document.getElementById(form.dataset.basari);
          if (basari) { form.hidden = true; basari.hidden = false; basari.scrollIntoView({ block: 'center' }); }
        } else {
          showToast(data.message, true);
        }
      } catch (err) {
        showToast('Bir hata oluştu. Lütfen tekrar deneyin.', true);
      }
      
      btn.textContent = originalText;
      btn.disabled = false;
    });
  });
}

// İletişim Form
function initContactForm() {
  const form = document.querySelector('.iletisim-form');
  
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      
      const btn = form.querySelector('button[type="submit"]');
      const originalHTML = btn.innerHTML;
      btn.innerHTML = 'GÖNDERİLİYOR... <span class="material-symbols-outlined text-sm">hourglass_top</span>';
      btn.disabled = true;
      
      const formData = {
        adSoyad: form.querySelector('[name="adSoyad"]').value,
        eposta: form.querySelector('[name="eposta"]').value,
        telefon: form.querySelector('[name="telefon"]')?.value || '',
        basvuruTipi: form.querySelector('[name="basvuruTipi"]')?.value || 'Genel',
        mesaj: form.querySelector('[name="mesaj"]').value,
        kvkkOkundu: form.querySelector('[name="kvkkOkundu"]')?.checked === true,
        kvkkVersiyon: form.dataset.kvkkVersiyon,
        kaynak: dpKaynak()
      };
      
      try {
        const res = await fetch('/api/iletisim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        });
        
        const data = await res.json();
        
        if (data.success) {
          showToast(data.message);
          dpDonusum('iletisim');
          form.reset();
        } else {
          showToast(data.message, true);
        }
      } catch (err) {
        showToast('Bir hata oluştu. Lütfen tekrar deneyin.', true);
      }
      
      btn.innerHTML = originalHTML;
      btn.disabled = false;
    });
  }
}

// Newsletter Form
function initNewsletterForm() {
  const form = document.querySelector('.bulten-form');
  
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const btn = form.querySelector('button[type="submit"]');
      const originalText = btn.textContent;
      btn.textContent = 'KAYDEDİLİYOR...';
      btn.disabled = true;
      
      const formData = {
        eposta: form.querySelector('[name="eposta"]').value,
        onay: form.querySelector('[name="onay"]')?.checked || false
      };
      
      try {
        const res = await fetch('/api/bulten', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        });
        
        const data = await res.json();
        
        if (data.success) {
          showToast(data.message);
          form.reset();
        } else {
          showToast(data.message, true);
        }
      } catch (err) {
        showToast('Bir hata oluştu. Lütfen tekrar deneyin.', true);
      }
      
      btn.textContent = originalText;
      btn.disabled = false;
    });
  }
}

// Smooth scroll for anchor links
function initSmoothScroll() {
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
      e.preventDefault();
      const target = document.querySelector(this.getAttribute('href'));
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  });
}

// Scroll-based navbar shadow
function initScrollEffects() {
  const nav = document.querySelector('.nav-main');
  if (nav) {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 10) {
        nav.style.boxShadow = '0 4px 20px rgba(0,36,65,0.06)';
      } else {
        nav.style.boxShadow = 'none';
      }
    });
  }
}

// Phone number formatter
function initPhoneFormatter() {
  document.querySelectorAll('input[type="tel"]').forEach(input => {
    input.addEventListener('input', (e) => {
      let val = e.target.value.replace(/\D/g, '');
      if (val.length > 11) val = val.substring(0, 11);
      
      if (val.length >= 4 && val.length < 7) {
        val = val.substring(0, 4) + ' ' + val.substring(4);
      } else if (val.length >= 7 && val.length < 9) {
        val = val.substring(0, 4) + ' ' + val.substring(4, 7) + ' ' + val.substring(7);
      } else if (val.length >= 9) {
        val = val.substring(0, 4) + ' ' + val.substring(4, 7) + ' ' + val.substring(7, 9) + ' ' + val.substring(9);
      }
      
      e.target.value = val;
    });
  });
}

// Initialize everything
document.addEventListener('DOMContentLoaded', () => {
  initMobileNav();
  initMarkaForm();
  initContactForm();
  initNewsletterForm();
  initSmoothScroll();
  initScrollEffects();
  initPhoneFormatter();
});
