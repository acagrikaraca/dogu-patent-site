const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } = require('node:fs');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { setTimeout: delay } = require('node:timers/promises');
const oyunSayac = require('../oyun-sayac');
const sayacModulu = require('../sayac');

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
const UA_MOBIL = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
const OYUN = 'https://oyun.dogupatent.com';

function kur(baslangic, ek = {}) {
  const kok = mkdtempSync(path.join(tmpdir(), 'dp-oyun-sayac-'));
  const saat = { t: Date.parse(baslangic) };
  const yeni = () => oyunSayac.olustur({ kok, simdi: () => saat.t, yazmaGecikmesi: 0, ...ek });
  return { kok, saat, yeni, sayac: yeni(), temizle: () => rmSync(kok, { recursive: true, force: true }) };
}
let adresNo = 0;
const gonder = (s, govde, ek = {}) => s.olay(govde, { kaynak: OYUN, ua: UA, adres: '10.0.0.' + (++adresNo % 200), ...ek });
const kim = n => String(n).padStart(16, '0').replace(/[^0-9a-f]/g, 'a');
const ileri = (k, sn) => { k.saat.t += sn * 1000; };

test('Oyun: girdi temizliği — bozuk, eksik veya fazla değer kabul edilmez; sınırlar uygulanır', () => {
  const coz = oyunSayac.olayCoz;
  assert.deepEqual(coz({ k: 'abcdef0123456789', o: 'a', z: 1, s: 0, y: 0, r: 'www.Google.com' }), { k: 'abcdef0123456789', o: 'a', z: 1, s: 0, y: 0, r: 'google.com' });
  assert.equal(coz({ k: 'ABCDEF0123456789', o: 'a', z: 1, s: 0, y: 0 }), null, 'büyük harf kimlik');
  assert.equal(coz({ k: 'abcdef012345678', o: 'a', z: 1, s: 0, y: 0 }), null, '15 karakter');
  assert.equal(coz({ k: 'abcdef0123456789', o: 'x', z: 1, s: 0, y: 0 }), null, 'bilinmeyen olay');
  assert.equal(coz({ k: 'abcdef0123456789', o: 'n', z: '1', s: 0, y: 0 }), null, 'metin sayı kabul edilmez');
  assert.equal(coz({ k: 'abcdef0123456789', o: 'n', z: 1, s: 5 }), null, 'eksik alan');
  assert.equal(coz([1, 2]), null);
  assert.equal(coz(null), null);
  const x = coz({ k: 'abcdef0123456789', o: 'n', z: 123456, s: 99999, y: 99999, r: '<script>' });
  assert.equal(x.z, 9999);
  assert.equal(x.s, oyunSayac.SURE_SINIRI);
  assert.equal(x.y, oyunSayac.SURE_SINIRI);
  assert.equal(x.r, '', 'serbest metin yönlendiren atılır');
  assert.equal(coz({ k: 'abcdef0123456789', o: 'n', z: -3, s: 50, y: 80 }).y, 50, 'y ≤ s, z ≥ 0');
  assert.equal(oyunSayac.cihazTuru(UA_MOBIL), 'mobil');
  assert.equal(oyunSayac.cihazTuru('Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)'), 'tablet');
  assert.equal(oyunSayac.cihazTuru('Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/120 Safari/537.36'), 'tablet');
  assert.equal(oyunSayac.cihazTuru(UA), 'masaustu');
});

