// Continue the existing Portfolio GA4 stream after the move from Readymag.
// Local previews and copies must never send visits to the production property.
(() => {
  if (!['romazhigarev.ru', 'www.romazhigarev.ru'].includes(location.hostname)) return;

  const measurementId = 'G-MPVN1TELR3';
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () { window.dataLayer.push(arguments); };
  window.gtag('js', new Date());
  window.gtag('config', measurementId);

  const script = document.createElement('script');
  script.async = true;
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`;
  document.head.appendChild(script);
})();
