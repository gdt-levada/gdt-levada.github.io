/**
 * ============================================================================
 *  analytics.js — собственная (first-party) система веб-аналитики
 * ============================================================================
 *
 *  Назначение
 *  ----------
 *  Полностью локальный сбор поведенческой и технической статистики
 *  посетителя сайта. Никаких внешних сервисов (Google Analytics,
 *  Яндекс.Метрика, Plausible и т.п.) не используется — все данные
 *  сохраняются только в localStorage браузера самого посетителя и никуда
 *  не отправляются.
 *
 *  Важно про согласие на обработку (см. cookie-баннер сайта)
 *  ------------------------------------------------------------------------
 *  Полноценный поведенческий трекинг (клики, скролл, heatmap, простой,
 *  выделение текста и т.д.) стартует ТОЛЬКО после того, как пользователь
 *  нажал «Принять» в cookie-баннере (window.acceptCookies). До этого
 *  момента и в случае отказа («Отклонить») ведётся лишь минимальный
 *  технический подсчёт числа визитов, необходимый для работы баннера —
 *  никакие поведенческие данные не записываются.
 *  См. Consent-модуль ниже.
 *
 *  Структура файла (логические блоки)
 *  ------------------------------------------------------------------------
 *    Utils        — общие вспомогательные функции (debounce, throttle, ...)
 *    Storage       — чтение/запись analyticsData в localStorage, батчинг
 *    Consent       — интеграция с cookie-баннером сайта
 *    Session       — визиты, сессии, длительности
 *    Device        — характеристики устройства и окружения
 *    Referrer      — источник перехода, UTM-метки
 *    Scroll        — глубина прокрутки
 *    Heatmap       — время/посещения по секциям (IntersectionObserver)
 *    Reading       — оценка скорости чтения по секциям
 *    Clicks        — клики по интерактивным элементам
 *    Navigation    — клики по меню
 *    Calculator    — калькулятор стоимости обработки
 *    CookieBanner  — метрики самого cookie-баннера
 *    Performance   — метрики загрузки и производительности
 *    Errors        — JS-ошибки и необработанные Promise-отклонения
 *    Visibility    — переключение вкладок
 *    ResizeTrack   — изменение размеров окна / ориентации
 *    Clipboard     — копирование текста
 *    ContextMenu   — правый клик
 *    Selection     — выделение текста
 *    Idle          — простой пользователя
 *    Returning     — повторные визиты
 *    ExitTracking  — как и где пользователь покинул страницу
 *    Export        — getAnalytics / clearAnalytics / downloadAnalytics
 *    Console       — printAnalytics
 *    Bootstrap     — инициализация всех модулей
 *
 *  Требования к окружению: современный браузер с поддержкой
 *  IntersectionObserver, ResizeObserver, Performance API. При отсутствии
 *  API модуль аккуратно деградирует (проверки на существование).
 * ============================================================================
 */
