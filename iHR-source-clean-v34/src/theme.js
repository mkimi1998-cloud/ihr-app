export const COLOR_THEMES = [
  {
    id: 'terracotta',
    label: '🔴 Merah Bata (Default)',
    light: { primary: '#BC4A32', primaryText: '#BC4A32', primarySoft: '#F6E4DF', navy: '#1F2D55' },
    dark:  { primary: '#C4513A', primaryText: '#FF8F75', primarySoft: '#3A2420', navy: '#A9BBEA' },
  },
  {
    id: 'blue',
    label: '🔵 Biru Diraja (Blue)',
    light: { primary: '#1D4ED8', primaryText: '#1D4ED8', primarySoft: '#DBEAFE', navy: '#1E3A8A' },
    dark:  { primary: '#3B82F6', primaryText: '#93C5FD', primarySoft: '#1E293B', navy: '#93C5FD' },
  },
  {
    id: 'green',
    label: '🟢 Hijau Hutan (Green)',
    light: { primary: '#15803D', primaryText: '#15803D', primarySoft: '#DCFCE7', navy: '#14532D' },
    dark:  { primary: '#22C55E', primaryText: '#86EFAC', primarySoft: '#142E20', navy: '#86EFAC' },
  },
  {
    id: 'wood',
    label: '🪵 Kayu Jati (Wood)',
    light: { primary: '#78350F', primaryText: '#78350F', primarySoft: '#FEF3C7', navy: '#451A03' },
    dark:  { primary: '#B45309', primaryText: '#FCD34D', primarySoft: '#332211', navy: '#FDE68A' },
  },
  {
    id: 'purple',
    label: '🟣 Ungu Diraja (Purple)',
    light: { primary: '#6D28D9', primaryText: '#6D28D9', primarySoft: '#EDE9FE', navy: '#4C1D95' },
    dark:  { primary: '#8B5CF6', primaryText: '#C4B5FD', primarySoft: '#2E1E47', navy: '#DDD6FE' },
  },
];

export const light = {
  bg: '#EEEDEE', card: '#FFFFFF', line: '#D9D5D7', ink: '#14141A', mute: '#6B6B75', field: '#FAF9FA',
  primary: '#BC4A32', primaryText: '#BC4A32', primarySoft: '#F6E4DF', onPrimary: '#FFFFFF',
  accent: '#FDC107', navy: '#1F2D55', pill: '#CDD3DB',
  ok: '#2E7D4F', okBg: '#E5F3EA', okLine: '#BFE0CB', bad: '#B3261E', badBg: '#FBE9E7', badLine: '#F2C6C1',
};
export const dark = {
  bg: '#121214', card: '#1D1D21', line: '#34343B', ink: '#F2F2F5', mute: '#A3A3AE', field: '#26262B',
  primary: '#C4513A', primaryText: '#FF8F75', primarySoft: '#3A2420', onPrimary: '#FFFFFF',
  accent: '#FDC107', navy: '#A9BBEA', pill: '#2B3245',
  ok: '#7FD6A0', okBg: '#16301F', okLine: '#2C5A40', bad: '#FFB4AB', badBg: '#3C1F1D', badLine: '#6B2E2A',
};
export const themes = { light, dark };

export function buildTheme(scheme = 'light', colorId = 'terracotta') {
  const base = scheme === 'dark' ? dark : light;
  const found = COLOR_THEMES.find((t) => t.id === colorId) || COLOR_THEMES[0];
  const palette = scheme === 'dark' ? found.dark : found.light;
  return { ...base, ...palette };
}
