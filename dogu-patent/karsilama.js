'use strict';
// Reklam karşılama sayfası (08.11.2026).
// Meta reklamından gelen ziyaretçi ana sayfanın en altındaki forma atlamak yerine reklamla aynı başlığı taşıyan kısa
// bir sayfaya iner: önce ne yapıldığı, sonra kısa form. Sayfa aynı adresi açan herkese aynı içeriği gösterir
// (Meta denetçisi dahil). Metin yalnız reklamda verilen sözleri tekrarlar; yeni vaat eklenmez.
const fs = require('fs');
const path = require('path');

const YOL = '/ucretsiz-marka-on-arastirma';
const SON_NOT = 'Yalnız marka ön araştırması ücretsizdir. Tescil kararını TÜRKPATENT verir.';

// 09.11 (büyüme raporu, tek hipotez): mobil ziyaretçi ilk ekranda reklamdaki sorunun devamını ve yapacağı tek işi görmeli.
// Sıra: başlık (reklamla aynı) → tek cümle → form → formun altında açıklama ve üç adım. Form alanları değişmedi.
const UZAKTAN = 'Türkiye’nin her yerinden, uzaktan çalışırız.';
const ICERIK = {
  '2A': {
    etiket: 'Ücretsiz marka ön araştırması',
    baslik: 'Markanız hangi sınıfta korunmalı?',
    cumle: 'Marka adınızı yazın; uzmanımız benzer kayıtlara ve işinize uygun sınıflara ücretsiz baksın.',
    giris: 'Marka başvurusunda yalnız ad değil, markanın hangi mal ve hizmetler için korunacağı da seçilir. Kafe, mağaza ya da online satış için seçilecek sınıflar farklı olabilir.',
    maddeler: [
      ['search', 'Uzmanımız bakar: adınıza benzeyen kayıtlı markalar ve işiniz için gereken sınıflar.'],
      ['call', 'Raporu sizi arayıp anlatır.'],
      ['description', 'Size özel teklif hazırlar.']
    ],
    formBaslik: 'Markanızı ve işinizi kısaca yazın',
    isEtiket: 'Ne iş yapıyorsunuz?',
    isOrnek: 'Örn: kafe, mağaza, online satış'
  },
  '2B': {
    etiket: 'Marka ve endüstriyel tasarım',
    baslik: 'Adınız marka, görünüşünüz tasarım',
    cumle: 'Ürün adınız marka, ürününüzün görünüşü tasarım olarak korunabilir. Adınızı yazın; uzmanımız benzer kayıtlara ücretsiz baksın.',
    giris: 'Ürününüzün adı marka olarak korunabilir. Şekli, ambalajı ya da deseni gibi görünüşe ait özellikler ise ayrı bir konudur ve endüstriyel tasarım olarak değerlendirilebilir.',
    maddeler: [
      ['search', 'Uzmanımız bakar: adınıza benzeyen kayıtlı markalar.'],
      ['call', 'Raporu sizi arayıp anlatır. Tasarım tescilini de düşünüyorsanız aynı görüşmede ayrı bir hizmet olarak konuşuruz.'],
      ['description', 'Size özel teklif hazırlar.']
    ],
    formBaslik: 'Markanızı ve ürününüzü kısaca yazın',
    isEtiket: 'Ürününüz ne?',
    isOrnek: 'Örn: ambalajlı gıda, mobilya, giyim'
  }
};

// utm_campaign → kullanılacak sürümler. Yeni reklam için buraya satır eklemek yeter.
const KAMPANYALAR = {
  rek2_kobi_marka_tasarim: { varsayilan: '2A', surumler: ['2A', '2B'] }
};

function ilk(v) { return String(Array.isArray(v) ? v[0] : v == null ? '' : v).trim(); }

// Sorgudan sürüm seçer. zorunlu=false iken (ana sayfa) tanınmayan kampanyada null döner ve ana sayfa açılır.
function sec(sorgu = {}, zorunlu = false) {
  const kampanya = KAMPANYALAR[ilk(sorgu.utm_campaign).toLowerCase()];
  if (!kampanya && !zorunlu) return null;
  const k = kampanya || { varsayilan: '2A', surumler: Object.keys(ICERIK) };
  const istenen = ilk(sorgu.utm_content).toUpperCase();
  const surum = k.surumler.includes(istenen) ? istenen : k.varsayilan;
  return { surum, ...ICERIK[surum] };
}

function kacis(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

let sablon = null;
function render(secim, viewsKok, ek = {}) {
  if (sablon === null) sablon = fs.readFileSync(path.join(viewsKok, 'karsilama.html'), 'utf8');
  const maddeler = secim.maddeler.map(([ikon, metin]) =>
    `<li><span class="material-symbols-outlined" aria-hidden="true">${kacis(ikon)}</span><span>${kacis(metin)}</span></li>`).join('\n          ');
  const degerler = {
    SURUM: secim.surum, ETIKET: secim.etiket, BASLIK: secim.baslik, CUMLE: secim.cumle, GIRIS: secim.giris, FORM_BASLIK: secim.formBaslik,
    IS_ETIKET: secim.isEtiket, IS_ORNEK: secim.isOrnek, SON_NOT, UZAKTAN, YOL, KVKK: ek.kvkk || ''
  };
  return sablon.replace(/\{\{([A-Z_]+)\}\}/g, (m, ad) => ad === 'MADDELER' ? maddeler : (ad in degerler ? kacis(degerler[ad]) : m));
}

module.exports = { sec, render, YOL, ICERIK, KAMPANYALAR, SON_NOT, UZAKTAN };
