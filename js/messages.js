(() => {
  const $ = id => document.getElementById(id);
  const allowedAttachmentTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
  if (!window.sb) return;

  let sessionUser = null;
  let isAdmin = false;
  let activeConversation = null;
  let activeProduct = null;
  let channel = null;
  let conversations = [];
  let inboxError = '';
  let archiveFeatureAvailable = false;
  let archiveNotice = '';
  let isSending = false;
  let messageRequestId = 0;
  let attachmentPreviewUrl = '';
  let lastChatTrigger = null;

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

  function validDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dateText(value) {
    const date = validDate(value);
    return date ? date.toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  }

  function dateShort(value) {
    const date = validDate(value);
    if (!date) return '';
    const today = new Date();
    return date.toDateString() === today.toDateString()
      ? date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
      : date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  }

  function dateKey(value) {
    const date = validDate(value);
    return date ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}` : '';
  }

  function dateHeading(value) {
    const date = validDate(value);
    if (!date) return 'Дата не указана';
    const today = new Date();
    const yesterday = new Date();
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return 'Сегодня';
    if (date.toDateString() === yesterday.toDateString()) return 'Вчера';
    return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });
  }

  function initials(value) {
    const parts = String(value || '').trim().split(/\s+/).filter(Boolean);
    return (parts.length > 1 ? parts[0][0] + parts[1][0] : (parts[0] || 'С')[0]).toLocaleUpperCase('ru');
  }

  function avatarMarkup(label, url = '') {
    const image = safeHttpUrl(url);
    return image
      ? `<span class="chat-avatar" aria-hidden="true"><img src="${esc(image)}" alt="" loading="lazy"></span>`
      : `<span class="chat-avatar" aria-hidden="true">${esc(initials(label))}</span>`;
  }

  function status(text, type = '') {
    const element = $('shop-chat-status');
    if (!element) return;
    element.textContent = text || '';
    element.classList.toggle('is-error', Boolean(text) && type === 'error');
    element.classList.toggle('is-success', Boolean(text) && type === 'success');
  }

  function listStatus(text, type = '') {
    const element = $('shop-chat-list-status');
    if (!element) return;
    element.textContent = text || '';
    element.hidden = !text;
    element.classList.toggle('is-error', Boolean(text) && type === 'error');
    element.classList.toggle('is-success', Boolean(text) && type === 'success');
  }

  function isArchiveTableMissing(error) {
    const message = String(error?.message || '').toLocaleLowerCase('en');
    return error?.code === '42P01' || error?.code === 'PGRST205' ||
      (message.includes('conversation_user_hides') &&
        (message.includes('schema cache') || message.includes('does not exist') || message.includes('not found')));
  }

  function updateArchiveNotice() {
    const notice = $('shop-chat-archive-notice');
    if (!notice) return;
    notice.textContent = archiveNotice;
    notice.hidden = !archiveNotice;
  }

  async function loadHiddenConversationIds() {
    const { data, error } = await sb.from('conversation_user_hides')
      .select('conversation_id')
      .eq('user_id', sessionUser.id);
    if (error) {
      if (isArchiveTableMissing(error)) {
        archiveFeatureAvailable = false;
        archiveNotice = 'Удаление чатов доступно после применения миграции chat-archive-migration.sql.';
        updateArchiveNotice();
        console.warn('Удаление чатов недоступно: отсутствует таблица conversation_user_hides.');
        return null;
      }
      throw error;
    }

    archiveFeatureAvailable = true;
    archiveNotice = '';
    updateArchiveNotice();
    return new Set((data || []).map(row => String(row.conversation_id)));
  }

  function stateMarkup(title, detail = '', retry = '') {
    return `<div class="chat-state"><strong>${esc(title)}</strong>${detail ? `<span>${esc(detail)}</span>` : ''}${retry ? `<br><button type="button" class="chat-retry" data-chat-retry="${esc(retry)}">Повторить</button>` : ''}</div>`;
  }

  const launch = document.createElement('button');
  launch.id = 'shop-chat-launch';
  launch.type = 'button';
  launch.setAttribute('aria-controls', 'shop-chat');
  launch.setAttribute('aria-expanded', 'false');
  launch.innerHTML = '<i class="fas fa-message" aria-hidden="true"></i><span>Сообщения</span>';

  const panel = document.createElement('section');
  panel.id = 'shop-chat';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'false');
  panel.setAttribute('aria-labelledby', 'shop-chat-title');
  panel.setAttribute('aria-hidden', 'true');
  panel.innerHTML = `
    <header class="chat-header">
      <div class="chat-header-copy">
        <span class="chat-header-kicker">Старинная Коллекция</span>
        <strong id="shop-chat-title">Сообщения</strong>
      </div>
      <button type="button" class="chat-close" id="shop-chat-close" aria-label="Закрыть сообщения" title="Закрыть">×</button>
    </header>
    <div id="shop-chat-layout" class="chat-layout">
      <aside class="chat-sidebar" aria-label="Диалоги">
        <div class="chat-sidebar-head">
          <div><h2>Диалоги</h2><p id="shop-chat-list-count">Ваши переписки</p></div>
          <button type="button" class="chat-refresh" id="shop-chat-refresh" aria-label="Обновить список диалогов" title="Обновить"><i class="fas fa-rotate" aria-hidden="true"></i></button>
        </div>
        <label class="chat-search-wrap">
          <i class="fas fa-magnifying-glass" aria-hidden="true"></i>
          <span class="sr-only">Поиск по диалогам</span>
          <input id="shop-chat-search" class="chat-search" type="search" autocomplete="off" placeholder="Поиск по диалогам" aria-controls="shop-chat-list">
        </label>
        <p id="shop-chat-archive-notice" class="chat-archive-notice" role="status" hidden></p>
        <p id="shop-chat-list-status" class="chat-list-status" role="status" aria-live="polite" hidden></p>
        <div id="shop-chat-list" class="chat-list" role="list" aria-label="Список диалогов" aria-live="polite">
          ${stateMarkup('Загрузка диалогов…')}
        </div>
      </aside>
      <section class="chat-main" aria-label="Открытая переписка">
        <div id="shop-chat-product" class="chat-thread-head">
          <div class="chat-state"><strong>Выберите диалог</strong><span>Переписка появится здесь.</span></div>
        </div>
        <div id="shop-chat-body" class="chat-body" role="log" aria-label="Сообщения переписки" aria-live="polite" aria-relevant="additions text">
          ${stateMarkup('Выберите диалог', 'Сообщения будут показаны здесь.')}
        </div>
        <p id="shop-chat-status" class="chat-status" role="status" aria-live="polite"></p>
        <form id="shop-chat-form" class="chat-compose" hidden>
          <div id="shop-chat-attachment-preview" class="chat-attachment-preview" hidden>
            <img id="shop-chat-attachment-image" alt="Предпросмотр прикреплённого изображения">
            <span id="shop-chat-attachment-name" class="chat-attachment-name"></span>
            <button type="button" id="shop-chat-attachment-remove" class="chat-attachment-remove" aria-label="Убрать вложение">×</button>
          </div>
          <div class="chat-compose-row">
            <input id="shop-chat-file" class="chat-file-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" aria-label="Выбрать изображение">
            <label class="chat-attach" for="shop-chat-file" title="Прикрепить изображение" aria-label="Прикрепить изображение"><i class="fas fa-paperclip" aria-hidden="true"></i></label>
            <textarea id="shop-chat-input" maxlength="4000" rows="1" aria-label="Текст сообщения" aria-describedby="shop-chat-input-help" placeholder="Напишите сообщение…"></textarea>
            <button type="submit" class="chat-send" id="shop-chat-send" aria-label="Отправить сообщение">
              <i class="fas fa-paper-plane" aria-hidden="true"></i><span class="chat-send-label">Отправить</span>
            </button>
          </div>
          <div id="shop-chat-input-help" class="chat-compose-help">Enter — отправить · Shift+Enter — новая строка · Изображение до 8 МБ</div>
        </form>
      </section>
    </div>`;
  document.body.append(launch, panel);

  function setPanelOpen(open) {
    panel.classList.toggle('open', open);
    panel.setAttribute('aria-hidden', String(!open));
    launch.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('shop-chat-open', open);
  }

  function showThreadView(show) {
    $('shop-chat-layout').classList.toggle('mobile-thread', Boolean(show));
  }

  function stopSubscription() {
    if (!channel) return;
    sb.removeChannel(channel);
    channel = null;
  }

  function closeThread() {
    const previousId = activeConversation?.id;
    activeConversation = null;
    activeProduct = null;
    messageRequestId += 1;
    stopSubscription();
    showThreadView(false);
    $('shop-chat-product').innerHTML = '<div class="chat-state"><strong>Выберите диалог</strong><span>Переписка появится здесь.</span></div>';
    $('shop-chat-body').innerHTML = stateMarkup('Выберите диалог', 'Сообщения будут показаны здесь.');
    $('shop-chat-body').removeAttribute('aria-busy');
    $('shop-chat-form').hidden = true;
    status('');
    renderInbox();
    requestAnimationFrame(() => {
      const previous = [...document.querySelectorAll('#shop-chat-list [data-conversation]')]
        .find(button => button.dataset.conversation === String(previousId));
      (previous || $('shop-chat-search'))?.focus();
    });
  }

  function closePanel() {
    closeThread();
    setPanelOpen(false);
    const focusTarget = lastChatTrigger?.isConnected ? lastChatTrigger : launch;
    lastChatTrigger = null;
    requestAnimationFrame(() => focusTarget?.focus());
  }

  function conversationTitle(conversation) {
    if (isAdmin) return conversation.customer_name || conversation.customer_email || 'Покупатель';
    return conversation.product_name || conversation.subject || 'Переписка';
  }

  function conversationSubtitle(conversation) {
    if (isAdmin) return [conversation.product_name, conversation.product_price].filter(Boolean).join(' · ') || 'Покупатель';
    return 'Старинная Коллекция';
  }

  function lastMessageText(message) {
    if (!message) return 'Сообщений пока нет.';
    if (message.attachment_path) return message.body && message.body !== '📷 Фото' ? `Фото · ${message.body}` : 'Фотография';
    return message.body || 'Сообщений пока нет.';
  }

  function renderInbox() {
    const list = $('shop-chat-list');
    const count = $('shop-chat-list-count');
    updateArchiveNotice();
    list.setAttribute('aria-busy', 'false');
    if (inboxError) {
      count.textContent = 'Не удалось загрузить переписки';
      list.innerHTML = stateMarkup('Список диалогов недоступен', inboxError, 'inbox');
      return;
    }
    const query = $('shop-chat-search').value.trim().toLocaleLowerCase('ru');
    const filtered = conversations.filter(conversation => {
      const message = conversation.lastMessage;
      return [
        conversationTitle(conversation),
        conversationSubtitle(conversation),
        lastMessageText(message)
      ].some(value => String(value || '').toLocaleLowerCase('ru').includes(query));
    });
    const lastDigit = conversations.length % 10;
    const lastTwoDigits = conversations.length % 100;
    const dialogWord = lastDigit === 1 && lastTwoDigits !== 11
      ? 'диалог' : lastDigit >= 2 && lastDigit <= 4 && (lastTwoDigits < 12 || lastTwoDigits > 14) ? 'диалога' : 'диалогов';
    count.textContent = conversations.length
      ? `${conversations.length} ${dialogWord}`
      : 'Ваши переписки';
    if (!conversations.length) {
      list.innerHTML = stateMarkup('Пока нет диалогов', isAdmin
        ? 'Новые обращения покупателей появятся здесь.'
        : 'Откройте товар и нажмите «Написать», чтобы начать переписку.');
      return;
    }
    if (!filtered.length) {
      list.innerHTML = stateMarkup('Ничего не найдено', 'Измените запрос поиска.');
      return;
    }
    list.innerHTML = filtered.map(conversation => {
      const title = conversationTitle(conversation);
      const subtitle = conversationSubtitle(conversation);
      const message = conversation.lastMessage;
      const timestamp = message?.created_at || conversation.last_message_at || conversation.created_at;
      const unread = Boolean(message && message.sender_id !== sessionUser?.id && !message.read_at);
      const avatar = isAdmin
        ? conversation.customer_avatar_url || conversation.avatar_url || ''
        : conversation.seller_avatar_url || '';
      const isActive = activeConversation?.id === conversation.id;
      const label = `${title}. ${subtitle}. ${lastMessageText(message)}${unread ? '. Есть непрочитанное сообщение' : ''}`;
      return `<div class="chat-conversation-row" role="listitem">
        <button type="button" class="chat-conversation" aria-current="${isActive}" aria-label="${esc(label)}" data-conversation="${esc(conversation.id)}">
          ${avatarMarkup(title, avatar)}
          <span class="chat-conversation-copy">
            <span class="chat-conversation-top"><strong>${esc(title)}</strong><time datetime="${esc(timestamp || '')}">${esc(dateShort(timestamp))}</time></span>
            <span class="chat-conversation-subtitle">${esc(subtitle)}</span>
            <span class="chat-conversation-preview">${esc(lastMessageText(message))}</span>
          </span>
          ${unread ? '<span class="chat-unread" aria-label="Непрочитанное сообщение"></span>' : '<span aria-hidden="true"></span>'}
        </button>
        ${archiveFeatureAvailable ? `<button type="button" class="chat-conversation-delete" data-delete-conversation="${esc(conversation.id)}" aria-label="Удалить диалог у себя: ${esc(title)}" title="Удалить у себя"><i class="fas fa-trash-can" aria-hidden="true"></i></button>` : ''}
      </div>`;
    }).join('');
  }

  async function getSession() {
    const { data, error } = await sb.auth.getSession();
    if (error) throw error;
    sessionUser = data?.session?.user || null;
    isAdmin = false;
    if (!sessionUser) return;
    const { data: profile, error: profileError } = await sb.from('profiles')
      .select('role').eq('id', sessionUser.id).maybeSingle();
    if (profileError) {
      console.warn('Не удалось определить роль для чата:', profileError.message);
    }
    isAdmin = profile?.role === 'admin';
    sessionUser.displayName = sessionUser.user_metadata?.display_name ||
      sessionUser.user_metadata?.full_name || sessionUser.email || 'Покупатель';
  }

  async function loadInbox({ showLoading = false } = {}) {
    if (!sessionUser) return;
    if (showLoading || !conversations.length) {
      $('shop-chat-list').innerHTML = stateMarkup('Загружаю диалоги…');
    }
    $('shop-chat-list').setAttribute('aria-busy', 'true');
    inboxError = '';
    try {
      const hiddenIds = await loadHiddenConversationIds();
      const query = sb.from('conversations').select('*').order('last_message_at', { ascending: false }).limit(100);
      const { data, error } = isAdmin ? await query : await query.eq('customer_id', sessionUser.id);
      if (error) throw error;
      const rows = (data || []).filter(conversation =>
        !hiddenIds || !hiddenIds.has(String(conversation.id))
      );
      conversations = await Promise.all(rows.map(async conversation => {
        const { data: messages, error: messageError } = await sb.from('messages')
          .select('body,created_at,sender_id,attachment_path,read_at')
          .eq('conversation_id', conversation.id)
          .order('created_at', { ascending: false })
          .limit(1);
        if (messageError) throw messageError;
        return { ...conversation, lastMessage: messages?.[0] || null };
      }));
      renderInbox();
    } catch (error) {
      inboxError = error?.message || 'Не удалось загрузить список диалогов.';
      conversations = [];
      console.error('Ошибка загрузки диалогов:', error);
      renderInbox();
    } finally {
      $('shop-chat-list').setAttribute('aria-busy', 'false');
    }
  }

  function setThreadHeader(conversation) {
    const title = conversationTitle(conversation);
    const subtitle = conversationSubtitle(conversation);
    const avatar = isAdmin
      ? conversation.customer_avatar_url || conversation.avatar_url || ''
      : conversation.seller_avatar_url || '';
    $('shop-chat-product').innerHTML = `
      <button type="button" class="chat-back" id="shop-chat-back" aria-label="Вернуться к диалогам" title="Все диалоги"><i class="fas fa-arrow-left" aria-hidden="true"></i></button>
      ${avatarMarkup(title, avatar)}
      <span class="chat-thread-head-copy"><strong>${esc(title)}</strong><small>${esc(subtitle)}</small></span>`;
    $('shop-chat-back').addEventListener('click', closeThread);
  }

  async function ensureConversation(product) {
    const productId = Number(product.id);
    if (!Number.isFinite(productId) || productId <= 0) throw new Error('Не удалось определить товар.');
    const productName = String(product.name || 'Товар');
    const productPrice = String(product.price || 'Цена не указана');
    const customerName = String(sessionUser.displayName || sessionUser.email || 'Покупатель');
    const { data: existing, error: findError } = await sb.from('conversations').select('*')
      .eq('customer_id', sessionUser.id).eq('product_id', productId)
      .order('created_at', { ascending: false }).limit(1);
    if (findError) throw findError;

    if (existing?.length) {
      activeConversation = existing[0];
      const update = await sb.from('conversations').update({
        product_name: productName,
        product_price: productPrice,
        customer_name: customerName,
        subject: `Вопрос о товаре: ${productName}`
      }).eq('id', activeConversation.id).select('*').maybeSingle();
      if (!update.error && update.data) activeConversation = update.data;
      else if (update.error) console.warn('Не удалось обновить сведения о товаре в диалоге:', update.error.message);
    } else {
      const { data, error } = await sb.from('conversations').insert({
        customer_id: sessionUser.id,
        product_id: productId,
        product_name: productName,
        product_price: productPrice,
        customer_name: customerName,
        subject: `Вопрос о товаре: ${productName}`
      }).select('*').single();
      if (error) throw error;
      activeConversation = data;
    }

    if (!archiveFeatureAvailable) await loadHiddenConversationIds();
    if (archiveFeatureAvailable) {
      const { error } = await sb.from('conversation_user_hides').delete()
        .eq('conversation_id', activeConversation.id)
        .eq('user_id', sessionUser.id);
      if (error) throw error;
    }
  }

  async function hideConversation(conversation, button) {
    if (!archiveFeatureAvailable || !sessionUser || !conversation) return;
    const title = conversationTitle(conversation);
    if (!window.confirm(`Удалить «${title}» из вашего списка? Переписка, вложения и данные товара останутся у собеседника.`)) return;

    const list = $('shop-chat-list');
    const previousIndex = [...list.querySelectorAll('[data-delete-conversation]')].indexOf(button);
    button.disabled = true;
    listStatus('Удаляю диалог…');
    try {
      const { error } = await sb.from('conversation_user_hides').insert({
        conversation_id: conversation.id,
        user_id: sessionUser.id
      });
      if (error && error.code !== '23505') throw error;

      const wasActive = String(activeConversation?.id) === String(conversation.id);
      conversations = conversations.filter(item => String(item.id) !== String(conversation.id));
      if (wasActive) closeThread();
      else renderInbox();
      listStatus('Диалог удалён из вашего списка. Сообщения и вложения сохранены.', 'success');
      if (!wasActive) {
        requestAnimationFrame(() => {
          const remaining = list.querySelectorAll('[data-conversation]');
          (remaining[Math.min(previousIndex, remaining.length - 1)] || $('shop-chat-search')).focus();
        });
      }
    } catch (error) {
      console.error('Не удалось удалить диалог из списка:', error);
      listStatus(`Не удалось удалить диалог: ${error?.message || 'ошибка сервера'}`, 'error');
      button.disabled = false;
    }
  }

  function purchaseRequestMarkup(request) {
    if (!request) return '';
    const items = Array.isArray(request.items) ? request.items : [];
    const money = value => {
      const amount = Number(value);
      return Number.isFinite(amount)
        ? new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(amount) + ' ₽'
        : 'Уточняется';
    };
    const itemMarkup = items.map(item => {
      const photos = Array.isArray(item.photos) ? item.photos : [];
      const image = safeHttpUrl(item.image || photos.find(value => typeof value === 'string') || '');
      const quantity = Number.isSafeInteger(Number(item.quantity)) && Number(item.quantity) > 0
        ? Number(item.quantity) : 1;
      const unitPrice = Number(item.unit_price) > 0 ? money(item.unit_price) : String(item.price || 'Цена не указана');
      return `<li class="chat-request-item">
        ${image ? `<img src="${esc(image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}
        <span><strong>${esc(item.name || 'Товар')}</strong><small>${quantity} шт. · ${esc(unitPrice)}</small></span>
        <strong>${money(item.line_total)}</strong>
      </li>`;
    }).join('');
    return `<section class="chat-request-card" aria-label="Заявка на покупку">
      <header><span>Заявка на покупку</span><strong>${esc(request.request_number || 'Без номера')}</strong></header>
      <ul>${itemMarkup || '<li>Состав заявки недоступен.</li>'}</ul>
      <footer><span>Итого</span><strong>${money(request.total)}</strong></footer>
    </section>`;
  }

  function messageMarkup(rows, signedUrls, currentConversation, purchaseRequests) {
    let previousDay = '';
    return rows.map((message, index) => {
      const key = dateKey(message.created_at);
      const divider = key !== previousDay
        ? `<div class="chat-day-divider">${esc(dateHeading(message.created_at))}</div>`
        : '';
      previousDay = key;
      const isPurchaseRequest = message.message_type === 'purchase_request';
      const own = !isPurchaseRequest && message.sender_id === sessionUser.id;
      const request = isPurchaseRequest ? purchaseRequests[String(message.purchase_request_id)] : null;
      const text = (!isPurchaseRequest || !request) && message.body && message.body !== '📷 Фото'
        ? `<p class="chat-msg-text">${esc(message.body)}</p>` : '';
      const requestCard = purchaseRequestMarkup(request);
      const signedUrl = safeHttpUrl(signedUrls[message.attachment_path] || '');
      let attachment = '';
      if (message.attachment_path && signedUrl) {
        attachment = `<a href="${esc(signedUrl)}" class="chat-msg-attachment-link" target="_blank" rel="noopener noreferrer" aria-label="Открыть прикреплённое изображение"><img class="chat-msg-image" src="${esc(signedUrl)}" alt="Изображение из переписки" loading="lazy"></a>`;
      } else if (message.attachment_path) {
        attachment = '<p class="chat-msg-text">Вложение временно недоступно.</p>';
      }
      const time = validDate(message.created_at);
      const timestamp = time ? time.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
      const sender = isPurchaseRequest ? 'Система · заявка' :
        own ? 'Вы' : (isAdmin ? currentConversation.customer_name || 'Покупатель' : 'Старинная Коллекция');
      return `${divider}<article class="chat-msg${own ? ' chat-msg--mine' : ''}${isPurchaseRequest ? ' chat-msg--request' : ''}${index === rows.length - 1 ? ' chat-msg--latest' : ''}">
        ${text}${requestCard}${attachment}
        <time class="chat-meta" datetime="${esc(message.created_at || '')}">${esc(sender)}${timestamp ? ` · ${esc(timestamp)}` : ''}</time>
      </article>`;
    }).join('');
  }

  async function loadMessages({ forceBottom = false } = {}) {
    if (!activeConversation || !sessionUser) return;
    const body = $('shop-chat-body');
    const conversation = activeConversation;
    const requestId = ++messageRequestId;
    const wasNearBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 120;
    body.setAttribute('aria-busy', 'true');
    body.innerHTML = stateMarkup('Загружаю сообщения…');
    try {
      const { data, error } = await sb.from('messages').select('*')
        .eq('conversation_id', conversation.id)
        .order('created_at', { ascending: true })
        .limit(500);
      if (error) throw error;
      if (requestId !== messageRequestId || activeConversation?.id !== conversation.id) return;
      const rows = data || [];
      const requestIds = [...new Set(rows
        .filter(message => message.message_type === 'purchase_request' && message.purchase_request_id)
        .map(message => String(message.purchase_request_id)))];
      let purchaseRequests = {};
      if (requestIds.length) {
        const { data: requestRows, error: requestError } = await sb.from('orders')
          .select('id,request_number,items,total,created_at')
          .in('id', requestIds);
        if (requestError) {
          console.warn('Не удалось загрузить снимок заявки для чата:', requestError.message);
        } else {
          purchaseRequests = Object.fromEntries((requestRows || []).map(request => [String(request.id), request]));
        }
      }
      const attachmentPaths = [...new Set(rows.map(message => message.attachment_path).filter(Boolean))];
      const signedUrls = {};
      for (const path of attachmentPaths) {
        try {
          const { data: signed, error: signedError } = await sb.storage.from('chat-attachments').createSignedUrl(path, 3600);
          if (signedError) console.warn('Не удалось получить ссылку на вложение:', signedError.message);
          if (signed?.signedUrl) signedUrls[path] = signed.signedUrl;
        } catch (error) {
          console.warn('Не удалось получить ссылку на вложение:', error?.message || error);
        }
      }
      if (requestId !== messageRequestId || activeConversation?.id !== conversation.id) return;
      body.innerHTML = rows.length
        ? messageMarkup(rows, signedUrls, conversation, purchaseRequests)
        : stateMarkup('Пока нет сообщений', 'Напишите первое сообщение или прикрепите изображение.');
      body.removeAttribute('aria-busy');
      if (forceBottom || wasNearBottom) {
        const behavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
        requestAnimationFrame(() => body.scrollTo({ top: body.scrollHeight, behavior }));
      }
      try {
        const { error: readError } = await sb.from('messages')
          .update({ read_at: new Date().toISOString() })
          .eq('conversation_id', conversation.id)
          .neq('sender_id', sessionUser.id)
          .is('read_at', null);
        if (readError) {
          console.warn('Не удалось обновить отметку о прочтении:', readError.message);
          status('Сообщения загружены, но отметку о прочтении обновить не удалось.', 'error');
        }
      } catch (readError) {
        console.warn('Не удалось обновить отметку о прочтении:', readError?.message || readError);
        status('Сообщения загружены, но отметку о прочтении обновить не удалось.', 'error');
      }
    } catch (error) {
      if (requestId !== messageRequestId || activeConversation?.id !== conversation.id) return;
      body.removeAttribute('aria-busy');
      body.innerHTML = stateMarkup('Не удалось загрузить сообщения', error?.message || 'Проверьте соединение и повторите попытку.', 'messages');
      console.error('Ошибка загрузки сообщений:', error);
    }
  }

  function subscribe() {
    stopSubscription();
    if (!activeConversation) return;
    const conversationId = activeConversation.id;
    channel = sb.channel(`chat-${conversationId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`
      }, async payload => {
        if (activeConversation?.id !== conversationId) return;
        const isNearBottom = $('shop-chat-body').scrollHeight - $('shop-chat-body').scrollTop - $('shop-chat-body').clientHeight < 120;
        await loadMessages({ forceBottom: isNearBottom });
        await loadInbox();
        if (payload.new.sender_id !== sessionUser?.id) notify(payload.new);
      }).subscribe();
  }

  async function selectConversation(conversation) {
    if (!conversation) return;
    activeConversation = conversation;
    activeProduct = null;
    showThreadView(true);
    setThreadHeader(conversation);
    $('shop-chat-form').hidden = false;
    status('');
    subscribe();
    await loadMessages({ forceBottom: true });
    await loadInbox();
    requestAnimationFrame(() => $('shop-chat-input').focus());
  }

  function clearAttachment(clearInput = true) {
    if (clearInput) $('shop-chat-file').value = '';
    $('shop-chat-attachment-preview').hidden = true;
    $('shop-chat-attachment-image').removeAttribute('src');
    $('shop-chat-attachment-name').textContent = '';
    if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
    attachmentPreviewUrl = '';
  }

  function previewAttachment(file) {
    clearAttachment(false);
    if (!file) return;
    if (!allowedAttachmentTypes.has(file.type)) {
      status('Можно прикрепить только JPEG, PNG, WebP, GIF или AVIF.', 'error');
      $('shop-chat-file').value = '';
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      status('Размер изображения должен быть до 8 МБ.', 'error');
      $('shop-chat-file').value = '';
      return;
    }
    attachmentPreviewUrl = URL.createObjectURL(file);
    $('shop-chat-attachment-image').src = attachmentPreviewUrl;
    $('shop-chat-attachment-name').textContent = file.name;
    $('shop-chat-attachment-preview').hidden = false;
    status('');
  }

  function resizeInput() {
    const input = $('shop-chat-input');
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 132)}px`;
  }

  async function openChat(product = null) {
    setPanelOpen(true);
    status('');
    if (product) activeProduct = product;
    try {
      await getSession();
    } catch (error) {
      status(`Не удалось проверить вход: ${error?.message || 'ошибка авторизации'}`, 'error');
      $('shop-chat-list').innerHTML = stateMarkup('Не удалось открыть сообщения', 'Повторите попытку позже.');
      return;
    }

    if (!sessionUser) {
      conversations = [];
      inboxError = '';
      $('shop-chat-form').hidden = true;
      $('shop-chat-product').innerHTML = '<div class="chat-state"><strong>Войдите, чтобы продолжить</strong><span>После входа вы сможете читать и отправлять сообщения.</span></div>';
      $('shop-chat-body').innerHTML = stateMarkup('Переписки доступны после входа');
      renderInbox();
      $('shop-chat-list').innerHTML = stateMarkup('Войдите в аккаунт', 'После входа здесь появятся ваши диалоги.');
      const authButton = $('auth-open');
      if (authButton) authButton.click();
      else status('Кнопка входа недоступна.', 'error');
      return;
    }

    $('shop-chat-form').hidden = true;
    if (activeProduct && !isAdmin) {
      try {
        await ensureConversation(activeProduct);
        setThreadHeader(activeConversation);
        $('shop-chat-form').hidden = false;
        showThreadView(true);
        subscribe();
        await loadMessages({ forceBottom: true });
        await loadInbox();
        requestAnimationFrame(() => $('shop-chat-input').focus());
      } catch (error) {
        $('shop-chat-body').innerHTML = stateMarkup('Не удалось открыть переписку', error?.message || 'Проверьте настройки сообщений и повторите попытку.');
        $('shop-chat-product').innerHTML = '<div class="chat-state"><strong>Переписка недоступна</strong><span>Не удалось открыть диалог для этого товара.</span></div>';
        status(`Ошибка создания переписки: ${error?.message || 'неизвестная ошибка'}`, 'error');
        console.error('Ошибка открытия диалога товара:', error);
      }
    } else {
      showThreadView(false);
      await loadInbox({ showLoading: true });
      $('shop-chat-product').innerHTML = '<div class="chat-state"><strong>Выберите диалог</strong><span>Переписка появится здесь.</span></div>';
      $('shop-chat-body').innerHTML = stateMarkup('Выберите диалог', 'Сообщения будут показаны здесь.');
      requestAnimationFrame(() => $('shop-chat-search').focus());
    }

    if ('Notification' in window && Notification.permission === 'default') {
      try {
        if (await Notification.requestPermission() === 'granted') await subscribePush();
      } catch (error) {
        console.warn('Не удалось включить уведомления:', error?.message || error);
      }
    } else if ('Notification' in window && Notification.permission === 'granted') {
      await subscribePush();
    }
  }

  async function sendMessage(event) {
    event.preventDefault();
    if (isSending) return;
    if (!sessionUser || !activeConversation) {
      status('Сначала войдите и выберите диалог.', 'error');
      return;
    }
    const input = $('shop-chat-input');
    const fileInput = $('shop-chat-file');
    const file = fileInput.files?.[0] || null;
    const body = input.value.trim();
    if (!body && !file) return;
    if (file && (!allowedAttachmentTypes.has(file.type) || file.size > 8 * 1024 * 1024)) {
      status('Выберите JPEG, PNG, WebP, GIF или AVIF размером до 8 МБ.', 'error');
      return;
    }

    const form = $('shop-chat-form');
    const button = $('shop-chat-send');
    const originalButton = button.innerHTML;
    isSending = true;
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-spinner fa-spin" aria-hidden="true"></i><span class="chat-send-label">Отправка…</span>';
    form.setAttribute('aria-busy', 'true');
    status('Отправляю сообщение…');
    try {
      let attachmentPath = null;
      if (file) {
        const extension = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8) || 'jpg';
        attachmentPath = `${sessionUser.id}/${activeConversation.id}/${Date.now()}-${crypto.randomUUID()}.${extension}`;
        const { error: uploadError } = await sb.storage.from('chat-attachments').upload(attachmentPath, file, {
          contentType: file.type,
          upsert: false
        });
        if (uploadError) throw new Error(`Не удалось загрузить изображение: ${uploadError.message}`);
      }

      const { data: inserted, error } = await sb.from('messages').insert({
        conversation_id: activeConversation.id,
        sender_id: sessionUser.id,
        body: body || '📷 Фото',
        attachment_path: attachmentPath,
        attachment_type: file?.type || null
      }).select('id').single();
      if (error) throw error;

      input.value = '';
      resizeInput();
      clearAttachment();
      const { error: conversationError } = await sb.from('conversations')
        .update({ last_message_at: new Date().toISOString() })
        .eq('id', activeConversation.id);
      if (conversationError) console.warn('Не удалось обновить время диалога:', conversationError.message);
      try {
        const { error: pushError } = await sb.functions.invoke('send-push', { body: { messageId: inserted.id } });
        if (pushError) console.warn('Не удалось отправить push-уведомление:', pushError.message);
      } catch (pushError) {
        console.warn('Не удалось вызвать push-уведомление:', pushError?.message || pushError);
      }
      await loadMessages({ forceBottom: true });
      await loadInbox();
      status(conversationError ? 'Сообщение отправлено. Список диалогов обновится при следующем обновлении.' : 'Сообщение отправлено.', conversationError ? 'error' : 'success');
    } catch (error) {
      console.error('Не удалось отправить сообщение:', error);
      status(`Не удалось отправить сообщение: ${error?.message || 'ошибка сервера'}`, 'error');
    } finally {
      isSending = false;
      button.disabled = false;
      button.innerHTML = originalButton;
      form.removeAttribute('aria-busy');
      input.focus();
    }
  }

  function subscribePush() {
    return (async () => {
      try {
        const key = window.PUSH_CONFIG?.vapidPublicKey;
        if (!key || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
        const registration = await navigator.serviceWorker.ready;
        let subscription = await registration.pushManager.getSubscription();
        if (!subscription) {
          subscription = await registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: base64ToBytes(key)
          });
        }
        const { error } = await sb.from('push_subscriptions').upsert({
          user_id: sessionUser.id,
          subscription: subscription.toJSON()
        }, { onConflict: 'user_id,subscription' });
        if (error) console.warn('Не удалось сохранить push-подписку:', error.message);
      } catch (error) {
        console.warn('Ошибка push-подписки:', error?.message || error);
      }
    })();
  }

  function base64ToBytes(value) {
    const padding = '='.repeat((4 - value.length % 4) % 4);
    const decoded = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
    return Uint8Array.from([...decoded].map(char => char.charCodeAt(0)));
  }

  function notify(message) {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    const notification = new Notification('Новое сообщение — Старинная Коллекция', {
      body: String(message.body || '📷 Фото').slice(0, 150),
      tag: `shop-message-${message.id}`
    });
    notification.onclick = async () => {
      window.focus();
      lastChatTrigger = launch;
      setPanelOpen(true);
      try {
        await getSession();
        await loadInbox({ showLoading: true });
        const conversation = conversations.find(item => String(item.id) === String(message.conversation_id));
        if (conversation) await selectConversation(conversation);
        else status('Переписка больше недоступна или список не обновился.', 'error');
      } catch (error) {
        status(`Не удалось открыть переписку: ${error?.message || 'ошибка загрузки'}`, 'error');
      }
      notification.close();
    };
  }

  launch.addEventListener('click', async () => {
    lastChatTrigger = launch;
    activeConversation = null;
    activeProduct = null;
    messageRequestId += 1;
    stopSubscription();
    showThreadView(false);
    await openChat();
  });

  $('shop-chat-close').addEventListener('click', closePanel);
  $('shop-chat-refresh').addEventListener('click', () => loadInbox({ showLoading: true }));
  $('shop-chat-search').addEventListener('input', renderInbox);
  $('shop-chat-list').addEventListener('click', async event => {
    const retry = event.target.closest('[data-chat-retry="inbox"]');
    if (retry) {
      await loadInbox({ showLoading: true });
      return;
    }
    const deleteButton = event.target.closest('[data-delete-conversation]');
    if (deleteButton) {
      const conversation = conversations.find(item => String(item.id) === deleteButton.dataset.deleteConversation);
      await hideConversation(conversation, deleteButton);
      return;
    }
    const conversationButton = event.target.closest('[data-conversation]');
    if (!conversationButton) return;
    const conversation = conversations.find(item => String(item.id) === conversationButton.dataset.conversation);
    await selectConversation(conversation);
  });
  $('shop-chat-body').addEventListener('click', event => {
    if (event.target.closest('[data-chat-retry="messages"]')) loadMessages({ forceBottom: true });
  });
  $('shop-chat-file').addEventListener('change', () => previewAttachment($('shop-chat-file').files?.[0]));
  $('shop-chat-attachment-remove').addEventListener('click', clearAttachment);
  $('shop-chat-form').addEventListener('submit', sendMessage);
  $('shop-chat-input').addEventListener('input', resizeInput);
  $('shop-chat-input').addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
    event.preventDefault();
    $('shop-chat-form').requestSubmit();
  });

  document.addEventListener('keydown', event => {
    if ($('contact-dialog')?.open) return;
    if (!panel.classList.contains('open') || event.key !== 'Escape') return;
    const authOverlay = $('auth-overlay');
    if (authOverlay && !authOverlay.hidden) return;
    event.preventDefault();
    closePanel();
  });

  window.openShopChat = async product => {
    lastChatTrigger = document.activeElement;
    activeConversation = null;
    activeProduct = product || null;
    messageRequestId += 1;
    stopSubscription();
    await openChat(product || null);
  };

  window.openShopChatConversation = async conversationId => {
    if (!conversationId) return;
    lastChatTrigger = document.activeElement;
    activeConversation = null;
    activeProduct = null;
    messageRequestId += 1;
    stopSubscription();
    setPanelOpen(true);
    status('');
    try {
      await getSession();
      if (!sessionUser) {
        $('shop-chat-form').hidden = true;
        $('shop-chat-body').innerHTML = stateMarkup('Войдите, чтобы продолжить');
        $('auth-open')?.click();
        return;
      }

      const hiddenIds = await loadHiddenConversationIds();
      if (archiveFeatureAvailable && hiddenIds?.has(String(conversationId))) {
        const { error: restoreError } = await sb.from('conversation_user_hides').delete()
          .eq('conversation_id', conversationId)
          .eq('user_id', sessionUser.id);
        if (restoreError) throw restoreError;
      }

      const { data: conversation, error } = await sb.from('conversations')
        .select('*')
        .eq('id', conversationId)
        .maybeSingle();
      if (error) throw error;
      if (!conversation) throw new Error('Этот диалог недоступен для текущего аккаунта.');
      await selectConversation(conversation);
    } catch (error) {
      console.error('Не удалось открыть чат заявки:', error);
      status(`Не удалось открыть чат заявки: ${error?.message || 'ошибка сервера'}`, 'error');
    }
  };

  sb.auth.onAuthStateChange(() => setTimeout(async () => {
    try {
      await getSession();
      if (sessionUser) {
        if (activeProduct && !isAdmin && panel.classList.contains('open')) await openChat(activeProduct);
        else if (panel.classList.contains('open')) await loadInbox({ showLoading: true });
      } else {
        conversations = [];
        inboxError = '';
        closeThread();
        renderInbox();
        $('shop-chat-list').innerHTML = stateMarkup('Войдите в аккаунт', 'После входа здесь появятся ваши диалоги.');
        $('shop-chat-body').innerHTML = stateMarkup('Переписки доступны после входа');
      }
    } catch (error) {
      console.error('Не удалось обновить состояние сообщений:', error);
      status(`Не удалось обновить сообщения: ${error?.message || 'ошибка авторизации'}`, 'error');
    }
  }, 0));

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('./sw.js').catch(error => {
      console.warn('Не удалось зарегистрировать service worker для сообщений:', error?.message || error);
    });
  }
})();