(function (window, document) {
    'use strict';

    /* ========================================================================
       БЛОК: Utils — общие вспомогательные функции
    ======================================================================== */
    const Utils = {
        now() {
            return Date.now();
        },
        perfNow() {
            return (window.performance && performance.now) ? performance.now() : Date.now();
        },
        uuid() {
            if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
            // Простой фолбэк-генератор, если randomUUID недоступен
            return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
                const r = (Math.random() * 16) | 0;
                const v = c === 'x' ? r : (r & 0x3) | 0x8;
                return v.toString(16);
            });
        },
        debounce(fn, wait) {
            let t = null;
            return function debounced(...args) {
                clearTimeout(t);
                t = setTimeout(() => fn.apply(this, args), wait);
            };
        },
        throttle(fn, wait) {
            let last = 0;
            let timer = null;
            return function throttled(...args) {
                const rem = wait - (Utils.now() - last);
                if (rem <= 0) {
                    last = Utils.now();
                    fn.apply(this, args);
                } else {
                    clearTimeout(timer);
                    timer = setTimeout(() => {
                        last = Utils.now();
                        fn.apply(this, args);
                    }, rem);
                }
            };
        },
        cap(arr, max) {
            // Обрезаем массив по FIFO, чтобы localStorage не разрастался бесконечно
            if (arr.length > max) arr.splice(0, arr.length - max);
            return arr;
        },
        round(n, d = 1) {
            const p = Math.pow(10, d);
            return Math.round(n * p) / p;
        },
        average(arr) {
            if (!arr || !arr.length) return 0;
            return Utils.round(arr.reduce((a, b) => a + b, 0) / arr.length, 2);
        },
        mostFrequent(arr) {
            if (!arr || !arr.length) return null;
            const freq = {};
            let best = arr[0], bestCount = 0;
            arr.forEach((v) => {
                freq[v] = (freq[v] || 0) + 1;
                if (freq[v] > bestCount) { bestCount = freq[v]; best = v; }
            });
            return best;
        },
        wordCount(text) {
            if (!text) return 0;
            const m = text.trim().match(/[\wа-яё]+/gi);
            return m ? m.length : 0;
        },
        daysBetween(isoA, isoB) {
            const a = new Date(isoA).getTime();
            const b = new Date(isoB).getTime();
            return Math.floor(Math.abs(b - a) / 86400000);
        },
        describeSelector(el) {
            // Формируем человекочитаемый "селектор" для клика: tag#id.class
            if (!el || !el.tagName) return null;
            let sel = el.tagName.toLowerCase();
            if (el.id) sel += `#${el.id}`;
            if (el.className && typeof el.className === 'string' && el.className.trim()) {
                sel += '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.');
            }
            return sel;
        },
        shortText(el, max = 60) {
            if (!el) return '';
            const t = (el.textContent || '').trim().replace(/\s+/g, ' ');
            return t.length > max ? t.slice(0, max) + '…' : t;
        }
    };

    /* ========================================================================
       БЛОК: Storage — единая структура analyticsData + батч-запись
    ======================================================================== */
    const STORAGE_KEY = 'analyticsData';
    const SAVE_INTERVAL_MS = 5000;   // пакетная запись раз в 5 секунд
    const MAX_LOG = 300;             // потолок для «сырых» логов событий
    const MAX_LOG_SMALL = 100;

    function defaultData() {
        const nowIso = new Date().toISOString();
        return {
            meta: { version: '1.0.0', createdAt: nowIso, lastSaved: null },

            visits: {
                totalOpens: 0,
                firstVisit: null,
                lastVisit: null,
                sessionCount: 0,
                sessions: [],           // { id, start, end, duration }
                avgDuration: 0,
                maxDuration: 0,
                minDuration: null
            },

            device: {},

            referrer: {
                raw: null,
                type: null,             // direct | search | external | internal
                searchEngine: null,
                utm: {}
            },

            scroll: {
                maxDepth: 0,
                milestones: {
                    25: { reached: false, time: null },
                    50: { reached: false, time: null },
                    75: { reached: false, time: null },
                    90: { reached: false, time: null },
                    100: { reached: false, time: null }
                }
            },

            heatmap: {
                sections: {},           // id -> { visits, timeSpent, returns, wordCount }
                mostPopular: null,
                mostIgnored: null
            },

            reading: {
                sections: {},           // id -> { estimatedWpm }
                skipped: []
            },

            clicks: {
                total: 0,
                byType: {
                    button: 0, link: 0, image: 0, calculator: 0, form: 0,
                    menu: 0, cookie: 0, table: 0, card: 0, phone: 0,
                    email: 0, logo: 0, other: 0
                },
                byCta: {},
                log: []                 // { selector, id, class, text, time, x, y }
            },

            navigation: {
                order: [],               // последовательность разделов меню
                counts: {}               // id раздела -> число кликов
            },

            calculator: {
                uses: 0,
                area: { values: [], min: null, max: null, avg: 0, mostCommon: null },
                treatments: { values: [], min: null, max: null, avg: 0, mostCommon: null }
            },

            cookieBanner: {
                shown: false,
                shownAt: null,
                accepted: false,
                acceptedAt: null,
                declined: false,
                declinedAt: null,
                secondsToDecision: null
            },

            performance: {
                domContentLoadedMs: null,
                loadMs: null,
                firstInteractionMs: null,
                avgFps: null,
                fullLoadTimeMs: null,
                navigationTiming: {}
            },

            errors: {
                count: 0,
                log: []                  // { message, source, line, col, time, type }
            },

            visibility: {
                hiddenCount: 0,
                totalHiddenMs: 0,
                events: []                // { hiddenAt, shownAt, durationMs }
            },

            resize: {
                events: [],               // { width, height, time }
                orientationChanges: 0
            },

            clipboard: { copyCount: 0 },

            contextMenu: { count: 0 },

            selection: {
                count: 0,
                events: []                // { section, length, time }
            },

            idle: {
                idleEvents: [],           // { idleSinceMs, durationMs }
                totalIdleMs: 0
            },

            returning: {
                visitCount: 0,
                lastVisitDaysAgo: null,
                visitDates: []
            },

            exit: {
                lastSection: null,
                lastActivityAt: null,
                method: null
            }
        };
    }

    const Storage = {
        data: null,
        dirty: false,

        /** Глубокое слияние с дефолтной схемой — обеспечивает обратную
         *  совместимость, если в будущем добавятся новые поля. */
        mergeDefaults(target, defaults) {
            Object.keys(defaults).forEach((key) => {
                if (target[key] === undefined) {
                    target[key] = defaults[key];
                } else if (
                    typeof defaults[key] === 'object' &&
                    defaults[key] !== null &&
                    !Array.isArray(defaults[key]) &&
                    typeof target[key] === 'object' &&
                    target[key] !== null &&
                    !Array.isArray(target[key])
                ) {
                    this.mergeDefaults(target[key], defaults[key]);
                }
            });
            return target;
        },

        load() {
            try {
                const raw = localStorage.getItem(STORAGE_KEY);
                if (!raw) return defaultData();
                const parsed = JSON.parse(raw);
                return this.mergeDefaults(parsed, defaultData());
            } catch (e) {
                return defaultData();
            }
        },

        init() {
            this.data = this.load();
        },

        markDirty() {
            this.dirty = true;
        },

        flush() {
            if (!this.dirty || !this.data) return;
            try {
                this.data.meta.lastSaved = new Date().toISOString();
                localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
                this.dirty = false;
            } catch (e) {
                // localStorage переполнен или недоступен (приватный режим) —
                // молча игнорируем, чтобы не ломать основной функционал сайта
            }
        },

        startAutoFlush() {
            setInterval(() => this.flush(), SAVE_INTERVAL_MS);
            // Финальная гарантированная запись перед уходом со страницы
            window.addEventListener('pagehide', () => this.flush());
            window.addEventListener('beforeunload', () => this.flush());
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') this.flush();
            });
        },

        clear() {
            this.data = defaultData();
            try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* noop */ }
        }
    };

    /* ========================================================================
       БЛОК: Consent — интеграция с существующим cookie-баннером сайта
       (см. script.js: acceptCookies() / declineCookies() / #cookieBanner)
    ======================================================================== */
    const Consent = {
        granted: false,

        check() {
            try {
                this.granted = localStorage.getItem('cookie_consent') === 'accepted';
            } catch (e) { this.granted = false; }
            return this.granted;
        },

        /** Оборачиваем существующие глобальные функции баннера, не изменяя
         *  их исходную логику (требование ТЗ — не трогать script.js). */
        hook() {
            const originalAccept = window.acceptCookies;
            const originalDecline = window.declineCookies;

            window.acceptCookies = function () {
                if (typeof originalAccept === 'function') originalAccept.apply(this, arguments);
                CookieBannerTracking.onAccept();
                Consent.granted = true;
                Bootstrap.startBehavioralTracking();
            };

            window.declineCookies = function () {
                if (typeof originalDecline === 'function') originalDecline.apply(this, arguments);
                CookieBannerTracking.onDecline();
                Consent.granted = false;
            };
        }
    };

    /* ========================================================================
       БЛОК: Session — визиты и сессии
    ======================================================================== */
    const Session = {
        id: null,
        startTs: null,

        init() {
            const d = Storage.data.visits;
            const nowIso = new Date().toISOString();

            d.totalOpens += 1;
            if (!d.firstVisit) d.firstVisit = nowIso;
            d.lastVisit = nowIso;

            this.id = Utils.uuid();
            this.startTs = Utils.perfNow();

            d.sessionCount += 1;
            d.sessions.push({ id: this.id, start: nowIso, end: null, duration: 0 });
            Utils.cap(d.sessions, MAX_LOG_SMALL);

            Storage.markDirty();
        },

        /** Вызывается периодически и перед закрытием — обновляет длительность
         *  текущей сессии и агрегаты (среднее/мин/макс). */
        touch() {
            const d = Storage.data.visits;
            const session = d.sessions[d.sessions.length - 1];
            if (!session) return;
            const durationMs = Math.round(Utils.perfNow() - this.startTs);
            session.duration = durationMs;
            session.end = new Date().toISOString();

            const durations = d.sessions.map((s) => s.duration).filter((n) => n > 0);
            d.avgDuration = Utils.average(durations);
            d.maxDuration = durations.length ? Math.max(...durations) : 0;
            d.minDuration = durations.length ? Math.min(...durations) : null;

            Storage.markDirty();
        },

        startHeartbeat() {
            setInterval(() => this.touch(), SAVE_INTERVAL_MS);
        }
    };

    /* ========================================================================
       БЛОК: Device — характеристики устройства/окружения (снимок при старте)
    ======================================================================== */
    const Device = {
        collect() {
            const ua = navigator.userAgent || '';
            const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;

            Storage.data.device = {
                userAgent: ua,
                os: this.detectOS(ua),
                browser: this.detectBrowser(ua),
                screenWidth: window.screen ? screen.width : null,
                screenHeight: window.screen ? screen.height : null,
                windowWidth: window.innerWidth,
                windowHeight: window.innerHeight,
                pixelRatio: window.devicePixelRatio || 1,
                language: navigator.language || null,
                timezone: (Intl && Intl.DateTimeFormat) ? Intl.DateTimeFormat().resolvedOptions().timeZone : null,
                orientation: this.getOrientation(),
                touch: ('ontouchstart' in window) || (navigator.maxTouchPoints > 0),
                colorScheme: (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light',
                online: navigator.onLine,
                connectionType: conn ? (conn.effectiveType || conn.type || null) : null
            };
            Storage.markDirty();

            // Отслеживаем online/offline постфактум
            window.addEventListener('online', () => {
                Storage.data.device.online = true; Storage.markDirty();
            });
            window.addEventListener('offline', () => {
                Storage.data.device.online = false; Storage.markDirty();
            });
        },

        getOrientation() {
            if (screen.orientation && screen.orientation.type) return screen.orientation.type;
            return window.innerWidth >= window.innerHeight ? 'landscape' : 'portrait';
        },

        detectOS(ua) {
            if (/windows/i.test(ua)) return 'Windows';
            if (/android/i.test(ua)) return 'Android';
            if (/iphone|ipad|ipod/i.test(ua)) return 'iOS';
            if (/mac os/i.test(ua)) return 'macOS';
            if (/linux/i.test(ua)) return 'Linux';
            return 'Unknown';
        },

        detectBrowser(ua) {
            if (/edg\//i.test(ua)) return 'Edge';
            if (/opr\/|opera/i.test(ua)) return 'Opera';
            if (/chrome\//i.test(ua) && !/edg\//i.test(ua)) return 'Chrome';
            if (/firefox\//i.test(ua)) return 'Firefox';
            if (/safari\//i.test(ua) && !/chrome\//i.test(ua)) return 'Safari';
            if (/yabrowser/i.test(ua)) return 'Yandex Browser';
            return 'Unknown';
        }
    };

    /* ========================================================================
       БЛОК: Referrer — источник захода, UTM
    ======================================================================== */
    const Referrer = {
        collect() {
            const ref = document.referrer || '';
            const r = Storage.data.referrer;
            r.raw = ref || null;

            if (!ref) {
                r.type = 'direct';
            } else {
                try {
                    const refHost = new URL(ref).hostname;
                    const sameHost = refHost === window.location.hostname;
                    if (sameHost) {
                        r.type = 'internal';
                    } else if (/google\.|yandex\.|bing\.|duckduckgo\.|yahoo\./i.test(refHost)) {
                        r.type = 'search';
                        r.searchEngine = refHost;
                    } else {
                        r.type = 'external';
                    }
                } catch (e) {
                    r.type = 'external';
                }
            }

            const params = new URLSearchParams(window.location.search);
            ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'].forEach((key) => {
                if (params.has(key)) r.utm[key] = params.get(key);
            });

            Storage.markDirty();
        }
    };

    /* ========================================================================
       БЛОК: Scroll — глубина прокрутки
    ======================================================================== */
    const Scroll = {
        pageStartTs: null,

        init() {
            this.pageStartTs = Utils.perfNow();
            const handler = Utils.throttle(() => this.check(), 300);
            window.addEventListener('scroll', handler, { passive: true });
            this.check();
        },

        check() {
            const doc = document.documentElement;
            const scrollTop = window.scrollY || doc.scrollTop || 0;
            const scrollHeight = doc.scrollHeight - window.innerHeight;
            if (scrollHeight <= 0) return;

            const depth = Math.min(100, Math.round((scrollTop / scrollHeight) * 100));
            const s = Storage.data.scroll;
            if (depth > s.maxDepth) s.maxDepth = depth;

            [25, 50, 75, 90, 100].forEach((mark) => {
                if (depth >= mark && !s.milestones[mark].reached) {
                    s.milestones[mark].reached = true;
                    s.milestones[mark].time = Math.round(Utils.perfNow() - this.pageStartTs);
                }
            });

            Storage.markDirty();
        }
    };

    /* ========================================================================
       БЛОК: Heatmap — время и посещения по секциям (IntersectionObserver)
    ======================================================================== */
    const Heatmap = {
        activeSections: new Map(), // id -> timestamp входа в область видимости

        init() {
            if (!('IntersectionObserver' in window)) return;
            const sections = Array.from(document.querySelectorAll('section[id]'));
            if (!sections.length) return;

            sections.forEach((el) => {
                const id = el.id;
                if (!Storage.data.heatmap.sections[id]) {
                    Storage.data.heatmap.sections[id] = {
                        visits: 0, timeSpent: 0, returns: 0,
                        wordCount: Utils.wordCount(el.textContent)
                    };
                }
            });

            const io = new IntersectionObserver((entries) => {
                entries.forEach((entry) => {
                    const id = entry.target.id;
                    const rec = Storage.data.heatmap.sections[id];
                    if (!rec) return;

                    if (entry.isIntersecting) {
                        if (rec.visits > 0) rec.returns += 1;
                        rec.visits += 1;
                        this.activeSections.set(id, Utils.perfNow());
                    } else if (this.activeSections.has(id)) {
                        const enteredAt = this.activeSections.get(id);
                        rec.timeSpent += Math.round(Utils.perfNow() - enteredAt);
                        this.activeSections.delete(id);
                    }
                    Storage.markDirty();
                });
            }, { threshold: 0.25 });

            sections.forEach((s) => io.observe(s));
            this._io = io;
        },

        /** Досчитать время для секций, всё ещё находящихся в зоне видимости
         *  (вызывается перед сохранением/выгрузкой). */
        flushActive() {
            this.activeSections.forEach((enteredAt, id) => {
                const rec = Storage.data.heatmap.sections[id];
                if (rec) rec.timeSpent += Math.round(Utils.perfNow() - enteredAt);
                this.activeSections.set(id, Utils.perfNow());
            });
        },

        computeSummary() {
            this.flushActive();
            const sections = Storage.data.heatmap.sections;
            let mostPopular = null, mostIgnored = null;
            let maxTime = -1, minVisits = Infinity;

            Object.keys(sections).forEach((id) => {
                const s = sections[id];
                if (s.timeSpent > maxTime) { maxTime = s.timeSpent; mostPopular = id; }
                if (s.visits < minVisits) { minVisits = s.visits; mostIgnored = id; }

                // Оценка скорости чтения: слов / (секунд/60)
                if (s.timeSpent > 0 && s.wordCount > 0) {
                    const minutes = s.timeSpent / 60000;
                    Storage.data.reading.sections[id] = {
                        estimatedWpm: Utils.round(s.wordCount / Math.max(minutes, 0.01), 0)
                    };
                }
                if (s.visits === 0 && Storage.data.reading.skipped.indexOf(id) === -1) {
                    Storage.data.reading.skipped.push(id);
                }
            });

            Storage.data.heatmap.mostPopular = mostPopular;
            Storage.data.heatmap.mostIgnored = mostIgnored;
            Storage.markDirty();
        },

        currentSection() {
            // Секция, ближайшая к центру экрана — используется при выходе
            let best = null, bestDist = Infinity;
            document.querySelectorAll('section[id]').forEach((el) => {
                const rect = el.getBoundingClientRect();
                const dist = Math.abs(rect.top + rect.height / 2 - window.innerHeight / 2);
                if (dist < bestDist) { bestDist = dist; best = el.id; }
            });
            return best;
        }
    };

    /* ========================================================================
       БЛОК: Clicks — клики по интерактивным элементам
    ======================================================================== */
    const Clicks = {
        init() {
            document.addEventListener('click', (e) => this.handle(e), { passive: true });
        },

        classify(el) {
            if (el.closest('.logo-main')) return 'logo';
            if (el.closest('a[href^="tel:"]')) return 'phone';
            if (el.closest('a[href^="mailto:"]')) return 'email';
            if (el.closest('.nav-link, .header .nav')) return 'menu';
            if (el.closest('#cookieBanner')) return 'cookie';
            if (el.closest('.calc-widget, .calc-compare')) return 'calculator';
            if (el.closest('#preorderCta, .preorder-form')) return 'form';
            if (el.closest('table, .data-table, .compare-table')) return 'table';
            if (el.closest('.problem-card, .roadmap-card, .research-link-card, .proof-item, .faq-item, .econ-card')) return 'card';
            if (el.closest('img')) return 'image';
            if (el.closest('a')) return 'link';
            if (el.closest('button, .btn, [type="button"], [type="submit"]')) return 'button';
            return 'other';
        },

        handle(e) {
            const el = e.target.closest('a, button, .btn, img, [role="button"], input, summary, td, th') || e.target;
            const type = this.classify(el);
            const c = Storage.data.clicks;

            c.total += 1;
            c.byType[type] = (c.byType[type] || 0) + 1;

            // Отдельный подсчёт по каждому CTA-элементу (data-cta или явные .btn-primary/.product-cta)
            const ctaEl = e.target.closest('[data-cta], .btn-primary, .product-cta, .cookie-accept, .cookie-decline');
            if (ctaEl) {
                const key = ctaEl.getAttribute('data-cta') || Utils.describeSelector(ctaEl) || 'cta';
                c.byCta[key] = (c.byCta[key] || 0) + 1;
            }

            c.log.push({
                selector: Utils.describeSelector(el),
                id: el.id || null,
                class: (typeof el.className === 'string') ? el.className : null,
                text: Utils.shortText(el),
                time: new Date().toISOString(),
                x: e.clientX,
                y: e.clientY
            });
            Utils.cap(c.log, MAX_LOG);

            // Клик — это и есть первое взаимодействие для Performance-модуля
            Performance.markFirstInteraction();

            Storage.markDirty();
        }
    };

    /* ========================================================================
       БЛОК: Navigation — клики по меню (последовательность и частота)
    ======================================================================== */
    const Navigation = {
        init() {
            document.addEventListener('click', (e) => {
                const link = e.target.closest('.nav-link');
                if (!link) return;
                const target = (link.getAttribute('href') || '').replace('#', '') || 'unknown';
                const n = Storage.data.navigation;
                n.order.push({ section: target, time: new Date().toISOString() });
                Utils.cap(n.order, MAX_LOG_SMALL);
                n.counts[target] = (n.counts[target] || 0) + 1;
                Storage.markDirty();
            }, { passive: true });
        }
    };

    /* ========================================================================
       БЛОК: Calculator — калькулятор стоимости обработки
    ======================================================================== */
    const CalculatorTracking = {
        init() {
            this.hookSlider('calcArea', 'area');
            this.hookSlider('calcTreatments', 'treatments');
        },

        hookSlider(elId, key) {
            const el = document.getElementById(elId);
            if (!el) return;
            el.addEventListener('change', () => {
                const value = parseFloat(el.value);
                if (Number.isNaN(value)) return;

                const c = Storage.data.calculator;
                c.uses += 1;

                const bucket = c[key];
                bucket.values.push(value);
                Utils.cap(bucket.values, MAX_LOG_SMALL);
                bucket.min = bucket.min === null ? value : Math.min(bucket.min, value);
                bucket.max = bucket.max === null ? value : Math.max(bucket.max, value);
                bucket.avg = Utils.average(bucket.values);
                bucket.mostCommon = Utils.mostFrequent(bucket.values);

                Storage.markDirty();
            }, { passive: true });
        }
    };

    /* ========================================================================
       БЛОК: CookieBanner — метрики баннера согласия
    ======================================================================== */
    const CookieBannerTracking = {
        shownAt: null,

        init() {
            // Баннер сайта показывается через 900мс, если ранее не было решения
            // (см. script.js). Синхронно проверяем то же условие здесь.
            let consent = null;
            try { consent = localStorage.getItem('cookie_consent'); } catch (e) { /* noop */ }

            if (!consent) {
                setTimeout(() => {
                    const b = Storage.data.cookieBanner;
                    b.shown = true;
                    b.shownAt = new Date().toISOString();
                    this.shownAt = Utils.perfNow();
                    Storage.markDirty();
                }, 900);
            }
        },

        onAccept() {
            const b = Storage.data.cookieBanner;
            b.accepted = true;
            b.acceptedAt = new Date().toISOString();
            if (this.shownAt) b.secondsToDecision = Utils.round((Utils.perfNow() - this.shownAt) / 1000, 1);
            Storage.markDirty();
        },

        onDecline() {
            const b = Storage.data.cookieBanner;
            b.declined = true;
            b.declinedAt = new Date().toISOString();
            if (this.shownAt) b.secondsToDecision = Utils.round((Utils.perfNow() - this.shownAt) / 1000, 1);
            Storage.markDirty();
        }
    };

    /* ========================================================================
       БЛОК: Performance — метрики загрузки страницы
    ======================================================================== */
    const Performance = {
        firstInteractionMarked: false,
        fpsFrameCount: 0,
        fpsLastSample: 0,
        fpsSamples: [],

        init() {
            const perf = window.performance;

            document.addEventListener('DOMContentLoaded', () => {
                Storage.data.performance.domContentLoadedMs = Math.round(Utils.perfNow());
                Storage.markDirty();
            });

            window.addEventListener('load', () => {
                Storage.data.performance.loadMs = Math.round(Utils.perfNow());

                if (perf && perf.getEntriesByType) {
                    const nav = perf.getEntriesByType('navigation')[0];
                    if (nav) {
                        Storage.data.performance.navigationTiming = {
                            dnsMs: Utils.round(nav.domainLookupEnd - nav.domainLookupStart),
                            tcpMs: Utils.round(nav.connectEnd - nav.connectStart),
                            ttfbMs: Utils.round(nav.responseStart - nav.requestStart),
                            downloadMs: Utils.round(nav.responseEnd - nav.responseStart),
                            domInteractiveMs: Utils.round(nav.domInteractive),
                            domCompleteMs: Utils.round(nav.domComplete)
                        };
                        Storage.data.performance.fullLoadTimeMs = Utils.round(nav.loadEventEnd);
                    }
                }
                Storage.markDirty();
            });

            this.startFpsSampling();
        },

        markFirstInteraction() {
            if (this.firstInteractionMarked) return;
            this.firstInteractionMarked = true;
            Storage.data.performance.firstInteractionMs = Math.round(Utils.perfNow());
            Storage.markDirty();
        },

        /** Лёгкая приблизительная оценка FPS через подсчёт кадров rAF.
         *  Работает только пока вкладка активна — экономим ресурсы. */
        startFpsSampling() {
            let running = true;
            document.addEventListener('visibilitychange', () => {
                running = document.visibilityState === 'visible';
                if (running) requestAnimationFrame(tick);
            });

            const tick = (t) => {
                if (!running) return;
                this.fpsFrameCount += 1;
                if (t - this.fpsLastSample >= 1000) {
                    this.fpsSamples.push(this.fpsFrameCount);
                    Utils.cap(this.fpsSamples, 30);
                    Storage.data.performance.avgFps = Utils.average(this.fpsSamples);
                    this.fpsFrameCount = 0;
                    this.fpsLastSample = t;
                    Storage.markDirty();
                }
                requestAnimationFrame(tick);
            };
            requestAnimationFrame(tick);
        }
    };

    /* ========================================================================
       БЛОК: Errors — JS-ошибки и unhandled promise rejection
    ======================================================================== */
    const Errors = {
        init() {
            window.addEventListener('error', (e) => {
                this.log({
                    message: e.message || 'Unknown error',
                    source: e.filename || null,
                    line: e.lineno || null,
                    col: e.colno || null,
                    type: 'error'
                });
            });

            window.addEventListener('unhandledrejection', (e) => {
                const reason = e.reason;
                this.log({
                    message: (reason && reason.message) ? reason.message : String(reason),
                    source: null, line: null, col: null,
                    type: 'unhandledrejection'
                });
            });
        },

        log(entry) {
            const err = Storage.data.errors;
            err.count += 1;
            err.log.push(Object.assign({ time: new Date().toISOString() }, entry));
            Utils.cap(err.log, MAX_LOG_SMALL);
            Storage.markDirty();
        }
    };

    /* ========================================================================
       БЛОК: Visibility — переключение вкладок
    ======================================================================== */
    const VisibilityTracking = {
        hiddenAt: null,

        init() {
            document.addEventListener('visibilitychange', () => {
                const v = Storage.data.visibility;
                if (document.visibilityState === 'hidden') {
                    this.hiddenAt = Utils.perfNow();
                    v.hiddenCount += 1;
                } else if (this.hiddenAt) {
                    const durationMs = Math.round(Utils.perfNow() - this.hiddenAt);
                    v.totalHiddenMs += durationMs;
                    v.events.push({
                        hiddenAt: new Date(Date.now() - durationMs).toISOString(),
                        shownAt: new Date().toISOString(),
                        durationMs
                    });
                    Utils.cap(v.events, MAX_LOG_SMALL);
                    this.hiddenAt = null;
                }
                Storage.markDirty();
            });
        }
    };

    /* ========================================================================
       БЛОК: ResizeTrack — изменение размеров окна и ориентации
    ======================================================================== */
    const ResizeTrack = {
        init() {
            const handler = Utils.debounce(() => {
                const r = Storage.data.resize;
                r.events.push({ width: window.innerWidth, height: window.innerHeight, time: new Date().toISOString() });
                Utils.cap(r.events, MAX_LOG_SMALL);
                Storage.data.device.windowWidth = window.innerWidth;
                Storage.data.device.windowHeight = window.innerHeight;
                Storage.markDirty();
            }, 300);

            window.addEventListener('resize', handler, { passive: true });

            if (screen.orientation && screen.orientation.addEventListener) {
                screen.orientation.addEventListener('change', () => {
                    Storage.data.resize.orientationChanges += 1;
                    Storage.data.device.orientation = Device.getOrientation();
                    Storage.markDirty();
                });
            } else {
                window.addEventListener('orientationchange', () => {
                    Storage.data.resize.orientationChanges += 1;
                    Storage.markDirty();
                });
            }
        }
    };

    /* ========================================================================
       БЛОК: Clipboard — копирование текста
    ======================================================================== */
    const Clipboard = {
        init() {
            document.addEventListener('copy', () => {
                Storage.data.clipboard.copyCount += 1;
                Storage.markDirty();
            });
        }
    };

    /* ========================================================================
       БЛОК: ContextMenu — правый клик
    ======================================================================== */
    const ContextMenu = {
        init() {
            document.addEventListener('contextmenu', () => {
                Storage.data.contextMenu.count += 1;
                Storage.markDirty();
            });
        }
    };

    /* ========================================================================
       БЛОК: Selection — выделение текста
    ======================================================================== */
    const Selection = {
        init() {
            const handler = Utils.debounce(() => {
                const sel = window.getSelection ? window.getSelection() : null;
                const text = sel ? sel.toString() : '';
                if (!text || !text.trim()) return;

                let sectionId = null;
                try {
                    const node = sel.anchorNode;
                    const el = node && node.nodeType === 3 ? node.parentElement : node;
                    const section = el ? el.closest('section[id]') : null;
                    sectionId = section ? section.id : null;
                } catch (e) { /* noop */ }

                const s = Storage.data.selection;
                s.count += 1;
                s.events.push({ section: sectionId, length: text.length, time: new Date().toISOString() });
                Utils.cap(s.events, MAX_LOG_SMALL);
                Storage.markDirty();
            }, 400);

            document.addEventListener('selectionchange', handler, { passive: true });
        }
    };

    /* ========================================================================
       БЛОК: Idle — простой пользователя
    ======================================================================== */
    const Idle = {
        IDLE_THRESHOLD_MS: 30000,
        lastActivity: 0,
        isIdle: false,
        idleSince: 0,

        init() {
            this.lastActivity = Utils.perfNow();
            const activityEvents = ['mousemove', 'keydown', 'scroll', 'click', 'touchstart'];
            const onActivity = Utils.throttle(() => this.onActivity(), 1000);
            activityEvents.forEach((evt) => document.addEventListener(evt, onActivity, { passive: true }));

            setInterval(() => this.checkIdle(), 5000);
        },

        onActivity() {
            const now = Utils.perfNow();
            if (this.isIdle) {
                const durationMs = Math.round(now - this.idleSince);
                const idleData = Storage.data.idle;
                idleData.idleEvents.push({ idleSinceMs: Math.round(this.idleSince), durationMs });
                Utils.cap(idleData.idleEvents, MAX_LOG_SMALL);
                idleData.totalIdleMs += durationMs;
                this.isIdle = false;
                Storage.markDirty();
            }
            this.lastActivity = now;
        },

        checkIdle() {
            const now = Utils.perfNow();
            if (!this.isIdle && (now - this.lastActivity) >= this.IDLE_THRESHOLD_MS) {
                this.isIdle = true;
                this.idleSince = this.lastActivity;
            }
        }
    };

    /* ========================================================================
       БЛОК: Returning — повторные визиты
    ======================================================================== */
    const Returning = {
        init() {
            const r = Storage.data.returning;
            const nowIso = new Date().toISOString();
            const prevLastVisit = Storage.data.visits.lastVisit; // ДО обновления в Session.init()

            r.visitCount += 1;
            if (prevLastVisit) {
                r.lastVisitDaysAgo = Utils.daysBetween(prevLastVisit, nowIso);
            }
            r.visitDates.push(nowIso);
            Utils.cap(r.visitDates, 50);

            Storage.markDirty();
        }
    };

    /* ========================================================================
       БЛОК: ExitTracking — как и где пользователь покинул страницу
    ======================================================================== */
    const ExitTracking = {
        init() {
            const record = (method) => {
                Heatmap.computeSummary();
                Session.touch();

                const exit = Storage.data.exit;
                exit.lastSection = Heatmap.currentSection();
                exit.lastActivityAt = new Date().toISOString();
                exit.method = method;

                Storage.markDirty();
                Storage.flush();
            };

            window.addEventListener('pagehide', () => record('pagehide'));
            window.addEventListener('beforeunload', () => record('beforeunload'));
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'hidden') record('tab_hidden');
            });
        }
    };

    /* ========================================================================
       БЛОК: Export — публичные функции для работы со статистикой
    ======================================================================== */
    function getAnalytics() {
        Heatmap.computeSummary();
        Session.touch();
        return JSON.parse(JSON.stringify(Storage.data));
    }

    function clearAnalytics() {
        Storage.clear();
        console.info('[analytics] Статистика очищена.');
    }

    function downloadAnalytics() {
        const data = getAnalytics();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `analytics-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    }

    /* ========================================================================
       БЛОК: Console — красивый вывод статистики в консоль разработчика
    ======================================================================== */
    function printAnalytics() {
        const data = getAnalytics();

        console.group('%c📊 Analytics — сводка по сайту', 'font-weight:bold;font-size:13px;color:#E05A14;');

        console.group('Визиты');
        console.table([{
            'Всего открытий': data.visits.totalOpens,
            'Первый визит': data.visits.firstVisit,
            'Последний визит': data.visits.lastVisit,
            'Сессий': data.visits.sessionCount,
            'Средняя длительность, мс': data.visits.avgDuration,
            'Макс. длительность, мс': data.visits.maxDuration,
            'Мин. длительность, мс': data.visits.minDuration
        }]);
        console.groupEnd();

        console.group('Устройство');
        console.table([data.device]);
        console.groupEnd();

        console.group('Источник перехода');
        console.table([Object.assign({}, data.referrer, { utm: JSON.stringify(data.referrer.utm) })]);
        console.groupEnd();

        console.group('Глубина прокрутки');
        console.table(data.scroll.milestones);
        console.groupEnd();

        console.group('Heatmap по секциям');
        console.table(data.heatmap.sections);
        console.log('Самая популярная секция:', data.heatmap.mostPopular);
        console.log('Самая игнорируемая секция:', data.heatmap.mostIgnored);
        console.groupEnd();

        console.group('Клики');
        console.table(data.clicks.byType);
        console.log('Всего кликов:', data.clicks.total, '| По CTA:', data.clicks.byCta);
        console.groupEnd();

        console.group('Навигация по меню');
        console.table(data.navigation.counts);
        console.groupEnd();

        console.group('Калькулятор');
        console.table({ area: data.calculator.area, treatments: data.calculator.treatments });
        console.groupEnd();

        console.group('Cookie-баннер');
        console.table([data.cookieBanner]);
        console.groupEnd();

        console.group('Производительность');
        console.table([{
            'DOMContentLoaded, мс': data.performance.domContentLoadedMs,
            'Load, мс': data.performance.loadMs,
            'First Interaction, мс': data.performance.firstInteractionMs,
            'Средний FPS': data.performance.avgFps,
            'Полная загрузка, мс': data.performance.fullLoadTimeMs
        }]);
        console.groupEnd();

        console.group('Ошибки');
        console.log('Количество:', data.errors.count);
        if (data.errors.log.length) console.table(data.errors.log);
        console.groupEnd();

        console.group('Прочее');
        console.table([{
            'Скрытий вкладки': data.visibility.hiddenCount,
            'Суммарное время вне вкладки, мс': data.visibility.totalHiddenMs,
            'Копирований текста': data.clipboard.copyCount,
            'ПКМ (контекстное меню)': data.contextMenu.count,
            'Выделений текста': data.selection.count,
            'Периодов простоя': data.idle.idleEvents.length,
            'Повторных визитов': data.returning.visitCount,
            'Дней с прошлого визита': data.returning.lastVisitDaysAgo
        }]);
        console.groupEnd();

        console.groupEnd();
    }

    // Публичный интерфейс — доступен из консоли браузера
    window.getAnalytics = getAnalytics;
    window.clearAnalytics = clearAnalytics;
    window.downloadAnalytics = downloadAnalytics;
    window.printAnalytics = printAnalytics;

    /* ========================================================================
       БЛОК: Bootstrap — инициализация
    ======================================================================== */
    const Bootstrap = {
        behavioralStarted: false,

        /** Минимальный набор, работающий независимо от согласия на cookie:
         *  нужен, чтобы сам баннер согласия корректно считал показы/решения,
         *  и чтобы не потерять базовый подсчёт визитов/устройства. Никаких
         *  поведенческих данных (клики, скролл, heatmap и т.д.) здесь нет. */
        startCore() {
            Storage.init();
            Consent.hook();
            Consent.check();

            Session.init();
            Session.startHeartbeat();
            Returning.init();
            Device.collect();
            Referrer.collect();
            Performance.init();
            Errors.init();
            CookieBannerTracking.init();
            Storage.startAutoFlush();

            // Если согласие уже было дано ранее — запускаем поведенческий трекинг сразу
            if (Consent.granted) this.startBehavioralTracking();
        },

        /** Полноценный поведенческий трекинг — запускается только после
         *  явного согласия пользователя (см. Consent). */
        startBehavioralTracking() {
            if (this.behavioralStarted) return;
            this.behavioralStarted = true;

            Scroll.init();
            Heatmap.init();
            Clicks.init();
            Navigation.init();
            CalculatorTracking.init();
            VisibilityTracking.init();
            ResizeTrack.init();
            Clipboard.init();
            ContextMenu.init();
            Selection.init();
            Idle.init();
            ExitTracking.init();
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => Bootstrap.startCore());
    } else {
        Bootstrap.startCore();
    }

})(window, document);
