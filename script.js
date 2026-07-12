/* ── HEADER: тёмный в hero, светлый при скролле ── */
(function () {
    var header = document.querySelector('.header');
    var hero   = document.querySelector('.hero');
    if (!header || !hero) return;
    function updateHeader() {
        var bottom = hero.getBoundingClientRect().bottom;
        header.className = header.className.replace(/\b(scrolled|in-hero)\b/g, '').trim();
        header.classList.add(bottom > 80 ? 'in-hero' : 'scrolled');
    }
    updateHeader();
    window.addEventListener('scroll', updateHeader, { passive: true });
})();

/* ── АКТИВНЫЙ ПУНКТ НАВИГАЦИИ ── */
(function () {
    var sections = Array.from(document.querySelectorAll('section[id]'));
    var links    = Array.from(document.querySelectorAll('.nav-link'));
    if (!sections.length || !links.length) return;
    var io = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            if (entry.isIntersecting) {
                links.forEach(function(l) { l.classList.remove('active'); });
                var a = document.querySelector('.nav-link[href="#' + entry.target.id + '"]');
                if (a) a.classList.add('active');
            }
        });
    }, { rootMargin: '-30% 0px -60% 0px' });
    sections.forEach(function(s) { io.observe(s); });
})();

/* ── ВЫРАВНИВАНИЕ ЗАГОЛОВКОВ ХАРАКТЕРИСТИК ── */
/* Запускаем после загрузки шрифта — критично для точного измерения высоты */
(function () {
    function equalizeSpecTitles() {
        var titles = document.querySelectorAll('.spec-group-title');
        if (titles.length < 2) return;
        titles.forEach(function(t) { t.style.height = 'auto'; });
        var maxH = 0;
        titles.forEach(function(t) { maxH = Math.max(maxH, t.offsetHeight); });
        titles.forEach(function(t) { t.style.height = maxH + 'px'; });
    }
    /* Запускаем когда шрифты готовы */
    if (document.fonts && document.fonts.ready) {
        document.fonts.ready.then(equalizeSpecTitles);
    }
    window.addEventListener('load', equalizeSpecTitles);
    var resizeTimer;
    window.addEventListener('resize', function() {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(function() {
            var titles = document.querySelectorAll('.spec-group-title');
            titles.forEach(function(t) { t.style.height = 'auto'; });
            equalizeSpecTitles();
        }, 150);
    });
})();

/* ── SCROLL ANIMATION (fade-up) ── */
(function () {
    var sel = '.problem-card, .spec-main, .result-block, .heatmap-block, ' +
              '.fieldtrial-block, .econ-card, .fact-item, .roadmap-card, ' +
              '.calc-widget, .preorder-form, .proof-item, .problem-solution, ' +
              '.solution-stat, .product-distinction, .research-link-card, .faq-item';
    var els = Array.from(document.querySelectorAll(sel));
    var io = new IntersectionObserver(function(entries) {
        entries.forEach(function(entry) {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                io.unobserve(entry.target);
            }
        });
    }, { threshold: 0.10 });
    els.forEach(function(el, i) {
        el.classList.add('fade-up');
        el.style.transitionDelay = (i % 5) * 70 + 'ms';
        io.observe(el);
    });
})();

