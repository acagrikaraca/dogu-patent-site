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

// Marka Ön Araştırma Form
function initMarkaForm() {
  const forms = document.querySelectorAll('.marka-arastirma-form');
  
  forms.forEach(form => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
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
        ekNot: form.querySelector('[name="ekNot"]')?.value || ''
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
  });
}

// İletişim Form
function initContactForm() {
  const form = document.querySelector('.iletisim-form');
  
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      
      const btn = form.querySelector('button[type="submit"]');
      const originalHTML = btn.innerHTML;
      btn.innerHTML = 'GÖNDERİLİYOR... <span class="material-symbols-outlined text-sm">hourglass_top</span>';
      btn.disabled = true;
      
      const formData = {
        adSoyad: form.querySelector('[name="adSoyad"]').value,
        eposta: form.querySelector('[name="eposta"]').value,
        telefon: form.querySelector('[name="telefon"]')?.value || '',
        basvuruTipi: form.querySelector('[name="basvuruTipi"]')?.value || 'Genel',
        mesaj: form.querySelector('[name="mesaj"]').value
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
