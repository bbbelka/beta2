(function () {
  function parseProductPrice(value) {
    if (typeof value !== 'string' && typeof value !== 'number') return null;
    let price = String(value).trim()
      .replace(/[\u00a0\u202f]/g, ' ')
      .replace(/[ \t]+/g, ' ')
      .replace(/[ \t]*(₽|руб\.?)$/i, '')
      .trim();
    if (!/^(?:\d+|\d{1,3}(?: \d{3})+)(?:[.,]\d{1,2})?$/.test(price)) return null;
    price = price.replace(/ /g, '').replace(',', '.');
    const amount = Number(price);
    return Number.isFinite(amount) && amount > 0 ? amount : null;
  }

  window.parseProductPrice = parseProductPrice;
})();
