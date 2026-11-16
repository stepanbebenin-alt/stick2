import { initOrderForm } from './order-form.js?v=13';
import { initStarCursor } from './star-cursor.js?v=13';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Scroll reading progress bar + sticky header elevation
const progressBar = document.querySelector('#readingProgress span');
const header = document.getElementById('siteHeader');
let ticking = false;

function onScroll() {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    const doc = document.documentElement;
    const max = doc.scrollHeight - window.innerHeight;
    if (progressBar) {
      const ratio = max > 0 ? Math.max(0, Math.min(1, window.scrollY / max)) : 0;
      progressBar.style.transform = `scaleX(${ratio})`;
    }
    header?.classList.toggle('scrolled', window.scrollY > 18);
    ticking = false;
  });
}

window.addEventListener('scroll', onScroll, { passive: true });
window.addEventListener('resize', onScroll, { passive: true });
onScroll();

// Smooth-scroll in-page anchor links
document.querySelectorAll('a[href^="#"]').forEach((link) => {
  link.addEventListener('click', (e) => {
    const targetId = link.getAttribute('href');
    if (!targetId || targetId === '#') return;
    const target = document.querySelector(targetId);
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' });
    if (history.replaceState) {
      history.replaceState(null, '', targetId);
    }
  });
});

// Hide floating mobile CTA while hero (#top) or order form (#order) is visible
const mobileCta = document.getElementById('mobileCta');
const heroSection = document.getElementById('top');
const orderSection = document.getElementById('order');
if (mobileCta && orderSection && 'IntersectionObserver' in window) {
  let heroVisible = Boolean(heroSection);
  let orderVisible = false;
  const syncMobileCta = () => {
    mobileCta.classList.toggle('is-hidden', heroVisible || orderVisible);
  };
  const ctaObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.target === heroSection) heroVisible = entry.isIntersecting;
        if (entry.target === orderSection) orderVisible = entry.isIntersecting;
      }
      syncMobileCta();
    },
    { threshold: 0.12 },
  );
  if (heroSection) ctaObserver.observe(heroSection);
  ctaObserver.observe(orderSection);
}

// IntersectionObserver scroll reveal
const revealTargets = document.querySelectorAll('[data-reveal]');
if ('IntersectionObserver' in window && !reducedMotion) {
  const io = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('in-view');
          io.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.08, rootMargin: '0px 0px -24px 0px' },
  );

  revealTargets.forEach((el, index) => {
    el.style.transitionDelay = `${(index % 3) * 65}ms`;
    io.observe(el);
  });
} else {
  revealTargets.forEach((el) => el.classList.add('in-view'));
}

// Initialize Order Form & Smiley Star Cursor
initOrderForm({ reducedMotion });
initStarCursor();
