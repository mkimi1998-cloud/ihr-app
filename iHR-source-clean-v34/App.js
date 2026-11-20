import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, Image, Linking, Platform, Pressable, RefreshControl, SafeAreaView, ScrollView, StatusBar as RNBar, StyleSheet, Text, TextInput, useColorScheme, Vibration, View, Switch, Modal } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as Location from 'expo-location';
import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import * as Haptics from 'expo-haptics';
import * as Notifications from 'expo-notifications';
import * as Speech from 'expo-speech';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { MaterialIcons } from '@expo/vector-icons';
import * as ImageManipulator from 'expo-image-manipulator';
import { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import { WebView } from 'react-native-webview';
import { BarCodeScanner } from 'expo-barcode-scanner';
import { COLOR_THEMES, buildTheme } from './src/theme';
import { BASE_URL, EP, addLocalTag, call, clearSession, deviceId, findPhoto, getLocalTags, kerjaLuarFields, loadSession, parseReference, parseTabletLocations, peek, saveDeviceId, saveSession, unwrap } from './src/api';

const GITHUB_REPO = 'mkimi1998-cloud/ihr-app';
const triggerVibrate = (strong = true) => {
  try {
    if (strong) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      Vibration.vibrate([0, 140, 70, 140]);
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      Vibration.vibrate(90);
    }
  } catch (_) {}
};
const speakMalay = async (text, force = false) => {
  try {
    if (!text) return;
    if (!force) {
      const pref = await SecureStore.getItemAsync('OKU_VOICE_ENABLED').catch(() => null);
      const enabled = pref === 'true';
      if (!enabled) return;
    }
    Speech.stop();
    Speech.speak(String(text), {
      language: 'ms-MY',
      pitch: 1.0,
      rate: 0.94,
    });
  } catch (_) {}
};
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

const WBF_IN_OPTIONS = [
  { label: '07:30 AM (Awal WBF)', hour: 7, minute: 30 },
  { label: '07:45 AM (Disyorkan)', hour: 7, minute: 45 },
  { label: '08:00 AM', hour: 8, minute: 0 },
  { label: '08:15 AM', hour: 8, minute: 15 },
  { label: '08:30 AM', hour: 8, minute: 30 },
  { label: '08:45 AM', hour: 8, minute: 45 },
  { label: '08:55 AM (Akhir WBF)', hour: 8, minute: 55 },
];
const WBF_OUT_OPTIONS = [
  { label: '04:30 PM (Awal WBF)', hour: 16, minute: 30 },
  { label: '04:45 PM', hour: 16, minute: 45 },
  { label: '05:00 PM (Disyorkan)', hour: 17, minute: 0 },
  { label: '05:15 PM', hour: 17, minute: 15 },
  { label: '05:30 PM', hour: 17, minute: 30 },
  { label: '05:45 PM', hour: 17, minute: 45 },
  { label: '06:00 PM (Akhir WBF)', hour: 18, minute: 0 },
];

// Kira sasaran waktu pulang WBF (9 jam bekerja dari waktu masuk, antara 4:30 PM - 6:00 PM)
const computeWbfTargetOut = (firstMs) => {
  if (!firstMs) return null;
  const dIn = new Date(firstMs);
  const minIn = new Date(dIn.getFullYear(), dIn.getMonth(), dIn.getDate(), 7, 30, 0, 0).getTime();
  const maxIn = new Date(dIn.getFullYear(), dIn.getMonth(), dIn.getDate(), 9, 0, 0, 0).getTime();
  const effectiveIn = Math.min(Math.max(firstMs, minIn), maxIn);
  const targetOutMs = effectiveIn + 9 * 60 * 60 * 1000;
  const minOut = new Date(dIn.getFullYear(), dIn.getMonth(), dIn.getDate(), 16, 30, 0, 0).getTime();
  const maxOut = new Date(dIn.getFullYear(), dIn.getMonth(), dIn.getDate(), 18, 0, 0, 0).getTime();
  return Math.min(Math.max(targetOutMs, minOut), maxOut);
};

async function ensureNotificationChannel() {
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('ihr-wbf-reminders', {
      name: 'Peringatan Kehadiran WBF',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 220, 100, 220],
      lightColor: '#BC4A32',
      sound: 'default',
    }).catch(() => {});
  }
}

async function syncWbfReminders(opts = {}) {
  try {
    const enabledStr = opts.enabled !== undefined
      ? String(opts.enabled)
      : (await SecureStore.getItemAsync('WBF_REMINDER_ENABLED'));
    const enabled = enabledStr === null ? true : enabledStr === 'true';

    await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
    if (!enabled) return;

    const perm = await Notifications.getPermissionsAsync();
    if (perm.status !== 'granted') return;

    await ensureNotificationChannel();

    const inPref = opts.inTime || (await SecureStore.getItemAsync('WBF_IN_TIME')) || '07:45';
    const outPref = opts.outTime || (await SecureStore.getItemAsync('WBF_OUT_TIME')) || '17:00';
    const [inH, inM] = inPref.split(':').map((n) => parseInt(n, 10) || 0);
    const [outH, outM] = outPref.split(':').map((n) => parseInt(n, 10) || 0);

    const workProfile = opts.workProfile || (await SecureStore.getItemAsync('SERVER_WORK_PROFILE')) || 'WBF (Fleksibel)';
    const today = todayStr();
    const savedDate = await SecureStore.getItemAsync('WBF_TODAY_DATE');
    const firstMsStr = opts.firstMs !== undefined
      ? (opts.firstMs ? String(opts.firstMs) : '')
      : (savedDate === today ? (await SecureStore.getItemAsync('WBF_TODAY_FIRST_MS')) : '');
    const lastMsStr = opts.lastMs !== undefined
      ? (opts.lastMs ? String(opts.lastMs) : '')
      : (savedDate === today ? (await SecureStore.getItemAsync('WBF_TODAY_LAST_MS')) : '');

    const firstMs = firstMsStr ? Number(firstMsStr) : null;
    const lastMs = lastMsStr ? Number(lastMsStr) : null;
    const now = new Date();
    const hasClockedInToday = !!firstMs;
    const hasClockedOutToday = !!(lastMs && firstMs && lastMs > firstMs && new Date(lastMs).getHours() >= 16);

    // 1. Jadualkan peringatan Waktu Masuk (Isnin - Jumaat, 7:30 AM - 9:00 AM)
    // Jika hari ini sudah clock-in, jadualkan bermula esok hari bekerja sahaja; jika belum, termasuk hari ini.
    for (let weekday = 2; weekday <= 6; weekday++) {
      const isTodayWeekday = (now.getDay() + 1) === weekday;
      if (isTodayWeekday && hasClockedInToday) continue;
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '⏰ Peringatan Waktu Masuk (WBF)',
          body: `Sila imbas QR atau Geotagging masuk sekarang (Tempoh WBF: 7:30 PG – 9:00 PG · ${workProfile}).`,
          sound: 'default',
          data: { screen: 'qr' },
        },
        trigger: {
          weekday,
          hour: inH,
          minute: inM,
          repeats: true,
          channelId: 'ihr-wbf-reminders',
        },
      });
    }

    // 2. Jadualkan peringatan Waktu Keluar (Isnin - Jumaat, 4:30 PM - 6:00 PM)
    // Jika sudah clock-in hari ini, kira sasaran tepat 9 jam WBF dari waktu masuk pelayan!
    const targetOutMs = computeWbfTargetOut(firstMs);
    for (let weekday = 2; weekday <= 6; weekday++) {
      const isTodayWeekday = (now.getDay() + 1) === weekday;
      if (isTodayWeekday) {
        if (hasClockedOutToday) continue;
        if (targetOutMs && targetOutMs > Date.now()) {
          const targetDate = new Date(targetOutMs);
          const inLabel = fromMs(firstMs);
          const outLabel = fromMs(targetOutMs);
          await Notifications.scheduleNotificationAsync({
            content: {
              title: '🏁 Sasaran Waktu Pulang WBF Tercapai!',
              body: `Anda masuk pada ${inLabel}. Tempoh 9 jam ${workProfile} tamat pada ${outLabel} (4:30 PTG – 6:00 PTG). Sila imbas keluar.`,
              sound: 'default',
              data: { screen: 'qr' },
            },
            trigger: {
              date: targetDate,
              channelId: 'ihr-wbf-reminders',
            },
          });
          continue;
        }
      }
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '🏁 Peringatan Waktu Keluar (WBF)',
          body: `Jangan lupa rekod kehadiran keluar anda sebelum tamat sesi (Tempoh WBF: 4:30 PTG – 6:00 PTG · ${workProfile}).`,
          sound: 'default',
          data: { screen: 'qr' },
        },
        trigger: {
          weekday,
          hour: outH,
          minute: outM,
          repeats: true,
          channelId: 'ihr-wbf-reminders',
        },
      });
    }
  } catch (e) {
    console.log('Ralat jadual notifikasi WBF:', e);
  }
}
const QR_GEN_ENDPOINT = 'generate_code';
const MANUAL_LOC_LABEL = '✏️ Masukkan IMEI secara manual';
const PRESET_TABLET_LOCATIONS = [
  { label: 'Menara PGRM 1 - Tingkat 14', imei: '44f5bc3af8244d27a4233faa1821fff5' },
  { label: 'Menara PGRM 1 - Tingkat 15', imei: '67ba6c25a80b4edbb9888c31d467a625' },
  { label: 'Menara PGRM 1 - Tingkat 16', imei: '772df402efe84b8293e95509af4b31e5' },
  { label: 'Menara PGRM 2 - Tingkat 9', imei: 'e1974353a35a4e08b5658e206cdce442' },
  { label: 'Menara PGRM 2 - Tingkat 10', imei: '8fc4c9ed29f4412d85beaaa81dfe9ad9' },
  { label: 'Menara PGRM 2 - Tingkat 12', imei: '05749877bde249b4901890bf179d7d65' },
  { label: 'Pejabat MTIB Wilayah Tengah', imei: '1c25283c7d3146a49b500058a620b9d0' },
  { label: 'WISDEC 1', imei: '1d79da6cb6a344dba41ad46e5af99416' },
  { label: 'WISDEC 2', imei: '9fe47379d5ec4adabb7e4630fee26638' },
  { label: 'FIDEC 1', imei: '4cb985f553124ceeabed1fea44bc6fdb' },
  { label: 'FIDEC 3', imei: '99ac221842804e2ab28fc0a1fab56952' },
  { label: 'Pejabat MTIB Wilayah Timur (Kelantan)', imei: 'a58513c07d9b490fa8c06b352bc6b341' },
  { label: 'Pejabat MTIB Wilayah Utara (Pulau Pinang)', imei: 'e171d2ad794f48138618564ae7c27c28' },
  { label: 'Testing', imei: 'a200f0387bd94a1487d8e627301db185' },
];
const GPS_DEVICE_LOC_LABEL = '📍 Lokasi GPS Semasa Peranti (Auto)';
const MANUAL_FR_DEVICE_LABEL = '✏️ Masukkan IMEI Peranti FR secara manual';
const PRESET_FR_DEVICES = [
  { label: 'Menara PGRM 1 - Tingkat 17 (FR)', location: 'Menara PGRM 1 - Tingkat 17', imei: '772df402efe84b8293e95509af4b31e5' },
  { label: 'Menara PGRM 1 - Tingkat 14 (FR)', location: 'Menara PGRM 1 - Tingkat 14', imei: '44f5bc3af8244d27a4233faa1821fff5' },
  { label: 'Menara PGRM 1 - Tingkat 15 (FR)', location: 'Menara PGRM 1 - Tingkat 15', imei: '67ba6c25a80b4edbb9888c31d467a625' },
  { label: 'Menara PGRM 1 - Tingkat 16 (FR)', location: 'Menara PGRM 1 - Tingkat 16', imei: '772df402efe84b8293e95509af4b31e5' },
  { label: 'Menara PGRM 2 - Tingkat 9 (FR)', location: 'Menara PGRM 2 - Tingkat 9', imei: 'e1974353a35a4e08b5658e206cdce442' },
  { label: 'Menara PGRM 2 - Tingkat 10 (FR)', location: 'Menara PGRM 2 - Tingkat 10', imei: '8fc4c9ed29f4412d85beaaa81dfe9ad9' },
  { label: 'Menara PGRM 2 - Tingkat 12 (FR)', location: 'Menara PGRM 2 - Tingkat 12', imei: '05749877bde249b4901890bf179d7d65' },
  { label: 'Pejabat MTIB Wilayah Tengah (FR)', location: 'Pejabat MTIB Wilayah Tengah', imei: '1c25283c7d3146a49b500058a620b9d0' },
  { label: 'WISDEC 1 (FR)', location: 'WISDEC 1', imei: '1d79da6cb6a344dba41ad46e5af99416' },
  { label: 'WISDEC 2 (FR)', location: 'WISDEC 2', imei: '9fe47379d5ec4adabb7e4630fee26638' },
  { label: 'FIDEC 1 (FR)', location: 'FIDEC 1', imei: '4cb985f553124ceeabed1fea44bc6fdb' },
  { label: 'FIDEC 3 (FR)', location: 'FIDEC 3', imei: '99ac221842804e2ab28fc0a1fab56952' },
  { label: 'Pejabat MTIB Wilayah Timur (FR)', location: 'Pejabat MTIB Wilayah Timur (Kelantan)', imei: 'a58513c07d9b490fa8c06b352bc6b341' },
  { label: 'Pejabat MTIB Wilayah Utara (FR)', location: 'Pejabat MTIB Wilayah Utara (Pulau Pinang)', imei: 'e171d2ad794f48138618564ae7c27c28' },
  { label: 'Testing FR Terminal', location: 'Testing', imei: 'a200f0387bd94a1487d8e627301db185' },
];
const pad = (n) => String(n).padStart(2, '0');
const t12 = (h, m) => `${pad(h % 12 || 12)}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
const fromMs = (ms) => { const d = new Date(ms); return t12(d.getHours(), d.getMinutes()); };
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const parseYMD = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '').trim()); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : new Date(); };
const toYMD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toDMY = (v) => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v || '').trim()); return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v || ''); };
const ACTS = [[1, 'Kehadiran Biasa'], [2, 'BDR'], [3, 'Kerja Luar']];
const PORTAL = 'https://ihr.mtib.gov.my/user/leave_attendance/attendance_record';
const wrapName = (n, max = 26) => {
  const out = []; let cur = '';
  String(n || '').trim().split(/\s+/).forEach((w) => {
    if (cur && (cur + ' ' + w).length > max) { out.push(cur); cur = w; } else { cur = cur ? cur + ' ' + w : w; }
  });
  if (cur) out.push(cur);
  return out;
};
const colorOf = (c, fb) => { const v = String(c ?? '').trim(); return /^[0-9a-f]{6}$/i.test(v) ? '#' + v : v || fb; };

const parseVersionParts = (v) => {
  if (!v) return [0, 0, 0, 0];
  const clean = String(v).replace(/^[vV]/, '').trim();
  const matched = clean.match(/\d+/g);
  if (!matched) return [0, 0, 0, 0];
  const nums = matched.map((n) => parseInt(n, 10) || 0);
  while (nums.length < 4) nums.push(0);
  return nums;
};
const isRemoteNewer = (remoteVer, localVer) => {
  const r = parseVersionParts(remoteVer);
  const l = parseVersionParts(localVer);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rn = r[i] || 0;
    const ln = l[i] || 0;
    if (rn > ln) return true;
    if (rn < ln) return false;
  }
  return false;
};
const resolvePortalLocation = async (placeRaw, coordRaw) => {
  const cleanPlace = String(placeRaw || '').replace(/\s+/g, ' ').trim();
  const isHeader = /^(tempat\s*\/\s*jenis|tempat|lokasi|masa|kaedah|koordinat|-)$/i.test(cleanPlace);
  const isGenericAct = /^(kehadiran biasa|bdr|kerja luar)$/i.test(cleanPlace);
  const place = isHeader ? '' : cleanPlace;

  const m = /(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/.exec(String(coordRaw || ''));
  if (m) {
    const lat = parseFloat(m[1]);
    const lng = parseFloat(m[2]);
    let geoAddr = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    try {
      const rev = await Promise.race([
        Location.reverseGeocodeAsync({ latitude: lat, longitude: lng }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3500)),
      ]);
      if (rev && rev.length > 0) {
        const r = rev[0];
        const streetPart = [r.name, r.street, r.city, r.subregion].filter(Boolean).join(', ');
        if (streetPart) geoAddr = `${streetPart} (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
      }
    } catch (_) {}
    if (place && !isGenericAct) return `${place} · ${geoAddr}`;
    if (place && isGenericAct) return `${geoAddr} (${place})`;
    return geoAddr;
  }
  return place || '';
};
const saveTagDetails = async (method, lat, lng, customAddress = '') => {
  try {
    const d = new Date();
    const key = `TAG_DETAILS_${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const cur = JSON.parse((await SecureStore.getItemAsync(key)) || '[]');
    let address = customAddress || 'Sedang memproses lokasi...';
    
    if (customAddress) {
      address = customAddress;
    } else if (lat && lng) {
      try {
        const rev = await Promise.race([
          Location.reverseGeocodeAsync({ latitude: lat, longitude: lng }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
        ]);
        if (rev && rev.length > 0) {
          const r = rev[0];
          address = [r.name, r.street, r.city, r.subregion].filter(Boolean).join(', ');
        } else {
          address = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        }
      } catch (err) {
        address = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      }
    } else {
      address = method === 'fr' ? 'Pengecaman Wajah (Tanpa Lokasi GPS)' : 'Koordinat GPS tidak tersedia';
    }
    
    cur.push({ t: Date.now(), m: method, lat, lng, address });
    await SecureStore.setItemAsync(key, JSON.stringify(cur));
  } catch (e) { console.log("Ralat simpan tag details:", e); }
};
const ThemeCtx = createContext(null);
const useT = () => useContext(ThemeCtx);

const Btn = ({ label, onPress, kind = 'main', busy, disabled, icon, a11yHint }) => {
  const { C, s } = useT();
  return (
    <Pressable
      onPress={onPress}
      disabled={busy || disabled}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={a11yHint}
      accessibilityState={{ disabled: !!(busy || disabled), busy: !!busy }}
      style={({ pressed }) => [s.btn, kind === 'ghost' && s.btnGhost, (busy || disabled) && { opacity: 0.5 }, pressed && { opacity: 0.85 }]}
    >
      {busy ? <ActivityIndicator color={kind === 'ghost' ? C.primaryText : C.onPrimary} /> : (
        <View style={s.btnIn}>{icon ? <Text style={s.btnIc}>{icon}</Text> : null}<Text style={[s.btnTx, kind === 'ghost' && { color: C.primaryText }]}>{label}</Text></View>)}
    </Pressable>
  );
};
const Ico = ({ g, tint, size = 34 }) => {
  const { C } = useT(); const t = tint || C.primary;
  return (
    <View style={{ width: size, height: size, borderRadius: size * 0.3, backgroundColor: t + '26', alignItems: 'center', justifyContent: 'center' }}><Text style={{ fontSize: size * 0.5 }}>{g}</Text></View>
  );
};
const Card = ({ title, icon, tint, children }) => {
  const { s } = useT();
  return (
    <View style={s.card}>{title ? (<View style={s.cardH}>{icon ? <Ico g={icon} tint={tint} /> : null}<Text style={s.cardT}>{title}</Text></View>) : null}{children}</View>
  );
};
const Row = ({ icon, k, v, tint, last, selectable, stack }) => {
  const { s } = useT();
  return (
    <View style={[s.row, last && { borderBottomWidth: 0 }]}>
      {icon ? <Ico g={icon} tint={tint} size={28} /> : null}
      {stack ? (<View style={{ flex: 1 }}><Text style={s.rowK}>{k}</Text><Text style={[s.rowV, { textAlign: 'left', marginTop: 3, fontWeight: '700' }]} selectable={selectable}>{v}</Text></View>)
        : (<><Text style={s.rowK}>{k}</Text><Text style={s.rowV} selectable={selectable}>{v}</Text></>)}
    </View>
  );
};
const Collapse = ({ title, icon, summary, strong, warn, open, onToggle, children, tint }) => {
  const { C, s } = useT();
  return (
    <View style={s.card}>
      <Pressable onPress={onToggle} style={s.cardH} hitSlop={4}>
        {icon ? <Ico g={icon} tint={tint} /> : null}
        <View style={{ flex: 1 }}>
          <Text style={s.cardT}>{title}</Text>
          {!open && summary ? <Text numberOfLines={1} style={{ color: warn ? C.bad : strong ? C.ink : C.mute, fontSize: 13, fontWeight: strong ? '600' : '400', marginTop: 2 }}>{summary}</Text> : null}
        </View>
        <Text style={{ color: C.mute }}>{open ? '▲' : '▼'}</Text>
      </Pressable>
      {open ? children : null}
    </View>
  );
};

const Stat = ({ icon, label, value, tint, methodIcon, onPress }) => {
  const { s } = useT();
  return (
    <Pressable
      onPress={onPress}
      accessible={true}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value === '—' ? 'Tiada rekod' : value}`}
      accessibilityHint="Ketik dua kali untuk mendengar dan membaca butiran lokasi kehadiran"
      style={({ pressed }) => [
      s.stat, 
      { backgroundColor: tint + '12', borderColor: tint + '30' },
      pressed && { opacity: 0.6, backgroundColor: tint + '25' }
    ]}>
      <View style={s.statH}>
        <Ico g={icon} tint={tint} size={26} />
        <Text style={[s.statL, { color: tint }]}>{label}</Text>
      </View>
      <View style={{ marginTop: 10 }}>
        <Text style={[s.statV, { marginTop: 0 }]}>{value}</Text>
        {methodIcon ? (
          <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center' }}>
            {typeof methodIcon === 'string' ? (
              <Text style={{ fontSize: 24, opacity: 0.8 }}>{methodIcon}</Text>
            ) : (
              methodIcon
            )}
          </View>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 14, gap: 4 }}>
        <MaterialIcons name="touch-app" size={14} color={tint} style={{ opacity: 0.8 }} />
        <Text style={{ fontSize: 10, color: tint, fontWeight: '700', opacity: 0.8 }}>Klik untuk info</Text>
      </View>
    </Pressable>
  );
};

