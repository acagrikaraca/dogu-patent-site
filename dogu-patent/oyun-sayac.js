'use strict';
// Oyun sayacı: oyun.dogupatent.com'daki tarayıcı oyununa kaç kişinin, kaç kez geldiği, şu an kaç kişinin oynadığı ve ne kadar oynandığı.
// Site sayacından (sayac.js) tamamen ayrıdır: kendi klasörü, kendi dosyaları, kendi uçları; site sayılarına hiçbir şey karışmaz.
// Kişisel veri tutulmaz: çerez, IP adresi, tarayıcı bilgisi veya kalıcı ziyaretçi kimliği saklanmaz.
// "k" yalnız bir sekmenin (bir ziyaretin) olaylarını birleştirmek içindir; sekme kapanınca tarayıcıda da kaybolur.
// "z" cihazda tutulan düz bir sayaçtır (kaçıncı ziyaret), kimlik değildir.
const fs = require('fs');
const path = require('path');
const { istanbulGunu, gunEkle, kaynakTuru, temizAlan } = require('./sayac');

const SURE_SINIRI = 4 * 3600;             // tek ziyarette sayılan en uzun sayfa / oynama süresi (sn)
const OYNAYAN_ESIGI = 10;                 // en az 10 sn oynanan ziyaret "oynayan"
const SIMDI_PENCERESI = 60 * 1000;        // son olayı açılış/nabız olan ve 60 sn içinde gelen ziyaret "şu an oyunda"
const ESLESME_GUN = 7;                    // bu kadar gün içindeki ziyaretler bellekte; geç gelen nabız eski ziyarete eklenir
const HAM_SAKLAMA_GUN = 120;              // ziyaret kayıtları; günlük özetler silinmez (toplam küçülmesin)
const GUNLUK_ZIYARET_SINIRI = 5000;       // bir günde açılan en çok yeni ziyaret kaydı (disk sigortası)
const DAKIKA_SINIRI = 1200;               // bütün oyun için dakikada en çok olay (oyuncu başına ≈3/dk)
const ADRES_SINIRI = 120;                 // aynı bağlantıdan 10 dakikada en çok olay; adres saklanmaz, yalnız bellekte sayılır
const YAZMA_GECIKMESI = 5000;             // değişen gün dosyası en geç bu kadar sonra diske yazılır
const VARSAYILAN_KAYNAKLAR = ['https://oyun.dogupatent.com'];
const CIHAZLAR = ['mobil', 'tablet', 'masaustu'];
const OLAYLAR = { a: 'acilis', n: 'nabiz', b: 'bitis' };
// sayac.js'teki bot süzgecinin aynısı (o dosyaya dokunulmasın diye burada kopyası var)
const BOT = /bot\b|bot\/|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|python|curl|wget|node-fetch|axios|go-http|java\/|httpclient|okhttp|monitor|uptime|scanner|phantom|selenium|puppeteer|playwright/i;
const SITE_ALANI = /(^|\.)dogupatent\.com$/;
// Oynama süresi dağılımı (oyuna başlayan ziyaretler, y > 0)
const DAGILIM_SINIRLARI = [60, 300, 900, 1800];
const DAGILIM_ADLARI = ['1 dk altı', '1–5 dk', '5–15 dk', '15–30 dk', '30 dk üstü'];
// Ayrıntılı ham kayıt silindikten sonra medyanı yaklaşık bulmak için ince süre dilimleri (sn)
const HIST = [10, 20, 30, 45, 60, 90, 120, 180, 240, 300, 420, 600, 900, 1200, 1800, 2700, 3600, 5400, 7200, 10800, SURE_SINIRI];
const Z_UST = 11;
const TAM_MEDYAN_GUN = 30;                         // "kaç kere" için z = 0…11 ayrı, 12 ve üstü tek kutuda tutulur

