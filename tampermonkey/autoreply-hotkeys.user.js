// ==UserScript==
// @name         Автоответы по горячим клавишам
// @name:en      Auto-Reply Hotkeys
// @namespace    https://github.com/bumba183/math-lm
// @version      1.0.0
// @description  Заготовленные автоответы вставляются в активное поле ввода по нажатию своей комбинации клавиш. Работает с input, textarea и contenteditable (чаты, соцсети, тикет-системы, CRM).
// @description:en  Insert canned replies into the focused input field with a hotkey.
// @author       -
// @license      MIT
// @match        *://*/*
// @run-at       document-end
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

/* eslint-env browser, greasemonkey */

(function () {
  'use strict';

  // ========================== 1. КОНФИГУРАЦИЯ ==========================

  const STORE_KEY = 'arh.config.v1';
  const CURSOR = '{cursor}';           // маркер: куда поставить курсор после вставки

  // Автоответы «из коробки». Их можно полностью заменить в настройках
  // (меню Tampermonkey → «Настроить автоответы» или Ctrl+Alt+0).
  const DEFAULT_TEXT = [
    '# Формат: [комбинация | название | send]',
    '# Строки ниже заголовка — текст автоответа (можно несколько строк).',
    '# Флаг send = вставить и сразу нажать Enter (работает не на всех сайтах).',
    '# Подстановки: {cursor} {selection} {clipboard} {date} {time} {datetime} {url} {title} {ask:Вопрос}',
    '',
    '[Ctrl+Alt+1 | Приветствие]',
    'Здравствуйте! Спасибо за обращение — уже смотрю ваш вопрос.',
    '',
    '[Ctrl+Alt+2 | Просьба подождать]',
    'Одну минуту, уточняю информацию и вернусь с ответом.',
    '',
    '[Ctrl+Alt+3 | Готово]',
    'Готово ✅',
    'Если появятся вопросы — напишите, я на связи.',
    '',
    '[Ctrl+Alt+4 | Знакомство]',
    'Добрый день! Меня зовут {ask:Как вас представить?}, я помогу с вашим вопросом.',
    '{cursor}',
    '',
    '[Ctrl+Alt+5 | Дата и ссылка]',
    'Актуально на {date} {time}. Страница: {url}'
  ].join('\n');

  const DEFAULT_CONFIG = {
    text: DEFAULT_TEXT,
    pickerHotkey: 'Ctrl+Alt+Space',    // палитра со списком всех автоответов
    settingsHotkey: 'Ctrl+Alt+0',      // окно настроек
    toasts: true                       // всплывающие подсказки
  };

  // ========================== 2. ХРАНИЛИЩЕ ==========================

  const hasGM = typeof GM_getValue === 'function' && typeof GM_setValue === 'function';

  function loadConfig() {
    let raw = null;
    try {
      raw = hasGM ? GM_getValue(STORE_KEY, null) : localStorage.getItem(STORE_KEY);
    } catch (e) { /* приватный режим или запрет доступа к storage */ }
    let parsed = null;
    if (typeof raw === 'string' && raw) {
      try { parsed = JSON.parse(raw); } catch (e) { /* битые данные — берём значения по умолчанию */ }
    } else if (raw && typeof raw === 'object') {
      parsed = raw;
    }
    return Object.assign({}, DEFAULT_CONFIG, parsed || {});
  }

  function saveConfig(cfg) {
    try {
      const json = JSON.stringify(cfg);
      if (hasGM) GM_setValue(STORE_KEY, json);
      else localStorage.setItem(STORE_KEY, json);
      return true;
    } catch (e) {
      return false;
    }
  }

  let config = loadConfig();
  let templates = [];   // разобранные автоответы
  let problems = [];    // замечания парсера (показываются в настройках)

  // ========================== 3. РАЗБОР КОМБИНАЦИЙ ==========================

  const MOD_CTRL  = ['ctrl', 'control', 'ctl', 'ктрл', 'контрол'];
  const MOD_ALT   = ['alt', 'option', 'opt', 'альт'];
  const MOD_SHIFT = ['shift', 'шифт', 'сдвиг'];
  const MOD_META  = ['meta', 'cmd', 'command', 'win', 'super', 'мета'];

  // Имена клавиш → event.code
  const NAMED_KEYS = {
    space: 'Space', пробел: 'Space', spacebar: 'Space',
    enter: 'Enter', return: 'Enter', ввод: 'Enter',
    tab: 'Tab', таб: 'Tab',
    esc: 'Escape', escape: 'Escape',
    backspace: 'Backspace', del: 'Delete', delete: 'Delete',
    ins: 'Insert', insert: 'Insert',
    home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown', pgup: 'PageUp', pgdn: 'PageDown',
    up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight',
    arrowup: 'ArrowUp', arrowdown: 'ArrowDown', arrowleft: 'ArrowLeft', arrowright: 'ArrowRight',
    comma: 'Comma', ',': 'Comma',
    period: 'Period', dot: 'Period', '.': 'Period',
    slash: 'Slash', '/': 'Slash',
    backslash: 'Backslash', '\\': 'Backslash',
    semicolon: 'Semicolon', ';': 'Semicolon',
    quote: 'Quote', "'": 'Quote',
    bracketleft: 'BracketLeft', '[': 'BracketLeft',
    bracketright: 'BracketRight', ']': 'BracketRight',
    minus: 'Minus', '-': 'Minus',
    equal: 'Equal', '=': 'Equal', plus: 'Equal', плюс: 'Equal', '+': 'Equal',
    backquote: 'Backquote', '`': 'Backquote'
  };

  // Русская раскладка ЙЦУКЕН → физическая клавиша, чтобы «Ctrl+Alt+Ф» тоже работало
  const RU_TO_CODE = {
    'й': 'KeyQ', 'ц': 'KeyW', 'у': 'KeyE', 'к': 'KeyR', 'е': 'KeyT', 'н': 'KeyY', 'г': 'KeyU',
    'ш': 'KeyI', 'щ': 'KeyO', 'з': 'KeyP', 'х': 'BracketLeft', 'ъ': 'BracketRight',
    'ф': 'KeyA', 'ы': 'KeyS', 'в': 'KeyD', 'а': 'KeyF', 'п': 'KeyG', 'р': 'KeyH', 'о': 'KeyJ',
    'л': 'KeyK', 'д': 'KeyL', 'ж': 'Semicolon', 'э': 'Quote',
    'я': 'KeyZ', 'ч': 'KeyX', 'с': 'KeyC', 'м': 'KeyV', 'и': 'KeyB', 'т': 'KeyN', 'ь': 'KeyM',
    'б': 'Comma', 'ю': 'Period', 'ё': 'Backquote'
  };

  // Готовые значения event.code, которые можно писать в комбинации напрямую
  const KNOWN_CODES = new Set(Object.keys(NAMED_KEYS).map((name) => NAMED_KEYS[name]));

  // Клавиши, которые можно использовать вообще без модификаторов
  const SAFE_ALONE = /^(F\d{1,2}|Escape|Insert|Home|End|PageUp|PageDown|Arrow(Up|Down|Left|Right))$/;

  function tokenizeHotkey(str) {
    const parts = String(str).split('+').map((s) => s.trim());
    const tokens = parts.filter(Boolean);
    // «Ctrl+Alt++» — последний плюс сам является клавишей
    if (parts.length > 1 && parts[parts.length - 1] === '') tokens.push('+');
    return tokens;
  }

  function keyToCode(token) {
    const low = token.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(NAMED_KEYS, low)) return NAMED_KEYS[low];
    if (/^[0-9]$/.test(low)) return 'Digit' + low;
    if (/^[a-z]$/.test(low)) return 'Key' + low.toUpperCase();
    if (Object.prototype.hasOwnProperty.call(RU_TO_CODE, low)) return RU_TO_CODE[low];
    if (/^f([1-9]|1[0-2])$/.test(low)) return 'F' + low.slice(1);
    if (/^(num|numpad)([0-9])$/.test(low)) return 'Numpad' + low.slice(-1);
    // Уже готовый event.code, например KeyA / Digit1 / Backquote
    if (/^(Key[A-Z]|Digit[0-9]|Numpad[0-9])$/.test(token) || KNOWN_CODES.has(token)) return token;
    return null;
  }

  /** Разбирает «Ctrl+Alt+1» в объект комбинации. Возвращает {hk} либо {error}. */
  function parseHotkey(str) {
    const tokens = tokenizeHotkey(str);
    if (!tokens.length) return { error: 'комбинация не указана' };

    const hk = { ctrl: false, alt: false, shift: false, meta: false, code: null };
    for (const token of tokens) {
      const low = token.toLowerCase();
      if (MOD_CTRL.includes(low)) { hk.ctrl = true; continue; }
      if (MOD_ALT.includes(low)) { hk.alt = true; continue; }
      if (MOD_SHIFT.includes(low)) { hk.shift = true; continue; }
      if (MOD_META.includes(low)) { hk.meta = true; continue; }
      if (hk.code) return { error: 'в комбинации больше одной основной клавиши' };
      const code = keyToCode(token);
      if (!code) return { error: 'неизвестная клавиша «' + token + '»' };
      hk.code = code;
    }
    if (!hk.code) return { error: 'не указана основная клавиша' };
    if (!hk.ctrl && !hk.alt && !hk.meta && !SAFE_ALONE.test(hk.code)) {
      return { error: 'без Ctrl/Alt/Cmd такая комбинация перехватывала бы обычный набор текста' };
    }
    hk.sig = signature(hk.ctrl, hk.alt, hk.shift, hk.meta, hk.code);
    hk.display = formatHotkey(hk);
    return { hk: hk };
  }

  function signature(ctrl, alt, shift, meta, code) {
    return [ctrl ? 1 : 0, alt ? 1 : 0, shift ? 1 : 0, meta ? 1 : 0, code].join('|');
  }

  function formatHotkey(hk) {
    const out = [];
    if (hk.ctrl) out.push('Ctrl');
    if (hk.alt) out.push('Alt');
    if (hk.shift) out.push('Shift');
    if (hk.meta) out.push('Cmd');
    out.push(prettyCode(hk.code));
    return out.join('+');
  }

  function prettyCode(code) {
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit[0-9]$/.test(code)) return code.slice(5);
    if (/^Numpad[0-9]$/.test(code)) return 'Num' + code.slice(6);
    const symbols = {
      Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Semicolon: ';', Quote: "'",
      BracketLeft: '[', BracketRight: ']', Minus: '-', Equal: '=', Backquote: '`'
    };
    return symbols[code] || code;
  }

  /** Подписи нажатия: основная плюс «цифра на нумпаде = обычная цифра». */
  function eventSignatures(e) {
    const sigs = [];
    const code = e.code || keyToCode(e.key || '') || '';
    if (!code) return sigs;
    sigs.push(signature(e.ctrlKey, e.altKey, e.shiftKey, e.metaKey, code));
    const numpad = /^Numpad([0-9])$/.exec(code);
    if (numpad) sigs.push(signature(e.ctrlKey, e.altKey, e.shiftKey, e.metaKey, 'Digit' + numpad[1]));
    return sigs;
  }

  // ========================== 4. РАЗБОР СПИСКА АВТООТВЕТОВ ==========================

  /**
   * Формат хранения (удобно копировать и вставлять целиком):
   *
   *   [Ctrl+Alt+1 | Приветствие]
   *   Здравствуйте!
   *   Чем могу помочь?
   *
   *   [Ctrl+Alt+2 | Готово | send]
   *   Готово ✅
   */
  function parseTemplates(text) {
    const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
    const items = [];
    const notes = [];
    let current = null;

    const flush = () => {
      if (!current) return;
      const body = trimBlankEdges(current.lines).join('\n');
      if (!body.trim()) {
        notes.push('Строка ' + current.line + ': у «' + current.raw + '» пустой текст — блок пропущен.');
      } else {
        current.text = body;
        items.push(current);
      }
      current = null;
    };

    lines.forEach((line, index) => {
      const lineNo = index + 1;
      const header = /^\s*\[([^\]]*)\]\s*$/.exec(line);

      if (header) {
        const parsed = parseHeader(header[1]);
        if (parsed.hk) {
          flush();
          current = {
            hk: parsed.hk,
            hotkey: parsed.hk.display,
            label: parsed.label || parsed.hk.display,
            send: parsed.send,
            lines: [],
            line: lineNo,
            raw: header[1].trim()
          };
          return;
        }
        // Не похоже на комбинацию: внутри блока считаем обычным текстом, иначе — ошибка.
        if (current) {
          notes.push('Строка ' + lineNo + ': «' + line.trim() + '» не разобрано как комбинация (' +
            parsed.error + '), строка вставлена как обычный текст.');
        } else {
          notes.push('Строка ' + lineNo + ': не удалось разобрать заголовок «' + line.trim() + '» — ' + parsed.error + '.');
          return;
        }
      }

      if (current) {
        // \[...\] — способ начать строку ответа с квадратной скобки
        current.lines.push(line.replace(/^(\s*)\\\[/, '$1['));
      } else if (line.trim() && !/^\s*(#|\/\/)/.test(line)) {
        notes.push('Строка ' + lineNo + ': текст вне блока [комбинация] — проигнорирован.');
      }
    });
    flush();

    // Дубликаты комбинаций: работает первая, остальные отключаем
    const seen = new Map();
    const result = [];
    for (const item of items) {
      if (seen.has(item.hk.sig)) {
        notes.push('Комбинация ' + item.hotkey + ' уже занята автоответом «' +
          seen.get(item.hk.sig).label + '» — блок в строке ' + item.line + ' не работает.');
        continue;
      }
      seen.set(item.hk.sig, item);
      result.push(item);
    }

    return { items: result, notes: notes };
  }

  function parseHeader(inner) {
    const parts = String(inner).split('|').map((s) => s.trim());
    const hotkeyPart = parts.shift() || '';
    const parsed = parseHotkey(hotkeyPart);
    if (!parsed.hk) return { error: parsed.error };
    let label = '';
    let send = false;
    for (const part of parts) {
      if (!part) continue;
      const low = part.toLowerCase();
      if (low === 'send' || low === 'отправить' || low === 'enter') { send = true; continue; }
      label = part.replace(/^name\s*[=:]\s*/i, '');
    }
    return { hk: parsed.hk, label: label, send: send };
  }

  function trimBlankEdges(arr) {
    const copy = arr.slice();
    while (copy.length && !copy[0].trim()) copy.shift();
    while (copy.length && !copy[copy.length - 1].trim()) copy.pop();
    return copy;
  }

  function reloadTemplates() {
    const parsed = parseTemplates(config.text);
    templates = parsed.items;
    problems = parsed.notes;
  }

  // ========================== 5. ПОИСК ПОЛЯ ВВОДА ==========================

  let lastEditable = null;

  function deepActiveElement() {
    let el = document.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }

  function isEditable(el) {
    if (!el || el.nodeType !== 1 || el.disabled || el.readOnly) return false;
    if (hostEl && hostEl.contains(el)) return false;          // наши собственные поля не считаются
    const tag = el.tagName;
    if (tag === 'TEXTAREA') return true;
    if (tag === 'INPUT') return /^(|text|search|url|email|tel|password|number)$/i.test(el.type || '');
    return el.isContentEditable === true;
  }

  function resolveTarget() {
    const active = deepActiveElement();
    if (isEditable(active)) return active;
    if (lastEditable && document.contains(lastEditable) && isEditable(lastEditable)) return lastEditable;
    return null;
  }

  document.addEventListener('focusin', (e) => {
    const el = deepActiveElement() || e.target;
    if (isEditable(el)) lastEditable = el;
  }, true);

  // ========================== 6. ВСТАВКА ТЕКСТА ==========================

  function setNativeValue(el, value) {
    // React/Vue следят за сеттером value, поэтому дёргаем именно нативный
    const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function fireInput(el, data) {
    el.dispatchEvent(new InputEvent('input', {
      bubbles: true, cancelable: false, inputType: 'insertText', data: data
    }));
    if (el.value !== undefined) el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function readContent(el) {
    return el.value !== undefined ? el.value : el.textContent;
  }

  /** Вставляет строку в место курсора, заменяя выделение. */
  function insertPlain(el, str) {
    if (!str) return true;
    const before = readContent(el);
    try {
      // Нативная вставка: корректные события, работает и в contenteditable
      if (document.execCommand('insertText', false, str) && readContent(el) !== before) return true;
    } catch (e) { /* execCommand может быть запрещён — идём в запасной путь */ }

    if (el.value !== undefined) {
      const start = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length;
      const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : start;
      setNativeValue(el, el.value.slice(0, start) + str + el.value.slice(end));
      const pos = start + str.length;
      try { el.setSelectionRange(pos, pos); } catch (e) {}
      fireInput(el, str);
      return true;
    }
    return insertIntoContentEditable(el, str);
  }

  function insertIntoContentEditable(el, str) {
    const sel = window.getSelection();
    let range = null;
    if (sel && sel.rangeCount && el.contains(sel.anchorNode)) {
      range = sel.getRangeAt(0);
    } else {
      range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
    }
    range.deleteContents();

    const frag = document.createDocumentFragment();
    str.split('\n').forEach((part, i) => {
      if (i) frag.appendChild(document.createElement('br'));
      if (part) frag.appendChild(document.createTextNode(part));
    });
    const lastNode = frag.lastChild;
    range.insertNode(frag);
    if (lastNode && sel) {
      const after = document.createRange();
      after.setStartAfter(lastNode);
      after.collapse(true);
      sel.removeAllRanges();
      sel.addRange(after);
    }
    fireInput(el, str);
    return true;
  }

  /** Вставляет текст автоответа, учитывая маркер {cursor}. */
  function insertTemplateText(el, text) {
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }

    const at = text.indexOf(CURSOR);
    const head = at >= 0 ? text.slice(0, at) : text;
    const tail = at >= 0 ? text.slice(at + CURSOR.length) : '';

    if (el.value !== undefined) {
      const start = typeof el.selectionStart === 'number' ? el.selectionStart : el.value.length;
      const ok = insertPlain(el, head + tail);
      if (ok && tail) {
        const pos = start + head.length;
        try { el.setSelectionRange(pos, pos); } catch (e) {}
      }
      return ok;
    }

    if (!head && tail) {
      // Текст начинается с {cursor}: сначала убираем выделение, чтобы его не потерять
      try {
        const sel = window.getSelection();
        if (sel && !sel.isCollapsed) document.execCommand('delete');
      } catch (e) {}
    }

    const ok = insertPlain(el, head);
    if (!tail) return ok;

    const sel = window.getSelection();
    const saved = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    insertPlain(el, tail);
    if (saved && sel) {
      try { sel.removeAllRanges(); sel.addRange(saved); } catch (e) {}
    }
    return ok;
  }

  function pressEnter(el) {
    const init = {
      bubbles: true, cancelable: true, key: 'Enter', code: 'Enter',
      keyCode: 13, which: 13, charCode: 13
    };
    el.dispatchEvent(new KeyboardEvent('keydown', init));
    el.dispatchEvent(new KeyboardEvent('keypress', init));
    el.dispatchEvent(new KeyboardEvent('keyup', init));
    const form = el.form || (el.closest && el.closest('form'));
    if (form && el.value !== undefined && el.tagName === 'INPUT') {
      const submit = form.querySelector('button[type="submit"], input[type="submit"]');
      if (submit) submit.click();
    }
  }

  // ========================== 7. ПОДСТАНОВКИ ==========================

  function selectedText(el) {
    if (!el) return '';
    if (el.value !== undefined) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      return typeof start === 'number' && typeof end === 'number' ? el.value.slice(start, end) : '';
    }
    const sel = window.getSelection();
    return sel ? String(sel) : '';
  }

  async function expandPlaceholders(text, el) {
    const now = new Date();
    const sel = selectedText(el);
    let out = String(text).replace(/\{курсор\}/gi, CURSOR);
    let cancelled = false;

    const put = (re, value) => { out = out.replace(re, () => value); };
    put(/\{(?:selection|выделение)\}/gi, sel);
    put(/\{(?:date|дата)\}/gi, now.toLocaleDateString());
    put(/\{(?:time|время)\}/gi, now.toLocaleTimeString());
    put(/\{(?:datetime|дата_время)\}/gi, now.toLocaleString());
    put(/\{(?:url|ссылка)\}/gi, location.href);
    put(/\{(?:title|заголовок)\}/gi, document.title);

    if (/\{(?:clipboard|буфер)\}/i.test(out)) {
      let clip = '';
      try {
        clip = await navigator.clipboard.readText();
      } catch (e) {
        toast('Браузер не дал прочитать буфер обмена — {clipboard} оставлен пустым');
      }
      put(/\{(?:clipboard|буфер)\}/gi, clip);
    }

    out = out.replace(/\{(?:ask|спросить)\s*:\s*([^}]*)\}/gi, (m, question) => {
      const answer = window.prompt(question.trim() || 'Введите значение');
      if (answer === null) { cancelled = true; return ''; }
      return answer;
    });

    return cancelled ? null : out;
  }

  // ========================== 8. ПРИМЕНЕНИЕ АВТООТВЕТА ==========================

  async function applyTemplate(item, target) {
    const el = target || resolveTarget();
    if (!el) {
      toast('Нет активного поля ввода — поставьте курсор в поле и повторите');
      return;
    }
    const text = await expandPlaceholders(item.text, el);
    if (text === null) return;                       // пользователь отменил {ask:...}

    const ok = insertTemplateText(el, text);
    if (!ok) {
      toast('Не удалось вставить текст в это поле');
      return;
    }
    if (item.send) pressEnter(el);
    toast('Вставлено: ' + item.label);
  }

  // ========================== 9. ОБРАБОТКА НАЖАТИЙ ==========================

  document.addEventListener('keydown', (e) => {
    if (e.isComposing || e.repeat) return;                       // IME и автоповтор игнорируем
    if (openOverlay && e.key === 'Escape') {                      // Esc закрывает наши окна из любого фокуса
      e.preventDefault();
      e.stopImmediatePropagation();
      closeOverlay();
      return;
    }
    if (hostEl && e.composedPath && e.composedPath().indexOf(hostEl) !== -1) return; // внутри нашего UI
    if (!e.ctrlKey && !e.altKey && !e.metaKey && !SAFE_ALONE.test(e.code || '')) return;

    const sigs = eventSignatures(e);
    if (!sigs.length) return;

    if (matches(config.settingsHotkey, sigs)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      openSettings();
      return;
    }
    if (matches(config.pickerHotkey, sigs)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      openPicker();
      return;
    }

    const item = templates.find((t) => sigs.indexOf(t.hk.sig) !== -1);
    if (!item) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const target = resolveTarget();
    applyTemplate(item, target);
  }, true);

  const hotkeyCache = new Map();
  function matches(hotkeyStr, sigs) {
    if (!hotkeyStr) return false;
    if (!hotkeyCache.has(hotkeyStr)) {
      const parsed = parseHotkey(hotkeyStr);
      hotkeyCache.set(hotkeyStr, parsed.hk ? parsed.hk.sig : null);
    }
    const sig = hotkeyCache.get(hotkeyStr);
    return !!sig && sigs.indexOf(sig) !== -1;
  }

  // ========================== 10. ИНТЕРФЕЙС ==========================

  let hostEl = null;
  let rootEl = null;

  const CSS = [
    ':host { all: initial; }',
    '* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }',
    '.overlay { position: fixed; inset: 0; display: flex; align-items: flex-start; justify-content: center;',
    '  padding: 8vh 16px 24px; background: rgba(14, 17, 24, .45); font-size: 14px; line-height: 1.45; color: #1b1f27; }',
    '.panel { width: min(720px, 100%); max-height: 82vh; display: flex; flex-direction: column; overflow: hidden;',
    '  background: #fff; border-radius: 12px; box-shadow: 0 20px 60px rgba(0, 0, 0, .38); }',
    '.head { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid #e6e8ee; }',
    '.head h2 { margin: 0; font-size: 15px; font-weight: 600; flex: 1; }',
    '.body { padding: 14px 16px; overflow: auto; }',
    '.foot { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 12px 16px; border-top: 1px solid #e6e8ee; }',
    '.foot .spacer { flex: 1; }',
    'button { padding: 7px 13px; border-radius: 8px; border: 1px solid #ccd1dc; background: #f5f6f9; color: inherit;',
    '  font-size: 13px; cursor: pointer; }',
    'button:hover { background: #eceef4; }',
    'button.primary { background: #2f6df6; border-color: #2f6df6; color: #fff; }',
    'button.primary:hover { background: #275fdd; }',
    'button.icon { padding: 5px 9px; }',
    'textarea, input[type="text"] { width: 100%; padding: 9px 10px; border: 1px solid #ccd1dc; border-radius: 8px;',
    '  background: #fff; color: inherit; font-size: 13px; }',
    'textarea { min-height: 34vh; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }',
    'textarea:focus, input[type="text"]:focus { outline: 2px solid #2f6df6; outline-offset: 1px; border-color: #2f6df6; }',
    'button:focus-visible { outline: 2px solid #2f6df6; outline-offset: 2px; }',
    '.row { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 12px; }',
    '.row label { flex: 1 1 200px; font-size: 12px; color: #5b6273; }',
    '.row label input { margin-top: 4px; }',
    '.check { display: flex; align-items: center; gap: 7px; font-size: 13px; color: inherit; }',
    '.hint { margin: 0 0 10px; font-size: 12px; color: #5b6273; }',
    '.hint code { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; background: #eef0f5;',
    '  padding: 1px 4px; border-radius: 4px; }',
    '.notes { margin: 10px 0 0; padding: 9px 11px; border-radius: 8px; background: #fff5e6; color: #7a4a06;',
    '  font-size: 12px; max-height: 22vh; overflow: auto; }',
    '.notes div + div { margin-top: 4px; }',
    '.list { list-style: none; margin: 0; padding: 0; }',
    '.list li { display: flex; gap: 10px; align-items: flex-start; padding: 9px 10px; border-radius: 8px; cursor: pointer; }',
    '.list li[aria-selected="true"] { background: #eaf0ff; }',
    '.list .num { min-width: 18px; color: #8b92a3; font-size: 12px; padding-top: 2px; }',
    '.list .text { flex: 1; min-width: 0; }',
    '.list .label { font-weight: 600; }',
    '.list .preview { color: #5b6273; font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }',
    'kbd { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; white-space: nowrap;',
    '  border: 1px solid #ccd1dc; border-bottom-width: 2px; border-radius: 6px; padding: 2px 6px; background: #f5f6f9; }',
    '.empty { padding: 18px 4px; color: #5b6273; text-align: center; }',
    '.toast { position: fixed; right: 16px; bottom: 16px; max-width: 320px; padding: 10px 13px; border-radius: 10px;',
    '  background: #1b1f27; color: #fff; font-size: 13px; box-shadow: 0 10px 30px rgba(0, 0, 0, .3); }',
    '@media (prefers-color-scheme: dark) {',
    '  .overlay { color: #e7e9ee; }',
    '  .panel { background: #1e222b; }',
    '  .head, .foot { border-color: #313745; }',
    '  button { background: #2a3040; border-color: #3c4354; }',
    '  button:hover { background: #333b4d; }',
    '  textarea, input[type="text"] { background: #171b22; border-color: #3c4354; color: #e7e9ee; }',
    '  .hint, .row label, .list .preview, .list .num, .empty { color: #a3abbd; }',
    '  .hint code { background: #2a3040; }',
    '  .notes { background: #3a2f16; color: #f0d9a8; }',
    '  .list li[aria-selected="true"] { background: #2b3550; }',
    '  kbd { background: #2a3040; border-color: #3c4354; }',
    '}'
  ].join('\n');

  function ensureRoot() {
    if (rootEl) return rootEl;
    hostEl = document.createElement('div');
    hostEl.style.cssText = 'all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;';
    (document.body || document.documentElement).appendChild(hostEl);
    rootEl = hostEl.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = CSS;
    rootEl.appendChild(style);
    return rootEl;
  }

  let openOverlay = null;

  function closeOverlay() {
    if (openOverlay) {
      openOverlay.remove();
      openOverlay = null;
    }
  }

  function createOverlay() {
    const root = ensureRoot();
    closeOverlay();
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeOverlay(); });
    overlay.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeOverlay(); }
    });
    root.appendChild(overlay);
    openOverlay = overlay;
    return overlay;
  }

  let toastTimer = null;
  function toast(message) {
    if (!config.toasts) return;
    const root = ensureRoot();
    let el = root.querySelector('.toast');
    if (!el) {
      el = document.createElement('div');
      el.className = 'toast';
      root.appendChild(el);
    }
    el.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2600);
  }

  // ---------- Настройки ----------

  function openSettings() {
    const overlay = createOverlay();
    const panel = document.createElement('div');
    panel.className = 'panel';
    overlay.appendChild(panel);

    const head = document.createElement('div');
    head.className = 'head';
    const title = document.createElement('h2');
    title.textContent = 'Автоответы: настройка';
    head.appendChild(title);
    panel.appendChild(head);

    const body = document.createElement('div');
    body.className = 'body';
    const hint = document.createElement('p');
    hint.className = 'hint';
    hint.innerHTML = 'Каждый автоответ — блок <code>[комбинация | название | send]</code> и строки текста под ним. ' +
      'Флаг <code>send</code> нажимает Enter после вставки. Подстановки: <code>{cursor}</code>, ' +
      '<code>{selection}</code>, <code>{clipboard}</code>, <code>{date}</code>, <code>{time}</code>, ' +
      '<code>{datetime}</code>, <code>{url}</code>, <code>{title}</code>, <code>{ask:Вопрос}</code>. ' +
      'Строки с <code>#</code> — комментарии.';
    body.appendChild(hint);

    const area = document.createElement('textarea');
    area.spellcheck = false;
    area.value = config.text;
    body.appendChild(area);

    const row = document.createElement('div');
    row.className = 'row';
    const pickerLabel = document.createElement('label');
    pickerLabel.textContent = 'Комбинация для списка автоответов';
    const pickerInput = document.createElement('input');
    pickerInput.type = 'text';
    pickerInput.value = config.pickerHotkey;
    pickerLabel.appendChild(pickerInput);
    const settingsLabel = document.createElement('label');
    settingsLabel.textContent = 'Комбинация для этого окна';
    const settingsInput = document.createElement('input');
    settingsInput.type = 'text';
    settingsInput.value = config.settingsHotkey;
    settingsLabel.appendChild(settingsInput);
    row.appendChild(pickerLabel);
    row.appendChild(settingsLabel);
    body.appendChild(row);

    const toastRow = document.createElement('label');
    toastRow.className = 'check';
    toastRow.style.marginTop = '12px';
    const toastBox = document.createElement('input');
    toastBox.type = 'checkbox';
    toastBox.checked = !!config.toasts;
    toastRow.appendChild(toastBox);
    toastRow.appendChild(document.createTextNode('Показывать всплывающие подсказки'));
    body.appendChild(toastRow);

    const notes = document.createElement('div');
    notes.className = 'notes';
    notes.hidden = true;
    body.appendChild(notes);
    panel.appendChild(body);

    const foot = document.createElement('div');
    foot.className = 'foot';
    const count = document.createElement('span');
    count.className = 'hint';
    count.style.margin = '0';
    foot.appendChild(count);
    const spacer = document.createElement('span');
    spacer.className = 'spacer';
    foot.appendChild(spacer);

    const resetBtn = document.createElement('button');
    resetBtn.textContent = 'Вернуть примеры';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Отмена';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'primary';
    saveBtn.textContent = 'Сохранить';
    foot.appendChild(resetBtn);
    foot.appendChild(cancelBtn);
    foot.appendChild(saveBtn);
    panel.appendChild(foot);

    const preview = () => {
      const parsed = parseTemplates(area.value);
      count.textContent = 'Автоответов: ' + parsed.items.length;
      notes.hidden = parsed.notes.length === 0;
      notes.textContent = '';
      parsed.notes.forEach((note) => {
        const line = document.createElement('div');
        line.textContent = note;
        notes.appendChild(line);
      });
    };
    area.addEventListener('input', preview);
    preview();

    resetBtn.addEventListener('click', () => { area.value = DEFAULT_TEXT; preview(); });
    cancelBtn.addEventListener('click', closeOverlay);
    saveBtn.addEventListener('click', () => {
      const picker = pickerInput.value.trim();
      const settings = settingsInput.value.trim();
      for (const [value, name] of [[picker, 'списка автоответов'], [settings, 'окна настроек']]) {
        if (value && !parseHotkey(value).hk) {
          toast('Комбинация для ' + name + ' не распознана: ' + value);
          return;
        }
      }
      config = Object.assign({}, config, {
        text: area.value,
        pickerHotkey: picker,
        settingsHotkey: settings,
        toasts: toastBox.checked
      });
      hotkeyCache.clear();
      reloadTemplates();
      const saved = saveConfig(config);
      closeOverlay();
      toast(saved
        ? 'Сохранено, автоответов: ' + templates.length
        : 'Изменения применены, но сохранить их не удалось');
    });

    // Ctrl+Enter в текстовом поле = сохранить
    area.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveBtn.click(); }
    });

    setTimeout(() => {
      area.focus();
      try { area.setSelectionRange(0, 0); } catch (e) {}
      area.scrollTop = 0;                                   // показываем начало списка, а не конец
    }, 0);
  }

  // ---------- Список автоответов ----------

  function openPicker() {
    const target = resolveTarget();
    const overlay = createOverlay();
    const panel = document.createElement('div');
    panel.className = 'panel';
    overlay.appendChild(panel);

    const head = document.createElement('div');
    head.className = 'head';
    const search = document.createElement('input');
    search.type = 'text';
    search.placeholder = 'Поиск автоответа…';
    head.appendChild(search);
    const gear = document.createElement('button');
    gear.className = 'icon';
    gear.title = 'Настроить автоответы';
    gear.textContent = '⚙';
    gear.addEventListener('click', openSettings);
    head.appendChild(gear);
    panel.appendChild(head);

    const body = document.createElement('div');
    body.className = 'body';
    const list = document.createElement('ul');
    list.className = 'list';
    body.appendChild(list);
    panel.appendChild(body);

    const foot = document.createElement('div');
    foot.className = 'foot';
    const tip = document.createElement('span');
    tip.className = 'hint';
    tip.style.margin = '0';
    tip.textContent = '↑↓ — выбор, Enter — вставить, 1…9 — быстрый выбор, Esc — закрыть';
    foot.appendChild(tip);
    panel.appendChild(foot);

    let shown = [];
    let cursor = 0;

    const render = () => {
      const query = search.value.trim().toLowerCase();
      shown = templates.filter((t) => !query ||
        t.label.toLowerCase().includes(query) ||
        t.text.toLowerCase().includes(query) ||
        t.hotkey.toLowerCase().includes(query));
      if (cursor >= shown.length) cursor = Math.max(0, shown.length - 1);
      list.textContent = '';

      if (!shown.length) {
        const empty = document.createElement('li');
        empty.className = 'empty';
        empty.textContent = templates.length
          ? 'Ничего не найдено'
          : 'Автоответов пока нет — откройте настройки и вставьте свои';
        list.appendChild(empty);
        return;
      }

      shown.forEach((item, index) => {
        const li = document.createElement('li');
        li.setAttribute('aria-selected', index === cursor ? 'true' : 'false');
        const num = document.createElement('span');
        num.className = 'num';
        num.textContent = index < 9 ? String(index + 1) : '';
        const text = document.createElement('span');
        text.className = 'text';
        const label = document.createElement('div');
        label.className = 'label';
        label.textContent = item.label + (item.send ? ' ⏎' : '');
        const prev = document.createElement('div');
        prev.className = 'preview';
        prev.textContent = item.text.replace(/\s+/g, ' ').slice(0, 120);
        text.appendChild(label);
        text.appendChild(prev);
        const key = document.createElement('kbd');
        key.textContent = item.hotkey;
        li.appendChild(num);
        li.appendChild(text);
        li.appendChild(key);
        li.addEventListener('mouseenter', () => { cursor = index; markSelection(); });
        li.addEventListener('click', () => choose(index));
        list.appendChild(li);
      });
    };

    const markSelection = () => {
      Array.from(list.children).forEach((li, index) => {
        li.setAttribute('aria-selected', index === cursor ? 'true' : 'false');
      });
    };

    const choose = (index) => {
      const item = shown[index];
      if (!item) return;
      closeOverlay();
      applyTemplate(item, target);
    };

    search.addEventListener('input', () => { cursor = 0; render(); });
    search.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        cursor = shown.length ? (cursor + 1) % shown.length : 0;
        markSelection();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        cursor = shown.length ? (cursor - 1 + shown.length) % shown.length : 0;
        markSelection();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        choose(cursor);
      } else if (!e.ctrlKey && !e.altKey && !e.metaKey && /^[1-9]$/.test(e.key) && !search.value) {
        e.preventDefault();
        choose(Number(e.key) - 1);
      }
    });

    render();
    setTimeout(() => search.focus(), 0);
  }

  // ========================== 11. СТАРТ ==========================

  reloadTemplates();

  if (window.top === window.self && typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Настроить автоответы', openSettings);
    GM_registerMenuCommand('Показать список автоответов', openPicker);
  }
})();
