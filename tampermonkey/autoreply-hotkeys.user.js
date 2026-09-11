// ==UserScript==
// @name         Автоответы по горячим клавишам
// @name:en      Auto-Reply Hotkeys
// @namespace    https://github.com/bumba183/math-lm
// @version      1.1.0
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
    toasts: true,                      // всплывающие подсказки
    fab: true,                         // круглая кнопка на странице
    fabPos: null                       // её положение, если пользователь перетащил
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
            labelRaw: parsed.label,
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

  /** Собирает текст настроек из списка автоответов — обратная операция к parseTemplates. */
  function serializeTemplates(items) {
    const blocks = items.map((item) => {
      const head = ['[' + String(item.hotkey || '').trim()];
      const label = String(item.label || '').replace(/[|\]]/g, ' ').trim();
      if (label) head.push(label);
      if (item.send) head.push('send');
      const body = String(item.text == null ? '' : item.text).replace(/\r\n?/g, '\n')
        .split('\n')
        .map((line) => line.replace(/^(\s*)\[/, '$1\\['))   // строка ответа, начатая с «[», экранируется
        .join('\n');
      return head.join(' | ') + ']\n' + body;
    });
    return blocks.join('\n\n') + (blocks.length ? '\n' : '');
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
    if (openOverlay && e.key === 'Escape' && !capturingHotkey) {  // Esc закрывает наши окна из любого фокуса
      e.preventDefault();
      e.stopImmediatePropagation();
      closeOverlay();
      return;
    }
    if (openOverlay && e.composedPath && e.composedPath().indexOf(openOverlay) !== -1) return; // печатают в нашей панели
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
  let capturingHotkey = false;   // идёт запись комбинации: Esc в это время не закрывает окно

  function h(tag, className, text) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (text != null) el.textContent = text;
    return el;
  }

  const CSS = [
    ':host { all: initial; }',
    '* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }',
    '.overlay { position: fixed; inset: 0; display: flex; align-items: flex-start; justify-content: center;',
    '  padding: 6vh 16px 24px; background: rgba(14, 17, 24, .45); font-size: 14px; line-height: 1.45; color: #1b1f27; }',
    '.panel { width: min(760px, 100%); max-height: 88vh; display: flex; flex-direction: column; overflow: hidden;',
    '  background: #fff; border-radius: 12px; box-shadow: 0 20px 60px rgba(0, 0, 0, .38); }',
    '.head { display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid #e6e8ee; }',
    '.head h2 { margin: 0; font-size: 15px; font-weight: 600; }',
    '.body { padding: 14px 16px; overflow: auto; }',
    '.foot { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 12px 16px; border-top: 1px solid #e6e8ee; }',
    '.spacer { flex: 1; }',
    'button { padding: 7px 13px; border-radius: 8px; border: 1px solid #ccd1dc; background: #f5f6f9; color: inherit;',
    '  font-size: 13px; cursor: pointer; }',
    'button:hover { background: #eceef4; }',
    'button.primary { background: #2f6df6; border-color: #2f6df6; color: #fff; }',
    'button.primary:hover { background: #275fdd; }',
    'button.icon { padding: 5px 9px; }',
    'button.armed { background: #2f6df6; border-color: #2f6df6; color: #fff; }',
    'button:focus-visible { outline: 2px solid #2f6df6; outline-offset: 2px; }',
    'textarea, input[type="text"] { width: 100%; padding: 9px 10px; border: 1px solid #ccd1dc; border-radius: 8px;',
    '  background: #fff; color: inherit; font-size: 13px; }',
    'textarea { min-height: 34vh; resize: vertical; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }',
    'textarea:focus, input[type="text"]:focus { outline: 2px solid #2f6df6; outline-offset: 1px; border-color: #2f6df6; }',
    '.tabs { display: flex; gap: 4px; flex: 1; }',
    '.tab { border-color: transparent; background: transparent; }',
    '.tab[aria-selected="true"] { background: #eaf0ff; border-color: #c7d7ff; color: #2149a8; font-weight: 600; }',
    '.card { border: 1px solid #e6e8ee; border-radius: 10px; padding: 10px; margin-bottom: 10px; }',
    '.card.bad { border-color: #e5a3a3; }',
    '.card-top { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 8px; }',
    '.card-top .hk { width: 148px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }',
    '.card-top .name { flex: 1 1 160px; width: auto; }',
    '.card textarea { min-height: 76px; font-size: 13px; }',
    '.chips { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }',
    '.chip { padding: 2px 8px; border-radius: 999px; font-size: 11px;',
    '  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }',
    '.err { margin-top: 6px; font-size: 12px; color: #b3261e; }',
    '.add { width: 100%; }',
    '.row { display: flex; flex-wrap: wrap; gap: 12px; }',
    '.row label { flex: 1 1 220px; font-size: 12px; color: #5b6273; }',
    '.field { display: flex; gap: 6px; align-items: center; }',
    '.row .field { margin-top: 4px; }',
    '.check { display: flex; align-items: center; gap: 7px; font-size: 13px; color: inherit; margin-top: 14px; }',
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
    'kbd, .chip { border: 1px solid #ccd1dc; background: #f5f6f9; }',
    'kbd { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 11px; white-space: nowrap;',
    '  border-bottom-width: 2px; border-radius: 6px; padding: 2px 6px; }',
    '.empty { padding: 18px 4px; color: #5b6273; text-align: center; }',
    '.toast { position: fixed; right: 16px; bottom: 76px; max-width: 320px; padding: 10px 13px; border-radius: 10px;',
    '  background: #1b1f27; color: #fff; font-size: 13px; box-shadow: 0 10px 30px rgba(0, 0, 0, .3); }',
    '.fab { position: fixed; right: 18px; bottom: 18px; width: 46px; height: 46px; padding: 0; border-radius: 50%;',
    '  border: none; background: #2f6df6; color: #fff; font-size: 20px; line-height: 46px; cursor: pointer;',
    '  box-shadow: 0 6px 18px rgba(0, 0, 0, .28); touch-action: none; user-select: none; }',
    '.fab:hover { background: #275fdd; }',
    '@media (prefers-color-scheme: dark) {',
    '  .overlay { color: #e7e9ee; }',
    '  .panel { background: #1e222b; }',
    '  .head, .foot { border-color: #313745; }',
    '  button { background: #2a3040; border-color: #3c4354; }',
    '  button:hover { background: #333b4d; }',
    '  .tab { background: transparent; border-color: transparent; }',
    '  .tab[aria-selected="true"] { background: #2b3550; border-color: #3f4d73; color: #cfe0ff; }',
    '  textarea, input[type="text"] { background: #171b22; border-color: #3c4354; color: #e7e9ee; }',
    '  .card { border-color: #313745; }',
    '  .card.bad { border-color: #7d4040; }',
    '  .hint, .row label, .list .preview, .list .num, .empty { color: #a3abbd; }',
    '  .hint code { background: #2a3040; }',
    '  .notes { background: #3a2f16; color: #f0d9a8; }',
    '  .list li[aria-selected="true"] { background: #2b3550; }',
    '  kbd, .chip { background: #2a3040; border-color: #3c4354; }',
    '  .err { color: #ff9a90; }',
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
    capturingHotkey = false;
  }

  function createOverlay() {
    const root = ensureRoot();
    closeOverlay();
    const overlay = h('div', 'overlay');
    overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) closeOverlay(); });
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
      el = h('div', 'toast');
      root.appendChild(el);
    }
    el.textContent = message;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.remove(), 2600);
  }

  // ---------- Кнопка на странице ----------

  function placeFab(fab, x, y) {
    const size = 46;
    const maxX = Math.max(6, window.innerWidth - size - 6);
    const maxY = Math.max(6, window.innerHeight - size - 6);
    fab.style.left = Math.min(Math.max(6, x), maxX) + 'px';
    fab.style.top = Math.min(Math.max(6, y), maxY) + 'px';
    fab.style.right = 'auto';
    fab.style.bottom = 'auto';
  }

  function ensureFab() {
    if (window.top !== window.self) return;              // во фреймах кнопку не дублируем
    if (!config.fab) {
      const existing = rootEl && rootEl.querySelector('.fab');
      if (existing) existing.remove();
      return;
    }
    const root = ensureRoot();
    let fab = root.querySelector('.fab');
    if (!fab) {
      fab = h('button', 'fab', '💬');
      root.appendChild(fab);

      let drag = null;
      fab.addEventListener('pointerdown', (e) => {
        const rect = fab.getBoundingClientRect();
        drag = { x: e.clientX, y: e.clientY, left: rect.left, top: rect.top, moved: false };
        try { fab.setPointerCapture(e.pointerId); } catch (err) {}
      });
      fab.addEventListener('pointermove', (e) => {
        if (!drag) return;
        const dx = e.clientX - drag.x;
        const dy = e.clientY - drag.y;
        if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 5) return;
        drag.moved = true;
        placeFab(fab, drag.left + dx, drag.top + dy);
      });
      fab.addEventListener('pointerup', (e) => {
        if (!drag) return;
        const moved = drag.moved;
        drag = null;
        try { fab.releasePointerCapture(e.pointerId); } catch (err) {}
        if (!moved) { openPicker(); return; }
        const rect = fab.getBoundingClientRect();
        config.fabPos = { x: Math.round(rect.left), y: Math.round(rect.top) };
        saveConfig(config);
      });
      fab.addEventListener('pointercancel', () => { drag = null; });
      fab.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
      fab.addEventListener('mousedown', (e) => e.preventDefault());   // фокус остаётся в поле ввода страницы
      window.addEventListener('resize', () => {
        if (config.fab && config.fabPos) placeFab(fab, config.fabPos.x, config.fabPos.y);
      });
    }
    fab.title = 'Автоответы' + (config.pickerHotkey ? ' (' + config.pickerHotkey + ')' : '');
    if (config.fabPos) placeFab(fab, config.fabPos.x, config.fabPos.y);
  }

  // ---------- Запись комбинации с клавиатуры ----------

  function attachCapture(input, button) {
    const disarm = () => {
      capturingHotkey = false;
      button.classList.remove('armed');
      button.textContent = '⌨';
    };
    button.textContent = '⌨';
    button.title = 'Нажать комбинацию';
    button.addEventListener('click', () => {
      if (button.classList.contains('armed')) { disarm(); return; }
      capturingHotkey = true;
      button.classList.add('armed');
      button.textContent = '…';
      input.focus();
    });
    input.addEventListener('keydown', (e) => {
      if (!button.classList.contains('armed')) return;
      e.preventDefault();
      e.stopPropagation();
      const code = e.code || '';
      if (!code || /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/.test(code)) return;   // ждём основную клавишу
      if (code === 'Escape') { disarm(); return; }
      const parts = [];
      if (e.ctrlKey) parts.push('Ctrl');
      if (e.altKey) parts.push('Alt');
      if (e.shiftKey) parts.push('Shift');
      if (e.metaKey) parts.push('Cmd');
      parts.push(prettyCode(code));
      input.value = parts.join('+');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      disarm();
    });
    input.addEventListener('blur', disarm);
  }

  function hotkeyField(value, onChange) {
    const wrap = h('span', 'field');
    const input = h('input', 'hk');
    input.type = 'text';
    input.value = value || '';
    input.placeholder = 'Ctrl+Alt+1';
    const rec = h('button', 'icon');
    attachCapture(input, rec);
    input.addEventListener('input', () => onChange(input.value));
    wrap.append(input, rec);
    return { wrap: wrap, input: input };
  }

  // ---------- Настройки ----------

  const PLACEHOLDERS = ['{cursor}', '{selection}', '{clipboard}', '{date}', '{time}', '{url}', '{title}', '{ask:Вопрос}'];

  function openSettings() {
    const overlay = createOverlay();
    const panel = h('div', 'panel');
    overlay.appendChild(panel);

    // рабочая копия: изменения применяются только по «Сохранить»
    const draft = parseTemplates(config.text).items.map((item) => ({
      hotkey: item.hotkey, label: item.labelRaw, text: item.text, send: item.send
    }));
    const opts = {
      pickerHotkey: config.pickerHotkey,
      settingsHotkey: config.settingsHotkey,
      toasts: !!config.toasts,
      fab: !!config.fab
    };

    const head = h('div', 'head');
    const tabs = h('div', 'tabs');
    const tabList = h('button', 'tab', 'Автоответы');
    const tabText = h('button', 'tab', 'Текстом');
    const tabOpts = h('button', 'tab', 'Настройки');
    tabs.append(tabList, tabText, tabOpts);
    head.append(tabs);
    panel.appendChild(head);

    const body = h('div', 'body');
    panel.appendChild(body);

    const foot = h('div', 'foot');
    const count = h('span', 'hint');
    count.style.margin = '0';
    const resetBtn = h('button', null, 'Вернуть примеры');
    const cancelBtn = h('button', null, 'Отмена');
    const saveBtn = h('button', 'primary', 'Сохранить');
    foot.append(count, h('span', 'spacer'), resetBtn, cancelBtn, saveBtn);
    panel.appendChild(foot);

    let active = 'list';
    let rawArea = null;
    let cards = [];

    /** Ошибки по каждому автоответу: разбор комбинации, дубликаты, пустой текст. */
    const validate = () => {
      const seen = new Map();
      return draft.map((item, index) => {
        const parsed = parseHotkey(item.hotkey || '');
        if (!parsed.hk) return 'Комбинация: ' + (parsed.error || 'не распознана');
        if (seen.has(parsed.hk.sig)) return 'Эта комбинация уже занята автоответом №' + (seen.get(parsed.hk.sig) + 1);
        seen.set(parsed.hk.sig, index);
        if (!String(item.text || '').trim()) return 'Пустой текст — автоответ не сохранится';
        return '';
      });
    };

    const refresh = () => {
      const errors = validate();
      const bad = errors.filter(Boolean).length;
      count.textContent = 'Автоответов: ' + draft.length + (bad ? ', с ошибками: ' + bad : '');
      cards.forEach((card, index) => {
        card.err.textContent = errors[index] || '';
        card.el.classList.toggle('bad', !!errors[index]);
      });
    };

    const syncFromRaw = () => {
      if (active !== 'text' || !rawArea) return;
      const parsed = parseTemplates(rawArea.value).items;
      draft.length = 0;
      parsed.forEach((item) => draft.push({
        hotkey: item.hotkey, label: item.labelRaw, text: item.text, send: item.send
      }));
    };

    const show = (next) => {
      syncFromRaw();
      active = next;
      render();
    };

    function renderCard(item, index) {
      const el = h('div', 'card');
      const top = h('div', 'card-top');

      const hk = hotkeyField(item.hotkey, (value) => { item.hotkey = value; refresh(); });
      const name = h('input', 'name');
      name.type = 'text';
      name.value = item.label || '';
      name.placeholder = 'Название (необязательно)';
      name.addEventListener('input', () => { item.label = name.value; });

      const sendLabel = h('label', 'check');
      sendLabel.style.marginTop = '0';
      sendLabel.title = 'Нажать Enter сразу после вставки';
      const sendBox = h('input');
      sendBox.type = 'checkbox';
      sendBox.checked = !!item.send;
      sendBox.addEventListener('change', () => { item.send = sendBox.checked; });
      sendLabel.append(sendBox, document.createTextNode('Enter'));

      const up = h('button', 'icon up', '↑');
      up.title = 'Выше';
      up.addEventListener('click', () => {
        if (index === 0) return;
        draft.splice(index - 1, 0, draft.splice(index, 1)[0]);
        render();
      });
      const down = h('button', 'icon down', '↓');
      down.title = 'Ниже';
      down.addEventListener('click', () => {
        if (index === draft.length - 1) return;
        draft.splice(index + 1, 0, draft.splice(index, 1)[0]);
        render();
      });
      const del = h('button', 'icon del', '✕');
      del.title = 'Удалить';
      del.addEventListener('click', () => {
        draft.splice(index, 1);
        render();
      });

      top.append(hk.wrap, name, sendLabel, h('span', 'spacer'), up, down, del);

      const area = h('textarea');
      area.value = item.text || '';
      area.placeholder = 'Текст автоответа';
      area.spellcheck = false;
      area.addEventListener('input', () => { item.text = area.value; refresh(); });

      const chips = h('div', 'chips');
      PLACEHOLDERS.forEach((token) => {
        const chip = h('button', 'chip', token);
        chip.title = 'Вставить в текст';
        chip.addEventListener('click', () => {
          const start = typeof area.selectionStart === 'number' ? area.selectionStart : area.value.length;
          const end = typeof area.selectionEnd === 'number' ? area.selectionEnd : start;
          area.value = area.value.slice(0, start) + token + area.value.slice(end);
          item.text = area.value;
          area.focus();
          const pos = start + token.length;
          try { area.setSelectionRange(pos, pos); } catch (e) {}
          refresh();
        });
        chips.appendChild(chip);
      });

      const err = h('div', 'err');
      el.append(top, area, chips, err);
      cards.push({ el: el, err: err, hotkey: hk.input, text: area });
      return el;
    }

    function renderList() {
      cards = [];
      const hint = h('p', 'hint');
      hint.textContent = 'Комбинацию можно вписать руками или нажать ⌨ и нажать нужные клавиши. ' +
        'Enter — отправлять сообщение сразу после вставки. Плашки под текстом вставляют подстановки.';
      body.appendChild(hint);

      if (!draft.length) {
        body.appendChild(h('div', 'empty', 'Автоответов пока нет — добавьте первый.'));
      }
      draft.forEach((item, index) => body.appendChild(renderCard(item, index)));

      const add = h('button', 'add', '+ Добавить автоответ');
      add.addEventListener('click', () => {
        draft.push({ hotkey: '', label: '', text: '', send: false });
        render();
        const last = cards[cards.length - 1];
        if (last) last.hotkey.focus();
      });
      body.appendChild(add);
      refresh();
    }

    function renderText() {
      cards = [];
      const hint = h('p', 'hint');
      hint.innerHTML = 'Тот же список текстом — удобно скопировать целиком или вставить готовый набор. ' +
        'Блок: <code>[комбинация | название | send]</code>, ниже — строки ответа. ' +
        'Строки с <code>#</code> — комментарии.';
      body.appendChild(hint);

      rawArea = h('textarea');
      rawArea.spellcheck = false;
      rawArea.value = serializeTemplates(draft);
      body.appendChild(rawArea);

      const notes = h('div', 'notes');
      notes.hidden = true;
      body.appendChild(notes);

      const check = () => {
        const parsed = parseTemplates(rawArea.value);
        count.textContent = 'Автоответов: ' + parsed.items.length;
        notes.hidden = parsed.notes.length === 0;
        notes.textContent = '';
        parsed.notes.forEach((note) => notes.appendChild(h('div', null, note)));
      };
      rawArea.addEventListener('input', check);
      check();
      setTimeout(() => {
        rawArea.focus();
        try { rawArea.setSelectionRange(0, 0); } catch (e) {}
        rawArea.scrollTop = 0;
      }, 0);
    }

    function renderOpts() {
      cards = [];
      const row = h('div', 'row');

      const pickerLabel = h('label', null, 'Комбинация для списка автоответов');
      const picker = hotkeyField(opts.pickerHotkey, (value) => { opts.pickerHotkey = value; });
      pickerLabel.appendChild(picker.wrap);

      const settingsLabel = h('label', null, 'Комбинация для этого окна');
      const settings = hotkeyField(opts.settingsHotkey, (value) => { opts.settingsHotkey = value; });
      settingsLabel.appendChild(settings.wrap);

      row.append(pickerLabel, settingsLabel);
      body.appendChild(row);

      const fabLabel = h('label', 'check');
      const fabBox = h('input');
      fabBox.type = 'checkbox';
      fabBox.checked = opts.fab;
      fabBox.addEventListener('change', () => { opts.fab = fabBox.checked; });
      fabLabel.append(fabBox, document.createTextNode('Показывать кнопку 💬 на странице (её можно перетащить)'));
      body.appendChild(fabLabel);

      const toastLabel = h('label', 'check');
      const toastBox = h('input');
      toastBox.type = 'checkbox';
      toastBox.checked = opts.toasts;
      toastBox.addEventListener('change', () => { opts.toasts = toastBox.checked; });
      toastLabel.append(toastBox, document.createTextNode('Показывать всплывающие подсказки'));
      body.appendChild(toastLabel);

      const note = h('p', 'hint');
      note.style.margin = '16px 0 0';
      note.textContent = 'Автоответы хранятся в Tampermonkey. Чтобы перенести их в другой браузер, ' +
        'скопируйте содержимое вкладки «Текстом».';
      body.appendChild(note);
      refresh();
    }

    function render() {
      body.textContent = '';
      tabList.setAttribute('aria-selected', String(active === 'list'));
      tabText.setAttribute('aria-selected', String(active === 'text'));
      tabOpts.setAttribute('aria-selected', String(active === 'opts'));
      if (active === 'list') renderList();
      else if (active === 'text') renderText();
      else renderOpts();
    }

    panel.addEventListener('keydown', (e) => {                 // Ctrl+Enter — сохранить
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveBtn.click(); }
    });

    tabList.addEventListener('click', () => show('list'));
    tabText.addEventListener('click', () => show('text'));
    tabOpts.addEventListener('click', () => show('opts'));

    resetBtn.addEventListener('click', () => {
      draft.length = 0;
      parseTemplates(DEFAULT_TEXT).items.forEach((item) => draft.push({
        hotkey: item.hotkey, label: item.labelRaw, text: item.text, send: item.send
      }));
      if (active === 'opts') active = 'list';
      render();
    });

    cancelBtn.addEventListener('click', closeOverlay);

    saveBtn.addEventListener('click', () => {
      syncFromRaw();
      const picker = String(opts.pickerHotkey || '').trim();
      const settings = String(opts.settingsHotkey || '').trim();
      for (const pair of [[picker, 'списка автоответов'], [settings, 'окна настроек']]) {
        if (pair[0] && !parseHotkey(pair[0]).hk) {
          toast('Комбинация для ' + pair[1] + ' не распознана: ' + pair[0]);
          show('opts');
          return;
        }
      }

      config = Object.assign({}, config, {
        text: serializeTemplates(draft),
        pickerHotkey: picker,
        settingsHotkey: settings,
        toasts: opts.toasts,
        fab: opts.fab
      });
      hotkeyCache.clear();
      reloadTemplates();
      const saved = saveConfig(config);
      closeOverlay();
      ensureFab();

      const skipped = draft.length - templates.length;
      let message = saved ? 'Сохранено, автоответов: ' + templates.length
                          : 'Применено, но сохранить не удалось';
      if (skipped > 0) message += '. Не работают: ' + skipped + ' — проверьте комбинации';
      toast(message);
    });

    render();
  }

  // ---------- Список автоответов ----------

  function openPicker() {
    const target = resolveTarget();
    const overlay = createOverlay();
    const panel = h('div', 'panel');
    overlay.appendChild(panel);

    const head = h('div', 'head');
    const search = h('input');
    search.type = 'text';
    search.placeholder = 'Поиск автоответа…';
    const gear = h('button', 'icon', '⚙');
    gear.title = 'Настроить автоответы';
    gear.addEventListener('click', openSettings);
    head.append(search, gear);
    panel.appendChild(head);

    const body = h('div', 'body');
    const list = h('ul', 'list');
    body.appendChild(list);
    panel.appendChild(body);

    const foot = h('div', 'foot');
    const tip = h('span', 'hint', '↑↓ — выбор, Enter — вставить, 1…9 — быстрый выбор, Esc — закрыть');
    tip.style.margin = '0';
    foot.appendChild(tip);
    panel.appendChild(foot);

    let shown = [];
    let cursor = 0;

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

    const render = () => {
      const query = search.value.trim().toLowerCase();
      shown = templates.filter((t) => !query ||
        t.label.toLowerCase().includes(query) ||
        t.text.toLowerCase().includes(query) ||
        t.hotkey.toLowerCase().includes(query));
      if (cursor >= shown.length) cursor = Math.max(0, shown.length - 1);
      list.textContent = '';

      if (!shown.length) {
        const empty = h('li', 'empty', templates.length
          ? 'Ничего не найдено'
          : 'Автоответов пока нет — нажмите ⚙ и добавьте первый');
        list.appendChild(empty);
        return;
      }

      shown.forEach((item, index) => {
        const li = h('li');
        li.setAttribute('aria-selected', index === cursor ? 'true' : 'false');
        const num = h('span', 'num', index < 9 ? String(index + 1) : '');
        const text = h('span', 'text');
        text.append(
          h('div', 'label', item.label + (item.send ? ' ⏎' : '')),
          h('div', 'preview', item.text.replace(/\s+/g, ' ').slice(0, 120))
        );
        li.append(num, text, h('kbd', null, item.hotkey));
        li.addEventListener('mouseenter', () => { cursor = index; markSelection(); });
        li.addEventListener('click', () => choose(index));
        list.appendChild(li);
      });
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
  ensureFab();

  if (window.top === window.self && typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Настроить автоответы', openSettings);
    GM_registerMenuCommand('Показать список автоответов', openPicker);
  }
})();