// ---- girdi temizliği
function temizKimlik(v) { return typeof v === 'string' && /^[0-9a-f]{16}$/.test(v) ? v : ''; }
function sayi(v, alt, ust) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return Math.min(ust, Math.max(alt, Math.round(v)));
}
function cihazTuru(ua) {
  if (/iPad|Tablet|PlayBook|Silk|Kindle|(Android(?!.*Mobile))/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|Windows Phone|IEMobile|Opera Mini/i.test(ua)) return 'mobil';
  return 'masaustu';
}
function kaynakListesi(ek) {
  const liste = new Set(VARSAYILAN_KAYNAKLAR);
  for (const k of String(ek || '').split(',')) {
    const s = k.trim().replace(/\/+$/, '');
    if (/^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/i.test(s)) liste.add(s.toLowerCase());
  }
  return liste;
}
// Olayı gövdeden çıkarır; bozuksa null.
function olayCoz(govde) {
  if (!govde || typeof govde !== 'object' || Array.isArray(govde)) return null;
  const k = temizKimlik(govde.k);
  if (!k || !OLAYLAR[govde.o]) return null;
  const z = sayi(govde.z, 0, 9999), s = sayi(govde.s, 0, SURE_SINIRI), y = sayi(govde.y, 0, SURE_SINIRI);
  if (z === null || s === null || y === null) return null;
  const r = govde.r == null ? '' : temizAlan(govde.r);
  return { k, o: govde.o, z, s, y: Math.min(y, s), r };
}
function rkTuru(alan) {
  if (!alan) return 'dogrudan';
  if (SITE_ALANI.test(alan)) return 'site';
  return kaynakTuru(false, alan, {});
}

function histIndeks(s) { let i = 0; while (i < HIST.length - 1 && s >= HIST[i]) i++; return i; }
function dagilimIndeks(s) { let i = 0; while (i < DAGILIM_SINIRLARI.length && s >= DAGILIM_SINIRLARI[i]) i++; return i; }
function ortalama(a, b) { return b ? Math.round(a / b) : null; }
function medyan(dizi) {
  if (!dizi.length) return null;
  const s = [...dizi].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}
// Dilim sayımından yaklaşık medyan (dilim içinde doğrusal)
function histMedyan(h) {
  const n = h.reduce((a, b) => a + b, 0);
  if (!n) return null;
  let hedef = n / 2, alt = 0;
  for (let i = 0; i < h.length; i++) {
    const ust = HIST[i];
    if (h[i] >= hedef) return Math.round(alt + (ust - alt) * (hedef / h[i]));
    hedef -= h[i]; alt = ust;
  }
  return SURE_SINIRI;
}

function bosOzet(gun) {
  return { gun, ziyaret: 0, z: Array(Z_UST + 2).fill(0), oynayan: 0, yT: 0, sT: 0, yOT: 0, yMax: 0, sMax: 0,
           yH: Array(HIST.length).fill(0), sH: Array(HIST.length).fill(0), dag: Array(DAGILIM_ADLARI.length).fill(0), oynamayan: 0,
           cih: Object.fromEntries(CIHAZLAR.map(c => [c, 0])) };
}
function ozeteEkle(o, v) {
  o.ziyaret++;
  o.z[Math.min(v.z, Z_UST + 1)]++;
  o.yT += v.y; o.sT += v.s;
  o.yMax = Math.max(o.yMax, v.y); o.sMax = Math.max(o.sMax, v.s);
  o.sH[histIndeks(v.s)]++;
  if (v.y >= OYNAYAN_ESIGI) { o.oynayan++; o.yOT += v.y; o.yH[histIndeks(v.y)]++; }
  if (v.y > 0) o.dag[dagilimIndeks(v.y)]++; else o.oynamayan++;
  if (CIHAZLAR.includes(v.c)) o.cih[v.c]++;
}
function ozetTopla(hedef, o) {
  for (const a of ['ziyaret', 'oynayan', 'yT', 'sT', 'yOT', 'oynamayan']) hedef[a] += o[a] || 0;
  hedef.yMax = Math.max(hedef.yMax, o.yMax || 0); hedef.sMax = Math.max(hedef.sMax, o.sMax || 0);
  for (const a of ['z', 'yH', 'sH', 'dag']) (o[a] || []).forEach((n, i) => { if (i < hedef[a].length) hedef[a][i] += n || 0; });
  for (const c of CIHAZLAR) hedef.cih[c] += (o.cih || {})[c] || 0;
}

