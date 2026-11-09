require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const multer = require('multer');
const nodemailer = require('nodemailer');
const blogSeo = require('./blog-seo');
const sayacModulu = require('./sayac');
const karsilama = require('./karsilama');

const app = express();
const PORT = process.env.PORT || 3000;

// ===== ADMIN CREDENTIALS (server-side only, never sent to browser) =====
const ADMIN_USER = process.env.ADMIN_USER || '';
const ADMIN_PASS = process.env.ADMIN_PASS || '';

const KVKK_VERSION = '2026-10-23';

// Active session tokens (in-memory, cleared on server restart)
const activeSessions = new Map();
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function isValidSession(token) {
  if (!token || !activeSessions.has(token)) return false;
  const session = activeSessions.get(token);
  if (Date.now() > session.expires) {
    activeSessions.delete(token);
    return false;
  }
  return true;
}

// Admin auth middleware - protects all /api/admin/* routes
function adminAuth(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (isValidSession(token)) return next();
  res.status(401).json({ success: false, message: 'Oturum geçersiz. Lütfen giriş yapın.' });
}

// ===== Talep kaynağı (UTM / reklam tıklama kimliği) =====
// Yalnız beklenen alanlar, kısa ve güvenli karakterlerle saklanır; kişisel veri içermez.
const KAYNAK_ALANLARI = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid', 'giris_sayfasi', 'yonlendiren', 'zaman'];
function temizKaynakDegeri(v) {
  return String(v == null ? '' : v).replace(/[^\p{L}\p{N} ._\-\/:+@%=]/gu, '').trim().slice(0, 200);
}
function temizKaynakTemasi(t) {
  if (!t || typeof t !== 'object' || Array.isArray(t)) return null;
  const out = {};
  for (const k of KAYNAK_ALANLARI) {
    const v = temizKaynakDegeri(t[k]);
    if (v) out[k] = v;
  }
  return Object.keys(out).length ? out : null;
}
function temizKaynak(k) {
  if (!k || typeof k !== 'object' || Array.isArray(k)) return null;
  const ilk = temizKaynakTemasi(k.ilk), son = temizKaynakTemasi(k.son);
  return ilk || son ? { ilk, son } : null;
}
function kaynakOzeti(k) {
  const t = k && (k.son || k.ilk);
  if (!t) return 'bilinmiyor (doğrudan giriş veya kaynak bilgisi yok)';
  const parca = [t.utm_source, t.utm_medium, t.utm_campaign].filter(Boolean).join(' / ');
  const tik = t.gclid ? 'Google reklam tıklaması' : (t.fbclid ? 'Meta tıklaması' : '');
  return [parca, tik, t.yonlendiren ? 'yönlendiren: ' + t.yonlendiren : ''].filter(Boolean).join(' · ') || 'bilinmiyor';
}

// ===== Mail Gönderme Fonksiyonu =====
async function mailGonder(konu, metinIcerik, htmlIcerik) {
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const alicilar = (process.env.NOTIFY_EMAILS || '').split(',').map(m => m.trim()).filter(Boolean);

  if (!smtpUser || !smtpPass) {
    console.warn('[MAIL] SMTP_USER veya SMTP_PASS tanımlı değil, mail atlanıyor.');
    return;
  }
  if (alicilar.length === 0) {
    console.warn('[MAIL] NOTIFY_EMAILS tanımlı değil, mail atlanıyor.');
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: Number(process.env.SMTP_PORT || 587),
    secure: String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    auth: { user: smtpUser, pass: smtpPass }
  });

  await transporter.sendMail({
    from: process.env.MAIL_FROM || smtpUser,
    to: alicilar.join(','),
    subject: konu,
    text: metinIcerik,
    html: htmlIcerik
  });

  console.log(`[MAIL] Gönderildi -> ${alicilar.join(', ')}`);
}

