/** Convert a KeyboardEvent into an Electron accelerator string, or null if it's only modifiers. */
export function eventToAccelerator(e: KeyboardEvent): string | null {
  const key = codeToKey(e.code);
  if (!key) return null;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  if (e.metaKey) parts.push('Super');
  parts.push(key);
  return parts.join('+');
}

function codeToKey(code: string): string | null {
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  if (/^Numpad[0-9]$/.test(code)) return `num${code.slice(6)}`;
  const map: Record<string, string> = {
    NumpadAdd: 'numadd',
    NumpadSubtract: 'numsub',
    NumpadMultiply: 'nummult',
    NumpadDivide: 'numdiv',
    NumpadDecimal: 'numdec',
    NumpadEnter: 'Enter',
    Space: 'Space',
    Enter: 'Enter',
    Tab: 'Tab',
    Backquote: '`',
    Minus: '-',
    Equal: '=',
    BracketLeft: '[',
    BracketRight: ']',
    Backslash: '\\',
    Semicolon: ';',
    Quote: "'",
    Comma: ',',
    Period: '.',
    Slash: '/',
    ArrowUp: 'Up',
    ArrowDown: 'Down',
    ArrowLeft: 'Left',
    ArrowRight: 'Right',
    Home: 'Home',
    End: 'End',
    PageUp: 'PageUp',
    PageDown: 'PageDown',
    Insert: 'Insert',
    Delete: 'Delete',
    Backspace: 'Backspace',
    Pause: 'MediaPlayPause',
    ScrollLock: 'Scrolllock',
    PrintScreen: 'PrintScreen',
    MediaPlayPause: 'MediaPlayPause',
    MediaStop: 'MediaStop',
    MediaTrackNext: 'MediaNextTrack',
    MediaTrackPrevious: 'MediaPreviousTrack',
  };
  return map[code] ?? null;
}

const DISPLAY: Record<string, string> = {
  num0: 'Num 0',
  num1: 'Num 1',
  num2: 'Num 2',
  num3: 'Num 3',
  num4: 'Num 4',
  num5: 'Num 5',
  num6: 'Num 6',
  num7: 'Num 7',
  num8: 'Num 8',
  num9: 'Num 9',
  numadd: 'Num +',
  numsub: 'Num −',
  nummult: 'Num ×',
  numdiv: 'Num ÷',
  numdec: 'Num .',
  Super: 'Win',
  Up: '↑',
  Down: '↓',
  Left: '←',
  Right: '→',
  Scrolllock: 'Scroll Lock',
  MediaPlayPause: 'Play/Pause',
};

export function formatAccelerator(accel: string | null | undefined): string[] {
  if (!accel) return [];
  return accel.split('+').map((p) => DISPLAY[p] ?? p);
}

/** Keys that are risky to bind with no modifier because they'd swallow normal typing. */
export function isRiskyBareKey(accel: string): boolean {
  if (accel.includes('+')) return false;
  return /^([A-Z0-9]|Space|Enter|Tab|Backspace|`|-|=|\[|\]|\\|;|'|,|\.|\/)$/.test(accel);
}