test('Oyun: yalnız izinli kaynaktan gelen olay sayılır; botlar ve tarayıcı bilgisi olmayanlar sayılmaz', () => {
  const k = kur('2026-11-15T09:00:00Z', { ekKaynaklar: 'http://localhost:8137, bozuk-adres' });
  try {
    const g = { k: 'aaaa0000bbbb1111', o: 'a', z: 1, s: 0, y: 0 };
    assert.equal(k.sayac.olay(g, { kaynak: 'https://kotu.example', ua: UA }), false);
    assert.equal(k.sayac.olay(g, { kaynak: '', ua: UA }), false, 'Origin yok');
    assert.equal(k.sayac.olay(g, { kaynak: 'null', ua: UA }), false);
    assert.equal(k.sayac.olay(g, { kaynak: 'https://dogupatent.com', ua: UA }), false, 'sitenin kendisi oyun kaynağı değildir');
    assert.equal(k.sayac.olay(g, { kaynak: OYUN, ua: 'Googlebot/2.1' }), false);
    assert.equal(k.sayac.olay(g, { kaynak: OYUN, ua: '' }), false);
    assert.equal(k.sayac.olay(g, { kaynak: 'http://localhost:8137', ua: UA }), true, 'ortam değişkeniyle eklenen kaynak');
    assert.equal(k.sayac.olay({ ...g, k: 'aaaa0000bbbb2222' }, { kaynak: OYUN, ua: UA }), true);
    assert.deepEqual([...k.sayac.kaynaklar].sort(), ['http://localhost:8137', OYUN]);
    const v = oyunSayac.olustur({ kok: path.join(k.kok, 'b') });
    assert.deepEqual([...v.kaynaklar], [OYUN], 'varsayılan liste');
    assert.equal(k.sayac.ozet().bugun.ziyaret, 2);
  } finally { k.temizle(); }
});

test('Oyun: birikimli değerlerin en büyüğü tutulur; eski veya sırası bozuk nabız süreyi düşürmez', () => {
  const k = kur('2026-11-15T09:00:00Z');
  try {
    const id = 'cccc0000dddd1111';
    gonder(k.sayac, { k: id, o: 'a', z: 1, s: 0, y: 0, r: 'www.instagram.com' });
    ileri(k, 20); gonder(k.sayac, { k: id, o: 'n', z: 1, s: 20, y: 5 });
    ileri(k, 20); gonder(k.sayac, { k: id, o: 'n', z: 1, s: 40, y: 25 });
    ileri(k, 1); gonder(k.sayac, { k: id, o: 'n', z: 1, s: 20, y: 5 });   // gecikmiş eski nabız
    ileri(k, 1); gonder(k.sayac, { k: id, o: 'b', z: 1, s: 41, y: 26 });
    const o = k.sayac.ozet();
    assert.equal(o.bugun.ziyaret, 1, 'aynı ziyaretin olayları tek ziyaret');
    assert.equal(o.bugun.oynamaSn.toplam, 26);
    assert.equal(o.bugun.sayfaSn.toplam, 41);
    assert.equal(o.sonZiyaretler[0].kaynak, 'sosyal');
    assert.equal(o.sonZiyaretler[0].alan, 'instagram.com');
    assert.equal(o.sonZiyaretler[0].cihaz, 'masaustu');
    assert.equal(o.sonZiyaretler[0].oyunda, false, 'bitiş gelen ziyaret oyunda değil');
  } finally { k.temizle(); }
});

test('Oyun: ziyaret ortadaki bir nabızdan da açılır; günü ilk görüldüğü İstanbul günüdür', () => {
  const k = kur('2026-11-14T20:59:30Z');   // İstanbul 23:59:30
  try {
    const id = 'eeee0000ffff1111';
    assert.equal(gonder(k.sayac, { k: id, o: 'n', z: 3, s: 600, y: 540 }), true, 'açılış görülmeden nabız');
    k.saat.t = Date.parse('2026-11-14T21:00:30Z');   // İstanbul 00:00:30, ertesi gün
    gonder(k.sayac, { k: id, o: 'n', z: 3, s: 660, y: 600 });
    const o = k.sayac.ozet();
    assert.equal(o.dun.ziyaret, 1);
    assert.equal(o.bugun.ziyaret, 0, 'gece yarısını geçen ziyaret yeni gün sayılmaz');
    assert.equal(o.dun.oynamaSn.toplam, 600);
    assert.equal(o.dun.geriGelen, 1);
    assert.equal(o.dun.kisi, 0);
  } finally { k.temizle(); }
});