// ===== Kalici Depolama =====
const APP_ROOT = __dirname;
const PUBLIC_ROOT = path.join(APP_ROOT, 'public');
const VIEWS_ROOT = path.join(APP_ROOT, 'views');
const LEGACY_DATA_ROOT = path.join(APP_ROOT, 'data');
const LEGACY_BLOG_UPLOAD_DIR = path.join(PUBLIC_ROOT, 'uploads', 'blog');

function resolveStoragePath(target) {
  return path.isAbsolute(target) ? target : path.resolve(APP_ROOT, target);
}

const STORAGE_ROOT = resolveStoragePath(process.env.DATA_DIR || '../shared-data');
const UPLOAD_ROOT = resolveStoragePath(process.env.UPLOADS_DIR || path.join(STORAGE_ROOT, 'uploads'));
const BLOG_UPLOAD_DIR = path.join(UPLOAD_ROOT, 'blog');
const BLOG_PUBLIC_PREFIX = '/uploads/blog';

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function dataFile(name) {
  return path.join(STORAGE_ROOT, name);
}

function copyFileIfMissing(source, target) {
  if (fs.existsSync(source) && !fs.existsSync(target)) fs.copyFileSync(source, target);
}

function copyDirectoryContentsIfMissing(source, target) {
  if (!fs.existsSync(source)) return;
  ensureDir(target);

  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const src = path.join(source, entry.name);
    const dest = path.join(target, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryContentsIfMissing(src, dest);
      continue;
    }

    if (!fs.existsSync(dest)) fs.copyFileSync(src, dest);
  }
}

function migrateLegacyStorage() {
  copyFileIfMissing(path.join(LEGACY_DATA_ROOT, 'blog.json'), dataFile('blog.json'));
  copyFileIfMissing(path.join(LEGACY_DATA_ROOT, 'marka-arastirma.json'), dataFile('marka-arastirma.json'));
  copyFileIfMissing(path.join(LEGACY_DATA_ROOT, 'iletisim.json'), dataFile('iletisim.json'));
  copyFileIfMissing(path.join(LEGACY_DATA_ROOT, 'bulten.json'), dataFile('bulten.json'));
  copyDirectoryContentsIfMissing(LEGACY_BLOG_UPLOAD_DIR, BLOG_UPLOAD_DIR);
}

function uploadPublicPath(filename) {
  return `${BLOG_PUBLIC_PREFIX}/${filename}`;
}

function uploadFilePath(fileUrl) {
  if (!fileUrl) return null;
  const normalized = fileUrl.replace(/^\/+/, '');
  if (!normalized.startsWith('uploads/')) return null;
  return path.join(STORAGE_ROOT, normalized);
}

ensureDir(STORAGE_ROOT);
ensureDir(BLOG_UPLOAD_DIR);
migrateLegacyStorage();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, BLOG_UPLOAD_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, Date.now() + '-' + Math.random().toString(36).substring(7) + ext);
  }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use('/uploads', express.static(UPLOAD_ROOT));
app.use(express.static(PUBLIC_ROOT));
app.set('views', VIEWS_ROOT);

const sayac = sayacModulu.olustur({ kok: path.join(STORAGE_ROOT, 'sayac'), yolCoz: sayacYolu });
const BLOG_DB = dataFile('blog.json');
const MARKA_ARASTIRMA_DB = dataFile('marka-arastirma.json');
const ILETISIM_DB = dataFile('iletisim.json');
const BULTEN_DB = dataFile('bulten.json');

function getBlogPosts() {
  try { if (fs.existsSync(BLOG_DB)) return JSON.parse(fs.readFileSync(BLOG_DB, 'utf-8')); } catch(e) {}
  return [];
}
function saveBlogPosts(posts) { fs.writeFileSync(BLOG_DB, JSON.stringify(posts, null, 2), 'utf-8'); }
function generateSlug(title) {
  const tr = {'ç':'c','ğ':'g','ı':'i','ö':'o','ş':'s','ü':'u','Ç':'C','Ğ':'G','İ':'I','Ö':'O','Ş':'S','Ü':'U'};
  let s = title.toLowerCase();
  for (const [k,v] of Object.entries(tr)) s = s.replace(new RegExp(k,'g'), v);
  return s.replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
}

