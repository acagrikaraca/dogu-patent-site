'use strict';
// Doğu Patent site sayacı: sayfa görüntülenmesi ve sayfanın ekranda açık kaldığı süre.
// Ziyaretçiye hiçbir şey gösterilmez; veriler yalnız yönetici oturumuyla /api/admin/sayac üzerinden okunur.
// Kişisel veri tutulmaz: çerez, IP adresi, tarayıcı bilgisi veya kalıcı ziyaretçi kimliği saklanmaz.
// Her sayfa açılışının rastgele kimliği yalnız aynı açılışın süre güncellemelerini birleştirmek içindir.
const fs = require('fs');
const path = require('path');

const SURE_SINIRI = 1800;                 // tek görüntülemede sayılan en uzun süre (sn); açık unutulan sekme ortalamayı bozmasın
const DILIMLER = [10, 30, 60, 180, 600];  // süre dağılımı: <10, 10–30, 30–60, 60–180, 180–600, 600+ sn
const DILIM_ADLARI = ['10 sn altı', '10–30 sn', '30–60 sn', '1–3 dk', '3–10 dk', '10 dk üstü'];
const OKUMA_ESIGI = 75;                   // sayfanın en az %75'ine kadar inilen görüntüleme "okundu" sayılır
const KISA_ESIGI = 10;                    // 10 saniyeden kısa kalınan görüntüleme "kısa kalma"
const HAM_SAKLAMA_GUN = 120;
const OZET_SAKLAMA_GUN = 800;
const GUNLUK_DOSYA_SINIRI = 25 * 1024 * 1024;
const OLCUM_DOSYASI = 'olcum-baslangic.json';   // yeni ölçülen olayların ilk günü (ör. telefona dokunma); öncesi 0 değil, ölçülmedi
const DAKIKA_SINIRI = 900;                // bütün site için dakikada en çok olay (kötüye kullanım sigortası)
const ADRES_SINIRI = 240;                 // aynı bağlantıdan 10 dakikada en çok olay; adres saklanmaz, yalnız bellekte sayılır
const KAYNAK_TURLERI = ['dogrudan', 'arama', 'sosyal', 'reklam', 'eposta', 'ic', 'diger'];
const CIHAZLAR = ['mobil', 'tablet', 'masaustu'];
const BOT = /bot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|python|curl|wget|node-fetch|axios|go-http|java\/|httpclient|okhttp|monitor|uptime|scanner|phantom|selenium|puppeteer|playwright/i;
const EPOSTA_ALANI = /(^|\.)(mail\.google|outlook|mail\.yahoo|mail\.yandex|mail\.ru|android\.gm|yaani)/i;
const ARAMA_ALANI = /(^|\.)(google|bing|yandex|duckduckgo|yahoo|ecosia|baidu|naver|qwant|brave|startpage|seznam|yaani|googlequicksearchbox)(\.|$)/i;
const SOSYAL_ALANI = /(facebook|instagram|linkedin|lnkd\.in|twitter|^t\.co$|^x\.com$|youtube|youtu\.be|tiktok|whatsapp|^wa\.me$|pinterest|reddit|threads\.net|telegram|^t\.me$|^fb\.me$)/i;
const SOSYAL_KAYNAK = new Set(['facebook', 'instagram', 'linkedin', 'x', 'twitter', 'tiktok', 'youtube', 'whatsapp', 'threads', 'pinterest']);

