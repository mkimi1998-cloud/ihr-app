/**
 * iHR Modern & Classic Design System & Theme Engine
 * Provides 4 theme UI palettes, Classic vs Modern styles, and vector icon mappings.
 */

export const COLOR_THEMES = [
  {
    id: 'terracotta',
    label: '🔴 Merah Bata (Klasik Default)',
    light: { primary: '#BC4A32', primaryText: '#BC4A32', primarySoft: '#F6E4DF', navy: '#1F2D55', accent: '#F59E0B' },
    dark:  { primary: '#E05A47', primaryText: '#FF9E8A', primarySoft: '#3D1F1A', navy: '#A9BBEA', accent: '#FBBF24' },
  },
  {
    id: 'emerald',
    label: '🟢 Zamrud Teal (Modern Mint)',
    light: { primary: '#0D9488', primaryText: '#0D9488', primarySoft: '#CCFBF1', navy: '#134E4A', accent: '#10B981' },
    dark:  { primary: '#14B8A6', primaryText: '#5EEAD4', primarySoft: '#113835', navy: '#99F6E4', accent: '#34D399' },
  },
  {
    id: 'blue',
    label: '🔵 Biru Nilam (Royal Blue)',
    light: { primary: '#2563EB', primaryText: '#2563EB', primarySoft: '#DBEAFE', navy: '#1E3A8A', accent: '#3B82F6' },
    dark:  { primary: '#3B82F6', primaryText: '#93C5FD', primarySoft: '#1E293B', navy: '#BFDBFE', accent: '#60A5FA' },
  },
  {
    id: 'cyber',
    label: '🌌 Siber OLED (Neon Cyber)',
    light: { primary: '#4F46E5', primaryText: '#4F46E5', primarySoft: '#EEF2FF', navy: '#312E81', accent: '#06B6D4' },
    dark:  { primary: '#06B6D4', primaryText: '#67E8F9', primarySoft: '#083344', navy: '#A5F3FC', accent: '#22D3EE' },
  },
  {
    id: 'purple',
    label: '🟣 Ungu Diraja (Imperial Purple)',
    light: { primary: '#7C3AED', primaryText: '#7C3AED', primarySoft: '#EDE9FE', navy: '#4C1D95', accent: '#8B5CF6' },
    dark:  { primary: '#8B5CF6', primaryText: '#C4B5FD', primarySoft: '#2E1065', navy: '#DDD6FE', accent: '#A78BFA' },
  },
  {
    id: 'amber',
    label: '🟠 Amber Senja (Warm Sunset)',
    light: { primary: '#D97706', primaryText: '#D97706', primarySoft: '#FEF3C7', navy: '#78350F', accent: '#F59E0B' },
    dark:  { primary: '#F59E0B', primaryText: '#FDE68A', primarySoft: '#451A03', navy: '#FCD34D', accent: '#FBBF24' },
  },
  {
    id: 'pink',
    label: '🩷 Ros Muda (Sakura Pink)',
    light: { primary: '#DB2777', primaryText: '#DB2777', primarySoft: '#FCE7F3', navy: '#831843', accent: '#EC4899' },
    dark:  { primary: '#EC4899', primaryText: '#F472B6', primarySoft: '#500724', navy: '#FBCFE8', accent: '#F472B6' },
  },
  {
    id: 'gold',
    label: '🟡 Emas Surya (Golden Sunlight)',
    light: { primary: '#CA8A04', primaryText: '#CA8A04', primarySoft: '#FEF9C3', navy: '#713F12', accent: '#EAB308' },
    dark:  { primary: '#EAB308', primaryText: '#FEF08A', primarySoft: '#422006', navy: '#FEF08A', accent: '#FACC15' },
  },
];

export const UI_STYLES = [
  { id: 'classic', label: 'Klasik (Default Theme)' },
  { id: 'modern', label: 'Moden (New Vector Theme)' },
];

