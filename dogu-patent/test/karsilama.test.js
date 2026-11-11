const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, rmSync } = require('node:fs');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { setTimeout: delay } = require('node:timers/promises');
const karsilama = require('../karsilama');
const sayacModulu = require('../sayac');

const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS]';
const REK2 = 'utm_source=meta&utm_medium=paid_social&utm_campaign=rek2_kobi_marka_tasarim';
const VIEWS = path.join(__dirname, '..', 'views');

async function sunucu() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dp-karsilama-'));
  const rez = net.createServer();
  await new Promise(r => rez.listen(0, '127.0.0.1', r));
  const port = rez.address().port;
  await new Promise(r => rez.close(r));
  const child = spawn(process.execPath, ['server.js'], {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, UPLOADS_DIR: path.join(dataDir, 'uploads'),
           SMTP_USER: '', SMTP_PASS: '', NOTIFY_EMAILS: '', ADMIN_USER: 'test-user', ADMIN_PASS: 'test-password' },
    stdio: 'ignore'
  });
  const url = `http://127.0.0.1:${port}`;
  const dur = async () => { if (child.exitCode === null) { child.kill(); await new Promise(r => child.once('exit', r)); } await rm(dataDir, { recursive: true, force: true }); };
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(url)).ok) return { url, dur }; } catch {}
    await delay(30);
  }
  await dur();
  throw new Error('Test sunucusu açılmadı.');
}

test('Karşılama: yalnız tanınan reklam kampanyası seçilir; sürüm utm_content ile', () => {
  assert.equal(karsilama.sec({}), null, 'etiketsiz ziyaret ana sayfayı görür');
  assert.equal(karsilama.sec({ utm_campaign: 'baska_kampanya' }), null);
  assert.equal(karsilama.sec({ utm_campaign: 'rek2_kobi_marka_tasarim' }).surum, '2A');
  assert.equal(karsilama.sec({ utm_campaign: 'REK2_KOBI_MARKA_TASARIM', utm_content: '2b' }).surum, '2B');
  assert.equal(karsilama.sec({ utm_campaign: 'rek2_kobi_marka_tasarim', utm_content: '9Z' }).surum, '2A');
  assert.equal(karsilama.sec({ utm_campaign: ['rek2_kobi_marka_tasarim', 'x'], utm_content: ['2B'] }).surum, '2B', 'tekrarlanan sorgu alanı');
  assert.equal(karsilama.sec({}, true).surum, '2A', 'kendi adresinde her zaman açılır');
});

test('Karşılama metni: reklamla aynı başlık, kaçışlı, yasak ifade ve bölüme atlama yok', () => {
  for (const kod of ['2A', '2B']) {
    const html = karsilama.render(karsilama.sec({ utm_campaign: 'rek2_kobi_marka_tasarim', utm_content: kod }), VIEWS, { kvkk: '2026-10-23' });
    assert.ok(html.includes(`<h1>${karsilama.ICERIK[kod].baslik}</h1>`));
    assert.ok(html.includes(karsilama.SON_NOT));
    assert.ok(!/\{\{[A-Z_]+\}\}/.test(html), 'doldurulmamış yer tutucu kalmaz');
    assert.ok(!/id="ucretsiz-arastirma"/.test(html), 'reklam bağlantısındaki #ucretsiz-arastirma sayfayı forma atlatmaz');
    assert.ok(!/yüz yüze|ofisimiz|Erzurum/i.test(html), 'yasak ifade ya da şehir/ofis vurgusu yok');
    assert.match(html, /<meta name="dp-sayac-yol" content="\/ucretsiz-marka-on-arastirma"\/>/);
    assert.match(html, /data-kvkk-versiyon="2026-10-23"/);
    assert.match(html, /method="post" action="\/api\/marka-arastirma"/, 'JS yoksa bilgiler adrese düşmez');
    const eposta = html.match(/<input\b[^>]*name="eposta"[^>]*>/)[0];
    assert.ok(!/\brequired\b/.test(eposta), 'e-posta isteğe bağlı');
    for (const ad of ['markaAdi', 'adSoyad', 'telefon']) assert.match(html.match(new RegExp(`<input\\b[^>]*name="${ad}"[^>]*>`))[0], /\brequired\b/);
  }
});