const Err = ({ msg }) => { const { C, s } = useT(); return msg ? <View style={s.err}><Text style={{ color: C.bad }}>{msg}</Text></View> : null; };
const Ok = ({ msg }) => { const { C, s } = useT(); return msg ? <View style={s.okBox}><Text style={{ color: C.ok }}>{msg}</Text></View> : null; };
const Top = ({ title, onBack, onTitleLongPress }) => {
  const { C, s } = useT();
  return (
    <View style={s.top}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            hitSlop={12}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Kembali ke Dashboard"
            accessibilityHint="Ketik dua kali untuk kembali ke skrin utama"
            style={{ width: 44, height: 44, borderRadius: 22, backgroundColor: C.field, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line }}
          >
            <Text style={{ color: C.ink, fontSize: 24, lineHeight: 28, marginLeft: -2 }}>‹</Text>
          </Pressable>
        ) : null}
        <Pressable onLongPress={onTitleLongPress}>
          <Text style={s.topT}>{title}</Text>
        </Pressable>
      </View>
    </View>
  );
};
const Select = ({ value, placeholder, options, onPick }) => {
  const { C, s } = useT(); const [open, setOpen] = useState(false);
  return (
    <View style={{ gap: 6 }}>
      <Pressable onPress={() => setOpen(!open)} style={[s.in, s.sel]}>
        <Text style={{ color: value ? C.ink : C.mute, fontSize: 16, flex: 1 }}>{value || placeholder}</Text>
        <Text style={{ color: C.mute }}>{open ? '▲' : '▼'}</Text>
      </Pressable>
      {open ? (<View style={s.selList}>{options.map((o, i) => (
        <Pressable key={o} onPress={() => { onPick(o); setOpen(false); }} style={[s.selItem, i === options.length - 1 && { borderBottomWidth: 0 }, o === value && { backgroundColor: C.primarySoft }]}>
          <Text style={{ color: C.ink, fontSize: 16 }}>{o}</Text>
        </Pressable>))}</View>) : null}
    </View>
  );
};
const DateField = ({ value, onPick, min }) => {
  const { C, s } = useT();
  const open = () => DateTimePickerAndroid.open({
    value: parseYMD(value), mode: 'date', minimumDate: min ? parseYMD(min) : undefined,
    onChange: (e, d) => { if (e?.type === 'set' && d) onPick(toYMD(d)); },
  });
  return (<Pressable onPress={open} style={[s.in, s.sel]}><Text style={{ color: C.ink, fontSize: 16, flex: 1 }}>{toDMY(value)}</Text><Text style={{ fontSize: 16 }}>📅</Text></Pressable>);
};

function Register({ onDone, initialName = '', initialNo = '' }) {
  const { C, s } = useT();
  const [name, setName] = useState(initialName); const [no, setNo] = useState(initialNo);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [dev, setDev] = useState(String(deviceId())); const [adv, setAdv] = useState(false);
  
  const formatName = (text) => text.replace(/\s+/g, ' ').trim();
  
  const cont = async () => {
    if (!no.trim()) return setErr('Sila masukkan nombor staff');
    await saveDeviceId(dev); 
    const formattedName = formatName(name);
    const sess = { staff_no: no.trim(), staff_id: '', name: formattedName }; 
    await saveSession(sess); 
    onDone(sess);
  };
  const submit = async () => {
    const formattedName = formatName(name);
    if (!formattedName || !no.trim()) return setErr('Sila masukkan nama dan nombor staff');
    setBusy(true); setErr('');
    if (initialNo && no.trim() === initialNo) {
       await saveDeviceId(dev);
       const sess = { staff_no: no.trim(), staff_id: '', name: formattedName };
       await saveSession(sess);
       setBusy(false);
       return onDone(sess);
    }
    try {
      await saveDeviceId(dev);
      const r = unwrap(await call(EP.register, { name: formattedName, staff_no: no.trim(), imei: deviceId() }));
      const sess = { staff_no: no.trim(), staff_id: r?.staff_id ?? r?.id ?? '', name: formatName(r?.name ?? formattedName) };
      await saveSession(sess); 
      onDone(sess);
    } catch (e) { 
       setErr(e.message); 
    } finally { 
       setBusy(false); 
    }
  };
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }} keyboardShouldPersistTaps="handled">
      <View style={s.regTopCentered}>
        <Pressable onLongPress={() => setAdv(!adv)} delayLongPress={1500} style={{ alignItems: 'center' }}>
          <Image source={require('./assets/icon.png')} style={{ width: 90, height: 90, marginBottom: 12 }} resizeMode="contain" />
          <Text style={s.logo}>iHR</Text>
          <Text style={s.sub}>Lembaga Perindustrian Kayu Malaysia</Text>
        </Pressable>
      </View>
      <View style={{ padding: 16, gap: 14 }}>
        <Card title="Daftar Pengguna Baru" icon="👤" tint={C.navy}>
          <Text style={s.lbl}>Nama penuh</Text>
          <TextInput style={s.in} value={name} onChangeText={setName} placeholder="Seperti dalam kad pengenalan" placeholderTextColor={C.mute} />
          <Text style={s.lbl}>Nombor staff</Text>
          <TextInput style={s.in} value={no} onChangeText={setNo} autoCapitalize="characters" placeholder="Contoh: 01234" placeholderTextColor={C.mute} />
          <Err msg={err} />
          <Btn label={initialNo ? "Log Masuk" : "Daftar"} onPress={submit} busy={busy} />
        </Card>
        {adv ? (<Card title="Tetapan lanjutan" icon="⚙️" tint={C.navy}>
          <Text style={s.lbl}>ID peranti. Tukar hanya jika perlu guna ID yang sudah didaftarkan untuk telefon ini.</Text>
          <TextInput style={s.in} value={dev} onChangeText={setDev} autoCapitalize="none" autoCorrect={false} />
          <Btn kind="ghost" label="Sudah berdaftar - teruskan" onPress={cont} />
        </Card>) : null}
        <Text style={s.hint}>Peranti ini akan didaftarkan bersama nombor staff anda.</Text>
      </View>
    </ScrollView>
  );
}

function Dashboard({ sess, go, onSess, onLogout }) {
  const { C, s, themeMode, changeTheme } = useT();
  const [data, setData] = useState(null); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(null); const [at, setAt] = useState(''); const [tags, setTags] = useState([]);
  const [photo, setPhoto] = useState(null); const [badPhoto, setBadPhoto] = useState(false);
  const [tagDetails, setTagDetails] = useState([]);
  const [portalToday, setPortalToday] = useState(null);
  const dashWebRef = useRef(null);
  
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const h = now.getHours();
  const greeting = h < 12 ? 'Selamat Pagi' : h < 15 ? 'Selamat Tengah Hari' : h < 19 ? 'Selamat Petang' : 'Selamat Malam';
  
  const load = useCallback(async () => {
    setBusy(true); setErr('');
    const d = new Date();
    const dashCacheKey = `DASHBOARD_CACHE_${sess.staff_no || 'DEFAULT'}`;
    const detailKey = `TAG_DETAILS_${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

    // 1. Paparkan data cache tempatan serta-merta tanpa menunggu pelayan
    try {
      const [localTags, detailsStr, syncedTodayStr, cachedDashStr] = await Promise.all([
        getLocalTags(),
        SecureStore.getItemAsync(detailKey).catch(() => null),
        SecureStore.getItemAsync('SYNCED_TODAY_PORTAL').catch(() => null),
        SecureStore.getItemAsync(dashCacheKey).catch(() => null),
      ]);
      setTags(localTags);
      if (detailsStr) {
        try { setTagDetails(JSON.parse(detailsStr)); } catch (_) {}
      }
      if (syncedTodayStr) {
        try {
          const parsedToday = JSON.parse(syncedTodayStr);
          if (parsedToday && parsedToday.date === todayStr()) {
            setPortalToday(parsedToday);
          }
        } catch (_) {}
      }
      if (cachedDashStr) {
        try {
          const cachedDash = JSON.parse(cachedDashStr);
          if (cachedDash && typeof cachedDash === 'object') {
            setData((prev) => prev || cachedDash);
            const cp = findPhoto(cachedDash);
            if (cp) { setPhoto((prev) => prev || cp); setBadPhoto(false); }
          }
        } catch (_) {}
      }
    } catch (_) {}

    // 2. Segerakkan data terkini daripada pelayan di latar belakang
    try {
      const r = await call(EP.dashboard, { staff_no: sess.staff_no, staff_id: sess.staff_id });
      setData(r); setOnline(true); setAt(new Date().toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit' }));
      SecureStore.setItemAsync(dashCacheKey, JSON.stringify(r)).catch(() => {});
      try { dashWebRef.current?.reload(); } catch (_) {}
      
      { const p = findPhoto(r); if (p) { setPhoto(p); setBadPhoto(false); } }
      const sd = r?.staff_data;
      if (sd?.staff_id && String(sd.staff_id) !== String(sess.staff_id)) { const ns = { staff_no: String(sd.staff_no ?? sess.staff_no), staff_id: String(sd.staff_id), name: sd.name || sess.name }; saveSession(ns); onSess && onSess(ns); }
    } catch (e) {
      setOnline(false);
      setErr(e.message.includes('HTTP 500') ? e.message + '\n\nPeranti ini belum dikaitkan dengan akaun di pelayan. ID peranti: ' + deviceId() : e.message);
    } finally { setBusy(false); }
  }, [sess]);
  
  useEffect(() => { load(); }, [load]);
  
  const handleLogout = () => {
    Alert.alert('Daftar Keluar', 'Adakah anda pasti mahu kembali ke paparan pendaftaran?', [
      { text: 'Batal', style: 'cancel' },
      { text: 'Ya', onPress: async () => { await clearSession(); onLogout(sess); } }
    ]);
  };
  
  const getMethodIcon = (m) => {
    if (m === 'qr') return (
      <>
        <MaterialIcons name="qr-code-2" size={18} color={C.ink} style={{ opacity: 0.7 }} />
        <Text style={{ color: C.mute, fontSize: 12, marginLeft: 6, fontWeight: '600' }}>Imbas QR</Text>
      </>
    );
    if (m === 'geo') return (
      <>
        <MaterialIcons name="map" size={18} color={C.ink} style={{ opacity: 0.7 }} />
        <Text style={{ color: C.mute, fontSize: 12, marginLeft: 6, fontWeight: '600' }}>Geo Tagging</Text>
      </>
    );
    if (m === 'fr') return (
      <>
        <MaterialIcons name="face" size={18} color={C.ink} style={{ opacity: 0.7 }} />
        <Text style={{ color: C.mute, fontSize: 12, marginLeft: 6, fontWeight: '600' }}>Wajah (FR)</Text>
      </>
    );
    return null;
  };
  
  const sd = data?.staff_data || {};
  const name = sd.name || sess.name || 'Pengguna';
  const hasSrv = !!data && ('first_tagging' in data || 'last_tagging' in data);
  
  const nowLimitMs = Date.now() + 120000;
  const isTodayMs = (ms) => {
    if (ms == null || ms > nowLimitMs) return false;
    const d = new Date(ms);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` === todayStr();
  };
  const msSrv = (v) => {
    const m = /(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})/.exec(String(v || ''));
    if (!m) return null;
    const ms = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]).getTime();
    return isTodayMs(ms) ? ms : null;
  };
  const ms12 = (v) => {
    const m = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(String(v || ''));
    if (!m) return null;
    const d = new Date();
    d.setHours((+m[1] % 12) + (/pm/i.test(m[3]) ? 12 : 0), +m[2], 0, 0);
    const ms = d.getTime();
    return ms <= nowLimitMs ? ms : null;
  };
  const tg = [...tags].filter((x) => isTodayMs(x.t)).sort((x, y) => x.t - y.t);
  
  const portalInMs = portalToday?.date === todayStr() ? ms12(portalToday.clockIn) : null;
  const portalOutMs = portalToday?.date === todayStr() ? ms12(portalToday.clockOut) : null;

  const firstCands = [hasSrv ? msSrv(data.first_tagging) : null, ms12(data?.msg?.clock_in), portalInMs, ...tg.map((x) => x.t)]
    .filter((v) => v != null && v <= nowLimitMs);
  let firstMs = firstCands.length ? Math.min(...firstCands) : null;
  const first = firstMs != null ? fromMs(firstMs) : null;
  const firstMatchTag = tg.find((x) => firstMs != null && Math.abs(x.t - firstMs) <= 120000);
  const firstM = (firstMatchTag ? firstMatchTag.m : '') || (portalToday?.inMethod || '') || (tg.length ? tg[0].m : '');
  
  let lastMs = null;
  const cands = [hasSrv ? msSrv(data.last_tagging) : null, ms12(data?.msg?.clock_out), portalOutMs, ...tg.map((x) => x.t)]
    .filter((v) => v != null && firstMs != null && v > firstMs && v <= nowLimitMs);
  if (cands.length) {
    lastMs = Math.max(...cands);
  } else if (tg.length >= 2 && firstMs != null && tg[tg.length - 1].t > tg[0].t) {
    lastMs = tg[tg.length - 1].t;
  }
  const last = lastMs != null ? fromMs(lastMs) : null;
  const lastMatchTag = lastMs != null
    ? [...tg].reverse().find((x) => Math.abs(x.t - lastMs) <= 120000)
    : null;
  const lastM = lastMs == null
    ? ''
    : ((lastMatchTag ? lastMatchTag.m : '') || (portalOutMs != null && Math.abs(lastMs - portalOutMs) <= 120000 ? (portalToday?.outMethod || '') : ''));
  
  const showTagInfo = (title, isFirst) => {
    const timeVal = isFirst ? first : last;
    const legacyMethod = isFirst ? firstM : lastM;
    const targetMs = isFirst ? firstMs : lastMs;
    const detail = isFirst
      ? (tagDetails.find((d) => targetMs != null && Math.abs(d.t - targetMs) <= 180000) || tagDetails[0] || null)
      : ([...tagDetails].reverse().find((d) => targetMs != null && Math.abs(d.t - targetMs) <= 180000) || null);
    const rawPortalLoc = isFirst ? portalToday?.inLocation : portalToday?.outLocation;
    const portalLoc = rawPortalLoc && !/^tempat\s*\/\s*jenis$/i.test(rawPortalLoc.trim()) ? rawPortalLoc : '';
    if (!timeVal || timeVal === '—') {
      Alert.alert(title, "Tiada rekod kehadiran.");
      return;
    }
    
    const labelOfMethod = (m) => (m === 'qr' ? 'Imbas QR' : m === 'fr' ? 'Pengecaman Wajah (FR)' : 'Geo Tagging');
    if (detail) {
       const methodName = labelOfMethod(detail.m);
       speakMalay(`${title} pada pukul ${timeVal}, menggunakan kaedah ${methodName}, di ${detail.address || 'lokasi semasa'}.`);
       Alert.alert(
         `Maklumat ${title}`, 
         `Kaedah: ${methodName}\nMasa: ${timeVal}\nLokasi: ${detail.address || 'Lokasi tidak dikesan'}`
       );
    } else if (legacyMethod) {
       const methodName = labelOfMethod(legacyMethod);
       const locLine = portalLoc ? `Lokasi: ${portalLoc}` : '*Disegerakkan daripada Log Kehadiran portal.*';
       speakMalay(`${title} pada pukul ${timeVal}, menggunakan kaedah ${methodName}${portalLoc ? ', di ' + portalLoc : ''}.`);
       Alert.alert(
         `Maklumat ${title}`, 
         `Kaedah: ${methodName}\nMasa: ${timeVal}\n${locLine}`
       );
    } else {
       speakMalay(`${title} pada pukul ${timeVal}, direkodkan daripada pelayan web.`);
       Alert.alert(
         `Maklumat ${title}`, 
         `Masa: ${timeVal}\n\nRekod ini daripada pelayan web. Maklumat lokasi peranti tidak tersedia.`
       );
    }
  };
  
  const ring = data ? colorOf(data.att_color, C.accent) : C.accent;
  const wbfTargetOutMs = computeWbfTargetOut(firstMs);
  const wbfTargetOutStr = wbfTargetOutMs ? fromMs(wbfTargetOutMs) : null;
  const wbfHasOut = !!(lastMs && firstMs && lastMs > firstMs && new Date(lastMs).getHours() >= 16);

  useEffect(() => {
    if (!data && tags.length === 0) return;
    const td = todayStr();
    (async () => {
      await SecureStore.setItemAsync('WBF_TODAY_DATE', td).catch(() => {});
      await SecureStore.setItemAsync('WBF_TODAY_FIRST_MS', firstMs ? String(firstMs) : '').catch(() => {});
      await SecureStore.setItemAsync('WBF_TODAY_LAST_MS', lastMs ? String(lastMs) : '').catch(() => {});
      const srvProf = data?.work_profile || data?.staff_data?.work_profile || data?.wbf_profile;
      if (srvProf) {
        await SecureStore.setItemAsync('SERVER_WORK_PROFILE', String(srvProf)).catch(() => {});
      }
      await syncWbfReminders({
        firstMs: firstMs || null,
        lastMs: lastMs || null,
        workProfile: srvProf ? String(srvProf) : undefined,
      });
    })();
  }, [data, firstMs, lastMs, tags.length]);
  
  return (
    <ScrollView contentContainerStyle={{ paddingBottom: 28 }} refreshControl={<RefreshControl refreshing={busy} onRefresh={load} colors={[C.primary]} tintColor={C.primary} />}>
      <View style={[s.dashTop, { gap: 10 }]}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 8, padding: 2 }}>
             <Image source={require('./assets/icon.png')} style={{ width: 32, height: 32 }} resizeMode="contain" />
          </View>
          <Text numberOfLines={1} adjustsFontSizeToFit style={{ flex: 1, color: C.ink, fontSize: 22, fontWeight: '800', letterSpacing: 0.3 }}>iHR Kehadiran</Text>
        </View>
        <View style={{ alignItems: 'flex-end', flexShrink: 0, gap: 6 }}>
          <Pressable onPress={handleLogout} style={s.status}>
            <View style={[s.dot, { backgroundColor: online == null ? C.mute : online ? C.ok : C.bad }]} />
            <Text style={s.statusT}>{online == null ? 'Menyemak…' : online ? `Online` : 'Offline'}</Text>
          </Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Pressable
              onPress={() => go('history')}
              hitSlop={10}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Log Kehadiran"
              style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: C.field, borderRadius: 16, borderWidth: 1, borderColor: C.line }}
            >
              <MaterialIcons name="access-time" size={16} color={C.primaryText} />
            </Pressable>
            <Pressable
              onPress={() => go('profile')}
              hitSlop={10}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Profil"
              style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: C.field, borderRadius: 16, borderWidth: 1, borderColor: C.line }}
            >
              <MaterialIcons name="person-outline" size={16} color={C.primaryText} />
            </Pressable>
            <Pressable
              onPress={() => changeTheme(themeMode === 'dark' ? 'light' : 'dark')}
              hitSlop={10}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Tukar Tema"
              style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: C.field, borderRadius: 16, borderWidth: 1, borderColor: C.line }}
            >
              <MaterialIcons name={themeMode === 'dark' ? 'light-mode' : 'dark-mode'} size={16} color={C.primaryText} />
            </Pressable>
            <Pressable
              onPress={load}
              disabled={busy}
              hitSlop={10}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Segar Semula"
              style={{ width: 32, height: 32, alignItems: 'center', justifyContent: 'center', backgroundColor: C.field, borderRadius: 16, borderWidth: 1, borderColor: C.line }}
            >
              {busy ? <ActivityIndicator size="small" color={C.primaryText} /> : (
                <MaterialIcons name="sync" size={16} color={C.primaryText} />
              )}
            </Pressable>
          </View>
        </View>
      </View>
      <View style={s.profile}>
        <Text style={{ fontSize: 11, color: C.primary, fontWeight: '700', marginBottom: 4, textTransform: 'uppercase', letterSpacing: 0.4 }}>
          {now.toLocaleDateString('ms-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
        </Text>
        <View style={{ alignItems: 'center', backgroundColor: C.card, paddingVertical: 6, paddingHorizontal: 14, borderRadius: 12, borderWidth: 1, borderColor: C.line, marginBottom: 14 }}>
          <Text style={{ fontSize: 12, fontWeight: '800', color: C.ink, letterSpacing: 0.5, fontVariant: ['tabular-nums'] }}>
            {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </Text>
        </View>
        <Pressable onLongPress={() => Alert.alert('Medan data pelayan', data ? `${Object.keys(data).join(', ')}\n\nstaff_data: ${Object.keys(sd).join(', ') || '-'}\n\nGambar: ${photo ? 'dijumpai' : 'tiada'}` : 'Tiada data')}>
          <View style={[s.ring, { borderColor: ring }]}><View style={s.ringIn}>
            {photo && !badPhoto ? <Image source={photo.startsWith('data:') ? { uri: photo } : { uri: photo, headers: { imei: String(deviceId()) } }} style={s.ringImg} resizeMode="cover" onError={() => setBadPhoto(true)} /> : <Text style={s.ringT}>{name.trim()[0]?.toUpperCase() || 'I'}</Text>}
          </View></View>
        </Pressable>
        <View style={s.pNameBox}>
          <Text style={{ color: C.mute, fontSize: 16, fontWeight: '700', marginBottom: 4 }}>{greeting},</Text>
          {wrapName(name).map((l, i) => <Text key={i} style={s.pName} numberOfLines={1}>{l}</Text>)}
        </View>
        <View style={[s.chips, { flexWrap: 'wrap', justifyContent: 'center' }]}>
          <View style={s.chip}><Text style={s.chipT}>No. staff {sd.staff_no ?? sess.staff_no}</Text></View>
          <Pressable
            onPress={() => go('profile')}
            accessible={true}
            accessibilityRole="button"
            accessibilityLabel="Peringatan WBF dan Notifikasi"
            style={[s.chip, { flexDirection: 'row', alignItems: 'center', gap: 5 }]}
          >
            <MaterialIcons name="notifications-active" size={14} color={C.primary} />
            <Text style={[s.chipT, { color: C.ink, fontWeight: '700' }]}>
              {wbfHasOut
                ? `WBF Selesai (${last})`
                : wbfTargetOutStr
                  ? `WBF Pulang: ${wbfTargetOutStr}`
                  : 'WBF: 7:30 – 9:00 PG'}
            </Text>
          </Pressable>
        </View>
        {data ? <View style={[s.pill, { display: 'none' }]}><Text style={s.pillT}>{data.msg?.clock_in || 'Belum ada rekod waktu masuk hari ini.'}</Text></View> : null}
      </View>
      
      <View style={{ paddingHorizontal: 16, gap: 14 }}>
        <View style={s.statRow}>
          <Stat icon="📍" label="Waktu Masuk" value={first || '—'} tint={C.primary} methodIcon={firstM ? getMethodIcon(firstM) : null} onPress={() => showTagInfo('Waktu Masuk', true)} />
          <Stat icon="📌" label="Waktu Keluar" value={last || '—'} tint={C.navy} methodIcon={lastM ? getMethodIcon(lastM) : null} onPress={() => showTagInfo('Waktu Keluar', false)} />
        </View>
        <QuickActionBar go={go} />
        
        <Err msg={err} />
        {busy && !data ? <ActivityIndicator color={C.primaryText} /> : null}
      </View>
      
      <View style={{ marginTop: 32, marginBottom: 10, alignItems: 'center' }}>
        <Text style={{ color: C.mute, fontSize: 12, fontWeight: '600' }}>Copyright © 2026 MTIB</Text>
      </View>
      <View style={{ height: 0, width: 0, overflow: 'hidden' }} pointerEvents="none">
        <WebView
          ref={dashWebRef}
          source={{ uri: `${PORTAL}?month=${new Date().getMonth() + 1}&year=${new Date().getFullYear()}` }}
          injectedJavaScript={`
            (function() {
              function syncToday() {
                try {
                  var mainTable = document.querySelector('section.content table.table-bordered');
                  if (!mainTable) return;
                  var detectMethod = function(el) {
                    if (!el) return '';
                    if (el.querySelector('.fa-qrcode')) return 'qr';
                    if (el.querySelector('.fa-map-marked, .fa-map-marker')) return 'geo';
                    if (el.querySelector('.fa-user-check, .fa-camera')) return 'fr';
                    return '';
                  };
                  var rows = mainTable.querySelectorAll(':scope > tbody > tr');
                  var out = [];
                  for (var i = 0; i < rows.length; i++) {
                    var cells = rows[i].querySelectorAll(':scope > td');
                    if (cells.length >= 6) {
                      var dt = cells[0].innerText.trim();
                      if (/\d+[-/\.]\d+[-/\.]\d+/.test(dt)) {
                        var dayNum = parseInt(dt.split(/[-/\.]/)[0], 10);
                        var inM = /(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i.exec(cells[2].innerText.trim());
                        var outM = /(\d{1,2}:\d{2}\s*(?:AM|PM)?)/i.exec(cells[3].innerText.trim());
                        var txList = [];
                        var modal = document.getElementById('view-attendance-log' + dayNum);
                        if (modal) {
                          var tRows = modal.querySelectorAll('tbody tr');
                          for (var j = 0; j < tRows.length; j++) {
                            var tc = tRows[j].querySelectorAll('td');
                            if (tc.length >= 3) {
                              var tmVal = tc[0].innerText.trim();
                              var locVal = tc[2].innerText.replace(/\s+/g, ' ').trim();
                              if (!/\d{1,2}:\d{2}/.test(tmVal) || /^tempat\s*\/\s*jenis$/i.test(locVal)) continue;
                              txList.push({
                                time: tmVal,
                                method: detectMethod(tc[1]) || '',
                                location: locVal,
                                coord: tc[3] ? tc[3].innerText.replace(/\s+/g, ' ').trim() : ''
                              });
                            }
                          }
                        }
                        out.push({
                          date: dt,
                          clockIn: inM ? inM[1] : '',
                          inMethod: detectMethod(cells[2]),
                          clockOut: outM ? outM[1] : '',
                          outMethod: detectMethod(cells[3]),
                          transactions: txList
                        });
                      }
                    }
                  }
                  if (out.length > 0 && window.ReactNativeWebView) {
                    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'DASH_SYNC', rows: out }));
                  }
                } catch (e) {}
              }
              syncToday();
              setTimeout(syncToday, 1500);
            })();
            true;
          `}
          onMessage={async (ev) => {
            try {
              const msg = JSON.parse(ev.nativeEvent.data);
              if (msg.type === 'DASH_SYNC' && Array.isArray(msg.rows)) {
                const dNow = new Date();
                const pats = [
                  `${dNow.getDate()}-${dNow.getMonth() + 1}-${dNow.getFullYear()}`,
                  `${pad(dNow.getDate())}-${pad(dNow.getMonth() + 1)}-${dNow.getFullYear()}`,
                  `${pad(dNow.getDate())}/${pad(dNow.getMonth() + 1)}/${dNow.getFullYear()}`,
                ];
                const tr = msg.rows.find((r) => pats.includes(String(r.date || '').trim()));
                if (tr) {
                  const txArr = Array.isArray(tr.transactions) ? tr.transactions : [];
                  const firstTx = txArr.length > 0 ? txArr[0] : null;
                  const lastTx = txArr.length > 1 ? txArr[txArr.length - 1] : null;
                  const resolvedIn = await resolvePortalLocation(firstTx?.location, firstTx?.coord);
                  const resolvedOut = await resolvePortalLocation(lastTx?.location, lastTx?.coord);
                  const syncedObj = {
                    date: todayStr(),
                    clockIn: tr.clockIn || (firstTx ? firstTx.time : ''),
                    clockOut: tr.clockOut || (lastTx ? lastTx.time : ''),
                    inMethod: tr.inMethod || (firstTx?.method || ''),
                    outMethod: tr.outMethod || (lastTx?.method || ''),
                    inLocation: resolvedIn,
                    outLocation: resolvedOut,
                  };
                  setPortalToday(syncedObj);
                  await SecureStore.setItemAsync('SYNCED_TODAY_PORTAL', JSON.stringify(syncedObj)).catch(() => {});
                }
              }
            } catch (_) {}
          }}
          javaScriptEnabled={true}
          domStorageEnabled={true}
          sharedCookiesEnabled={true}
          thirdPartyCookiesEnabled={true}
        />
      </View>
    </ScrollView>
  );
}

function useFix() {
  const [fix, setFix] = useState(null); const [err, setErr] = useState('');
  const get = useCallback(async () => {
    setErr('');
    const p = await Location.requestForegroundPermissionsAsync();
    if (p.status !== 'granted') return setErr('Tiada akses lokasi');
    try { const l = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }); setFix(l.coords); }
    catch { setErr('Peranti tidak dapat mengesan lokasi anda'); }
  }, []);
  useEffect(() => { get(); }, [get]);
  return { fix, err, get, setFix };
}