function istanbulGunu(ms) {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Istanbul', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ms));
  } catch (e) {
    return new Date(ms + 3 * 3600 * 1000).toISOString().slice(0, 10);   // Türkiye 2016'dan beri sabit UTC+3
  }
}
function istanbulSaati(ms) {
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', hourCycle: 'h23' }).format(new Date(ms))) % 24;
  } catch (e) {
    return new Date(ms + 3 * 3600 * 1000).getUTCHours();
  }
}
function gunEkle(gun, n) {
  const d = new Date(gun + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ---- girdi temizliği: buradan çıkan değer ajan sistemine de gider; serbest metin kabul edilmez
function temizId(v) { const s = String(v == null ? '' : v); return /^[a-z0-9]{8,32}$/.test(s) ? s : ''; }
function temizAlan(v) {
  let s = String(v == null ? '' : v).trim().toLowerCase();
  if (!/^[a-z0-9.-]{1,100}$/.test(s) || !s.includes('.')) return '';
  return s.replace(/^www\./, '');
}
function temizEtiket(v) {
  return String(v == null ? '' : v).normalize('NFC').trim().replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_.+\-]/gu, '').slice(0, 60);
}
function tamSayi(v, alt, ust) { const n = Math.round(Number(v)); return Number.isFinite(n) ? Math.min(ust, Math.max(alt, n)) : null; }

function kaynakTuru(ic, alan, k) {
  const ortam = String(k.m || '').toLowerCase(), kaynak = String(k.s || '').toLowerCase();
  if (k.gclid || /^(cpc|ppc|paid|paid_?social|ads?|reklam|display)$/.test(ortam)) return 'reklam';
  if (/^(e-?posta|e-?mail|newsletter|bulten|bülten)$/.test(ortam)) return 'eposta';
  if (/social|sosyal/.test(ortam) || SOSYAL_KAYNAK.has(kaynak) || k.fbclid) return 'sosyal';
  if (ic) return 'ic';
  if (!alan) return kaynak ? 'diger' : 'dogrudan';
  if (EPOSTA_ALANI.test(alan)) return 'eposta';
  if (ARAMA_ALANI.test(alan)) return 'arama';
  if (SOSYAL_ALANI.test(alan)) return 'sosyal';
  return 'diger';
}
function dilim(s) { let i = 0; while (i < DILIMLER.length && s >= DILIMLER[i]) i++; return i; }
function oran(a, b) { return b ? Math.round(a / b * 1000) / 10 : null; }
function ortalama(a, b) { return b ? Math.round(a / b) : null; }

function bosSatir(yol) {
  return { yol, g: 0, e: 0, sk: 0, sn: 0, dk: 0, dt: 0, o: 0, ks: 0, fb: 0, tb: 0, b: [0, 0, 0, 0, 0, 0],
           kay: Object.fromEntries(KAYNAK_TURLERI.map(k => [k, 0])), cih: Object.fromEntries(CIHAZLAR.map(k => [k, 0])) };
}
function satirEkle(hedef, kaynak) {
  // fb: forma dokunan (08.11), tb: telefona dokunan (İ4); eski günlerde alan yoksa 0
  for (const k of ['g', 'e', 'sk', 'sn', 'dk', 'dt', 'o', 'ks', 'fb', 'tb']) hedef[k] += kaynak[k] || 0;
  (kaynak.b || []).forEach((n, i) => { hedef.b[i] += n || 0; });
  for (const k of KAYNAK_TURLERI) hedef.kay[k] += (kaynak.kay || {})[k] || 0;
  for (const k of CIHAZLAR) hedef.cih[k] += (kaynak.cih || {})[k] || 0;
}