/* ── КАЛЬКУЛЯТОР ── */
(function () {
    var slider   = document.getElementById('calcArea');
    var areaLbl  = document.getElementById('calcAreaVal');
    var timeEl   = document.getElementById('calcTime');
    var costEl   = document.getElementById('calcCost');
    var trSlider = document.getElementById('calcTreatments');
    var trLbl    = document.getElementById('calcTreatmentsVal');
    var trLbl2   = document.getElementById('calcTreatmentsVal2');
    var seasonEl = document.getElementById('calcSeasonCost');
    var barGdt   = document.getElementById('chartBarGdt');
    var barHerb  = document.getElementById('chartBarHerb');
    var barMech  = document.getElementById('chartBarMech');
    var barManual = document.getElementById('chartBarManual');
    var valGdt   = document.getElementById('chartValGdt');
    var valHerb  = document.getElementById('chartValHerb');
    var valMech  = document.getElementById('chartValMech');
    var valManual = document.getElementById('chartValManual');
    if (!slider || !areaLbl || !timeEl || !costEl) return;
    function fmtRub(n) {
        return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0') + '\u00a0\u20bd';
    }
    function update() {
        var area = parseInt(slider.value, 10);
        var treatments = trSlider ? parseInt(trSlider.value, 10) : 1;
        areaLbl.textContent = area;
        if (trLbl) trLbl.textContent = treatments;
        if (trLbl2) trLbl2.textContent = treatments;
        var totalMin = Math.round(area * 12.5);
        var h = Math.floor(totalMin / 60), m = totalMin % 60;
        timeEl.textContent = h > 0
            ? (m > 0 ? h + '\u00a0ч\u00a0' + m + '\u00a0мин' : h + '\u00a0ч')
            : m + '\u00a0мин';
        var lo = Math.round(area * 34.75), hi = Math.round(area * 39.7);
        costEl.textContent = lo + '\u2013' + hi + '\u00a0\u20bd';
        if (seasonEl) {
            var seasonLo = lo * treatments, seasonHi = hi * treatments;
            seasonEl.textContent = seasonLo + '\u2013' + seasonHi + '\u00a0\u20bd';
        }

        /* Динамический график: сравнение методов на выбранной площади,
           с учётом количества обработок за сезон. Гербициды ≈46 ₽/сотку,
           механическая ≈49 ₽/сотку, ручная прополка ≈200 ₽/сотку за одну
           обработку - см. блок "Сравнительная оценка стоимости обработки
           одной сотки" рядом. */
        if (barGdt && barHerb && barManual) {
            var gdtMid = area * ((34.75 + 39.7) / 2) * treatments;
            var herbCost = area * 46 * treatments;
            var mechCost = area * 49 * treatments;
            var manualCost = area * 200 * treatments;
            var maxVal = Math.max(gdtMid, herbCost, mechCost, manualCost, 1);

            barGdt.style.width = (gdtMid / maxVal * 100) + '%';
            barHerb.style.width = (herbCost / maxVal * 100) + '%';
            if (barMech) barMech.style.width = (mechCost / maxVal * 100) + '%';
            barManual.style.width = (manualCost / maxVal * 100) + '%';

            if (valGdt) valGdt.textContent = fmtRub(area * 34.75 * treatments).replace('\u00a0\u20bd','') + '\u2013' + fmtRub(area * 39.7 * treatments);
            if (valHerb) valHerb.textContent = fmtRub(herbCost);
            if (valMech) valMech.textContent = fmtRub(mechCost);
            if (valManual) valManual.textContent = fmtRub(manualCost);
        }
    }
    slider.addEventListener('input', update);
    slider.addEventListener('change', update);
    if (trSlider) {
        trSlider.addEventListener('input', update);
        trSlider.addEventListener('change', update);
    }
    update();
})();

/* ── COOKIE ── */
function acceptCookies() {
    try { localStorage.setItem('cookie_consent', 'accepted'); } catch(e) {}
    var b = document.getElementById('cookieBanner');
    if (b) b.classList.add('hidden');
}
function declineCookies() {
    try { localStorage.setItem('cookie_consent', 'declined'); } catch(e) {}
    var b = document.getElementById('cookieBanner');
    if (b) b.classList.add('hidden');
}
(function () {
    var b = document.getElementById('cookieBanner');
    if (!b) return;
    var consent;
    try { consent = localStorage.getItem('cookie_consent'); } catch(e) {}
    if (!consent) {
        setTimeout(function() { b.style.display = 'flex'; }, 900);
    }
})();