function olustur(secenek) {
  const kok = secenek.kok;
  const simdi = secenek.simdi || (() => Date.now());
  const kaynaklar = kaynakListesi(secenek.ekKaynaklar);
  const gecikme = secenek.yazmaGecikmesi == null ? YAZMA_GECIKMESI : secenek.yazmaGecikmesi;
  fs.mkdirSync(kok, { recursive: true });

  const hamDosya = gun => path.join(kok, `ziyaret-${gun}.json`);
  const ozetDosya = gun => path.join(kok, `gun-${gun}.json`);
  const gunler = new Map();        // gün → Map(k → ziyaret kaydı)  (yalnız son ESLESME_GUN gün ve okunan günler)
  const anahtarlar = new Map();    // k → gün (bellekteki günler için)
  const kirli = new Set();
  const ozetler = new Map();       // gün → özet (geçmiş günler için bellek)
  const hamOnbellek = new Map();   // gün → bellekte olmayan günün okunmuş ziyaret kayıtları
  const adresSayaci = new Map();
  let dakika = { bas: 0, n: 0 }, adresTemizlik = 0, sonTemizlik = '', zamanlayici = null;

  function atomikYaz(dosya, metin) {
    const gecici = dosya + '.' + process.pid + '.tmp';
    fs.writeFileSync(gecici, metin, { mode: 0o600 });
    fs.renameSync(gecici, dosya);
  }
  function hamOku(gun) {
    let metin;
    try { metin = fs.readFileSync(hamDosya(gun), 'utf8'); } catch (e) { return null; }
    try {
      const dizi = JSON.parse(metin);
      if (!Array.isArray(dizi)) throw new Error('dizi değil');
      return dizi.filter(v => v && temizKimlik(v.k));
    } catch (e) {
      // Bozuk dosya üzerine yazılmasın: kenara alınır, gün boş başlar.
      console.error('[OYUN SAYAC] bozuk dosya kenara alındı:', path.basename(hamDosya(gun)));
      try { fs.renameSync(hamDosya(gun), hamDosya(gun) + '.bozuk-' + simdi()); } catch (e2) {}
      return null;
    }
  }
  function gunYukle(gun) {
    let m = gunler.get(gun);
    if (m) return m;
    m = new Map();
    for (const v of hamOku(gun) || []) { m.set(v.k, v); anahtarlar.set(v.k, gun); }
    gunler.set(gun, m);
    hamOnbellek.delete(gun);
    return m;
  }
  // Açılışta son günlerin ziyaretleri belleğe alınır: yeniden başlatmadan sonra gelen nabız eski kayda eklenir, iki kez sayılmaz.
  const bugunIlk = istanbulGunu(simdi());
  for (let i = ESLESME_GUN - 1; i >= 0; i--) gunYukle(gunEkle(bugunIlk, -i));

  function gunOzetiHesapla(gun, kayitlar) {
    const o = bosOzet(gun);
    for (const v of kayitlar) ozeteEkle(o, v);
    return o;
  }
  function kaydet() {
    if (zamanlayici) { clearTimeout(zamanlayici); zamanlayici = null; }
    for (const gun of [...kirli]) {
      const m = gunler.get(gun);
      if (!m) { kirli.delete(gun); continue; }
      const kayitlar = [...m.values()];
      try {
        atomikYaz(hamDosya(gun), JSON.stringify(kayitlar));
        const o = gunOzetiHesapla(gun, kayitlar);
        atomikYaz(ozetDosya(gun), JSON.stringify(o));   // özet her yazımda güncel; ham kayıt silinse de kalır
        ozetler.set(gun, o);
        kirli.delete(gun);
      } catch (e) {
        console.error('[OYUN SAYAC] yazılamadı:', e.code || e.message);
      }
    }
  }
  function kirlet(gun) {
    kirli.add(gun);
    ozetler.delete(gun);
    if (gecikme === 0) return kaydet();
    if (!zamanlayici) {
      zamanlayici = setTimeout(kaydet, gecikme);
      if (zamanlayici.unref) zamanlayici.unref();
    }
  }

  function siniriAs(adres, t) {
    if (t - dakika.bas > 60000) dakika = { bas: t, n: 0 };
    if (++dakika.n > DAKIKA_SINIRI) return true;
    if (t - adresTemizlik > 600000) { adresSayaci.clear(); adresTemizlik = t; }
    const anahtar = String(adres || '-').slice(0, 200);
    const n = (adresSayaci.get(anahtar) || 0) + 1;
    adresSayaci.set(anahtar, n);
    return n > ADRES_SINIRI;
  }
  function eskileriSil(bugun) {
    if (sonTemizlik === bugun) return;
    sonTemizlik = bugun;
    kaydet();
    // Bellekten: eşleşme süresini geçen günler (değişmemişse)
    const bellekSiniri = gunEkle(bugun, -(ESLESME_GUN - 1));
    for (const [gun, m] of gunler) {
      if (gun < bellekSiniri && !kirli.has(gun)) { for (const k of m.keys()) if (anahtarlar.get(k) === gun) anahtarlar.delete(k); gunler.delete(gun); }
    }
    // Diskten: saklama süresini geçen ham kayıtlar; özet yoksa önce özet yazılır. Günlük özetler silinmez.
    const hamSinir = gunEkle(bugun, -HAM_SAKLAMA_GUN);
    try {
      for (const ad of fs.readdirSync(kok)) {
        const m = ad.match(/^ziyaret-(\d{4}-\d{2}-\d{2})\.json$/);
        if (!m || m[1] >= hamSinir) continue;
        if (!fs.existsSync(ozetDosya(m[1]))) {
          try { atomikYaz(ozetDosya(m[1]), JSON.stringify(gunOzetiHesapla(m[1], hamOku(m[1]) || []))); } catch (e) { continue; }
        }
        try { fs.unlinkSync(path.join(kok, ad)); } catch (e) {}
        hamOnbellek.delete(m[1]);
      }
    } catch (e) {}
  }

  // Oyundan gelen tek olay. Kaydedilmediyse false döner; uç her durumda 204 yanıtlar.
  function olay(govde, baglam = {}) {
    const kaynak = String(baglam.kaynak || '').toLowerCase();
    if (!kaynaklar.has(kaynak)) return false;
    const ua = String(baglam.ua || '');
    if (!ua || BOT.test(ua)) return false;
    const x = olayCoz(govde);
    if (!x) return false;
    const t = simdi();
    if (siniriAs(baglam.adres, t)) return false;
    const bugun = istanbulGunu(t);
    eskileriSil(bugun);
    const eskiGun = anahtarlar.get(x.k);
    let v = eskiGun ? gunler.get(eskiGun).get(x.k) : null;
    if (!v) {
      // Ziyaret herhangi bir olaydan açılabilir (ör. sunucu yeniden başladıktan sonra ilk gelen nabız). Günü ilk görüldüğü gündür.
      const m = gunYukle(bugun);
      if (m.size >= GUNLUK_ZIYARET_SINIRI) return false;
      v = { k: x.k, b: t, son: t, o: x.o, z: x.z, s: x.s, y: x.y, c: cihazTuru(ua), rt: rkTuru(x.r) };
      if (x.r) v.r = x.r;
      m.set(x.k, v);
      anahtarlar.set(x.k, bugun);
      kirlet(bugun);
      return true;
    }
    const degisti = x.s > v.s || x.y > v.y || x.o !== v.o || (!v.z && x.z) || (x.r && !v.r);
    v.s = Math.max(v.s, x.s);
    v.y = Math.min(v.s, Math.max(v.y, x.y));
    if (!v.z && x.z) v.z = x.z;
    if (x.r && !v.r) { v.r = x.r; v.rt = rkTuru(x.r); }
    v.o = x.o; v.son = t;
    if (degisti) kirlet(eskiGun);   // yalnız zamanı değişen nabız diske yazılmaz (şu an hesabı bellekten)
    return true;
  }

  function ilkGun() {
    try {
      const gunListesi = fs.readdirSync(kok).map(a => (a.match(/^(?:ziyaret|gun)-(\d{4}-\d{2}-\d{2})\.json$/) || [])[1]).filter(Boolean).sort();
      const bellekte = [...gunler].filter(([, m]) => m.size).map(([g]) => g).sort();
      return [gunListesi[0], bellekte[0]].filter(Boolean).sort()[0] || null;
    } catch (e) { return null; }
  }
  // Bir günün ziyaret kayıtları (ham kayıt yoksa null). Bellekte olmayan gün artık değişmez; okunanı kısa bir önbellekte tutulur.
  function kayitlar(gun) {
    const m = gunler.get(gun);
    if (m) return [...m.values()];
    if (hamOnbellek.has(gun)) return hamOnbellek.get(gun);
    const h = hamOku(gun);
    hamOnbellek.set(gun, h);
    if (hamOnbellek.size > TAM_MEDYAN_GUN + 10) hamOnbellek.delete(hamOnbellek.keys().next().value);
    return h;
  }
  function gunOzeti(gun) {
    if (gunler.has(gun)) return gunOzetiHesapla(gun, [...gunler.get(gun).values()]);
    if (ozetler.has(gun)) return ozetler.get(gun);
    let o = null;
    try { o = JSON.parse(fs.readFileSync(ozetDosya(gun), 'utf8')); } catch (e) {}
    if (!o || typeof o !== 'object' || o.gun !== gun) {
      const h = hamOku(gun);
      o = h ? gunOzetiHesapla(gun, h) : bosOzet(gun);
    }
    ozetler.set(gun, o);
    if (ozetler.size > 2000) ozetler.delete(ozetler.keys().next().value);
    return o;
  }

  function donem(bas, son, ilk) {
    const t = bosOzet('*');
    const ySeri = [], sSeri = [];
    const istenenBas = bas;
    if (ilk && bas < ilk) bas = ilk;
    // Medyan 30 güne kadar ziyaret kayıtlarından tam; daha uzun dönemde (toplam) günlük dilim sayımından yaklaşık.
    let tam = gunEkle(bas, TAM_MEDYAN_GUN - 1) >= son;
    for (let g = bas; g <= son; g = gunEkle(g, 1)) {
      const o = gunOzeti(g);
      ozetTopla(t, o);
      if (!tam || !o.ziyaret) continue;
      const h = kayitlar(g);
      if (!h) { tam = false; continue; }
      for (const v of h) { sSeri.push(v.s); if (v.y >= OYNAYAN_ESIGI) ySeri.push(v.y); }
    }
    const olculdu = !!ilk && son >= ilk;
    const sonuc = {
      bas: istenenBas, son, olculdu,
      ziyaret: t.ziyaret, kisi: t.z[1], sayilamayan: t.z[0], geriGelen: t.ziyaret - t.z[0] - t.z[1], oynayan: t.oynayan,
      oynamaSn: { toplam: t.yT, ortalama: ortalama(t.yOT, t.oynayan), medyan: tam ? medyan(ySeri) : histMedyan(t.yH), enUzun: t.yMax },
      sayfaSn: { toplam: t.sT, ortalama: ortalama(t.sT, t.ziyaret), medyan: tam ? medyan(sSeri) : histMedyan(t.sH), enUzun: t.sMax },
      cihaz: t.cih,
      sureDagilimi: DAGILIM_ADLARI.map((ad, i) => ({ ad, ziyaret: t.dag[i] })), oynamayan: t.oynamayan
    };
    if (!tam) sonuc.medyanYaklasik = true;
    if (!olculdu) {   // sayaç bu dönemden sonra başladı: 0 değil, ölçülmedi
      for (const a of ['ziyaret', 'kisi', 'sayilamayan', 'geriGelen', 'oynayan', 'oynamayan']) sonuc[a] = null;
      for (const a of ['oynamaSn', 'sayfaSn']) for (const b of Object.keys(sonuc[a])) sonuc[a][b] = null;
      sonuc.cihaz = null; sonuc.sureDagilimi = null;
    }
    return { sonuc, z: t.z };
  }

  function simdikiler(t) {
    const liste = [];
    for (const m of gunler.values()) {
      for (const v of m.values()) {
        if ((v.o === 'a' || v.o === 'n') && t - v.son <= SIMDI_PENCERESI) liste.push(v);
      }
    }
    liste.sort((a, b) => a.b - b.b);
    return {
      sayi: liste.length,
      ziyaretler: liste.slice(0, 30).map(v => ({ baslangic: new Date(v.b).toISOString(), sayfaSn: v.s, oynamaSn: v.y, kacinci: v.z || null, cihaz: v.c })),
      pencereSn: SIMDI_PENCERESI / 1000
    };
  }

  // Yönetici paneli için tek özet
  function ozet() {
    kaydet();
    const t = simdi(), bugun = istanbulGunu(t), dun = gunEkle(bugun, -1);
    const ilk = ilkGun();
    const toplam = donem(ilk || bugun, bugun, ilk);
    const z = toplam.z;
    const fark = (a, b) => Math.max(0, (z[a] || 0) - (b == null ? 0 : (z[b] || 0)));
    const gunSatirlari = [];
    for (let i = 29; i >= 0; i--) {
      const g = gunEkle(bugun, -i), o = gunOzeti(g), olculdu = !!ilk && g >= ilk;
      gunSatirlari.push({ gun: g, olculdu, ziyaret: olculdu ? o.ziyaret : null, yeniKisi: olculdu ? o.z[1] : null,
                          geriGelen: olculdu ? o.ziyaret - o.z[0] - o.z[1] : null, oynayan: olculdu ? o.oynayan : null,
                          ortOynamaSn: ortalama(o.yOT, o.oynayan), toplamOynamaSn: olculdu ? o.yT : null });
    }
    const son = [];
    for (let i = 0; i < 30 && son.length < 50; i++) {
      const h = kayitlar(gunEkle(bugun, -i));
      if (h) son.push(...h);
    }
    son.sort((a, b) => b.b - a.b);
    return {
      surum: 1, uretim: new Date(t).toISOString(), zaman_dilimi: 'Europe/Istanbul', olcumBaslangici: ilk,
      simdi: simdikiler(t),
      bugun: donem(bugun, bugun, ilk).sonuc,
      dun: donem(dun, dun, ilk).sonuc,
      son7: donem(gunEkle(bugun, -6), bugun, ilk).sonuc,
      son30: donem(gunEkle(bugun, -29), bugun, ilk).sonuc,
      toplam: toplam.sonuc,
      // z = k olan ziyaret sayısı, en az k kez gelen kişi sayısıdır; tam k kez gelen = c(k) − c(k+1)
      kacKere: { donem: 'toplam', bir: fark(1, 2), iki: fark(2, 3), uc: fark(3, 4), dortBes: fark(4, 6), altiOn: fark(6, 11), ondanFazla: fark(11), sayilamayan: z[0] },
      sureDagilimi: toplam.sonuc.sureDagilimi,
      gunler: gunSatirlari,
      sonZiyaretler: son.slice(0, 50).map(v => ({
        baslangic: new Date(v.b).toISOString(), sayfaSn: v.s, oynamaSn: v.y, kacinci: v.z || null, cihaz: v.c,
        kaynak: v.rt, alan: v.r || null, oyunda: (v.o === 'a' || v.o === 'n') && t - v.son <= SIMDI_PENCERESI
      })),
      notlar: [
        'Kişi: cihazdaki ilk ziyaret (bu tarayıcıda oyun ilk kez açıldı). Aynı kişi başka tarayıcı veya cihazdan gelirse yeniden sayılır; tarayıcı verisi silinirse de.',
        'Sayılamayan: tarayıcı kayıt tutmaya izin vermediği için kaçıncı ziyaret olduğu bilinmeyen ziyaret; kişi sayısına katılmaz.',
        'Oynayan: başlangıç noktası seçilip en az 10 saniye oynanan ziyaret. Ortalama ve medyan oynama süresi yalnız oynayan ziyaretlerden hesaplanır; toplam oynama bütün ziyaretlerin toplamıdır.',
        'Sayfa süresi, oyun sayfasının ekranda açık (görünür) kaldığı süredir. Tek ziyarette en çok 4 saat sayılır.',
        'Mobilden gelen: telefon veya tabletle açılan ziyaret. Oyun bu cihazlarda açılmaz, yalnız "mobil sürüm yok" bilgisi gösterilir; bu ziyaretler sayılır ama süreleri sıfırdır ve "şu an oyunda" görünmezler.',
        'Şu an oyunda: son 60 saniye içinde oyundan haber gelen açık sekme.',
        '"Kaç kere geldi" tablosu bütün ölçüm süresi içindir; her ziyaretin kaçıncı ziyaret olduğundan hesaplanır.',
        'Çerez, IP adresi veya kalıcı kimlik kullanılmaz; botlar sayılmaz.'
      ]
    };
  }

  return { olay, ozet, kaydet, gunOzeti, kaynaklar };
}

module.exports = { olustur, olayCoz, cihazTuru, kaynakListesi, histMedyan, SURE_SINIRI, DAGILIM_ADLARI, OYNAYAN_ESIGI };