// ===== Site sayacı (gizli; yalnız yönetici oturumu ve ajan sistemi okur) =====
// Görüntülenme, sayfada kalma süresi, kaydırma derinliği ve geliş kaynağı. Kişisel veri tutulmaz (ayrıntı sayac.js).
const SAYFA_ADLARI = { '/': 'Ana sayfa', [karsilama.YOL]: 'Reklam karşılama: ücretsiz marka ön araştırması', '/hizmetlerimiz': 'Hizmetlerimiz', '/hakkimizda': 'Hakkımızda', '/blog': 'Blog',
  '/iletisim': 'İletişim', '/kvkk-aydinlatma-metni': 'KVKK aydınlatma metni', '/404': 'Bulunamayan adres (404)' };
let yayindakiSluglar = { at: 0, set: new Set() };
function sayacYolu(ham) {
  let yol = String(ham == null ? '' : ham).split(/[?#]/)[0].slice(0, 220);
  if (!yol.startsWith('/')) return null;
  try { yol = decodeURIComponent(yol); } catch (e) { return '/404'; }
  if (yol.length > 1) yol = yol.replace(/\/+$/, '');
  if (SAYFA_ADLARI[yol] && yol !== '/404') return yol;
  const m = yol.match(/^\/blog\/([a-z0-9]+(?:-[a-z0-9]+)*)$/);
  if (m) {
    if (Date.now() - yayindakiSluglar.at > 30000) {
      yayindakiSluglar = { at: Date.now(), set: new Set(getBlogPosts().filter(p => p.yayinda && p.slug).map(p => p.slug)) };
    }
    if (yayindakiSluglar.set.has(m[1])) return yol;
  }
  return '/404';   // denenen adres saklanmaz; yalnız bulunamayan sayfa sayısı tutulur
}

// ===== Pages =====
// 08.11: tanınan reklam kampanyasıyla (utm_campaign) gelen ziyaretçi ana sayfa yerine karşılama sayfasını görür.
// Aynı adresi açan herkes aynı sayfayı görür; kampanya listesi karsilama.js içindedir.
app.get('/', (req, res) => {
  const secim = karsilama.sec(req.query);
  if (secim) return res.type('html').send(karsilama.render(secim, VIEWS_ROOT, { kvkk: KVKK_VERSION }));
  res.sendFile(path.join(VIEWS_ROOT, 'index.html'));
});
app.get(karsilama.YOL, (req, res) => res.type('html').send(karsilama.render(karsilama.sec(req.query, true), VIEWS_ROOT, { kvkk: KVKK_VERSION })));
app.get('/hizmetlerimiz', (req, res) => res.sendFile(path.join(VIEWS_ROOT, 'hizmetlerimiz.html')));
app.get('/hakkimizda', (req, res) => res.sendFile(path.join(VIEWS_ROOT, 'hakkimizda.html')));
app.get('/blog', (req, res) => res.type('html').send(blogSeo.renderBlog(fs.readFileSync(path.join(VIEWS_ROOT, 'blog.html'), 'utf8'), getBlogPosts())));
app.get('/iletisim', (req, res) => res.sendFile(path.join(VIEWS_ROOT, 'iletisim.html')));
app.get('/kvkk-aydinlatma-metni', (req, res) => res.sendFile(path.join(VIEWS_ROOT, 'kvkk.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(VIEWS_ROOT, 'admin.html')));
// 09.11: adresi değişen yazının eski adresi (eskiSluglar) yeni adrese kalıcı yönlendirilir; sorgu (UTM) korunur.
function eskiAdresliYazi(posts, slug) {
  return posts.find(p => p.yayinda && Array.isArray(p.eskiSluglar) && p.eskiSluglar.includes(slug));
}
const SLUG_KALIBI = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
function slugKullanimda(posts, slug, haricId) {
  return posts.some(p => p.id !== haricId && (p.slug === slug || (Array.isArray(p.eskiSluglar) && p.eskiSluglar.includes(slug))));
}
app.get('/blog/:slug', (req, res) => {
  const template = fs.readFileSync(path.join(VIEWS_ROOT, 'blog-detay.html'), 'utf8');
  const posts = getBlogPosts();
  const post = posts.find(p => p.yayinda && p.slug === req.params.slug);
  if (!post) {
    const tasinan = eskiAdresliYazi(posts, req.params.slug);
    if (tasinan) {
      const sorgu = req.originalUrl.includes('?') ? req.originalUrl.slice(req.originalUrl.indexOf('?')) : '';
      return res.redirect(301, '/blog/' + encodeURIComponent(tasinan.slug) + sorgu);
    }
  }
  res.status(post ? 200 : 404).type('html').send(post ? blogSeo.renderPost(template, post) : blogSeo.renderNotFound(template));
});
app.get('/sitemap.xml', (req, res) => res.type('application/xml').send(blogSeo.sitemap(getBlogPosts())));
app.get('/robots.txt', (req, res) => res.type('text/plain').send('User-agent: *\nAllow: /\nDisallow: /admin\nDisallow: /api/admin/\nSitemap: '+blogSeo.ORIGIN+'/sitemap.xml\n'));

// ===== Admin Login =====
app.post('/api/admin/login', (req, res) => {
  const { kullanici, sifre } = req.body;
  if (!ADMIN_USER || !ADMIN_PASS) {
    return res.status(503).json({ success: false, message: 'Yönetici girişi henüz yapılandırılmadı.' });
  }
  if (kullanici === ADMIN_USER && sifre === ADMIN_PASS) {
    const token = generateToken();
    activeSessions.set(token, { expires: Date.now() + SESSION_DURATION });
    return res.json({ success: true, token });
  }
  res.status(401).json({ success: false, message: 'Kullanıcı adı veya şifre hatalı.' });
});

app.post('/api/admin/verify', (req, res) => {
  const token = req.headers['x-admin-token'];
  res.json({ valid: isValidSession(token) });
});

// ===== Blog API (public) =====
app.get('/api/blog', (req, res) => {
  const posts = getBlogPosts().filter(p => p.yayinda);
  posts.sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
  res.json(posts);
});
app.get('/api/blog/:slug', (req, res) => {
  const posts = getBlogPosts();
  const post = posts.find(p => p.slug === req.params.slug && p.yayinda) || eskiAdresliYazi(posts, req.params.slug);
  if (post) return res.json(post);
  res.status(404).json({ error: 'Yazı bulunamadı' });
});

// ===== Blog API (admin - protected) =====
app.get('/api/admin/blog', adminAuth, (req, res) => {
  const posts = getBlogPosts();
  posts.sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
  res.json(posts);
});

app.post('/api/admin/blog', adminAuth, upload.single('gorsel'), (req, res) => {
  const { baslik, kategori, ozet, icerik, okumaSuresi, oneCikan, slug, seoTitle, metaDescription, gorselAlt } = req.body;
  if (!baslik || !icerik) return res.status(400).json({ success: false, message: 'Başlık ve içerik zorunludur.' });
  const posts = getBlogPosts();
  const newSlug = slug || generateSlug(baslik);
  if (!SLUG_KALIBI.test(newSlug) || newSlug.length > 180 || slugKullanimda(posts, newSlug)) {
    if (req.file) fs.unlink(req.file.path, () => {});
    return res.status(400).json({ success:false, message:'Yazı adresi geçersiz veya kullanımda.' });
  }
  const post = {
    id: Date.now().toString(), baslik, slug: newSlug,
    seoTitle: String(seoTitle || '').slice(0,180), metaDescription: String(metaDescription || '').slice(0,320), gorselAlt: String(gorselAlt || '').slice(0,300),
    kategori: kategori || 'Genel', ozet: ozet || '', icerik,
    gorsel: req.file ? uploadPublicPath(req.file.filename) : '',
    okumaSuresi: okumaSuresi || '5', oneCikan: oneCikan === 'true' || oneCikan === true,
    yayinda: true, tarih: new Date().toISOString(), guncelleme: new Date().toISOString()
  };
  if (post.oneCikan) posts.forEach(p => p.oneCikan = false);
  posts.push(post);
  saveBlogPosts(posts);
  res.json({ success: true, message: 'Blog yazısı oluşturuldu.', post });
});

// Yazı içi görsel: yönetici yükler, yazı içeriğinde <img src> ile kullanılır. Yalnız görsel dosyası kabul edilir.
const GORSEL_TURLERI = new Set(['image/jpeg', 'image/png', 'image/webp']);
app.post('/api/admin/gorsel', adminAuth, upload.single('gorsel'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: 'Görsel dosyası gerekli.' });
  const ext = path.extname(req.file.originalname || '').toLowerCase();
  if (!GORSEL_TURLERI.has(req.file.mimetype) || !['.jpg', '.jpeg', '.png', '.webp'].includes(ext)) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ success: false, message: 'Yalnız JPEG, PNG veya WebP görsel yüklenebilir.' });
  }
  res.json({ success: true, url: uploadPublicPath(req.file.filename) });
});

