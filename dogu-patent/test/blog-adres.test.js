const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { setTimeout: delay } = require('node:timers/promises');

async function sunucu() {
  const dataDir = await mkdtemp(path.join(tmpdir(), 'dp-blog-adres-'));
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

test('Blog 09.11: adres yalnız slug gönderilince değişir; eski adres sorguyla birlikte yeni adrese 301 ile gider', async () => {
  const s = await sunucu();
  try {
    const { token } = await (await fetch(s.url + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kullanici: 'test-user', sifre: 'test-password' }) })).json();
    const h = { 'Content-Type': 'application/json', 'x-admin-token': token };
    const { post } = await (await fetch(s.url + '/api/admin/blog', { method: 'POST', headers: h,
      body: JSON.stringify({ baslik: 'Eski Başlık', icerik: '<p>Metin</p>', slug: 'eski-adres' }) })).json();
    assert.equal(post.slug, 'eski-adres');

    // Başlık değişince adres sabit kalır (eski davranış).
    let r = await fetch(`${s.url}/api/admin/blog/${post.id}`, { method: 'PUT', headers: h, body: JSON.stringify({ baslik: 'Yeni Başlık' }) });
    assert.equal((await r.json()).post.slug, 'eski-adres');

    // Geçersiz adres reddedilir.
    r = await fetch(`${s.url}/api/admin/blog/${post.id}`, { method: 'PUT', headers: h, body: JSON.stringify({ slug: 'Geçersiz Adres' }) });
    assert.equal(r.status, 400);

    r = await fetch(`${s.url}/api/admin/blog/${post.id}`, { method: 'PUT', headers: h, body: JSON.stringify({ slug: 'yeni-adres' }) });
    const yeni = (await r.json()).post;
    assert.equal(yeni.slug, 'yeni-adres');
    assert.deepEqual(yeni.eskiSluglar, ['eski-adres']);

    const yon = await fetch(`${s.url}/blog/eski-adres?utm_source=instagram&utm_campaign=gida_segment`, { redirect: 'manual' });
    assert.equal(yon.status, 301);
    assert.equal(yon.headers.get('location'), '/blog/yeni-adres?utm_source=instagram&utm_campaign=gida_segment', 'UTM korunur');
    assert.equal((await fetch(`${s.url}/blog/yeni-adres`)).status, 200);
    assert.equal((await (await fetch(`${s.url}/api/blog/eski-adres`)).json()).slug, 'yeni-adres', 'eski adresle API de yazıyı bulur');
    assert.equal((await fetch(`${s.url}/blog/hic-olmayan`, { redirect: 'manual' })).status, 404);

    const harita = await (await fetch(`${s.url}/sitemap.xml`)).text();
    assert.ok(harita.includes('/blog/yeni-adres') && !harita.includes('/blog/eski-adres'), 'site haritasında yalnız yeni adres');

    // Eski adres başka yazıya verilmez.
    r = await fetch(s.url + '/api/admin/blog', { method: 'POST', headers: h, body: JSON.stringify({ baslik: 'Başka', icerik: '<p>x</p>', slug: 'eski-adres' }) });
    assert.equal(r.status, 400);

    // Eski adrese geri dönülebilir; o zaman yönlendirme listesinden çıkar.
    r = await fetch(`${s.url}/api/admin/blog/${post.id}`, { method: 'PUT', headers: h, body: JSON.stringify({ slug: 'eski-adres' }) });
    const geri = (await r.json()).post;
    assert.equal(geri.slug, 'eski-adres');
    assert.deepEqual(geri.eskiSluglar, ['yeni-adres']);
  } finally { await s.dur(); }
});
