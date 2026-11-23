(function () {
    const ROTATION_DELAY = 12000;
    const IMAGE_TIMEOUT = 3500;
    const TRANSITION_DELAY = 220;
    const MAX_CANDIDATE_ATTEMPTS = 5;
    let cleanup = null;

    function init() {
        if (cleanup) cleanup();

        const showcase = document.getElementById('featured-product');
        const emptyState = document.getElementById('featured-product-empty');
        const imageLink = document.getElementById('featured-product-image-link');
        const image = document.getElementById('featured-product-image');
        const title = document.getElementById('featured-product-title');
        const price = document.getElementById('featured-product-price');
        const description = document.getElementById('featured-product-description');
        const action = document.getElementById('featured-product-action');
        const shopView = document.getElementById('view-shop');
        if (!showcase || !emptyState || !imageLink || !image || !title || !price || !description || !action || !shopView) {
            cleanup = null;
            return;
        }

        let currentProduct = null;
        let currentImageUrl = '';
        let pendingProduct = null;
        let pendingReplacement = null;
        let rotationTimer = 0;
        let transitionTimer = 0;
        let transitionCancel = null;
        let cancelImageLoad = null;
        let requestId = 0;
        let rotationId = 0;
        let imagePreloadLink = null;
        let visibleInViewport = !('IntersectionObserver' in window);
        const failedProducts = new Set();
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

        function products() {
            if (window.catalogSource === 'loading' || window.catalogSource === 'unavailable') return [];
            if (Array.isArray(window.products)) return window.products;
            return Array.isArray(window.CATALOG) ? window.CATALOG : [];
        }

        function safeImageUrl(value) {
            if (typeof value !== 'string' || !value.trim()) return '';
            try {
                const url = new URL(value.trim(), location.href);
                return url.protocol === 'https:' ? url.href : '';
            } catch (_) {
                return '';
            }
        }

        function candidate(product) {
            if (!product || !Number.isSafeInteger(product.id) || product.id < 1) return null;
            const name = typeof product.name === 'string' ? product.name.trim() : '';
            const productPrice = typeof product.price === 'string' || typeof product.price === 'number'
                ? String(product.price).trim()
                : '';
            if (!name || !productPrice || productPrice.toLocaleLowerCase('ru') === 'цена на авито') return null;
            if (product.available === false) return null;

            const sources = [product.image, ...(Array.isArray(product.photos) ? product.photos : [])]
                .map(safeImageUrl)
                .filter((url, index, list) => url && list.indexOf(url) === index)
                .slice(0, 4);
            if (!sources.length) return null;

            return {
                product,
                id: product.id,
                avitoId: typeof product.avitoId === 'string' || typeof product.avitoId === 'number'
                    ? String(product.avitoId)
                    : '',
                name,
                price: productPrice,
                description: typeof product.description === 'string' ? product.description.trim() : '',
                sources
            };
        }

        function availableProducts() {
            const seen = new Set();
            return products().map(candidate).filter(item => {
                if (!item || seen.has(item.id)) return false;
                seen.add(item.id);
                return true;
            });
        }

        function canRotate() {
            return !document.hidden && !shopView.hidden && visibleInViewport && !reducedMotion.matches;
        }

        function clearRotation() {
            if (rotationTimer) window.clearTimeout(rotationTimer);
            rotationTimer = 0;
        }

        function cancelPendingWork() {
            requestId += 1;
            if (cancelImageLoad) cancelImageLoad();
            if (transitionCancel) transitionCancel();
            if (transitionTimer) window.clearTimeout(transitionTimer);
            transitionTimer = 0;
            pendingProduct = null;
            pendingReplacement = null;
            return requestId;
        }

        function setBusy(busy) {
            showcase.setAttribute('aria-busy', String(busy));
        }

        function updateRotation() {
            if (!canRotate()) {
                clearRotation();
                return;
            }
            scheduleNext();
        }

        function scheduleNext() {
            clearRotation();
            if (!canRotate() || !currentProduct) return;
            const next = availableProducts().filter(item =>
                item.id !== currentProduct.id && !failedProducts.has(item.id)
            );
            if (!next.length) return;
            rotationTimer = window.setTimeout(() => {
                rotationTimer = 0;
                rotateToNext();
            }, ROTATION_DELAY);
        }

        function loadImage(url, priority = 'auto') {
            if (priority === 'high' && (!imagePreloadLink || imagePreloadLink.href !== url)) {
                if (imagePreloadLink) imagePreloadLink.remove();
                imagePreloadLink = [...document.querySelectorAll('link[rel="preload"][as="image"]')]
                    .find(link => link.href === url) || null;
                if (!imagePreloadLink) {
                    imagePreloadLink = document.createElement('link');
                    imagePreloadLink.rel = 'preload';
                    imagePreloadLink.as = 'image';
                    imagePreloadLink.href = url;
                    imagePreloadLink.fetchPriority = 'high';
                    imagePreloadLink.referrerPolicy = 'no-referrer';
                    document.head.appendChild(imagePreloadLink);
                }
            }
            return new Promise(resolve => {
                const preload = new Image();
                preload.fetchPriority = priority;
                preload.decoding = 'async';
                let settled = false;
                const timeout = window.setTimeout(() => finish(''), IMAGE_TIMEOUT);
                function finish(result) {
                    if (settled) return;
                    settled = true;
                    window.clearTimeout(timeout);
                    preload.onload = null;
                    preload.onerror = null;
                    if (cancelImageLoad === cancel) cancelImageLoad = null;
                    resolve(result);
                }
                const cancel = () => finish('');
                cancelImageLoad = cancel;
                preload.onload = () => finish(url);
                preload.onerror = () => finish('');
                preload.src = url;
            });
        }

        async function findLoadedImage(item, token, priority = 'auto') {
            for (const source of item.sources) {
                const loaded = await loadImage(source, priority);
                if (token !== requestId) return '';
                if (loaded) return loaded;
            }
            return '';
        }

        function render(item, imageUrl, priority = 'auto') {
            const href = `#product-${item.id}`;
            currentProduct = item;
            currentImageUrl = imageUrl;
            showcase.dataset.productId = String(item.id);
            imageLink.href = href;
            imageLink.setAttribute('aria-label', `Открыть товар: ${item.name}`);
            image.fetchPriority = priority;
            image.loading = 'eager';
            image.src = imageUrl;
            image.alt = item.name;
            title.href = href;
            title.textContent = item.name;
            price.textContent = item.price;
            description.textContent = item.description;
            action.href = href;
            showcase.hidden = false;
            emptyState.hidden = true;
            setBusy(false);
            window.requestAnimationFrame(() => showcase.classList.remove('is-switching'));
            scheduleNext();
        }

        function showEmpty() {
            currentProduct = null;
            currentImageUrl = '';
            showcase.hidden = true;
            showcase.removeAttribute('data-product-id');
            emptyState.textContent = window.catalogSource === 'loading'
                ? 'Загружаем предметы для витрины…'
                : window.catalogSource === 'unavailable'
                    ? 'Витрина временно недоступна: каталог не удалось загрузить.'
                    : failedProducts.size && availableProducts().length
                        ? 'Не удалось загрузить фотографию предмета для витрины.'
                        : 'Сейчас нет предметов с фотографиями для витрины.';
            emptyState.hidden = false;
            setBusy(false);
            clearRotation();
        }

        function onImageError() {
            if (!currentProduct || currentImageUrl !== image.src) return;
            failedProducts.add(currentProduct.id);
            rotationId += 1;
            showEmpty();
            rotateToNext();
        }

        function waitForFade(token) {
            return new Promise(resolve => {
                transitionTimer = window.setTimeout(() => {
                    transitionTimer = 0;
                    transitionCancel = null;
                    resolve(token === requestId);
                }, TRANSITION_DELAY);
                transitionCancel = () => {
                    if (transitionTimer) window.clearTimeout(transitionTimer);
                    transitionTimer = 0;
                    transitionCancel = null;
                    resolve(false);
                };
            });
        }

        async function display(item, knownImageUrl = '', requireVisible = false) {
            clearRotation();
            const token = cancelPendingWork();
            pendingProduct = item;
            setBusy(true);
            const initialImage = !currentProduct;
            const priority = initialImage ? 'high' : 'auto';
            const imageUrl = knownImageUrl || await findLoadedImage(item, token, priority);
            if (token !== requestId) return false;
            if (!imageUrl) {
                failedProducts.add(item.id);
                pendingProduct = null;
                pendingReplacement = null;
                setBusy(false);
                return false;
            }
            if (requireVisible && !canRotate()) {
                pendingProduct = null;
                pendingReplacement = null;
                setBusy(false);
                return false;
            }
            if (!reducedMotion.matches) {
                showcase.classList.add('is-switching');
                const faded = await waitForFade(token);
                if (!faded || token !== requestId) return false;
                if (requireVisible && !canRotate()) {
                    showcase.classList.remove('is-switching');
                    pendingProduct = null;
                    pendingReplacement = null;
                    setBusy(false);
                    return false;
                }
            }
            const productToRender = pendingReplacement || item;
            pendingProduct = null;
            pendingReplacement = null;
            render(productToRender, imageUrl, priority);
            return true;
        }

        async function rotateToNext() {
            const cycle = ++rotationId;
            const options = availableProducts().filter(item =>
                item.id !== currentProduct?.id && !failedProducts.has(item.id)
            );
            if (!options.length) {
                if (!currentProduct || !availableProducts().some(item => item.id === currentProduct.id)) showEmpty();
                else scheduleNext();
                return;
            }

            const preferred = !currentProduct && showcase.dataset.featuredAvitoId
                ? options.find(item => item.avitoId === showcase.dataset.featuredAvitoId)
                : null;
            const first = !currentProduct ? preferred || options[0] : null;
            const shuffled = (first
                ? [first, ...options.slice(1).sort(() => Math.random() - 0.5)]
                : options.sort(() => Math.random() - 0.5)
            ).slice(0, MAX_CANDIDATE_ATTEMPTS);
            const initialImageUrl = first && image.src && first.sources.includes(image.src)
                && !(image.complete && image.naturalWidth === 0)
                ? image.src
                : '';
            for (const item of shuffled) {
                const knownImageUrl = item === first ? initialImageUrl : '';
                const shown = await display(item, knownImageUrl, Boolean(currentProduct));
                if (cycle !== rotationId) return;
                if (shown || item.id === currentProduct?.id) return;
                if (!canRotate() && currentProduct) return;
            }
            if (!currentProduct || !availableProducts().some(item => item.id === currentProduct.id)) showEmpty();
            else scheduleNext();
        }

        function onCatalogChange() {
            const eligible = availableProducts();
            if (!currentProduct && pendingProduct) {
                const pendingMatch = eligible.find(item =>
                    pendingProduct.avitoId && item.avitoId === pendingProduct.avitoId
                );
                if (pendingMatch) {
                    pendingReplacement = pendingMatch;
                    return;
                }
            }

            rotationId += 1;
            cancelPendingWork();
            showcase.classList.remove('is-switching');
            setBusy(false);
            failedProducts.clear();
            const replacement = eligible.find(item => item.id === currentProduct?.id
                || (currentProduct?.avitoId && item.avitoId === currentProduct.avitoId));
            if (!replacement) {
                rotateToNext();
                return;
            }

            const imageStillAvailable = replacement.sources.includes(currentImageUrl);
            const detailsUnchanged = replacement.name === currentProduct.name
                && replacement.price === currentProduct.price
                && replacement.description === currentProduct.description;
            if (imageStillAvailable && detailsUnchanged) {
                currentProduct = replacement;
                const href = `#product-${replacement.id}`;
                showcase.dataset.productId = String(replacement.id);
                imageLink.href = href;
                imageLink.setAttribute('aria-label', `Открыть товар: ${replacement.name}`);
                title.href = href;
                action.href = href;
                scheduleNext();
                return;
            }
            display(replacement, imageStillAvailable ? currentImageUrl : '');
        }

        function onVisibilityChange() {
            if (document.hidden) clearRotation();
            else onCatalogChange();
        }

        const intersectionObserver = 'IntersectionObserver' in window
            ? new IntersectionObserver(entries => {
                visibleInViewport = entries.some(entry => entry.isIntersecting);
                updateRotation();
            })
            : null;

        const onMotionChange = () => updateRotation();
        const addMotionListener = event => {
            if (typeof reducedMotion.addEventListener === 'function') reducedMotion.addEventListener('change', event);
            else reducedMotion.addListener(event);
        };
        const removeMotionListener = event => {
            if (typeof reducedMotion.removeEventListener === 'function') reducedMotion.removeEventListener('change', event);
            else reducedMotion.removeListener(event);
        };

        window.addEventListener('catalog-loaded', onCatalogChange);
        window.addEventListener('catalog-updated', onCatalogChange);
        window.addEventListener('store-product-updated', onCatalogChange);
        window.addEventListener('hashchange', onCatalogChange);
        document.addEventListener('visibilitychange', onVisibilityChange);
        image.addEventListener('error', onImageError);
        if (intersectionObserver) intersectionObserver.observe(showcase);
        addMotionListener(onMotionChange);

        cleanup = () => {
            rotationId += 1;
            clearRotation();
            cancelPendingWork();
            intersectionObserver?.disconnect();
            window.removeEventListener('catalog-loaded', onCatalogChange);
            window.removeEventListener('catalog-updated', onCatalogChange);
            window.removeEventListener('store-product-updated', onCatalogChange);
            window.removeEventListener('hashchange', onCatalogChange);
            document.removeEventListener('visibilitychange', onVisibilityChange);
            image.removeEventListener('error', onImageError);
            removeMotionListener(onMotionChange);
            showcase.classList.remove('is-switching');
            showcase.removeAttribute('aria-busy');
            cleanup = null;
        };

        rotateToNext();
    }

    function destroy() {
        if (cleanup) cleanup();
    }

    window.initFeaturedProductShowcase = init;
    window.destroyFeaturedProductShowcase = destroy;
    init();
})();