app.put('/api/admin/blog/:id', adminAuth, upload.single('gorsel'), (req, res) => {
  const posts = getBlogPosts();
  const idx = posts.findIndex(p => p.id === req.params.id);
  if (idx === -1) return res.status(404).json({ success: false, message: 'Yazı bulunamadı.' });
  const { baslik, kategori, ozet, icerik, okumaSuresi, oneCikan, yayinda } = req.body;
  // Published addresses stay stable when an editor changes a title.
  // 09.11: adres yalnız açıkça `slug` gönderilirse değişir; eski adres eskiSluglar'a girer ve yeni adrese yönlendirilir.
  const yeniSlug = req.body.slug === undefined ? '' : String(req.body.slug).trim();
  if (yeniSlug && yeniSlug !== posts[idx].slug) {
    if (!SLUG_KALIBI.test(yeniSlug) || yeniSlug.length > 180 || slugKullanimda(posts, yeniSlug, posts[idx].id)) {
      if (req.file) fs.unlink(req.file.path, () => {});
      return res.status(400).json({ success: false, message: 'Yazı adresi geçersiz veya kullanımda.' });
    }
    const eski = (Array.isArray(posts[idx].eskiSluglar) ? posts[idx].eskiSluglar : []).filter(s => s !== yeniSlug);
    if (posts[idx].slug && !eski.includes(posts[idx].slug)) eski.push(posts[idx].slug);
    posts[idx].eskiSluglar = eski;
    posts[idx].slug = yeniSlug;
  }
  if (baslik) posts[idx].baslik = baslik;
  for (const [key, limit] of [['seoTitle',180],['metaDescription',320],['gorselAlt',300]]) {
    if (req.body[key] !== undefined) posts[idx][key] = String(req.body[key]).slice(0,limit);
  }
  if (kategori !== undefined) posts[idx].kategori = kategori;
  if (ozet !== undefined) posts[idx].ozet = ozet;
  if (icerik !== undefined) posts[idx].icerik = icerik;
  if (okumaSuresi !== undefined) posts[idx].okumaSuresi = okumaSuresi;
  if (yayinda !== undefined) posts[idx].yayinda = yayinda === 'true' || yayinda === true;
  if (oneCikan === 'true' || oneCikan === true) { posts.forEach(p => p.oneCikan = false); posts[idx].oneCikan = true; }
  else if (oneCikan === 'false' || oneCikan === false) { posts[idx].oneCikan = false; }
  if (req.file) {
    const old = uploadFilePath(posts[idx].gorsel);
    if (old && fs.existsSync(old)) fs.unlinkSync(old);
    posts[idx].gorsel = uploadPublicPath(req.file.filename);
  }
  posts[idx].guncelleme = new Date().toISOString();
  saveBlogPosts(posts);
  res.json({ success: true, message: 'Blog yazısı güncellendi.', post: posts[idx] });
});

