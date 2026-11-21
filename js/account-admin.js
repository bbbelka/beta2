(() => {
  const $ = id => document.getElementById(id);
  const statusLabels = {
    ordered: 'Заказ оформлен',
    sent: 'Отправлен',
    at_warehouse: 'Прибыл на склад / сортировочный центр',
    ready_for_pickup: 'Готов к получению',
    delivered: 'Получен покупателем',
    cancelled: 'Отменён'
  };
  const backgroundNames = {
    '#ffffff': 'white',
    '#f1e6d2': 'warm-beige',
    '#e5e5e2': 'light-gray',
    '#d2c2a4': 'sand',
    '#30312f': 'graphite',
    '#f7f0df': 'ivory'
  };

  let products = [];
  let orders = [];
  let productError = '';
  let orderError = '';
  let processedPhotoFiles = null;
  let selectedPhotoFiles = [];
  let existingPhotoUrls = [];
  let previewObjectUrls = [];
  let loadPromise = null;
  let productSaveInProgress = false;
  let productDialog = null;
  let productFormHome = null;
  let lastProductEditorTrigger = null;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));

  function safeHttpUrl(value) {
    try {
      const url = new URL(String(value), location.href);
      return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '';
    } catch {
      return '';
    }
  }

  function amount(value) {
    return window.parseProductPrice(value);
  }

  function comparePrices(a, b, descending) {
    const left = amount(a.price), right = amount(b.price);
    if (left === null || right === null) {
      if (left === right) return 0;
      return left === null ? 1 : -1;
    }
    return (left - right) * (descending ? -1 : 1);
  }

  function money(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? `${new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(parsed)} ₽`
      : '—';
  }

  function dateText(value) {
    if (!value) return 'Дата не указана';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Дата не указана' : date.toLocaleString('ru-RU', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
  }

  function productPhoto(product) {
    const image = (Array.isArray(product.photos) ? product.photos[0] : '') || product.image || '';
    return safeHttpUrl(image);
  }

  function notify(text, type = 'error') {
    const element = $('owner-message');
    if (!element) return;
    element.textContent = text || '';
    element.hidden = !text;
    element.classList.toggle('is-error', Boolean(text) && type === 'error');
    element.classList.toggle('is-success', Boolean(text) && type === 'success');
  }

  function shell() {
    const root = $('account-admin-tools');
    if (!root || root.dataset.initialized === 'true') return;
    root.dataset.initialized = 'true';
    root.innerHTML = `
      <div class="owner-admin" id="owner-admin" aria-busy="false">
        <header class="owner-admin-header">
          <div>
            <p class="owner-admin-eyebrow">Рабочее пространство</p>
            <h1 id="owner-page-title">Обзор магазина</h1>
            <p class="owner-admin-description">Товары, заказы и связь с покупателями — в одном месте.</p>
          </div>
          <div class="owner-admin-header-actions">
            <button type="button" class="owner-admin-button" id="owner-refresh"><i class="fas fa-rotate" aria-hidden="true"></i> Обновить данные</button>
            <button type="button" class="owner-admin-button owner-admin-button--primary" id="owner-open-chat"><i class="fas fa-message" aria-hidden="true"></i> Сообщения</button>
          </div>
        </header>
        <p id="owner-message" class="owner-admin-message" role="status" aria-live="polite" hidden></p>

        <div class="owner-admin-layout">
          <nav class="owner-admin-nav" aria-label="Разделы управления магазином">
            <button type="button" data-owner-view="overview" aria-current="page"><i class="fas fa-chart-simple" aria-hidden="true"></i> Обзор</button>
            <button type="button" data-owner-view="products"><i class="fas fa-box-open" aria-hidden="true"></i> Товары</button>
            <button type="button" data-owner-view="orders"><i class="fas fa-receipt" aria-hidden="true"></i> Заказы</button>
            <button type="button" data-owner-view="messages"><i class="fas fa-comments" aria-hidden="true"></i> Сообщения</button>
          </nav>

          <div class="owner-admin-main">
            <section class="owner-admin-view" id="owner-view-overview" aria-labelledby="owner-overview-heading">
              <div class="owner-admin-section-heading">
                <div><h2 id="owner-overview-heading">Сводка магазина</h2><p>Показатели сформированы по данным каталога и заказов.</p></div>
              </div>
              <div class="owner-admin-stats" aria-live="polite">
                <article class="owner-admin-stat"><span class="owner-admin-stat-label">Всего товаров</span><strong class="owner-admin-stat-value" id="owner-stat-products">—</strong><small class="owner-admin-stat-note" id="owner-stat-products-note">Загрузка данных</small></article>
                <article class="owner-admin-stat"><span class="owner-admin-stat-label">Заявки и заказы</span><strong class="owner-admin-stat-value" id="owner-stat-orders">—</strong><small class="owner-admin-stat-note" id="owner-stat-orders-note">Загрузка данных</small></article>
                <article class="owner-admin-stat"><span class="owner-admin-stat-label">Ожидают обработки</span><strong class="owner-admin-stat-value" id="owner-stat-new-orders">—</strong><small class="owner-admin-stat-note">Заявки и новые заказы</small></article>
                <article class="owner-admin-stat"><span class="owner-admin-stat-label">Сумма заказов</span><strong class="owner-admin-stat-value" id="owner-stat-revenue">—</strong><small class="owner-admin-stat-note">Без заявок на приобретение</small></article>
              </div>

              <div class="owner-admin-panels">
                <section class="owner-admin-panel">
                  <div class="owner-admin-panel-heading"><h3>Последние заявки и заказы</h3><button type="button" class="owner-admin-link" data-owner-go="orders">Все заявки</button></div>
                  <div class="owner-admin-list" id="owner-recent-orders"></div>
                </section>
                <section class="owner-admin-panel">
                  <div class="owner-admin-panel-heading"><h3>Недавно добавленные товары</h3><button type="button" class="owner-admin-link" data-owner-go="products">Все товары</button></div>
                  <div class="owner-admin-list" id="owner-recent-products"></div>
                </section>
                <section class="owner-admin-panel owner-admin-panel--wide">
                  <div class="owner-admin-panel-heading"><h3>Уведомления</h3></div>
                  <div class="owner-admin-notice-list" id="owner-notifications"></div>
                </section>
                <section class="owner-admin-panel owner-admin-panel--wide">
                  <div class="owner-admin-panel-heading"><h3>Другие возможности</h3></div>
                  <div class="owner-admin-integrations">
                    <article class="owner-admin-integration">
                      <h3>Переписки</h3>
                      <p>Открывайте диалоги с покупателями в существующем защищённом чате. Счётчик непрочитанных сообщений в панели не предусмотрен.</p>
                      <button type="button" class="owner-admin-button" data-owner-go="messages">Открыть сообщения</button>
                    </article>
                    <article class="owner-admin-integration">
                      <h3>Пользователи</h3>
                      <p>Список аккаунтов и управление пользователями недоступны через текущие административные функции. Роли и доступы здесь не изменяются.</p>
                    </article>
                  </div>
                </section>
              </div>
            </section>

            <section class="owner-admin-view" id="owner-view-products" aria-labelledby="owner-products-heading" hidden>
              <div class="owner-admin-section-heading">
                <div><h2 id="owner-products-heading">Товары</h2><p>Ищите, фильтруйте и редактируйте объявления каталога.</p></div>
              </div>
              <div class="owner-admin-toolbar">
                <div class="owner-admin-filters">
                  <label class="owner-admin-field" for="owner-product-search">Поиск товара
                    <input id="owner-product-search" type="search" placeholder="Название, категория или цена">
                  </label>
                  <label class="owner-admin-field" for="owner-category-filter">Категория
                    <select id="owner-category-filter"><option value="all">Все категории</option></select>
                  </label>
                  <label class="owner-admin-field" for="owner-availability-filter">Наличие
                    <select id="owner-availability-filter"><option value="all">Все товары</option><option value="available">В наличии</option><option value="unavailable">Нет в наличии</option></select>
                  </label>
                </div>
                <button type="button" class="owner-admin-button owner-admin-button--primary" id="owner-add-product" aria-expanded="false" aria-controls="owner-form-panel"><i class="fas fa-plus" aria-hidden="true"></i> Добавить товар</button>
              </div>
              <div class="owner-admin-toolbar">
                <label class="owner-admin-field" for="owner-product-sort">Сортировка
                  <select id="owner-product-sort"><option value="newest">Сначала новые</option><option value="name">По названию</option><option value="price-up">Цена: по возрастанию</option><option value="price-down">Цена: по убыванию</option></select>
                </label>
                <p class="owner-admin-count" id="owner-product-count" aria-live="polite"></p>
              </div>

              <section class="owner-product-form" id="owner-form-panel" aria-labelledby="owner-form-title" hidden>
                <div class="owner-product-form-header">
                  <div><h3 id="owner-form-title">Добавить товар</h3><p class="owner-admin-description">Заполните данные предмета. Обязательные поля отмечены звёздочкой.</p></div>
                  <button type="button" class="owner-admin-button owner-admin-button--compact" id="owner-cancel">Закрыть</button>
                </div>
                <form id="owner-form">
                  <input id="owner-id" type="hidden">
                  <div class="owner-product-form-grid">
                    <label class="owner-admin-field" for="owner-name">Название *
                      <input id="owner-name" required maxlength="180">
                    </label>
                    <label class="owner-admin-field" for="owner-price">Цена *
                      <input id="owner-price" required inputmode="decimal" placeholder="1 500 ₽">
                    </label>
                    <label class="owner-admin-field" for="owner-category">Категория
                      <input id="owner-category" value="Разное">
                    </label>
                    <label class="owner-admin-field" for="owner-seller">Продавец
                      <input id="owner-seller" value="Старинная Коллекция">
                    </label>
                    <label class="owner-admin-field" for="owner-available">Доступность товара
                      <select id="owner-available" name="available">
                        <option value="true">В наличии</option>
                        <option value="false">Нет в наличии</option>
                      </select>
                    </label>
                    <label class="owner-admin-field" for="owner-year">Год / период
                      <input id="owner-year">
                    </label>
                    <label class="owner-admin-field owner-admin-field--wide" for="owner-description">Описание
                      <textarea id="owner-description" rows="4"></textarea>
                    </label>
                    <label class="owner-admin-field" for="owner-link">Ссылка на объявление (необязательно)
                      <input id="owner-link" type="url" placeholder="https://…">
                    </label>
                    <label class="owner-admin-field" for="owner-photos">Фотографии
                      <input id="owner-photos" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple>
                      <small class="owner-photo-note">Можно выбрать несколько фотографий. До 8 МБ каждая.</small>
                    </label>
                    <div class="owner-admin-field owner-admin-field--wide">
                      <span class="owner-admin-field">Предпросмотр фотографий</span>
                      <div id="owner-photo-preview" class="owner-photo-preview" aria-live="polite">Сохранённые и выбранные фотографии появятся здесь.</div>
                    </div>
                    <label class="owner-admin-field owner-admin-field--wide" for="owner-bg-color">Фон для обработки фотографии
                      <select id="owner-bg-color">
                        <option value="#ffffff">Белый</option><option value="#f1e6d2">Тёплый бежевый</option><option value="#e5e5e2">Светло-серый</option><option value="#d2c2a4">Песочный</option><option value="#30312f">Тёмный графит</option><option value="#f7f0df">Слоновая кость</option>
                      </select>
                      <small class="owner-photo-note">Необязательная обработка фона загружает модель ИИ и может занять время.</small>
                    </label>
                    <div class="owner-admin-field owner-admin-field--wide">
                      <div class="owner-photo-actions">
                        <button class="owner-admin-button owner-admin-button--compact" id="owner-remove-bg" type="button">Заменить фон выбранных фото</button>
                        <button class="owner-admin-button owner-admin-button--compact" id="owner-reset-bg" type="button">Сбросить обработку</button>
                      </div>
                      <p id="owner-photo-status" class="owner-photo-status" role="status" aria-live="polite"></p>
                    </div>
                  </div>
                  <div class="owner-product-form-actions">
                    <button class="owner-admin-button owner-admin-button--primary" id="owner-save-product" type="submit">Сохранить товар</button>
                    <button class="owner-admin-button" id="owner-cancel-edit" type="button" hidden>Отменить редактирование</button>
                  </div>
                </form>
              </section>
              <div id="owner-products"></div>
            </section>

            <section class="owner-admin-view" id="owner-view-orders" aria-labelledby="owner-orders-heading" hidden>
              <div class="owner-admin-section-heading"><div><h2 id="owner-orders-heading">Заявки и заказы</h2><p>Откройте состав заявки или заказа и продолжите общение с покупателем в чате.</p></div></div>
              <div class="owner-admin-toolbar">
                <div class="owner-admin-filters">
                  <label class="owner-admin-field" for="owner-order-search">Поиск заказа
                    <input id="owner-order-search" type="search" placeholder="Номер, покупатель, телефон или товар">
                  </label>
                  <label class="owner-admin-field" for="owner-order-status-filter">Статус
                    <select id="owner-order-status-filter"><option value="all">Все статусы</option>${Object.entries(statusLabels).map(([value, label]) => `<option value="${value}">${label}</option>`).join('')}</select>
                  </label>
                </div>
                <p class="owner-admin-count" id="owner-order-count" aria-live="polite"></p>
              </div>
              <div id="owner-orders"></div>
            </section>

            <section class="owner-admin-view" id="owner-view-messages" aria-labelledby="owner-messages-heading" hidden>
              <div class="owner-admin-section-heading"><div><h2 id="owner-messages-heading">Сообщения</h2><p>Используйте существующий защищённый чат магазина.</p></div></div>
              <article class="owner-admin-integration">
                <h3>Диалоги с покупателями</h3>
                <p>Список переписок, вложения и отправка сообщений открываются в текущем чате. Новая система сообщений не создаётся.</p>
                <p>Счётчик непрочитанных сообщений в доступном интерфейсе не предусмотрен.</p>
                <button type="button" class="owner-admin-button owner-admin-button--primary" id="owner-open-chat-view"><i class="fas fa-comments" aria-hidden="true"></i> Открыть диалоги</button>
              </article>
            </section>
          </div>
        </div>
      </div>`;

    const formPanel = $('owner-form-panel');
    productFormHome = { parent: formPanel.parentElement, next: formPanel.nextSibling };
    productDialog = document.createElement('dialog');
    productDialog.id = 'owner-product-dialog';
    productDialog.className = 'owner-product-dialog';
    productDialog.setAttribute('aria-labelledby', 'owner-form-title');
    productDialog.innerHTML = `
      <div class="owner-product-dialog-content">
        <div id="owner-product-dialog-form-slot"></div>
      </div>`;
    document.body.appendChild(productDialog);
    productDialog.addEventListener('cancel', event => {
      if (productSaveInProgress || ($('owner-id').value && !window.confirm('Закрыть редактор? Несохранённые изменения будут потеряны.'))) {
        event.preventDefault();
      }
    });
    productDialog.addEventListener('click', event => {
      if (event.target === productDialog && !productSaveInProgress &&
          (!$('owner-id').value || window.confirm('Закрыть редактор? Несохранённые изменения будут потеряны.'))) {
        productDialog.close();
      }
    });
    productDialog.addEventListener('close', () => {
      if ($('owner-id').value) resetForm();
      restoreProductForm();
      if (lastProductEditorTrigger?.isConnected) lastProductEditorTrigger.focus();
      else document.querySelector('.product-admin-edit')?.focus();
      lastProductEditorTrigger = null;
    });

    $('owner-form').addEventListener('submit', saveProduct);
    $('owner-photos').addEventListener('change', event => {
      const files = [...event.target.files];
      const invalid = files.find(file => !productPhotoTypes.has(file.type) || file.size > 8 * 1024 * 1024);
      if (invalid) {
        selectedPhotoFiles = [];
        processedPhotoFiles = null;
        event.target.value = '';
        renderPhotoPreview();
        $('owner-photo-status').textContent = !productPhotoTypes.has(invalid.type)
          ? 'Поддерживаются только JPEG, PNG, WebP, GIF или AVIF.'
          : 'Размер каждой фотографии должен быть до 8 МБ.';
        return;
      }
      selectedPhotoFiles = files;
      processedPhotoFiles = null;
      renderPhotoPreview();
      $('owner-photo-status').textContent = '';
    });
    $('owner-photo-preview').addEventListener('click', handlePhotoPreviewClick);
    $('owner-remove-bg').addEventListener('click', removeBackgrounds);
    $('owner-reset-bg').addEventListener('click', () => {
      processedPhotoFiles = null;
      renderPhotoPreview();
      $('owner-photo-status').textContent = 'Обработка сброшена. Будут загружены исходные фотографии.';
    });
    $('owner-cancel').addEventListener('click', cancelProductForm);
    $('owner-cancel-edit').addEventListener('click', cancelProductForm);
    $('owner-add-product').addEventListener('click', () => {
      resetForm();
      setFormOpen(true);
    });
    $('owner-products').addEventListener('click', productAction);
    $('owner-orders').addEventListener('click', saveOrder);
    $('owner-refresh').addEventListener('click', () => load({ announce: true }));
    $('owner-open-chat').addEventListener('click', openMessages);
    $('owner-open-chat-view').addEventListener('click', openMessages);
    $('owner-admin').addEventListener('click', event => {
      const nav = event.target.closest('[data-owner-view]');
      if (nav) switchView(nav.dataset.ownerView);
      const go = event.target.closest('[data-owner-go]');
      if (go) switchView(go.dataset.ownerGo);
      const openOrder = event.target.closest('[data-open-order]');
      if (openOrder) focusOrder(openOrder.dataset.openOrder);
    });
    $('owner-product-search').addEventListener('input', renderProducts);
    $('owner-category-filter').addEventListener('change', renderProducts);
    $('owner-availability-filter').addEventListener('change', renderProducts);
    $('owner-product-sort').addEventListener('change', renderProducts);
    $('owner-order-search').addEventListener('input', renderOrders);
    $('owner-order-status-filter').addEventListener('change', renderOrders);
  }

  function switchView(name) {
    const titles = {
      overview: 'Обзор магазина',
      products: 'Управление товарами',
      orders: 'Управление заказами',
      messages: 'Сообщения магазина'
    };
    if (!Object.prototype.hasOwnProperty.call(titles, name)) return;
    document.querySelectorAll('#account-admin-tools [data-owner-view]').forEach(button => {
      if (button.dataset.ownerView === name) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    });
    document.querySelectorAll('#account-admin-tools .owner-admin-view').forEach(section => {
      section.hidden = section.id !== `owner-view-${name}`;
    });
    $('owner-page-title').textContent = titles[name];
  }

  function openMessages() {
    if (typeof window.openShopChat !== 'function') {
      notify('Чат недоступен. Обновите страницу и попробуйте ещё раз.');
      return;
    }
    window.openShopChat();
  }

  function setFormOpen(open) {
    $('owner-form-panel').hidden = !open;
    $('owner-add-product').setAttribute('aria-expanded', String(open));
    $('owner-add-product').innerHTML = open
      ? '<i class="fas fa-plus" aria-hidden="true"></i> Скрыть форму'
      : '<i class="fas fa-plus" aria-hidden="true"></i> Добавить товар';
    if (open) requestAnimationFrame(() => $('owner-name').focus());
  }

  function setMetric(id, value, noteId, note) {
    $(id).textContent = value;
    if (noteId) $(noteId).textContent = note;
  }

  function orderTotal(order) {
    const value = Number(order.total);
    return Number.isFinite(value) ? money(value) : '—';
  }

  function orderStatus(order) {
    if (order.request_number) return order.status === 'cancelled' ? 'Заявка отменена' : 'Новая заявка';
    return statusLabels[order.status] || (order.status ? `Статус: ${order.status}` : 'Статус не указан');
  }

  function renderDashboard() {
    setMetric('owner-stat-products', productError ? '—' : products.length, 'owner-stat-products-note',
      productError ? 'Не удалось загрузить каталог' : `${products.filter(product => product.available !== false).length} доступно для покупки`);
    setMetric('owner-stat-orders', orderError ? '—' : orders.length, 'owner-stat-orders-note',
      orderError ? 'Не удалось загрузить заказы' : 'Все загруженные заказы');
    const newOrders = orders.filter(order => Boolean(order.request_number) || order.status === 'ordered').length;
    setMetric('owner-stat-new-orders', orderError ? '—' : newOrders, null, '');
    const total = orders.filter(order => !order.request_number)
      .reduce((sum, order) => sum + (Number.isFinite(Number(order.total)) ? Number(order.total) : 0), 0);
    setMetric('owner-stat-revenue', orderError ? '—' : money(total), null, '');

    const recentOrders = $('owner-recent-orders');
    recentOrders.innerHTML = orderError
      ? `<p class="owner-admin-load-error">${esc(orderError)}</p>`
      : orders.slice(0, 5).map(order => `
        <div class="owner-admin-list-row">
          <div><strong>${order.request_number ? `Заявка №${esc(order.request_number)}` : `Заказ №${esc(order.id)}`}</strong><small>${esc(order.customer?.name || 'Покупатель')} · ${esc(dateText(order.created_at))}</small></div>
          <button type="button" class="owner-admin-link" data-open-order="${esc(order.id)}">${esc(orderTotal(order))}</button>
        </div>`).join('') || '<p class="owner-admin-empty">Заказов пока нет.</p>';

    const recentProducts = $('owner-recent-products');
    recentProducts.innerHTML = productError
      ? `<p class="owner-admin-load-error">${esc(productError)}</p>`
      : products.slice(0, 5).map(product => `
        <div class="owner-admin-list-row">
          <div><strong>${esc(product.name || 'Без названия')}</strong><small>${esc(product.price || 'Цена не указана')} · ${esc(product.category || 'Без категории')}</small></div>
          <span class="owner-admin-badge ${product.available === false ? 'is-unavailable' : 'is-available'}">${product.available === false ? 'Нет в наличии' : 'В наличии'}</span>
        </div>`).join('') || '<p class="owner-admin-empty">Товаров пока нет.</p>';

    const notices = $('owner-notifications');
    if (orderError || productError) {
      notices.innerHTML = `<p class="owner-admin-load-error">Часть данных не загружена. Проверьте разделы товаров и заказов или попробуйте обновить данные.</p>`;
      return;
    }
    const pending = orders.filter(order => Boolean(order.request_number) || order.status === 'ordered');
    notices.innerHTML = pending.length
      ? pending.slice(0, 6).map(order => `
        <div class="owner-admin-notice"><i class="fas fa-circle-exclamation" aria-hidden="true"></i><span><button type="button" class="owner-admin-link" data-open-order="${esc(order.id)}">${order.request_number ? `Заявка №${esc(order.request_number)}` : `Заказ №${esc(order.id)}`}</button> ожидает обработки · ${esc(order.customer?.name || 'Покупатель')}</span></div>`).join('')
      : '<p class="owner-admin-empty">Новых уведомлений нет.</p>';
  }

  function renderProducts() {
    const list = $('owner-products');
    const count = $('owner-product-count');
    const categorySelect = $('owner-category-filter');
    if (!list || !count || !categorySelect) return;
    if (productError) {
      count.textContent = 'Список товаров недоступен.';
      list.innerHTML = `<p class="owner-admin-load-error">${esc(productError)}</p>`;
      renderDashboard();
      return;
    }

    const selectedCategory = categorySelect.value || 'all';
    const categories = [...new Set(products.map(product => String(product.category || '').trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'ru'));
    categorySelect.innerHTML = '<option value="all">Все категории</option>' +
      categories.map(category => `<option value="${esc(category)}">${esc(category)}</option>`).join('');
    categorySelect.value = categories.includes(selectedCategory) ? selectedCategory : 'all';

    const query = $('owner-product-search').value.trim().toLocaleLowerCase('ru');
    const availability = $('owner-availability-filter').value;
    const sort = $('owner-product-sort').value;
    const filtered = products.filter(product => {
      const matchesQuery = [product.name, product.category, product.price, product.year]
        .some(value => String(value || '').toLocaleLowerCase('ru').includes(query));
      const matchesCategory = categorySelect.value === 'all' || String(product.category || '') === categorySelect.value;
      const matchesAvailability = availability === 'all' ||
        (availability === 'available' ? product.available !== false : product.available === false);
      return matchesQuery && matchesCategory && matchesAvailability;
    });
    if (sort === 'name') filtered.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ru'));
    else if (sort === 'price-up') filtered.sort((a, b) => comparePrices(a, b, false));
    else if (sort === 'price-down') filtered.sort((a, b) => comparePrices(a, b, true));
    else filtered.sort((a, b) => Number(b.id) - Number(a.id));

    count.textContent = `Показано ${filtered.length} из ${products.length} товаров`;
    list.className = 'owner-product-list';
    list.innerHTML = filtered.map(product => {
      const image = productPhoto(product);
      const statusLabel = product.available === false ? 'Нет в наличии' : 'В наличии';
      const status = `<span class="owner-admin-badge ${product.available === false ? 'is-unavailable' : 'is-available'}">${esc(statusLabel)}</span>`;
      return `<article class="owner-product-row">
        <span class="owner-product-image">${image ? `<img src="${esc(image)}" alt="" loading="lazy">` : '<i class="fas fa-image" aria-hidden="true"></i>'}</span>
        <div class="owner-product-copy">
          <strong>${esc(product.name || 'Без названия')}</strong>
          <div class="owner-product-meta">${esc(product.price || 'Цена не указана')} · ${esc(product.category || 'Без категории')}${product.year ? ` · ${esc(product.year)}` : ''}</div>
          <div class="owner-product-meta">${status}</div>
        </div>
        <div class="owner-product-actions">
          <a class="owner-admin-button owner-admin-button--compact" href="#product-${encodeURIComponent(product.id)}">Просмотр</a>
          <button type="button" class="owner-admin-button owner-admin-button--compact" data-edit-product="${esc(product.id)}">Изменить</button>
          <button type="button" class="owner-admin-button owner-admin-button--compact owner-admin-button--danger" data-delete-product="${esc(product.id)}">Удалить</button>
        </div>
      </article>`;
    }).join('') || `<div class="owner-admin-empty">${products.length ? 'По заданным условиям товары не найдены.' : 'Товаров пока нет.'}</div>`;
    renderDashboard();
  }

  function orderMatchesSearch(order, query) {
    if (String(order.request_number || '').toLocaleLowerCase('ru').includes(query)) return true;
    const itemNames = Array.isArray(order.items) ? order.items.map(item => item.name || '').join(' ') : '';
    const customer = order.customer || {};
    return [order.id, customer.name, customer.phone, customer.email, itemNames]
      .some(value => String(value || '').toLocaleLowerCase('ru').includes(query));
  }

  function renderOrders() {
    const list = $('owner-orders');
    const count = $('owner-order-count');
    if (!list || !count) return;
    if (orderError) {
      count.textContent = 'Список заказов недоступен.';
      list.innerHTML = `<p class="owner-admin-load-error">${esc(orderError)}</p>`;
      renderDashboard();
      return;
    }

    const query = $('owner-order-search').value.trim().toLocaleLowerCase('ru');
    const statusFilter = $('owner-order-status-filter').value;
    const filtered = orders.filter(order => orderMatchesSearch(order, query) &&
      (statusFilter === 'all' || order.status === statusFilter));
    count.textContent = `Показано ${filtered.length} из ${orders.length} заявок и заказов`;
    list.className = 'owner-order-list';
    list.innerHTML = filtered.map(order => {
      const customer = order.customer || {};
      const address = order.address || {};
      const delivery = order.delivery || {};
      const isPurchaseRequest = Boolean(order.request_number);
      const itemRows = (Array.isArray(order.items) ? order.items : []).map(item => {
        const image = productPhoto(item);
        const quantity = Number.isSafeInteger(Number(item.quantity)) && Number(item.quantity) > 0
          ? Number(item.quantity) : 1;
        const unitAmount = Number(item.unit_price);
        const lineAmount = Number(item.line_total);
        const unitPrice = Number.isFinite(unitAmount) && unitAmount > 0 ? money(unitAmount) : String(item.price || 'Цена не указана');
        const lineTotal = Number.isFinite(lineAmount) && lineAmount > 0 ? money(lineAmount) : unitPrice;
        return `<li class="owner-order-item">
          ${image ? `<img src="${esc(image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : '<span class="owner-order-item-placeholder" aria-hidden="true"><i class="fas fa-image"></i></span>'}
          <span class="owner-order-item-copy"><strong>${esc(item.name || 'Товар')}</strong><small>${quantity} шт. · ${esc(unitPrice)}</small></span>
          <strong class="owner-order-item-total">${esc(lineTotal)}</strong>
        </li>`;
      }).join('') || '<li>Состав заказа не указан.</li>';
      const addressText = [address.region, address.city, address.street, address.house && `д. ${address.house}`,
        address.apartment && `кв. ${address.apartment}`, address.zip && `индекс ${address.zip}`].filter(Boolean).join(', ');
      const statusOptions = Object.entries(statusLabels).map(([value, label]) =>
        `<option value="${value}" ${order.status === value ? 'selected' : ''}>${label}</option>`).join('');
      const unknownStatus = order.status && !Object.prototype.hasOwnProperty.call(statusLabels, order.status)
        ? `<option value="${esc(order.status)}" selected>${esc(order.status)}</option>` : '';
      return `<details class="owner-order-card" data-order-id="${esc(order.id)}">
        <summary>
          <span class="owner-order-summary-main"><strong>${isPurchaseRequest ? `Заявка №${esc(order.request_number)}` : `Заказ №${esc(order.id)}`}</strong><small>${esc(customer.name || 'Покупатель')} · ${esc(dateText(order.created_at))}</small></span>
          <span class="owner-admin-badge status-${esc(order.status || 'unknown')}">${esc(orderStatus(order))}</span>
          <strong class="owner-order-total">${esc(orderTotal(order))}</strong>
          <i class="fas fa-chevron-down owner-order-chevron" aria-hidden="true"></i>
        </summary>
        <div class="owner-order-details">
          <div class="owner-order-facts">
            <div class="owner-order-fact"><dt>Покупатель</dt><dd>${esc(customer.name || 'Не указано')}${customer.phone ? `<br>${esc(customer.phone)}` : ''}${customer.email ? `<br>${esc(customer.email)}` : ''}</dd></div>
            ${isPurchaseRequest ? `<div class="owner-order-fact"><dt>Тип</dt><dd>Заявка на приобретение, не подтверждённая покупка</dd></div>` : `<div class="owner-order-fact"><dt>Доставка</dt><dd>${esc(delivery.company || 'Не указана')}${delivery.price != null ? ` · ${esc(money(delivery.price))}` : ''}</dd></div>
            ${addressText ? `<div class="owner-order-fact"><dt>Адрес</dt><dd>${esc(addressText)}${address.pickup ? `<br>Пункт выдачи: ${esc(address.pickup)}` : ''}</dd></div>` : ''}`}
            ${order.tracking_number ? `<div class="owner-order-fact"><dt>Трек-номер</dt><dd>${esc(order.tracking_number)}</dd></div>` : ''}
            ${order.status_note ? `<div class="owner-order-fact"><dt>Комментарий к статусу</dt><dd>${esc(order.status_note)}</dd></div>` : ''}
          </div>
          <section class="owner-order-items"><h3>${isPurchaseRequest ? 'Состав заявки (снимок на момент оформления)' : 'Состав заказа'}</h3><ul>${itemRows}</ul></section>
          ${isPurchaseRequest ? `<div class="owner-order-request-actions">
            <strong>Итого по заявке: ${esc(orderTotal(order))}</strong>
            ${order.conversation_id ? `<button type="button" class="owner-admin-button owner-admin-button--primary" onclick="openShopChatConversation('${esc(order.conversation_id)}')">Обсудить заявку</button>` : ''}
          </div>` : `<div class="owner-order-edit">
            <h3>Обновить статус и доставку</h3>
            <p class="owner-order-cancel-note">Отменить заказ можно только до отправки.</p>
            <label class="owner-admin-field" for="owner-status-${esc(order.id)}">Статус
              <select id="owner-status-${esc(order.id)}" data-order-status="${esc(order.id)}">${unknownStatus}${statusOptions}</select>
            </label>
            <label class="owner-admin-field" for="owner-tracking-${esc(order.id)}">Трек-номер
              <input id="owner-tracking-${esc(order.id)}" data-tracking="${esc(order.id)}" value="${esc(order.tracking_number || '')}" placeholder="Номер отправления">
            </label>
            <label class="owner-admin-field" for="owner-note-${esc(order.id)}">Комментарий к статусу
              <input id="owner-note-${esc(order.id)}" data-note="${esc(order.id)}" value="${esc(order.status_note || '')}" placeholder="Необязательно">
            </label>
            <button type="button" class="owner-admin-button owner-admin-button--primary" data-save-order="${esc(order.id)}">Сохранить изменения</button>
          </div>`}
        </div>
      </details>`;
    }).join('') || `<div class="owner-admin-empty">${orders.length ? 'Заказы по заданным условиям не найдены.' : 'Заказов пока нет.'}</div>`;
    renderDashboard();
  }

  function renderPhotoPreview() {
    const root = $('owner-photo-preview');
    const input = $('owner-photos');
    if (!root || !input) return;
    previewObjectUrls.forEach(url => URL.revokeObjectURL(url));
    previewObjectUrls = [];
    const files = processedPhotoFiles || selectedPhotoFiles;
    if (!existingPhotoUrls.length && !files.length) {
      root.textContent = 'Сохранённые и выбранные фотографии появятся здесь.';
      return;
    }
    const existing = existingPhotoUrls.map((url, index) => {
      const safeUrl = safeHttpUrl(url);
      return `<div class="owner-photo-preview-item">
        ${safeUrl ? `<button type="button" data-view-photo="${esc(safeUrl)}" aria-label="Открыть сохранённое фото ${index + 1}"><img src="${esc(safeUrl)}" alt="Сохранённое фото ${index + 1}" loading="lazy"></button>` : '<span>Фото недоступно</span>'}
        <small>Сохранённое фото ${index + 1}${index === 0 ? ' · обложка' : ''}</small>
        <span class="owner-photo-preview-actions">
          <button type="button" data-move-existing="${index}:-1" aria-label="Переместить фото ${index + 1} выше" ${index === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" data-move-existing="${index}:1" aria-label="Переместить фото ${index + 1} ниже" ${index === existingPhotoUrls.length - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" data-remove-existing="${index}">Убрать</button>
        </span>
      </div>`;
    }).join('');
    const selected = files.map((file, index) => {
      const url = URL.createObjectURL(file);
      previewObjectUrls.push(url);
      return `<div class="owner-photo-preview-item"><img src="${url}" alt="Предпросмотр нового фото ${index + 1}"><small>${index === 0 && !existingPhotoUrls.length ? 'Обложка' : `Новое фото ${index + 1}`}</small><span class="owner-photo-preview-actions"><button type="button" data-move-new="${index}:-1" aria-label="Переместить новое фото ${index + 1} выше" ${index === 0 ? 'disabled' : ''}>↑</button><button type="button" data-move-new="${index}:1" aria-label="Переместить новое фото ${index + 1} ниже" ${index === files.length - 1 ? 'disabled' : ''}>↓</button><button type="button" data-remove-new="${index}">Убрать</button></span></div>`;
    }).join('');
    root.innerHTML = `<div>Сохранённых фото: ${existingPhotoUrls.length}. Новых выбрано: ${files.length}. Первое фото будет обложкой.</div><div class="owner-photo-preview-grid">${existing}${selected}</div>`;
  }

  function handlePhotoPreviewClick(event) {
    const moveNew = event.target.closest('[data-move-new]');
    if (moveNew) {
      const [index, direction] = moveNew.dataset.moveNew.split(':').map(Number);
      const files = processedPhotoFiles || selectedPhotoFiles;
      const target = index + direction;
      if (target >= 0 && target < files.length) {
        [files[index], files[target]] = [files[target], files[index]];
        if (processedPhotoFiles) [selectedPhotoFiles[index], selectedPhotoFiles[target]] = [selectedPhotoFiles[target], selectedPhotoFiles[index]];
        renderPhotoPreview();
      }
      return;
    }
    const removeNew = event.target.closest('[data-remove-new]');
    if (removeNew) {
      const files = processedPhotoFiles || selectedPhotoFiles;
      files.splice(Number(removeNew.dataset.removeNew), 1);
      if (processedPhotoFiles) selectedPhotoFiles.splice(Number(removeNew.dataset.removeNew), 1);
      if (!processedPhotoFiles && !selectedPhotoFiles.length) $('owner-photos').value = '';
      renderPhotoPreview();
      return;
    }
    const move = event.target.closest('[data-move-existing]');
    if (move) {
      const [index, direction] = move.dataset.moveExisting.split(':').map(Number);
      const target = index + direction;
      if (target >= 0 && target < existingPhotoUrls.length) {
        [existingPhotoUrls[index], existingPhotoUrls[target]] = [existingPhotoUrls[target], existingPhotoUrls[index]];
        renderPhotoPreview();
      }
      return;
    }
    const remove = event.target.closest('[data-remove-existing]');
    if (remove) {
      existingPhotoUrls.splice(Number(remove.dataset.removeExisting), 1);
      renderPhotoPreview();
      return;
    }
    const view = event.target.closest('[data-view-photo]');
    if (view) {
      const url = safeHttpUrl(view.dataset.viewPhoto);
      if (url) window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  function setEditingProduct(product) {
    resetForm();
    existingPhotoUrls = [...new Set([
      ...(Array.isArray(product.photos) ? product.photos : []),
      ...(product.image ? [product.image] : [])
    ].filter(Boolean))];
    $('owner-photos').value = '';
    $('owner-id').value = product.id;
    ['name', 'price', 'category', 'seller', 'year', 'description', 'link'].forEach(key => {
      $(`owner-${key}`).value = product[key] || '';
    });
    $('owner-photos').value = '';
    selectedPhotoFiles = [];
    $('owner-available').value = product.available === false ? 'false' : 'true';
    $('owner-form-title').textContent = `Редактировать: ${product.name || 'товар'}`;
    $('owner-cancel-edit').hidden = false;
    renderPhotoPreview();
    setFormOpen(true);
    if (!productDialog?.open) $('owner-form-panel').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetForm() {
    const form = $('owner-form');
    if (form) form.reset();
    previewObjectUrls.forEach(url => URL.revokeObjectURL(url));
    previewObjectUrls = [];
    processedPhotoFiles = null;
    selectedPhotoFiles = [];
    existingPhotoUrls = [];
    $('owner-id').value = '';
    $('owner-category').value = 'Разное';
    $('owner-seller').value = 'Старинная Коллекция';
    $('owner-available').value = 'true';
    $('owner-form-title').textContent = 'Добавить товар';
    $('owner-cancel-edit').hidden = true;
    $('owner-photo-status').textContent = '';
    renderPhotoPreview();
    setFormOpen(false);
  }

  function restoreProductForm() {
    const panel = $('owner-form-panel');
    const slot = $('owner-product-dialog-form-slot');
    if (!panel || !slot || panel.parentElement !== slot || !productFormHome?.parent) return;
    const before = productFormHome.next?.parentElement === productFormHome.parent ? productFormHome.next : null;
    productFormHome.parent.insertBefore(panel, before);
  }

  function cancelProductForm() {
    if (productDialog?.open) {
      if ($('owner-id').value && !window.confirm('Закрыть редактор? Несохранённые изменения будут потеряны.')) return;
      productDialog.close();
    } else {
      resetForm();
    }
  }

  async function openAdminProductEditor(id) {
    if (!window.sb || !productDialog) throw new Error('Редактор товара недоступен.');
    const { data, error: sessionError } = await window.sb.auth.getSession();
    if (sessionError) throw sessionError;
    const session = data?.session;
    if (!session) throw new Error('Войдите в аккаунт администратора.');
    const { data: profile, error: profileError } = await window.sb.from('profiles')
      .select('role').eq('id', session.user.id).maybeSingle();
    if (profileError) throw profileError;
    if (profile?.role !== 'admin') throw new Error('Редактирование доступно только администраторам.');
    const { data: product, error } = await window.sb.from('products')
      .select('*').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!product) throw new Error('Товар больше не доступен.');
    lastProductEditorTrigger = document.activeElement;
    $('owner-product-dialog-form-slot').appendChild($('owner-form-panel'));
    productDialog.showModal();
    setEditingProduct(product);
  }

  const productPhotoTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
  const backgroundRemovalModuleUrl = 'https://esm.sh/@imgly/background-removal@1.5.5/es2022/background-removal.bundle.mjs';
  const backgroundRemovalModuleIntegrity = 'sha384-nGIj7Z51Z7WllbbcrCdfyBtKl7OYS2piAmz/2z1ZKsxmdy3E110Juw4tXutCNqLe';
  const backgroundRemovalDataUrl = 'https://staticimgly.com/@imgly/background-removal-data/1.5.5/dist/';

  async function loadVerifiedBackgroundRemovalModule() {
    const expectedUrl = new URL(backgroundRemovalModuleUrl);
    const response = await fetch(backgroundRemovalModuleUrl, {
      cache: 'force-cache',
      credentials: 'omit',
      redirect: 'error',
      referrerPolicy: 'no-referrer'
    });
    if (!response.ok) throw new Error('Не удалось загрузить модуль обработки фотографий.');
    if (new URL(response.url).href !== expectedUrl.href) {
      throw new Error('Источник модуля обработки фотографий не прошёл проверку.');
    }

    const source = await response.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-384', source);
    const actualIntegrity = `sha384-${btoa(String.fromCharCode(...new Uint8Array(digest)))}`;
    if (actualIntegrity !== backgroundRemovalModuleIntegrity) {
      throw new Error('Модуль обработки фотографий не прошёл проверку целостности.');
    }

    const verifiedModuleUrl = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
    try {
      return await import(verifiedModuleUrl);
    } finally {
      URL.revokeObjectURL(verifiedModuleUrl);
    }
  }

  async function removeBackgrounds() {
    const files = [...selectedPhotoFiles];
    if (!files.length) {
      $('owner-photo-status').textContent = 'Сначала выберите фотографии.';
      return;
    }
    const button = $('owner-remove-bg');
    button.disabled = true;
    $('owner-photo-status').textContent = 'Загружаю модель обработки фона. Первый запуск может занять время.';
    try {
      const module = await loadVerifiedBackgroundRemovalModule();
      const removeBackground = module.default || module.removeBackground;
      if (typeof removeBackground !== 'function') throw new Error('Не удалось загрузить модуль обработки фотографий.');
      const output = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        $('owner-photo-status').textContent = `Обрабатываю фотографию ${index + 1} из ${files.length}…`;
        const transparent = await removeBackground(file, {
          model: 'isnet_quint8',
          output: { format: 'image/png', quality: 1, type: 'foreground' },
          publicPath: backgroundRemovalDataUrl
        });
        const bitmap = await createImageBitmap(transparent);
        const canvas = document.createElement('canvas');
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const context = canvas.getContext('2d');
        const background = $('owner-bg-color').value;
        context.fillStyle = background;
        context.fillRect(0, 0, canvas.width, canvas.height);
        context.save();
        context.shadowColor = 'rgba(25,20,12,0.2)';
        context.shadowBlur = Math.max(8, canvas.width * .018);
        context.shadowOffsetY = Math.max(4, canvas.height * .012);
        context.drawImage(bitmap, 0, 0);
        context.restore();
        bitmap.close?.();
        const blob = await new Promise((resolve, reject) => canvas.toBlob(
          result => result ? resolve(result) : reject(new Error('Не удалось создать PNG.')),
          'image/png'
        ));
        const name = `${file.name.replace(/\.[^.]+$/, '') || `photo-${index + 1}`}-${backgroundNames[background] || 'custom-bg'}.png`;
        output.push(new File([blob], name, { type: 'image/png', lastModified: Date.now() }));
      }
      processedPhotoFiles = output;
      renderPhotoPreview();
      $('owner-photo-status').textContent = 'Фон обработан. Проверьте результат и сохраните товар, чтобы загрузить фотографии.';
      notify('Фотографии обработаны. Данные будут загружены только после сохранения товара.', 'success');
    } catch (error) {
      console.error('Не удалось обработать фотографии товара:', error);
      $('owner-photo-status').textContent = `Не удалось обработать фотографии: ${error?.message || error}. Исходные файлы не изменены.`;
      notify('Обработка фотографий не удалась. Исходные изображения сохранены.');
    } finally {
      button.disabled = false;
    }
  }

  async function uploadPhotos(files) {
    const urls = [];
    for (const file of files) {
      if (!productPhotoTypes.has(file.type)) throw new Error('Можно загружать только JPEG, PNG, WebP, GIF или AVIF.');
      if (file.size > 8 * 1024 * 1024) throw new Error('Размер каждой фотографии должен быть до 8 МБ.');
      const path = `${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
      const { error } = await window.sb.storage.from('product-photos').upload(path, file, {
        upsert: false,
        contentType: file.type
      });
      if (error) throw error;
      const { data } = window.sb.storage.from('product-photos').getPublicUrl(path);
      urls.push(data.publicUrl);
    }
    return urls;
  }

  async function saveProduct(event) {
    event.preventDefault();
    if (productSaveInProgress) return;
    productSaveInProgress = true;
    const submit = $('owner-save-product');
    submit.disabled = true;
    submit.textContent = 'Сохраняю…';
    notify('');
    let reloadRequested = false;
    try {
      const id = $('owner-id').value;
      const files = processedPhotoFiles || selectedPhotoFiles;
      const uploaded = files.length ? await uploadPhotos(files) : [];
      const photos = [...existingPhotoUrls, ...uploaded];
      const value = {
        name: $('owner-name').value.trim(),
        price: $('owner-price').value.trim(),
        category: $('owner-category').value.trim() || 'Разное',
        year: $('owner-year').value.trim(),
        description: $('owner-description').value.trim(),
        link: $('owner-link').value.trim(),
        seller: $('owner-seller').value.trim() || 'Старинная Коллекция',
        available: $('owner-available').value === 'true',
        photos,
        image: photos[0] || '',
        updated_at: new Date().toISOString()
      };
      const result = id
        ? await window.sb.from('products').update(value).eq('id', id).select('id').maybeSingle()
        : await window.sb.from('products').insert({
          ...value,
          avito_id: `manual-${crypto.randomUUID()}`
        }).select('id').maybeSingle();
      if (result.error || (Number.isFinite(result.status) && result.status >= 400)) {
        console.error('Supabase отклонил сохранение товара:', {
          error: result.error,
          data: result.data,
          status: result.status
        });
        throw result.error || new Error(`Supabase вернул HTTP ${result.status}`);
      }
      if (!result.data?.id) {
        console.error('Supabase не вернул подтверждённую запись товара:', {
          error: result.error,
          data: result.data,
          status: result.status
        });
        throw new Error('Товар не найден или сохранение не подтверждено сервером.');
      }
      if (productDialog?.open) productDialog.close();
      else {
        resetForm();
        restoreProductForm();
      }
      notify('Товар сохранён. Обновляю данные…', 'success');
      reloadRequested = true;
      try {
        window.location.reload();
      } catch (error) {
        reloadRequested = false;
        console.error('Товар сохранён, но страницу не удалось перезагрузить:', error);
        notify('Товар сохранён. Перезагрузите страницу, чтобы увидеть актуальные данные.', 'success');
      }
    } catch (error) {
      console.error('Не удалось сохранить товар:', error);
      notify(`Не удалось сохранить товар: ${error?.message || 'ошибка сервера'}`);
    } finally {
      if (!reloadRequested) {
        productSaveInProgress = false;
        submit.disabled = false;
        submit.textContent = 'Сохранить товар';
      }
    }
  }

  async function productAction(event) {
    const edit = event.target.closest('[data-edit-product]');
    const remove = event.target.closest('[data-delete-product]');
    if (edit) {
      const product = products.find(item => String(item.id) === edit.dataset.editProduct);
      if (product) setEditingProduct(product);
      return;
    }
    if (!remove) return;
    const target = remove;
    const product = products.find(item => String(item.id) === target.dataset.deleteProduct);
    if (!product) return;
    if (remove && !window.confirm(`Удалить товар «${product.name}»? Это действие нельзя отменить.`)) return;
    target.disabled = true;
    const originalText = target.textContent;
    target.textContent = 'Удаляю…';
    try {
      const result = await window.sb.from('products').delete().eq('id', product.id);
      if (result.error) throw result.error;
      const refreshed = await load({ quiet: true });
      await window.refreshRemoteCatalog?.();
      const action = 'Товар удалён.';
      notify(refreshed ? action : `${action} Список обновить не удалось. Проверьте раздел и нажмите «Обновить данные».`, refreshed ? 'success' : 'error');
    } catch (error) {
      console.error('Не удалось выполнить действие с товаром:', error);
      notify(`Не удалось выполнить действие: ${error?.message || 'ошибка сервера'}`);
    } finally {
      if (target.isConnected) {
        target.disabled = false;
        target.textContent = originalText;
      }
    }
  }

  async function saveOrder(event) {
    const button = event.target.closest('[data-save-order]');
    if (!button || button.disabled) return;
    const id = button.dataset.saveOrder;
    const card = button.closest('.owner-order-card');
    const status = card.querySelector('[data-order-status]').value;
    const tracking = card.querySelector('[data-tracking]').value.trim();
    const note = card.querySelector('[data-note]').value.trim();
    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = 'Сохраняю…';
    try {
      const { error } = await window.sb.rpc('update_shop_order_status', {
        p_order_id: Number(id),
        p_status: status,
        p_tracking_number: tracking,
        p_status_note: note
      });
      if (error) throw error;
      const refreshed = await load({ quiet: true });
      notify(refreshed ? 'Изменения заказа сохранены.' : 'Заказ сохранён, но список обновить не удалось. Проверьте раздел и нажмите «Обновить данные».', refreshed ? 'success' : 'error');
    } catch (error) {
      console.error('Не удалось обновить заказ:', error);
      notify(`Не удалось обновить заказ: ${error?.message || 'ошибка сервера'}`);
    } finally {
      if (button.isConnected) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  }

  function focusOrder(id) {
    switchView('orders');
    $('owner-order-search').value = '';
    $('owner-order-status-filter').value = 'all';
    renderOrders();
    const card = [...document.querySelectorAll('#owner-orders [data-order-id]')]
      .find(element => element.dataset.orderId === String(id));
    if (card) {
      card.open = true;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  async function load({ announce = false, quiet = false } = {}) {
    if (!window.sb) {
      notify('Подключение к данным магазина недоступно.');
      return false;
    }
    if (loadPromise) return loadPromise;
    const admin = $('owner-admin');
    if (admin) admin.setAttribute('aria-busy', 'true');
    if (!quiet) notify('Загружаю данные магазина…', 'success');
    loadPromise = (async () => {
      const [productResult, orderResult] = await Promise.allSettled([
        (async () => await window.sb.from('products')
          .select('id,name,price,category,year,description,link,seller,photos,image,available')
          .order('id', { ascending: false }))(),
        (async () => await window.sb.from('orders').select('*').order('created_at', { ascending: false }))()
      ]);
      productError = '';
      orderError = '';
      if (productResult.status === 'fulfilled') {
        if (productResult.value.error) productError = productResult.value.error.message || 'Не удалось загрузить каталог.';
        else products = productResult.value.data || [];
      } else {
        productError = productResult.reason?.message || 'Не удалось загрузить каталог.';
      }
      if (orderResult.status === 'fulfilled') {
        if (orderResult.value.error) orderError = orderResult.value.error.message || 'Не удалось загрузить заказы.';
        else orders = orderResult.value.data || [];
      } else {
        orderError = orderResult.reason?.message || 'Не удалось загрузить заказы.';
      }
      renderProducts();
      renderOrders();
      const failed = Boolean(productError || orderError);
      if (failed) {
        console.error('Ошибка загрузки административных данных:', { products: productError, orders: orderError });
        if (!quiet) notify('Не все данные удалось загрузить. Ошибки показаны в соответствующих разделах.');
      } else if (announce) {
        notify('Данные магазина обновлены.', 'success');
      } else if (!quiet) {
        notify('', 'success');
      }
      return !failed;
    })().finally(() => {
      if (admin) admin.setAttribute('aria-busy', 'false');
      loadPromise = null;
    });
    return loadPromise;
  }

  async function verifyAdmin() {
    const root = $('account-admin-tools');
    if (!root || !window.sb) return;
    try {
      const { data, error } = await window.sb.auth.getSession();
      if (error) throw error;
      const session = data?.session;
      if (!session) {
        if (productDialog?.open) productDialog.close();
        root.hidden = true;
        return;
      }
      const { data: profile, error: profileError } = await window.sb.from('profiles')
        .select('role').eq('id', session.user.id).maybeSingle();
      if (profileError) throw profileError;
      if (profile?.role !== 'admin') {
        if (productDialog?.open) productDialog.close();
        root.hidden = true;
        return;
      }
      root.hidden = false;
      await load();
    } catch (error) {
      if (productDialog?.open) productDialog.close();
      root.hidden = true;
      console.error('Не удалось проверить доступ к панели магазина:', error);
    }
  }

  window.openAdminProductEditor = openAdminProductEditor;

  document.addEventListener('DOMContentLoaded', () => {
    shell();
    verifyAdmin();
  });

  if (window.sb?.auth) {
    window.sb.auth.onAuthStateChange(() => {
      setTimeout(() => verifyAdmin(), 0);
    });
  }
})();