test('Karşılama 09.11: başlık → tek cümle → form → açıklama sırası (mobil ilk ekran)', () => {
  for (const kod of ['2A', '2B']) {
    const s = karsilama.ICERIK[kod];
    const html = karsilama.render(karsilama.sec({ utm_campaign: 'rek2_kobi_marka_tasarim', utm_content: kod }), VIEWS, { kvkk: '2026-10-23' });
    const h1 = html.indexOf(`<h1>${s.baslik}</h1>`), cumle = html.indexOf(s.cumle), form = html.indexOf('name="markaAdi"');
    const giris = html.indexOf(s.giris), uzaktan = html.indexOf(karsilama.UZAKTAN);
    assert.ok(s.cumle && h1 > 0 && cumle > h1 && form > cumle, 'tek cümle başlığın altında, form hemen ardından');
    assert.ok(giris > form && uzaktan > form, 'açıklama ve uzaktan çalışma satırı formun altında');
    assert.ok(html.indexOf(karsilama.SON_NOT) > form, 'ücretsizlik ve TÜRKPATENT notu kalır');
    assert.equal((html.match(/<input\b/g) || []).length, 6, 'form alanları değişmedi (5 alan + aydınlatma kutusu)');
    // İ4: numara formun hemen altında tam yazılı ve tıklanabilir (dar ekranda üst şeritte yalnız simge kalır)
    const telSatiri = html.indexOf('class="k-form-tel"');
    assert.ok(telSatiri > html.indexOf('</form>') && telSatiri < html.indexOf('id="k-basari"'), 'telefon satırı formun hemen altında');
    assert.match(html.slice(telSatiri, telSatiri + 400), /<a href="tel:08502428525"[^>]*>[\s\S]*0850 242 85 25<\/a>/);
    assert.ok(!/yüz yüze|ofisimiz|Erzurum/i.test(html));
  }
});

test('Site: reklam adresi karşılamayı, düz adres ana sayfayı açar; e-postasız başvuru kabul edilir', async () => {
  const s = await sunucu();
  try {
    const ana = await (await fetch(s.url + '/')).text();
    assert.match(ana, /Markanız Tescile Uygun mu\?/);
    assert.match(ana, /id="ucretsiz-arastirma"/);
    const a = await (await fetch(`${s.url}/?${REK2}&utm_content=2A`)).text();
    assert.match(a, /<h1>Markanız hangi sınıfta korunmalı\?<\/h1>/);
    const b = await (await fetch(`${s.url}/?${REK2}&utm_content=2B`)).text();
    assert.match(b, /<h1>Adınız marka, görünüşünüz tasarım<\/h1>/);
    const r = await fetch(s.url + '/ucretsiz-marka-on-arastirma');
    assert.equal(r.status, 200);
    assert.match(await r.text(), /data-kvkk-versiyon="2026-10-23"/, 'sunucunun güncel aydınlatma sürümü');
    assert.match(await (await fetch(`${s.url}/?utm_campaign=baska`)).text(), /Markanız Tescile Uygun mu\?/);

    const gonder = govde => fetch(s.url + '/api/marka-arastirma', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(govde) });
    const temel = { markaAdi: 'Deneme Marka', adSoyad: 'Test Kişi', telefon: '05000000000', kvkkOkundu: true, kvkkVersiyon: '2026-10-23' };
    const ok = await gonder(temel);
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).success, true);
    assert.equal((await gonder({ ...temel, telefon: '' })).status, 400, 'telefon zorunlu');
    assert.equal((await gonder({ ...temel, kvkkOkundu: 'on' })).status, 400, 'JS yoksa gelen düz form kabul edilmez');

    const giris = await fetch(s.url + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kullanici: 'test-user', sifre: 'test-password' }) });
    const { token } = await giris.json();
    const kayitlar = await (await fetch(s.url + '/api/admin/basvurular', { headers: { 'x-admin-token': token } })).json();
    const liste = Array.isArray(kayitlar) ? kayitlar : (kayitlar.data || kayitlar.basvurular || []);
    assert.equal(liste.at(-1).eposta, '');

    // sayaç: karşılama sayfası kendi yoluyla sayılır
    const olcum = govde => fetch(s.url + '/api/olcum', { method: 'POST', headers: { 'Content-Type': 'text/plain', 'User-Agent': UA }, body: JSON.stringify(govde) });
    await olcum({ v: 1, t: 'g', i: 'aaaa1111bbbb2222', p: '/ucretsiz-marka-on-arastirma', r: 'm.facebook.com', k: { s: 'meta', m: 'paid_social', c: 'rek2_kobi_marka_tasarim' }, c: 'mobil' });
    await olcum({ v: 1, t: 'f', i: 'aaaa1111bbbb2222', p: '/ucretsiz-marka-on-arastirma' });
    await olcum({ v: 1, t: 't', i: 'aaaa1111bbbb2222', p: '/ucretsiz-marka-on-arastirma' });   // İ4: telefona dokunma
    const o = await (await fetch(s.url + '/api/admin/sayac?gun=1', { headers: { 'x-admin-token': token } })).json();
    const k = o.sayfalar.find(x => x.yol === '/ucretsiz-marka-on-arastirma');
    assert.equal(k.baslik, 'Reklam karşılama: ücretsiz marka ön araştırması');
    assert.equal(k.form_baslatan, 1);
    assert.equal(k.telefon_tiklayan, 1);
    assert.equal(o.kampanyalar[0].form_baslatan, 1);
    assert.equal(o.kampanyalar[0].telefon_tiklayan, 1);
    assert.match(o.telefon_olcum_baslangici, /^\d{4}-\d{2}-\d{2}$/);
    const js = await (await fetch(s.url + '/js/main.js')).text();
    assert.match(js, /a\[href\^="tel:"\]/, 'site betiği tel: bağlantısına basışı sayar');
    assert.match(js, /t: 't', i: id, p: yol \}/, 'olay numarayı taşımaz');
  } finally { await s.dur(); }
});