app.delete('/api/admin/blog/:id', adminAuth, (req, res) => {
  let posts = getBlogPosts();
  const post = posts.find(p => p.id === req.params.id);
  if (!post) return res.status(404).json({ success: false, message: 'Yazı bulunamadı.' });
  const imagePath = uploadFilePath(post.gorsel);
  if (imagePath && fs.existsSync(imagePath)) fs.unlinkSync(imagePath);
  posts = posts.filter(p => p.id !== req.params.id);
  saveBlogPosts(posts);
  res.json({ success: true, message: 'Blog yazısı silindi.' });
});

// ===== Marka Araştırma API =====
app.post('/api/marka-arastirma', async (req, res) => {
  const { markaAdi, sektor, sektör, adSoyad, telefon, eposta, il, ekNot } = req.body;
  const sektorDegeri = sektor || sektör || '';

  // 08.11: e-posta isteğe bağlı (zorunlu: marka adı, ad, telefon).
  if (!markaAdi || !adSoyad || !telefon) {
    return res.status(400).json({ success: false, message: 'Lütfen zorunlu alanları doldurun.' });
  }
  if (req.body.kvkkOkundu !== true || req.body.kvkkVersiyon !== KVKK_VERSION) {
    return res.status(400).json({ success: false, message: 'Lütfen güncel Aydınlatma Metni’ni okuyup ilgili kutucuğu işaretleyin. Sayfa uzun süredir açıksa yenileyin.' });
  }

  const sub = {
    id: Date.now(), tarih: new Date().toISOString(),
    markaAdi, sektor: sektorDegeri, adSoyad, telefon, eposta: eposta || '',
    il: il || '', ekNot: ekNot || '', durum: 'Yeni',
    kaynak: temizKaynak(req.body.kaynak),
    aydinlatma: { okundu: true, versiyon: KVKK_VERSION, tarih: new Date().toISOString() }
  };

  // JSON'a kaydet
  let subs = [];
  try { if (fs.existsSync(MARKA_ARASTIRMA_DB)) subs = JSON.parse(fs.readFileSync(MARKA_ARASTIRMA_DB, 'utf-8')); } catch(e) {}
  subs.push(sub);
  fs.writeFileSync(MARKA_ARASTIRMA_DB, JSON.stringify(subs, null, 2), 'utf-8');

  // Mail gönder (hata olsa bile başvuruyu kabul et)
  try {
    const tarihStr = new Date(sub.tarih).toLocaleString('tr-TR');
    await mailGonder(
      `Yeni Marka Araştırma Başvurusu - ${markaAdi}`,
      `Yeni başvuru alındı.\n\nReferans No: ${sub.id}\nTarih: ${tarihStr}\nMarka Adı: ${markaAdi}\nSektör: ${sektorDegeri}\nAd Soyad: ${adSoyad}\nTelefon: ${telefon}\nE-posta: ${eposta || '-'}\nİl: ${il || '-'}\nEk Not: ${ekNot || '-'}\nKaynak: ${kaynakOzeti(sub.kaynak)}`,
      `<h2 style="color:#1a237e;">Yeni Marka Araştırma Başvurusu</h2>
       <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;">
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;width:160px;">Referans No</td><td style="padding:8px;border:1px solid #ddd;">${sub.id}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Tarih</td><td style="padding:8px;border:1px solid #ddd;">${tarihStr}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Marka Adı</td><td style="padding:8px;border:1px solid #ddd;">${markaAdi}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Sektör</td><td style="padding:8px;border:1px solid #ddd;">${sektorDegeri || '-'}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Ad Soyad</td><td style="padding:8px;border:1px solid #ddd;">${adSoyad}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Telefon</td><td style="padding:8px;border:1px solid #ddd;">${telefon}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">E-posta</td><td style="padding:8px;border:1px solid #ddd;">${eposta || '-'}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">İl</td><td style="padding:8px;border:1px solid #ddd;">${il || '-'}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Ek Not</td><td style="padding:8px;border:1px solid #ddd;">${ekNot || '-'}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Kaynak</td><td style="padding:8px;border:1px solid #ddd;">${kaynakOzeti(sub.kaynak)}</td></tr>
       </table>`
    );
  } catch (mailHata) {
    // Mail hatası başvuruyu engellemez, sadece loglanır
    console.error('[MAIL HATA] Marka araştırma maili gönderilemedi:', mailHata.message);
  }

  return res.json({
    success: true,
    message: 'Başvurunuz başarıyla alındı. 24 saat içinde uzman ekibimiz sizinle iletişime geçecektir.',
    referansNo: sub.id
  });
});