test('Oyun: "şu an oyunda" son 60 sn içinde açılış/nabız gelen ziyaretlerdir', () => {
  const k = kur('2026-11-15T09:00:00Z');
  try {
    gonder(k.sayac, { k: '1111000000000001', o: 'a', z: 1, s: 0, y: 0 }, { ua: UA_MOBIL });
    gonder(k.sayac, { k: '1111000000000002', o: 'a', z: 2, s: 0, y: 0 });
    gonder(k.sayac, { k: '1111000000000003', o: 'a', z: 1, s: 0, y: 0 });
    ileri(k, 30);
    gonder(k.sayac, { k: '1111000000000003', o: 'b', z: 1, s: 30, y: 0 });   // sekme gizlendi
    let o = k.sayac.ozet();
    assert.equal(o.simdi.sayi, 2);
    assert.deepEqual(o.simdi.ziyaretler.map(v => v.cihaz).sort(), ['masaustu', 'mobil']);
    ileri(k, 31);   // ilk ikisinin son olayı 61 sn önce
    gonder(k.sayac, { k: '1111000000000002', o: 'n', z: 2, s: 61, y: 40 });
    o = k.sayac.ozet();
    assert.equal(o.simdi.sayi, 1);
    assert.equal(o.simdi.ziyaretler[0].kacinci, 2);
    assert.equal(o.simdi.ziyaretler[0].oynamaSn, 40);
    ileri(k, 5);
    gonder(k.sayac, { k: '1111000000000003', o: 'n', z: 1, s: 35, y: 0 });   // gizlenen sekme geri geldi
    assert.equal(k.sayac.ozet().simdi.sayi, 2);
    assert.equal(k.sayac.ozet().bugun.ziyaret, 3);
  } finally { k.temizle(); }
});

test('Oyun: kişi, sayılamayan, geri gelen ve "kaç kere" z sayılarından hesaplanır', () => {
  const k = kur('2026-11-15T09:00:00Z');
  try {
    // A: 1 kez, B: 2 kez, C: 3 kez, D: 5 kez, E: 12 kez; + 2 sayılamayan
    const kisiler = [1, 2, 3, 5, 12];
    let n = 0;
    for (const adet of kisiler) for (let z = 1; z <= adet; z++) gonder(k.sayac, { k: kim(++n), o: 'a', z, s: 0, y: 0 });
    gonder(k.sayac, { k: kim(++n), o: 'a', z: 0, s: 0, y: 0 });
    gonder(k.sayac, { k: kim(++n), o: 'a', z: 0, s: 0, y: 0 });
    const o = k.sayac.ozet();
    assert.equal(o.toplam.ziyaret, 23 + 2);
    assert.equal(o.toplam.kisi, 5);
    assert.equal(o.toplam.sayilamayan, 2);
    assert.equal(o.toplam.geriGelen, 18);
    assert.deepEqual(o.kacKere, { donem: 'toplam', bir: 1, iki: 1, uc: 1, dortBes: 1, altiOn: 0, ondanFazla: 1, sayilamayan: 2 });
  } finally { k.temizle(); }
});

test('Oyun: süre ortalaması, medyan, dağılım ve en uzun oynama', () => {
  const k = kur('2026-11-15T09:00:00Z');
  try {
    const y = [0, 5, 30, 120, 400, 1000, 2000];
    y.forEach((v, i) => gonder(k.sayac, { k: kim(500 + i), o: 'b', z: 1, s: v + 60, y: v }));
    const o = k.sayac.ozet().bugun;
    assert.equal(o.oynayan, 5, 'en az 10 sn oynayan');
    assert.equal(o.oynamaSn.toplam, 3555);
    assert.equal(o.oynamaSn.ortalama, Math.round(3550 / 5));
    assert.equal(o.oynamaSn.medyan, 400);
    assert.equal(o.oynamaSn.enUzun, 2000);
    assert.equal(o.sayfaSn.ortalama, Math.round((3555 + 7 * 60) / 7));
    assert.deepEqual(o.sureDagilimi.map(x => x.ziyaret), [2, 1, 1, 1, 1]);
    assert.equal(o.oynamayan, 1);
    assert.equal(oyunSayac.histMedyan([0, 0, 0, 0, 2]), 53, 'dilim sayımından yaklaşık medyan (45–60 sn diliminin ortası)');
  } finally { k.temizle(); }
});