test('Sayaç: forma dokunma açılış başına bir kez; bölüme atlanan açılış okuma oranına girmez', () => {
  const kok = mkdtempSync(path.join(tmpdir(), 'dp-sayac-f-'));
  const saat = { t: Date.parse('2026-11-08T09:00:00Z') };
  const s = sayacModulu.olustur({ kok, yolCoz: p => (p === '/' ? '/' : null), simdi: () => saat.t });
  let n = 0;
  const z = g => s.olay(g, { ua: UA, adres: '10.1.0.' + (++n) });
  try {
    z({ t: 'g', i: 'cccc1111dddd2222', p: '/', a: 1, k: { s: 'meta', m: 'paid_social', c: 'rek2' } });
    z({ t: 's', i: 'cccc1111dddd2222', s: 3, d: 92 });
    assert.equal(z({ t: 'f', i: 'cccc1111dddd2222' }), true);
    assert.equal(z({ t: 'f', i: 'cccc1111dddd2222' }), false, 'ikinci dokunma yazılmaz');
    z({ t: 'g', i: 'eeee1111ffff2222', p: '/' });
    z({ t: 's', i: 'eeee1111ffff2222', s: 40, d: 30 });
    const o = s.ozet({ gun: 1 });
    const ana = o.sayfalar.find(x => x.yol === '/');
    assert.equal(ana.goruntulenme, 2);
    assert.equal(ana.okuma_orani, 0, 'yalnız gerçekten kaydırılan açılış derinliğe girer');
    assert.equal(ana.ort_derinlik, 30);
    assert.equal(ana.form_baslatan, 1);
    assert.equal(ana.form_baslatma_orani, 50);
    assert.equal(o.toplam.form_baslatan, 1);
    assert.equal(o.kampanyalar.find(x => x.kampanya === 'rek2').form_baslatan, 1);
    const ayr = s.ozet({ gun: 1, ayrinti: true });
    assert.equal(ayr.gunler[0].kampanyalar['meta|paid_social|rek2'].fb, 1);
  } finally { rmSync(kok, { recursive: true, force: true }); }
});