// ===== İletişim API =====
app.post('/api/iletisim', async (req, res) => {
  const { adSoyad, eposta, telefon, basvuruTipi, mesaj } = req.body;
  if (!adSoyad || !eposta || !mesaj) return res.status(400).json({ success: false, message: 'Lütfen zorunlu alanları doldurun.' });
  if (req.body.kvkkOkundu !== true || req.body.kvkkVersiyon !== KVKK_VERSION) {
    return res.status(400).json({ success: false, message: 'Lütfen güncel Aydınlatma Metni’ni okuyup ilgili kutucuğu işaretleyin. Sayfa uzun süredir açıksa yenileyin.' });
  }
  const sub = { id: Date.now(), tarih: new Date().toISOString(), adSoyad, eposta, telefon:telefon||'', basvuruTipi:basvuruTipi||'Genel', mesaj, durum:'Okunmadı', kaynak: temizKaynak(req.body.kaynak), aydinlatma: { okundu: true, versiyon: KVKK_VERSION, tarih: new Date().toISOString() } };
  let subs = []; try { if(fs.existsSync(ILETISIM_DB)) subs = JSON.parse(fs.readFileSync(ILETISIM_DB,'utf-8')); } catch(e){}
  subs.push(sub); fs.writeFileSync(ILETISIM_DB, JSON.stringify(subs,null,2),'utf-8');

  // Mail gönder
  try {
    const tarihStr = new Date(sub.tarih).toLocaleString('tr-TR');
    await mailGonder(
      `Yeni İletişim Mesajı - ${basvuruTipi || 'Genel'}`,
      `Yeni iletişim mesajı alındı.\n\nReferans No: ${sub.id}\nTarih: ${tarihStr}\nAd Soyad: ${adSoyad}\nE-posta: ${eposta}\nTelefon: ${telefon || '-'}\nBaşvuru Tipi: ${basvuruTipi || 'Genel'}\nMesaj: ${mesaj}\nKaynak: ${kaynakOzeti(sub.kaynak)}`,
      `<h2 style="color:#1a237e;">Yeni İletişim Mesajı</h2>
       <table style="border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;">
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;width:160px;">Referans No</td><td style="padding:8px;border:1px solid #ddd;">${sub.id}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Tarih</td><td style="padding:8px;border:1px solid #ddd;">${tarihStr}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Ad Soyad</td><td style="padding:8px;border:1px solid #ddd;">${adSoyad}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">E-posta</td><td style="padding:8px;border:1px solid #ddd;">${eposta}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Telefon</td><td style="padding:8px;border:1px solid #ddd;">${telefon || '-'}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Başvuru Tipi</td><td style="padding:8px;border:1px solid #ddd;">${basvuruTipi || 'Genel'}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Mesaj</td><td style="padding:8px;border:1px solid #ddd;">${mesaj}</td></tr>
         <tr><td style="padding:8px;border:1px solid #ddd;background:#f5f5f5;font-weight:bold;">Kaynak</td><td style="padding:8px;border:1px solid #ddd;">${kaynakOzeti(sub.kaynak)}</td></tr>
       </table>`
    );
  } catch (mailHata) {
    console.error('[MAIL HATA] İletişim maili gönderilemedi:', mailHata.message);
  }

  res.json({ success: true, message: 'Mesajınız başarıyla iletildi. En kısa sürede size dönüş yapacağız.' });
});