test('Oyun: sunucu yeniden başlasa da açık ziyaret iki kez sayılmaz, süresi kaldığı yerden sürer', () => {
  const k = kur('2026-11-15T09:00:00Z');
  try {
    const id = '2222000000000001';
    gonder(k.sayac, { k: id, o: 'a', z: 4, s: 0, y: 0 });
    ileri(k, 600); gonder(k.sayac, { k: id, o: 'n', z: 4, s: 600, y: 500 });
    ileri(k, 30);
    const yeniden = k.yeni();   // deploy: bellek boş, aynı klasör
    assert.equal(yeniden.ozet().bugun.ziyaret, 1, 'diskteki ziyaret okunur');
    assert.equal(yeniden.ozet().simdi.sayi, 1, 'son nabız 30 sn önce');
    ileri(k, 20); gonder(yeniden, { k: id, o: 'n', z: 4, s: 650, y: 540 });
    const o = yeniden.ozet();
    assert.equal(o.bugun.ziyaret, 1);
    assert.equal(o.bugun.oynamaSn.toplam, 540);
    assert.equal(o.simdi.sayi, 1);
    // Bozuk dosya: kenara alınır, sunucu çalışmaya devam eder
    const dosya = readdirSync(k.kok).find(a => a.startsWith('ziyaret-'));
    writeFileSync(path.join(k.kok, dosya), '{bozuk');
    const bozuk = k.yeni();
    assert.equal(gonder(bozuk, { k: '2222000000000002', o: 'a', z: 1, s: 0, y: 0 }), true);
    assert.ok(readdirSync(k.kok).some(a => a.includes('.bozuk-')), 'bozuk dosya silinmez, kenara alınır');
    assert.ok(!readdirSync(k.kok).some(a => a.endsWith('.tmp')), 'yarım geçici dosya kalmaz');
  } finally { k.temizle(); }
});

test('Oyun: eski ziyaret kayıtları silinse de toplamlar küçülmez; başlangıçtan önceki dönem "ölçülmedi"', () => {
  const k = kur('2026-06-01T09:00:00Z');
  try {
    let o = k.sayac.ozet();
    assert.equal(o.olcumBaslangici, null);
    assert.equal(o.toplam.olculdu, false);
    assert.equal(o.toplam.ziyaret, null);
    gonder(k.sayac, { k: '3333000000000001', o: 'b', z: 1, s: 900, y: 800 });
    gonder(k.sayac, { k: '3333000000000002', o: 'b', z: 2, s: 100, y: 60 });
    o = k.sayac.ozet();
    assert.equal(o.dun.olculdu, false, 'ilk günden önceki gün ölçülmedi');
    assert.equal(o.dun.ziyaret, null);
    const once = o.toplam;
    k.saat.t = Date.parse('2026-11-15T09:00:00Z');   // 167 gün sonra
    const sonra = k.yeni();
    gonder(sonra, { k: '3333000000000003', o: 'a', z: 3, s: 0, y: 0 });   // gün değişimi temizliği çalıştırır
    assert.ok(!readdirSync(k.kok).includes('ziyaret-2026-06-01.json'), 'ham kayıt saklama süresinden sonra silinir');
    assert.ok(readdirSync(k.kok).includes('gun-2026-06-01.json'), 'günlük özet kalır');
    o = sonra.ozet();
    assert.equal(o.olcumBaslangici, '2026-06-01');
    assert.equal(o.toplam.ziyaret, once.ziyaret + 1);
    assert.equal(o.toplam.kisi, 1);
    assert.equal(o.toplam.oynamaSn.toplam, 860);
    assert.equal(o.toplam.oynamaSn.enUzun, 800);
    assert.equal(o.toplam.medyanYaklasik, true);
    assert.ok(o.toplam.oynamaSn.medyan >= 60 && o.toplam.oynamaSn.medyan <= 900);
    assert.deepEqual([o.kacKere.bir, o.kacKere.iki, o.kacKere.uc], [0, 0, 1]);
    assert.equal(o.son30.ziyaret, 1);
    assert.equal(o.gunler.length, 30);
    assert.equal(o.gunler.at(-1).ziyaret, 1);
  } finally { k.temizle(); }
});

