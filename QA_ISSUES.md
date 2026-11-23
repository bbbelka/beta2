# QA ISSUES

**Project:** MAISON D'ANTIQUE  
**Scope:** Issues found during independent QA verification  
**Date:** 2026-11-23  

---

## Summary

No regressions were introduced by the remediation work. All issues listed below are either **pre-existing conditions** (present before remediation) or **limitations of static analysis** (cannot be verified without a live Supabase instance or browser). None of these issues block deployment.

---

## Pre-Existing Issues (Not Caused by Remediation)

### QI-001: `matchMedia is not defined` in Node.js test environment
- **Severity:** Low
- **Location:** Test files (`tests/`)
- **Description:** 2 of 34 tests fail because `window.matchMedia` is not available in Node.js. This is a test environment limitation, not a code bug.
- **Impact:** Tests that depend on `matchMedia` cannot run in headless Node.js
- **Recommendation:** Add a `matchMedia` polyfill in test setup, or run tests in a browser environment (jsdom, Playwright, etc.)

### QI-002: Supabase anon key exposed in client-side code
- **Severity:** Low
- **Location:** `js/config.js`
- **Description:** The Supabase anon key is hardcoded in `js/config.js` and visible in the browser. This is expected for client-side Supabase usage — RLS policies protect data, not key secrecy.
- **Impact:** None (by design for client-side Supabase)
- **Recommendation:** None — this is standard Supabase client architecture

### QI-003: `innerHTML` usage in `js/pages.js`
- **Severity:** Low
- **Location:** `js/pages.js` (multiple lines)
- **Description:** `innerHTML` is used extensively to render product catalog, product detail pages, and cart. All values are passed through `esc()` for XSS prevention.
- **Impact:** Low risk — XSS protection is in place via `esc()`
- **Recommendation:** Consider using `textContent` for text-only nodes and `createElement`/`appendChild` for complex DOM in future refactoring

---

## Static Analysis Limitations (Cannot Be Verified Without Runtime)

### QI-004: Edge Function `send-inquiry` not tested at runtime
- **Severity:** Medium
- **Location:** `supabase/functions/send-inquiry/index.ts`
- **Description:** New Edge Function created but cannot be deployed or tested against a live Supabase instance in this environment.
- **Impact:** Runtime behavior (error handling, email sending, response format) unknown
- **Recommendation:** Deploy to Supabase and test with real inquiry submissions

### QI-005: RLS policies not verified at runtime
- **Severity:** Medium
- **Location:** `supabase-schema.sql`
- **Description:** Row Level Security policies reviewed statically only. Cannot confirm they enforce correct access rules against a live database.
- **Impact:** Unknown — potential for overly permissive or restrictive policies
- **Recommendation:** Test RLS policies with authenticated and anonymous users against live Supabase

### QI-006: `create_shop_order` stock validation not tested at runtime
- **Severity:** Medium
- **Location:** `supabase-schema.sql`
- **Description:** Error message updated but stock validation logic not executed against live data.
- **Impact:** Unknown
- **Recommendation:** Place test orders and verify stock decrement and error handling

### QI-007: Performance metrics not measurable
- **Severity:** Low
- **Location:** N/A
- **Description:** No browser or Lighthouse available to measure LCP, FID, CLS, or other Core Web Vitals.
- **Impact:** Real-world performance unknown
- **Recommendation:** Run Lighthouse audit in production or staging

### QI-008: Accessibility not tested with assistive technology
- **Severity:** Low
- **Location:** N/A
- **Description:** Skip-to-content link and ARIA attributes verified statically but not tested with screen readers or keyboard navigation.
- **Impact:** Unknown
- **Recommendation:** Test with NVDA/JAWS/VoiceOver and keyboard-only navigation

---

## No New Issues

The following areas were checked and **no new issues** were found:
- JavaScript syntax (all 4 modified files pass `node --check`)
- HTML validity (all modified HTML files structurally sound)
- CSS (no conflicting selectors or broken rules in `css/style.css`)
- SEO (all meta tags, canonical, OG, Twitter, Schema.org present)
- Regression (no removed functionality, no broken references, no duplicate handlers)
- Security (no new secrets exposed, XSS protection via `esc()` maintained)

---

## Deployment Readiness

| Checklist Item | Status |
|----------------|--------|
| All P0–P3 fixes verified | PASS |
| No regressions detected | PASS |
| JavaScript syntax valid | PASS |
| Tests passing (32/34, 2 pre-existing) | PASS |
| SEO meta tags present | PASS |
| robots.txt / sitemap.xml / 404.html present | PASS |
| Edge Function created (untested at runtime) | PASS (static) |
| RLS policies reviewed (untested at runtime) | PASS (static) |

**Overall: Ready for deployment with the limitations noted above.**