app.post('/api/bulten', (req, res) => {
  const { eposta, onay } = req.body;
  if (!eposta) return res.status(400).json({ success: false, message: 'Lütfen e-posta adresinizi girin.' });
  let subs = []; try { if(fs.existsSync(BULTEN_DB)) subs = JSON.parse(fs.readFileSync(BULTEN_DB,'utf-8')); } catch(e){}
  if (subs.find(s => s.eposta === eposta)) return res.json({ success: true, message: 'Bu e-posta adresi zaten kayıtlı.' });
  subs.push({ id: Date.now(), tarih: new Date().toISOString(), eposta, onay: onay||false });
  fs.writeFileSync(BULTEN_DB, JSON.stringify(subs,null,2),'utf-8');
  res.json({ success: true, message: 'Bülten aboneliğiniz başarıyla oluşturuldu.' });
});

app.get('/api/admin/basvurular', adminAuth, (req, res) => {
  try { if(fs.existsSync(MARKA_ARASTIRMA_DB)) return res.json(JSON.parse(fs.readFileSync(MARKA_ARASTIRMA_DB,'utf-8'))); } catch(e){} res.json([]);
});
app.get('/api/admin/mesajlar', adminAuth, (req, res) => {
  try { if(fs.existsSync(ILETISIM_DB)) return res.json(JSON.parse(fs.readFileSync(ILETISIM_DB,'utf-8'))); } catch(e){} res.json([]);
});

