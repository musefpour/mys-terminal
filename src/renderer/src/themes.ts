import type { ITheme } from '@xterm/xterm'
import { normalizeTheme, type TermThemeName } from '../../shared/types'

export interface ChromeTheme {
  bg: string
  raise: string
  sink: string
  line: string
  text: string
  muted: string
  accent: string
  accentInk: string
  warn: string
  danger: string
  shadow: string
  bar: string
  btn: string
  hover: string
  menu: string
  lineStrong: string
  overlay: string
  scrollbar: string
  toast: string
  toastLine: string
  toastErr: string
  toastErrLine: string
}

export interface AppTheme {
  id: TermThemeName
  label: string
  mode: 'night' | 'day'
  term: ITheme
  chrome: ChromeTheme
}

interface Ink {
  bg: string
  fg: string
  cursor: string
  selection: string
  accent: string
  black: string
  red: string
  green: string
  yellow: string
  blue: string
  magenta: string
  cyan: string
  white: string
  brightBlack: string
  brightRed: string
  brightGreen: string
  brightYellow: string
  brightBlue: string
  brightMagenta: string
  brightCyan: string
  brightWhite: string
}

function channel(hex: string, index: number): number {
  return Number.parseInt(hex.slice(1 + index * 2, 3 + index * 2), 16)
}

function mix(a: string, b: string, t: number): string {
  const parts = [0, 1, 2].map((index) => Math.round(channel(a, index) + (channel(b, index) - channel(a, index)) * t))
  return `#${parts.map((part) => part.toString(16).padStart(2, '0')).join('')}`
}

function ink(color: string): string {
  const y = (0.2126 * channel(color, 0) + 0.7152 * channel(color, 1) + 0.0722 * channel(color, 2)) / 255
  return y > 0.62 ? '#16181d' : '#f7f8f8'
}

function chromeFor(mode: 'night' | 'day', bg: string, fg: string, accent: string, warn: string, danger: string): ChromeTheme {
  if (mode === 'day') {
    return {
      bg,
      raise: mix(bg, '#ffffff', 0.55),
      sink: mix(bg, '#000000', 0.045),
      line: mix(bg, '#000000', 0.12),
      text: fg,
      muted: mix(fg, bg, 0.38),
      accent,
      accentInk: ink(accent),
      warn,
      danger,
      shadow: '0 18px 40px rgba(40, 32, 24, 0.14)',
      bar: mix(bg, '#000000', 0.035),
      btn: mix(bg, '#ffffff', 0.35),
      hover: mix(bg, '#000000', 0.06),
      menu: mix(bg, '#ffffff', 0.72),
      lineStrong: mix(bg, '#000000', 0.2),
      overlay: 'rgba(28, 24, 20, 0.28)',
      scrollbar: mix(bg, fg, 0.28),
      toast: mix(bg, accent, 0.16),
      toastLine: mix(accent, bg, 0.45),
      toastErr: mix(bg, danger, 0.16),
      toastErrLine: mix(danger, bg, 0.4),
    }
  }
  return {
    bg,
    raise: mix(bg, '#ffffff', 0.07),
    sink: mix(bg, '#000000', 0.28),
    line: mix(bg, '#ffffff', 0.16),
    text: fg,
    muted: mix(fg, bg, 0.48),
    accent,
    accentInk: ink(accent),
    warn,
    danger,
    shadow: '0 24px 60px rgba(0, 0, 0, 0.38)',
    bar: mix(bg, '#000000', 0.2),
    btn: mix(bg, '#ffffff', 0.1),
    hover: mix(bg, '#ffffff', 0.14),
    menu: mix(bg, '#ffffff', 0.08),
    lineStrong: mix(bg, '#ffffff', 0.24),
    overlay: 'rgba(0, 0, 0, 0.55)',
    scrollbar: mix(bg, fg, 0.22),
    toast: mix(bg, accent, 0.2),
    toastLine: mix(accent, bg, 0.35),
    toastErr: mix(bg, danger, 0.28),
    toastErrLine: mix(danger, '#ffffff', 0.25),
  }
}

