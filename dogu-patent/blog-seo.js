const ORIGIN = 'https://dogupatent.com';
const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const postUrl = post => ORIGIN + '/blog/' + encodeURIComponent(post.slug);
const isoDate = value => Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : '';
const displayDate = value => isoDate(value) ? new Date(value).toLocaleDateString('tr-TR', {day:'numeric',month:'long',year:'numeric',timeZone:'Europe/Istanbul'}) : '';
function imageUrl(value) {
  try { const url = new URL(value, ORIGIN); return /^https?:$/.test(url.protocol) ? url.href : ''; } catch { return ''; }
}
function contentHtml(value) {
  const text = String(value || '');
  // Rich HTML is authored only through the existing authenticated admin API.
  if (/<(?:p|h[2-6]|br|div|figure|ul|ol|table)\b/i.test(text)) return text;
  return text.split(/\n\n+/).map(p => p.trim()).filter(Boolean).map(p => '<p>'+escapeHtml(p).replace(/\n/g,'<br>')+'</p>').join('');
}
function head(post) {
  const title = post.seoTitle || post.baslik + ' | Doğu Patent';
  const description = post.metaDescription || post.ozet || '';
  const url = postUrl(post), image = post.gorsel ? imageUrl(post.gorsel) : '';
  const article = {
    '@type':'BlogPosting', '@id':url+'#article', headline:post.baslik, description,
    mainEntityOfPage:url, url, inLanguage:'tr-TR',
    publisher:{'@type':'Organization',name:'Doğu Patent',url:ORIGIN},
    ...(image ? {image:[image]} : {}),
    ...(isoDate(post.tarih) ? {datePublished:isoDate(post.tarih)} : {}),
    ...(isoDate(post.guncelleme) ? {dateModified:isoDate(post.guncelleme)} : {})
  };
  const schema = {'@context':'https://schema.org','@graph':[article,{
    '@type':'BreadcrumbList',itemListElement:[
      {'@type':'ListItem',position:1,name:'Doğu Patent',item:ORIGIN+'/'},
      {'@type':'ListItem',position:2,name:'Blog',item:ORIGIN+'/blog'},
      {'@type':'ListItem',position:3,name:post.baslik,item:url}
    ]
  }]};
  return `<title>${escapeHtml(title)}</title>
  <meta name="description" content="${escapeHtml(description)}"/>
  <link rel="canonical" href="${escapeHtml(url)}"/>
  <meta name="robots" content="max-image-preview:large"/>
  <meta property="og:type" content="article"/>
  <meta property="og:locale" content="tr_TR"/>
  <meta property="og:site_name" content="Doğu Patent"/>
  <meta property="og:title" content="${escapeHtml(title)}"/>
  <meta property="og:description" content="${escapeHtml(description)}"/>
  <meta property="og:url" content="${escapeHtml(url)}"/>
  ${image ? `<meta property="og:image" content="${escapeHtml(image)}"/><meta property="og:image:alt" content="${escapeHtml(post.gorselAlt || post.baslik)}"/>` : ''}
  <meta name="twitter:card" content="summary_large_image"/>
  <script type="application/ld+json">${JSON.stringify(schema).replace(/</g,'\\u003c')}</script>`;
}
function body(post) {
  const url = postUrl(post), image = post.gorsel ? imageUrl(post.gorsel) : '';
  return `<section class="post-hero"><a href="/blog" class="post-back">← Blog'a Dön</a>
    <div class="post-meta"><span class="post-tag">${escapeHtml(post.kategori)}</span><time class="post-date" datetime="${escapeHtml(isoDate(post.tarih))}">${escapeHtml(displayDate(post.tarih))}</time><span class="post-read">${escapeHtml(post.okumaSuresi || '5')} dk okuma</span></div>
    <h1>${escapeHtml(post.baslik)}</h1>${post.ozet ? `<p class="post-ozet">${escapeHtml(post.ozet)}</p>` : ''}</section>
    ${image ? `<div class="post-image"><img src="${escapeHtml(image)}" alt="${escapeHtml(post.gorselAlt || post.baslik)}" fetchpriority="high" decoding="async"/></div>` : ''}
    <article class="post-content"><div class="icerik">${contentHtml(post.icerik)}</div></article>
    <div class="post-divider"><hr/></div><div class="post-share"><span class="label">Paylaş:</span>
    <a href="https://twitter.com/intent/tweet?text=${encodeURIComponent(post.baslik)}&amp;url=${encodeURIComponent(url)}" target="_blank" rel="noopener noreferrer" aria-label="X üzerinde paylaş"><span class="material-symbols-outlined">share</span></a>
    <a href="mailto:?subject=${encodeURIComponent(post.baslik)}&amp;body=${encodeURIComponent(url)}" aria-label="E-posta ile paylaş"><span class="material-symbols-outlined">mail</span></a></div>`;
}
function renderPost(template, post) {
  return template.replace('<!-- BLOG_HEAD -->', () => head(post)).replace('<!-- BLOG_CONTENT -->', () => body(post));
}
function renderNotFound(template) {
  return template.replace('<!-- BLOG_HEAD -->','<title>Yazı bulunamadı | Doğu Patent</title><meta name="robots" content="noindex"/>')
    .replace('<!-- BLOG_CONTENT -->', '<div class="post-notfound"><h1>Yazı bulunamadı</h1><p>Aradığınız blog yazısı mevcut değil.</p><a href="/blog">Blog’a Dön</a></div>');
}
function renderBlog(template, posts) {
  const published = posts.filter(p => p.yayinda).sort((a,b) => Number(!!b.oneCikan)-Number(!!a.oneCikan) || Date.parse(b.tarih)-Date.parse(a.tarih));
  const cards = published.map(p => {
    const image = p.gorsel ? imageUrl(p.gorsel) : '';
    return `<a class="blog-card" href="/blog/${escapeHtml(encodeURIComponent(p.slug))}"><div class="blog-card-image">${image ? `<img src="${escapeHtml(image)}" alt="${escapeHtml(p.gorselAlt || p.baslik)}" loading="lazy" decoding="async"/>` : '<div class="placeholder-icon"><span class="material-symbols-outlined">article</span></div>'}</div><div><span class="tag">${escapeHtml(p.kategori)}</span><h2>${escapeHtml(p.baslik)}</h2><p class="ozet">${escapeHtml(p.ozet)}</p><span class="read-more">Devamını Oku</span><p class="tarih">${escapeHtml(displayDate(p.tarih))}</p></div></a>`;
  }).join('');
  return template.replace('<!-- BLOG_CARDS -->', () => cards || '<div class="blog-empty"><p>Henüz blog yazısı yok.</p></div>');
}
function sitemap(posts) {
  const urls = ['/', '/hizmetlerimiz', '/hakkimizda', '/blog', '/iletisim'].map(p => `<url><loc>${ORIGIN+p}</loc></url>`);
  for (const post of posts.filter(p => p.yayinda)) {
    const lastmod = isoDate(post.guncelleme || post.tarih);
    const image = post.gorsel ? imageUrl(post.gorsel) : '';
    urls.push(`<url><loc>${escapeHtml(postUrl(post))}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}${image ? `<image:image><image:loc>${escapeHtml(image)}</image:loc></image:image>` : ''}</url>`);
  }
  return '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">'+urls.join('')+'</urlset>';
}
module.exports = {ORIGIN,renderPost,renderNotFound,renderBlog,sitemap};