// ===== Site sayacı uçları =====
// Ziyaretçi tarafı yalnız yazar ve her durumda boş 204 döner (sayı veya veri göstermez). Okuma yalnız yönetici oturumuyla.
app.post('/api/olcum', express.text({ type: () => true, limit: '4kb' }), (req, res) => {
  let govde = req.body;
  if (typeof govde === 'string') { try { govde = JSON.parse(govde); } catch (e) { govde = null; } }
  try {
    sayac.olay(govde, { ua: req.headers['user-agent'], adres: req.headers['x-forwarded-for'] || req.socket.remoteAddress });
  } catch (e) {
    console.error('[SAYAC] olay işlenemedi:', e.message);
  }
  res.set('Cache-Control', 'no-store').status(204).end();
});
app.get('/api/admin/sayac', adminAuth, (req, res) => {
  const yazilar = new Map(getBlogPosts().map(p => [p.slug, p.baslik]));   // yayından kalkan yazı da adıyla görünür
  const baslik = yol => SAYFA_ADLARI[yol] || (yol.startsWith('/blog/') && yazilar.get(yol.slice(6))) || yol;
  const veri = sayac.ozet({ gun: req.query.gun, ayrinti: req.query.ayrinti === '1', baslik });
  // Ajan sistemindeki n8n, Türkçe UTF-8 yanıtı başka kodlama sanabiliyor; JSON yalnız ASCII kaçışla gönderilir (anlam aynı).
  const metin = JSON.stringify(veri).replace(/[\u007f-￿]/g, c => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  res.set('Cache-Control', 'no-store').type('application/json').send(metin);
});

app.use((req, res) => { res.status(404).sendFile(path.join(VIEWS_ROOT, 'index.html')); });
app.listen(PORT, () => {
  console.log(`Doğu Patent web sitesi http://localhost:${PORT} adresinde çalışıyor`);
  console.log(`[STORAGE] Veri klasoru: ${STORAGE_ROOT}`);
});