export const light = {
  bg: '#F8FAFC',
  card: '#FFFFFF',
  cardBorder: '#E2E8F0',
  line: '#E2E8F0',
  ink: '#0F172A',
  inkSecondary: '#334155',
  mute: '#64748B',
  field: '#F1F5F9',
  fieldBorder: '#CBD5E1',
  primary: '#BC4A32',
  primaryText: '#BC4A32',
  primarySoft: '#F6E4DF',
  onPrimary: '#FFFFFF',
  accent: '#F59E0B',
  navy: '#1F2D55',
  pill: '#E2E8F0',
  ok: '#10B981',
  okBg: '#ECFDF5',
  okLine: '#A7F3D0',
  bad: '#EF4444',
  badBg: '#FEF2F2',
  badLine: '#FECACA',
  warn: '#F59E0B',
  warnBg: '#FFFBEB',
  warnLine: '#FDE68A',
  info: '#3B82F6',
  infoBg: '#EFF6FF',
  infoLine: '#BFDBFE',
  shadowColor: '#0F172A',
};

export const dark = {
  bg: '#0B0F19',
  card: '#151D2A',
  cardBorder: '#232E42',
  line: '#232E42',
  ink: '#F8FAFC',
  inkSecondary: '#CBD5E1',
  mute: '#94A3B8',
  field: '#1E293B',
  fieldBorder: '#334155',
  primary: '#E05A47',
  primaryText: '#FF9E8A',
  primarySoft: '#3D1F1A',
  onPrimary: '#FFFFFF',
  accent: '#FBBF24',
  navy: '#A9BBEA',
  pill: '#1E293B',
  ok: '#34D399',
  okBg: '#064E3B',
  okLine: '#047857',
  bad: '#F87171',
  badBg: '#451212',
  badLine: '#991B1B',
  warn: '#FBBF24',
  warnBg: '#451A03',
  warnLine: '#B45309',
  info: '#60A5FA',
  infoBg: '#1E3A8A',
  infoLine: '#1D4ED8',
  shadowColor: '#000000',
};

export const themes = { light, dark };

/**
 * Builds an active theme palette based on dark/light scheme, color ID, and UI style
 */
export function buildTheme(scheme = 'light', colorId = 'terracotta', uiStyle = 'modern') {
  const base = scheme === 'dark' ? dark : light;
  const found = COLOR_THEMES.find((t) => t.id === colorId) || COLOR_THEMES[0];
  const palette = scheme === 'dark' ? found.dark : found.light;
  return { ...base, ...palette, scheme, colorId, uiStyle };
}

/**
 * Maps raw emoji characters or strings to clean MaterialIcons icon names
 */
export const ICON_MAP = {
  '👤': 'person',
  '⚙️': 'settings',
  '📍': 'location-on',
  '📌': 'pin-drop',
  '🛰': 'satellite-alt',
  '🧭': 'explore',
  '🎯': 'my-location',
  '🔄': 'sync',
  '🔍': 'search',
  '🔐': 'lock',
  '🌐': 'language',
  '📊': 'bar-chart',
  'ℹ️': 'info',
  '📤': 'send',
  '⚡': 'bolt',
  '🔲': 'qr-code',
  '✅': 'check-circle',
  '📛': 'badge',
  '🔢': 'format-list-numbered',
  '🎨': 'palette',
  '⏰': 'access-time',
  '🔔': 'notifications',
  '♿': 'accessibility',
  '🔊': 'volume-up',
  '📱': 'smartphone',
  '🚀': 'rocket-launch',
  '🔗': 'link',
  '🗂': 'folder',
  '🧳': 'work',
  '🖼': 'image',
  '⏱': 'timer',
  '📸': 'photo-camera',
  '☁️': 'cloud',
  '🤳': 'face-retouching-natural',
  '🛡': 'security',
  '💬': 'comment',
};

export function getIconName(rawIcon) {
  if (!rawIcon) return null;
  if (ICON_MAP[rawIcon]) return ICON_MAP[rawIcon];
  return rawIcon;
}
