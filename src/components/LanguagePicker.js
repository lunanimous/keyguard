class LanguagePicker {

    /**
     * @param {I18n} i18n
     */
    constructor(i18n) {
        this._i18n = i18n;

        /** @type {HTMLElement} */
        this._el;
    }

    /**
     * Produces a select element that the user can chose an available language from.
     */
    getElement() {
        if (this._el) return this._el;

        const element = document.createElement('select');
        const options = [];

        for (const language of this._i18n.availableLanguages()) {
            const label = this._i18n.translatePhrase('_language', language);

            const option = document.createElement('option');
            option.value = language;
            option.textContent = label;

            if (language === this._i18n.language) {
                option.setAttribute('selected', 'selected');
            }

            element.appendChild(option);
        }

        element.classList.add('i18n-language-picker');
        element.addEventListener('change', () => {
            this._i18n.switchLanguage(element.value);
        });

        this._el = element;
        return this._el;
    }
}