test('Oyun: aynı bağlantıdan aşırı istek sınırı; adres ve tarayıcı bilgisi saklanmaz', () => {
  const k = kur('2026-11-15T09:00:00Z');
  try {
    let kabul = 0;
    for (let i = 0; i < 200; i++) if (k.sayac.olay({ k: kim(9000 + i), o: 'a', z: 1, s: 0, y: 0 }, { kaynak: OYUN, ua: UA, adres: '1.2.3.4' })) kabul++;
    assert.equal(kabul, 120);
    const ham = readFileSync(path.join(k.kok, readdirSync(k.kok).find(a => a.startsWith('ziyaret-'))), 'utf8');
    assert.ok(!ham.includes('1.2.3.4') && !ham.includes('Safari'), 'IP ve tarayıcı bilgisi saklanmaz');
  } finally { k.temizle(); }
});

// ---- gerçek sunucu üzerinden uçtan uca
async function sunucu(ortam = {}) {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dp-oyun-site-'));
  const rez = net.createServer();
  await new Promise(r => rez.listen(0, '127.0.0.1', r));
  const port = rez.address().port;
  await new Promise(r => rez.close(r));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, UPLOADS_DIR: path.join(dataDir, 'uploads'),
           SMTP_USER: '', SMTP_PASS: '', NOTIFY_EMAILS: '', ADMIN_USER: 'test-user', ADMIN_PASS: 'test-password',
           OYUN_SAYAC_KAYNAKLARI: '', ...ortam },
    stdio: 'ignore'
  });
  const url = `http://127.0.0.1:${port}`;
  const dur = async () => { if (child.exitCode === null) { child.kill(); await new Promise(r => child.once('exit', r)); } await rm(dataDir, { recursive: true, force: true }); };
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) return { url, dataDir, dur }; } catch {}
    await delay(30);
  }
  await dur();
  throw new Error('Test sunucusu açılmadı.');
}

