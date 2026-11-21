(function () {
    const preferenceKey = 'maison-antique-theme';
    const root = document.documentElement;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

    function currentTheme() {
        return root.dataset.theme === 'dark' ? 'dark' : 'light';
    }

    function updateControls(theme) {
        const toggle = document.getElementById('theme-toggle');
        const state = document.getElementById('theme-setting-state');
        const isDark = theme === 'dark';

        if (toggle) {
            toggle.setAttribute('aria-checked', String(isDark));
            toggle.setAttribute('aria-label', `Тема сайта: ${isDark ? 'тёмная' : 'светлая'}`);
        }
        if (state) state.textContent = isDark ? 'Тёмная' : 'Светлая';

        const themeColor = document.querySelector('meta[name="theme-color"]');
        if (themeColor) themeColor.content = isDark ? '#0e0e0d' : '#ffffff';
    }

    function applyTheme(theme, { persist = true, animate = true } = {}) {
        const nextTheme = theme === 'dark' ? 'dark' : 'light';
        if (currentTheme() === nextTheme) {
            updateControls(nextTheme);
            return;
        }

        const commit = () => {
            root.dataset.theme = nextTheme;
            updateControls(nextTheme);
            if (!persist) return;
            try {
                localStorage.setItem(preferenceKey, nextTheme);
            } catch (error) {
                console.warn('Theme preference could not be saved.', error);
            }
        };

        if (!animate || reducedMotion.matches || typeof document.startViewTransition !== 'function') {
            commit();
            return;
        }

        const toggle = document.getElementById('theme-toggle');
        root.classList.add('theme-transitioning');
        if (toggle) toggle.disabled = true;

        let transition;
        try {
            transition = document.startViewTransition(commit);
        } catch (error) {
            root.classList.remove('theme-transitioning');
            if (toggle) toggle.disabled = false;
            console.warn('Theme transition could not start.', error);
            commit();
            return;
        }

        const finishTransition = () => {
            root.classList.remove('theme-transitioning');
            if (toggle) toggle.disabled = false;
        };
        transition.finished.then(finishTransition, finishTransition);
    }

    function initialize() {
        updateControls(currentTheme());
        const toggle = document.getElementById('theme-toggle');
        if (toggle) {
            toggle.addEventListener('click', () => {
                applyTheme(currentTheme() === 'dark' ? 'light' : 'dark');
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initialize, { once: true });
    } else {
        initialize();
    }

    window.addEventListener('storage', event => {
        if (event.key !== preferenceKey) return;
        applyTheme(event.newValue === 'dark' ? 'dark' : 'light', { persist: false, animate: false });
    });
})();