function theme(id: TermThemeName, label: string, mode: 'night' | 'day', colors: Ink, chrome?: ChromeTheme): AppTheme {
  return {
    id,
    label,
    mode,
    term: {
      background: colors.bg,
      foreground: colors.fg,
      cursor: colors.cursor,
      cursorAccent: colors.bg,
      selectionBackground: colors.selection,
      black: colors.black,
      red: colors.red,
      green: colors.green,
      yellow: colors.yellow,
      blue: colors.blue,
      magenta: colors.magenta,
      cyan: colors.cyan,
      white: colors.white,
      brightBlack: colors.brightBlack,
      brightRed: colors.brightRed,
      brightGreen: colors.brightGreen,
      brightYellow: colors.brightYellow,
      brightBlue: colors.brightBlue,
      brightMagenta: colors.brightMagenta,
      brightCyan: colors.brightCyan,
      brightWhite: colors.brightWhite,
    },
    chrome: chrome ?? chromeFor(mode, colors.bg, colors.fg, colors.accent, colors.yellow, colors.red),
  }
}

const IRAN_CHROME: ChromeTheme = {
  bg: '#101211',
  raise: '#181b19',
  sink: '#0b0d0c',
  line: '#2c312e',
  text: '#f7f7f5',
  muted: '#c5cac6',
  accent: '#239f40',
  accentInk: '#f7f7f5',
  warn: '#da0000',
  danger: '#da0000',
  shadow: '0 24px 60px rgba(0, 0, 0, 0.38)',
  bar: '#141716',
  btn: '#222623',
  hover: '#2a2f2c',
  menu: '#1c201e',
  lineStrong: '#3a403c',
  overlay: 'rgba(8, 10, 9, 0.55)',
  scrollbar: '#3a3f3c',
  toast: '#16321f',
  toastLine: '#239f40',
  toastErr: '#3a1214',
  toastErrLine: '#da0000',
}

const MYS_CHROME: ChromeTheme = {
  bg: '#0c1214',
  raise: '#141c1f',
  sink: '#0a0f11',
  line: '#263236',
  text: '#d7e3e6',
  muted: '#8ea0a6',
  accent: '#39b54a',
  accentInk: '#06140a',
  warn: '#e2b15a',
  danger: '#da0000',
  shadow: '0 24px 60px rgba(0, 0, 0, 0.38)',
  bar: '#10181b',
  btn: '#1c272b',
  hover: '#1c282c',
  menu: '#1b262a',
  lineStrong: '#3d5158',
  overlay: 'rgba(8, 12, 13, 0.55)',
  scrollbar: '#314046',
  toast: '#16321f',
  toastLine: '#239f40',
  toastErr: '#3a1214',
  toastErrLine: '#da0000',
}