test('Site: oyun ucu her durumda boş 204 döner; sayılar yalnız yönetici oturumuyla; site sayacı etkilenmez', async () => {
  const s = await sunucu();
  try {
    const at = (govde, kaynak = OYUN, ek = {}) => fetch(s.url + '/api/oyun-sayac', { method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=UTF-8', 'User-Agent': UA, ...(kaynak ? { Origin: kaynak } : {}), ...ek },
      body: typeof govde === 'string' ? govde : JSON.stringify(govde) });
    let r = await at({ k: 'abcdef0123456789', o: 'a', z: 1, s: 0, y: 0, r: 'www.dogupatent.com' });
    assert.equal(r.status, 204);
    assert.equal(await r.text(), '');
    assert.equal(r.headers.get('access-control-allow-origin'), OYUN);
    r = await at({ k: 'abcdef0123456789', o: 'n', z: 1, s: 20, y: 12 });
    assert.equal(r.status, 204);
    r = await at({ k: 'fedcba9876543210', o: 'a', z: 1, s: 0, y: 0 }, 'https://kotu.example');
    assert.equal(r.status, 204, 'yanlış kaynak da 204');
    assert.equal(r.headers.get('access-control-allow-origin'), null);
    assert.equal((await at({ k: 'fedcba9876543211', o: 'a', z: 1, s: 0, y: 0 }, '')).status, 204);
    assert.equal((await at('bozuk{')).status, 204);
    assert.equal((await at('x'.repeat(5000))).status, 204, 'büyük gövde de 204');
    assert.equal((await at({ k: 'fedcba9876543212', o: 'a', z: 1, s: 0, y: 0 }, OYUN, { 'User-Agent': 'curl/8.0' })).status, 204);

    assert.equal((await fetch(s.url + '/api/admin/oyun-sayac')).status, 401);
    const giris = await fetch(s.url + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kullanici: 'test-user', sifre: 'test-password' }) });
    const { token } = await giris.json();
    const o = await (await fetch(s.url + '/api/admin/oyun-sayac', { headers: { 'x-admin-token': token } })).json();
    assert.equal(o.bugun.ziyaret, 1, 'yalnız izinli kaynaktan, tarayıcıdan gelen');
    assert.equal(o.simdi.sayi, 1);
    assert.equal(o.bugun.oynayan, 1);
    assert.equal(o.sonZiyaretler[0].kaynak, 'site');
    assert.ok(readdirSync(path.join(s.dataDir, 'oyun-sayac')).length > 0, 'oyun verisi kendi klasöründe');
    // Site sayacı: oyun olayları ona girmez, çıktısı eskisi gibidir
    const site = await (await fetch(s.url + '/api/admin/sayac?gun=7', { headers: { 'x-admin-token': token } })).json();
    assert.equal(site.toplam.goruntulenme, 0);
    assert.deepEqual(Object.keys(site), ['surum', 'uretim', 'zaman_dilimi', 'aralik', 'sayac_baslangici', 'telefon_olcum_baslangici', 'toplam',
      'onceki_donem', 'gunluk', 'sayfalar', 'kaynaklar', 'yonlendirenler', 'kampanyalar', 'saatler', 'dilimler', 'notlar']);
    assert.deepEqual(readdirSync(path.join(s.dataDir, 'sayac')), ['olcum-baslangic.json'], 'site sayacı klasörüne oyun dosyası yazılmaz');
    assert.match(await (await fetch(s.url + '/admin')).text(), /data-tab="oyun"/);
  } finally { await s.dur(); }
});

test('Site sayacı: oyun sayacı eklenince çıktısı değişmez (aynı olaylar, aynı özet)', () => {
  const kok = mkdtempSync(path.join(tmpdir(), 'dp-sayac-ayni-'));
  try {
    const t = Date.parse('2026-11-15T09:00:00Z');
    const yolCoz = p => (p === '/' ? '/' : '/404');
    const s = sayacModulu.olustur({ kok: path.join(kok, 'sayac'), yolCoz, simdi: () => t });
    const o = oyunSayac.olustur({ kok: path.join(kok, 'oyun-sayac'), simdi: () => t, yazmaGecikmesi: 0 });
    s.olay({ t: 'g', i: 'aaaaaaaaaaaaaaaa', p: '/' }, { ua: UA, adres: '1.1.1.1' });
    o.olay({ k: 'aaaaaaaaaaaaaaaa', o: 'a', z: 1, s: 0, y: 0 }, { kaynak: OYUN, ua: UA, adres: '1.1.1.1' });
    const ozet = s.ozet({ gun: 7 });
    assert.equal(ozet.toplam.goruntulenme, 1);
    assert.equal(s.olay({ k: 'aaaaaaaaaaaaaaab', o: 'a', z: 1, s: 0, y: 0 }, { ua: UA }), false, 'oyun olayı site sayacına girmez');
    assert.deepEqual(readdirSync(path.join(kok, 'sayac')).sort(), ['olay-2026-11-15.jsonl', 'olcum-baslangic.json']);
  } finally { rmSync(kok, { recursive: true, force: true }); }
});
