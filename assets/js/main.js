(() => {
  'use strict';
  const button = document.querySelector('.menu-toggle');
  const nav = document.querySelector('.primary-nav');
  if (!button || !nav) return;
  const close = () => { button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-label', 'Open navigation'); nav.classList.remove('is-open'); document.body.classList.remove('menu-open'); };
  button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!open));
    button.setAttribute('aria-label', open ? 'Open navigation' : 'Close navigation');
    nav.classList.toggle('is-open', !open); document.body.classList.toggle('menu-open', !open);
  });
  nav.addEventListener('click', event => { if (event.target.closest('a')) close(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape') { close(); button.focus(); } });
  window.addEventListener('resize', () => { if (window.innerWidth > 860) close(); });
})();

(() => {
  'use strict';
  const hero = document.querySelector('.hero .hero-copy');
  if (!hero) return;
  document.body.classList.add('home-motion-ready');
  const sections = [...document.querySelectorAll('main > section:not(.hero)')];
  sections.forEach(section => {
    section.classList.add('home-reveal');
    section.querySelectorAll('.channel-grid article,.integration-line article,.logo-grid div').forEach((item, index) => item.style.setProperty('--reveal-index', index));
  });
  if (!('IntersectionObserver' in window)) {
    sections.forEach(section => section.classList.add('is-visible'));
    return;
  }
  const observer = new IntersectionObserver(entries => entries.forEach(entry => {
    if (!entry.isIntersecting) return;
    entry.target.classList.add('is-visible');
    observer.unobserve(entry.target);
  }), { threshold: .14, rootMargin: '0px 0px -7% 0px' });
  sections.forEach(section => observer.observe(section));
})();

(() => {
  'use strict';
  const showcase = document.querySelector('[data-format-showcase]');
  if (!showcase) return;
  const tabs = [...showcase.querySelectorAll('[data-format-target]')];
  const panels = [...showcase.querySelectorAll('[data-format-panel]')];
  const sequential = showcase.classList.contains('sequential-showcase');

  if (sequential) {
    const tabList = showcase.querySelector('[role="tablist"]');
    if (tabList) tabList.hidden = true;
    panels.forEach((panel, index) => {
      panel.hidden = false;
      panel.removeAttribute('role');
      panel.removeAttribute('aria-labelledby');
      panel.style.setProperty('--panel-index', index);
    });
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => entries.forEach(entry => {
        entry.target.classList.toggle('is-in-view', entry.isIntersecting);
        if (entry.isIntersecting) {
          const label = showcase.querySelector('[data-moving-format-name]');
          const name = entry.target.querySelector('.demo-copy .kicker');
          if (label && name) label.textContent = name.textContent;
        }
      }), { threshold: 0.28 });
      panels.forEach(panel => observer.observe(panel));
    } else {
      panels.forEach(panel => panel.classList.add('is-in-view'));
    }
  }

  const activate = (tab, focus = false) => {
    const target = tab.dataset.formatTarget;
    tabs.forEach(item => {
      const selected = item === tab;
      item.setAttribute('aria-selected', String(selected));
      item.tabIndex = selected ? 0 : -1;
    });
    panels.forEach(panel => {
      const selected = panel.dataset.formatPanel === target;
      panel.hidden = !selected;
      panel.classList.toggle('is-active', selected);
    });
    if (focus) tab.focus();
  };

  if (!sequential) tabs.forEach((tab, index) => {
    tab.addEventListener('click', () => activate(tab));
    tab.addEventListener('keydown', event => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      let next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      activate(tabs[next], true);
    });
  });

  const slider = showcase.querySelector('[data-slider-demo] input');
  if (slider) slider.addEventListener('input', () => slider.parentElement.style.setProperty('--reveal', `${slider.value}%`));

  const sticky = showcase.querySelector('[data-sticky-unit]');
  const close = showcase.querySelector('[data-sticky-close]');
  const reset = showcase.querySelector('[data-sticky-reset]');
  if (sticky && close && reset) {
    close.addEventListener('click', () => { sticky.hidden = true; reset.hidden = false; reset.focus(); });
    reset.addEventListener('click', () => { sticky.hidden = false; reset.hidden = true; close.focus(); });
  }
})();