export const APP_THEMES: AppTheme[] = [
  theme('mys', 'Mys', 'night', {
    bg: '#0e1416', fg: '#d7e3e6', cursor: '#39b54a', selection: '#1d4c28', accent: '#39b54a',
    black: '#1a2226', red: '#da0000', green: '#39b54a', yellow: '#e5c07b', blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#d7e3e6',
    brightBlack: '#5c6b73', brightRed: '#ff4d4d', brightGreen: '#6fd87a', brightYellow: '#f3d7a1', brightBlue: '#8ac4ff', brightMagenta: '#e3a6f5', brightCyan: '#7ad7e0', brightWhite: '#ffffff',
  }, MYS_CHROME),
  theme('tokyo-night', 'Tokyo Night', 'night', {
    bg: '#1a1b26', fg: '#c0caf5', cursor: '#c0caf5', selection: '#33467c', accent: '#7aa2f7',
    black: '#15161e', red: '#f7768e', green: '#9ece6a', yellow: '#e0af68', blue: '#7aa2f7', magenta: '#bb9af7', cyan: '#7dcfff', white: '#a9b1d6',
    brightBlack: '#414868', brightRed: '#ff9db1', brightGreen: '#b9f27c', brightYellow: '#ffd28a', brightBlue: '#a9c4ff', brightMagenta: '#d4bcff', brightCyan: '#b4e8ff', brightWhite: '#c0caf5',
  }),
  theme('catppuccin-mocha', 'Catppuccin Mocha', 'night', {
    bg: '#1e1e2e', fg: '#cdd6f4', cursor: '#f5e0dc', selection: '#45475a', accent: '#cba6f7',
    black: '#45475a', red: '#f38ba8', green: '#a6e3a1', yellow: '#f9e2af', blue: '#89b4fa', magenta: '#f5c2e7', cyan: '#94e2d5', white: '#bac2de',
    brightBlack: '#585b70', brightRed: '#f38ba8', brightGreen: '#a6e3a1', brightYellow: '#f9e2af', brightBlue: '#89b4fa', brightMagenta: '#f5c2e7', brightCyan: '#94e2d5', brightWhite: '#a6adc8',
  }),
  theme('dracula', 'Dracula', 'night', {
    bg: '#282a36', fg: '#f8f8f2', cursor: '#f8f8f2', selection: '#44475a', accent: '#bd93f9',
    black: '#21222c', red: '#ff5555', green: '#50fa7b', yellow: '#f1fa8c', blue: '#bd93f9', magenta: '#ff79c6', cyan: '#8be9fd', white: '#f8f8f2',
    brightBlack: '#6272a4', brightRed: '#ff6e6e', brightGreen: '#69ff94', brightYellow: '#ffffa5', brightBlue: '#d6acff', brightMagenta: '#ff92df', brightCyan: '#a4ffff', brightWhite: '#ffffff',
  }),
  theme('nord', 'Nord', 'night', {
    bg: '#2e3440', fg: '#d8dee9', cursor: '#d8dee9', selection: '#434c5e', accent: '#88c0d0',
    black: '#3b4252', red: '#bf616a', green: '#a3be8c', yellow: '#ebcb8b', blue: '#81a1c1', magenta: '#b48ead', cyan: '#88c0d0', white: '#e5e9f0',
    brightBlack: '#4c566a', brightRed: '#bf616a', brightGreen: '#a3be8c', brightYellow: '#ebcb8b', brightBlue: '#81a1c1', brightMagenta: '#b48ead', brightCyan: '#8fbcbb', brightWhite: '#eceff4',
  }),
  theme('one-dark', 'One Dark', 'night', {
    bg: '#282c34', fg: '#abb2bf', cursor: '#528bff', selection: '#3e4451', accent: '#61afef',
    black: '#282c34', red: '#e06c75', green: '#98c379', yellow: '#e5c07b', blue: '#61afef', magenta: '#c678dd', cyan: '#56b6c2', white: '#abb2bf',
    brightBlack: '#5c6370', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#e5c07b', brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff',
  }),
  theme('gruvbox-dark', 'Gruvbox Dark', 'night', {
    bg: '#282828', fg: '#ebdbb2', cursor: '#ebdbb2', selection: '#504945', accent: '#fabd2f',
    black: '#282828', red: '#cc241d', green: '#98971a', yellow: '#d79921', blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#a89984',
    brightBlack: '#928374', brightRed: '#fb4934', brightGreen: '#b8bb26', brightYellow: '#fabd2f', brightBlue: '#83a598', brightMagenta: '#d3869b', brightCyan: '#8ec07c', brightWhite: '#ebdbb2',
  }),
  theme('rose-pine', 'Rosé Pine', 'night', {
    bg: '#191724', fg: '#e0def4', cursor: '#e0def4', selection: '#403d52', accent: '#c4a7e7',
    black: '#26233a', red: '#eb6f92', green: '#31748f', yellow: '#f6c177', blue: '#9ccfd8', magenta: '#c4a7e7', cyan: '#ebbcba', white: '#e0def4',
    brightBlack: '#6e6a86', brightRed: '#eb6f92', brightGreen: '#31748f', brightYellow: '#f6c177', brightBlue: '#9ccfd8', brightMagenta: '#c4a7e7', brightCyan: '#ebbcba', brightWhite: '#e0def4',
  }),
  theme('kanagawa', 'Kanagawa', 'night', {
    bg: '#1f1f28', fg: '#dcd7ba', cursor: '#c8c093', selection: '#2d4f67', accent: '#7e9cd8',
    black: '#090618', red: '#c34043', green: '#76946a', yellow: '#c0a36e', blue: '#7e9cd8', magenta: '#957fb8', cyan: '#6a9589', white: '#c8c093',
    brightBlack: '#727169', brightRed: '#e82424', brightGreen: '#98bb6c', brightYellow: '#e6c384', brightBlue: '#7fb4ca', brightMagenta: '#938aa9', brightCyan: '#7aa89f', brightWhite: '#dcd7ba',
  }),
  theme('everforest', 'Everforest', 'night', {
    bg: '#2d353b', fg: '#d3c6aa', cursor: '#d3c6aa', selection: '#4a555b', accent: '#a7c080',
    black: '#343f44', red: '#e67e80', green: '#a7c080', yellow: '#dbbc7f', blue: '#7fbbb3', magenta: '#d699b6', cyan: '#83c092', white: '#d3c6aa',
    brightBlack: '#7a8478', brightRed: '#e67e80', brightGreen: '#a7c080', brightYellow: '#dbbc7f', brightBlue: '#7fbbb3', brightMagenta: '#d699b6', brightCyan: '#83c092', brightWhite: '#fdf6e3',
  }),
  theme('night-owl', 'Night Owl', 'night', {
    bg: '#011627', fg: '#d6deeb', cursor: '#80a4c2', selection: '#1d3b53', accent: '#82aaff',
    black: '#011627', red: '#ef5350', green: '#22da6e', yellow: '#addb67', blue: '#82aaff', magenta: '#c792ea', cyan: '#21c7a8', white: '#ffffff',
    brightBlack: '#575656', brightRed: '#ef5350', brightGreen: '#22da6e', brightYellow: '#ffeb95', brightBlue: '#82aaff', brightMagenta: '#c792ea', brightCyan: '#7fdbca', brightWhite: '#ffffff',
  }),
  theme('synthwave', "Synthwave '84", 'night', {
    bg: '#262335', fg: '#ffffff', cursor: '#f97e72', selection: '#463465', accent: '#ff7edb',
    black: '#262335', red: '#fe4450', green: '#72f1b8', yellow: '#fede5d', blue: '#03edf9', magenta: '#ff7edb', cyan: '#03edf9', white: '#ffffff',
    brightBlack: '#614d85', brightRed: '#fe4450', brightGreen: '#72f1b8', brightYellow: '#fede5d', brightBlue: '#36f9f6', brightMagenta: '#ff7edb', brightCyan: '#03edf9', brightWhite: '#ffffff',
  }),
  theme('ayu-dark', 'Ayu Dark', 'night', {
    bg: '#0b0e14', fg: '#bfbdb6', cursor: '#e6b450', selection: '#1c212b', accent: '#e6b450',
    black: '#01060e', red: '#ea6c73', green: '#91b362', yellow: '#f9af4f', blue: '#53bdfa', magenta: '#fae994', cyan: '#90e1c6', white: '#c7c7c7',
    brightBlack: '#686868', brightRed: '#f07178', brightGreen: '#c2d94c', brightYellow: '#ffb454', brightBlue: '#59c2ff', brightMagenta: '#ffee99', brightCyan: '#95e6cb', brightWhite: '#ffffff',
  }),
  theme('palenight', 'Palenight', 'night', {
    bg: '#292d3e', fg: '#a6accd', cursor: '#ffcc00', selection: '#3c435e', accent: '#c792ea',
    black: '#292d3e', red: '#f07178', green: '#c3e88d', yellow: '#ffcb6b', blue: '#82aaff', magenta: '#c792ea', cyan: '#89ddff', white: '#d0d0d0',
    brightBlack: '#434758', brightRed: '#ff8b92', brightGreen: '#ddffa7', brightYellow: '#ffe585', brightBlue: '#9cc4ff', brightMagenta: '#e1acff', brightCyan: '#a3f7ff', brightWhite: '#ffffff',
  }),
  theme('iran', 'Iran Dark', 'night', {
    bg: '#101211', fg: '#f7f7f5', cursor: '#ffffff', selection: '#5c1820', accent: '#239f40',
    black: '#141716', red: '#da0000', green: '#239f40', yellow: '#f7f7f5', blue: '#d8ddd9', magenta: '#ff4d4d', cyan: '#3dcc62', white: '#f7f7f5',
    brightBlack: '#8d938f', brightRed: '#ff3b3b', brightGreen: '#3dcc62', brightYellow: '#ffffff', brightBlue: '#ffffff', brightMagenta: '#ff6b6b', brightCyan: '#7dffa0', brightWhite: '#ffffff',
  }, IRAN_CHROME),
  theme('paper', 'Paper', 'day', {
    bg: '#f6f3ea', fg: '#2c2825', cursor: '#0f6e62', selection: '#d9ecdf', accent: '#0f6e62',
    black: '#2c2825', red: '#a33b32', green: '#2f7d4f', yellow: '#8a5a12', blue: '#1d5c91', magenta: '#7a3e78', cyan: '#0f6e62', white: '#f6f3ea',
    brightBlack: '#6d675f', brightRed: '#c4544a', brightGreen: '#3f9a64', brightYellow: '#b07a2a', brightBlue: '#2d78b5', brightMagenta: '#9a5a98', brightCyan: '#1b8b7c', brightWhite: '#ffffff',
  }),
  theme('catppuccin-latte', 'Catppuccin Latte', 'day', {
    bg: '#eff1f5', fg: '#4c4f69', cursor: '#dc8a78', selection: '#acb0be', accent: '#8839ef',
    black: '#5c5f77', red: '#d20f39', green: '#40a02b', yellow: '#df8e1d', blue: '#1e66f5', magenta: '#ea76cb', cyan: '#179299', white: '#acb0be',
    brightBlack: '#6c6f85', brightRed: '#d20f39', brightGreen: '#40a02b', brightYellow: '#df8e1d', brightBlue: '#1e66f5', brightMagenta: '#ea76cb', brightCyan: '#179299', brightWhite: '#bcc0cc',
  }),
  theme('github-light', 'GitHub Light', 'day', {
    bg: '#ffffff', fg: '#24292f', cursor: '#0969da', selection: '#b6d9f5', accent: '#0969da',
    black: '#24292f', red: '#cf222e', green: '#116329', yellow: '#9a6700', blue: '#0969da', magenta: '#8250df', cyan: '#1b7c83', white: '#6e7781',
    brightBlack: '#57606a', brightRed: '#a40e26', brightGreen: '#1a7f37', brightYellow: '#633c01', brightBlue: '#218bff', brightMagenta: '#a475f9', brightCyan: '#3192aa', brightWhite: '#8c959f',
  }),
  theme('solarized-light', 'Solarized Light', 'day', {
    bg: '#fdf6e3', fg: '#657b83', cursor: '#657b83', selection: '#eee8d5', accent: '#268bd2',
    black: '#073642', red: '#dc322f', green: '#859900', yellow: '#b58900', blue: '#268bd2', magenta: '#d33682', cyan: '#2aa198', white: '#eee8d5',
    brightBlack: '#002b36', brightRed: '#cb4b16', brightGreen: '#586e75', brightYellow: '#657b83', brightBlue: '#839496', brightMagenta: '#6c71c4', brightCyan: '#93a1a1', brightWhite: '#fdf6e3',
  }),
  theme('gruvbox-light', 'Gruvbox Light', 'day', {
    bg: '#fbf1c7', fg: '#3c3836', cursor: '#3c3836', selection: '#ebdbb2', accent: '#076678',
    black: '#3c3836', red: '#cc241d', green: '#98971a', yellow: '#d79921', blue: '#458588', magenta: '#b16286', cyan: '#689d6a', white: '#7c6f64',
    brightBlack: '#928374', brightRed: '#9d0006', brightGreen: '#79740e', brightYellow: '#b57614', brightBlue: '#076678', brightMagenta: '#8f3f71', brightCyan: '#427b58', brightWhite: '#3c3836',
  }),
  theme('one-light', 'One Light', 'day', {
    bg: '#fafafa', fg: '#383a42', cursor: '#526fff', selection: '#e5e5e6', accent: '#4078f2',
    black: '#383a42', red: '#e45649', green: '#50a14f', yellow: '#c18401', blue: '#4078f2', magenta: '#a626a4', cyan: '#0184bc', white: '#fafafa',
    brightBlack: '#4f525e', brightRed: '#e06c75', brightGreen: '#98c379', brightYellow: '#d19a66', brightBlue: '#61afef', brightMagenta: '#c678dd', brightCyan: '#56b6c2', brightWhite: '#ffffff',
  }),
  theme('rose-pine-dawn', 'Rosé Pine Dawn', 'day', {
    bg: '#faf4ed', fg: '#575279', cursor: '#575279', selection: '#dfdad9', accent: '#907aa9',
    black: '#f2e9e1', red: '#b4637a', green: '#286983', yellow: '#ea9d34', blue: '#56949f', magenta: '#907aa9', cyan: '#d7827e', white: '#575279',
    brightBlack: '#9893a5', brightRed: '#b4637a', brightGreen: '#286983', brightYellow: '#ea9d34', brightBlue: '#56949f', brightMagenta: '#907aa9', brightCyan: '#d7827e', brightWhite: '#575279',
  }),
  theme('tokyo-day', 'Tokyo Night Day', 'day', {
    bg: '#e1e2e7', fg: '#3760bf', cursor: '#3760bf', selection: '#b7c1e3', accent: '#2e7de9',
    black: '#e9e9ed', red: '#f52a65', green: '#587539', yellow: '#8c6c3e', blue: '#2e7de9', magenta: '#9854f1', cyan: '#007197', white: '#6172b0',
    brightBlack: '#a1a6c5', brightRed: '#f52a65', brightGreen: '#587539', brightYellow: '#8c6c3e', brightBlue: '#2e7de9', brightMagenta: '#9854f1', brightCyan: '#007197', brightWhite: '#3760bf',
  }),
  theme('ayu-light', 'Ayu Light', 'day', {
    bg: '#fafafa', fg: '#5c6773', cursor: '#ff9940', selection: '#d1e4f4', accent: '#ff9940',
    black: '#000000', red: '#f07171', green: '#86b300', yellow: '#f2ae49', blue: '#399ee6', magenta: '#a37acc', cyan: '#4cbf99', white: '#d1d1d1',
    brightBlack: '#5c6773', brightRed: '#f07171', brightGreen: '#86b300', brightYellow: '#f2ae49', brightBlue: '#399ee6', brightMagenta: '#a37acc', brightCyan: '#4cbf99', brightWhite: '#ffffff',
  }),
  theme('everforest-light', 'Everforest Light', 'day', {
    bg: '#fdf6e3', fg: '#5c6a72', cursor: '#5c6a72', selection: '#e6e2cc', accent: '#3a94c5',
    black: '#5c6a72', red: '#f85552', green: '#8da101', yellow: '#dfa000', blue: '#3a94c5', magenta: '#df69ba', cyan: '#35a77c', white: '#fdf6e3',
    brightBlack: '#829181', brightRed: '#f85552', brightGreen: '#8da101', brightYellow: '#dfa000', brightBlue: '#3a94c5', brightMagenta: '#df69ba', brightCyan: '#35a77c', brightWhite: '#5c6a72',
  }),
]

