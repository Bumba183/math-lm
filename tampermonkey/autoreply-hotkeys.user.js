// ==UserScript==
// @name         Автоответы по горячим клавишам
// @name:en      Auto-Reply Hotkeys
// @namespace    https://github.com/bumba183/math-lm
// @version      1.8.0
// @description  Автоответы по триггеру или горячим клавишам, боковая панель со сведениями о заказе и статистикой покупателя, плюс помощник на модели: черновик ответа, вердикт по сроку, риск покупателя, разбор данных, резюме и вычитка.
// @description:en  Insert canned replies into the focused input field with a text trigger or a hotkey.
// @author       -
// @license      MIT
// @match        *://*/*
// @run-at       document-end
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_registerMenuCommand
// @grant        GM_xmlhttpRequest
// @connect      api.aitunnel.ru
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
    '# Формат: [триггер, комбинация | название | send]',
    '# Триггер — текст, который вы печатаете прямо в поле: напечатали !1 — он заменился ответом.',
    '# Комбинация — горячие клавиши. Можно задать только одно из двух.',
    '# Строки ниже заголовка — текст автоответа (можно несколько строк).',
    '# Флаг send = вставить и сразу нажать Enter (работает не на всех сайтах).',
    '# Подстановки: {cursor} {selection} {clipboard} {date} {time} {datetime} {url} {title} {ask:Вопрос}',
    '',
    '[!1, Ctrl+Alt+1 | Приветствие]',
    'Здравствуйте! Спасибо за обращение — уже смотрю ваш вопрос.',
    '',
    '[!2, Ctrl+Alt+2 | Просьба подождать]',
    'Одну минуту, уточняю информацию и вернусь с ответом.',
    '',
    '[!3, Ctrl+Alt+3 | Готово]',
    'Готово ✅',
    'Если появятся вопросы — напишите, я на связи.',
    '',
    '[!имя, Ctrl+Alt+4 | Знакомство]',
    'Добрый день! Меня зовут {ask:Как вас представить?}, я помогу с вашим вопросом.',
    '{cursor}',
    '',
    '[!дата, Ctrl+Alt+5 | Дата и ссылка]',
    'Актуально на {date} {time}. Страница: {url}'
  ].join('\n');

  // Панель со сведениями о заказе: включается и настраивается на конкретный сайт
  const DEFAULT_PANEL = {
    enabled: true,
    collapsed: false,
    title: 'Данные заказа',
    site: 'ieq37.com/*',               // маски адресов, по одной в строке; пусто — панель не показывается
    limitDays: 7,                      // сколько дней товар считается свежим
    hideEmpty: true,                   // не показывать строки, для которых на странице нет данных
    packs: { url: '~/product-packing/list/', column: 'Товар', selector: '', values: [], counted: [] },
    fields: [
      // Блок «О покупателе» на странице тикета — читается по подписям
      { label: 'Покупатель', source: 'label', query: 'Покупатель', selector: '', attr: '', regex: '', mode: 'text' },
      { label: 'Заказов всего', source: 'label', query: 'Заказов всего', selector: '', attr: '', regex: '', mode: 'text' },
      { label: 'Сумма заказов', source: 'label', query: 'Общая сумма заказов', selector: '', attr: '', regex: '', mode: 'text' },
      { label: 'За 30 дней', source: 'label', query: 'Заказы за последние 30 дней', selector: '', attr: '', regex: '', mode: 'text' },
      { label: 'Средний чек', source: 'label', query: 'Средний чек', selector: '', attr: '', regex: '', mode: 'text' },
      { label: 'Тикетов всего', source: 'label', query: 'Кол-во тикетов всего', selector: '', attr: '', regex: '', mode: 'text' },

      // Страница заказа: не вышел ли срок годности
      { label: 'Дата загрузки', source: 'label', query: 'Дата загрузки', selector: '', attr: '', regex: '', mode: 'text' },
      { label: 'Дата покупки', source: 'label', query: 'Дата создания заказа', selector: '', attr: '', regex: '', mode: 'text' },
      { label: 'Пролежал до покупки', source: 'between', from: 'Дата загрузки', to: 'Дата покупки' },

      // Полные списки покупателя: «Покупатель» → его страница → «Подробнее»
      { label: 'Заказов в списке', source: 'count', table: '*', column: '', value: '', exclude: false,
        linkSelector: 'Покупатель -> Подробнее', pages: 5, rowSelector: '', whereSelector: '', whereText: '',
        usePacks: false },
      { label: 'Тикетов в списке', source: 'count', table: '*', column: '', value: '', exclude: false,
        linkSelector: 'Покупатель -> Подробнее#2', pages: 5, rowSelector: '', whereSelector: '', whereText: '',
        usePacks: false },
      { label: 'Тикетов по проблемным фасовкам', source: 'count', table: '*', column: '', value: '', exclude: false,
        linkSelector: 'Покупатель -> Подробнее#2', pages: 5, rowSelector: '', whereSelector: '', whereText: '',
        usePacks: true },
      { label: 'Доля проблемных', source: 'ratio', from: 'Тикетов по проблемным фасовкам', to: 'Заказов в списке' }
    ]
  };

  // Подключение модели (по умолчанию AiTunnel, подойдёт любой OpenAI-совместимый шлюз)
  const DEFAULT_AI = {
    enabled: false,
    base: 'https://api.aitunnel.ru/v1',
    key: '',
    model: 'gpt-5-6-luna-pro',
    temperature: 0.3,
    maxTokens: 900,
    contextLimit: 6000,
    chatSelector: '',
    tone: 'Вежливо, по-деловому, на «вы», без канцелярита и лишних извинений.'
  };

  const DEFAULT_CONFIG = {
    text: DEFAULT_TEXT,
    pickerHotkey: 'Ctrl+Alt+Space',    // палитра со списком всех автоответов
    settingsHotkey: 'Ctrl+Alt+0',      // окно настроек
    toasts: true,                      // всплывающие подсказки
    fab: true,                         // круглая кнопка на странице
    fabPos: null,                      // её положение, если пользователь перетащил
    panel: DEFAULT_PANEL,              // панель со сведениями о заказе
    ai: DEFAULT_AI                     // помощник на базе модели
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
        if (parsed.ok) {
          flush();
          current = {
            hk: parsed.hk,
            hotkey: parsed.hk ? parsed.hk.display : '',
            trigger: parsed.trigger,
            label: parsed.label || parsed.trigger || (parsed.hk ? parsed.hk.display : ''),
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

    // Дубликаты: занятый активатор отключается, остальное у блока продолжает работать
    const seenKeys = new Map();
    const seenTriggers = new Map();
    const result = [];
    for (const item of items) {
      if (item.hk && seenKeys.has(item.hk.sig)) {
        notes.push('Комбинация ' + item.hotkey + ' уже занята автоответом «' +
          seenKeys.get(item.hk.sig).label + '» — в строке ' + item.line + ' она не работает.');
        item.hk = null;
        item.hotkey = '';
      }
      if (item.trigger && seenTriggers.has(item.trigger.toLowerCase())) {
        notes.push('Триггер ' + item.trigger + ' уже занят автоответом «' +
          seenTriggers.get(item.trigger.toLowerCase()).label + '» — в строке ' + item.line + ' он не работает.');
        item.trigger = '';
      }
      if (!item.hk && !item.trigger) {
        notes.push('У блока в строке ' + item.line + ' не осталось ни триггера, ни комбинации — он пропущен.');
        continue;
      }
      if (item.hk) seenKeys.set(item.hk.sig, item);
      if (item.trigger) seenTriggers.set(item.trigger.toLowerCase(), item);
      result.push(item);
    }

    // Более короткий триггер срабатывает раньше, чем успеешь дописать длинный
    result.forEach((item) => {
      if (!item.trigger) return;
      const shorter = result.find((other) => other !== item && other.trigger &&
        other.trigger.length < item.trigger.length &&
        item.trigger.toLowerCase().startsWith(other.trigger.toLowerCase()));
      if (shorter) {
        notes.push('Триггер ' + item.trigger + ' не сработает: ' + shorter.trigger +
          ' короче и срабатывает раньше.');
      }
    });

    return { items: result, notes: notes };
  }

  const MAX_TRIGGER = 32;
  const LOOKS_LIKE_HOTKEY = /^(ctrl|control|ctl|alt|option|opt|shift|cmd|command|meta|win|super|ктрл|контрол|альт|шифт|мета)\s*\+/i;

  /** Проверяет текст-триггер вроде «!1». Возвращает ошибку или пустую строку. */
  function triggerError(trigger) {
    if (/[,|[\]{}]/.test(trigger)) return 'в триггере нельзя использовать « , » « | » и скобки';
    if (/\s/.test(trigger)) return 'в триггере нельзя использовать пробелы';
    if (trigger.length < 2) return 'триггер короче двух символов срабатывал бы слишком часто';
    if (trigger.length > MAX_TRIGGER) return 'триггер длиннее ' + MAX_TRIGGER + ' символов';
    return '';
  }

  /**
   * Заголовок блока: [триггер, комбинация | название | send].
   * Активаторы перечисляются через запятую, порядок не важен; можно указать
   * только один из них. Явные префиксы text: и key: снимают любую неоднозначность.
   */
  function parseHeader(inner) {
    const parts = String(inner).split('|').map((s) => s.trim());
    const activators = (parts.shift() || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!activators.length) return { error: 'не указан ни текст-триггер, ни комбинация' };

    let hk = null;
    let trigger = '';
    for (const activator of activators) {
      const asText = /^text\s*:/i.test(activator);
      const asKey = /^key\s*:/i.test(activator);
      const value = activator.replace(/^(text|key)\s*:\s*/i, '');

      if (asText || (!asKey && !LOOKS_LIKE_HOTKEY.test(value) && !parseHotkey(value).hk)) {
        const error = triggerError(value);
        if (error) return { error: 'триггер «' + value + '»: ' + error };
        if (!trigger) trigger = value;
        continue;
      }
      const parsed = parseHotkey(value);
      if (!parsed.hk) return { error: parsed.error };
      if (!hk) hk = parsed.hk;
    }

    let label = '';
    let send = false;
    for (const part of parts) {
      if (!part) continue;
      const low = part.toLowerCase();
      if (low === 'send' || low === 'отправить' || low === 'enter') { send = true; continue; }
      label = part.replace(/^name\s*[=:]\s*/i, '');
    }
    return { ok: true, hk: hk, trigger: trigger, label: label, send: send };
  }

  /** Собирает текст настроек из списка автоответов — обратная операция к parseTemplates. */
  function serializeTemplates(items) {
    const blocks = items.map((item) => {
      const activators = [String(item.trigger || '').trim(), String(item.hotkey || '').trim()].filter(Boolean);
      const head = ['[' + activators.join(', ')];
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
    if (rootEl && el.getRootNode && el.getRootNode() === rootEl) return false;   // поля нашей панели не считаются
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

  async function expandPlaceholders(text, el, selectionOverride) {
    const now = new Date();
    const sel = selectionOverride == null ? selectedText(el) : selectionOverride;
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

  async function applyTemplate(item, target, options) {
    const el = target || resolveTarget();
    if (!el) {
      toast('Нет активного поля ввода — поставьте курсор в поле и повторите');
      return;
    }
    const text = await expandPlaceholders(item.text, el, options && options.selectionText);
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

    const item = templates.find((t) => t.hk && sigs.indexOf(t.hk.sig) !== -1);
    if (!item) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const target = resolveTarget();
    applyTemplate(item, target);
  }, true);

  // ---------- Текст-триггеры: напечатали «!1» — он превратился в автоответ ----------

  let expanding = false;   // защита от повторного срабатывания на собственной вставке

  document.addEventListener('input', (e) => {
    if (expanding || e.isComposing) return;
    const el = (e.composedPath && e.composedPath()[0]) || e.target;
    if (!isEditable(el)) return;
    const tail = textBeforeCaret(el);
    if (!tail) return;
    const item = findTrigger(tail);
    if (item) expandTrigger(el, item);
  }, true);

  /** Текст непосредственно перед курсором — в нём ищем триггер. */
  function textBeforeCaret(el) {
    if (el.value !== undefined) {
      const start = el.selectionStart;
      if (typeof start !== 'number' || el.selectionEnd !== start) return '';
      return el.value.slice(Math.max(0, start - MAX_TRIGGER), start);
    }
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || !sel.anchorNode || sel.anchorNode.nodeType !== 3) return '';
    return sel.anchorNode.textContent.slice(Math.max(0, sel.anchorOffset - MAX_TRIGGER), sel.anchorOffset);
  }

  const WORD_CHAR = /[0-9A-Za-zА-Яа-яЁё_]/;

  /** Самый длинный триггер, которым заканчивается набранный текст. */
  function findTrigger(tail) {
    const lower = tail.toLowerCase();
    let best = null;
    for (const item of templates) {
      if (!item.trigger) continue;
      const trigger = item.trigger.toLowerCase();
      if (lower.length < trigger.length || lower.slice(-trigger.length) !== trigger) continue;
      if (WORD_CHAR.test(item.trigger[0])) {
        // Триггер из букв или цифр срабатывает только с начала слова, а не внутри него
        const before = tail.slice(0, tail.length - trigger.length).slice(-1);
        if (before && WORD_CHAR.test(before)) continue;
      }
      if (!best || item.trigger.length > best.trigger.length) best = item;
    }
    return best;
  }

  /** Выделяет напечатанный триггер и заменяет его текстом автоответа. */
  function expandTrigger(el, item) {
    const length = item.trigger.length;
    if (el.value !== undefined) {
      const end = el.selectionStart;
      if (end < length) return;
      try { el.setSelectionRange(end - length, end); } catch (err) { return; }
    } else {
      const sel = window.getSelection();
      if (!sel || !sel.anchorNode || sel.anchorOffset < length) return;
      const range = document.createRange();
      try {
        range.setStart(sel.anchorNode, sel.anchorOffset - length);
        range.setEnd(sel.anchorNode, sel.anchorOffset);
      } catch (err) { return; }
      sel.removeAllRanges();
      sel.addRange(range);
    }
    expanding = true;
    const done = () => { expanding = false; };
    Promise.resolve(applyTemplate(item, el, { selectionText: '' })).then(done, done);
  }

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
    '.card-top .trg, .card-top .hk { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }',
    '.card-top .trg { width: 92px; }',
    '.card-top .hk { width: 146px; }',
    '.card-top .name { flex: 1 1 130px; width: auto; }',
    '.list .keys { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; justify-content: flex-end; }',
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
    '.side { position: fixed; right: 0; top: 90px; width: 266px; max-height: 72vh; display: flex; flex-direction: column;',
    '  background: #fff; color: #1b1f27; border: 1px solid #e6e8ee; border-right: none; border-radius: 10px 0 0 10px;',
    '  box-shadow: -6px 8px 24px rgba(0, 0, 0, .16); font-size: 13px; overflow: hidden; }',
    '.side.folded { width: auto; }',
    '.side.folded .side-body { display: none; }',
    '.side-head { display: flex; align-items: center; gap: 4px; padding: 8px 10px; border-bottom: 1px solid #e6e8ee; }',
    '.side-head .icon { padding: 2px 7px; font-size: 12px; }',
    '.side-body { overflow: auto; padding: 6px; }',
    '.ai-row { display: flex; flex-wrap: wrap; gap: 4px; padding: 6px 8px; border-bottom: 1px solid #e6e8ee; }',
    '.ai-row .icon { font-size: 14px; padding: 3px 8px; }',
    '.side-row { display: flex; gap: 8px; padding: 5px 6px; border-radius: 7px; }',
    '.side-row:hover { background: #f2f4f9; }',
    '.side-label { flex: 0 0 44%; color: #5b6273; }',
    '.side-value { flex: 1; font-weight: 600; word-break: break-word; }',
    '.side-dim { font-weight: 400; color: #9aa1b1; }',
    '.side-alarm { background: #fdeaea; }',
    '.side-alarm .side-value { color: #b3261e; }',
    '.side-empty { padding: 10px 6px; color: #5b6273; }',
    '.pick-box { position: fixed; pointer-events: none; border: 2px solid #2f6df6; border-radius: 4px;',
    '  background: rgba(47, 109, 246, .12); }',
    '.pick-bar { position: fixed; left: 50%; top: 14px; transform: translateX(-50%); padding: 8px 14px;',
    '  border-radius: 999px; background: #1b1f27; color: #fff; font-size: 13px; }',
    '.pfield { border: 1px solid #e6e8ee; border-radius: 10px; padding: 9px; margin-bottom: 9px; }',
    '.pfield .line { display: flex; flex-wrap: wrap; gap: 7px; align-items: center; margin-bottom: 7px; }',
    '.pfield .line:last-child { margin-bottom: 0; }',
    '.line input[type="text"] { width: auto; flex: 1 1 150px; }',
    'select { padding: 6px 8px; border-radius: 8px; border: 1px solid #ccd1dc; background: #f5f6f9;',
    '  color: inherit; font-size: 13px; }',
    'textarea.small { min-height: 66px; }',
    'input.num { width: 78px; flex: 0 0 auto; }',
    '.pval { font-size: 12px; color: #5b6273; }',
    '.pnow { flex: 1 1 100%; }',
    '@media (prefers-color-scheme: dark) {',
    '  .side { background: #1e222b; color: #e7e9ee; border-color: #313745; }',
    '  .side-head, .ai-row { border-color: #313745; }',
    '  .side-row:hover { background: #262c38; }',
    '  .side-label, .side-empty { color: #a3abbd; }',
    '  .side-dim { color: #6f7891; }',
    '  .side-alarm { background: rgba(122, 48, 48, .4); }',
    '  .side-alarm .side-value { color: #ff9a90; }',
    '  .pfield { border-color: #313745; }',
    '  select { background: #2a3040; border-color: #3c4354; }',
    '  .pval { color: #a3abbd; }',
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

  function openSettings(initialTab) {
    const overlay = createOverlay();
    const panel = h('div', 'panel');
    overlay.appendChild(panel);

    // рабочая копия: изменения применяются только по «Сохранить»
    const draft = parseTemplates(config.text).items.map((item) => ({
      hotkey: item.hotkey, trigger: item.trigger, label: item.labelRaw, text: item.text, send: item.send
    }));
    const side = JSON.parse(JSON.stringify(Object.assign({}, DEFAULT_PANEL, config.panel || {})));
    const ai = Object.assign({}, DEFAULT_AI, config.ai || {});
    if (!Array.isArray(side.fields)) side.fields = [];
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
    const tabPanel = h('button', 'tab', 'Панель');
    const tabAi = h('button', 'tab', 'ИИ');
    const tabOpts = h('button', 'tab', 'Настройки');
    tabs.append(tabList, tabText, tabPanel, tabAi, tabOpts);
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

    let active = initialTab || 'list';
    let rawArea = null;
    let cards = [];

    /** Ошибки по каждому автоответу: триггер, комбинация, дубликаты, пустой текст. */
    const validate = () => {
      const triggers = draft.map((item) => String(item.trigger || '').trim());
      const seenKeys = new Map();
      const seenTriggers = new Map();
      return draft.map((item, index) => {
        const trigger = triggers[index];
        const hotkey = String(item.hotkey || '').trim();
        if (!trigger && !hotkey) return 'Задайте триггер (например !1) или комбинацию';

        if (trigger) {
          const error = triggerError(trigger);
          if (error) return 'Триггер: ' + error;
          const low = trigger.toLowerCase();
          if (seenTriggers.has(low)) return 'Такой триггер уже есть у автоответа №' + (seenTriggers.get(low) + 1);
          seenTriggers.set(low, index);
          const shorter = triggers.findIndex((other, i) => i !== index && other &&
            other.length < trigger.length && low.startsWith(other.toLowerCase()));
          if (shorter !== -1) return 'Не сработает: триггер ' + triggers[shorter] + ' короче и срабатывает раньше';
        }

        if (hotkey) {
          const parsed = parseHotkey(hotkey);
          if (!parsed.hk) return 'Комбинация: ' + (parsed.error || 'не распознана');
          if (seenKeys.has(parsed.hk.sig)) return 'Эта комбинация уже занята автоответом №' + (seenKeys.get(parsed.hk.sig) + 1);
          seenKeys.set(parsed.hk.sig, index);
        }

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
        hotkey: item.hotkey, trigger: item.trigger, label: item.labelRaw, text: item.text, send: item.send
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

      const trig = h('input', 'trg');
      trig.type = 'text';
      trig.value = item.trigger || '';
      trig.placeholder = '!1';
      trig.title = 'Текст-триггер: печатаете его в поле — он превращается в автоответ';
      trig.addEventListener('input', () => { item.trigger = trig.value.trim(); refresh(); });

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

      top.append(trig, hk.wrap, name, sendLabel, h('span', 'spacer'), up, down, del);

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
      cards.push({ el: el, err: err, trigger: trig, hotkey: hk.input, text: area });
      return el;
    }

    function renderList() {
      cards = [];
      const hint = h('p', 'hint');
      hint.innerHTML = 'Первое поле — <b>триггер</b>: печатаете его прямо в поле ввода (например <code>!1</code>), ' +
        'и он заменяется автоответом. Второе — <b>комбинация клавиш</b>: впишите или нажмите ⌨ и нажмите клавиши. ' +
        'Достаточно чего-то одного. Enter — отправлять сообщение сразу после вставки, ' +
        'плашки под текстом вставляют подстановки.';
      body.appendChild(hint);

      if (!draft.length) {
        body.appendChild(h('div', 'empty', 'Автоответов пока нет — добавьте первый.'));
      }
      draft.forEach((item, index) => body.appendChild(renderCard(item, index)));

      const add = h('button', 'add', '+ Добавить автоответ');
      add.addEventListener('click', () => {
        draft.push({ hotkey: '', trigger: '', label: '', text: '', send: false });
        render();
        const last = cards[cards.length - 1];
        if (last) last.trigger.focus();
      });
      body.appendChild(add);
      refresh();
    }

    function renderText() {
      cards = [];
      const hint = h('p', 'hint');
      hint.innerHTML = 'Тот же список текстом — удобно скопировать целиком или вставить готовый набор. ' +
        'Блок: <code>[триггер, комбинация | название | send]</code>, ниже — строки ответа. ' +
        'Триггер или комбинацию можно не указывать. Строки с <code>#</code> — комментарии.';
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

    function renderPanelTab() {
      cards = [];
      const hint = h('p', 'hint');
      hint.innerHTML = 'Панель показывается справа на указанных адресах и берёт значения прямо со страницы. ' +
        'Обычно подходит режим <b>«по подписи»</b>: пишете подпись строки (например <code>Дата загрузки</code>), ' +
        'а скрипт берёт значение из соседней ячейки. Поле <b>«разница дат»</b> считает, сколько прошло между ' +
        'двумя датами, и краснеет, если превышен срок годности.';
      body.appendChild(hint);

      const onLabel = h('label', 'check');
      onLabel.style.marginTop = '0';
      const onBox = h('input');
      onBox.type = 'checkbox';
      onBox.checked = !!side.enabled;
      onBox.addEventListener('change', () => { side.enabled = onBox.checked; });
      onLabel.append(onBox, document.createTextNode('Показывать панель'));
      body.appendChild(onLabel);

      const hideLabel = h('label', 'check');
      hideLabel.style.marginTop = '6px';
      const hideBox = h('input');
      hideBox.type = 'checkbox';
      hideBox.checked = side.hideEmpty !== false;
      hideBox.addEventListener('change', () => { side.hideEmpty = hideBox.checked; });
      hideLabel.append(hideBox, document.createTextNode('Скрывать строки, для которых на странице нет данных'));
      body.appendChild(hideLabel);

      const row = h('div', 'row');
      const titleLabel = h('label', null, 'Заголовок панели');
      const titleInput = h('input');
      titleInput.type = 'text';
      titleInput.value = side.title || '';
      titleInput.style.marginTop = '4px';
      titleInput.addEventListener('input', () => { side.title = titleInput.value; });
      titleLabel.appendChild(titleInput);

      const limitLabel = h('label', null, 'Срок годности, дней (0 — не проверять)');
      const limitInput = h('input', 'num');
      limitInput.type = 'text';
      limitInput.value = String(side.limitDays == null ? '' : side.limitDays);
      limitInput.style.marginTop = '4px';
      limitInput.addEventListener('input', () => { side.limitDays = parseNumber(limitInput.value); });
      limitLabel.appendChild(limitInput);
      row.append(titleLabel, limitLabel);
      body.appendChild(row);

      const siteLabel = h('label', null, 'Адреса, где показывать (по одной маске в строке, * — любой кусок)');
      siteLabel.style.cssText = 'display: block; font-size: 12px; color: #5b6273; margin-top: 12px;';
      const siteArea = h('textarea', 'small');
      siteArea.spellcheck = false;
      siteArea.value = side.site || '';
      siteArea.placeholder = 'example.com/orders/*';
      siteArea.style.marginTop = '4px';
      siteArea.addEventListener('input', () => { side.site = siteArea.value; });
      siteLabel.appendChild(siteArea);
      const here = h('button', null, 'Подставить текущий адрес');
      here.style.marginTop = '6px';
      here.addEventListener('click', () => {
        const mask = location.host + location.pathname.replace(/\/[^/]*$/, '/') + '*';
        siteArea.value = (siteArea.value.trim() ? siteArea.value.trim() + '\n' : '') + mask;
        side.site = siteArea.value;
      });
      siteLabel.appendChild(here);
      body.appendChild(siteLabel);

      if (!side.packs) side.packs = { url: '', column: 'Товар', selector: '', values: [], counted: [] };
      const packs = side.packs;

      const packsBox = h('div');
      packsBox.style.marginTop = '16px';
      const packsHint = h('p', 'hint');
      packsHint.innerHTML = '<b>Фасовки.</b> Соберите список существующих фасовок и отметьте те, по которым ' +
        'тикет считается проблемным (почтовые отправления обычно учитывать не нужно). Варианты берутся со ' +
        'страницы по адресу — из колонки с указанным заголовком; повторы отсекаются.';
      packsBox.appendChild(packsHint);

      const urlLine = h('div', 'line');
      const urlInput = h('input');
      urlInput.type = 'text';
      urlInput.value = packs.url || '';
      urlInput.placeholder = 'https://сайт/.../product-packing/list/';
      urlInput.addEventListener('input', () => { packs.url = urlInput.value.trim(); });
      const columnInput = h('input');
      columnInput.type = 'text';
      columnInput.value = packs.column || '';
      columnInput.placeholder = 'колонка: Товар';
      columnInput.style.flex = '0 1 150px';
      columnInput.addEventListener('input', () => { packs.column = columnInput.value.trim(); });
      urlLine.append(h('span', 'pval', 'список фасовок'), urlInput, columnInput);
      packsBox.appendChild(urlLine);

      const packLine = h('div', 'line');
      const packInput = h('input');
      packInput.type = 'text';
      packInput.value = packs.selector || '';
      packInput.placeholder = 'ячейка фасовки в списке заказов (необязательно)';
      packInput.addEventListener('input', () => { packs.selector = packInput.value; });
      const packPick = h('button', null, 'Указать');
      packPick.title = 'Кликните ячейку с фасовкой в списке заказов';
      packPick.addEventListener('click', () => pickElement((path, el) => {
        if (!el) return;
        packs.selector = shortSelector(el);
        packInput.value = packs.selector;
      }));
      const packScan = h('button', null, 'Собрать список');
      packScan.addEventListener('click', () => {
        const run = (second) => {
          const found = collectPacks(packs);
          if (found.length) {
            packs.values = found;
            renderPacks();
            preview();
            toast('Найдено фасовок: ' + found.length);
            return;
          }
          if (packs.url && !second) {
            toast('Загружаю страницу со списком…');
            setTimeout(() => run(true), 1500);
            return;
          }
          toast('Не нашлось — проверьте адрес, название колонки или селектор');
        };
        run(false);
      });
      packLine.append(packInput, packPick, packScan);
      packsBox.appendChild(packLine);

      const packList = h('div', 'line');
      packList.style.cssText = 'flex-direction: column; align-items: stretch; gap: 2px;';
      packsBox.appendChild(packList);

      function renderPacks() {
        packList.textContent = '';
        if (!packs.values || !packs.values.length) {
          packList.appendChild(h('span', 'pval', 'Варианты не собраны — нажмите «Собрать со страницы».'));
          return;
        }
        const tools = h('div', 'line');
        const all = h('button', 'icon', 'отметить все');
        all.addEventListener('click', () => { packs.counted = packs.values.slice(); renderPacks(); preview(); });
        const none = h('button', 'icon', 'снять все');
        none.addEventListener('click', () => { packs.counted = []; renderPacks(); preview(); });
        tools.append(all, none);
        packList.appendChild(tools);

        packs.values.forEach((value) => {
          const label = h('label', 'check');
          label.style.marginTop = '0';
          const box = h('input');
          box.type = 'checkbox';
          box.checked = (packs.counted || []).indexOf(value) !== -1;
          box.addEventListener('change', () => {
            const list = packs.counted || (packs.counted = []);
            const at = list.indexOf(value);
            if (box.checked && at === -1) list.push(value);
            if (!box.checked && at !== -1) list.splice(at, 1);
            preview();
          });
          label.append(box, document.createTextNode(value));
          packList.appendChild(label);
        });
      }
      renderPacks();
      body.appendChild(packsBox);

      const list = h('div');
      list.style.marginTop = '16px';
      body.appendChild(list);

      const preview = () => {
        Array.prototype.forEach.call(list.querySelectorAll('.pnow'), (node, index) => {
          const result = extractField(side.fields[index], side.fields);
          node.textContent = 'Сейчас: ' + (result.value || '— на этой странице не найдено');
        });
        count.textContent = 'Строк в панели: ' + side.fields.length;
      };

      const renderFields = () => {
        list.textContent = '';
        side.fields.forEach((field, index) => {
          const card = h('div', 'pfield');

          const line1 = h('div', 'line');
          const name = h('input');
          name.type = 'text';
          name.value = field.label || '';
          name.placeholder = 'Название строки';
          name.addEventListener('input', () => { field.label = name.value; });

          const source = h('select');
          [['label', 'по подписи'], ['css', 'по селектору'], ['between', 'разница дат'],
            ['count', 'счётчик по списку'], ['ratio', 'доля (A от B)']].forEach((pair) => {
            const option = h('option', null, pair[1]);
            option.value = pair[0];
            source.appendChild(option);
          });
          source.value = field.source || 'label';
          source.addEventListener('change', () => { field.source = source.value; renderFields(); });

          const del = h('button', 'icon', '✕');
          del.title = 'Удалить строку';
          del.addEventListener('click', () => { side.fields.splice(index, 1); renderFields(); });
          line1.append(name, source, h('span', 'spacer'), del);
          card.appendChild(line1);

          const line2 = h('div', 'line');
          const extraLines = [];
    if (field.source === 'count') {
            const textInput = (value, placeholder, apply) => {
              const input = h('input');
              input.type = 'text';
              input.value = value || '';
              input.placeholder = placeholder;
              input.addEventListener('input', () => { apply(input.value); preview(); });
              return input;
            };
            const pickInto = (input, apply, unique) => {
              const button = h('button', null, 'Указать');
              button.addEventListener('click', () => pickElement((path, el) => {
                if (!el) return;
                const value = unique ? path : shortSelector(el);   // строки ищем «по виду», ссылку — точную
                input.value = value;
                apply(value);
                preview();
              }));
              return button;
            };

            const table = textInput(field.table, 'таблица: Последние заказы', (v) => { field.table = v; });
            const rows = textInput(field.rowSelector, 'или строки: tr.order', (v) => { field.rowSelector = v; });
            line2.append(h('span', 'pval', 'что считаем'), table, rows, pickInto(rows, (v) => { field.rowSelector = v; }));

            const lineFilter = h('div', 'line');
            const column = textInput(field.column, 'колонка: Статус', (v) => { field.column = v; });
            column.style.flex = '0 1 140px';
            const wanted = textInput(field.value, 'значения через запятую', (v) => { field.value = v; });
            const exclude = h('label', 'check');
            exclude.style.marginTop = '0';
            const excludeBox = h('input');
            excludeBox.type = 'checkbox';
            excludeBox.checked = !!field.exclude;
            excludeBox.addEventListener('change', () => { field.exclude = excludeBox.checked; preview(); });
            exclude.append(excludeBox, document.createTextNode('исключать'));
            lineFilter.append(h('span', 'pval', 'фильтр'), column, wanted, exclude);

            const lineFrom = h('div', 'line');
            const link = textInput(field.linkSelector, 'Покупатель -> Подробный разбор (или адрес/селектор)',
              (v) => { field.linkSelector = v; });
            const pagesInput = textInput(field.pages, 'страниц', (v) => { field.pages = v; });
            pagesInput.className = 'num';
            pagesInput.title = 'Сколько страниц списка обойти, если он разбит на страницы';
            lineFrom.append(h('span', 'pval', 'откуда'), link, pickInto(link, (v) => { field.linkSelector = v; }, true),
              h('span', 'pval', 'страниц'), pagesInput);
            extraLines.push(lineFrom, lineFilter);

            const lineIf = h('div', 'line');
            const where = textInput(field.whereSelector, 'признак тикета: .ticket', (v) => { field.whereSelector = v; });
            const whereText = textInput(field.whereText, 'или текст в строке', (v) => { field.whereText = v; });
            lineIf.append(h('span', 'pval', 'ещё в строке есть'), where,
              pickInto(where, (v) => { field.whereSelector = v; }), whereText);
            extraLines.push(lineIf);

            const linePacks = h('div', 'line');
            const onlyPacks = h('label', 'check');
            onlyPacks.style.marginTop = '0';
            const onlyBox = h('input');
            onlyBox.type = 'checkbox';
            onlyBox.checked = !!field.usePacks;
            onlyBox.addEventListener('change', () => { field.usePacks = onlyBox.checked; preview(); });
            onlyPacks.append(onlyBox, document.createTextNode('Только отмеченные фасовки'));
            linePacks.appendChild(onlyPacks);
            extraLines.push(linePacks);
          } else if (field.source === 'between' || field.source === 'ratio') {
            const isRatio = field.source === 'ratio';
            const names = side.fields.filter((other) => other !== field && other.label).map((other) => other.label);
            const build = (value, onChange) => {
              const select = h('select');
              names.concat(['__now__']).forEach((option) => {
                const node = h('option', null, option === '__now__' ? 'сейчас' : option);
                node.value = option;
                select.appendChild(node);
              });
              select.value = value || names[0] || '__now__';
              select.addEventListener('change', () => { onChange(select.value); preview(); });
              return select;
            };
            line2.append(
              h('span', 'pval', isRatio ? 'считаем' : 'от'), build(field.from, (value) => { field.from = value; }),
              h('span', 'pval', isRatio ? 'от' : 'до'), build(field.to, (value) => { field.to = value; })
            );
          } else if (field.source === 'css') {
            const selector = h('input');
            selector.type = 'text';
            selector.value = field.selector || '';
            selector.placeholder = '.order .executor';
            selector.addEventListener('input', () => { field.selector = selector.value; preview(); });
            const pick = h('button', null, 'Указать');
            pick.title = 'Кликните нужный элемент на странице';
            pick.addEventListener('click', () => pickElement((path) => {
              if (!path) return;
              selector.value = path;
              field.selector = path;
              preview();
            }));
            const mode = h('select');
            FIELD_MODES.forEach((pair) => {
              const option = h('option', null, pair[1]);
              option.value = pair[0];
              mode.appendChild(option);
            });
            mode.value = field.mode || 'text';
            mode.addEventListener('change', () => { field.mode = mode.value; preview(); });
            line2.append(selector, pick, mode);
          } else {
            const query = h('input');
            query.type = 'text';
            query.value = field.query || '';
            query.placeholder = 'Дата загрузки';
            query.addEventListener('input', () => { field.query = query.value; preview(); });
            const pick = h('button', null, 'Указать');
            pick.title = 'Кликните подпись строки на странице';
            pick.addEventListener('click', () => pickElement((path, el) => {
              if (!el) return;
              const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().replace(/[:：]$/, '');
              query.value = text;
              field.query = text;
              preview();
            }));
            line2.append(query, pick);
          }
          card.appendChild(line2);
          extraLines.forEach((line) => card.appendChild(line));

          const line3 = h('div', 'line');
          line3.appendChild(h('span', 'pval pnow', ''));
          card.appendChild(line3);
          list.appendChild(card);
        });
        preview();
      };

      const add = h('button', 'add', '+ Добавить строку');
      add.style.marginTop = '4px';
      add.addEventListener('click', () => {
        side.fields.push({ label: '', source: 'label', query: '', selector: '', attr: '', regex: '', mode: 'text' });
        renderFields();
      });

      renderFields();
      body.appendChild(add);
    }

    function renderAiTab() {
      cards = [];
      const hint = h('p', 'hint');
      hint.innerHTML = 'Помощник работает через OpenAI-совместимый шлюз (по умолчанию AiTunnel). ' +
        'Числа он не считает — их считает панель и передаёт готовыми. Ничего не отправляется покупателю само: ' +
        'любой результат сначала показывается вам.';
      body.appendChild(hint);

      const onLabel = h('label', 'check');
      onLabel.style.marginTop = '0';
      const onBox = h('input');
      onBox.type = 'checkbox';
      onBox.checked = !!ai.enabled;
      onBox.addEventListener('change', () => { ai.enabled = onBox.checked; });
      onLabel.append(onBox, document.createTextNode('Показывать кнопки ИИ в панели'));
      body.appendChild(onLabel);

      const field = (label, key, placeholder, isKey) => {
        const wrap = h('label', null, label);
        wrap.style.cssText = 'display:block;font-size:12px;color:#5b6273;margin-top:12px;';
        const input = h('input');
        input.type = isKey ? 'password' : 'text';
        input.value = ai[key] == null ? '' : String(ai[key]);
        input.placeholder = placeholder || '';
        input.style.marginTop = '4px';
        input.addEventListener('input', () => { ai[key] = input.value.trim(); });
        wrap.appendChild(input);
        body.appendChild(wrap);
        return input;
      };

      field('Ключ шлюза (хранится только у вас в браузере)', 'key', 'sk-…', true);
      const row = h('div', 'row');
      const baseLabel = h('label', null, 'Адрес шлюза');
      const baseInput = h('input');
      baseInput.type = 'text';
      baseInput.value = ai.base || '';
      baseInput.placeholder = 'https://api.aitunnel.ru/v1';
      baseInput.style.marginTop = '4px';
      baseInput.addEventListener('input', () => { ai.base = baseInput.value.trim(); });
      baseLabel.appendChild(baseInput);
      const modelLabel = h('label', null, 'Модель');
      const modelInput = h('input');
      modelInput.type = 'text';
      modelInput.value = ai.model || '';
      modelInput.placeholder = 'gpt-5-6-luna-pro';
      modelInput.style.marginTop = '4px';
      modelInput.addEventListener('input', () => { ai.model = modelInput.value.trim(); });
      modelLabel.appendChild(modelInput);
      row.append(baseLabel, modelLabel);
      body.appendChild(row);

      const toneLabel = h('label', null, 'Тон ответов');
      toneLabel.style.cssText = 'display:block;font-size:12px;color:#5b6273;margin-top:12px;';
      const toneArea = h('textarea', 'small');
      toneArea.value = ai.tone || '';
      toneArea.style.marginTop = '4px';
      toneArea.addEventListener('input', () => { ai.tone = toneArea.value; });
      toneLabel.appendChild(toneArea);
      body.appendChild(toneLabel);

      const chatLabel = h('label', null, 'Где переписка (пусто — берём текст страницы)');
      chatLabel.style.cssText = 'display:block;font-size:12px;color:#5b6273;margin-top:12px;';
      const chatLine = h('div', 'line');
      const chatInput = h('input');
      chatInput.type = 'text';
      chatInput.value = ai.chatSelector || '';
      chatInput.placeholder = '.chat-message';
      chatInput.addEventListener('input', () => { ai.chatSelector = chatInput.value.trim(); });
      const chatPick = h('button', null, 'Указать');
      chatPick.addEventListener('click', () => pickElement((path, el) => {
        if (!el) return;
        ai.chatSelector = shortSelector(el);
        chatInput.value = ai.chatSelector;
      }));
      chatLine.append(chatInput, chatPick);
      chatLabel.appendChild(chatLine);
      body.appendChild(chatLabel);

      const limits = h('div', 'row');
      const ctxLabel = h('label', null, 'Сколько символов страницы отдавать');
      const ctxInput = h('input', 'num');
      ctxInput.type = 'text';
      ctxInput.value = String(ai.contextLimit || '');
      ctxInput.style.marginTop = '4px';
      ctxInput.addEventListener('input', () => { ai.contextLimit = parseNumber(ctxInput.value); });
      ctxLabel.appendChild(ctxInput);
      const tempLabel = h('label', null, 'Температура (0 — строго, 1 — вольно)');
      const tempInput = h('input', 'num');
      tempInput.type = 'text';
      tempInput.value = String(ai.temperature == null ? '' : ai.temperature);
      tempInput.style.marginTop = '4px';
      tempInput.addEventListener('input', () => { ai.temperature = parseNumber(tempInput.value); });
      tempLabel.appendChild(tempInput);
      limits.append(ctxLabel, tempLabel);
      body.appendChild(limits);

      const checkLine = h('div', 'line');
      checkLine.style.marginTop = '14px';
      const check = h('button', null, 'Проверить связь');
      const checkResult = h('span', 'pval');
      check.addEventListener('click', async () => {
        const saved = config.ai;
        config.ai = Object.assign({}, ai);                 // проверяем то, что сейчас в полях
        checkResult.textContent = 'Проверяю…';
        try {
          const answer = await aiAsk('Отвечай одним словом.', 'Ответь словом: готово', { temperature: 0 });
          checkResult.textContent = 'Шлюз ответил: ' + answer.slice(0, 40);
        } catch (error) {
          checkResult.textContent = 'Ошибка: ' + String(error && error.message || error);
        } finally {
          config.ai = saved;
        }
      });
      checkLine.append(check, checkResult);
      body.appendChild(checkLine);

      count.textContent = 'Задач ИИ: ' + Object.keys(AI_TASKS).length;
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
      tabPanel.setAttribute('aria-selected', String(active === 'panel'));
      tabAi.setAttribute('aria-selected', String(active === 'ai'));
      tabOpts.setAttribute('aria-selected', String(active === 'opts'));
      if (active === 'list') renderList();
      else if (active === 'text') renderText();
      else if (active === 'panel') renderPanelTab();
      else if (active === 'ai') renderAiTab();
      else renderOpts();
    }

    panel.addEventListener('keydown', (e) => {                 // Ctrl+Enter — сохранить
      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveBtn.click(); }
    });

    tabList.addEventListener('click', () => show('list'));
    tabText.addEventListener('click', () => show('text'));
    tabPanel.addEventListener('click', () => show('panel'));
    tabAi.addEventListener('click', () => show('ai'));
    tabOpts.addEventListener('click', () => show('opts'));

    resetBtn.addEventListener('click', () => {
      if (active === 'panel') {
        side.fields = JSON.parse(JSON.stringify(DEFAULT_PANEL.fields));
        render();
        return;
      }
      draft.length = 0;
      parseTemplates(DEFAULT_TEXT).items.forEach((item) => draft.push({
        hotkey: item.hotkey, trigger: item.trigger, label: item.labelRaw, text: item.text, send: item.send
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
        fab: opts.fab,
        panel: side,
        ai: ai
      });
      hotkeyCache.clear();
      reloadTemplates();
      const saved = saveConfig(config);
      closeOverlay();
      ensureFab();
      updateSidePanel();

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
    gear.addEventListener('click', () => openSettings());
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
        t.trigger.toLowerCase().includes(query) ||
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
        const keys = h('span', 'keys');
        if (item.trigger) keys.appendChild(h('span', 'chip', item.trigger));
        if (item.hotkey) keys.appendChild(h('kbd', null, item.hotkey));
        li.append(num, text, keys);
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

  // ========================== 11. ПАНЕЛЬ ДАННЫХ НА СТРАНИЦЕ ==========================

  const FIELD_MODES = [
    ['text', 'Текст'],
    ['count', 'Количество'],
    ['sum', 'Сумма'],
    ['list', 'Список']
  ];

  function escapeRegExp(str) {
    return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/[^\w-]/g, '\\$&');
  }

  /** Подходит ли адрес страницы под маски (по одной в строке, * — любой кусок). */
  function siteMatches(patterns) {
    const list = String(patterns || '').split('\n').map((s) => s.trim()).filter(Boolean);
    if (!list.length) return false;
    const url = location.href;
    const short = url.replace(/^https?:\/\//, '');
    return list.some((pattern) => {
      if (pattern.indexOf('*') === -1) return url.indexOf(pattern) !== -1;
      const re = new RegExp('^' + pattern.split('*').map(escapeRegExp).join('.*') + '$');
      return re.test(url) || re.test(short) || re.test(short.replace(/\/$/, ''));
    });
  }

  function parseNumber(text) {
    const cleaned = String(text).replace(/[^\d,.\-]/g, '').replace(/\s/g, '').replace(',', '.');
    const value = parseFloat(cleaned);
    return isFinite(value) ? value : 0;
  }

  const RU_MONTHS = [
    ['январ', 0], ['феврал', 1], ['март', 2], ['апрел', 3], ['мая', 4], ['май', 4], ['июн', 5],
    ['июл', 6], ['август', 7], ['сентябр', 8], ['октябр', 9], ['ноябр', 10], ['декабр', 11]
  ];

  /** Разбирает «11 сентября 2026 г. 12:46», «11.09.2026 12:46» и ISO-даты. */
  function parseDate(text) {
    const value = String(text || '').replace(/\u00a0/g, ' ').trim();
    if (!value) return null;

    let m = /(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{1,2}):(\d{2}))?/.exec(value);
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));

    m = /(\d{1,2})\s+([А-Яа-яЁё]+)\.?\s+(\d{4})(?:\s*г\.?)?(?:[^\d]*(\d{1,2}):(\d{2}))?/.exec(value);
    if (m) {
      const month = RU_MONTHS.find((pair) => m[2].toLowerCase().indexOf(pair[0]) === 0);
      if (month) return new Date(+m[3], month[1], +m[1], +(m[4] || 0), +(m[5] || 0));
    }

    m = /(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})(?:[^\d]*(\d{1,2}):(\d{2}))?/.exec(value);
    if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0));

    return null;
  }

  /** «2 д 3 ч», «45 мин» — насколько давно это было. */
  function formatSpan(ms) {
    const minutes = Math.round(ms / 60000);
    const abs = Math.abs(minutes);
    const days = Math.floor(abs / 1440);
    const hours = Math.floor((abs % 1440) / 60);
    const rest = abs % 60;
    const parts = [];
    if (days) parts.push(days + ' д');
    if (hours) parts.push(hours + ' ч');
    if (!days && rest) parts.push(rest + ' мин');
    return (minutes < 0 ? '−' : '') + (parts.join(' ') || '0 мин');
  }

  function normalizeText(value) {
    return String(value == null ? '' : value).replace(/\s+/g, ' ').trim().toLowerCase();
  }

  /** Короткий селектор «по виду», а не по единственности: чтобы совпадали все такие же строки. */
  function shortSelector(el) {
    if (!el || el.nodeType !== 1) return '';
    const part = (node) => {
      let out = node.tagName.toLowerCase();
      const classes = Array.prototype.slice.call(node.classList || [])
        .filter((name) => /^[a-zA-Z][\w-]*$/.test(name))
        .slice(0, 2);
      if (classes.length) return out + '.' + classes.map(cssEscape).join('.');
      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.prototype.slice.call(parent.children).filter((c) => c.tagName === node.tagName);
        if (sameTag.length > 1) out += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')';
      }
      return out;
    };
    const own = part(el);
    if (/[.:]/.test(own) || !el.parentElement) return own;
    return part(el.parentElement) + ' > ' + own;
  }

  // Страницы, подгруженные в фоне (например профиль покупателя)
  const remoteCache = new Map();
  const REMOTE_TTL = 60000;

  function getRemoteDoc(url) {
    const cached = remoteCache.get(url);
    const now = Date.now();
    if (cached && (cached.loading || now - cached.time < REMOTE_TTL)) return cached.doc || null;

    remoteCache.set(url, { loading: true, time: now, doc: cached && cached.doc });
    fetch(url, { credentials: 'include' })
      .then((response) => response.text())
      .then((html) => {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        doc.arhUrl = url;                                  // база для относительных ссылок
        remoteCache.set(url, { doc: doc, time: Date.now() });
        fillSidePanel();
      })
      .catch(() => {
        remoteCache.set(url, { doc: null, time: Date.now() });
        fillSidePanel();
      });
    return (cached && cached.doc) || null;
  }

  function docUrl(doc) {
    return (doc && doc.arhUrl) || location.href;
  }

  /** «~/путь» — от корня раздела: подставляет первый сегмент текущего адреса (код кабинета). */
  function expandUrl(raw, base) {
    let value = String(raw || '').trim();
    if (value.indexOf('~/') === 0) {
      const segment = location.pathname.split('/').filter(Boolean)[0] || '';
      value = '/' + (segment ? segment + '/' : '') + value.slice(2);
    }
    try { return new URL(value, base || location.href).href; } catch (e) { return null; }
  }

  /**
   * Один шаг перехода: адрес, CSS-селектор ссылки, её текст или подпись строки.
   * Если таких ссылок несколько, нужную выбирает номер: «Подробнее#2».
   */
  function findLinkInDoc(doc, step) {
    let raw = String(step || '').trim();
    if (!raw) return null;

    let nth = 1;
    const numbered = /#(\d+)\s*$/.exec(raw);
    if (numbered) {
      nth = parseInt(numbered[1], 10) || 1;
      raw = raw.slice(0, numbered.index).trim();
    }

    const base = docUrl(doc);
    const href = (el) => {
      const value = el.getAttribute('href') ||
        (el.querySelector && el.querySelector('a[href]') && el.querySelector('a[href]').getAttribute('href'));
      return value ? expandUrl(value, base) : null;
    };
    const pick = (list) => {
      const urls = list.map(href).filter(Boolean);
      return urls.length ? (urls[nth - 1] || null) : null;
    };

    if (/^https?:\/\//i.test(raw) || raw.charAt(0) === '/' || raw.indexOf('~/') === 0) {
      return expandUrl(raw, base);
    }

    let bySelector = [];
    try { bySelector = Array.prototype.slice.call(doc.querySelectorAll(raw)); } catch (e) { bySelector = []; }
    const fromSelector = pick(bySelector);
    if (fromSelector) return fromSelector;

    const needle = normalizeText(raw);
    const byText = Array.prototype.slice.call(doc.querySelectorAll('a[href]'))
      .filter((link) => normalizeText(link.textContent).indexOf(needle) !== -1);
    const fromText = pick(byText);
    if (fromText) return fromText;

    const byLabel = linkByLabel(doc, raw);                // «Покупатель» — подпись, ссылка рядом
    return byLabel ? href(byLabel) : null;
  }

  /**
   * Где искать строки списка. Можно пройти цепочку ссылок: «Покупатель -> Подробный разбор»,
   * чтобы со страницы тикета попасть в полный список заказов пользователя.
   */
  function countScope(field) {
    const chain = String(field.linkSelector || '').split('->').map((step) => step.trim()).filter(Boolean);
    if (!chain.length) return document;

    let doc = document;
    for (let i = 0; i < chain.length; i++) {
      const url = findLinkInDoc(doc, chain[i]);
      if (!url) return null;
      if (new URL(url).origin !== location.origin) return '⚠ страница другого сайта';
      const next = getRemoteDoc(url);
      if (!next) return '…';
      doc = next;
    }
    return doc;
  }

  const NEXT_WORDS = ['следующая', 'следующие', 'далее', 'дальше', 'вперёд', 'вперед', 'next', '›', '»', '→', '>'];

  /** Ссылка на следующую страницу списка, если он разбит на страницы. */
  function findNextPage(doc) {
    const base = docUrl(doc);
    const rel = doc.querySelector('a[rel="next"]');
    const take = (el) => {
      if (!el) return null;
      try { return new URL(el.getAttribute('href'), base).href; } catch (e) { return null; }
    };
    if (rel) return take(rel);

    const links = Array.prototype.slice.call(doc.querySelectorAll('a[href]'));
    for (let i = 0; i < links.length; i++) {
      const text = normalizeText(links[i].textContent);
      const title = normalizeText(links[i].getAttribute('title') || links[i].getAttribute('aria-label'));
      if (!text && !title) continue;
      if (NEXT_WORDS.indexOf(text) !== -1 || NEXT_WORDS.indexOf(title) !== -1) return take(links[i]);
    }

    // Нумерованная постраничка: берём ссылку с номером на единицу больше активного
    const active = doc.querySelector('.active, [aria-current="page"], .current');
    const current = active ? parseInt(normalizeText(active.textContent), 10) : NaN;
    if (isFinite(current)) {
      for (let i = 0; i < links.length; i++) {
        if (parseInt(normalizeText(links[i].textContent), 10) === current + 1) return take(links[i]);
      }
    }
    return null;
  }

  const VALUE_TAGS = { TD: 1, TH: 1, DD: 1, DT: 1, SPAN: 1, DIV: 1, P: 1, B: 1, STRONG: 1, A: 1 };

  function nodeText(node) {
    return String((node && (node.innerText || node.textContent)) || '').replace(/\s+/g, ' ').trim();
  }

  /** Элементы «напротив подписи»: соседняя ячейка строки, следующий элемент, следующая ячейка таблицы. */
  function labelCandidates(doc, query) {
    const needle = normalizeText(query).replace(/[:：]$/, '');
    const out = [];
    if (!needle) return out;

    const nodes = doc.querySelectorAll('th, td, dt, dd, span, div, p, b, strong, label');
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      if (normalizeText(node.textContent).replace(/[:：]$/, '') !== needle) continue;

      if (node.nextElementSibling) out.push(node.nextElementSibling);
      if (node.parentElement && node.parentElement.nextElementSibling) out.push(node.parentElement.nextElementSibling);
      const row = node.closest && node.closest('tr');
      if (row) {
        const cells = Array.prototype.slice.call(row.children);
        const cell = node.tagName === 'TD' || node.tagName === 'TH' ? node : (node.closest && node.closest('td, th'));
        const index = cells.indexOf(cell);
        if (index !== -1 && cells[index + 1]) out.push(cells[index + 1]);
      }
    }
    return out;
  }

  /** Значение из строки «подпись → значение». */
  function valueByLabel(query) {
    const needle = normalizeText(query);
    const candidates = labelCandidates(document, query);
    for (let i = 0; i < candidates.length; i++) {
      const text = nodeText(candidates[i]);
      if (text && normalizeText(text) !== needle) return text;
    }
    return '';
  }

  /** Ссылка из ячейки напротив подписи: «Покупатель» → ссылка на его страницу. */
  function linkByLabel(doc, query) {
    const candidates = labelCandidates(doc, query);
    for (let i = 0; i < candidates.length; i++) {
      const node = candidates[i];
      if (node.tagName === 'A' && node.getAttribute('href')) return node;
      const inner = node.querySelector && node.querySelector('a[href]');
      if (inner) return inner;
    }
    return null;
  }

  /** Сколько строк на одной странице подходит под условия поля. */
  function countRowsIn(field, scope) {
    let rows = [];
    let table = null;
    if (field.table) {
      table = findTableByHeading(scope, field.table);
      if (!table) return null;                       // таблицы на странице нет — это не «ноль строк»
      rows = dataRows(table);
    } else {
      try {
        rows = Array.prototype.slice.call(scope.querySelectorAll(field.rowSelector));
      } catch (e) {
        return '⚠ селектор строк не понят';
      }
    }

    // фильтр по колонке: «Статус = Выполнен», «Тип = Вопросы по заказу» и т. п.
    const column = table && field.column ? columnIndex(table, field.column) : -1;
    const wanted = String(field.value || '').split(',').map(normalizeText).filter(Boolean);
    const packs = panelConfig().packs || {};
    const counted = (packs.counted || []).map(normalizeText);
    const usePacks = !!field.usePacks && counted.length > 0;
    const needle = normalizeText(field.whereText);

    let total = 0;
    rows.forEach((row) => {
      if (column !== -1 && wanted.length) {
        const cell = row.cells && row.cells[column];
        const text = normalizeText(cell ? cell.textContent : '');
        const hit = wanted.some((value) => text.indexOf(value) !== -1);
        if (field.exclude ? hit : !hit) return;
      }
      if (field.whereSelector) {
        let hit = null;
        try { hit = row.querySelector(field.whereSelector); } catch (e) { return; }
        if (!hit) return;
      }
      if (needle && normalizeText(row.textContent).indexOf(needle) === -1) return;
      if (usePacks) {
        if (packs.selector) {
          let cell = null;
          try { cell = row.querySelector(packs.selector); } catch (e) { return; }
          if (!cell || counted.indexOf(normalizeText(cell.textContent)) === -1) return;
        } else {
          const text = normalizeText(row.textContent);
          if (!counted.some((value) => text.indexOf(value) !== -1)) return;
        }
      }
      total += 1;
    });
    return total;
  }

  /** Значение одного поля панели. Возвращает { value, alarm }. */
  function extractField(field, allFields) {
    if (!field) return { value: '' };

    if (field.source === 'between') {
      const read = (name) => {
        if (name === '__now__') return new Date();
        const other = (allFields || []).find((item) => item !== field && item.label === name);
        return other ? parseDate(extractField(other, allFields).value) : null;
      };
      const from = read(field.from);
      const to = read(field.to);
      if (!from || !to) return { value: '' };
      const span = to.getTime() - from.getTime();
      const limit = Number(panelConfig().limitDays) || 0;
      return { value: formatSpan(span), alarm: limit > 0 && span > limit * 86400000 };
    }

    if (field.source === 'ratio') {
const read = (name) => {
  const other = (allFields || []).find((item) => item !== field && item.label === name);
  if (!other) return null;
  const raw = String(extractField(other, allFields).value || '');
  if (!raw || raw === '…' || raw.indexOf('⚠') === 0) return null;
  return { num: parseNumber(raw), partial: raw.indexOf('≥') !== -1 };
};
const from = read(field.from);
const to = read(field.to);
if (!from || !to || !to.num) return { value: '' };
const sign = (from.partial || to.partial) ? '≈ ' : '';
// показываем и формулу, и результат; 100% не потолок — перекос должен быть виден
return {
  value: sign + from.num + ' из ' + to.num + ' · ' + Math.round((from.num / to.num) * 100) + '%',
  alarm: from.num > to.num
};
    }

    if (field.source === 'count') {
      if (!field.table && !field.rowSelector) return { value: '' };
      const scope = countScope(field);
      if (typeof scope === 'string') return { value: scope };
      if (!scope) return { value: '' };

      const pages = Math.max(1, Math.min(20, Math.round(Number(field.pages) || 1)));
      let total = 0;
      let partial = false;                                 // страницы кончились или упёрлись в предел?
      let page = scope;
      for (let step = 0; step < pages; step++) {
        const counted = countRowsIn(field, page);
        if (typeof counted === 'string') return { value: counted };
        if (counted === null) {
          if (step === 0) return { value: '' };      // список не найден вообще
          break;                                     // на следующей странице списка уже нет
        }
        total += counted;
        if (step === pages - 1) {
          partial = !!findNextPage(page);
          break;
        }
        const nextUrl = findNextPage(page);
        if (!nextUrl) break;
        if (new URL(nextUrl).origin !== location.origin) break;
        const nextDoc = getRemoteDoc(nextUrl);
        if (!nextDoc) return { value: '…' };               // ждём остальные страницы
        page = nextDoc;
      }
      return { value: (partial ? '≥ ' : '') + total, partial: partial };
    }

    let nodes;
    if (field.source === 'label') {
      const value = valueByLabel(field.query);
      return { value: applyRegex(value, field.regex) };
    }

    const selector = String(field.selector || '').trim();
    if (!selector) return { value: '' };
    try {
      nodes = Array.prototype.slice.call(document.querySelectorAll(selector));
    } catch (e) {
      return { value: '⚠ селектор не понят' };
    }
    if (!nodes.length) return { value: '' };

    const values = nodes.map((node) => {
      const raw = field.attr
        ? (node.getAttribute(field.attr) || '')
        : (node.innerText || node.textContent || '');
      return applyRegex(raw.replace(/\s+/g, ' ').trim(), field.regex);
    }).filter((value) => value !== '');

    if (values.indexOf('⚠ регулярка не понята') !== -1) return { value: '⚠ регулярка не понята' };
    if (field.mode === 'count') return { value: String(nodes.length) };
    if (field.mode === 'sum') {
      const sum = values.reduce((acc, value) => acc + parseNumber(value), 0);
      return { value: String(Math.round(sum * 100) / 100) };
    }
    if (field.mode === 'list') return { value: values.join(', ') };
    return { value: values[0] || '' };
  }

  function applyRegex(value, pattern) {
    if (!pattern) return value;
    try {
      const found = new RegExp(pattern).exec(value);
      return found ? (found[1] !== undefined ? found[1] : found[0]) : '';
    } catch (e) {
      return '⚠ регулярка не понята';
    }
  }

  // ---------- Сама панель ----------

  let sideObserver = null;
  let sideTimer = null;

  function panelConfig() {
    return Object.assign({}, DEFAULT_PANEL, config.panel || {});
  }

  function panelVisible() {
    const panel = panelConfig();
    return window.top === window.self && !!panel.enabled && siteMatches(panel.site);
  }

  function updateSidePanel() {
    const root = rootEl || (panelVisible() ? ensureRoot() : null);
    const existing = root && root.querySelector('.side');
    if (!panelVisible()) {
      if (existing) existing.remove();
      stopWatchingPage();
      return;
    }
    if (!existing) buildSidePanel();
    fillSidePanel();
    startWatchingPage();
  }

  function buildSidePanel() {
    const root = ensureRoot();
    const panel = panelConfig();
    const side = h('aside', 'side');

    const head = h('div', 'side-head');
    const title = h('b', 'side-title', panel.title || 'Данные заказа');
    const reload = h('button', 'icon', '⟳');
    reload.title = 'Обновить';
    reload.addEventListener('click', fillSidePanel);
    const gear = h('button', 'icon', '⚙');
    gear.title = 'Настроить поля';
    gear.addEventListener('click', () => openSettings('panel'));
    const fold = h('button', 'icon', '–');
    fold.title = 'Свернуть';
    fold.addEventListener('click', () => {
      config.panel = Object.assign({}, panelConfig(), { collapsed: !panelConfig().collapsed });
      saveConfig(config);
      side.classList.toggle('folded', !!config.panel.collapsed);
      fold.textContent = config.panel.collapsed ? '+' : '–';
    });
    head.append(title, h('span', 'spacer'), reload, gear, fold);

    const body = h('div', 'side-body');
    side.append(head, body);
    if (aiConfig().enabled) side.insertBefore(aiButtons(), body);
    side.classList.toggle('folded', !!panel.collapsed);
    fold.textContent = panel.collapsed ? '+' : '–';
    root.appendChild(side);
  }

  /** Перечитывает значения со страницы и обновляет строки панели. */
  function fillSidePanel() {
    const root = rootEl;
    const side = root && root.querySelector('.side');
    if (!side) return;
    const panel = panelConfig();
    const body = side.querySelector('.side-body');
    const title = side.querySelector('.side-title');
    if (title) title.textContent = panel.title || 'Данные заказа';
    body.textContent = '';

    const fields = (panel.fields || []).filter((field) => field && (field.label || field.query || field.selector));
    if (!fields.length) {
      body.appendChild(h('div', 'side-empty', 'Поля не настроены — нажмите ⚙'));
      return;
    }

    let shown = 0;
    fields.forEach((field) => {
      const result = extractField(field, fields);
      const value = result.value;
      if (!value && panel.hideEmpty) return;            // на этой странице такого поля нет
      shown += 1;
      const row = h('div', 'side-row' + (result.alarm ? ' side-alarm' : ''));
      row.append(
        h('span', 'side-label', field.label || field.query || field.selector),
        h('span', 'side-value' + (value ? '' : ' side-dim'), value || '—')
      );
      if (value) {
        row.title = 'Нажмите, чтобы скопировать';
        row.addEventListener('click', () => {
          try {
            navigator.clipboard.writeText(value);
            toast('Скопировано: ' + value.slice(0, 40));
          } catch (e) {
            toast('Не удалось скопировать');
          }
        });
      }
      body.appendChild(row);
    });

    if (!shown) body.appendChild(h('div', 'side-empty', 'На этой странице данных для панели нет'));
  }

  function startWatchingPage() {
    if (sideObserver || !document.body) return;
    sideObserver = new MutationObserver(() => {
      clearTimeout(sideTimer);
      sideTimer = setTimeout(fillSidePanel, 400);          // страница часто дёргается — ждём паузу
    });
    sideObserver.observe(document.body, { childList: true, subtree: true, characterData: true });
  }

  function stopWatchingPage() {
    if (!sideObserver) return;
    sideObserver.disconnect();
    sideObserver = null;
    clearTimeout(sideTimer);
  }

  /** Одностраничные приложения меняют адрес без перезагрузки — следим за этим. */
  function watchUrlChanges(onChange) {
    const fire = () => setTimeout(onChange, 60);
    ['pushState', 'replaceState'].forEach((name) => {
      const original = history[name];
      if (typeof original !== 'function' || original.arhPatched) return;
      const patched = function () {
        const result = original.apply(this, arguments);
        fire();
        return result;
      };
      patched.arhPatched = true;
      history[name] = patched;
    });
    window.addEventListener('popstate', fire);
    window.addEventListener('hashchange', fire);
  }

  /** Ближайшая таблица после заголовка вроде «Последние заказы». */
  function nextTable(node) {
    let el = node;
    while (el) {
      let sibling = el.nextElementSibling;
      while (sibling) {
        if (sibling.tagName === 'TABLE') return sibling;
        const inner = sibling.querySelector && sibling.querySelector('table');
        if (inner) return inner;
        sibling = sibling.nextElementSibling;
      }
      el = el.parentElement;
    }
    return null;
  }

  function findTableByHeading(doc, title) {
    const needle = normalizeText(title);
    if (!needle) return null;

    if (needle === '*') {                                // «*» — самая длинная таблица страницы
      let best = null;
      Array.prototype.forEach.call(doc.querySelectorAll('table'), (table) => {
        if (!best || dataRows(table).length > dataRows(best).length) best = table;
      });
      return best;
    }

    const tables = Array.prototype.slice.call(doc.querySelectorAll('table'));
    for (let i = 0; i < tables.length; i++) {
      const caption = tables[i].querySelector('caption');
      if (caption && normalizeText(caption.textContent) === needle) return tables[i];
    }

    const headings = doc.querySelectorAll('h1, h2, h3, h4, h5, legend, summary, div, span, p, td, th');
    for (let i = 0; i < headings.length; i++) {
      if (normalizeText(headings[i].textContent) !== needle) continue;
      const table = nextTable(headings[i]);
      if (table) return table;
    }
    return null;
  }

  /** Номер колонки по её заголовку; -1, если такой нет. */
  function columnIndex(table, name) {
    const needle = normalizeText(name).replace(/[:：]$/, '');
    if (!needle) return -1;
    const rows = Array.prototype.slice.call(table.rows || []);
    for (let r = 0; r < Math.min(rows.length, 3); r++) {
      const cells = Array.prototype.slice.call(rows[r].cells || []);
      for (let i = 0; i < cells.length; i++) {
        if (normalizeText(cells[i].textContent).replace(/[:：]$/, '') === needle) return i;
      }
    }
    return -1;
  }

  /** Строки таблицы без строки заголовков. */
  function dataRows(table) {
    return Array.prototype.slice.call(table.rows || []).filter((row) => {
      const cells = Array.prototype.slice.call(row.cells || []);
      return cells.length > 0 && !cells.every((cell) => cell.tagName === 'TH');
    });
  }

  /** Значения колонки таблицы по заголовку — например колонки «Товар». */
  function collectColumn(doc, name) {
    const needle = normalizeText(name).replace(/[:：]$/, '');
    const out = [];
    Array.prototype.forEach.call(doc.querySelectorAll('table'), (table) => {
      const rows = Array.prototype.slice.call(table.rows || []);
      for (let r = 0; r < Math.min(rows.length, 3); r++) {
        const cells = Array.prototype.slice.call(rows[r].cells || []);
        let index = -1;
        cells.forEach((cell, i) => {
          if (index === -1 && normalizeText(cell.textContent).replace(/[:：]$/, '') === needle) index = i;
        });
        if (index === -1) continue;
        for (let k = r + 1; k < rows.length; k++) {
          const cell = rows[k].cells && rows[k].cells[index];
          if (cell) out.push(String(cell.textContent || '').replace(/\s+/g, ' ').trim());
        }
        return;
      }
    });
    return out;
  }

  /** Словарь фасовок: со страницы по адресу (если указан) или с открытых страниц. Повторы отсекаются. */
  function collectPacks(packs) {
    if (!packs) return [];
    const docs = [];

    if (packs.url) {
      const expanded = expandUrl(packs.url, location.href);
      if (!expanded) return [];
      const url = new URL(expanded);
      if (url.origin !== location.origin) return [];
      const doc = getRemoteDoc(url.href);
      if (doc) docs.push(doc);
    } else {
      docs.push(document);
      remoteCache.forEach((entry) => { if (entry && entry.doc) docs.push(entry.doc); });
    }

    const seen = new Map();
    const add = (text) => {
      const value = String(text || '').replace(/\s+/g, ' ').trim();
      if (value && value.length <= 80 && !seen.has(normalizeText(value))) seen.set(normalizeText(value), value);
    };

    docs.forEach((doc) => {
      if (packs.column) collectColumn(doc, packs.column).forEach(add);
      if (packs.selector) {
        try {
          Array.prototype.forEach.call(doc.querySelectorAll(packs.selector), (node) => add(node.textContent));
        } catch (e) { /* кривой селектор — пропускаем */ }
      }
    });
    return Array.from(seen.values()).slice(0, 200);
  }

  // ---------- Выбор элемента мышью ----------

  /** Короткий и по возможности устойчивый селектор для элемента. */
  function cssPath(el) {
    if (!el || el.nodeType !== 1) return '';
    const unique = (selector) => {
      try { return document.querySelectorAll(selector).length === 1; } catch (e) { return false; }
    };
    if (el.id && unique('#' + cssEscape(el.id))) return '#' + cssEscape(el.id);

    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 6) {
      if (node.id && unique('#' + cssEscape(node.id))) {
        parts.unshift('#' + cssEscape(node.id));
        break;
      }
      let part = node.tagName.toLowerCase();
      const classes = Array.prototype.slice.call(node.classList || [])
        .filter((name) => /^[a-zA-Z][\w-]*$/.test(name))
        .slice(0, 2);
      if (classes.length) part += '.' + classes.map(cssEscape).join('.');
      const parent = node.parentElement;
      if (parent) {
        const sameTag = Array.prototype.slice.call(parent.children)
          .filter((child) => child.tagName === node.tagName);
        if (sameTag.length > 1) part += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')';
      }
      parts.unshift(part);
      const candidate = parts.join(' > ');
      if (unique(candidate)) return candidate;
      node = parent;
    }
    return parts.join(' > ');
  }

  /** Режим «ткни в элемент»: подсвечивает элементы под курсором и возвращает селектор. */
  function pickElement(onPick) {
    const root = ensureRoot();
    const hidden = openOverlay;
    if (hidden) hidden.style.display = 'none';

    const box = h('div', 'pick-box');
    const bar = h('div', 'pick-bar', 'Кликните нужный элемент на странице · Esc — отмена');
    root.append(box, bar);

    let current = null;
    const move = (e) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      if (!el || el === hostEl || el === document.documentElement) return;
      current = el;
      const rect = el.getBoundingClientRect();
      box.style.left = rect.left + 'px';
      box.style.top = rect.top + 'px';
      box.style.width = rect.width + 'px';
      box.style.height = rect.height + 'px';
    };
    const click = (e) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      finish(current);
    };
    const key = (e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopImmediatePropagation();
      finish(null);
    };
    function finish(el) {
      document.removeEventListener('mousemove', move, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', key, true);
      box.remove();
      bar.remove();
      if (hidden) hidden.style.display = '';
      onPick(el ? cssPath(el) : null, el);
    }

    document.addEventListener('mousemove', move, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true);
  }

  // ========================== 12. ИИ ==========================

  /**
   * Работа с OpenAI-совместимым шлюзом (по умолчанию AiTunnel).
   * Правило одно: всё, что можно посчитать кодом, считает код — модель только формулирует.
   * Ничего не отправляется покупателю само: любой результат проходит через предпросмотр.
   */

  function aiConfig() {
    return Object.assign({}, DEFAULT_AI, config.ai || {});
  }

  function aiUrl() {
    const base = String(aiConfig().base || DEFAULT_AI.base).trim().replace(/\/+$/, '');
    if (/\/chat\/completions$/i.test(base)) return base;
    return /\/v\d+$/i.test(base) ? base + '/chat/completions' : base + '/v1/chat/completions';
  }

  /** Запрос к модели. В браузере на чужой домен ходит только GM_xmlhttpRequest. */
  function aiAsk(system, user, options) {
    const conf = aiConfig();
    const opts = options || {};
    return new Promise((resolve, reject) => {
      if (!String(conf.key || '').trim()) {
        reject(new Error('Не указан ключ — откройте настройки, вкладка «ИИ»'));
        return;
      }
      if (typeof GM_xmlhttpRequest !== 'function') {
        reject(new Error('Нет доступа GM_xmlhttpRequest — переустановите скрипт в Tampermonkey'));
        return;
      }
      const body = {
        model: String(conf.model || DEFAULT_AI.model).trim(),
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
        temperature: opts.temperature != null ? opts.temperature : Number(conf.temperature) || 0.3,
        max_tokens: Number(conf.maxTokens) || 900
      };
      GM_xmlhttpRequest({
        method: 'POST',
        url: aiUrl(),
        timeout: 90000,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
          'Authorization': 'Bearer ' + String(conf.key).trim()
        },
        data: JSON.stringify(body),
        onload: (response) => {
          let data = null;
          try { data = JSON.parse(response.responseText || '{}'); } catch (e) { data = null; }
          if (response.status < 200 || response.status >= 300) {
            const message = data && data.error && (data.error.message || data.error) || ('HTTP ' + response.status);
            reject(new Error(String(message).slice(0, 300)));
            return;
          }
          const choice = data && data.choices && data.choices[0];
          const content = choice && choice.message && choice.message.content;
          const text = typeof content === 'string'
            ? content
            : (Array.isArray(content) ? content.map((part) => part && (part.text || '')).join('') : '');
          if (!text.trim()) {
            reject(new Error('Модель вернула пустой ответ'));
            return;
          }
          resolve(text.trim());
        },
        onerror: () => reject(new Error('Сеть недоступна или шлюз отклонил запрос')),
        ontimeout: () => reject(new Error('Шлюз не ответил за 90 секунд'))
      });
    });
  }

  /** Модели иногда заворачивают JSON в ```-блок — достаём его аккуратно. */
  function parseJsonLoose(text) {
    let value = String(text || '').trim();
    const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(value);
    if (fence) value = fence[1].trim();
    const start = value.search(/[[{]/);
    if (start > 0) value = value.slice(start);
    const end = Math.max(value.lastIndexOf('}'), value.lastIndexOf(']'));
    if (end !== -1) value = value.slice(0, end + 1);
    try { return JSON.parse(value); } catch (e) { return null; }
  }

  // ---------- Контекст страницы ----------

  /** Текст переписки: по селектору из настроек, иначе — видимый текст страницы. */
  function aiPageText() {
    const conf = aiConfig();
    const limit = Math.max(500, Number(conf.contextLimit) || 6000);
    let text = '';
    if (conf.chatSelector) {
      try {
        const nodes = Array.prototype.slice.call(document.querySelectorAll(conf.chatSelector));
        text = nodes.map((node) => nodeText(node)).filter(Boolean).join('\n');
      } catch (e) { text = ''; }
    }
    if (!text) text = String(document.body && document.body.innerText || '').replace(/\n{3,}/g, '\n\n');
    text = text.trim();
    return text.length > limit ? '…\n' + text.slice(-limit) : text;   // хвост важнее начала
  }

  function aiDraftText() {
    const el = resolveTarget();
    if (!el) return '';
    return (el.value !== undefined ? el.value : nodeText(el)).trim();
  }

  /** Всё, что панель уже вытащила со страницы: подписи, счётчики, даты, сроки. */
  function aiFacts() {
    const panel = panelConfig();
    const fields = (panel.fields || []).filter((field) => field && (field.label || field.query || field.selector));
    const out = [];
    fields.forEach((field) => {
      const result = extractField(field, fields);
      if (!result.value || result.value === '…') return;
      out.push({ label: field.label || field.query, value: result.value, alarm: !!result.alarm });
    });
    return out;
  }

  function aiContext() {
    return {
      url: location.href,
      title: document.title,
      facts: aiFacts(),
      chat: aiPageText(),
      draft: aiDraftText(),
      limitDays: Number(panelConfig().limitDays) || 0
    };
  }

  function factsBlock(context) {
    if (!context.facts.length) return 'Данные со страницы не найдены.';
    return context.facts
      .map((fact) => '- ' + fact.label + ': ' + fact.value + (fact.alarm ? '  ← превышен порог' : ''))
      .join('\n');
  }

  const AI_RULES = [
    'Ты помощник оператора поддержки. Отвечай по-русски.',
    'Все числа и даты уже посчитаны и приведены в блоке ДАННЫЕ. Не пересчитывай их и не придумывай новых.',
    'Если данных не хватает — скажи об этом одной строкой, не догадывайся.',
    'Не обещай того, чего нет в данных (компенсации, сроки, доставку).',
    'Без markdown, без вступлений вроде «Конечно» и без подписи.'
  ].join(' ');

  // ---------- Задачи ----------

  const AI_TASKS = {
    reply: {
      icon: '✍',
      title: 'Черновик ответа',
      kind: 'text',
      system: AI_RULES + ' Пиши готовый текст ответа покупателю — только сам текст, без пояснений.',
      build: (context, extra) => [
        'ЗАДАЧА: напиши ответ покупателю по этому обращению.',
        extra ? 'ДОПОЛНИТЕЛЬНО: ' + extra : '',
        'ТОН: ' + (aiConfig().tone || DEFAULT_AI.tone),
        '',
        'ДАННЫЕ:', factsBlock(context),
        '',
        'ПЕРЕПИСКА И СТРАНИЦА:', context.chat
      ].filter(Boolean).join('\n')
    },

    shelf: {
      icon: '⏳',
      title: 'Вердикт по сроку',
      kind: 'text',
      system: AI_RULES + ' Ты формулируешь вывод по сроку годности. Арифметику не делаешь: разница дат уже посчитана.',
      build: (context) => [
        'ЗАДАЧА: по готовым данным сформулируй, мог ли выйти срок годности, и что ответить покупателю.',
        'Порог свежести: ' + (context.limitDays ? context.limitDays + ' дн.' : 'не задан'),
        'Формат: первая строка — вывод (вышел / не вышел / данных не хватает), дальше 1–3 строки обоснования, потом строка «Ответ покупателю:» и текст ответа.',
        '',
        'ДАННЫЕ:', factsBlock(context)
      ].join('\n')
    },

    risk: {
      icon: '⚖',
      title: 'Риск покупателя',
      kind: 'json',
      system: AI_RULES + ' Верни только JSON: {"verdict":"низкий|средний|высокий","score":0-100,"reasons":["…"],"advice":"…"}.',
      build: (context) => [
        'ЗАДАЧА: оцени, похоже ли поведение покупателя на злоупотребление (частые тикеты и отмены при малом числе заказов).',
        'Оценивай только по приведённым числам. Мало данных — verdict «низкий» и причина «мало данных».',
        '',
        'ДАННЫЕ:', factsBlock(context)
      ].join('\n')
    },

    fields: {
      icon: '📦',
      title: 'Разобрать данные',
      kind: 'json',
      system: AI_RULES + ' Верни только JSON вида {"поле":"значение"} с найденными данными. Ничего не выдумывай, отсутствующее пропусти.',
      build: (context) => [
        'ЗАДАЧА: вытащи из переписки данные для отправки: индекс, ФИО, адрес, количество, трек-номер, номер заказа, телефон.',
        'Ключи — по-русски. Если значения нет — не добавляй ключ.',
        '',
        'ПЕРЕПИСКА:', context.chat
      ].join('\n')
    },

    summary: {
      icon: '📝',
      title: 'Резюме переписки',
      kind: 'text',
      system: AI_RULES + ' Дай сжатую выжимку: 2–4 строки, без воды.',
      build: (context) => [
        'ЗАДАЧА: коротко изложи суть обращения: что просит покупатель, что уже ответили, что осталось сделать.',
        '',
        'ДАННЫЕ:', factsBlock(context),
        '',
        'ПЕРЕПИСКА:', context.chat
      ].join('\n')
    },

    proof: {
      icon: '✅',
      title: 'Проверить мой ответ',
      kind: 'json',
      system: AI_RULES + ' Верни только JSON: {"issues":[{"type":"тон|факт|обещание|ошибка","text":"…"}],"fixed":"исправленный текст"}.',
      build: (context) => [
        'ЗАДАЧА: проверь черновик оператора перед отправкой: тон, соответствие данным, лишние обещания, опечатки.',
        'Если всё в порядке — issues пустой, fixed равен исходному тексту.',
        'ТОН: ' + (aiConfig().tone || DEFAULT_AI.tone),
        '',
        'ДАННЫЕ:', factsBlock(context),
        '',
        'ЧЕРНОВИК ОПЕРАТОРА:', context.draft || '(поле ввода пустое)'
      ].join('\n')
    }
  };

  // ---------- Запуск и показ результата ----------

  let aiBusy = false;

  async function runAiTask(taskId, extra) {
    const task = AI_TASKS[taskId];
    if (!task || aiBusy) return;
    if (taskId === 'proof' && !aiDraftText()) {
      toast('Сначала напишите черновик в поле ответа');
      return;
    }
    const context = aiContext();
    const prompt = task.build(context, extra);
    aiBusy = true;
    showAiWindow(task, { state: 'loading', prompt: prompt });
    try {
      const answer = await aiAsk(task.system, prompt, {});
      const parsed = task.kind === 'json' ? parseJsonLoose(answer) : answer;
      if (task.kind === 'json' && !parsed) {
        showAiWindow(task, { state: 'text', text: answer, prompt: prompt, note: 'Модель ответила не JSON — показываю как есть' });
      } else {
        showAiWindow(task, { state: task.kind, data: parsed, text: answer, prompt: prompt, taskId: taskId });
      }
    } catch (error) {
      showAiWindow(task, { state: 'error', text: String(error && error.message || error), prompt: prompt });
    } finally {
      aiBusy = false;
    }
  }

  function showAiWindow(task, result) {
    const overlay = createOverlay();
    const panel = h('div', 'panel');
    overlay.appendChild(panel);

    const head = h('div', 'head');
    head.append(h('h2', null, task.icon + ' ' + task.title), h('span', 'spacer'));
    panel.appendChild(head);

    const body = h('div', 'body');
    panel.appendChild(body);

    const foot = h('div', 'foot');
    panel.appendChild(foot);

    if (result.state === 'loading') {
      body.appendChild(h('div', 'side-empty', 'Модель думает…'));
      const cancel = h('button', null, 'Закрыть');
      cancel.addEventListener('click', closeOverlay);
      foot.append(h('span', 'spacer'), cancel);
      return;
    }

    if (result.state === 'error') {
      const box = h('div', 'notes');
      box.textContent = result.text;
      body.appendChild(box);
    } else if (result.state === 'json' && result.data) {
      body.appendChild(renderAiJson(result.taskId, result.data));
    } else {
      if (result.note) {
        const note = h('div', 'notes');
        note.textContent = result.note;
        body.appendChild(note);
      }
      const area = h('textarea');
      area.value = String(result.text || '');
      area.spellcheck = false;
      area.style.minHeight = '26vh';
      body.appendChild(area);
      result.area = area;
    }

    // что именно ушло в модель — чтобы результату можно было верить
    const details = document.createElement('details');
    details.style.marginTop = '10px';
    const summary = document.createElement('summary');
    summary.textContent = 'Что отправлено модели';
    summary.style.cssText = 'cursor:pointer;font-size:12px;color:#5b6273';
    const pre = h('div', 'pval');
    pre.style.cssText = 'white-space:pre-wrap;margin-top:6px;max-height:26vh;overflow:auto';
    pre.textContent = result.prompt || '';
    details.append(summary, pre);
    body.appendChild(details);

    const insertText = () => (result.area ? result.area.value : aiTextOf(result));
    const target = resolveTarget();

    if (result.state !== 'error') {
      const copy = h('button', null, 'Скопировать');
      copy.addEventListener('click', () => {
        try { navigator.clipboard.writeText(insertText()); toast('Скопировано'); } catch (e) { toast('Не удалось скопировать'); }
      });
      foot.appendChild(copy);

      if (target && insertText()) {
        const replaces = result.taskId === 'proof';        // исправленный текст заменяет черновик целиком
        const paste = h('button', 'primary', replaces ? 'Заменить в поле' : 'Вставить в поле');
        paste.addEventListener('click', () => {
          const text = insertText();
          closeOverlay();
          if (replaces) selectAllIn(target);
          insertTemplateText(target, text);
          toast(replaces ? 'Заменено — проверьте и отправьте сами' : 'Вставлено — проверьте и отправьте сами');
        });
        foot.appendChild(paste);
      }
    }

    if (result.state === 'text' && result.taskId) {
      [['короче', 'Сделай короче'], ['мягче', 'Сделай мягче'], ['строже', 'Сделай строже и суше']].forEach((pair) => {
        const button = h('button', 'icon', pair[0]);
        button.addEventListener('click', () => runAiTask(result.taskId, pair[1]));
        foot.appendChild(button);
      });
    }

    const close = h('button', null, 'Закрыть');
    close.addEventListener('click', closeOverlay);
    foot.append(h('span', 'spacer'), close);
  }

  /** Выделяет всё содержимое поля, чтобы следующая вставка его заменила. */
  function selectAllIn(el) {
    try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    if (el.value !== undefined) {
      try { el.setSelectionRange(0, el.value.length); } catch (e) {}
      return;
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function aiTextOf(result) {
    if (result.state === 'json' && result.data) {
      if (result.taskId === 'proof' && result.data.fixed) return String(result.data.fixed);
      return Object.keys(result.data).map((key) => key + ': ' + result.data[key]).join('\n');
    }
    return String(result.text || '');
  }

  function renderAiJson(taskId, data) {
    const box = h('div');

    if (taskId === 'risk') {
      const colors = { низкий: '#1f8a4c', средний: '#b26a00', высокий: '#b3261e' };
      const verdict = String(data.verdict || '—').toLowerCase();
      const head = h('div', null, 'Риск: ' + verdict + (data.score != null ? ' · ' + data.score + '/100' : ''));
      head.style.cssText = 'font-size:16px;font-weight:700;margin-bottom:8px;color:' + (colors[verdict] || 'inherit');
      box.appendChild(head);
      (data.reasons || []).forEach((reason) => {
        const row = h('div', 'side-row');
        row.appendChild(h('span', 'side-value', '• ' + reason));
        box.appendChild(row);
      });
      if (data.advice) {
        const advice = h('p', 'hint');
        advice.style.marginTop = '10px';
        advice.textContent = 'Рекомендация: ' + data.advice;
        box.appendChild(advice);
      }
      return box;
    }

    if (taskId === 'proof') {
      const issues = data.issues || [];
      if (!issues.length) {
        box.appendChild(h('div', 'side-empty', 'Замечаний нет — текст можно отправлять'));
      } else {
        issues.forEach((issue) => {
          const row = h('div', 'side-row side-alarm');
          row.append(h('span', 'side-label', issue.type || 'замечание'), h('span', 'side-value', issue.text || ''));
          box.appendChild(row);
        });
      }
      if (data.fixed) {
        const label = h('p', 'hint');
        label.style.margin = '12px 0 4px';
        label.textContent = 'Исправленный вариант:';
        const area = h('textarea');
        area.value = String(data.fixed);
        area.style.minHeight = '18vh';
        box.append(label, area);
      }
      return box;
    }

    Object.keys(data).forEach((key) => {
      const value = data[key];
      if (value == null || value === '') return;
      const row = h('div', 'side-row');
      row.append(h('span', 'side-label', key), h('span', 'side-value', String(value)));
      row.title = 'Нажмите, чтобы скопировать';
      row.addEventListener('click', () => {
        try { navigator.clipboard.writeText(String(value)); toast('Скопировано: ' + value); } catch (e) {}
      });
      box.appendChild(row);
    });
    if (!box.childNodes.length) box.appendChild(h('div', 'side-empty', 'Модель ничего не нашла'));
    return box;
  }

  /** Ряд кнопок ИИ в шапке боковой панели. */
  function aiButtons() {
    const row = h('div', 'ai-row');
    Object.keys(AI_TASKS).forEach((taskId) => {
      const task = AI_TASKS[taskId];
      const button = h('button', 'icon', task.icon);
      button.title = task.title;
      button.addEventListener('click', () => runAiTask(taskId));
      row.appendChild(button);
    });
    return row;
  }

  // ========================== 13. СТАРТ ==========================

  reloadTemplates();
  ensureFab();
  updateSidePanel();
  if (window.top === window.self) watchUrlChanges(updateSidePanel);

  if (window.top === window.self && typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('Настроить автоответы', () => openSettings());
    GM_registerMenuCommand('Показать список автоответов', () => openPicker());
  }
})();