const Loc = ({ fix, err, get }) => {
  const { C } = useT(); const [open, setOpen] = useState(false);
  const summary = fix ? `${fix.latitude.toFixed(5)}, ${fix.longitude.toFixed(5)} · ± ${Math.round(fix.accuracy || 0)} m` : (err || 'Mengesan lokasi…');
  return (
    <Collapse title="Lokasi semasa" icon="🛰" tint={C.navy} summary={summary} warn={!fix && !!err} open={open} onToggle={() => setOpen(!open)}>
      {fix ? <>
        <Row icon="🧭" k="Latitud" v={fix.latitude.toFixed(6)} tint={C.navy} />
        <Row icon="🧭" k="Longitud" v={fix.longitude.toFixed(6)} tint={C.navy} />
        <Row icon="🎯" k="Ketepatan" v={`± ${Math.round(fix.accuracy || 0)} m`} tint={C.primary} last /></>
        : <Text style={{ color: C.mute }}>{err || 'Mengesan lokasi…'}</Text>}
      <Err msg={fix ? '' : err} />
      <Btn kind="ghost" icon="🔄" label="Kesan semula" onPress={get} />
    </Collapse>
  );
};
const QuickActionBar = ({ go }) => {
  const { C } = useT();
  const items = [
    { id: 'qr', label: 'Imbas QR', icon: 'qr-code-2', hint: 'Buka pengimbas kod QR kehadiran' },
    { id: 'fr', label: 'Wajah (FR)', icon: 'face', hint: 'Buka pengecaman wajah bebas tangan untuk rekod kehadiran' },
    { id: 'geo', label: 'Geo Tagging', icon: 'location-on', hint: 'Buka kamera swafoto dan lokasi GPS' },
  ];
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 2, marginVertical: 6, gap: 4 }}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          onPress={() => go(item.id)}
          accessible={true}
          accessibilityRole="button"
          accessibilityLabel={item.label}
          accessibilityHint={item.hint}
          style={({ pressed }) => [{ alignItems: 'center', flex: 1 }, pressed && { opacity: 0.7 }]}
        >
          <View style={{
            width: 54,
            height: 54,
            borderRadius: 17,
            backgroundColor: C.primarySoft || '#F8E5E1',
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 1,
            borderColor: (C.line || '#E0D0CC') + '80',
            marginBottom: 6,
            shadowColor: '#000',
            shadowOpacity: 0.04,
            shadowRadius: 4,
            elevation: 1,
          }}>
            <MaterialIcons name={item.icon} size={25} color={C.primary} />
          </View>
          <Text numberOfLines={1} adjustsFontSizeToFit style={{ fontSize: 11, fontWeight: '700', color: C.ink, textAlign: 'center' }}>
            {item.label}
          </Text>
        </Pressable>
      ))}
    </View>
  );
};
const attKey = (s) => {
  const p = String(s || '').split(/[-/.]/);
  if (p.length !== 3) return null;
  const d = +p[0], m = +p[1], y = +p[2];
  if (!d || !m || y < 1000) return null;
  return y * 10000 + m * 100 + d;
};
const mergeAttendance = (oldRows, newRows, keepDays = 400) => {
  const map = new Map();
  [...oldRows, ...newRows].forEach((r) => { const k = attKey(r && r.date); if (k) map.set(k, r); });
  const c = new Date(); c.setDate(c.getDate() - keepDays);
  const cutKey = c.getFullYear() * 10000 + (c.getMonth() + 1) * 100 + c.getDate();
  return [...map.entries()].filter(([k]) => k >= cutKey).sort((a, b) => b[0] - a[0]).map(([, r]) => r);
};
const HistoryView = ({ sess, back }) => {
  const { C, s } = useT();
  const now = new Date();
  const [tab, setTab] = useState('record');
  const [selMonth, setSelMonth] = useState(now.getMonth() + 1);
  const [selYear, setSelYear] = useState(now.getFullYear());
  const [showFilter, setShowFilter] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [portalData, setPortalData] = useState(null);
  const [needPortalLogin, setNeedPortalLogin] = useState(false);
  const [webLoading, setWebLoading] = useState(true);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const [dayModal, setDayModal] = useState(null);
  const [actionMode, setActionMode] = useState(null);
  const [reasonType, setReasonType] = useState('2');
  const [reasonSubType, setReasonSubType] = useState('1');
  const [reasonText, setReasonText] = useState('');
  const [bdrText, setBdrText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitMsg, setSubmitMsg] = useState('');
  const [submitErr, setSubmitErr] = useState('');
  const webViewRef = useRef(null);

  const monthNames = [
    'Januari', 'Februari', 'Mac', 'April', 'Mei', 'Jun',
    'Julai', 'Ogos', 'September', 'Oktober', 'November', 'Disember'
  ];
  const curYr = now.getFullYear();
  const yearOptions = [curYr - 2, curYr - 1, curYr, curYr + 1, curYr + 2];
  const cacheKey = `PORTAL_RECORD_${selYear}_${selMonth}`;
  const portalUrl = `${PORTAL}?month=${selMonth}&year=${selYear}`;

  useEffect(() => {
    let on = true;
    (async () => {
      const cached = await SecureStore.getItemAsync(cacheKey).catch(() => null);
      if (cached && on) {
        try { setPortalData(JSON.parse(cached)); } catch (_) {}
      } else if (on) {
        setPortalData(null);
      }
    })();
    return () => { on = false; };
  }, [cacheKey]);

  const onWebMessage = async (event) => {
    try {
      const msg = JSON.parse(event.nativeEvent.data);
      if (msg.type === 'PDF_ERROR') {
        setDownloadingPdf(false);
        Alert.alert('PDF Bulanan', msg.message || 'Gagal menjana fail PDF daripada pelayan.');
        return;
      }
      if (msg.type === 'PDF_DOWNLOADED' && msg.base64) {
        try {
          const safeName = `Rekod_Kehadiran_${monthNames[selMonth - 1]}_${selYear}.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_');
          const fileUri = `${FileSystem.cacheDirectory}${safeName}`;
          await FileSystem.writeAsStringAsync(fileUri, msg.base64, {
            encoding: FileSystem.EncodingType.Base64,
          });
          setDownloadingPdf(false);
          if (await Sharing.isAvailableAsync()) {
            await Sharing.shareAsync(fileUri, {
              mimeType: 'application/pdf',
              dialogTitle: `Simpan / Buka ${safeName}`,
              UTI: 'com.adobe.pdf',
            });
          } else {
            Alert.alert('PDF Berjaya Dimuat Turun', `Fail disimpan di: ${fileUri}`);
          }
        } catch (fsErr) {
          setDownloadingPdf(false);
          Alert.alert('Ralat Simpan PDF', fsErr.message || 'Tidak dapat menyimpan fail PDF.');
        }
        return;
      }
      if (msg.type === 'LOGIN_REQUIRED') {
        setNeedPortalLogin(true);
        return;
      }
      if (msg.type === 'ATTENDANCE_FULL' && msg.payload) {
        setNeedPortalLogin(false);
        setPortalData(msg.payload);
        await SecureStore.setItemAsync(cacheKey, JSON.stringify(msg.payload)).catch(() => {});
        if (msg.payload.workProfile) {
          await SecureStore.setItemAsync('SERVER_WORK_PROFILE', msg.payload.workProfile).catch(() => {});
        }
        if (Array.isArray(msg.payload.rows)) {
          const dNow = new Date();
          const todayPatterns = [
            `${dNow.getDate()}-${dNow.getMonth() + 1}-${dNow.getFullYear()}`,
            `${pad(dNow.getDate())}-${pad(dNow.getMonth() + 1)}-${dNow.getFullYear()}`,
            `${pad(dNow.getDate())}/${pad(dNow.getMonth() + 1)}/${dNow.getFullYear()}`,
          ];
          const todayRow = msg.payload.rows.find((r) => todayPatterns.includes(String(r.date || '').trim()));
          if (todayRow) {
            const parse12ToMs = (txt) => {
              const m = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(String(txt || ''));
              if (!m) return null;
              const dt = new Date();
              dt.setHours((+m[1] % 12) + (/pm/i.test(m[3]) ? 12 : 0), +m[2], 0, 0);
              return dt.getTime();
            };
            const pInMs = parse12ToMs(todayRow.clockIn);
            const pOutMs = parse12ToMs(todayRow.clockOut);
            const txArr = Array.isArray(todayRow.transactions) ? todayRow.transactions : [];
            const firstTx = txArr.length > 0 ? txArr[0] : null;
            const lastTx = txArr.length > 1 ? txArr[txArr.length - 1] : null;
            const lastTxMs = lastTx ? parse12ToMs(lastTx.time) : null;
            const effectiveOutMs = pOutMs || (lastTxMs && pInMs && lastTxMs > pInMs ? lastTxMs : null);
            await SecureStore.setItemAsync('WBF_TODAY_DATE', todayStr()).catch(() => {});
            if (pInMs) await SecureStore.setItemAsync('WBF_TODAY_FIRST_MS', String(pInMs)).catch(() => {});
            if (effectiveOutMs) await SecureStore.setItemAsync('WBF_TODAY_LAST_MS', String(effectiveOutMs)).catch(() => {});
            const resolvedInLoc = await resolvePortalLocation(firstTx?.location, firstTx?.coord);
            const resolvedOutLoc = await resolvePortalLocation(lastTx?.location, lastTx?.coord);
            await SecureStore.setItemAsync('SYNCED_TODAY_PORTAL', JSON.stringify({
              date: todayStr(),
              clockIn: todayRow.clockIn || (firstTx ? firstTx.time : ''),
              clockOut: todayRow.clockOut || (lastTx && effectiveOutMs ? lastTx.time : ''),
              inMethod: todayRow.inMethod || (firstTx?.method || ''),
              outMethod: todayRow.outMethod || (lastTx?.method || ''),
              inLocation: resolvedInLoc,
              outLocation: resolvedOutLoc,
            })).catch(() => {});
            await syncWbfReminders({
              firstMs: pInMs || undefined,
              lastMs: pOutMs || undefined,
              workProfile: msg.payload.workProfile || undefined,
            });
          }
        }
        if (Array.isArray(msg.payload.rows) && msg.payload.rows.length > 0) {
          try {
            const old = await SecureStore.getItemAsync('SYNCED_SERVER_ATTENDANCE');
            const oldArr = old ? JSON.parse(old) : [];
            const merged = mergeAttendance(Array.isArray(oldArr) ? oldArr : [], msg.payload.rows);
            await SecureStore.setItemAsync('SYNCED_SERVER_ATTENDANCE', JSON.stringify(merged));
          } catch (_) {}
        }
      }
    } catch (_) {}
  };

  const scraperScript = `
    (function() {
      function scrape() {
        try {
          var href = String(window.location.href || '');
          if (/\\/login/i.test(href) || document.querySelector('input[name="password"]')) {
            if (window.ReactNativeWebView) {
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'LOGIN_REQUIRED' }));
            }
            return;
          }
          var mainTable = document.querySelector('section.content table.table-bordered');
          if (!mainTable) return;

          var staffName = '', workProfile = '', cardColor = '';
          var inputs = document.querySelectorAll('section.content .card-body input.form-control');
          if (inputs.length >= 1) staffName = (inputs[0].value || '').replace(/\\s+/g, ' ').trim();
          if (inputs.length >= 2) workProfile = (inputs[1].value || '').trim();
          if (inputs.length >= 3) {
            var cls = inputs[2].className || '';
            if (/bg-yellow/i.test(cls)) cardColor = 'yellow';
            else if (/bg-red|bg-danger/i.test(cls)) cardColor = 'red';
            else if (/bg-green|bg-success/i.test(cls)) cardColor = 'green';
            else if (/bg-orange/i.test(cls)) cardColor = 'orange';
            else if (/bg-blue|bg-info/i.test(cls)) cardColor = 'blue';
          }

          var stats = [];
          var statItems = document.querySelectorAll('section.content fieldset ul.nav li.nav-link');
          for (var s = 0; s < statItems.length; s++) {
            var spans = statItems[s].querySelectorAll('span');
            if (spans.length >= 2) {
              stats.push({
                label: spans[0].innerText.trim(),
                value: spans[1].innerText.trim(),
                cls: spans[1].className || ''
              });
            }
          }

          var pdfUrl = '';
          var pdfForm = document.querySelector('form[action*="pdf_attendance_monthly"]');
          if (pdfForm) {
            var act = pdfForm.getAttribute('action') || '';
            var q = [];
            pdfForm.querySelectorAll('input[name]').forEach(function(inp) {
              q.push(encodeURIComponent(inp.name) + '=' + encodeURIComponent(inp.value || ''));
            });
            pdfUrl = act + (q.length ? '?' + q.join('&') : '');
          }

          var csrf = '';
          var metaCsrf = document.querySelector('meta[name="csrf-token"]');
          if (metaCsrf) csrf = metaCsrf.getAttribute('content') || '';
          var recordAction = '';
          var putForm = document.querySelector('form[action*="attendance_record/"]');
          if (putForm) recordAction = putForm.getAttribute('action') || '';

          var detectColor = function(el) {
            if (!el) return '';
            var c = (el.className || '') + ' ' + (el.getAttribute('style') || '');
            if (/bg-red|bg-danger|#dc3545|red/i.test(c)) return 'red';
            if (/bg-yellow|bg-warning|#ffc107|yellow/i.test(c)) return 'yellow';
            if (/bg-green|bg-success|#28a745|green/i.test(c)) return 'green';
            if (/bg-orange|#fd7e14|orange/i.test(c)) return 'orange';
            if (/bg-blue|bg-info|#17a2b8|lightblue|blue/i.test(c)) return 'blue';
            if (/bg-secondary/i.test(c)) return 'weekend';
            return '';
          };

          var detectMethod = function(el) {
            if (!el) return '';
            if (el.querySelector('.fa-qrcode')) return 'qr';
            if (el.querySelector('.fa-map-marked, .fa-map-marker')) return 'geo';
            if (el.querySelector('.fa-user-check, .fa-camera')) return 'fr';
            return '';
          };

          var tbodyRows = mainTable.querySelectorAll(':scope > tbody > tr');
          var results = [];
          for (var i = 0; i < tbodyRows.length; i++) {
            var tr = tbodyRows[i];
            var cells = tr.querySelectorAll(':scope > td');
            if (cells.length >= 6) {
              var dateText = cells[0].innerText.trim();
              if (/\\d+[-/\\.]\\d+[-/\\.]\\d+/.test(dateText)) {
                var dayNum = parseInt(dateText.split(/[-/\\.]/)[0], 10);
                var dayText = cells[1].innerText.trim();
                var inText = cells[2].innerText.trim();
                var outText = cells[3].innerText.trim();
                var diffText = cells[4].innerText.trim();
                var totalTitle = (cells[4].getAttribute('title') || '').trim();
                var notesText = cells[5].innerText.trim();
                var inMatch = /(\\d{1,2}:\\d{2}\\s*(?:AM|PM)?)/i.exec(inText);
                var outMatch = /(\\d{1,2}:\\d{2}\\s*(?:AM|PM)?)/i.exec(outText);

                var txList = [];
                var logModal = document.getElementById('view-attendance-log' + dayNum);
                if (logModal) {
                  var txRows = logModal.querySelectorAll('tbody tr');
                  for (var j = 0; j < txRows.length; j++) {
                    var tCells = txRows[j].querySelectorAll('td');
                    if (tCells.length >= 3) {
                      var tmTxt = tCells[0].innerText.trim();
                      var locTxt = tCells[2].innerText.replace(/\\s+/g, ' ').trim();
                      if (!/\\d{1,2}:\\d{2}/.test(tmTxt) || /^tempat\\s*\\/\\s*jenis$/i.test(locTxt)) continue;
                      txList.push({
                        time: tmTxt,
                        method: detectMethod(tCells[1]) || 'other',
                        location: locTxt,
                        coord: tCells[3] ? tCells[3].innerText.replace(/\\s+/g, ' ').trim() : ''
                      });
                    }
                  }
                }

                var rowColor = detectColor(cells[2]) || detectColor(cells[3]) || detectColor(cells[5]) || detectColor(tr);
                results.push({
                  dayNum: dayNum,
                  date: dateText,
                  day: dayText,
                  clockIn: inMatch ? inMatch[1] : '',
                  inMethod: detectMethod(cells[2]),
                  clockOut: outMatch ? outMatch[1] : '',
                  outMethod: detectMethod(cells[3]),
                  diff: diffText,
                  totalHours: totalTitle,
                  notes: notesText,
                  color: rowColor,
                  transactions: txList
                });
              }
            }
          }

          if (results.length > 0 && window.ReactNativeWebView) {
            var payload = {
              staffName: staffName,
              workProfile: workProfile,
              cardColor: cardColor,
              stats: stats,
              pdfUrl: pdfUrl,
              csrf: csrf,
              recordAction: recordAction,
              rows: results
            };
            var js = JSON.stringify(payload);
            if (js !== window.__ihrFullLast) {
              window.__ihrFullLast = js;
              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'ATTENDANCE_FULL', payload: payload }));
            }
          }
        } catch (e) {}
      }
      scrape();
      setTimeout(scrape, 1200);
      setTimeout(scrape, 3000);
      if (!window.__ihrFullTimer) { window.__ihrFullTimer = setInterval(scrape, 2500); }
    })();
    true;
  `;

  const badgeTheme = (color) => {
    if (color === 'red') return { bg: '#FBE9E7', border: '#F2C6C1', text: '#B3261E', label: 'Lewat / Awal' };
    if (color === 'yellow') return { bg: '#FEF3C7', border: '#FDE68A', text: '#B45309', label: 'Menunggu' };
    if (color === 'green') return { bg: '#E8F5E9', border: '#A7F3D0', text: '#2E7D4F', label: 'Disahkan' };
    if (color === 'orange') return { bg: '#FFEDD5', border: '#FED7AA', text: '#C2410C', label: 'Diterima' };
    if (color === 'blue') return { bg: '#E0F2FE', border: '#BAE6FD', text: '#0369A1', label: 'Tiada Profil' };
    if (color === 'weekend') return { bg: C.field, border: C.line, text: C.mute, label: 'Hujung Minggu' };
    return null;
  };

  const cardColorLabel = (c) => {
    if (c === 'yellow') return { name: 'Kuning', bg: '#FACC15', fg: '#14141A' };
    if (c === 'red') return { name: 'Merah', bg: '#DC2626', fg: '#FFFFFF' };
    if (c === 'green') return { name: 'Hijau', bg: '#16A34A', fg: '#FFFFFF' };
    if (c === 'orange') return { name: 'Oren', bg: '#EA580C', fg: '#FFFFFF' };
    if (c === 'blue') return { name: 'Biru', bg: '#0284C7', fg: '#FFFFFF' };
    return { name: c || 'Normal', bg: C.field, fg: C.ink };
  };

  const openDayModal = (row) => {
    setDayModal(row);
    setActionMode(null);
    setReasonText('');
    setBdrText('');
    setSubmitMsg('');
    setSubmitErr('');
  };

  const submitPortalForm = async () => {
    if (!dayModal) return;
    setSubmitting(true);
    setSubmitMsg('');
    setSubmitErr('');
    try {
      if (actionMode === 'clock_in' || actionMode === 'clock_out') {
        if (!reasonText.trim()) throw new Error('Sila masukkan alasan terlebih dahulu.');
        let apiOk = false;
        try {
          await call(EP.reason, {
            staff_id: sess?.staff_id,
            date: dayModal.date,
            type: actionMode === 'clock_in' ? 'in' : 'out',
            reason_type: reasonType,
            reason_subtype: reasonSubType,
            reason: reasonText.trim(),
          });
          apiOk = true;
        } catch (_) {}

        if (portalData?.recordAction && portalData?.csrf) {
          const formBody = [
            `_method=PUT`,
            `_token=${encodeURIComponent(portalData.csrf)}`,
            `d=${encodeURIComponent(dayModal.dayNum)}`,
            `m=${encodeURIComponent(selMonth)}`,
            `y=${encodeURIComponent(selYear)}`,
            `reason_type=${encodeURIComponent(reasonType)}`,
            `reason_subtype=${encodeURIComponent(reasonSubType)}`,
            `reason=${encodeURIComponent(reasonText.trim())}`,
            `submit=${actionMode === 'clock_in' ? 'edit_attendance_clock_in' : 'edit_attendance_clock_out'}`
          ].join('&');
          const res = await fetch(portalData.recordAction, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: formBody,
          });
          if (!res.ok && !apiOk) throw new Error(`Gagal menghantar alasan (HTTP ${res.status}). Sila log masuk di tab Portal Web.`);
        } else if (!apiOk) {
          throw new Error('Sila buka tab Portal Web dan log masuk sekali untuk mengaktifkan penghantaran.');
        }
        setSubmitMsg('Alasan berjaya dihantar untuk pengesahan penyelia.');
        setActionMode(null);
        webViewRef.current?.reload();
      } else if (actionMode === 'bdr') {
        if (!bdrText.trim()) throw new Error('Sila isi laporan kerja BDR.');
        if (!portalData?.recordAction || !portalData?.csrf) {
          throw new Error('Sila buka tab Portal Web dan log masuk sekali untuk menghantar laporan BDR.');
        }
        const formBody = [
          `_method=PUT`,
          `_token=${encodeURIComponent(portalData.csrf)}`,
          `d=${encodeURIComponent(dayModal.dayNum)}`,
          `m=${encodeURIComponent(selMonth)}`,
          `y=${encodeURIComponent(selYear)}`,
          `description=${encodeURIComponent(bdrText.trim())}`,
          `submit=edit_attendance_remark_bdr`
        ].join('&');
        const res = await fetch(portalData.recordAction, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: formBody,
        });
        if (!res.ok) throw new Error(`Gagal menghantar laporan BDR (HTTP ${res.status}).`);
        setSubmitMsg('Laporan kerja BDR berjaya dikemaskini.');
        setActionMode(null);
        webViewRef.current?.reload();
      }
    } catch (e) {
      setSubmitErr(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const renderMethodBadge = (m) => {
    if (!m) return null;
    const isQr = m === 'qr';
    const isGeo = m === 'geo';
    return (
      <View style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: C.primarySoft || '#F8E5E1',
        paddingHorizontal: 6,
        paddingVertical: 2,
        borderRadius: 6,
        marginLeft: 5,
        gap: 3,
      }}>
        <MaterialIcons name={isQr ? 'qr-code-2' : isGeo ? 'location-on' : 'verified-user'} size={12} color={C.primary} />
        <Text style={{ fontSize: 10, fontWeight: '800', color: C.primary }}>
          {isQr ? 'QR' : isGeo ? 'GEO' : 'FR'}
        </Text>
      </View>
    );
  };

  const cc = cardColorLabel(portalData?.cardColor);
  const rowsList = portalData?.rows || [];

  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      <Top title="Log Kehadiran" onBack={back} />

      <View style={{ flexDirection: 'row', padding: 10, backgroundColor: C.card, borderBottomWidth: 1, borderBottomColor: C.line, gap: 8 }}>
        {[
          { id: 'record', label: 'Rekod Bulanan', icon: 'event-note' },
          { id: 'web', label: 'Portal Web', icon: 'language' },
        ].map((t) => {
          const active = tab === t.id;
          return (
            <Pressable
              key={t.id}
              onPress={() => setTab(t.id)}
              style={{
                flex: 1,
                paddingVertical: 10,
                borderRadius: 12,
                backgroundColor: active ? C.primary : C.field,
                alignItems: 'center',
                justifyContent: 'center',
                borderWidth: 1,
                borderColor: active ? C.primary : C.line,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <MaterialIcons name={t.icon} size={17} color={active ? C.onPrimary : C.ink} />
                <Text style={{ fontSize: 13, fontWeight: '700', color: active ? C.onPrimary : C.ink }}>
                  {t.label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      {tab !== 'web' ? (
        <View style={{ height: 0, width: 0, overflow: 'hidden' }} pointerEvents="none">
          <WebView
            ref={webViewRef}
            source={{ uri: portalUrl }}
            injectedJavaScript={scraperScript}
            onMessage={onWebMessage}
            onLoadStart={() => setWebLoading(true)}
            onLoadEnd={() => {
              setWebLoading(false);
              webViewRef.current?.injectJavaScript(scraperScript);
            }}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
          />
        </View>
      ) : null}

      {tab === 'record' ? (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 14, gap: 12, paddingBottom: 32 }} refreshControl={<RefreshControl refreshing={webLoading} onRefresh={() => webViewRef.current?.reload()} colors={[C.primary]} tintColor={C.primary} />}>
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <Pressable
                onPress={() => setShowFilter(!showFilter)}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  backgroundColor: C.field,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: C.line,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <MaterialIcons name="date-range" size={18} color={C.primary} />
                  <Text style={{ fontSize: 14, fontWeight: '800', color: C.ink }}>
                    {monthNames[selMonth - 1]} {selYear}
                  </Text>
                </View>
                <Text style={{ color: C.mute, fontSize: 12 }}>{showFilter ? '▲' : '▼'}</Text>
              </Pressable>

              <Pressable
                disabled={downloadingPdf}
                onPress={() => {
                  if (!portalData && !webViewRef.current) {
                    Alert.alert('PDF Bulanan', 'Sila tunggu data bulan dimuatkan dahulu sebelum menjana PDF.');
                    return;
                  }
                  setDownloadingPdf(true);
                  const pdfFetchJs = `
                    (function() {
                      try {
                        var pdfForm = document.querySelector('form[action*="pdf_attendance_monthly"]');
                        if (!pdfForm) {
                          window.ReactNativeWebView.postMessage(JSON.stringify({
                            type: 'PDF_ERROR',
                            message: 'Borang PDF tidak dijumpai. Pastikan rekod bulan telah dimuatkan atau log masuk di tab Portal Web.'
                          }));
                          return;
                        }
                        var act = pdfForm.getAttribute('action') || '';
                        var method = (pdfForm.getAttribute('method') || 'GET').toUpperCase();
                        var fd = new FormData(pdfForm);
                        var fetchUrl = act;
                        var opts = { method: method, credentials: 'include' };
                        if (method === 'GET') {
                          var params = new URLSearchParams();
                          fd.forEach(function(v, k) { params.append(k, v); });
                          fetchUrl = act + (act.indexOf('?') >= 0 ? '&' : '?') + params.toString();
                        } else {
                          var bodyParams = new URLSearchParams();
                          fd.forEach(function(v, k) { bodyParams.append(k, v); });
                          opts.headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
                          opts.body = bodyParams.toString();
                        }
                        fetch(fetchUrl, opts)
                          .then(function(res) {
                            if (!res.ok) throw new Error('Pelayan memulangkan status HTTP ' + res.status);
                            return res.blob();
                          })
                          .then(function(blob) {
                            if (blob.type && blob.type.indexOf('html') >= 0) {
                              throw new Error('Sesi tamat tempoh. Sila log masuk sekali di tab Portal Web.');
                            }
                            var reader = new FileReader();
                            reader.onloadend = function() {
                              var dataUrl = reader.result || '';
                              var b64 = String(dataUrl).split(',')[1] || '';
                              if (!b64) {
                                window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'PDF_ERROR', message: 'Kandungan PDF kosong.' }));
                                return;
                              }
                              window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'PDF_DOWNLOADED', base64: b64 }));
                            };
                            reader.readAsDataURL(blob);
                          })
                          .catch(function(err) {
                            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'PDF_ERROR', message: err.message || 'Gagal memuat turun PDF.' }));
                          });
                      } catch (e) {
                        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'PDF_ERROR', message: e.message }));
                      }
                    })();
                    true;
                  `;
                  webViewRef.current?.injectJavaScript(pdfFetchJs);
                }}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  backgroundColor: C.field,
                  paddingHorizontal: 12,
                  paddingVertical: 10,
                  borderRadius: 12,
                  borderWidth: 1,
                  borderColor: C.line,
                  gap: 4,
                  opacity: downloadingPdf ? 0.6 : 1,
                }}
              >
                {downloadingPdf ? (
                  <ActivityIndicator size="small" color={C.primary} />
                ) : (
                  <MaterialIcons name="picture-as-pdf" size={18} color={C.primary} />
                )}
                <Text style={{ fontSize: 12, fontWeight: '800', color: C.primary }}>
                  {downloadingPdf ? '...' : 'PDF'}
                </Text>
              </Pressable>

              <Pressable
                onPress={() => webViewRef.current?.reload()}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 10,
                  borderRadius: 12,
                  backgroundColor: C.field,
                  borderWidth: 1,
                  borderColor: C.line,
                }}
              >
                {webLoading ? <ActivityIndicator size="small" color={C.primary} /> : <MaterialIcons name="refresh" size={18} color={C.primary} />}
              </Pressable>
            </View>

            {showFilter ? (
              <View style={{ marginTop: 12, gap: 10, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 12 }}>
                <Text style={s.lbl}>Pilih Bulan</Text>
                <Select
                  value={monthNames[selMonth - 1]}
                  placeholder="Bulan"
                  options={monthNames}
                  onPick={(mName) => {
                    const idx = monthNames.indexOf(mName);
                    if (idx >= 0) setSelMonth(idx + 1);
                  }}
                />
                <Text style={s.lbl}>Pilih Tahun</Text>
                <Select
                  value={String(selYear)}
                  placeholder="Tahun"
                  options={yearOptions.map(String)}
                  onPick={(yStr) => setSelYear(Number(yStr))}
                />
                <Btn icon="🔍" label="Papar Rekod Bulan Ini" onPress={() => { setShowFilter(false); setWebLoading(true); }} />
              </View>
            ) : null}

            {portalData ? (
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line }}>
                <View style={{ flex: 1, backgroundColor: C.field, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: C.line }}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: C.mute, textTransform: 'uppercase' }}>Profil Waktu Bekerja</Text>
                  <Text style={{ fontSize: 14, fontWeight: '800', color: C.ink, marginTop: 2 }}>{portalData.workProfile || 'WBF'}</Text>
                </View>
                <View style={{ flex: 1, backgroundColor: C.field, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: C.line }}>
                  <Text style={{ fontSize: 10, fontWeight: '700', color: C.mute, textTransform: 'uppercase' }}>Warna Kad</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 4, gap: 6 }}>
                    <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: cc.bg, borderWidth: 1, borderColor: C.line }} />
                    <Text style={{ fontSize: 14, fontWeight: '800', color: C.ink }}>{cc.name}</Text>
                  </View>
                </View>
              </View>
            ) : null}
          </Card>

          {needPortalLogin && rowsList.length === 0 ? (
            <Card title="Log Masuk Portal Diperlukan" icon="🔐" tint={C.primary}>
              <Text style={{ color: C.mute, fontSize: 13, marginBottom: 12 }}>
                Sesi portal web tamat tempoh atau belum dilog masuk. Sila log masuk sekali di tab Portal Web untuk menyegerakkan jadual kehadiran dan log transaksi.
              </Text>
              <Btn icon="🌐" label="Buka Portal Web untuk Log Masuk" onPress={() => setTab('web')} />
            </Card>
          ) : null}

          {portalData?.stats?.length > 0 ? (
            <Collapse
              title="Ringkasan Status & Rekod"
              icon="📊"
              tint={C.navy}
              summary={portalData.stats.slice(-3).map((st) => `${st.label}: ${st.value}`).join(' · ')}
              open={showStats}
              onToggle={() => setShowStats(!showStats)}
            >
              <View style={{ gap: 6 }}>
                {portalData.stats.map((st, idx) => (
                  <View key={idx} style={{
                    flexDirection: 'row',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    paddingVertical: 8,
                    borderBottomWidth: idx === portalData.stats.length - 1 ? 0 : 1,
                    borderBottomColor: C.line,
                  }}>
                    <Text style={{ fontSize: 13, color: C.ink, flex: 1, paddingRight: 8 }}>{st.label}</Text>
                    <View style={{ backgroundColor: C.primarySoft || '#F8E5E1', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10 }}>
                      <Text style={{ fontSize: 12, fontWeight: '800', color: C.primary }}>{st.value}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </Collapse>
          ) : null}

          {rowsList.length === 0 && !needPortalLogin ? (
            <Card>
              <View style={{ alignItems: 'center', paddingVertical: 20, gap: 10 }}>
                {webLoading ? <ActivityIndicator size="large" color={C.primary} /> : null}
                <Text style={{ color: C.mute, fontSize: 13, textAlign: 'center' }}>
                  {webLoading ? `Memuat turun rekod ${monthNames[selMonth - 1]} ${selYear} daripada pelayan…` : 'Tiada rekod dijumpai untuk bulan ini. Tekan Portal Web untuk menyemak.'}
                </Text>
              </View>
            </Card>
          ) : (
            rowsList.map((r, idx) => {
              const bt = badgeTheme(r.color);
              const hasIn = !!r.clockIn;
              const hasOut = !!r.clockOut;
              return (
                <Pressable
                  key={`${r.date}-${idx}`}
                  onPress={() => openDayModal(r)}
                  style={({ pressed }) => [{
                    backgroundColor: C.card,
                    borderRadius: 18,
                    padding: 14,
                    borderWidth: 1,
                    borderColor: bt ? bt.border : C.line,
                    borderLeftWidth: bt ? 5 : 1,
                    borderLeftColor: bt ? bt.text : C.line,
                  }, pressed && { opacity: 0.75 }]}
                >
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ fontSize: 15, fontWeight: '800', color: C.ink }}>{r.date}</Text>
                      <Text style={{ fontSize: 12, fontWeight: '600', color: C.mute }}>{r.day}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {r.diff ? (
                        <View style={{ backgroundColor: C.field, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8, borderWidth: 1, borderColor: C.line }}>
                          <Text style={{ fontSize: 11, fontWeight: '800', color: r.diff.startsWith('-') ? C.bad : C.ok }}>{r.diff}</Text>
                        </View>
                      ) : null}
                      {bt && r.color !== 'weekend' ? (
                        <View style={{ backgroundColor: bt.bg, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 8 }}>
                          <Text style={{ fontSize: 10, fontWeight: '800', color: bt.text }}>{bt.label}</Text>
                        </View>
                      ) : null}
                    </View>
                  </View>

                  {(hasIn || hasOut) ? (
                    <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                      <View style={{ flex: 1, backgroundColor: C.field, padding: 9, borderRadius: 12, borderWidth: 1, borderColor: C.line }}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: C.mute }}>MASUK</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                          <Text style={{ fontSize: 14, fontWeight: '800', color: C.ink }}>{r.clockIn || '—'}</Text>
                          {renderMethodBadge(r.inMethod)}
                        </View>
                      </View>
                      <View style={{ flex: 1, backgroundColor: C.field, padding: 9, borderRadius: 12, borderWidth: 1, borderColor: C.line }}>
                        <Text style={{ fontSize: 10, fontWeight: '700', color: C.mute }}>KELUAR</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 3 }}>
                          <Text style={{ fontSize: 14, fontWeight: '800', color: C.ink }}>{r.clockOut || '—'}</Text>
                          {renderMethodBadge(r.outMethod)}
                        </View>
                      </View>
                    </View>
                  ) : null}

                  {r.notes ? (
                    <View style={{ marginTop: 8, backgroundColor: C.primarySoft || '#F8E5E1', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10 }}>
                      <Text style={{ fontSize: 12, fontWeight: '700', color: C.primary }}>{r.notes}</Text>
                    </View>
                  ) : null}

                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                    <Text style={{ fontSize: 11, color: C.mute }}>
                      {r.transactions?.length ? `${r.transactions.length} log transaksi` : (r.totalHours ? `Jumlah: ${r.totalHours}` : 'Ketik untuk log & tindakan')}
                    </Text>
                    <MaterialIcons name="chevron-right" size={18} color={C.mute} />
                  </View>
                </Pressable>
              );
            })
          )}

          {rowsList.length > 0 ? (
            <Card title="Rujukan Warna" icon="ℹ️" tint={C.navy}>
              <View style={{ gap: 6 }}>
                {[
                  { color: '#DC2626', text: 'Lewat Masuk / Pulang Awal / Ditolak (Kerja Luar)' },
                  { color: '#FACC15', text: 'Menunggu Pengesahan (Kerja Luar)' },
                  { color: '#16A34A', text: 'Rekod Merah Diterima (Rasmi) / Diluluskan' },
                  { color: '#EA580C', text: 'Rekod Merah Diterima (Lain-lain)' },
                  { color: '#0284C7', text: 'Tiada Profil Waktu Bekerja' },
                ].map((lg, i) => (
                  <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View style={{ width: 14, height: 14, borderRadius: 4, backgroundColor: lg.color }} />
                    <Text style={{ fontSize: 12, color: C.mute, flex: 1 }}>{lg.text}</Text>
                  </View>
                ))}
              </View>
            </Card>
          ) : null}
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8, backgroundColor: C.field, borderBottomWidth: 1, borderBottomColor: C.line }}>
            <Text style={{ fontSize: 11, color: rowsList.length > 0 ? '#2E7D4F' : C.mute, fontWeight: '700' }}>
              {rowsList.length > 0 ? `✓ ${rowsList.length} hari disegerakkan (${monthNames[selMonth - 1]} ${selYear})` : '🌐 ihr.mtib.gov.my'}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                onPress={() => webViewRef.current?.reload()}
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.line }}
              >
                <MaterialIcons name="refresh" size={14} color={C.primary} />
                <Text style={{ fontSize: 11, fontWeight: '700', color: C.primary, marginLeft: 4 }}>Reload</Text>
              </Pressable>
              <Pressable
                onPress={() => Linking.openURL(portalUrl)}
                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 10, backgroundColor: C.card, borderWidth: 1, borderColor: C.line }}
              >
                <MaterialIcons name="open-in-browser" size={14} color={C.primary} />
                <Text style={{ fontSize: 11, fontWeight: '700', color: C.primary, marginLeft: 4 }}>Browser</Text>
              </Pressable>
            </View>
          </View>
          <WebView
            ref={webViewRef}
            source={{ uri: portalUrl }}
            style={{ flex: 1 }}
            injectedJavaScript={scraperScript}
            onMessage={onWebMessage}
            onLoadStart={() => setWebLoading(true)}
            onLoadEnd={() => {
              setWebLoading(false);
              webViewRef.current?.injectJavaScript(scraperScript);
            }}
            startInLoadingState={true}
            renderLoading={() => (
              <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: C.bg }}>
                <ActivityIndicator size="large" color={C.primary} />
                <Text style={{ marginTop: 12, color: C.mute, fontSize: 13, fontWeight: '600' }}>
                  Sila tunggu rekod kehadiran portal ke aplikasi…
                </Text>
              </View>
            )}
            javaScriptEnabled={true}
            domStorageEnabled={true}
            sharedCookiesEnabled={true}
            thirdPartyCookiesEnabled={true}
          />
        </View>
      )}

      <Modal visible={!!dayModal} transparent animationType="slide" onRequestClose={() => setDayModal(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.68)', justifyContent: 'flex-end' }}>
          <View style={{
            backgroundColor: C.card,
            borderTopLeftRadius: 28,
            borderTopRightRadius: 28,
            padding: 20,
            maxHeight: '90%',
            borderWidth: 1,
            borderColor: C.line,
          }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.line }}>
              <View>
                <Text style={{ fontSize: 19, fontWeight: '800', color: C.ink }}>
                  {dayModal?.date} ({dayModal?.day})
                </Text>
                <Text style={{ fontSize: 12, color: C.mute, marginTop: 2 }}>
                  {dayModal?.totalHours ? `Jumlah Bekerja: ${dayModal.totalHours} (${dayModal.diff})` : (dayModal?.notes || 'Transaksi & Tindakan Kehadiran')}
                </Text>
              </View>
              <Pressable onPress={() => setDayModal(null)} style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: C.field, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ fontSize: 16, color: C.mute, fontWeight: '800' }}>✕</Text>
              </Pressable>
            </View>

            <ScrollView style={{ marginVertical: 12 }} showsVerticalScrollIndicator={false}>
              <Text style={{ fontSize: 13, fontWeight: '800', color: C.ink, marginBottom: 8 }}>
                📋 Transaksi Kehadiran ({dayModal?.transactions?.length || 0})
              </Text>
              {dayModal?.transactions?.length > 0 ? (
                <View style={{ gap: 8, marginBottom: 16 }}>
                  {dayModal.transactions.map((tx, i) => (
                    <View key={i} style={{ backgroundColor: C.field, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: C.line }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                          <Text style={{ fontSize: 14, fontWeight: '800', color: C.ink }}>{tx.time}</Text>
                          {renderMethodBadge(tx.method)}
                        </View>
                        <Text style={{ fontSize: 11, fontWeight: '700', color: C.primary }}>#{i + 1}</Text>
                      </View>
                      <Text style={{ fontSize: 13, fontWeight: '600', color: C.ink, marginTop: 4 }}>
                        🏢 {tx.location || '-'}
                      </Text>
                      {tx.coord ? (
                        <Text style={{ fontSize: 11, color: C.mute, marginTop: 2 }}>
                          📍 Koordinat: {tx.coord}
                        </Text>
                      ) : null}
                    </View>
                  ))}
                </View>
              ) : (
                <View style={{ backgroundColor: C.field, padding: 12, borderRadius: 14, borderWidth: 1, borderColor: C.line, marginBottom: 16 }}>
                  <Text style={{ fontSize: 12, color: C.mute }}>
                    Tiada rekod imbasan terperinci untuk tarikh ini.
                  </Text>
                </View>
              )}

              <Text style={{ fontSize: 13, fontWeight: '800', color: C.ink, marginBottom: 8 }}>
                ✍️ Kemaskini Alasan / Laporan
              </Text>
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 12 }}>
                {[
                  { id: 'clock_in', label: 'Alasan Lewat' },
                  { id: 'clock_out', label: 'Pulang Awal' },
                  { id: 'bdr', label: 'Laporan BDR' },
                ].map((act) => {
                  const active = actionMode === act.id;
                  return (
                    <Pressable
                      key={act.id}
                      onPress={() => { setActionMode(active ? null : act.id); setSubmitErr(''); setSubmitMsg(''); }}
                      style={{
                        flex: 1,
                        paddingVertical: 9,
                        borderRadius: 12,
                        backgroundColor: active ? C.primary : C.field,
                        borderWidth: 1,
                        borderColor: active ? C.primary : C.line,
                        alignItems: 'center',
                      }}
                    >
                      <Text style={{ fontSize: 11, fontWeight: '800', color: active ? C.onPrimary : C.ink }}>
                        {act.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>

              {(actionMode === 'clock_in' || actionMode === 'clock_out') ? (
                <View style={{ backgroundColor: C.field, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: C.line, gap: 10, marginBottom: 12 }}>
                  <Text style={{ fontSize: 14, fontWeight: '800', color: C.ink }}>
                    {actionMode === 'clock_in' ? 'Alasan Lewat Masuk' : 'Alasan Pulang Awal'}
                  </Text>
                  <Text style={s.lbl}>Jenis Alasan *</Text>
                  <Select
                    value={reasonType === '2' ? 'Kelulusan / Urusan Rasmi' : 'Lain - Lain'}
                    placeholder="Pilih Jenis Alasan"
                    options={['Kelulusan / Urusan Rasmi', 'Lain - Lain']}
                    onPick={(lbl) => setReasonType(lbl.startsWith('Kelulusan') ? '2' : '1')}
                  />
                  <Text style={s.lbl}>Sub Jenis Alasan *</Text>
                  <Select
                    value={reasonSubType === '1' ? 'Bengkel / Latihan / Seminar' : reasonSubType === '2' ? 'Mesyuarat / Tugas Luar' : 'Pelepasan / Kelulusan Keluar Pejabat'}
                    placeholder="Pilih Sub Jenis"
                    options={['Bengkel / Latihan / Seminar', 'Mesyuarat / Tugas Luar', 'Pelepasan / Kelulusan Keluar Pejabat']}
                    onPick={(lbl) => setReasonSubType(lbl.startsWith('Bengkel') ? '1' : lbl.startsWith('Mesyuarat') ? '2' : '3')}
                  />
                  <Text style={s.lbl}>Nyatakan Alasan *</Text>
                  <TextInput
                    style={[s.in, { minHeight: 72, textAlignVertical: 'top' }]}
                    value={reasonText}
                    onChangeText={setReasonText}
                    placeholder="Tulis alasan anda di sini..."
                    placeholderTextColor={C.mute}
                    multiline
                  />
                  <Btn icon="📤" label="Hantar Alasan" onPress={submitPortalForm} busy={submitting} />
                </View>
              ) : null}

              {actionMode === 'bdr' ? (
                <View style={{ backgroundColor: C.field, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: C.line, gap: 10, marginBottom: 12 }}>
                  <Text style={{ fontSize: 14, fontWeight: '800', color: C.ink }}>
                    Laporan Kerja (BDR)
                  </Text>
                  <Text style={s.lbl}>Butiran Tugasan Harian *</Text>
                  <TextInput
                    style={[s.in, { minHeight: 100, textAlignVertical: 'top' }]}
                    value={bdrText}
                    onChangeText={setBdrText}
                    placeholder="Nyatakan tugasan yang dilaksanakan..."
                    placeholderTextColor={C.mute}
                    multiline
                  />
                  <Btn icon="📤" label="Hantar Laporan BDR" onPress={submitPortalForm} busy={submitting} />
                </View>
              ) : null}

              <Err msg={submitErr} />
              <Ok msg={submitMsg} />
            </ScrollView>

            <Btn kind="ghost" label="Tutup" onPress={() => setDayModal(null)} />
          </View>
        </View>
      </Modal>
    </View>
  );
};
function QrGeneratorView({ sess, back }) {
  const { C, s } = useT();
  const loc = useFix();
  const [locations, setLocations] = useState(PRESET_TABLET_LOCATIONS);
  const [loadingLocs, setLoadingLocs] = useState(true);
  const [pickedLabel, setPickedLabel] = useState(PRESET_TABLET_LOCATIONS[0].label);
  const [imeiInput, setImeiInput] = useState(PRESET_TABLET_LOCATIONS[0].imei);
  const [encryptedToken, setEncryptedToken] = useState('');
  const [generatedAt, setGeneratedAt] = useState('');
  const [fetchingQr, setFetchingQr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  useEffect(() => {
    let active = true;
    (async () => {
      const savedImei = await SecureStore.getItemAsync('TABLET_DEVICE_IMEI').catch(() => null);
      const savedLoc = await SecureStore.getItemAsync('TABLET_DEVICE_LOC').catch(() => null);
      if (savedImei && active) setImeiInput(savedImei);
      if (savedLoc && active) setPickedLabel(savedLoc);
      try {
        const res = await call(EP.tabletRef, {});
        if (!active) return;
        const parsed = parseTabletLocations(res);
        const mergedMap = new Map();
        PRESET_TABLET_LOCATIONS.forEach((x) => {
          if (x.imei) mergedMap.set(x.imei.toLowerCase(), x);
        });
        parsed.forEach((x) => {
          if (x.imei && x.label) mergedMap.set(x.imei.toLowerCase(), x);
        });
        const finalLocs = [...mergedMap.values()];
        setLocations(finalLocs);
        if (finalLocs.length > 0) {
          const matched = finalLocs.find((x) => x.label === savedLoc || x.imei === savedImei)
            || (savedLoc === MANUAL_LOC_LABEL ? null : finalLocs[0]);
          if (matched) {
            setPickedLabel(matched.label);
            setImeiInput(matched.imei);
          }
        }
      } catch (_) {
        // Kekalkan PRESET_TABLET_LOCATIONS jika gagal muat turun
      } finally {
        if (active) setLoadingLocs(false);
      }
    })();
    return () => { active = false; };
  }, []);
  const onPickLocation = async (label) => {
    setPickedLabel(label);
    setEncryptedToken('');
    setErr('');
    setOk('');
    await SecureStore.setItemAsync('TABLET_DEVICE_LOC', label);
    if (label === MANUAL_LOC_LABEL) return;
    const found = locations.find((x) => x.label === label);
    if (found && found.imei) {
      setImeiInput(found.imei);
      await SecureStore.setItemAsync('TABLET_DEVICE_IMEI', found.imei);
    }
  };
  const fetchLiveToken = async () => {
    const cleanImei = imeiInput.trim();
    if (!cleanImei) {
      setErr('Sila pilih lokasi atau masukkan IMEI tablet dari jadual attendance_devices.');
      return null;
    }
    setFetchingQr(true);
    setErr('');
    setOk('');
    try {
      await SecureStore.setItemAsync('TABLET_DEVICE_IMEI', cleanImei);
      const url = `${BASE_URL}${QR_GEN_ENDPOINT}?imei=${encodeURIComponent(cleanImei)}`;
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'text/plain, application/json', imei: String(deviceId()) },
      });
      const text = (await res.text()).trim();
      if (!res.ok || !text || text.startsWith('<')) {
        throw new Error(`Pelayan gagal menjana token QR (HTTP ${res.status}). Pastikan IMEI tablet wujud dalam attendance_devices.`);
      }
      const cleanToken = text.replace(/^"|"$/g, '');
      setEncryptedToken(cleanToken);
      setGeneratedAt(new Date().toLocaleTimeString('ms-MY', { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
      return cleanToken;
    } catch (e) {
      setErr(e.message);
      return null;
    } finally {
      setFetchingQr(false);
    }
  };
  const submitSelfAttendance = async () => {
    if (!sess?.staff_id) return setErr('ID staff belum dimuatkan. Kembali ke Dashboard dan tunggu data dimuat.');
    const freshToken = await fetchLiveToken();
    if (!freshToken) return;
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const lat = loc.fix?.latitude;
      const lng = loc.fix?.longitude;
      const r = await call(EP.qr, {
        staff_id: sess.staff_id,
        method: 'qr',
        qr_code: freshToken,
        latitude: lat,
        longitude: lng,
      });
      await addLocalTag('qr');
      await saveTagDetails('qr', lat, lng);
      triggerVibrate(true);
      setOk(typeof r === 'string' ? r : (r?.message || `Kehadiran QR (${pickedLabel || 'Lokasi'}) berjaya direkodkan.`));
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };
  const qrImageUrl = encryptedToken
    ? `https://api.qrserver.com/v1/create-qr-code/?size=260x260&margin=12&data=${encodeURIComponent(encryptedToken)}`
    : null;
  const dropdownOptions = [...locations.map((x) => x.label), MANUAL_LOC_LABEL];
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
      <Top title="Jana Kod QR" onBack={back} />
      <View style={{ padding: 16, gap: 14 }}>
        <Card title="Pilih Lokasi Tablet QR" icon="📍" tint={C.primary}>
          <Text style={s.lbl}>
            {loadingLocs ? 'Menyegerakkan senarai lokasi…' : 'Pilih lokasi tablet yang ingin diuji:'}
          </Text>
          <Select
            value={pickedLabel}
            placeholder="Pilih Lokasi Tablet"
            options={dropdownOptions}
            onPick={onPickLocation}
          />
          <Text style={[s.lbl, { marginTop: 12 }]}>
            IMEI Peranti ({pickedLabel === MANUAL_LOC_LABEL ? 'Manual' : 'Auto dari lokasi'}):
          </Text>
          <TextInput
            style={[s.in, pickedLabel !== MANUAL_LOC_LABEL && { opacity: 0.75 }]}
            value={imeiInput}
            onChangeText={setImeiInput}
            editable={pickedLabel === MANUAL_LOC_LABEL}
            placeholder="Contoh: 772df402efe84b8293e95509af4b31e5"
            placeholderTextColor={C.mute}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <View style={{ marginTop: 12 }}>
            <Btn icon="⚡" label="Jana Token QR Langsung" onPress={fetchLiveToken} busy={fetchingQr} />
          </View>
        </Card>
        <Card title="Paparan & Rekod Kehadiran" icon="🔲" tint={C.navy}>
          {qrImageUrl ? (
            <View style={{ alignItems: 'center', paddingVertical: 10 }}>
              <View style={{ backgroundColor: '#FFFFFF', padding: 14, borderRadius: 18, borderWidth: 1, borderColor: C.line }}>
                <Image
                  source={{ uri: qrImageUrl }}
                  style={{ width: 220, height: 220 }}
                  resizeMode="contain"
                />
              </View>
              <Text style={{ color: C.ink, fontSize: 13, fontWeight: '700', marginTop: 10, textAlign: 'center' }}>
                {pickedLabel}
              </Text>
              <Text style={{ color: C.mute, fontSize: 11, marginTop: 2 }}>
                Token dijana pada {generatedAt}
              </Text>
            </View>
          ) : (
            <Text style={{ color: C.mute, fontSize: 13, marginBottom: 10 }}>
              Pilih lokasi di atas dan tekan butang di bawah untuk menjana token QR bertandatangan terus daripada pelayan.
            </Text>
          )}
          <View style={{ marginTop: 8, gap: 10 }}>
            <Err msg={err} />
            <Ok msg={ok} />
            <Btn
              icon="✅"
              label="Jana & Rekod Kehadiran Sekarang"
              onPress={submitSelfAttendance}
              busy={busy || fetchingQr}
            />
          </View>
        </Card>
        <Loc {...loc} />
      </View>
    </ScrollView>
  );
}
const ProfileView = ({ sess, back, onCheckUpdate, checkingUpdate }) => {
  const { C, s, themeMode, changeTheme, colorTheme, changeColorTheme } = useT();
  const name = sess?.name || 'Pengguna';
  const themeOptions = [
    { id: 'light', label: 'Cerah', icon: 'light-mode' },
    { id: 'dark', label: 'Gelap', icon: 'dark-mode' },
    { id: 'system', label: 'Sistem', icon: 'settings-suggest' },
  ];
  const activeColorObj = COLOR_THEMES.find((t) => t.id === colorTheme) || COLOR_THEMES[0];
  const [wbfEnabled, setWbfEnabled] = useState(true);
  const [wbfInTime, setWbfInTime] = useState('07:45');
  const [wbfOutTime, setWbfOutTime] = useState('17:00');
  const [srvProfile, setSrvProfile] = useState('WBF (Fleksibel)');
  const [todayTargetTxt, setTodayTargetTxt] = useState('');
  const [okuVoice, setOkuVoice] = useState(false);
  const [okuAutoScan, setOkuAutoScan] = useState(false);

  useEffect(() => {
    (async () => {
      const en = await SecureStore.getItemAsync('WBF_REMINDER_ENABLED').catch(() => null);
      if (en !== null) setWbfEnabled(en === 'true');
      const inT = await SecureStore.getItemAsync('WBF_IN_TIME').catch(() => null);
      if (inT) setWbfInTime(inT);
      const outT = await SecureStore.getItemAsync('WBF_OUT_TIME').catch(() => null);
      if (outT) setWbfOutTime(outT);
      const prof = await SecureStore.getItemAsync('SERVER_WORK_PROFILE').catch(() => null);
      if (prof) setSrvProfile(prof);
      const sDate = await SecureStore.getItemAsync('WBF_TODAY_DATE').catch(() => null);
      const fMs = await SecureStore.getItemAsync('WBF_TODAY_FIRST_MS').catch(() => null);
      if (sDate === todayStr() && fMs) {
        const tOut = computeWbfTargetOut(Number(fMs));
        if (tOut) setTodayTargetTxt(`${fromMs(Number(fMs))} → ${fromMs(tOut)}`);
      }
      const vPref = await SecureStore.getItemAsync('OKU_VOICE_ENABLED').catch(() => null);
      if (vPref !== null) setOkuVoice(vPref === 'true');
      const aPref = await SecureStore.getItemAsync('OKU_AUTO_SCAN_FR').catch(() => null);
      if (aPref !== null) setOkuAutoScan(aPref === 'true');
    })();
  }, []);

  const toggleOkuVoice = async (val) => {
    setOkuVoice(val);
    triggerVibrate(false);
    await SecureStore.setItemAsync('OKU_VOICE_ENABLED', String(val));
    if (val) {
      speakMalay('Panduan suara Bahasa Melayu diaktifkan.', true);
    } else {
      Speech.stop();
    }
  };

  const toggleOkuAutoScan = async (val) => {
    setOkuAutoScan(val);
    triggerVibrate(false);
    await SecureStore.setItemAsync('OKU_AUTO_SCAN_FR', String(val));
    if (val) {
      speakMalay('Mod auto imbas wajah tanpa sentuh diaktifkan.');
    }
  };

  const toggleWbfReminder = async (val) => {
    if (val) {
      const { status } = await Notifications.requestPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Kebenaran Notifikasi', 'Sila benarkan notifikasi untuk aplikasi iHR dalam tetapan telefon anda.');
        return;
      }
    }
    setWbfEnabled(val);
    triggerVibrate(false);
    await SecureStore.setItemAsync('WBF_REMINDER_ENABLED', String(val));
    await syncWbfReminders({ enabled: val, inTime: wbfInTime, outTime: wbfOutTime });
  };

  const onPickWbfIn = async (lbl) => {
    const found = WBF_IN_OPTIONS.find((x) => x.label === lbl);
    if (!found) return;
    const code = `${pad(found.hour)}:${pad(found.minute)}`;
    setWbfInTime(code);
    triggerVibrate(false);
    await SecureStore.setItemAsync('WBF_IN_TIME', code);
    await syncWbfReminders({ enabled: wbfEnabled, inTime: code, outTime: wbfOutTime });
  };

  const onPickWbfOut = async (lbl) => {
    const found = WBF_OUT_OPTIONS.find((x) => x.label === lbl);
    if (!found) return;
    const code = `${pad(found.hour)}:${pad(found.minute)}`;
    setWbfOutTime(code);
    triggerVibrate(false);
    await SecureStore.setItemAsync('WBF_OUT_TIME', code);
    await syncWbfReminders({ enabled: wbfEnabled, inTime: wbfInTime, outTime: code });
  };

  const sendTestWbfNotification = async () => {
    const { status } = await Notifications.requestPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Kebenaran Notifikasi', 'Sila benarkan notifikasi dalam Tetapan Android/iOS terlebih dahulu.');
      return;
    }
    await ensureNotificationChannel();
    triggerVibrate(true);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `🔔 Ujian Peringatan ${srvProfile}`,
        body: todayTargetTxt
          ? `Rekod hari ini: ${todayTargetTxt} (Tempoh WBF: 7:30 PG – 9:00 PG & 4:30 PTG – 6:00 PTG).`
          : 'Peringatan WBF aktif! Waktu Masuk: 7:30 PG – 9:00 PG | Waktu Keluar: 4:30 PTG – 6:00 PTG.',
        sound: 'default',
      },
      trigger: null,
    });
  };

  const pickedInLabel = (WBF_IN_OPTIONS.find((x) => `${pad(x.hour)}:${pad(x.minute)}` === wbfInTime) || WBF_IN_OPTIONS[1]).label;
  const pickedOutLabel = (WBF_OUT_OPTIONS.find((x) => `${pad(x.hour)}:${pad(x.minute)}` === wbfOutTime) || WBF_OUT_OPTIONS[2]).label;
  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
      <Top title="Profil" onBack={back} />
      <View style={{ padding: 16, gap: 16 }}>
        <Card title="Maklumat Staf" icon="👤" tint={C.navy}>
          <Row icon="📛" k="Nama Penuh" v={name} tint={C.primary} stack={true} />
          <Row icon="🔢" k="No. Staf" v={sess?.staff_no || '-'} tint={C.navy} stack={true} last={true} />
        </Card>
        <Card title="Tema Aplikasi" icon="🎨" tint={C.primary}>
          <Text style={{ color: C.mute, fontSize: 13, marginBottom: 12 }}>
            Pilih paparan tema yang dikehendaki:
          </Text>
          <View style={{
            flexDirection: 'row',
            backgroundColor: C.field,
            padding: 4,
            borderRadius: 18,
            borderWidth: 1,
            borderColor: C.line,
            alignItems: 'center',
          }}>
            {themeOptions.map((opt) => {
              const active = themeMode === opt.id;
              return (
                <Pressable
                  key={opt.id}
                  onPress={() => changeTheme && changeTheme(opt.id)}
                  style={{
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'center',
                    justifyContent: 'center',
                    paddingVertical: 10,
                    borderRadius: 14,
                    backgroundColor: active ? C.primary : 'transparent',
                    gap: 6,
                    elevation: active ? 2 : 0,
                    shadowColor: active ? '#000' : 'transparent',
                    shadowOpacity: active ? 0.15 : 0,
                    shadowRadius: 4,
                    shadowOffset: { width: 0, height: 2 },
                  }}
                >
                  <MaterialIcons
                    name={opt.icon}
                    size={18}
                    color={active ? C.onPrimary : C.mute}
                  />
                  <Text
                    style={{
                      fontSize: 13,
                      fontWeight: active ? '800' : '600',
                      color: active ? C.onPrimary : C.mute,
                    }}
                  >
                    {opt.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={{ color: C.mute, fontSize: 13, marginTop: 14, marginBottom: 8 }}>
            Warna Tema:
          </Text>
          <Select
            value={activeColorObj.label}
            placeholder="Pilih Warna Tema"
            options={COLOR_THEMES.map((t) => t.label)}
            onPick={(pickedLbl) => {
              const found = COLOR_THEMES.find((t) => t.label === pickedLbl);
              if (found && changeColorTheme) changeColorTheme(found.id);
            }}
          />
        </Card>
        <Card title="Peringatan Kehadiran (WBF)" icon="⏰" tint={C.primary}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: C.ink }}>
                Notifikasi Masuk & Keluar
              </Text>
              <Text style={{ fontSize: 12, color: C.mute, marginTop: 2 }}>
                Profil Pelayan: {srvProfile} (Isnin – Jumaat)
              </Text>
            </View>
            <Switch
              value={wbfEnabled}
              onValueChange={toggleWbfReminder}
              trackColor={{ true: C.primary }}
            />
          </View>
          <View style={{ backgroundColor: C.field, padding: 10, borderRadius: 12, borderWidth: 1, borderColor: C.line, marginBottom: 12 }}>
            <Text style={{ fontSize: 11, fontWeight: '700', color: C.primary }}>
              🕒 Jadual WBF Fleksibel (9 Jam Bekerja)
            </Text>
            <Text style={{ fontSize: 12, color: C.ink, marginTop: 3 }}>
              {'• Waktu Masuk: 7:30 PG – 9:00 PG\n• Waktu Keluar: 4:30 PTG – 6:00 PTG' + (todayTargetTxt ? `\n• Sasaran Hari Ini (Pelayan): ${todayTargetTxt}` : '')}
            </Text>
          </View>
          {wbfEnabled ? (
            <View style={{ gap: 10 }}>
              <View>
                <Text style={s.lbl}>Peringatan Waktu Masuk (7:30 – 9:00 PG):</Text>
                <Select
                  value={pickedInLabel}
                  placeholder="Pilih Masa Masuk"
                  options={WBF_IN_OPTIONS.map((x) => x.label)}
                  onPick={onPickWbfIn}
                />
              </View>
              <View>
                <Text style={s.lbl}>Peringatan Waktu Keluar (Auto ikut Masuk / 4:30 – 6:00 PTG):</Text>
                <Select
                  value={pickedOutLabel}
                  placeholder="Pilih Masa Keluar"
                  options={WBF_OUT_OPTIONS.map((x) => x.label)}
                  onPick={onPickWbfOut}
                />
              </View>
              <Btn
                icon="🔔"
                label="Uji Notifikasi Sekarang"
                onPress={sendTestWbfNotification}
                kind="ghost"
              />
            </View>
          ) : null}
        </Card>
        <Card title="Aksesibiliti OKU (Penglihatan)" icon="♿" tint={C.primary}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: C.ink }}>
                Panduan Suara Bahasa Melayu
              </Text>
              <Text style={{ fontSize: 12, color: C.mute, marginTop: 2 }}>
                Sebut arahan kamera, kiraan masa & pengesahan kehadiran secara automatik
              </Text>
            </View>
            <Switch
              value={okuVoice}
              onValueChange={toggleOkuVoice}
              trackColor={{ true: C.primary }}
              accessibilityLabel="Panduan Suara Bahasa Melayu untuk pengguna OKU penglihatan"
            />
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <View style={{ flex: 1, paddingRight: 10 }}>
              <Text style={{ fontSize: 14, fontWeight: '700', color: C.ink }}>
                Auto-Imbas Wajah Tanpa Sentuh
              </Text>
              <Text style={{ fontSize: 12, color: C.mute, marginTop: 2 }}>
                Terus mula kiraan 3 saat & rekod kehadiran sebaik sahaja buka Wajah (FR)
              </Text>
            </View>
            <Switch
              value={okuAutoScan}
              onValueChange={toggleOkuAutoScan}
              trackColor={{ true: C.primary }}
              accessibilityLabel="Auto-Imbas Wajah Tanpa Sentuh apabila skrin Wajah dibuka"
            />
          </View>
          <Btn
            icon="🔊"
            label="Uji Panduan Suara OKU"
            onPress={() => {
              triggerVibrate(true);
              speakMalay('Panduan suara aksesibiliti O K U aktif. Buka menu Wajah untuk merekod kehadiran secara bebas tangan.', true);
            }}
            kind="ghost"
            a11yHint="Ketik dua kali untuk mendengar contoh panduan suara Bahasa Melayu"
          />
        </Card>
        <Card title="Kemas Kini & Versi" icon="🔄" tint={C.navy}>
          <Row icon="📱" k="Versi Semasa" v={`v${Application.nativeApplicationVersion || '1.1.0'} (Build #${Application.nativeBuildVersion || '1'})`} tint={C.primary} />
          <View style={{ marginTop: 10 }}>
            <Btn
              icon="🚀"
              label={checkingUpdate ? "Menyemak Kemas Kini..." : "Semak Kemas Kini Terkini"}
              onPress={() => onCheckUpdate && onCheckUpdate(true)}
              kind="ghost"
              busy={checkingUpdate}
            />
          </View>
        </Card>
        <Card title="Portal & Pautan" icon="🔗" tint={C.primary}>
          <Text style={{ color: C.mute, fontSize: 12, marginBottom: 10 }}>
            Akses terus ke sistem kehadiran dan cuti rasmi MTIB melalui pelayar peranti anda.
          </Text>
          <Btn 
            icon="🌐" 
            label="Buka Portal iHR MTIB" 
            onPress={() => Linking.openURL('https://ihr.mtib.gov.my')} 
            kind="ghost"
          />
        </Card>
      </View>
    </ScrollView>
  );
};
function FaceRecognitionView({ sess, back }) {
  const { C, s } = useT();
  const [perm, ask] = useCameraPermissions();
  const loc = useFix();
  const ref = useRef(null);
  const [shot, setShot] = useState(null);
  const [refFace, setRefFace] = useState(null);
  const [serverSynced, setServerSynced] = useState(false);
  const [syncingServer, setSyncingServer] = useState(false);
  const [countdown, setCountdown] = useState(null);
  const [autoSubmitAfterCountdown, setAutoSubmitAfterCountdown] = useState(false);
  const [okuAutoEnabled, setOkuAutoEnabled] = useState(false);
  const [okuVoiceLocal, setOkuVoiceLocal] = useState(false);
  const autoTriggeredRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [statusText, setStatusText] = useState('Letakkan wajah anda di dalam bingkai bujur');
  const [liveGpsAddress, setLiveGpsAddress] = useState('');

  // State Peranti FR (Lokasi GPS Peranti + Terminal FR)
  const [frDevices, setFrDevices] = useState(PRESET_FR_DEVICES);
  const [selectedFrLabel, setSelectedFrLabel] = useState(GPS_DEVICE_LOC_LABEL);
  const [frTabletImei, setFrTabletImei] = useState(PRESET_FR_DEVICES[0].imei);
  const [showDevicePicker, setShowDevicePicker] = useState(false);
  const [askFrPwd, setAskFrPwd] = useState(false);
  const [frUnlocked, setFrUnlocked] = useState(false);
  const [frPwd, setFrPwd] = useState('');
  const [customEpInput, setCustomEpInput] = useState('');
  const [liveClock, setLiveClock] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setLiveClock(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let on = true;
    if (!loc.fix) return () => { on = false; };
    (async () => {
      try {
        const rev = await Promise.race([
          Location.reverseGeocodeAsync({ latitude: loc.fix.latitude, longitude: loc.fix.longitude }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 4000)),
        ]);
        if (!on) return;
        if (rev && rev.length > 0) {
          const r = rev[0];
          const addr = [r.name, r.street, r.city, r.subregion].filter(Boolean).join(', ');
          setLiveGpsAddress(addr || `${loc.fix.latitude.toFixed(5)}, ${loc.fix.longitude.toFixed(5)}`);
        } else {
          setLiveGpsAddress(`${loc.fix.latitude.toFixed(5)}, ${loc.fix.longitude.toFixed(5)}`);
        }
      } catch (_) {
        if (on && loc.fix) {
          setLiveGpsAddress(`${loc.fix.latitude.toFixed(5)}, ${loc.fix.longitude.toFixed(5)}`);
        }
      }
    })();
    return () => { on = false; };
  }, [loc.fix]);

  const refKey = `FACE_REF_${sess?.staff_no || 'DEFAULT'}`;
  const syncFlagKey = `FACE_SRV_SYNCED_${sess?.staff_no || 'DEFAULT'}`;
  const paddedCardNo = String(sess?.staff_no || '').trim().padStart(8, '0');

  const getActiveDeviceLocation = useCallback(() => {
    if (selectedFrLabel === GPS_DEVICE_LOC_LABEL) {
      if (liveGpsAddress) return liveGpsAddress;
      if (loc.fix) return `${loc.fix.latitude.toFixed(5)}, ${loc.fix.longitude.toFixed(5)}`;
      return loc.err || 'Mengesan lokasi GPS peranti…';
    }
    if (selectedFrLabel === MANUAL_FR_DEVICE_LABEL) {
      return frTabletImei ? `Peranti FR (${frTabletImei.slice(0, 12)}…)` : 'Peranti FR Mudah Alih';
    }
    const found = frDevices.find((d) => d.label === selectedFrLabel);
    return found?.location || selectedFrLabel.replace(/\s*\(FR\)\s*$/i, '').trim() || 'Menara PGRM 1 - Tingkat 17';
  }, [selectedFrLabel, liveGpsAddress, loc.fix, loc.err, frTabletImei, frDevices]);

  useEffect(() => {
    let active = true;
    (async () => {
      const savedEp = await SecureStore.getItemAsync('FR_CUSTOM_ENDPOINT').catch(() => null);
      const savedImei = await SecureStore.getItemAsync('FR_TABLET_IMEI').catch(() => null);
      const savedDevLbl = await SecureStore.getItemAsync('FR_DEVICE_LABEL').catch(() => null);
      if (savedEp && active) setCustomEpInput(savedEp);
      if (savedImei && active) setFrTabletImei(savedImei);
      if (savedDevLbl && active) setSelectedFrLabel(savedDevLbl);

      try {
        const res = await call(EP.tabletRef, {});
        if (!active) return;
        const parsed = parseTabletLocations(res);
        const mergedMap = new Map();
        PRESET_FR_DEVICES.forEach((x) => mergedMap.set(x.label.toLowerCase(), x));
        parsed.forEach((x) => {
          if (x.imei && x.label) {
            const lbl = `${x.location || x.label} (FR)`;
            mergedMap.set(lbl.toLowerCase(), {
              label: lbl,
              location: x.location || x.label,
              imei: x.imei,
            });
          }
        });
        const combined = [...mergedMap.values()];
        setFrDevices(combined);
        if (savedDevLbl && savedDevLbl !== MANUAL_FR_DEVICE_LABEL && savedDevLbl !== GPS_DEVICE_LOC_LABEL) {
          const m = combined.find((d) => d.label === savedDevLbl);
          if (m) {
            setSelectedFrLabel(m.label);
            setFrTabletImei(m.imei);
          }
        }
      } catch (_) {}
    })();
    return () => { active = false; };
  }, []);

  const onPickFrDevice = async (lbl) => {
    setSelectedFrLabel(lbl);
    setErr('');
    setOk('');
    await SecureStore.setItemAsync('FR_DEVICE_LABEL', lbl).catch(() => {});
    if (lbl === MANUAL_FR_DEVICE_LABEL || lbl === GPS_DEVICE_LOC_LABEL) return;
    const found = frDevices.find((d) => d.label === lbl);
    if (found) {
      setFrTabletImei(found.imei);
      await SecureStore.setItemAsync('FR_TABLET_IMEI', found.imei).catch(() => {});
    }
  };

  const syncFromServerStorage = useCallback(async (silent = true) => {
    if (!sess?.staff_no) return;
    if (!silent) setSyncingServer(true);
    try {
      const dashRes = await call(EP.dashboard, { staff_no: sess.staff_no, staff_id: sess.staff_id });
      const srvPhoto = findPhoto(dashRes);
      if (srvPhoto) {
        setRefFace(srvPhoto);
        setServerSynced(true);
        await SecureStore.setItemAsync(refKey, srvPhoto).catch(() => {});
        await SecureStore.setItemAsync(syncFlagKey, 'true').catch(() => {});
        if (!silent) {
          triggerVibrate(true);
          setOk('Wajah rujukan berjaya disegerakkan daripada storan pelayan iHR.');
        }
      } else if (!silent) {
        Alert.alert(
          'Storan Wajah Pelayan',
          'Tiada gambar wajah ditemui di pelayan lagi. Sila ambil gambar wajah anda dan tekan "Segerak Pelayan".'
        );
      }
    } catch (e) {
      if (!silent) setErr(`Gagal menyegerakkan dengan pelayan: ${e.message}`);
    } finally {
      if (!silent) setSyncingServer(false);
    }
  }, [sess?.staff_no, sess?.staff_id, refKey, syncFlagKey]);

  useEffect(() => {
    if (perm && !perm.granted) {
      speakMalay('Sila benarkan akses kamera hadapan untuk pengecaman wajah.');
      ask();
    }
  }, [perm]);

  useEffect(() => {
    let on = true;
    (async () => {
      const saved = await SecureStore.getItemAsync(refKey).catch(() => null);
      const wasSynced = await SecureStore.getItemAsync(syncFlagKey).catch(() => null);
      if (saved && on) setRefFace(saved);
      if (wasSynced === 'true' && on) setServerSynced(true);
      const voicePref = await SecureStore.getItemAsync('OKU_VOICE_ENABLED').catch(() => null);
      if (on) setOkuVoiceLocal(voicePref === 'true');
      const autoPref = await SecureStore.getItemAsync('OKU_AUTO_SCAN_FR').catch(() => null);
      const isAuto = autoPref === 'true';
      if (on) setOkuAutoEnabled(isAuto);
      if (isAuto) {
        speakMalay('Mod terminal FR bebas tangan aktif. Halakan telefon ke wajah anda. Mengimbas secara automatik dalam 3 saat.');
      } else {
        speakMalay('Terminal pengecaman wajah F R dibuka. Halakan kamera hadapan ke wajah anda, kemudian tekan butang imbas dan rekod wajah sekarang.');
      }
      await syncFromServerStorage(true);
    })();
    return () => {
      on = false;
      try { Speech.stop(); } catch (_) {}
    };
  }, [refKey, syncFlagKey, syncFromServerStorage]);

  useEffect(() => {
    if (!okuAutoEnabled || autoTriggeredRef.current) return;
    if (!perm?.granted || shot || busy || ok) return;
    autoTriggeredRef.current = true;
    setAutoSubmitAfterCountdown(true);
    setCountdown(3);
    setStatusText('Mod Bebas Tangan: Mengimbas & merekod dalam 3 saat…');
  }, [okuAutoEnabled, perm?.granted, shot, busy, ok]);

  const captureFace = useCallback(async () => {
    try {
      setErr('');
      setStatusText('Memproses pengecaman wajah…');
      const p = await ref.current?.takePictureAsync({ quality: 0.45, skipProcessing: true });
      if (!p) {
        setStatusText('Gagal merakam gambar wajah. Cuba semula.');
        speakMalay('Gagal merakam gambar wajah. Sila cuba semula.');
        return null;
      }
      const resized = await ImageManipulator.manipulateAsync(
        p.uri,
        [{ resize: { width: 480 } }],
        { compress: 0.5, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      setShot(resized);
      triggerVibrate(false);
      setStatusText('Wajah dirakam! Sedia untuk pengesahan Terminal FR.');
      return resized;
    } catch (e) {
      setErr(e.message || 'Ralat kamera semasa merakam wajah.');
      speakMalay('Ralat kamera semasa merakam wajah.');
      return null;
    }
  }, []);

  useEffect(() => {
    if (countdown === null) return undefined;
    if (countdown > 0) {
      speakMalay(String(countdown));
    }
    if (countdown <= 0) {
      const shouldAutoSubmit = autoSubmitAfterCountdown;
      setCountdown(null);
      setAutoSubmitAfterCountdown(false);
      (async () => {
        const captured = await captureFace();
        if (captured && shouldAutoSubmit) {
          await submitFaceAttendance(captured);
        } else if (captured) {
          speakMalay('Gambar wajah berjaya dirakam. Tekan butang sahkan dan rekod kehadiran.');
        }
      })();
      return undefined;
    }
    const timer = setTimeout(() => setCountdown((c) => (c !== null ? c - 1 : null)), 1000);
    return () => clearTimeout(timer);
  }, [countdown, autoSubmitAfterCountdown, captureFace]);

  const uploadFaceToServerStorage = async (base64Img) => {
    const enrollPayload = {
      staff_id: sess.staff_id,
      staff_no: sess.staff_no,
      imei: String(deviceId()),
      method: 'fr',
      is_enroll: 1,
      img: base64Img,
      face_image: base64Img,
      photo: base64Img,
    };
    try {
      await call(EP.frEnroll, enrollPayload);
      return true;
    } catch (_) {
      try {
        await call(EP.frEnrollAlt, enrollPayload);
        return true;
      } catch (_2) {
        return false;
      }
    }
  };

  const nowSqlTimestamp = () => {
    const d = new Date();
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  const enrollReferenceFace = async () => {
    if (!sess?.staff_id) {
      return setErr('ID staff belum dimuatkan. Kembali ke Dashboard dan tunggu data dimuat.');
    }
    const target = shot || (await captureFace());
    if (!target?.base64) return;
    setSyncingServer(true);
    setErr('');
    setOk('');
    setStatusText('Menyimpan & menyegerakkan wajah rujukan…');
    try {
      const dataUri = `data:image/jpeg;base64,${target.base64}`;
      await SecureStore.setItemAsync(refKey, dataUri).catch(() => {});
      setRefFace(dataUri);

      await uploadFaceToServerStorage(target.base64);
      await syncFromServerStorage(true);

      setServerSynced(true);
      await SecureStore.setItemAsync(syncFlagKey, 'true').catch(() => {});
      triggerVibrate(true);
      setStatusText('Wajah rujukan aktif & disegerakkan!');
      setOk('Wajah rujukan berjaya disimpan dan disegerakkan untuk Terminal FR.');
      speakMalay('Wajah rujukan berjaya disimpan dan disegerakkan.');
    } catch (e) {
      setErr(`Ralat semasa menyimpan wajah rujukan: ${e.message}`);
    } finally {
      setSyncingServer(false);
    }
  };

  const submitFaceAttendance = async (capturedOverride = null) => {
    if (!sess?.staff_id) {
      return setErr('ID staff belum dimuatkan. Kembali ke Dashboard dan tunggu data dimuat.');
    }
    const target = capturedOverride || shot;
    if (!target?.base64) {
      return setErr('Sila imbas atau ambil gambar wajah terlebih dahulu.');
    }

    setBusy(true);
    setErr('');
    setOk('');
    let liveFix = loc.fix;
    if (!liveFix) {
      try {
        const p = await Location.requestForegroundPermissionsAsync();
        if (p.status === 'granted') {
          const fresh = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
          if (fresh?.coords) {
            liveFix = fresh.coords;
            loc.setFix(fresh.coords);
          }
        }
      } catch (_) {}
    }
    const liveLat = liveFix?.latitude;
    const liveLng = liveFix?.longitude;
    if (liveLat == null || liveLng == null) {
      setBusy(false);
      setStatusText('Lokasi GPS peranti diperlukan.');
      speakMalay('Tiada akses lokasi G P S peranti. Sila hidupkan lokasi telefon anda.');
      return setErr('Tiada akses lokasi GPS peranti. Sila hidupkan GPS / Lokasi telefon anda dan cuba semula.');
    }

    const isGpsMode = selectedFrLabel === GPS_DEVICE_LOC_LABEL;
    const activeLoc = isGpsMode
      ? (liveGpsAddress || `${liveLat.toFixed(5)}, ${liveLng.toFixed(5)}`)
      : getActiveDeviceLocation();
    setStatusText(`Menghantar rekod FR (${activeLoc})…`);

    const savedTabletImei = frTabletImei || (await SecureStore.getItemAsync('FR_TABLET_IMEI').catch(() => null)) || '772df402efe84b8293e95509af4b31e5';
    const customFrPath = customEpInput || (await SecureStore.getItemAsync('FR_CUSTOM_ENDPOINT').catch(() => null));
    const capTime = nowSqlTimestamp();

    const deviceDataPayload = {
      staff_id: sess.staff_id,
      staff_no: sess.staff_no,
      card_no: paddedCardNo,
      card_name: sess.name || '',
      captured_time: capTime,
      imei: savedTabletImei,
      latitude: liveLat,
      longitude: liveLng,
      type: 'fr',
      method: 'fr',
      img: target.base64,
      face_image: target.base64,
    };

    const candidateEps = [
      ...(customFrPath ? [{ path: customFrPath.replace(/^\/+/, ''), method: 'POST', code: 'F', retry: true, jsonFirst: true }] : []),
      EP.fr,
      EP.fr2,
      EP.fr3,
      EP.fr4,
      EP.fr5,
      EP.fr6,
      EP.frAlt,
    ];

    try {
      let res = null;
      let syncedToDeviceDatas = false;
      for (let i = 0; i < candidateEps.length; i++) {
        try {
          res = await call(candidateEps[i], deviceDataPayload);
          syncedToDeviceDatas = true;
          break;
        } catch (eTry) {
          const msg = String(eTry?.message || '');
          if (msg.includes('[F001]') || msg.includes('HTTP 404') || msg.includes('HTTP 405')) {
            continue;
          }
          throw eTry;
        }
      }

      // Hantar dengan koordinat GPS sebenar peranti ke pelayan iHR
      if (!syncedToDeviceDatas) {
        res = await call(EP.geotag, {
          staff_id: sess.staff_id,
          activity_type: 1,
          method: 'fr',
          latitude: liveLat,
          longitude: liveLng,
          img: target.base64,
        });
      }

      await addLocalTag('fr');
      await saveTagDetails('fr', liveLat, liveLng, isGpsMode ? '' : activeLoc);
      try {
        const prevSyncStr = await SecureStore.getItemAsync('SYNCED_TODAY_PORTAL');
        const prevSync = prevSyncStr ? JSON.parse(prevSyncStr) : null;
        const now12 = fromMs(Date.now());
        const isSameDay = prevSync && prevSync.date === todayStr();
        const nextSync = {
          date: todayStr(),
          clockIn: (isSameDay && prevSync.clockIn) ? prevSync.clockIn : now12,
          clockOut: (isSameDay && prevSync.clockIn) ? now12 : '',
          inMethod: (isSameDay && prevSync.clockIn) ? (prevSync.inMethod || 'fr') : 'fr',
          outMethod: (isSameDay && prevSync.clockIn) ? 'fr' : '',
          inLocation: (isSameDay && prevSync.clockIn) ? (prevSync.inLocation || activeLoc) : activeLoc,
          outLocation: (isSameDay && prevSync.clockIn) ? activeLoc : '',
        };
        await SecureStore.setItemAsync('SYNCED_TODAY_PORTAL', JSON.stringify(nextSync));
      } catch (_) {}
      const dataUri = `data:image/jpeg;base64,${target.base64}`;
      if (!refFace) {
        await SecureStore.setItemAsync(refKey, dataUri).catch(() => {});
        setRefFace(dataUri);
      }
      setServerSynced(true);
      await SecureStore.setItemAsync(syncFlagKey, 'true').catch(() => {});
      triggerVibrate(true);
      const nowTimeSpoken = fromMs(Date.now());
      setStatusText(`Disahkan oleh Peranti FR · ${activeLoc}`);
      const okMsg = typeof res === 'string'
        ? res
        : (res?.message || `Kehadiran Peranti FR (${activeLoc}) berjaya direkodkan untuk No. Kad ${paddedCardNo}.`);
      setOk(okMsg);
      speakMalay(`Berjaya! Kehadiran pengecaman wajah anda direkodkan di ${activeLoc} pada pukul ${nowTimeSpoken}.`);
    } catch (e) {
      setStatusText('Pengesahan gagal. Sila cuba semula.');
      setErr(e.message);
      speakMalay(`Maaf, pengesahan kehadiran gagal. ${e.message}`);
    } finally {
      setBusy(false);
    }
  };

  const quickScanAndSubmit = async () => {
    const captured = await captureFace();
    if (captured) {
      await submitFaceAttendance(captured);
    }
  };

  if (!perm?.granted) {
    return (
      <View style={{ flex: 1 }}>
        <Top title="Pengecaman Wajah (FR)" onBack={back} />
        <View style={{ padding: 16, gap: 12 }}>
          <Text style={{ color: C.ink }}>Tiada akses kamera hadapan untuk pengecaman wajah.</Text>
          <Btn label="Benarkan Kamera" onPress={ask} />
        </View>
      </View>
    );
  }

  const dropdownFrOptions = [GPS_DEVICE_LOC_LABEL, ...frDevices.map((d) => d.label), MANUAL_FR_DEVICE_LABEL];
  const activeLocDisplay = getActiveDeviceLocation();

  return (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
      <Top title="Pengecaman Wajah (FR)" onBack={back} onTitleLongPress={() => setAskFrPwd(!askFrPwd)} />
      {askFrPwd && !frUnlocked && (
        <View style={{ padding: 16, gap: 10 }}>
          <TextInput
            style={s.in}
            secureTextEntry
            placeholder="Kata laluan admin"
            placeholderTextColor={C.mute}
            value={frPwd}
            onChangeText={(t) => {
              setFrPwd(t);
              if (t.trim() === 'Mtib@123') { setFrUnlocked(true); setAskFrPwd(false); setFrPwd(''); }
            }}
          />
        </View>
      )}
      {frUnlocked && (
        <View style={{ padding: 16, gap: 10 }}>
          <Card title="Tetapan Lanjutan FR (Admin)" icon="⚙️" tint={C.primary}>
            <Text style={s.lbl}>Mod Lokasi / Terminal Peranti FR:</Text>
            <Select
              value={selectedFrLabel}
              placeholder="Pilih Mod Lokasi FR"
              options={dropdownFrOptions}
              onPick={onPickFrDevice}
            />
            {selectedFrLabel === MANUAL_FR_DEVICE_LABEL ? (
              <>
                <Text style={[s.lbl, { marginTop: 8 }]}>IMEI Peranti FR (attendance_devices):</Text>
                <TextInput
                  style={s.in}
                  value={frTabletImei}
                  onChangeText={async (v) => {
                    setFrTabletImei(v);
                    await SecureStore.setItemAsync('FR_TABLET_IMEI', v).catch(() => {});
                  }}
                  placeholder="Contoh: 772df402efe84b8293e95509af4b31e5"
                  placeholderTextColor={C.mute}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </>
            ) : null}
            <Text style={[s.lbl, { marginTop: 8 }]}>Laluan API FR Laravel (cth: api/device_data):</Text>
            <TextInput
              style={s.in}
              value={customEpInput}
              onChangeText={setCustomEpInput}
              placeholder="api/device_data"
              placeholderTextColor={C.mute}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <View style={{ marginTop: 10 }}>
              <Btn
                icon="💾"
                label="Simpan Tetapan Admin FR"
                onPress={async () => {
                  if (customEpInput.trim()) await SecureStore.setItemAsync('FR_CUSTOM_ENDPOINT', customEpInput.trim());
                  else await SecureStore.deleteItemAsync('FR_CUSTOM_ENDPOINT');
                  triggerVibrate(true);
                  Alert.alert('Disimpan', 'Tetapan admin FR telah disimpan.');
                }}
              />
            </View>
          </Card>
        </View>
      )}
      <View style={{ padding: 16, gap: 14 }}>
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{
              width: 52,
              height: 52,
              borderRadius: 26,
              backgroundColor: C.primarySoft || '#F8E5E1',
              borderWidth: 2,
              borderColor: serverSynced ? C.ok : refFace ? C.accent : C.primary,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
            }}>
              {refFace ? (
                <Image
                  source={refFace.startsWith('data:') ? { uri: refFace } : { uri: refFace, headers: { imei: String(deviceId()) } }}
                  style={{ width: '100%', height: '100%' }}
                  resizeMode="cover"
                />
              ) : (
                <MaterialIcons name="face" size={28} color={C.primary} />
              )}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ fontSize: 15, fontWeight: '800', color: C.ink }} numberOfLines={1}>
                {sess?.name || 'Pengguna'}
              </Text>
              <Text style={{ fontSize: 11, color: C.mute, marginTop: 2 }}>
                No. Staf: {sess?.staff_no || '-'} · {serverSynced ? '☁️ Wajah Disegerak' : '📱 Sedia Imbas'}
              </Text>
            </View>
            <Pressable
              onPress={() => syncFromServerStorage(false)}
              disabled={syncingServer}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel="Segerakkan wajah dengan storan pelayan"
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                backgroundColor: C.field,
                borderWidth: 1,
                borderColor: C.line,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {syncingServer ? (
                <ActivityIndicator size="small" color={C.primary} />
              ) : (
                <MaterialIcons name="cloud-sync" size={20} color={C.primary} />
              )}
            </Pressable>
            <Pressable
              onPress={async () => {
                const cur = await SecureStore.getItemAsync('OKU_VOICE_ENABLED').catch(() => null);
                const next = cur !== 'true';
                await SecureStore.setItemAsync('OKU_VOICE_ENABLED', String(next));
                setOkuVoiceLocal(next);
                triggerVibrate(false);
                if (next) speakMalay('Panduan suara diaktifkan.', true);
                else Speech.stop();
              }}
              accessible={true}
              accessibilityRole="button"
              accessibilityLabel={okuVoiceLocal ? 'Matikan panduan suara' : 'Aktifkan panduan suara'}
              style={{
                width: 38,
                height: 38,
                borderRadius: 19,
                backgroundColor: okuVoiceLocal ? C.primary : C.field,
                borderWidth: 1,
                borderColor: okuVoiceLocal ? C.primary : C.line,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <MaterialIcons name={okuVoiceLocal ? 'volume-up' : 'volume-off'} size={20} color={okuVoiceLocal ? C.onPrimary : C.mute} />
            </Pressable>
          </View>

          <View style={{
            marginTop: 10,
            paddingTop: 10,
            borderTopWidth: 1,
            borderTopColor: C.line,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
          }}>
            <MaterialIcons name="location-on" size={16} color={C.primary} />
            <Text style={{ fontSize: 12, fontWeight: '700', color: C.ink, flex: 1 }} numberOfLines={1}>
              {activeLocDisplay}
            </Text>
          </View>
        </Card>

        <View style={[s.cam, { height: 370, position: 'relative' }]}>
          {shot ? (
            <Image source={{ uri: shot.uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" />
          ) : (
            <CameraView ref={ref} style={{ width: '100%', height: '100%' }} facing="front" />
          )}

          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              alignItems: 'flex-end',
            }}
          >
            <View style={{ backgroundColor: 'rgba(20,20,26,0.75)', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 10 }}>
              <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                {liveClock.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </Text>
            </View>
          </View>

          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(0,0,0,0.16)',
            }}
          >
            <View
              style={{
                width: 210,
                height: 270,
                borderRadius: 135,
                borderWidth: 3,
                borderStyle: shot ? 'solid' : 'dashed',
                borderColor: ok ? '#22C55E' : shot ? '#FDC107' : '#FFFFFF',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              {countdown !== null && countdown > 0 ? (
                <Text style={{ fontSize: 54, fontWeight: '900', color: '#FFFFFF' }}>{countdown}</Text>
              ) : null}
            </View>
            <View
              style={{
                marginTop: 12,
                backgroundColor: 'rgba(20,20,26,0.78)',
                paddingHorizontal: 14,
                paddingVertical: 6,
                borderRadius: 14,
              }}
            >
              <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700', textAlign: 'center' }}>
                {statusText}
              </Text>
            </View>
          </View>
        </View>

        {shot ? (
          <View style={{ gap: 10 }}>
            <Btn
              icon="✅"
              label="Sahkan & Rekod Kehadiran (FR)"
              onPress={() => submitFaceAttendance()}
              busy={busy}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Btn
                  kind="ghost"
                  icon="🔄"
                  label="Imbas Semula"
                  onPress={() => {
                    setShot(null);
                    setErr('');
                    setOk('');
                    setStatusText('Letakkan wajah anda di dalam bingkai bujur');
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Btn
                  kind="ghost"
                  icon="☁️"
                  label="Segerak Pelayan"
                  onPress={enrollReferenceFace}
                  busy={syncingServer}
                />
              </View>
            </View>
          </View>
        ) : (
          <View style={{ gap: 10 }}>
            <Btn
              icon="🤳"
              label="Imbas & Rekod Wajah Sekarang"
              onPress={quickScanAndSubmit}
              busy={busy}
            />
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Btn
                  kind="ghost"
                  icon="⏱"
                  label={countdown !== null ? `Kiraan (${countdown}s)…` : 'Auto 3s + Rekod'}
                  a11yHint="Mulakan kiraan suara 3 saat dan rekod kehadiran secara automatik tanpa perlu sentuh lagi"
                  onPress={() => {
                    setErr('');
                    setOk('');
                    setAutoSubmitAfterCountdown(true);
                    setCountdown(3);
                    setStatusText('Kekalkan wajah anda di dalam bingkai…');
                  }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Btn
                  kind="ghost"
                  icon="📸"
                  label="Pratonton Wajah"
                  onPress={captureFace}
                />
              </View>
            </View>
          </View>
        )}

        <Err msg={err} />
        <Ok msg={ok} />
        <Loc {...loc} />
      </View>
    </ScrollView>
  );
}
function Cam({ mode, sess, back, onOpenGen }) {
  const { C, s } = useT();
  const [perm, ask] = useCameraPermissions(); const ref = useRef(null); const loc = useFix();
  const [shot, setShot] = useState(null); const [done, setDone] = useState(false);
  const [act, setAct] = useState(null); const [actOpen, setActOpen] = useState(false); const [sd, setSd] = useState(todayStr()); const [ed, setEd] = useState(todayStr());
  const [klType, setKlType] = useState(''); const [reason, setReason] = useState(''); const [opts, setOpts] = useState([]); const [wk, setWk] = useState([]);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState(''); const [ok, setOk] = useState('');
  const [askPwd, setAskPwd] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [pwd, setPwd] = useState('');
  const [useLoc, setUseLoc] = useState(true);

  useEffect(() => { if (perm && !perm.granted) ask(); }, [perm]);
  useEffect(() => {
    if (mode !== 'photo') return undefined; let on = true;
    call(EP.reference, {}).then((r) => { if (!on) return; const m = parseReference(r); if (m) { setOpts(m.outstation); setWk(m.working); } else setErr('Senarai jenis kerja luar tidak dapat dibaca. Respons pelayan: ' + peek(r)); }).catch((e) => { if (on) setErr(e.message); });
    return () => { on = false; };
  }, [mode]);
  
  const base = { staff_id: sess.staff_id };
  const need = () => (sess.staff_id ? '' : 'ID staff belum dimuatkan. Kembali ke Dashboard dan tunggu data dimuat.');
  
  const onQr = async ({ data }) => {
    if (done) return; if (need()) return setErr(need());
    triggerVibrate(true);
    setDone(true); setBusy(true); setErr('');
    try {
      const lat = useLoc ? loc.fix?.latitude : undefined;
      const lng = useLoc ? loc.fix?.longitude : undefined;
      const r = await call(EP.qr, { ...base, method: 'qr', qr_code: data, latitude: lat, longitude: lng });
      await addLocalTag('qr');
      await saveTagDetails('qr', lat, lng);
      setOk(typeof r === 'string' ? r : 'Imbasan QR berjaya.');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  
  const pickQr = async () => {
    const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images });
    if (!res.canceled && res.assets[0]) {
      setBusy(true); setErr(''); setDone(true);
      try {
        const scanned = await BarCodeScanner.scanFromURLAsync(res.assets[0].uri);
        if (scanned && scanned.length > 0) {
          const lat = useLoc ? loc.fix?.latitude : undefined;
          const lng = useLoc ? loc.fix?.longitude : undefined;
          const r = await call(EP.qr, { ...base, method: 'qr', qr_code: scanned[0].data, latitude: lat, longitude: lng });
          await addLocalTag('qr');
          await saveTagDetails('qr', lat, lng);
          triggerVibrate(true);
          setOk(typeof r === 'string' ? r : 'Muat naik QR berjaya.');
        } else {
          setErr('Kod QR tidak dikesan dalam gambar.'); setDone(false);
        }
      } catch (e) {
        setErr(e.message || 'Ralat membaca gambar QR.'); setDone(false);
      } finally { setBusy(false); }
    }
  };
  
  const snap = async () => { 
    const p = await ref.current?.takePictureAsync({ quality: 0.3, skipProcessing: true }); 
    if (p) {
      const resized = await ImageManipulator.manipulateAsync(
        p.uri,
        [{ resize: { width: 400 } }],
        { compress: 0.35, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      );
      setShot(resized); 
    } 
  };
  
  const sendPhoto = () => {
    if (need()) return setErr(need()); if (!act) { setActOpen(true); return setErr('Sila pilih jenis kehadiran'); }
    if (!shot) return setErr('Sila muat naik gambar'); if (!loc.fix) return setErr('Tiada akses lokasi');
    const payload = { ...base, activity_type: act, latitude: loc.fix.latitude, longitude: loc.fix.longitude, img: shot.base64 };
    if (act === 3) {
      if (!klType) return setErr('Sila pilih jenis kerja luar');
      if (!reason.trim()) return setErr('Sila isi alasan');
      if (ed < sd) return setErr('Tarikh akhir tidak boleh sebelum tarikh mula');
      payload.start_date = sd; payload.end_date = ed;
      const opt = opts.find((o) => o.label === klType);
      if (!opt || opt.id === undefined) return setErr('Senarai jenis kerja luar belum dimuatkan daripada pelayan. Semak sambungan dan buka semula skrin ini.');
      const w = wk.find((x) => /kerja\s*luar/i.test(x.label)); if (w) payload.activity_type = w.id;
      Object.assign(payload, kerjaLuarFields(opt, reason.trim()));
    }
    const label = ACTS.find(([v]) => v === act)[1];
    Alert.alert('Sahkan penghantaran', `Rekod kehadiran "${label}" akan disimpan dalam sistem iHR.`, [
      { text: 'Batal', style: 'cancel' },
      { text: 'Hantar', onPress: async () => {
        setBusy(true); setErr('');
        try { 
          const r = await call(EP.geotag, payload); 
          await addLocalTag('geo'); 
          await saveTagDetails('geo', loc.fix.latitude, loc.fix.longitude);
          triggerVibrate(true);
          setOk(typeof r === 'string' ? r : 'Geotagging berjaya dihantar.'); 
        } catch (e) { setErr(e.message); } finally { setBusy(false); }
      } },
    ]);
  };
  
  if (!perm?.granted) return (<View style={{ flex: 1 }}><Top title="Kamera" onBack={back} /><View style={{ padding: 16, gap: 12 }}><Text style={{ color: C.ink }}>Tiada akses kamera.</Text><Btn label="Benarkan kamera" onPress={ask} /></View></View>);
  
  return (
    <ScrollView keyboardShouldPersistTaps="handled">
      <Top title={mode === 'qr' ? 'Imbas QR' : 'Geotagging'} onBack={back} onTitleLongPress={() => setAskPwd(!askPwd)} />
      {askPwd && !unlocked && (
        <View style={{ padding: 16, gap: 10 }}>
          <TextInput 
            style={s.in} 
            secureTextEntry 
            placeholder="Kata laluan admin" 
            placeholderTextColor={C.mute}
            value={pwd} 
            onChangeText={t => {
              setPwd(t);
              if (t.trim() === 'Mtib@123') { setUnlocked(true); setAskPwd(false); setPwd(''); }
            }}
            onSubmitEditing={() => {
              if (pwd.trim() === 'Mtib@123') { setUnlocked(true); setAskPwd(false); setPwd(''); }
              else { Alert.alert('Ralat', 'Kata laluan salah'); setPwd(''); }
            }}
          />
          <Btn label="Sahkan" onPress={() => {
            if (pwd.trim() === 'Mtib@123') { setUnlocked(true); setAskPwd(false); setPwd(''); }
            else { Alert.alert('Ralat', 'Kata laluan salah'); setPwd(''); }
          }} />
        </View>
      )}
      {unlocked && (
        <View style={{ padding: 16, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text style={s.lbl}>Gunakan Lokasi Semasa</Text>
            <Switch value={useLoc} onValueChange={setUseLoc} trackColor={{ true: C.primary }} />
          </View>
          <Text style={s.lbl}>Manual Latitud</Text>
          <TextInput style={s.in} keyboardType="numeric" value={String(loc.fix?.latitude || '')} onChangeText={t => loc.setFix(f => ({...f, latitude: parseFloat(t) || 0, accuracy: 1}))} />
          <Text style={s.lbl}>Manual Longitud</Text>
          <TextInput style={s.in} keyboardType="numeric" value={String(loc.fix?.longitude || '')} onChangeText={t => loc.setFix(f => ({...f, longitude: parseFloat(t) || 0, accuracy: 1}))} />
          {mode === 'qr' && (
            <>
              <Btn label="Muat Naik QR dari Galeri" onPress={pickQr} icon="🖼" kind="ghost" />
              {onOpenGen && (
                <Btn label="Jana Kod QR" onPress={onOpenGen} icon="🔲" kind="ghost" />
              )}
            </>
          )}
        </View>
      )}
      <View style={{ padding: 16, gap: 14 }}>
      {shot ? <Image source={{ uri: shot.uri }} style={s.cam} /> :
        <CameraView ref={ref} style={s.cam} facing={mode === 'qr' ? 'back' : 'front'} barcodeScannerSettings={{ barcodeTypes: ['qr'] }} onBarcodeScanned={mode === 'qr' ? onQr : undefined} />}
      {mode === 'photo' ? (shot ? <><Btn icon="📤" label="Hantar gambar" onPress={sendPhoto} busy={busy} /><Btn kind="ghost" icon="🔄" label="Ambil semula" onPress={() => { setShot(null); setOk(''); }} /></> : <Btn icon="📷" label="Ambil Gambar" onPress={snap} />)
        : (done && !busy ? <Btn kind="ghost" icon="🔄" label="Imbas semula" onPress={() => { setDone(false); setErr(''); setOk(''); }} /> : <Text style={s.hint}>{busy ? 'Menghantar…' : 'Halakan kamera ke kod QR.'}</Text>)}
      <Err msg={err} /><Ok msg={ok} />
      {mode === 'photo' ? (
        <Collapse title="Jenis kehadiran" icon="🗂" tint={C.primary} summary={act ? ACTS.find(([v]) => v === act)[1] : 'Pilih jenis kehadiran'} strong={!!act} open={actOpen} onToggle={() => setActOpen(!actOpen)}>
          {ACTS.map(([v, l]) => (<Pressable key={v} onPress={() => { setAct(v); setActOpen(false); }} style={[s.opt, act === v && s.optOn]}><Text style={{ color: act === v ? C.onPrimary : C.ink, fontWeight: '600' }}>{l}</Text></Pressable>))}
        </Collapse>
      ) : null}
      {mode === 'photo' && act === 3 ? (<Card title="Butiran Kerja Luar" icon="🧳" tint={C.primary}>
          <Text style={s.lbl}>Jenis Kerja Luar</Text>
          <Select value={klType} placeholder="Pilih Jenis Kerja Luar" options={opts.map((o) => o.label)} onPick={setKlType} />
          <Text style={s.lbl}>Alasan</Text>
          <TextInput style={[s.in, { minHeight: 48 }]} value={reason} onChangeText={setReason} placeholder="Nyatakan alasan" placeholderTextColor={C.mute} multiline />
          <Text style={s.lbl}>Tarikh Mula</Text>
          <DateField value={sd} min={todayStr()} onPick={(v) => { setSd(v); if (ed < v) setEd(v); }} />
          <Text style={s.lbl}>Tarikh Akhir</Text>
          <DateField value={ed} min={sd} onPick={setEd} />
      </Card>) : null}
      <Loc {...loc} />
    </View></ScrollView>
  );
}

export default function App() {
  const systemScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [themeMode, setThemeMode] = useState('system');
  const [colorTheme, setColorTheme] = useState('terracotta');
  const [updateModal, setUpdateModal] = useState(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  useEffect(() => {
    SecureStore.getItemAsync('APP_THEME_MODE').then((saved) => {
      if (saved && ['system', 'light', 'dark'].includes(saved)) {
        setThemeMode(saved);
      }
    }).catch(() => {});
    SecureStore.getItemAsync('APP_COLOR_THEME').then((savedColor) => {
      if (savedColor && COLOR_THEMES.some((t) => t.id === savedColor)) {
        setColorTheme(savedColor);
      }
    }).catch(() => {});
  }, []);
  const changeTheme = async (mode) => {
    setThemeMode(mode);
    triggerVibrate(false);
    await SecureStore.setItemAsync('APP_THEME_MODE', mode);
  };
  const changeColorTheme = async (id) => {
    setColorTheme(id);
    triggerVibrate(false);
    await SecureStore.setItemAsync('APP_COLOR_THEME', id);
  };
  const checkForUpdate = useCallback(async (manual = false) => {
    setCheckingUpdate(true);
    try {
      const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
        headers: { 
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'iHR-App-Updater'
        },
      });
      if (!res.ok) {
        if (manual) Alert.alert('Kemas Kini', `Ralat sambungan GitHub (HTTP ${res.status}). Sila cuba lagi.`);
        return;
      }
      const release = await res.json();
      const latestTag = release.tag_name || release.name || '';
      
      const appVer = Application.nativeApplicationVersion || '1.1.0';
      const buildCode = Application.nativeBuildVersion || '';
      const currentVer = buildCode ? `${appVer}-${buildCode}` : appVer;
      
      const apkAsset = (release.assets || []).find((a) => a.name && a.name.toLowerCase().endsWith('.apk'));
      const downloadUrl = apkAsset ? apkAsset.browser_download_url : release.html_url;
      if (isRemoteNewer(latestTag, currentVer)) {
        setUpdateModal({
          version: latestTag,
          current: currentVer,
          body: release.body || 'Versi baharu sedia untuk dimuat turun.',
          downloadUrl: downloadUrl,
        });
      } else if (manual) {
        Alert.alert('Versi Terkini', `Aplikasi anda adalah versi terkini (${currentVer}).`);
      }
    } catch (e) {
      if (manual) Alert.alert('Ralat', `Gagal menyemak kemas kini: ${e.message}`);
    } finally {
      setCheckingUpdate(false);
    }
  }, []);
  useEffect(() => {
    checkForUpdate(false);
    (async () => {
      try {
        const { status } = await Notifications.getPermissionsAsync();
        if (status !== 'granted') {
          await Notifications.requestPermissionsAsync();
        }
        await syncWbfReminders();
      } catch (_) {}
    })();
  }, [checkForUpdate]);
  const activeScheme = themeMode === 'system' ? systemScheme : themeMode;
  const C = useMemo(() => buildTheme(activeScheme, colorTheme), [activeScheme, colorTheme]);
  const s = useMemo(() => makeStyles(C), [C]);
  const [sess, setSess] = useState(undefined); const [view, setView] = useState('home');
  const [logoutData, setLogoutData] = useState(null);
  useEffect(() => {
    loadSession().then(setSess).catch(() => setSess(null));
  }, []);
  const home = () => setView('home');
  useEffect(() => {
    const onBackPress = () => {
      if (updateModal) {
        setUpdateModal(null);
        return true;
      }
      if (sess && view !== 'home') {
        setView('home');
        return true;
      }
      return false;
    };
    const sub = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => sub.remove();
  }, [sess, view, updateModal]);
  let body;
  if (sess === undefined) body = <View style={s.center}><ActivityIndicator size="large" color={C.primary} /></View>;
  else if (!sess) body = <Register onDone={setSess} initialName={logoutData?.name || ''} initialNo={logoutData?.staff_no || ''} />;
  else if (view === 'qr') body = <Cam mode="qr" sess={sess} back={home} onOpenGen={() => setView('qrgen')} />;
  else if (view === 'fr') body = <FaceRecognitionView sess={sess} back={home} />;
  else if (view === 'qrgen') body = <QrGeneratorView sess={sess} back={home} />;
  else if (view === 'geo') body = <Cam mode="photo" sess={sess} back={home} />;
  else if (view === 'history') body = <HistoryView sess={sess} back={home} />;
  else if (view === 'profile') body = <ProfileView sess={sess} back={home} onCheckUpdate={checkForUpdate} checkingUpdate={checkingUpdate} />;
  else body = <Dashboard sess={sess} go={setView} onSess={setSess} onLogout={(oldSess) => { setLogoutData(oldSess); setSess(null); }} />;
  
  return (
    <ThemeCtx.Provider value={{ C, s, scheme: activeScheme, themeMode, changeTheme, colorTheme, changeColorTheme }}>
      <SafeAreaView style={s.root}>
        <StatusBar style={activeScheme === 'dark' ? 'light' : 'dark'} backgroundColor={C.bg} />
        {Platform.OS === 'android' ? <View style={{ height: RNBar.currentHeight || 0, backgroundColor: C.bg }} /> : null}
        {body}
        <Modal visible={!!updateModal} transparent animationType="fade" onRequestClose={() => setUpdateModal(null)}>
          <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'center', alignItems: 'center', padding: 22 }}>
            <View style={{
              backgroundColor: C.card,
              borderRadius: 26,
              width: '100%',
              maxWidth: 380,
              padding: 24,
              borderWidth: 1.5,
              borderColor: C.line,
              shadowColor: '#000',
              shadowOpacity: 0.25,
              shadowRadius: 18,
              elevation: 10,
            }}>
              <View style={{ alignItems: 'center', marginBottom: 14 }}>
                <View style={{ width: 66, height: 66, borderRadius: 33, backgroundColor: C.primarySoft || '#F8E5E1', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
                  <MaterialIcons name="system-update" size={36} color={C.primary} />
                </View>
                <Text style={{ fontSize: 21, fontWeight: '800', color: C.ink, textAlign: 'center' }}>
                  Kemas Kini Ditemui! 🎉
                </Text>
                <Text style={{ fontSize: 13, color: C.mute, marginTop: 4, textAlign: 'center' }}>
                  Versi {updateModal?.version} sedia untuk dimuat turun
                </Text>
              </View>
              <View style={{ backgroundColor: C.field, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: C.line, marginBottom: 18 }}>
                <Text style={{ fontSize: 11, fontWeight: '700', color: C.mute, textTransform: 'uppercase', marginBottom: 4 }}>
                  Nota Pelepasan:
                </Text>
                <Text style={{ fontSize: 13, color: C.ink, lineHeight: 18 }} numberOfLines={5}>
                  {updateModal?.body}
                </Text>
              </View>
              <View style={{ gap: 10 }}>
                <Pressable
                  onPress={() => {
                    if (updateModal?.downloadUrl) Linking.openURL(updateModal.downloadUrl);
                    setUpdateModal(null);
                  }}
                  style={({ pressed }) => [
                    s.btn,
                    { backgroundColor: C.primary },
                    pressed && { opacity: 0.85 }
                  ]}
                >
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <MaterialIcons name="download" size={20} color={C.onPrimary} />
                    <Text style={[s.btnTx, { color: C.onPrimary }]}>Muat Turun & Pasang</Text>
                  </View>
                </Pressable>
                <Pressable
                  onPress={() => setUpdateModal(null)}
                  style={({ pressed }) => [
                    s.btn,
                    s.btnGhost,
                    pressed && { opacity: 0.7 }
                  ]}
                >
                  <Text style={[s.btnTx, { color: C.mute }]}>Nanti Sahaja</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </ThemeCtx.Provider>
  );
}
const makeStyles = (C) => StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  regTopCentered: { alignItems: 'center', paddingVertical: 36 },
  logo: { color: C.ink, fontSize: 34, fontWeight: '800', letterSpacing: 1 },
  sub: { color: C.mute, fontSize: 13, marginTop: 4, textAlign: 'center' },
  dashTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12 },
  status: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.field, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: C.line },
  statusT: { fontSize: 11, color: C.mute, fontWeight: '600' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  profile: { alignItems: 'center', marginVertical: 14, paddingHorizontal: 16 },
  ring: { width: 92, height: 92, borderRadius: 46, borderWidth: 3, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  ringIn: { width: 80, height: 80, borderRadius: 40, backgroundColor: C.field, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  ringImg: { width: '100%', height: '100%' },
  ringT: { fontSize: 32, fontWeight: '800', color: C.primary },
  pNameBox: { alignItems: 'center', marginBottom: 6 },
  pName: { fontSize: 20, fontWeight: '800', color: C.ink, textAlign: 'center' },
  chips: { flexDirection: 'row', gap: 6, marginVertical: 4 },
  chip: { backgroundColor: C.field, paddingHorizontal: 12, paddingVertical: 4, borderRadius: 12, borderWidth: 1, borderColor: C.line },
  chipT: { fontSize: 12, color: C.mute, fontWeight: '600' },
  pill: { backgroundColor: C.primarySoft || '#F8E5E1', paddingHorizontal: 14, paddingVertical: 6, borderRadius: 14, marginTop: 6 },
  pillT: { fontSize: 12, fontWeight: '700', color: C.primary },
  statRow: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, borderRadius: 16, padding: 14, borderWidth: 1 },
  statH: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  statL: { fontSize: 12, fontWeight: '700' },
  statV: { fontSize: 20, fontWeight: '800', color: C.ink },
  top: { padding: 16, borderBottomWidth: 1, borderBottomColor: C.line, backgroundColor: C.bg },
  topT: { color: C.ink, fontSize: 20, fontWeight: '800' },
  card: { backgroundColor: C.card, borderRadius: 18, padding: 16, borderWidth: 1, borderColor: C.line },
  cardH: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  cardT: { fontSize: 16, fontWeight: '800', color: C.ink },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  rowK: { color: C.mute, fontSize: 13 },
  rowV: { color: C.ink, fontSize: 14, fontWeight: '600' },
  lbl: { color: C.mute, fontSize: 13, marginBottom: 6 },
  in: { borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, fontSize: 15, backgroundColor: C.field, color: C.ink },
  btn: { backgroundColor: C.primary, borderRadius: 14, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: C.primary },
  btnIn: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  btnIc: { fontSize: 16 },
  btnTx: { color: C.onPrimary, fontWeight: '800', fontSize: 15 },
  err: { backgroundColor: C.badBg, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: C.badLine },
  okBox: { backgroundColor: C.okBg, padding: 10, borderRadius: 10, borderWidth: 1, borderColor: C.okLine },
  hint: { color: C.mute, fontSize: 12, textAlign: 'center', marginTop: 4 },
  sel: { flexDirection: 'row', alignItems: 'center' },
  selList: { borderWidth: 1, borderColor: C.line, borderRadius: 12, backgroundColor: C.card, overflow: 'hidden' },
  selItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: C.line },
  opt: { padding: 12, borderRadius: 10, borderWidth: 1, borderColor: C.line, marginVertical: 4 },
  optOn: { backgroundColor: C.primary, borderColor: C.primary },
  cam: { height: 320, borderRadius: 18, overflow: 'hidden', backgroundColor: '#000' }
});
