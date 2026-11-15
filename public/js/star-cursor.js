/**
 * Smiley star custom cursor & subtle click confetti for imastik.
 * Automatically pauses over drawing/sketch canvases so the custom pencil
 * cursor shows without overlap or glitching.
 */

const CANVAS_ZONE_SELECTOR = 'canvas, .sketch-wrap, .sketch-modal-stage';

export function initStarCursor() {
  const finePointer = window.matchMedia('(pointer: fine)').matches;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!finePointer || reducedMotion) return;

  // Avoid duplicate cursor elements on re-init
  if (document.getElementById('stickyStarPointer')) return;

  const star = document.createElement('div');
  star.id = 'stickyStarPointer';
  star.setAttribute('aria-hidden', 'true');
  star.innerHTML =
    '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M50 3 L61 34 L93 21 L76 49 L97 69 L64 67 L51 98 L39 67 L5 76 L25 49 L7 22 L39 34 Z" fill="#ffe04a" stroke="#19251e" stroke-width="5" stroke-linejoin="round"/>' +
    '<circle cx="41" cy="46" r="3.4" fill="#19251e"/>' +
    '<circle cx="61" cy="46" r="3.4" fill="#19251e"/>' +
    '<path d="M42 58 Q51 66 61 57" fill="none" stroke="#19251e" stroke-width="3.6" stroke-linecap="round"/>' +
    '</svg>';
  document.body.appendChild(star);

  let x = -100;
  let y = -100;
  let angle = -12;
  let down = false;
  let overCanvas = false;

  document.body.classList.add('sticky-cursor-on');

  const syncTransform = () => {
    star.style.transform = `translate3d(${x - 20}px, ${y - 20}px, 0) rotate(${angle}deg) scale(${down ? 0.82 : 1})`;
  };

  window.addEventListener(
    'pointermove',
    (e) => {
      if (e.pointerType !== 'mouse' && e.pointerType !== 'pen') return;
      x = e.clientX;
      y = e.clientY;
      const target = e.target instanceof Element ? e.target : null;
      overCanvas = Boolean(target?.closest(CANVAS_ZONE_SELECTOR));
      document.body.classList.toggle('over-sketch-canvas', overCanvas);
      star.style.opacity = overCanvas ? '0' : '1';
      syncTransform();
      star.classList.toggle(
        'hot',
        !overCanvas && Boolean(target?.closest('a, button, label, [role="button"], .piece')),
      );
    },
    { passive: true },
  );

  window.addEventListener(
    'pointerdown',
    (e) => {
      if (e.pointerType !== 'mouse') return;
      down = true;
      angle += 30;
      star.classList.add('down');
      syncTransform();
    },
    { passive: true },
  );

  window.addEventListener(
    'pointerup',
    () => {
      down = false;
      star.classList.remove('down');
      syncTransform();
    },
    { passive: true },
  );

  document.addEventListener('mouseleave', () => {
    star.style.opacity = '0';
  });

  window.addEventListener('blur', () => {
    star.style.opacity = '0';
    document.body.classList.remove('over-sketch-canvas');
  });

  // Subtle click confetti bursts on CTA / button clicks outside form inputs & boards
  const marks = ['STICK', 'FUN', 'IMASTIK', 'YES'];
  const colors = ['#c8256a', '#f04a38', '#19251e', '#9c1a50'];
  document.addEventListener('click', (e) => {
    const target = e.target instanceof Element ? e.target : null;
    if (!target || target.closest('input, textarea, select, canvas')) return;
    if (!target.closest('button, a')) return;
    if (!e.clientX && !e.clientY) return;

    for (let i = 0; i < 4; i++) {
      const el = document.createElement('span');
      el.className = 'click-confetti';
      el.textContent = marks[i % marks.length];
      el.style.color = colors[i % colors.length];
      el.style.left = `${e.clientX}px`;
      el.style.top = `${e.clientY}px`;
      const rad = (i * Math.PI * 2) / 4 + Math.random() * 0.4;
      const dist = 28 + Math.random() * 22;
      el.style.setProperty('--dx', `${Math.cos(rad) * dist}px`);
      el.style.setProperty('--dy', `${Math.sin(rad) * dist}px`);
      document.body.appendChild(el);
      el.addEventListener('animationend', () => el.remove(), { once: true });
    }
  });
}
