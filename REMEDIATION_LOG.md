# REMEDIATION_LOG — MAISON D'ANTIQUE

**Дата начала:** 2026-11-23
**Проект:** C:\Users\ttats\Downloads\ailia.github.io-main\ailia.github.io-main
**Источник:** AUDIT_REPORT.md (14 секций)

## Список файлов, копируемых в резерв перед изменением

| # | Файл | Статус |
|---|------|--------|
| 1 | index.html | — |
| 2 | js/config.js | — |
| 3 | js/catalog.js | — |
| 4 | js/app.js | — |
| 5 | js/pages.js | — |
| 6 | js/auth.js | — |
| 7 | js/supabase-store.js | — |
| 8 | js/messages.js | — |
| 9 | js/account-admin.js | — |
| 10 | supabase-schema.sql | — |
| 11 | inventory-migration.sql | — |
| 12 | purchase-request-migration.sql | — |
| 13 | availability-only-order-migration.sql | — |
| 14 | supabase/functions/send-push/index.ts | — |
| 15 | tests/stage15-purchase-inquiry.test.cjs | — |

## Внутренний список задач P0 → P3

### P0 — Критические
1. [ ] Создать `supabase/functions/send-inquiry/index.ts` (Edge Function для заявок)
2. [ ] Исправить `supabase-schema.sql`: убрать throwing из legacy `create_shop_order()`
3. [ ] Проверить RLS на всех таблицах (профили, товары, заказы, сообщения)
4. [ ] Подтвердить отсутствие утечек service-role ключей в клиентском коде

### P1 — Важные
5. [ ] Добавить глобальный обработчик JS ошибок (window.onerror, onunhandledrejection)
6. [ ] Добавить retry-логику для Supabase запросов
7. [ ] Усилить валидацию ввода на стороне клиента (цены, количества)
8. [ ] Проверить и исправить обработку сетевых ошибок в supabase-store.js

### P2 — Производительность и SEO
9. [ ] Создать `robots.txt`
10. [ ] Создать `sitemap.xml`
11. [ ] Добавить Open Graph / Twitter Card мета-теги в index.html
12. [ ] Добавить canonical URL
13. [ ] Добавить Schema.org микроразметку (Product, Organization)
14. [ ] Добавить lazy loading для изображений каталога (где отсутствует)

### P3 — UX и доступность
15. [ ] Создать `404.html` страницу
16. [ ] Добавить skip-to-content ссылку
17. [ ] Проверить и улучшить фокус-стили
18. [ ] Добавить alt-теги для изображений
19. [ ] Проверить контраст и адаптивность на указанных разрешениях

## Исправления (заполняется по ходу работы)

| # | Проблема | Причина | Файлы | Решение | Тестирование | Статус |
|---|----------|---------|-------|---------|--------------|--------|
| 1 | `send-inquiry` Edge Function отсутствует | Директория `supabase/functions/send-inquiry/` пуста | `supabase/functions/send-inquiry/index.ts` (new) | Создана Edge Function с аутентификацией, валидацией ввода, rate-limiting, защитой от подделки данных, корректной обработкой ошибок без раскрытия внутренних деталей | Статический анализ кода, проверка синтаксиса TypeScript, проверка подписей функций | FIXED |
| 2 | Legacy `create_shop_order()` выбрасывает исключение со ссылкой на несуществующую миграцию | `supabase-schema.sql:161` ссылается на `inventory-migration.sql`, но frontend использует `create_purchase_request` из `purchase-request-migration.sql` | `supabase-schema.sql` | Обновлено сообщение исключения со ссылкой на `purchase-request-migration.sql` и `public.create_purchase_request(jsonb, uuid)` | Чтение файла, проверка соответствия сообщения актуальным миграциям | FIXED |
| 3 | RLS безопасность | Требуется повторная проверка | `supabase-schema.sql`, `purchase-request-migration.sql` | RLS включён на всех таблицах, политики granular, `is_admin()` через security definer, service-role ключ не в клиентском коде, роль admin не назначается клиентом | Статический анализ SQL-файлов | VERIFIED |
| 4 | Отсутствует обработка неперехваченных JS ошибок | Нет глобального обработчика | `js/app.js` | Добавлены `window.addEventListener('error')` и `window.addEventListener('unhandledrejection')` | Статический анализ, проверка syntax | FIXED |
| 5 | Нет retry-логики для Supabase запросов | Временные сетевые ошибки приводят к сбоям | `js/supabase-store.js` | Добавлена `window.supabaseWithRetry` с экспоненциальной задержкой (3 попытки, базовая задержка 500мс) | Статический анализ, проверка syntax | FIXED |
| 6 | Нет валидации цены при сохранении товара | Клиент может отправить некорректную цену | `js/account-admin.js` | Добавлена валидация цены (положительное число) перед вызовом Supabase | Статический анализ, проверка syntax | FIXED |
| 7 | Отсутствует `robots.txt` | Нет управления сканированием | `robots.txt` (new) | Создан базовый `robots.txt` с ссылкой на sitemap | Проверка существования файла | FIXED |
| 8 | Отсутствует `sitemap.xml` | Поисковые системы не могут эффективно индексировать | `sitemap.xml` (new) | Создан `sitemap.xml` со всеми основными страницами | Валидация XML-структуры | FIXED |
| 9 | Отсутствуют Open Graph / Twitter Card теги | Плохое представление в соцсетях | `index.html` | Добавлены og:*, twitter:* мета-теги | Чтение HTML, проверка тегов | FIXED |
| 10 | Отсутствует canonical URL | Потенциальное дублирование контента | `index.html` | Добавлен `rel="canonical"` | Чтение HTML | FIXED |
| 11 | Отсутствует Schema.org микроразметка | Снижение видимости в расширенных результатах | `index.html`, `js/pages.js` | Добавлен Organization JSON-LD в index.html; Product JSON-LD в renderProduct() | Чтение кода, проверка JSON-LD | FIXED |
| 12 | Нет lazy loading для изображений | Все изображения загружаются одновременно | `js/pages.js` | Добавлен `loading="lazy"` для изображений корзины и миниатюр галереи товара | Чтение кода | FIXED |
| 13 | Отсутствует страница 404 | Стандартная ошибка браузера | `404.html` (new) | Создана страница 404 в стиле сайта со ссылкой на каталог | Проверка существования файла | FIXED |
| 14 | Отсутствует skip-to-content ссылка | Нет быстрой навигации для клавиатуры | `index.html`, `css/style.css` | Добавлена `.skip-link` ссылка и соответствующие стили | Чтение HTML и CSS | FIXED |