const BY_ID = new Map(APP_THEMES.map((item) => [item.id, item]))

export function themeOf(name: string): AppTheme {
  return BY_ID.get(normalizeTheme(name)) ?? APP_THEMES[0]
}

export function applyChrome(name: string): void {
  const { chrome, mode, id } = themeOf(name)
  const root = document.documentElement
  root.dataset.mode = mode
  root.dataset.theme = id
  const vars: Record<string, string> = {
    '--bg': chrome.bg,
    '--raise': chrome.raise,
    '--sink': chrome.sink,
    '--line': chrome.line,
    '--text': chrome.text,
    '--muted': chrome.muted,
    '--accent': chrome.accent,
    '--accent-ink': chrome.accentInk,
    '--warn': chrome.warn,
    '--danger': chrome.danger,
    '--shadow': chrome.shadow,
    '--bar': chrome.bar,
    '--btn': chrome.btn,
    '--hover': chrome.hover,
    '--menu': chrome.menu,
    '--line-strong': chrome.lineStrong,
    '--overlay': chrome.overlay,
    '--scrollbar': chrome.scrollbar,
    '--toast': chrome.toast,
    '--toast-line': chrome.toastLine,
    '--toast-err': chrome.toastErr,
    '--toast-err-line': chrome.toastErrLine,
  }
  for (const [key, value] of Object.entries(vars)) root.style.setProperty(key, value)
}
