// Общая логика сайта. Каталог берётся из catalog.js (window.CATALOG) — без fetch,
// поэтому всё работает и при открытии файлов двойным кликом.
(function () {
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const getList = k => { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
    const NO_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect width="400" height="300" fill="#e7e1d0"/><text x="200" y="158" font-family="serif" font-size="22" fill="#a8843f" text-anchor="middle">Фото на Авито</text></svg>');
    const priceOf = p => window.parseProductPrice(p.price);
    const fmtRub = n => n > 0 ? n.toLocaleString('ru-RU') + ' ₽' : 'по запросу';
    const ICONS = { 'Посуда': 'fa-mug-hot', 'Свет': 'fa-lightbulb', 'Фигурки и декор': 'fa-chess-knight', 'Инструменты и приборы': 'fa-compass', 'Кухня и быт': 'fa-utensils', 'Техника': 'fa-radio', 'Медицина': 'fa-kit-medical', 'Курительные': 'fa-smoking' };

    const products = (window.CATALOG || []).map(p => Object.assign({ price: 'Цена на Авито', category: 'Разное', year: '', image: '', description: '', seller: 'Старинная Коллекция', link: '', available: true }, p));
    window.catalogReady = false;
    window.products = products;
    window.catalogSource = 'local';
    const getCart = () => getList('cart');
    const saveCart = c => localStorage.setItem('cart', JSON.stringify(c));
    const getFavs = () => getList('favorites');
    const isFavorite = id => getFavs().some(p => p.id === id);
    const canAddToCart = product => priceOf(product) !== null && product.available !== false;

    function toast(msg) {
        const t = document.createElement('div');
        t.className = 'toast'; t.textContent = msg; document.body.appendChild(t);
        setTimeout(() => t.remove(), 2000);
    }

    function updateCartCount() {
        const n = getCart().reduce((s, i) => s + (i.quantity || 1), 0);
        const btn = document.getElementById('cart-btn');
        if (btn) btn.innerHTML = `<i class="fas fa-shopping-cart"></i> Корзина${n ? ` (${n})` : ''}`;
    }

    function addToCart(id) {
        const product = products.find(p => p.id === id);
        if (!product) return;
        if (priceOf(product) === null) { toast('Для покупки нужна корректная цена товара.'); return; }
        if (!canAddToCart(product)) { toast('Товар временно отсутствует.'); return; }
        const cart = getCart();
        const ex = cart.find(p => p.id === id);
        const currentQuantity = ex && Number.isSafeInteger(Number(ex.quantity)) && Number(ex.quantity) > 0
            ? Number(ex.quantity) : 0;
        if (ex) ex.quantity = currentQuantity + 1; else cart.push(Object.assign({}, product, { quantity: 1 }));
        saveCart(cart);
        updateCartCount();
        toast(`${product.name} — в корзине`);
    }

    function removeFromCart(id) {
        saveCart(getCart().filter(p => p.id !== id));
        if (typeof window.renderCart === 'function') window.renderCart();
        updateCartCount();
    }

    function toggleFavorite(event, id) {
        event.stopPropagation();
        let favs = getFavs();
        if (favs.some(p => p.id === id)) favs = favs.filter(p => p.id !== id);
        else favs.push(products.find(p => p.id === id));
        localStorage.setItem('favorites', JSON.stringify(favs));
        renderProducts();
    }

    function showProduct(id) { location.hash = 'product-' + id; }

    // ---------- каталог на главной ----------
    let category = 'all', searchQuery = '', sortBy = 'default';
    let toolSearchQuery = '', toolSortBy = 'default';
    const CATALOG_PAGE_SIZE = 8;
    let catalogStackFrame = 0;
    let catalogStackLastFrame = 0;
    const reduceStackMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const stackHeader = document.querySelector('.site-header');
    let stackHeaderOffset = 68;

    function syncStackHeaderOffset() {
        document.documentElement.style.setProperty('--stack-viewport-width', `${document.documentElement.clientWidth}px`);
        stackHeaderOffset = stackHeader ? Math.ceil(stackHeader.getBoundingClientRect().height) : 68;
        if (stackHeader) document.documentElement.style.setProperty('--stack-header-offset', `${stackHeaderOffset}px`);
    }

    if (stackHeader) {
        syncStackHeaderOffset();
        if (typeof ResizeObserver === 'function') new ResizeObserver(syncStackHeaderOffset).observe(stackHeader);
        window.addEventListener('resize', syncStackHeaderOffset);
    }

    function catalogPagesMarkup(list, variant = '') {
        const pages = [];
        for (let start = 0; start < list.length; start += CATALOG_PAGE_SIZE) {
            const page = list.slice(start, start + CATALOG_PAGE_SIZE);
            const pageNumber = pages.length + 1;
            const end = start + page.length;
            const variantClass = variant ? ` catalog-page--${variant}` : '';
            const gridClass = variant ? `products-grid ${variant}-products-grid` : 'products-grid';
            pages.push(`<section class="catalog-page${variantClass}" style="--catalog-index:${pageNumber - 1}" aria-label="Объявления ${start + 1}–${end}">
                <div class="catalog-page-surface"><div class="${gridClass}">${page.map(product => productCardMarkup(product, variant)).join('')}</div></div>
            </section>`);
        }
        return pages.join('');
    }

    function updateCatalogStack(timestamp) {
        catalogStackFrame = 0;
        const frameDuration = catalogStackLastFrame ? Math.min(64, timestamp - catalogStackLastFrame) : 16.67;
        catalogStackLastFrame = timestamp;
        const blend = reduceStackMotion ? 1 : 1 - Math.exp(-frameDuration / 90);
        const viewportHeight = window.innerHeight;
        let isAnimating = false;
        const updates = [];
        [...document.querySelectorAll('#products-grid, #tool-products-grid')]
            .filter(stack => !stack.closest('[hidden]'))
            .forEach(stack => {
                const pages = [...stack.querySelectorAll('.catalog-page')];
                const geometry = pages.map(page => ({
                    top: page.getBoundingClientRect().top,
                    stickyTop: stackHeaderOffset
                }));
                pages.forEach((page, index) => {
                    const currentGeometry = geometry[index];
                    const nextGeometry = geometry[index + 1];
                    const entryProgress = Math.max(0, Math.min(1, (viewportHeight - currentGeometry.top) / Math.max(1, viewportHeight - currentGeometry.stickyTop)));
                    let coverProgress = 0;
                    if (nextGeometry) {
                        coverProgress = Math.max(0, Math.min(1, (viewportHeight - nextGeometry.top) / Math.max(1, viewportHeight - nextGeometry.stickyTop)));
                    }
                    const scale = index ? 0.994 + entryProgress * 0.006 - coverProgress * 0.006 : 1 - coverProgress * 0.006;
                    const targets = {
                        '--catalog-scale': Math.max(0.988, Math.min(1, scale)),
                        '--catalog-dim': coverProgress * 0.08
                    };
                    const values = {};
                    Object.entries(targets).forEach(([property, target]) => {
                        const current = Number.parseFloat(page.style.getPropertyValue(property));
                        const next = Number.isFinite(current) ? current + (target - current) * blend : target;
                        const settled = Math.abs(target - next) < 0.0002;
                        values[property] = (settled ? target : next).toFixed(5);
                        if (!settled) isAnimating = true;
                    });
                    updates.push({ page, values });
                });
            });
        updates.forEach(({ page, values }) => {
            Object.entries(values).forEach(([property, value]) => {
                if (page.style.getPropertyValue(property) !== value) page.style.setProperty(property, value);
            });
        });
        if (isAnimating) scheduleCatalogStackUpdate();
        else catalogStackLastFrame = 0;
    }

    function scheduleCatalogStackUpdate() {
        if (!catalogStackFrame) catalogStackFrame = requestAnimationFrame(updateCatalogStack);
    }

    window.addEventListener('scroll', scheduleCatalogStackUpdate, { passive: true });
    window.addEventListener('resize', scheduleCatalogStackUpdate);

    function renderCategories() {
        const box = document.getElementById('category-filters');
        if (!box) return;
        const counts = {};
        products.forEach(p => counts[p.category] = (counts[p.category] || 0) + 1);
        const cats = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
        const toolCount = (counts['Инструменты и приборы'] || 0) + (counts['Инструмент'] || 0);
        box.innerHTML = `<button class="category-btn" data-cat="all">Все товары <small>${products.length}</small></button>` +
            cats.filter(c => c !== 'Инструменты и приборы' && c !== 'Инструмент')
                .map(c => `<button class="category-btn" data-cat="${esc(c)}">${esc(c)} <small>${counts[c]}</small></button>`).join('') +
            `<button class="category-btn" data-cat="__tool">Инструмент <small>${toolCount}</small></button>`;
        box.onclick = e => { const b = e.target.closest('.category-btn'); if (b) filterByCategory(b.dataset.cat); };
    }

    function sortProducts(list, value) {
        const known = (a, b, dir) => { const x = priceOf(a), y = priceOf(b); if (!x || !y) return (x ? 0 : 1) - (y ? 0 : 1) || 0; return (x - y) * dir; };
        if (value === 'price-asc') list.sort((a, b) => known(a, b, 1));
        else if (value === 'price-desc') list.sort((a, b) => known(a, b, -1));
        else if (value === 'new-first') list.sort((a, b) => Number(b.avitoId || 0) - Number(a.avitoId || 0));
        return list;
    }

    function productCardMarkup(p, variant = '') {
        const fav = isFavorite(p.id), n = priceOf(p), canAdd = canAddToCart(p);
        const cartLabel = canAdd ? 'В корзину' : 'Нет в наличии';
        const media = p.image
            ? `<img referrerpolicy="no-referrer" src="${esc(p.image)}" alt="${esc(p.name)}" class="product-photo" loading="lazy" fetchpriority="low" decoding="async" onerror="this.onerror=null;this.src=NO_IMG">`
            : `<div class="product-image-content"><i class="fas ${ICONS[p.category] || 'fa-gem'} item-icon"></i><div class="item-name">${esc(p.category)}</div></div>`;
        return `<article class="product-card${variant ? ` product-card--${variant}` : ''}" onclick="showProduct(${p.id})" style="cursor:pointer">
            <div class="product-image-wrapper">${media}
                <button class="btn-favorite" aria-label="В избранное" onclick="toggleFavorite(event, ${p.id})"><i class="${fav ? 'fas' : 'far'} fa-heart" style="color:${fav ? '#b54747' : '#68716c'}"></i></button>
                <button class="btn-cart" aria-label="${cartLabel}" title="${cartLabel}" ${canAdd ? '' : 'disabled'} onclick="event.stopPropagation();addToCart(${p.id})"><i class="fas fa-shopping-cart"></i></button>
            </div>
            <div class="product-info">
                <h3 class="product-name">${esc(p.name)}</h3>
                <p class="product-price ${n ? '' : 'price-ask'}">${esc(p.price)}</p>
                ${p.available === false ? '<p class="product-availability is-unavailable">Нет в наличии</p>' : ''}
                ${p.description ? `<p class="product-description">${esc(p.description.length > 110 ? p.description.slice(0, 110) + '…' : p.description)}</p>` : ''}
                <div class="product-meta"><span>${esc(p.category === 'Инструменты и приборы' ? 'Инструмент' : p.category)}</span><span>${p.year ? esc(p.year) : '№ ' + String(p.id).padStart(3, '0')}</span></div>
            </div></article>`;
    }

    function renderProducts() {
        const grid = document.getElementById('products-grid');
        if (!grid) return;
        let list = products.filter(p => category === 'all' || p.category === category);
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            list = list.filter(p => (p.name + ' ' + p.description + ' ' + p.category).toLowerCase().includes(q));
        }
        sortProducts(list, sortBy);
        document.querySelectorAll('.category-btn').forEach(b => b.classList.toggle('active', b.dataset.cat === category));
        if (!list.length) { grid.innerHTML = '<div class="product-empty-state"><p>Товары не найдены</p></div>'; return; }
        grid.innerHTML = catalogPagesMarkup(list);
        scheduleCatalogStackUpdate();
    }

    function renderToolProducts() {
        const grid = document.getElementById('tool-products-grid');
        if (!grid) return;
        let list = products.filter(product => ['Инструмент', 'Инструменты и приборы'].includes(product.category));
        if (toolSearchQuery) {
            const query = toolSearchQuery.toLocaleLowerCase('ru');
            list = list.filter(product => [product.name, product.description, product.category]
                .some(value => String(value || '').toLocaleLowerCase('ru').includes(query)));
        }
        sortProducts(list, toolSortBy);
        grid.innerHTML = list.length
            ? catalogPagesMarkup(list, 'tool')
            : '<div class="product-empty-state"><p>В этой категории пока нет доступных товаров.</p></div>';
        scheduleCatalogStackUpdate();
        const hero = document.getElementById('tool-hero-image');
        const featured = products.find(product => ['Инструмент', 'Инструменты и приборы'].includes(product.category) && product.image);
        hero?.parentElement.classList.toggle('has-feature-image', Boolean(featured));
        if (hero && featured) {
            hero.hidden = false;
            hero.innerHTML = `<img src="${esc(featured.image)}" alt="${esc(featured.name)}" loading="lazy" onerror="this.onerror=null;this.src=NO_IMG"><figcaption>${esc(featured.name)}</figcaption>`;
        } else if (hero) {
            hero.hidden = true;
            hero.replaceChildren();
        }
    }

    function filterByCategory(c) {
        if (c === '__tool') { location.hash = 'tool'; return; }
        category = c; renderProducts(); syncReset();
    }
    function searchProducts() { searchQuery = document.getElementById('search-input').value.trim(); renderProducts(); syncReset(); }
    function handleSort(v) { sortBy = v; renderProducts(); syncReset(); }
    function syncReset() { const b = document.getElementById('reset-filters-btn'); if (b) b.style.display = (searchQuery || sortBy !== 'default' || category !== 'all') ? 'inline-block' : 'none'; }
    function resetFilters() {
        searchQuery = ''; sortBy = 'default'; category = 'all';
        document.getElementById('search-input').value = ''; document.getElementById('sort-select').value = 'default';
        renderProducts(); syncReset();
    }

    // ---------- отзывы (хранятся только в браузере посетителя) ----------
    const loadReviews = () => getList('antique_reviews');
    let allReviews = false;
    function renderReviews() {
        const box = document.getElementById('reviews-container');
        if (!box) return;
        const av = (window.AVITO_REVIEWS || []).map(r => Object.assign({ source: 'Авито' }, r));
        const rs = av.concat(loadReviews());
        if (!rs.length) { box.innerHTML = '<p style="text-align:center;color:var(--ds-color-text)">Пока нет отзывов. Будьте первым!</p>'; return; }
        const rated = av.filter(r => r.rating > 0);
        const avg = rated.length ? (rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(1).replace('.', ',') : '';
        const shown = allReviews ? rs : rs.slice(0, 6);
        box.innerHTML = (avg ? `<p class="reviews-summary">Средняя оценка по отзывам на Авито: <strong>${avg} из 5</strong> (${rated.length})</p>` : '') +
            shown.map(r => `<div class="review-card"><div class="review-header"><span class="review-author">${esc(r.name)}</span><span class="review-date">${esc(r.dateText || new Date(r.date).toLocaleDateString('ru-RU'))}${r.source ? ' · ' + esc(r.source) : ''}</span></div>
                ${r.rating ? `<div class="review-rating">${'★'.repeat(r.rating)}${'☆'.repeat(5 - r.rating)}</div>` : ''}
                ${r.item ? `<p class="review-date" style="margin-bottom:.4rem">${esc(r.item)}</p>` : ''}<p class="review-text">${esc(r.text)}</p></div>`).join('') +
            (!allReviews && rs.length > 6 ? `<p style="text-align:center"><button class="category-btn" onclick="showAllReviews()">Показать все отзывы (${rs.length})</button></p>` : '');
    }
    function showAllReviews() { allReviews = true; renderReviews(); }

    document.addEventListener('DOMContentLoaded', async function () {
        if (typeof window.loadRemoteProducts === 'function') {
            let remote = null;
            try {
                remote = await window.loadRemoteProducts();
            } catch (error) {
                console.error('Не удалось загрузить каталог из Supabase:', error?.message || error);
            }
            if (Array.isArray(remote) && window.sb) {
                products.splice(0, products.length, ...remote);
                window.products = products;
                window.catalogSource = 'remote';
            } else if (window.sb) {
                window.catalogSource = 'unavailable';
            }
        }
        updateCartCount();
        renderCategories(); renderProducts(); renderReviews(); renderToolProducts();
        window.catalogReady = true;
        window.dispatchEvent(new Event('catalog-loaded'));

        const form = document.getElementById('review-form');
        if (form) form.addEventListener('submit', function (e) {
            e.preventDefault();
            const name = document.getElementById('review-name').value.trim();
            const rating = parseInt(document.getElementById('review-rating').value, 10);
            const text = document.getElementById('review-text').value.trim();
            if (!name || !rating || !text) return;
            const rs = loadReviews(); rs.push({ name, rating, text, date: new Date().toISOString() });
            localStorage.setItem('antique_reviews', JSON.stringify(rs));
            renderReviews(); this.reset();
            const btn = this.querySelector('.btn-submit'), old = btn.textContent;
            btn.textContent = 'Отзыв сохранён в этом браузере.'; btn.style.backgroundColor = '#2e7d32';
            setTimeout(() => { btn.textContent = old; btn.style.backgroundColor = '#1f2d27'; }, 3000);
        });

        document.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', function (e) {
            const t = this.getAttribute('href').length > 1 && document.querySelector(this.getAttribute('href'));
            if (t) { e.preventDefault(); t.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
        }));
        document.getElementById('tool-search-input')?.addEventListener('input', event => {
            toolSearchQuery = event.target.value.trim();
            renderToolProducts();
        });
        document.getElementById('tool-sort-select')?.addEventListener('change', event => {
            toolSortBy = event.target.value;
            renderToolProducts();
        });
    });

    window.addEventListener('catalog-loaded', renderToolProducts);
    window.addEventListener('store-product-updated', renderToolProducts);
    window.addEventListener('hashchange', () => {
        if (location.hash === '#tool') renderToolProducts();
    });
    document.addEventListener('DOMContentLoaded', () => {
        const dialog = document.getElementById('contact-dialog');
        if (!dialog) return;
        const open = event => {
            event?.preventDefault();
            if (!dialog.open) dialog.showModal();
        };
        document.querySelectorAll('[data-open-contact], #auth-contact-link').forEach(button => {
            button.addEventListener('click', open);
        });
        dialog.querySelector('[data-close-contact]')?.addEventListener('click', () => dialog.close());
        dialog.addEventListener('cancel', event => {
            event.preventDefault();
            dialog.close();
        });
        document.addEventListener('keydown', event => {
            if (event.key !== 'Escape' || !dialog.open) return;
            event.preventDefault();
            dialog.close();
        });
        dialog.addEventListener('click', event => {
            if (event.target === dialog) dialog.close();
        });
    });
    Object.assign(window, { products, NO_IMG, getCart, saveCart, getList, fmtRub, addToCart, removeFromCart, updateCartCount,
        canAddToCart, storeToast: toast,
        toggleFavorite, showProduct, showAllReviews, filterByCategory, searchProducts, handleSort, resetFilters,
        refreshRemoteCatalog: async function(){ const remote=await window.loadRemoteProducts?.(); if(Array.isArray(remote)&&window.sb){products.splice(0,products.length,...remote);window.catalogSource='remote';renderCategories();renderProducts();renderToolProducts();window.dispatchEvent(new Event('catalog-updated'));} } });

    // Глобальный обработчик неперехваченных ошибок JavaScript.
    window.addEventListener('error', function(event){
      console.error('Неперехваченная ошибка JS:', event.message, 'в', event.filename, 'строка', event.lineno);
    });
    window.addEventListener('unhandledrejection', function(event){
      console.error('Неперехваченное отклонение промиса:', event.reason?.message||event.reason);
    });
})();
