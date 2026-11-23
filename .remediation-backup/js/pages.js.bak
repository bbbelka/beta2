// Экраны корзины, заявок, личного кабинета и товара внутри magazin.html (маршрутизация по #хэшу).
(function () {
    const $ = id => document.getElementById(id);
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const pr = p => window.parseProductPrice(p.price);
    const byAvito = a => products.find(p => p.avitoId === String(a));
    const img = p => `<img referrerpolicy="no-referrer" src="${esc(p.image || NO_IMG)}" alt="${esc(p.name)}" onerror="this.onerror=null;this.src=NO_IMG"`;
    const SHOP = CONFIG.phone;
    const VIEWS = ['shop', 'tool', 'cart', 'lk', 'product'];
    const empty = t => `<div class="lk-empty"><p>${esc(t)}</p><a href="#shop" class="lk-empty-action">Перейти в каталог</a></div>`;

    // корзина: берём актуальные данные из каталога по avitoId (id могли смениться при пересборке)
    function lines() {
        return getCart().map(item => {
            const product = byAvito(item.avitoId);
            const quantity = item.quantity == null ? 1 : Number(item.quantity);
            return product && Number.isSafeInteger(quantity) && quantity > 0
                ? { p: product, q: quantity }
                : null;
        }).filter(Boolean);
    }
    function saveLines(ls) { saveCart(ls.map(l => Object.assign({}, l.p, { quantity: l.q }))); updateCartCount(); }
    window.cartQty = function (avitoId, d) {
        const ls = lines(), l = ls.find(x => x.p.avitoId === String(avitoId));
        if (!l) return;
        const change = Number(d);
        if (!Number.isSafeInteger(change) || change === 0) return;
        if (change > 0) {
            if (l.p.available === false) {
                window.storeToast?.('Товар «Нет в наличии» нельзя добавить в корзину.');
                return;
            }
        }
        l.q += change;
        saveLines(ls.filter(x => x.q > 0));
        renderCart();
    };
    window.clearCart = function () {
        saveCart([]);
        updateCartCount();
        renderCart();
    };

    function renderCart() {
        const ls = lines(), box = $('c-cart-items'), sum = $('c-cart-summary');
        $('c-cart-layout').classList.toggle('is-empty', !ls.length);
        $('c-cart-count').textContent = ls.reduce((s, l) => s + l.q, 0);
        if (!ls.length) {
            box.innerHTML = '<div class="empty-cart"><span class="empty-cart-icon"><i class="fas fa-bag-shopping" aria-hidden="true"></i></span><h2>Пока здесь пусто</h2><p>Выберите предметы, которые хотите сохранить в корзине.</p><a href="#shop" class="empty-cart-action">Перейти в каталог</a></div>';
            sum.style.display = 'none'; return;
        }
        const pricesValid = ls.every(({ p }) => pr(p) !== null);
        let sub = pricesValid ? 0 : null;
        box.innerHTML = ls.map(({ p, q }) => {
            if (sub !== null) sub += pr(p) * q;
            const meta = [p.category, p.year].filter(Boolean).map(esc).join(' · ');
            const plusDisabled = p.available === false;
            const unavailable = p.available === false ? '<div class="cart-item-meta product-availability is-unavailable">Нет в наличии</div>' : '';
            const productUrl = inquiryProductUrl(p);
            return `<article class="cart-item">${img(p)} class="cart-item-image">
                <div class="cart-item-info">${productUrl ? `<a class="cart-item-title" href="${esc(productUrl)}">${esc(p.name)}</a>` : `<div class="cart-item-title">${esc(p.name)}</div>`}<div class="cart-item-price">${esc(p.price)}</div>${unavailable}${meta ? `<div class="cart-item-meta">${meta}</div>` : ''}</div>
                <div class="cart-item-controls">
                    <div class="quantity-control">
                        <button type="button" class="quantity-btn" aria-label="Уменьшить количество ${esc(p.name)}" onclick="cartQty('${p.avitoId}',-1)">−</button>
                        <span class="quantity-display">${q}</span>
                        <button type="button" class="quantity-btn" aria-label="Увеличить количество ${esc(p.name)}" ${plusDisabled ? 'disabled' : ''} onclick="cartQty('${p.avitoId}',1)">+</button>
                    </div>
                    <button type="button" class="remove-btn" onclick="cartQty('${p.avitoId}',-999)">Удалить</button>
                </div></article>`;
        }).join('');
        $('c-subtotal').textContent = sub === null ? 'по запросу' : fmtRub(sub);
        $('c-total').textContent = sub === null ? 'по запросу' : fmtRub(sub);
        sum.style.display = 'block';
    }

    // ---------- заявка на приобретение ----------
    let purchaseRequestSending = false;
    let createdPurchaseRequest = null;
    let closingInquiry = false;
    const purchaseRequestIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    function inquiryImageUrl(value, maxLength = 2048) {
        const source = String(value || '').trim();
        if (!source) return '';
        try {
            const url = new URL(source, location.href);
            return url.protocol === 'https:' && url.href.length <= maxLength ? url.href : '';
        } catch (_) {
            return '';
        }
    }

    function inquiryProductUrl(product) {
        const id = Number(product.id);
        if (!Number.isSafeInteger(id) || id <= 0) return '';
        const url = new URL(location.href);
        url.hash = `product-${id}`;
        return url.href;
    }

    function renderInquiryComposition() {
        const currentLines = lines();
        const items = $('inquiry-items');
        const subtotal = currentLines.every(({ p }) => pr(p) !== null)
            ? currentLines.reduce((sum, { p, q }) => sum + pr(p) * q, 0)
            : null;
        items.innerHTML = currentLines.map(({ p, q }) => {
            const photo = inquiryImageUrl(p.image) || NO_IMG;
            const link = inquiryProductUrl(p);
            const availability = p.available === false
                ? '<span class="inquiry-item-unavailable">Нет в наличии — наличие уточнит менеджер</span>'
                : '';
            return `<article class="inquiry-item">
                <img src="${esc(photo)}" alt="${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer">
                <div class="inquiry-item-copy">
                    <h4>${esc(p.name)}</h4>
                    <p>${esc(p.price)}${q > 1 ? ` · ${q} шт.` : ''}</p>
                    ${availability}
                    ${link ? `<a href="${esc(link)}" target="_blank" rel="noopener noreferrer">Открыть карточку товара</a>` : ''}
                </div>
            </article>`;
        }).join('');
        $('inquiry-total').textContent = subtotal === null ? 'Цена по запросу' : fmtRub(subtotal);
        return { currentLines, subtotal };
    }

    function setInquiryStatus(message, type = '') {
        const status = $('inquiry-status');
        status.textContent = message;
        status.className = `inquiry-status${type ? ` is-${type}` : ''}`;
        status.hidden = !message;
    }

    function getPurchaseRequestId(userId, items) {
        const storageKey = `pending_purchase_request_${userId}`;
        const serializedItems = JSON.stringify(items);
        try {
            const stored = JSON.parse(localStorage.getItem(storageKey) || 'null');
            if (stored?.items === serializedItems && purchaseRequestIdPattern.test(stored.id || '')) {
                return stored.id;
            }
        } catch (error) {
            throw new Error(`Не удалось проверить защиту от повторной заявки: ${error?.message || 'хранилище браузера недоступно'}`);
        }
        if (typeof window.crypto?.randomUUID !== 'function') {
            throw new Error('Браузер не поддерживает безопасный идентификатор заявки.');
        }
        const id = window.crypto.randomUUID();
        if (!purchaseRequestIdPattern.test(id)) {
            throw new Error('Не удалось создать безопасный идентификатор заявки.');
        }
        try {
            localStorage.setItem(storageKey, JSON.stringify({ id, items: serializedItems }));
        } catch (error) {
            throw new Error(`Не удалось сохранить защиту от повторной заявки: ${error?.message || 'хранилище браузера недоступно'}`);
        }
        return id;
    }

    function clearPurchaseRequestId(userId) {
        try {
            localStorage.removeItem(`pending_purchase_request_${userId}`);
        } catch (error) {
            console.error('Заявка сохранена, но ключ повтора не удалось очистить:', error);
        }
    }

    async function openPurchaseInquiry() {
        const dialog = $('purchase-inquiry-dialog');
        if (!lines().length) {
            window.storeToast?.('Корзина пуста.');
            return;
        }
        if (!window.sb) {
            window.storeToast?.('Сервис заявок временно недоступен. Корзина сохранена.');
            return;
        }
        if (lines().some(({ p }) => p.available === false)) {
            window.storeToast?.('Уберите из корзины товары с меткой «Нет в наличии».');
            return;
        }
        try {
            const { data, error } = await window.sb.auth.getSession();
            if (error) throw error;
            if (!data?.session) {
                window.storeToast?.('Войдите в аккаунт, чтобы оформить заявку. Корзина сохранена.');
                $('auth-open')?.click();
                return;
            }
        } catch (error) {
            console.error('Не удалось проверить вход перед оформлением заявки:', error);
            window.storeToast?.(`Не удалось проверить вход: ${error?.message || 'ошибка авторизации'}`);
            return;
        }
        closingInquiry = false;
        dialog.classList.remove('is-closing');
        $('purchase-inquiry-form').reset();
        $('purchase-inquiry-form').hidden = false;
        $('inquiry-success').hidden = true;
        $('inquiry-close').hidden = false;
        $('inquiry-submit').disabled = false;
        createdPurchaseRequest = null;
        setInquiryStatus('');
        renderInquiryComposition();
        if (!dialog.open) dialog.showModal();
        requestAnimationFrame(() => $('inquiry-submit').focus());
    }

    function closePurchaseInquiry() {
        const dialog = $('purchase-inquiry-dialog');
        if (purchaseRequestSending || closingInquiry || !dialog.open) return;
        closingInquiry = true;
        dialog.classList.add('is-closing');
        setTimeout(() => {
            if (dialog.open) dialog.close();
            dialog.classList.remove('is-closing');
            closingInquiry = false;
        }, 170);
    }

    function openCreatedRequestInAccount() {
        if (!createdPurchaseRequest) return;
        closePurchaseInquiry();
        location.hash = '#lk';
        window.setTimeout(() => window.openLkSection?.('orders'), 180);
    }

    function openCreatedRequestChat() {
        if (!createdPurchaseRequest?.conversation_id) return;
        closePurchaseInquiry();
        if (typeof window.openShopChatConversation === 'function') {
            window.openShopChatConversation(createdPurchaseRequest.conversation_id);
        } else {
            window.storeToast?.('Чат временно недоступен. Заявка сохранена в разделе «Заказы».');
        }
    }

    async function submitPurchaseRequest(event) {
        event.preventDefault();
        if (purchaseRequestSending) return;
        const form = $('purchase-inquiry-form');
        if (!window.sb) {
            setInquiryStatus('Подключение к Supabase недоступно. Корзина сохранена.', 'error');
            return;
        }

        const { currentLines, subtotal } = renderInquiryComposition();
        if (!currentLines.length) {
            setInquiryStatus('Корзина пуста. Добавьте предметы и повторите попытку.', 'error');
            return;
        }
        if (currentLines.some(({ p }) => p.available === false)) {
            setInquiryStatus('В корзине есть товар с меткой «Нет в наличии». Удалите его и повторите попытку.', 'error');
            return;
        }
        const submit = $('inquiry-submit');
        const close = $('inquiry-close');
        const originalLabel = submit.textContent;
        purchaseRequestSending = true;
        submit.disabled = true;
        close.disabled = true;
        submit.textContent = 'Сохраняем заявку…';
        form.setAttribute('aria-busy', 'true');
        setInquiryStatus('Проверяем цены и сохраняем заявку…');
        try {
            const { data: sessionData, error: sessionError } = await window.sb.auth.getSession();
            if (sessionError) throw sessionError;
            const userId = sessionData?.session?.user?.id;
            if (!userId) {
                setInquiryStatus('Сеанс завершился. Войдите в аккаунт, чтобы отправить заявку. Корзина сохранена.', 'error');
                $('auth-open')?.click();
                return;
            }
            const items = currentLines.map(({ p, q }) => ({
                product_id: Number(p.id),
                quantity: q
            }));
            if (items.some(item => !Number.isSafeInteger(item.product_id) || item.product_id <= 0 ||
                !Number.isSafeInteger(item.quantity) || item.quantity <= 0)) {
                throw new Error('Не удалось определить товары или количество в корзине.');
            }
            const idempotencyKey = getPurchaseRequestId(userId, items);
            const { data, error } = await window.sb.rpc('create_purchase_request', {
                p_items: items,
                p_idempotency_key: idempotencyKey
            });
            if (error) throw error;
            if (!data || !/^[1-9][0-9]*$/.test(String(data.id || '')) ||
                typeof data.request_number !== 'string' || !/^MDA-\d{4}-\d{6,}$/.test(data.request_number) ||
                typeof data.conversation_id !== 'string' ||
                !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.conversation_id) ||
                !Array.isArray(data.items) || !data.items.length ||
                !Number.isFinite(Number(data.total)) || Number(data.total) <= 0) {
                throw new Error('Supabase не вернула подтверждение сохранённой заявки.');
            }
            createdPurchaseRequest = data;
            clearPurchaseRequestId(userId);
            clearCart();
            form.hidden = true;
            $('inquiry-success').hidden = false;
            $('inquiry-close').hidden = true;
            $('inquiry-success-number').textContent = data.request_number;
            $('inquiry-open-order').hidden = false;
            $('inquiry-discuss-order').hidden = !data.conversation_id;
            $('inquiry-success-close').focus();
        } catch (error) {
            console.error('Не удалось сохранить заявку:', error);
            setInquiryStatus(`Не удалось сохранить заявку: ${error?.message || 'ошибка сервера'}. Корзина сохранена; повторите попытку.`, 'error');
        } finally {
            purchaseRequestSending = false;
            submit.disabled = false;
            close.disabled = false;
            submit.textContent = originalLabel;
            form.removeAttribute('aria-busy');
        }
    }

    $('c-request-purchase').addEventListener('click', openPurchaseInquiry);
    $('purchase-inquiry-form').addEventListener('submit', submitPurchaseRequest);
    $('inquiry-close').addEventListener('click', closePurchaseInquiry);
    $('inquiry-success-close').addEventListener('click', closePurchaseInquiry);
    $('inquiry-open-order').addEventListener('click', openCreatedRequestInAccount);
    $('inquiry-discuss-order').addEventListener('click', openCreatedRequestChat);
    $('purchase-inquiry-dialog').addEventListener('cancel', event => {
        event.preventDefault();
        closePurchaseInquiry();
    });
    $('purchase-inquiry-dialog').addEventListener('click', event => {
        if (event.target === $('purchase-inquiry-dialog')) closePurchaseInquiry();
    });

    // ---------- личный кабинет ----------
    async function renderLk() {
        let orders = [];
        let ordersLoadError = false;
        let orderAuthMissing = false;
        const orderList = $('l-orders-list');
        orderList.setAttribute('aria-busy', 'true');
        orderList.innerHTML = '<p class="lk-loading">Загружаем заказы…</p>';
        if (window.sb) {
            try {
                const { data, error: sessionError } = await sb.auth.getSession();
                if (sessionError) throw sessionError;
                if (data?.session) {
                    const { data: remoteOrders, error } = await sb.from('orders').select('*').order('created_at', { ascending: false });
                    if (error) throw error;
                    orders = (remoteOrders || []).map(order => ({ ...order, date: order.date || order.created_at }));
                } else orderAuthMissing = true;
            } catch (error) {
                ordersLoadError = true;
                console.warn('Не удалось загрузить заказы', error);
            }
        } else {
            ordersLoadError = true;
        }
        orderList.removeAttribute('aria-busy');
        const reviews = getList('antique_reviews');
        const favs = getList('favorites').map(f => byAvito(f.avitoId)).filter(Boolean);
        const seen = getList('viewed_ids').map(byAvito).filter(Boolean);
        const formatDate = value => {
            if (!value) return 'Дата не указана';
            const date = new Date(value);
            return Number.isNaN(date.getTime()) ? 'Дата не указана' : date.toLocaleDateString('ru-RU');
        };
        const statusLabels = {
            ordered: 'Заказ оформлен',
            sent: 'Отправлен',
            at_warehouse: 'Прибыл на склад / сортировочный центр',
            ready_for_pickup: 'Готов к получению',
            delivered: 'Получен покупателем',
            cancelled: 'Отменён'
        };
        const orderStatus = order => order.request_number
            ? (order.status === 'cancelled' ? 'Заявка отменена' : 'Заявка принята')
            : statusLabels[order.status] || (order.status ? String(order.status) : 'Статус не указан');
        const orderItems = order => Array.isArray(order.items) ? order.items : [];
        const itemCountText = count => {
            const lastTwo = count % 100, last = count % 10;
            const word = last === 1 && lastTwo !== 11 ? 'товар'
                : last >= 2 && last <= 4 && (lastTwo < 12 || lastTwo > 14) ? 'товара'
                    : 'товаров';
            return `${count} ${word}`;
        };
        const orderTotal = order => Number(order.total) > 0
            ? fmtRub(Number(order.total))
            : 'Уточняется';
        const orderNumber = (order, index) => order.request_number
            ? `Заявка №${esc(order.request_number)}`
            : order.id ? `Заказ №${esc(order.id)}` : `Заказ ${index + 1}`;
        const orderStatusClass = order => order.status === 'delivered' ? 'is-success' : order.status === 'cancelled' ? 'is-cancelled' : 'is-pending';
        const historyIds = getList('viewed_ids');
        const historyCount = historyIds.filter(value => byAvito(typeof value === 'string' ? value : value?.avitoId)).length;
        $('l-viewed-count').textContent = historyCount;
        $('l-favorite-count').textContent = favs.length;
        $('l-order-count').textContent = orders.length;
        $('l-review-count').textContent = reviews.length;
        $('l-clear-history').hidden = historyCount === 0;
        $('l-orders-error').hidden = !ordersLoadError;
        $('l-orders-error').textContent = ordersLoadError
            ? 'Не удалось получить заявки из Supabase. Локальная копия не отображается, чтобы не показать данные другого аккаунта.'
            : '';

        const productRow = (product, kind) => {
            const isFavorite = kind === 'favorite';
            const removeLabel = isFavorite ? 'Убрать из избранного' : 'Удалить из истории';
            return `<article class="lk-product-row">
                <a class="lk-product-link" href="#product-${product.id}">
                    ${img(product)} class="lk-product-image" loading="lazy">
                    <span class="lk-product-copy"><strong>${esc(product.name)}</strong><span>${esc(product.price)}</span></span>
                </a>
                <button type="button" class="lk-icon-action" data-lk-action="${isFavorite ? 'favorite' : 'history'}" data-avito-id="${esc(product.avitoId)}" aria-label="${removeLabel}: ${esc(product.name)}" title="${removeLabel}"><i class="fas fa-xmark" aria-hidden="true"></i></button>
            </article>`;
        };
        $('l-viewed-list').innerHTML = seen.length ? seen.map(product => productRow(product, 'history')).join('') : empty('Вы пока не открывали товары.');
        $('l-favorites-list').innerHTML = favs.length ? favs.map(product => `
            <article class="lk-product-card">
                <a class="lk-product-card-link" href="#product-${product.id}">
                    <span class="lk-product-card-image">${img(product)} class="lk-product-image" loading="lazy"></span>
                    <span class="lk-product-card-copy"><strong>${esc(product.name)}</strong><span>${esc(product.price)}</span></span>
                </a>
                <button type="button" class="lk-secondary-btn" data-lk-action="favorite" data-avito-id="${esc(product.avitoId)}">Убрать из избранного</button>
            </article>`).join('') : empty('В избранном пока ничего нет.');
        document.querySelectorAll('#l-viewed-list [data-lk-action], #l-favorites-list [data-lk-action]').forEach(button => {
            button.addEventListener('click', () => {
                const action = button.dataset.lkAction === 'favorite' ? window.lkUnfav : window.lkRemoveViewed;
                action(button.dataset.avitoId);
            });
        });

        const renderOrderItems = order => orderItems(order).map(item => {
            const name = esc(item.name || 'Товар');
            const quantity = Number.isSafeInteger(Number(item.quantity)) && Number(item.quantity) > 0
                ? Number(item.quantity) : 1;
            const photoValue = item.image || (Array.isArray(item.photos) ? item.photos.find(value => typeof value === 'string') : '');
            const photo = inquiryImageUrl(photoValue);
            const unitAmount = Number(item.unit_price);
            const lineAmount = Number(item.line_total);
            const unitPrice = Number.isFinite(unitAmount) && unitAmount > 0
                ? fmtRub(unitAmount) : String(item.price || 'Цена не указана');
            const lineTotal = Number.isFinite(lineAmount) && lineAmount > 0
                ? fmtRub(lineAmount) : (quantity > 1 ? `${unitPrice} × ${quantity}` : unitPrice);
            return `<li class="lk-order-item">
                ${photo ? `<img src="${esc(photo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="lk-order-item-placeholder" aria-hidden="true"><i class="fas fa-image"></i></span>'}
                <span class="lk-order-item-copy"><strong>${name}</strong><small>${quantity} шт. · ${esc(unitPrice)}</small></span>
                <strong class="lk-order-item-total">${esc(lineTotal)}</strong>
            </li>`;
        }).join('');
        const orderEmptyState = orderAuthMissing
            ? `<div class="lk-empty"><p>Войдите в аккаунт, чтобы увидеть свои заявки.</p><button type="button" class="lk-empty-action" onclick="document.getElementById('auth-open')?.click()">Войти</button></div>`
            : empty('Заявок пока нет.');
        orderList.innerHTML = orders.length ? orders.map((order, index) => {
            const address = order.address || {};
            const addressText = [address.region, address.city, address.street, address.house].filter(Boolean).map(esc).join(', ');
            const delivery = order.delivery || {};
            const isPurchaseRequest = Boolean(order.request_number);
            return `<details class="lk-order-card">
                <summary>
                    <span class="lk-order-summary-copy"><span class="lk-status ${orderStatusClass(order)}">${esc(orderStatus(order))}</span><strong>${orderNumber(order, index)}</strong><span>${formatDate(order.date || order.created_at)} · ${itemCountText(orderItems(order).length)}</span></span>
                    <strong class="lk-order-total">${orderTotal(order)}</strong>
                    <i class="fas fa-chevron-down lk-order-chevron" aria-hidden="true"></i>
                </summary>
                <div class="lk-order-details">
                    <ul class="lk-order-items">${renderOrderItems(order) || '<li>Состав заказа не указан.</li>'}</ul>
                    ${isPurchaseRequest
                        ? `<p class="lk-request-note">Это заявка, а не подтверждённая покупка. Наличие и условия приобретения можно обсудить с менеджером.</p>
                           ${order.conversation_id ? `<button type="button" class="lk-primary-btn lk-request-chat" onclick="openShopChatConversation('${esc(order.conversation_id)}')">Обсудить заявку</button>` : ''}`
                        : `<dl class="lk-order-meta">
                            <div><dt>Доставка</dt><dd>${delivery.company ? esc(delivery.company) : 'Не указана'}${delivery.price != null ? ` · ${esc(delivery.price)} ₽` : ''}</dd></div>
                            ${addressText ? `<div><dt>Адрес</dt><dd>${addressText}</dd></div>` : ''}
                            ${order.tracking_number ? `<div><dt>Трек-номер</dt><dd>${esc(order.tracking_number)}</dd></div>` : ''}
                            ${order.status_note ? `<div><dt>Комментарий к статусу</dt><dd>${esc(order.status_note)}</dd></div>` : ''}
                        </dl>`}
                </div>
            </details>`;
        }).join('') : orderEmptyState;

        const latestOrder = orders[0];
        $('l-overview-order').innerHTML = latestOrder
            ? `<div class="lk-overview-order-details"><span class="lk-status ${orderStatusClass(latestOrder)}">${esc(orderStatus(latestOrder))}</span><strong>${orderNumber(latestOrder, 0)}</strong><span>${formatDate(latestOrder.date || latestOrder.created_at)}</span><span>${orderTotal(latestOrder)}</span><button type="button" class="lk-text-action" onclick="openLkSection('orders')">Все заказы</button></div>`
            : orderAuthMissing ? `<p class="lk-empty-text">Войдите в аккаунт, чтобы увидеть свои заявки.</p><button type="button" class="lk-empty-action" onclick="document.getElementById('auth-open')?.click()">Войти</button>`
                : `<p class="lk-empty-text">Заявок пока нет.</p><a href="#shop" class="lk-empty-action">Перейти в каталог</a>`;

        $('l-user-reviews-list').innerHTML = reviews.length ? reviews.map(review => {
            const rating = Math.max(0, Math.min(5, Number.parseInt(review.rating, 10) || 0));
            const reviewProduct = review.product_id || review.productId
                ? products.find(product => String(product.id) === String(review.product_id || review.productId))
                : null;
            return `<article class="lk-review-card">
                <div class="lk-review-heading"><strong>${esc(review.name || 'Покупатель')}</strong><time>${formatDate(review.date)}</time></div>
                <div class="lk-review-rating" aria-label="Оценка ${rating} из 5">${'★'.repeat(rating)}${'☆'.repeat(5 - rating)}</div>
                <p>${esc(review.text || '')}</p>
                ${reviewProduct ? `<a class="lk-order-item-link" href="#product-${reviewProduct.id}">${esc(reviewProduct.name)}</a>` : ''}
            </article>`;
        }).join('') : empty('Вы пока не оставляли отзывов.');

        const messagesAvailable = typeof window.openShopChat === 'function';
        $('l-open-messages').hidden = !messagesAvailable;
        $('l-messages-unavailable').hidden = messagesAvailable;
    }
    window.lkUnfav = function (a) { localStorage.setItem('favorites', JSON.stringify(getList('favorites').filter(f => f.avitoId !== a))); renderLk(); };
    window.lkRemoveViewed = function (avitoId) {
        const viewed = getList('viewed_ids').filter(value => String(typeof value === 'string' ? value : value?.avitoId) !== String(avitoId));
        localStorage.setItem('viewed_ids', JSON.stringify(viewed));
        renderLk();
    };
    window.lkClearViewed = function () {
        if (!confirm('Очистить всю историю просмотров?')) return;
        localStorage.setItem('viewed_ids', JSON.stringify([]));
        renderLk();
    };
    window.showSection = function (name, btn) {
        const section = $('l-' + name);
        if (!section) return;
        document.querySelectorAll('#view-lk .lk-section').forEach(element => element.classList.toggle('active', element === section));
        document.querySelectorAll('#view-lk .lk-menu-btn').forEach(button => {
            const active = button === btn;
            button.classList.toggle('active', active);
            if (active) button.setAttribute('aria-current', 'page');
            else button.removeAttribute('aria-current');
        });
    };
    window.openLkSection = function (name) {
        const btn = Array.from(document.querySelectorAll('#view-lk .lk-menu-btn')).find(button => button.dataset.section === name);
        if (btn) window.showSection(name, btn);
    };

    // ---------- товар ----------
    const isFav = a => getList('favorites').some(f => f.avitoId === a);
    window.pFav = function (id) {
        const p = products.find(x => x.id === id);
        const favs = getList('favorites').filter(f => f.avitoId !== p.avitoId);
        if (favs.length === getList('favorites').length) favs.push(p);
        localStorage.setItem('favorites', JSON.stringify(favs));
        renderProduct(id);
    };
    let viewerPhotos=[]; let viewerIndex=0;
    window.pPhoto = function (el) { const m = $('p-main-img'); m.src = el.src; viewerIndex=Math.max(0,viewerPhotos.indexOf(el.src)); document.querySelectorAll('.p-thumb').forEach(t => t.classList.toggle('active', t === el)); };
    function ensurePhotoViewer(){if($('photo-lightbox'))return;const st=document.createElement('style');st.textContent='.photo-lightbox{position:fixed;inset:0;z-index:99999;background:rgba(10,10,10,.96);display:none;align-items:center;justify-content:center;padding:24px;overflow:hidden}.photo-lightbox.open{display:flex}.photo-lightbox img{max-width: min(92vw,1500px);max-height:88vh;object-fit:contain;box-shadow:0 15px 60px rgba(0,0,0,.35);cursor:zoom-in;transform:scale(1);transition:transform .12s ease;transform-origin:center center;user-select:none;touch-action:none}.photo-lightbox img.zoomed{cursor:grab;max-width:none;max-height:none}.photo-lightbox button{position:absolute;z-index:2;border:1px solid rgba(255,255,255,.4);background:rgba(30,30,30,.7);color:white;border-radius:50%;width:44px;height:44px;font-size:24px;cursor:pointer}.photo-lightbox-close{top:18px;right:18px}.photo-lightbox-prev{left:18px;top:50%;transform:translateY(-50%)}.photo-lightbox-next{right:18px;top:50%;transform:translateY(-50%)}.photo-lightbox-zoom{right:72px;top:18px}.photo-lightbox-count{position:absolute;bottom:18px;color:#fff;font:14px system-ui;z-index:2}.product-detail-image,.p-thumb{cursor:zoom-in}@media(max-width:600px){.photo-lightbox{padding:10px}.photo-lightbox button{width:40px;height:40px}.photo-lightbox-prev{left:6px}.photo-lightbox-next{right:6px}}';document.head.appendChild(st);const box=document.createElement('div');box.id='photo-lightbox';box.className='photo-lightbox';box.setAttribute('role','dialog');box.setAttribute('aria-modal','true');box.innerHTML='<button type="button" class="photo-lightbox-close" aria-label="Закрыть">×</button><button type="button" class="photo-lightbox-zoom" aria-label="Приблизить" title="Приблизить">🔍+</button><button type="button" class="photo-lightbox-prev" aria-label="Предыдущее фото">‹</button><img id="photo-lightbox-img" alt="Увеличенное фото товара"><button type="button" class="photo-lightbox-next" aria-label="Следующее фото">›</button><div class="photo-lightbox-count" id="photo-lightbox-count"></div>';
    const zoomBtn=box.querySelector('.photo-lightbox-zoom'), photo=box.querySelector('img'); let zoom=1, panX=0, panY=0, dragging=false, suppressClick=false, startX=0, startY=0;
    function applyZoom(){photo.style.transform=`translate(${panX}px,${panY}px) scale(${zoom})`;photo.classList.toggle('zoomed',zoom>1);zoomBtn.textContent=zoom>1?'🔍−':'🔍+';zoomBtn.title=zoom>1?'Сбросить увеличение':'Приблизить';}
    function resetZoom(){zoom=1;panX=panY=0;applyZoom();}
    window.resetPhotoZoom=resetZoom;
    function toggleZoom(){if(zoom>1)resetZoom();else{zoom=2.2;panX=panY=0;applyZoom();}}
    zoomBtn.addEventListener('click',toggleZoom);photo.addEventListener('click',e=>{if(suppressClick){suppressClick=false;e.preventDefault();return;}toggleZoom();});
    box.addEventListener('wheel',e=>{if(!box.classList.contains('open'))return;e.preventDefault();zoom=Math.max(1,Math.min(5,zoom+(e.deltaY<0?.25:-.25)));if(zoom===1)panX=panY=0;applyZoom();},{passive:false});
    photo.addEventListener('pointerdown',e=>{if(zoom<=1)return;dragging=true;startX=e.clientX-panX;startY=e.clientY-panY;photo.setPointerCapture?.(e.pointerId);photo.style.cursor='grabbing';});photo.addEventListener('pointermove',e=>{if(!dragging)return;panX=e.clientX-startX;panY=e.clientY-startY;if(Math.abs(panX)>4||Math.abs(panY)>4)suppressClick=true;applyZoom();});photo.addEventListener('pointerup',()=>{dragging=false;photo.style.cursor=zoom>1?'grab':'zoom-in';});photo.addEventListener('pointercancel',()=>dragging=false);document.body.appendChild(box);box.addEventListener('click',e=>{if(e.target===box||e.target.closest('.photo-lightbox-close'))closePhotoViewer();else if(e.target.closest('.photo-lightbox-prev'))stepPhoto(-1);else if(e.target.closest('.photo-lightbox-next'))stepPhoto(1);});document.addEventListener('keydown',e=>{if(!$('photo-lightbox')?.classList.contains('open'))return;if(e.key==='Escape')closePhotoViewer();if(e.key==='ArrowLeft')stepPhoto(-1);if(e.key==='ArrowRight')stepPhoto(1);});}
    function paintPhotoViewer(){const box=$('photo-lightbox');if(!box)return;const image=$('photo-lightbox-img');image.src=viewerPhotos[viewerIndex]||'';window.resetPhotoZoom?.();image.style.transform='scale(1)';image.classList.remove('zoomed');const z=box.querySelector('.photo-lightbox-zoom');if(z){z.textContent='🔍+';z.title='Приблизить';}$('photo-lightbox-count').textContent=viewerPhotos.length>1?`${viewerIndex+1} / ${viewerPhotos.length}`:'';box.querySelector('.photo-lightbox-prev').style.display=viewerPhotos.length>1?'block':'none';box.querySelector('.photo-lightbox-next').style.display=viewerPhotos.length>1?'block':'none';}
    window.openPhotoViewer=function(src){ensurePhotoViewer();if(src&&viewerPhotos.length&&!viewerPhotos.includes(src)){viewerPhotos.unshift(src);viewerIndex=0;}else if(src)viewerIndex=Math.max(0,viewerPhotos.indexOf(src));paintPhotoViewer();$('photo-lightbox').classList.add('open');document.body.style.overflow='hidden';};
    function closePhotoViewer(){const b=$('photo-lightbox');if(b){b.classList.remove('open');const im=$('photo-lightbox-img');if(im){im.style.transform='scale(1)';im.classList.remove('zoomed');}}document.body.style.overflow='';}
    function stepPhoto(delta){if(!viewerPhotos.length)return;viewerIndex=(viewerIndex+delta+viewerPhotos.length)%viewerPhotos.length;paintPhotoViewer();}
    function gallery(p) {
        const ph = [...new Set((p.photos && p.photos.length ? p.photos : [p.image]).filter(Boolean))];
        viewerPhotos=ph;viewerIndex=0;
        const one = u => `<img referrerpolicy="no-referrer" src="${esc(u || NO_IMG)}" alt="${esc(p.name)}" onerror="this.onerror=null;this.src=NO_IMG"`;
        return `<div class="product-detail-gallery"><div class="product-detail-image-wrapper">${one(ph[0])} id="p-main-img" class="product-detail-image" onclick="openPhotoViewer(this.src)" title="Нажмите, чтобы увеличить"></div>` +
            (ph.length > 1 ? `<div class="p-thumbs">${ph.map((u, i) => `${one(u)} class="p-thumb${i ? '' : ' active'}" onclick="pPhoto(this)" title="Нажмите, чтобы выбрать фото">`).join('')}</div>` : '') +
            '</div>';
    }
    function renderProduct(id) {
        const box = $('p-product-detail'), p = products.find(x => x.id === id);
        if (!p) {
            box.innerHTML = window.catalogReady
                ? '<p class="product-load-state">Товар не найден.</p>'
                : '<p class="product-load-state">Загружаем товар…</p>';
            return;
        }
        document.title = p.name + ' — Старинная Коллекция';
        box.dataset.productId = String(p.id);
        const seen = getList('viewed_ids').filter(a => a !== p.avitoId); seen.unshift(p.avitoId);
        localStorage.setItem('viewed_ids', JSON.stringify(seen.slice(0, 10)));
        const fav = isFav(p.avitoId);
        const meta = [
            p.category && `<div class="meta-item"><span class="meta-label">Категория</span><span class="meta-value">${esc(p.category)}</span></div>`,
            p.year && `<div class="meta-item"><span class="meta-label">Год / период</span><span class="meta-value">${esc(p.year)}</span></div>`,
            p.seller && `<div class="meta-item"><span class="meta-label">Продавец</span><span class="meta-value">${esc(p.seller)}</span></div>`
        ].filter(Boolean).join('');
        const description = p.description
            ? `<div class="product-detail-description"><h2>Описание</h2><p>${esc(p.description)}</p></div>`
            : '';
        const productCanBeAdded = window.canAddToCart?.(p) ?? (pr(p) !== null && p.available !== false);
        const availability = `<p class="product-availability${p.available === false ? ' is-unavailable' : ''}">${p.available === false ? 'Нет в наличии' : 'В наличии'}</p>`;
        box.innerHTML = `<div class="product-detail-summary"><div class="product-detail-header"><h1 class="product-detail-title">${esc(p.name)}</h1><p class="product-detail-price">${esc(p.price)}</p>${availability}</div>
            <div class="product-detail-info">${meta ? `<div class="product-detail-meta">${meta}</div>` : ''}
            ${description}
            <div class="action-buttons">
              <button type="button" class="btn-action product-add-to-cart" ${productCanBeAdded ? '' : 'disabled'} onclick="addToCart(${p.id})">${productCanBeAdded ? 'Добавить в корзину' : 'Нет в наличии'}</button>
              <button type="button" class="btn-action product-favorite" aria-pressed="${fav}" onclick="pFav(${p.id})">${fav ? '♥ В избранном' : '♡ В избранное'}</button>
              <a href="tel:${SHOP}" class="btn-action btn-call">Позвонить ${esc(CONFIG.phoneDisplay)}</a>
              <button type="button" class="btn-action btn-chat" onclick="openShopChat({id:${Number(p.id)||0},name:decodeURIComponent('${encodeURIComponent(p.name)}'),price:decodeURIComponent('${encodeURIComponent(p.price||'Цена не указана')}')})">Написать</button>
            </div></div></div>
            ${gallery(p)}`;
        updateAdminProductAction(p);
    }

    let adminActionRequest = 0;
    async function updateAdminProductAction(product) {
        const request = ++adminActionRequest;
        const box = $('p-product-detail');
        const actions = box.querySelector('.action-buttons');
        if (!actions || !window.sb?.auth) return;
        try {
            const { data, error } = await window.sb.auth.getSession();
            if (error) throw error;
            const session = data?.session;
            if (!session) return;
            const { data: profile, error: profileError } = await window.sb.from('profiles')
                .select('role').eq('id', session.user.id).maybeSingle();
            if (profileError) throw profileError;
            if (request !== adminActionRequest || box.dataset.productId !== String(product.id) ||
                profile?.role !== 'admin' || !actions.isConnected) return;
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'btn-action product-admin-edit';
            button.textContent = 'Редактировать товар';
            const feedback = document.createElement('p');
            feedback.className = 'product-admin-edit-status';
            feedback.setAttribute('role', 'status');
            feedback.hidden = true;
            button.addEventListener('click', async () => {
                button.disabled = true;
                feedback.hidden = true;
                try {
                    if (typeof window.openAdminProductEditor !== 'function') {
                        throw new Error('Редактор товара не загрузился. Обновите страницу.');
                    }
                    await window.openAdminProductEditor(product.id);
                } catch (editError) {
                    feedback.textContent = `Не удалось открыть редактор: ${editError?.message || 'ошибка доступа'}`;
                    feedback.hidden = false;
                } finally {
                    button.disabled = false;
                }
            });
            actions.append(button, feedback);
        } catch (error) {
            console.warn('Не удалось проверить доступ к редактированию товара:', error?.message || error);
        }
    }

    // ---------- маршрутизация ----------
    let hasRouted = false;
    let routeRevision = 0;
    function applyRoute(v, arg) {
        VIEWS.forEach(x => $('view-' + x).hidden = x !== v);
        document.body.dataset.activeView = v;
        if (v === 'cart') renderCart();
        else if (v === 'lk') renderLk();
        else if (v === 'product') renderProduct(arg);
        else if (v === 'tool') document.title = 'Инструмент — Старинная Коллекция';
        if (v !== 'shop' && v !== 'product' && v !== 'tool') {
            document.title = ({ cart: 'Корзина', lk: 'Личный кабинет' }[v] || document.title) + ' — Старинная Коллекция';
        } else if (v === 'shop') {
            document.title = 'Старинная Коллекция — Антиквариат и Редкости';
        }
        window.scrollTo(0, 0);
        updateCartCount();
    }

    function route() {
        const h = location.hash.slice(1);
        let v = 'shop', arg = null;
        if (h === 'tool' || h === 'cart' || h === 'lk') v = h;
        else if (h === 'checkout') v = 'cart';
        else if (/^product-\d+$/.test(h)) { v = 'product'; arg = +h.slice(8); }
        const activeView = VIEWS.find(view => !$('view-' + view).hidden) || 'shop';
        const revision = ++routeRevision;
        const apply = () => {
            if (revision !== routeRevision) return;
            applyRoute(v, arg);
            hasRouted = true;
        };
        const isToolTransition = hasRouted && activeView !== v && [activeView, v].every(view => view === 'shop' || view === 'tool');
        const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (isToolTransition && !reduceMotion && typeof document.startViewTransition === 'function') {
            document.startViewTransition(apply);
        } else {
            apply();
        }
    }
    window.addEventListener('hashchange', route);
    window.addEventListener('catalog-loaded', () => {
        if (/^#product-\d+$/.test(location.hash)) renderProduct(Number(location.hash.slice(9)));
    });
    window.addEventListener('store-product-updated', () => {
        if (/^#product-\d+$/.test(location.hash)) renderProduct(Number(location.hash.slice(9)));
    });
    window.sb?.auth?.onAuthStateChange(() => {
        const match = /^#product-(\d+)$/.exec(location.hash);
        if (!match) return;
        document.querySelector('.product-admin-edit')?.remove();
        document.querySelector('.product-admin-edit-status')?.remove();
        const product = products.find(item => String(item.id) === match[1]);
        if (product) updateAdminProductAction(product);
    });
    document.addEventListener('DOMContentLoaded', route);
})();