function olustur(secenek) {
  const kok = secenek.kok;
  const yolCoz = secenek.yolCoz;                       // (ham yol) => geçerli sayfa yolu | '/404' | null
  const simdi = secenek.simdi || (() => Date.now());
  const aktif = new Map();                             // sayfa açılışı kimliği → {at, s, d} (yalnız bellekte)
  const adresSayaci = new Map();
  let dakika = { bas: 0, n: 0 }, adresTemizlik = 0, sonTemizlik = '';
  const onbellek = new Map();                          // gün → {at, veri}
  fs.mkdirSync(kok, { recursive: true });
  // Telefona dokunma ölçümü bu kodun sunucuda ilk çalıştığı gün başlar; tarih bir kez yazılır, sonra değişmez.
  let olcumBaslangici = {};
  try { olcumBaslangici = JSON.parse(fs.readFileSync(path.join(kok, OLCUM_DOSYASI), 'utf8')) || {}; } catch (e) {}
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(olcumBaslangici.telefon || ''))) {
    olcumBaslangici = { ...olcumBaslangici, telefon: istanbulGunu(simdi()) };
    try { fs.writeFileSync(path.join(kok, OLCUM_DOSYASI), JSON.stringify(olcumBaslangici), { mode: 0o600 }); } catch (e) {}
  }

  const hamDosya = gun => path.join(kok, `olay-${gun}.jsonl`);
  const ozetDosya = gun => path.join(kok, `gun-${gun}.json`);

  function siniriAs(adres, t) {
    if (t - dakika.bas > 60000) dakika = { bas: t, n: 0 };
    if (++dakika.n > DAKIKA_SINIRI) return true;
    if (t - adresTemizlik > 600000) { adresSayaci.clear(); adresTemizlik = t; }
    const anahtar = String(adres || '-').slice(0, 200);
    const n = (adresSayaci.get(anahtar) || 0) + 1;
    adresSayaci.set(anahtar, n);
    return n > ADRES_SINIRI;
  }
  function aktifTemizle(t) {
    if (aktif.size < 5000 && Math.random() > 0.02) return;
    for (const [id, a] of aktif) if (t - a.at > 6 * 3600 * 1000) aktif.delete(id);
    while (aktif.size > 50000) aktif.delete(aktif.keys().next().value);
  }
  function yaz(gun, kayit) {
    const dosya = hamDosya(gun);
    try {
      if (fs.existsSync(dosya) && fs.statSync(dosya).size > GUNLUK_DOSYA_SINIRI) return false;
      // Satır küçük ve trafik düşük: eşzamanlı ekleme sırayı korur, okuma her zaman son durumu görür.
      fs.appendFileSync(dosya, JSON.stringify(kayit) + '\n', { encoding: 'utf8', mode: 0o600 });
    } catch (e) {
      console.error('[SAYAC] yazılamadı:', e.code || e.message);
      return false;
    }
    onbellek.delete(gun);
    onbellek.delete(gunEkle(gun, -1));   // bugünkü süre güncellemesi dünün ziyaretine ait olabilir
    return true;
  }
  function eskileriSil(bugun) {
    if (sonTemizlik === bugun) return;
    sonTemizlik = bugun;
    const hamSinir = gunEkle(bugun, -HAM_SAKLAMA_GUN), ozetSinir = gunEkle(bugun, -OZET_SAKLAMA_GUN);
    try {
      for (const ad of fs.readdirSync(kok)) {
        const m = ad.match(/^(olay|gun)-(\d{4}-\d{2}-\d{2})\.(jsonl|json)$/);
        if (m && m[2] < (m[1] === 'olay' ? hamSinir : ozetSinir)) fs.unlink(path.join(kok, ad), () => {});
      }
    } catch (e) {}
  }

  // Tarayıcıdan gelen tek olay. Kaydedilmediyse false döner; uç her durumda 204 yanıtlar.
  function olay(govde, baglam = {}) {
    if (!govde || typeof govde !== 'object' || Array.isArray(govde)) return false;
    const ua = String(baglam.ua || '');
    if (!ua || BOT.test(ua)) return false;
    const t = simdi();
    if (siniriAs(baglam.adres, t)) return false;
    const id = temizId(govde.i);
    if (!id) return false;
    const gun = istanbulGunu(t);
    aktifTemizle(t);
    eskileriSil(gun);
    if (govde.t === 'g') {
      if (aktif.has(id)) return false;
      const yol = yolCoz(govde.p);
      if (!yol) return false;
      const ic = govde.ic === 1 || govde.ic === true;
      const alan = ic ? '' : temizAlan(govde.r);
      const kh = govde.k && typeof govde.k === 'object' && !Array.isArray(govde.k) ? govde.k : {};
      const k = {};
      for (const a of ['s', 'm', 'c']) { const v = temizEtiket(kh[a]); if (v) k[a] = v; }
      if (kh.gclid) k.gclid = 1;
      if (kh.fbclid) k.fbclid = 1;
      const kayit = { t: 'g', i: id, z: t, h: istanbulSaati(t), p: yol, rt: kaynakTuru(ic, alan, k), e: ic ? 0 : 1,
                      c: CIHAZLAR.includes(govde.c) ? govde.c : '' };
      if (alan) kayit.r = alan;
      if (Object.keys(k).length) kayit.k = k;
      if (govde.a === 1) kayit.a = 1;   // bağlantı sayfa içindeki bir bölüme atlattı: derinlik okuma sayılmaz
      if (!yaz(gun, kayit)) return false;
      aktif.set(id, { at: t, s: -1, d: -1 });
      return true;
    }
    if (govde.t === 'f') {   // 08.11: forma dokunma (bir alana ilk giriş); içerik gelmez, açılış başına bir kez
      const a = aktif.get(id);
      if (a && a.f) return false;
      if (!yaz(gun, { t: 'f', i: id })) return false;
      if (a) a.f = 1;
      return true;
    }
    if (govde.t === 't') {   // İ4: sayfadaki telefon numarasına (tel: bağlantısı) basma; numara gelmez, açılış başına bir kez
      const a = aktif.get(id);
      if (a && a.tl) return false;
      if (!yaz(gun, { t: 't', i: id })) return false;
      if (a) a.tl = 1;
      return true;
    }
    if (govde.t === 's') {
      const s = tamSayi(govde.s, 0, 86400), d = tamSayi(govde.d, 0, 100);
      if (s === null) return false;
      const a = aktif.get(id);
      if (a && a.s >= s && a.d >= (d ?? -1)) return false;
      const kayit = { t: 's', i: id, s };
      if (d !== null) kayit.d = d;
      if (!yaz(gun, kayit)) return false;
      if (a) { a.s = Math.max(a.s, s); a.d = Math.max(a.d, d ?? -1); a.at = t; }
      return true;
    }
    return false;
  }

  function satirlar(gun) {
    try {
      return fs.readFileSync(hamDosya(gun), 'utf8').split('\n').filter(Boolean).map(x => { try { return JSON.parse(x); } catch (e) { return null; } }).filter(Boolean);
    } catch (e) { return []; }
  }

  // Bir günün kesin özeti. Süre güncellemeleri ertesi güne taşabilir (gece yarısını geçen ziyaret, sunucu yeniden başlaması),
  // bu yüzden gün, ertesi gün de bittikten sonra kesinleşir ve diske yazılır.
  function gunOzeti(gun) {
    const t = simdi(), bugun = istanbulGunu(t), kesin = gun <= gunEkle(bugun, -2);
    const bellek = onbellek.get(gun);
    if (bellek && (bellek.kesin || t - bellek.at < 60000)) return bellek.veri;
    if (kesin) {
      try {
        const veri = JSON.parse(fs.readFileSync(ozetDosya(gun), 'utf8'));
        onbellek.set(gun, { at: t, kesin: true, veri });
        return veri;
      } catch (e) {}
    }
    const ziyaret = new Map();
    const sureler = [], formlar = new Set(), telefonlar = new Set();
    for (const x of satirlar(gun)) {
      if (x.t === 'g' && !ziyaret.has(x.i)) ziyaret.set(x.i, { ...x, s: -1, d: -1 });
      else if (x.t === 's') sureler.push(x);
      else if (x.t === 'f') formlar.add(x.i);
      else if (x.t === 't') telefonlar.add(x.i);
    }
    for (const x of satirlar(gunEkle(gun, 1))) {
      if (x.t === 's') sureler.push(x);
      else if (x.t === 'f') formlar.add(x.i);
      else if (x.t === 't') telefonlar.add(x.i);
    }
    for (const x of sureler) {
      const v = ziyaret.get(x.i);
      if (!v) continue;
      v.s = Math.max(v.s, Number(x.s) || 0);
      if (x.d != null) v.d = Math.max(v.d, Number(x.d) || 0);
    }
    const veri = { gun, g: 0, e: 0, sayfalar: {}, ref: {}, kamp: {}, saat: Array(24).fill(0) };
    for (const v of ziyaret.values()) {
      const r = veri.sayfalar[v.p] || (veri.sayfalar[v.p] = bosSatir(v.p));
      r.g++; veri.g++;
      if (v.e) { r.e++; veri.e++; }
      if (v.s >= 0) {
        const s = Math.min(SURE_SINIRI, v.s);
        r.sk++; r.sn += s; r.b[dilim(s)]++;
        if (s < KISA_ESIGI) r.ks++;
      }
      if (v.d >= 0 && !v.a) { r.dk++; r.dt += v.d; if (v.d >= OKUMA_ESIGI) r.o++; }
      const formaDokundu = formlar.has(v.i), telefonaDokundu = telefonlar.has(v.i);
      if (formaDokundu) r.fb++;
      if (telefonaDokundu) r.tb++;
      if (KAYNAK_TURLERI.includes(v.rt)) r.kay[v.rt]++;
      if (CIHAZLAR.includes(v.c)) r.cih[v.c]++;
      if (Number.isInteger(v.h) && v.h >= 0 && v.h < 24) veri.saat[v.h]++;
      if (v.e && v.r) veri.ref[v.r] = (veri.ref[v.r] || 0) + 1;
      if (v.k && (v.k.s || v.k.m || v.k.c)) {
        const anahtar = [v.k.s || '', v.k.m || '', v.k.c || ''].join('|');
        const kp = veri.kamp[anahtar] || (veri.kamp[anahtar] = { g: 0, e: 0, sk: 0, sn: 0, fb: 0, tb: 0, yollar: {} });
        kp.g++; if (v.e) kp.e++;
        if (formaDokundu) kp.fb++;
        if (telefonaDokundu) kp.tb = (kp.tb || 0) + 1;
        if (v.s >= 0) { kp.sk++; kp.sn += Math.min(SURE_SINIRI, v.s); }
        kp.yollar[v.p] = (kp.yollar[v.p] || 0) + 1;
      }
    }
    onbellek.set(gun, { at: t, kesin, veri });
    if (kesin && veri.g > 0) {   // boş gün için dosya açılmaz
      try { fs.writeFileSync(ozetDosya(gun), JSON.stringify(veri), { mode: 0o600 }); } catch (e) {}
    }
    if (onbellek.size > 900) onbellek.delete(onbellek.keys().next().value);
    return veri;
  }

  function ilkGun() {
    try {
      const gunler = fs.readdirSync(kok).map(a => (a.match(/^(?:olay|gun)-(\d{4}-\d{2}-\d{2})\.jsonl?$/) || [])[1]).filter(Boolean).sort();
      return gunler[0] || null;
    } catch (e) { return null; }
  }

  function sayfaCiktisi(r, baslik, son7, onceki7) {
    return {
      yol: r.yol, baslik: baslik(r.yol), tur: r.yol.startsWith('/blog/') ? 'blog_yazisi' : 'sayfa',
      goruntulenme: r.g, giris: r.e, olculen: r.sk, ort_sure_sn: ortalama(r.sn, r.sk), toplam_sure_sn: r.sn,
      okuma_orani: oran(r.o, r.dk), ort_derinlik: ortalama(r.dt, r.dk), kisa_kalma_orani: oran(r.ks, r.sk), dagilim: r.b,
      form_baslatan: r.fb || 0, form_baslatma_orani: oran(r.fb || 0, r.g),
      telefon_tiklayan: r.tb || 0, telefon_tiklama_orani: oran(r.tb || 0, r.g),
      kaynaklar: r.kay, cihaz: r.cih, son_7_gun: son7, onceki_7_gun: onceki7
    };
  }

  // Yönetici paneli ve ajan sistemi için dönem özeti. ayrinti=true gün gün sayfa satırlarını da verir (sistem eşitlemesi).
  function ozet(secim = {}) {
    const gunSayisi = tamSayi(secim.gun, 1, 400) || 30;
    const baslik = secim.baslik || (y => y);
    const bugun = istanbulGunu(simdi());
    const gunler = Array.from({ length: gunSayisi }, (_, i) => gunEkle(bugun, i - gunSayisi + 1));
    const oncekiGunler = Array.from({ length: gunSayisi }, (_, i) => gunEkle(gunler[0], i - gunSayisi));
    const gunluk = gunler.map(gunOzeti);
    const toplamSatir = bosSatir('*'), sayfalar = {}, ref = {}, kamp = {}, saat = Array(24).fill(0);
    // Sayfa eğilimi dönemden bağımsız: son 7 gün ile ondan önceki 7 gün.
    const yedi = {}, ondort = {};
    for (let i = 0; i < 14; i++) {
      const g = gunOzeti(gunEkle(bugun, -i)), hedef = i < 7 ? yedi : ondort;
      for (const r of Object.values(g.sayfalar)) hedef[r.yol] = (hedef[r.yol] || 0) + r.g;
    }
    for (const g of gunluk) {
      for (const r of Object.values(g.sayfalar)) {
        satirEkle(toplamSatir, r);
        satirEkle(sayfalar[r.yol] || (sayfalar[r.yol] = bosSatir(r.yol)), r);
      }
      for (const [a, n] of Object.entries(g.ref)) ref[a] = (ref[a] || 0) + n;
      for (const [a, x] of Object.entries(g.kamp)) {
        const k = kamp[a] || (kamp[a] = { g: 0, e: 0, sk: 0, sn: 0, fb: 0, tb: 0, yollar: {} });
        k.g += x.g; k.e += x.e; k.sk += x.sk; k.sn += x.sn; k.fb += x.fb || 0; k.tb += x.tb || 0;
        for (const [y, n] of Object.entries(x.yollar || {})) k.yollar[y] = (k.yollar[y] || 0) + n;
      }
      g.saat.forEach((n, i) => { saat[i] += n; });
    }
    const onceki = bosSatir('*');
    for (const g of oncekiGunler.map(gunOzeti)) for (const r of Object.values(g.sayfalar)) satirEkle(onceki, r);
    // Kaynak türü her görüntüleme için tutulur; "ic" site içi gezinmedir, diğerleri dışarıdan geliştir.
    const kaynaklar = Object.fromEntries(KAYNAK_TURLERI.map(k => [k, toplamSatir.kay[k]]));
    const sonuc = {
      surum: 1, uretim: new Date(simdi()).toISOString(), zaman_dilimi: 'Europe/Istanbul',
      aralik: { bas: gunler[0], son: bugun, gun: gunSayisi }, sayac_baslangici: ilkGun(),
      telefon_olcum_baslangici: olcumBaslangici.telefon || null,
      toplam: {
        goruntulenme: toplamSatir.g, giris: toplamSatir.e, olculen: toplamSatir.sk,
        ort_sure_sn: ortalama(toplamSatir.sn, toplamSatir.sk), toplam_sure_sn: toplamSatir.sn,
        okuma_orani: oran(toplamSatir.o, toplamSatir.dk), kisa_kalma_orani: oran(toplamSatir.ks, toplamSatir.sk),
        form_baslatan: toplamSatir.fb, telefon_tiklayan: toplamSatir.tb, dagilim: toplamSatir.b, cihaz: toplamSatir.cih
      },
      onceki_donem: { bas: oncekiGunler[0], son: oncekiGunler[oncekiGunler.length - 1], goruntulenme: onceki.g, giris: onceki.e,
                      ort_sure_sn: ortalama(onceki.sn, onceki.sk) },
      gunluk: gunluk.map(g => {
        const t = bosSatir('*');
        for (const r of Object.values(g.sayfalar)) satirEkle(t, r);
        return { gun: g.gun, goruntulenme: g.g, giris: g.e, ort_sure_sn: ortalama(t.sn, t.sk) };
      }),
      sayfalar: Object.values(sayfalar).sort((a, b) => b.g - a.g || a.yol.localeCompare(b.yol))
        .map(r => sayfaCiktisi(r, baslik, yedi[r.yol] || 0, ondort[r.yol] || 0)),
      kaynaklar,
      yonlendirenler: Object.entries(ref).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([alan, n]) => ({ alan, giris: n, tur: kaynakTuru(false, alan, {}) })),
      kampanyalar: Object.entries(kamp).sort((a, b) => b[1].g - a[1].g).slice(0, 40).map(([a, x]) => {
        const [kaynak, ortam, kampanya] = a.split('|');
        return { kaynak, ortam, kampanya, goruntulenme: x.g, giris: x.e, ort_sure_sn: ortalama(x.sn, x.sk), form_baslatan: x.fb,
                 telefon_tiklayan: x.tb,
                 sayfalar: Object.entries(x.yollar).sort((p, q) => q[1] - p[1]).slice(0, 5).map(([yol, n]) => ({ yol, goruntulenme: n })) };
      }),
      saatler: saat,
      dilimler: DILIM_ADLARI,
      notlar: [
        'Yalnız JavaScript çalıştıran tarayıcılar sayılır; arama motoru botları ve otomasyon araçları sayılmaz.',
        'Süre, sayfanın ekranda açık (görünür) kaldığı süredir; tek görüntülemede en çok 30 dakika sayılır.',
        'Benzersiz ziyaretçi sayılmaz (çerez ve kalıcı kimlik yok). "Giriş", siteye dışarıdan gelinen ilk sayfa görüntülemesidir.',
        'Okuma oranı, sayfanın en az %75\'ine kadar inilen görüntülemelerin payıdır; ekrana sığan kısa sayfalarda yüksek görünür. Bağlantıyla sayfa içindeki bir bölüme (#...) atlanan açılışlar 08.11.2026\'dan beri okuma oranına katılmaz.',
        'Forma dokunan: bir form alanına en az bir kez girilen görüntüleme (08.11.2026\'dan beri; yazılan içerik gelmez).',
        'Telefona dokunan: sayfadaki telefon numarasına en az bir kez basılan görüntüleme (' + (olcumBaslangici.telefon || 'yeni') +
          ' tarihinden beri; öncesi ölçülmedi). Aramanın yapıldığını göstermez; numara veya başka bilgi gelmez.',
        'Yönetici panelinde "sayma" işaretlenen tarayıcının ziyaretleri sayılmaz.'
      ]
    };
    if (secim.ayrinti) {
      sonuc.gunler = gunluk.map(g => ({ gun: g.gun, goruntulenme: g.g, giris: g.e, saatler: g.saat, yonlendirenler: g.ref,
                                        kampanyalar: g.kamp, sayfalar: Object.values(g.sayfalar) }));
      sonuc.alanlar = { g: 'görüntülenme', e: 'giriş', sk: 'süresi ölçülen', sn: 'toplam süre (sn)', dk: 'derinliği ölçülen',
                        dt: 'toplam derinlik (%)', o: 'okunan (%75+)', ks: 'kısa kalma (<10 sn)', fb: 'forma dokunan', tb: 'telefona dokunan', b: 'süre dağılımı', kay: 'kaynak türü', cih: 'cihaz' };
    }
    return sonuc;
  }

  return { olay, ozet, gunOzeti, _aktif: aktif };
}

module.exports = { olustur, istanbulGunu, gunEkle, kaynakTuru, temizEtiket, temizAlan, SURE_SINIRI, DILIMLER, DILIM_ADLARI };
