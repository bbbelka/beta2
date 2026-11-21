(function () {
  const notice = document.getElementById('browser-storage-notice');
  const dismiss = document.getElementById('browser-storage-notice-dismiss');
  if (!notice || !dismiss) return;

  const storageKey = 'browser_storage_notice_dismissed';
  try {
    if (window.sessionStorage.getItem(storageKey) === '1') return;
  } catch (error) {
    console.warn('Не удалось проверить состояние информационного сообщения:', error);
  }

  notice.hidden = false;
  dismiss.addEventListener('click', () => {
    notice.hidden = true;
    try {
      window.sessionStorage.setItem(storageKey, '1');
    } catch (error) {
      console.warn('Не удалось сохранить состояние информационного сообщения:', error);
    }
  });
})();
