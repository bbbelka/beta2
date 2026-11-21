(function () {
  const $ = (id) => document.getElementById(id);
  const allowedPhotoTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);
  let currentUser = null;
  let currentAvatarUrl = '';
  let previewObjectUrl = '';

  function clearPreviewObjectUrl() {
    if (!previewObjectUrl) return;
    URL.revokeObjectURL(previewObjectUrl);
    previewObjectUrl = '';
  }

  function setMessage(text, ok = false) {
    const el = $('profile-edit-message');
    if (!el) return;
    el.textContent = text;
    el.classList.toggle('is-success', ok);
    el.classList.toggle('is-error', Boolean(text) && !ok);
  }

  function showAvatar(url) {
    const box = $('l-profile-avatar');
    if (!box) return;
    box.replaceChildren();
    if (url) {
      const img = document.createElement('img');
      img.src = url;
      img.alt = 'Фото профиля';
      img.referrerPolicy = 'no-referrer';
      box.appendChild(img);
    } else {
      box.textContent = '👤';
    }
    const oldAvatar = document.querySelector('.lk-user-card .lk-avatar:not(#l-profile-avatar)');
    if (oldAvatar) oldAvatar.remove();
  }

  async function loadProfile() {
    if (!window.sb) {
      if ($('profile-edit-panel')) $('profile-edit-panel').hidden = true;
      if ($('l-profile-auth-notice')) $('l-profile-auth-notice').hidden = false;
      return;
    }
    const panel = $('profile-edit-panel');
    let session;
    try {
      const { data, error } = await sb.auth.getSession();
      if (error) throw error;
      session = data?.session;
    } catch (error) {
      console.error('Profile session check failed:', error);
      currentUser = null;
      if (panel) panel.hidden = true;
      if ($('l-profile-auth-notice')) $('l-profile-auth-notice').hidden = false;
      window.storeToast?.('Не удалось проверить вход. Проверьте соединение и обновите страницу.');
      return;
    }
    currentUser = session?.user || null;
    if (!currentUser) {
      if (panel) panel.hidden = true;
      if ($('l-profile-auth-notice')) $('l-profile-auth-notice').hidden = false;
      if ($('l-account-email-row')) $('l-account-email-row').hidden = true;
      if ($('l-registration-row')) $('l-registration-row').hidden = true;
      if ($('l-registration-date')) $('l-registration-date').textContent = '';
      currentAvatarUrl = '';
      if ($('profile-display-name')) $('profile-display-name').value = '';
      clearPreviewObjectUrl();
      showAvatar('');
      return;
    }
    if (panel) panel.hidden = false;
    if ($('l-profile-auth-notice')) $('l-profile-auth-notice').hidden = true;
    if ($('l-account-email')) $('l-account-email').textContent = currentUser.email || '';
    if ($('l-account-email-row')) $('l-account-email-row').hidden = !currentUser.email;
    const registrationRow = $('l-registration-row');
    const registrationDate = $('l-registration-date');
    if (registrationDate) registrationDate.textContent = '';
    if (registrationDate && currentUser.created_at) {
      const date = new Date(currentUser.created_at);
      registrationDate.textContent = Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('ru-RU');
    }
    if (registrationRow) registrationRow.hidden = !registrationDate?.textContent;
    const nameEl = $('l-user-name');
    const fallbackName = currentUser.user_metadata?.display_name || currentUser.user_metadata?.full_name || currentUser.email || 'Покупатель';
    if (nameEl) nameEl.textContent = fallbackName;
    currentAvatarUrl = '';
    if ($('profile-display-name')) $('profile-display-name').value = currentUser.user_metadata?.display_name || '';
    clearPreviewObjectUrl();
    showAvatar('');
    setMessage('Загружаем профиль…', true);
    let data;
    try {
      const result = await sb.from('profiles')
        .select('display_name, avatar_url')
        .eq('id', currentUser.id).maybeSingle();
      if (result.error) throw result.error;
      data = result.data;
    } catch (error) {
      console.error('Profile load error:', error);
      const message = /column|schema cache|display_name|avatar_url/i.test(error?.message || '')
        ? 'Не удалось загрузить профиль. Проверь, что выполнил profile-migration.sql в Supabase.'
        : 'Не удалось загрузить профиль. Проверьте соединение и попробуйте снова.';
      setMessage(message);
      return;
    }
    const name = data?.display_name || currentUser.user_metadata?.display_name || '';
    currentAvatarUrl = data?.avatar_url || '';
    if ($('profile-display-name')) $('profile-display-name').value = name;
    if (nameEl) nameEl.textContent = name || fallbackName;
    showAvatar(currentAvatarUrl);
    setMessage('');
  }

  async function saveProfile(event) {
    event.preventDefault();
    if (!window.sb) return setMessage('Авторизация Supabase не настроена.');
    let session;
    try {
      const { data, error } = await sb.auth.getSession();
      if (error) throw error;
      session = data?.session;
    } catch (error) {
      console.error('Profile session check failed:', error);
      return setMessage('Не удалось проверить вход. Проверьте соединение и попробуйте снова.');
    }
    currentUser = session?.user || null;
    if (!currentUser) return setMessage('Войди в аккаунт через «Личный кабинет», чтобы изменить профиль.');

    const saveBtn = $('profile-save-button');
    const fileInput = $('profile-photo-file');
    const file = fileInput?.files?.[0];
    const name = $('profile-display-name').value.trim();
    if (name.length > 60) return setMessage('Имя должно быть не длиннее 60 символов.');
    if (file && !allowedPhotoTypes.has(file.type)) return setMessage('Выбери фото в формате JPEG, PNG, WebP или GIF.');
    if (file && file.size > 5 * 1024 * 1024) return setMessage('Фото должно быть не больше 5 МБ.');

    saveBtn.disabled = true;
    setMessage('Сохраняю…', true);
    try {
      let avatarUrl = currentAvatarUrl;
      if (file) {
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
        const path = `${currentUser.id}/${Date.now()}.${ext}`;
        const { error: uploadError } = await sb.storage.from('profile-photos').upload(path, file, {
          cacheControl: '3600', upsert: true, contentType: file.type
        });
        if (uploadError) throw uploadError;
        const { data: publicData } = sb.storage.from('profile-photos').getPublicUrl(path);
        avatarUrl = publicData.publicUrl;
      }
      const { error } = await sb.from('profiles').upsert({
        id: currentUser.id,
        display_name: name,
        avatar_url: avatarUrl
      }, { onConflict: 'id' });
      if (error) throw error;
      currentAvatarUrl = avatarUrl;
      if ($('l-user-name')) $('l-user-name').textContent = name || currentUser.email || 'Покупатель';
      clearPreviewObjectUrl();
      showAvatar(avatarUrl);
      if (fileInput) fileInput.value = '';
      setMessage('Профиль сохранён.', true);
    } catch (err) {
      console.error('Profile save error:', err);
      const message = err?.message || 'Не удалось сохранить профиль.';
      if (/bucket|storage/i.test(message)) setMessage('Хранилище фото не настроено. Выполни profile-migration.sql в Supabase.');
      else if (/column|schema cache|display_name|avatar_url/i.test(message)) setMessage('Сначала выполни profile-migration.sql в Supabase.');
      else setMessage(`Ошибка сохранения: ${message}`);
    } finally {
      saveBtn.disabled = false;
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const form = $('profile-edit-form');
    if (form) form.addEventListener('submit', saveProfile);
    const fileInput = $('profile-photo-file');
    if (fileInput) fileInput.addEventListener('change', () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (!allowedPhotoTypes.has(file.type) || file.size > 5 * 1024 * 1024) {
        setMessage('Нужно фото в формате JPEG, PNG, WebP или GIF размером до 5 МБ.');
        fileInput.value = '';
        return;
      }
      clearPreviewObjectUrl();
      previewObjectUrl = URL.createObjectURL(file);
      showAvatar(previewObjectUrl);
    });
    if (window.sb) sb.auth.onAuthStateChange(() => setTimeout(loadProfile, 0));
    loadProfile();
  });
})();
