// 1. POLYFILLS (MUST BE AT THE VERY TOP)
import 'react-native-get-random-values';
import { Buffer } from 'buffer';
global.Buffer = Buffer;

import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView,
  useWindowDimensions, SafeAreaView, Platform, StatusBar, ActivityIndicator, Alert, Clipboard
} from 'react-native';
import Svg, { Path, Text as SvgText, TextPath, Defs, G, Circle } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { generateSecretKey, getPublicKey, finalizeEvent, nip04 } from 'nostr-tools';
import { Relay } from 'nostr-tools/relay';

// ==========================================
// CONSTANTS & CONFIGURATION
// ==========================================

const STORAGE_KEYS = {
  HABITS: '@orbit_v15_habits',
  HISTORY: '@orbit_v15_history',
  THEME: '@orbit_v15_theme',
  CIRCLE: '@orbit_v15_circle',
  SYNC: '@orbit_v15_nostr_sync',
  PRIVKEY: '@orbit_v15_nostr_privkey'
};

const RELAYS = [
  'wss://nos.lol',
  'wss://relay.damus.io',
  'wss://relay.nostr.band'
];

const COLORS = {
  habits: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#6366f1'],
  success: '#10b981',
  danger: '#ef4444',
  white: '#ffffff'
};

const THEMES = {
  light: { bg: '#f1f5f9', card: '#ffffff', text: '#0f172a', subtext: '#64748b', border: '#e2e8f0' },
  dark: { bg: '#0b0f1a', card: '#161e2e', text: '#f3f4f6', subtext: '#9ca3af', border: '#2d3748' }
};

const SVG_CONFIG = {
  size: 1000, cx: 500, cy: 500, outerR: 450, innerR: 150
};

// ==========================================
// MATH & DATE HELPERS
// ==========================================

/**
 * Converts polar coordinates to Cartesian coordinates.
 */
const polarToCartesian = (centerX, centerY, radius, angleInDegrees) => {
  const angleInRadians = (angleInDegrees - 90) * (Math.PI / 180.0);
  return {
    x: centerX + radius * Math.cos(angleInRadians),
    y: centerY + radius * Math.sin(angleInRadians)
  };
};

/**
 * Generates an SVG path definition for a clockwise arc.
 */
const describeArcClockwise = (x, y, radius, startAngle, endAngle) => {
  const start = polarToCartesian(x, y, radius, startAngle);
  const end = polarToCartesian(x, y, radius, endAngle);
  return ["M", start.x, start.y, "A", radius, radius, 0, 0, 1, end.x, end.y].join(" ");
};

/**
 * Generates an SVG path definition for an annular sector (doughnut slice).
 */
const describeAnnularSector = (x, y, innerR, outerR, startA, endA) => {
  const p1 = polarToCartesian(x, y, outerR, endA);
  const p2 = polarToCartesian(x, y, outerR, startA);
  const p3 = polarToCartesian(x, y, innerR, startA);
  const p4 = polarToCartesian(x, y, innerR, endA);
  const largeArc = endA - startA <= 180 ? "0" : "1";
  
  return [
    "M", p1.x, p1.y, 
    "A", outerR, outerR, 0, largeArc, 0, p2.x, p2.y, 
    "L", p3.x, p3.y, 
    "A", innerR, innerR, 0, largeArc, 1, p4.x, p4.y, 
    "Z"
  ].join(" ");
};

const getWeeksInMonth = (date) => {
  const totalDays = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  return Math.ceil((totalDays + firstDay) / 7);
};


// ==========================================
// MAIN APP COMPONENT
// ==========================================

export default function App() {
  // --- Device & Refs ---
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;
  const horizontalScrollRef = useRef(null);
  const lastSyncedRef = useRef('');

  // --- UI State ---
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('tracker');
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [enableCircleView, setEnableCircleView] = useState(false);
  const [importPrivateKeyInput, setImportPrivateKeyInput] = useState('');
  const [showPrivateKey, setShowPrivateKey] = useState(false);

  // --- Data State ---
  const [currentDate, setCurrentDate] = useState(new Date());
  const [dailyHabits, setDailyHabits] = useState(Array(10).fill(''));
  const [weeklyHabits, setWeeklyHabits] = useState(Array(6).fill(''));
  const [monthlyHabits, setMonthlyHabits] = useState(Array(6).fill(''));
  const [history, setHistory] = useState({});

  // --- Crypto / Nostr State ---
  const [userPrivkey, setUserPrivkey] = useState(null);
  const [userPubkey, setUserPubkey] = useState(null);
  const [enableNostrSync, setEnableNostrSync] = useState(false);

  // --- Derived Data ---
  const theme = isDarkMode ? THEMES.dark : THEMES.light;
  const today = new Date();
  const isCurrentMonth = currentDate.getMonth() === today.getMonth() && currentDate.getFullYear() === today.getFullYear();
  const daysInMonth = useMemo(() => new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate(), [currentDate]);
  const weeksCount = useMemo(() => getWeeksInMonth(currentDate), [currentDate]);
  const monthLabel = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });
  const monthKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}`;
  const currentMonthData = history[monthKey] || { daily: {}, weekly: {}, monthly: {} };

  // ==========================================
  // LIFECYCLES
  // ==========================================

  // Initial Load
  useEffect(() => { 
    loadData(); 
  }, []);

  // Auto-Focus Current Day (Mobile Matrix)
  useEffect(() => {
    if (!loading && !enableCircleView && view === 'tracker' && isCurrentMonth) {
      const scrollPos = (today.getDate() - 1) * 36 - (width / 4);
      const timer = setTimeout(() => { 
        horizontalScrollRef.current?.scrollTo({ x: Math.max(0, scrollPos), animated: true }); 
      }, 500);
      return () => clearTimeout(timer);
    }
  }, [loading, view, enableCircleView, isCurrentMonth, width, today]);

  // Debounced Save & Sync
  useEffect(() => {
    if (loading) return;

    const saveLocal = async () => {
      try {
        await AsyncStorage.multiSet([
          [STORAGE_KEYS.HABITS, JSON.stringify({ daily: dailyHabits, weekly: weeklyHabits, monthly: monthlyHabits })],
          [STORAGE_KEYS.HISTORY, JSON.stringify(history)],
          [STORAGE_KEYS.THEME, JSON.stringify(isDarkMode)],
          [STORAGE_KEYS.CIRCLE, JSON.stringify(enableCircleView)],
          [STORAGE_KEYS.SYNC, JSON.stringify(enableNostrSync)]
        ]);
      } catch (e) { 
        console.error('Local save error:', e); 
      }
    };
    
    saveLocal();

    const timer = setTimeout(() => { 
      if (enableNostrSync && userPrivkey) publishToNostr(); 
    }, 3000);

    return () => clearTimeout(timer);
  }, [dailyHabits, weeklyHabits, monthlyHabits, history, isDarkMode, enableCircleView, enableNostrSync]);

  // Nostr Subscription Init
  useEffect(() => {
    if (enableNostrSync && userPrivkey && userPubkey) {
      listenToNostr();
    }
  }, [enableNostrSync, userPrivkey, userPubkey]);

  // ==========================================
  // METHODS
  // ==========================================

  const loadData = async () => {
    try {
      const [hData, histData, tData, cData, nData, privkeyStorage] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.HABITS),
        AsyncStorage.getItem(STORAGE_KEYS.HISTORY),
        AsyncStorage.getItem(STORAGE_KEYS.THEME),
        AsyncStorage.getItem(STORAGE_KEYS.CIRCLE),
        AsyncStorage.getItem(STORAGE_KEYS.SYNC),
        AsyncStorage.getItem(STORAGE_KEYS.PRIVKEY)
      ]);

      if (hData) {
        const h = JSON.parse(hData);
        setDailyHabits(h.daily || []); 
        setWeeklyHabits(h.weekly || []); 
        setMonthlyHabits(h.monthly || []);
      }
      if (histData) setHistory(JSON.parse(histData));
      if (tData) setIsDarkMode(JSON.parse(tData));
      if (cData) setEnableCircleView(JSON.parse(cData));
      if (nData) setEnableNostrSync(JSON.parse(nData));

      let privkeyHex = privkeyStorage;
      if (!privkeyHex) {
        const newSecretKey = generateSecretKey();
        privkeyHex = privkeyToHex(newSecretKey);
        await AsyncStorage.setItem(STORAGE_KEYS.PRIVKEY, privkeyHex);
      }

      const privkey = hexToPrivkey(privkeyHex);
      setUserPrivkey(privkey);
      setUserPubkey(getPublicKey(privkey));

    } catch (e) { 
      console.error('Load data error:', e); 
    } finally { 
      setLoading(false); 
    }
  };

  const publishToNostr = async () => {
    if (!userPrivkey || !userPubkey) return;

    const payload = JSON.stringify({ dailyHabits, weeklyHabits, monthlyHabits, history });
    if (payload === lastSyncedRef.current) return;

    try {
      const encryptedContent = await nip04.encrypt(userPrivkey, userPubkey, payload);
      const event = finalizeEvent({ 
        kind: 30000, 
        content: encryptedContent, 
        tags: [['d', 'habit-tracker-sync']], 
        created_at: Math.floor(Date.now() / 1000) 
      }, userPrivkey);

      await Promise.allSettled(RELAYS.map(async (url) => {
        try { 
          const r = new Relay(url); 
          await r.connect(); 
          await r.publish(event); 
          r.close(); 
        } catch (e) {
           // Silently ignore relay connection failures
        }
      }));

      lastSyncedRef.current = payload;
    } catch (e) { 
      console.error('Publish error:', e); 
    }
  };

  const listenToNostr = async () => {
    RELAYS.slice(0, 2).forEach(async (url) => {
      try {
        const relay = new Relay(url);
        await relay.connect();
        
        relay.subscribe([{ authors: [userPubkey], kinds: [30000], '#d': ['habit-tracker-sync'], limit: 1 }], {
          onevent: async (event) => {
            try {
              const decrypted = await nip04.decrypt(userPrivkey, userPubkey, event.content);
              if (decrypted !== lastSyncedRef.current) {
                const data = JSON.parse(decrypted);
                setDailyHabits(data.dailyHabits || []); 
                setWeeklyHabits(data.weeklyHabits || []); 
                setMonthlyHabits(data.monthlyHabits || []); 
                setHistory(data.history || {});
                lastSyncedRef.current = decrypted;
              }
            } catch (e) {
               console.error('Event processing error:', e);
            }
          }
        });
      } catch (e) {
         // Silently ignore relay listening failures
      }
    });
  };

  const updateHistory = (type, key, value) => {
    setHistory(prev => {
      const monthData = prev[monthKey] || { daily: {}, weekly: {}, monthly: {} };
      return { 
        ...prev, 
        [monthKey]: { 
          ...monthData, 
          [type]: { ...monthData[type], [key]: value } 
        } 
      };
    });
  };

  const changeMonth = (offset) => {
    setCurrentDate(prev => {
      let next = new Date(prev);
      next.setMonth(next.getMonth() + offset);
      return next > today && offset > 0 ? prev : next;
    });
  };

  const copyToClipboard = async (text) => {
    if (Platform.OS === 'web') { 
      if (navigator.clipboard) await navigator.clipboard.writeText(text); 
    } else { 
      await Clipboard.setString(text); 
    }
    Alert.alert('Copied!', 'Key copied to clipboard');
  };

  const privkeyToHex = (privkey) => Array.from(privkey).map(b => b.toString(16).padStart(2, '0')).join('');
  
  const hexToPrivkey = (hex) => new Uint8Array(hex.match(/.{1,2}/g).map(byte => parseInt(byte, 16)));

  const importPrivateKey = async () => {
    const input = importPrivateKeyInput.trim();
    if (input.length !== 64) { 
      Alert.alert('Error', 'Invalid key'); 
      return; 
    }
    try {
      const privkey = hexToPrivkey(input);
      const pubkey = getPublicKey(privkey);
      await AsyncStorage.setItem(STORAGE_KEYS.PRIVKEY, input);
      setUserPrivkey(privkey); 
      setUserPubkey(pubkey); 
      setImportPrivateKeyInput('');
      Alert.alert('Success', 'Key imported.');
    } catch (e) { 
      Alert.alert('Error', 'Import failed'); 
    }
  };

  // ==========================================
  // RENDER HELPERS
  // ==========================================

  const renderSettings = () => {
    const habitSections = [
      { t: "Daily Habits", d: dailyHabits, s: setDailyHabits }, 
      { t: "Weekly Goals", d: weeklyHabits, s: setWeeklyHabits }, 
      { t: "Monthly Milestones", d: monthlyHabits, s: setMonthlyHabits }
    ];

    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.bg }]}>
        <View style={[styles.settingsHeaderNav, { borderBottomColor: theme.border }]}>
          <Text style={[styles.settingsHeaderTitle, { color: theme.text }]}>Manage Tracks</Text>
          <TouchableOpacity onPress={() => setView('tracker')} style={styles.closeBtn}>
            <Text style={styles.closeBtnText}>Done</Text>
          </TouchableOpacity>
        </View>

        <ScrollView contentContainerStyle={styles.settingsScroll}>
          {/* Display Options */}
          <View style={[styles.settingsCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Display Options</Text>
            </View>
            <View style={[styles.modernInputRow, { borderTopColor: theme.border }]}>
              <Text style={[styles.modernInput, { color: theme.text }]}>Enable Circle View</Text>
              <TouchableOpacity 
                onPress={() => setEnableCircleView(!enableCircleView)} 
                style={[styles.toggleButton, { backgroundColor: enableCircleView ? COLORS.habits[0] : theme.border }]}
              >
                <Text style={styles.toggleText}>{enableCircleView ? '✓' : ''}</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Nostr Sync Options */}
          <View style={[styles.settingsCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={styles.cardHeader}>
              <Text style={[styles.cardTitle, { color: theme.text }]}>Nostr Sync</Text>
            </View>
            <View style={[styles.modernInputRow, { borderTopColor: theme.border }]}>
              <Text style={[styles.modernInput, { color: theme.text }]}>Enable Sync</Text>
              <TouchableOpacity 
                onPress={() => setEnableNostrSync(!enableNostrSync)} 
                style={[styles.toggleButton, { backgroundColor: enableNostrSync ? COLORS.habits[0] : theme.border }]}
              >
                <Text style={styles.toggleText}>{enableNostrSync ? '✓' : ''}</Text>
              </TouchableOpacity>
            </View>

            {enableNostrSync && (
              <>
                <View style={[styles.modernInputRow, { borderTopColor: theme.border, flexDirection: 'column', alignItems: 'flex-start', paddingVertical: 8 }]}>
                  <Text style={[styles.keyLabel, { color: theme.subtext }]}>📖 Public Key</Text>
                  <View style={[styles.keyDisplay, { backgroundColor: theme.bg, borderColor: theme.border }]}>
                    <Text style={[styles.keyText, { color: theme.text }]}>{userPubkey}</Text>
                  </View>
                  <TouchableOpacity onPress={() => copyToClipboard(userPubkey)} style={[styles.copyBtn, { backgroundColor: COLORS.habits[0] }]}>
                    <Text style={styles.copyBtnText}>📋 Copy Public Key</Text>
                  </TouchableOpacity>
                </View>

                <View style={[styles.dangerZone, { borderColor: theme.border, backgroundColor: theme.bg }]}>
                  <Text style={[styles.dangerTitle, { color: COLORS.danger }]}>🔐 PRIVATE KEY</Text>
                  {!showPrivateKey ? (
                    <View style={[styles.keyDisplay, { backgroundColor: theme.bg, borderColor: theme.border, justifyContent: 'center', alignItems: 'center' }]}>
                      <Text style={[styles.keyText, { color: theme.subtext }]}>••••••••••••••••</Text>
                    </View>
                  ) : (
                    <View style={[styles.keyDisplay, { backgroundColor: theme.bg, borderColor: theme.border }]}>
                      <Text style={[styles.keyText, { color: theme.text }]}>{privkeyToHex(userPrivkey)}</Text>
                    </View>
                  )}
                  
                  <View style={styles.keyButtonsRow}>
                    <TouchableOpacity onPress={() => setShowPrivateKey(!showPrivateKey)} style={[styles.halfBtn, { backgroundColor: theme.border, marginRight: 6 }]}>
                      <Text style={styles.halfBtnText}>{showPrivateKey ? '🙈' : '👁️'}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity onPress={() => copyToClipboard(privkeyToHex(userPrivkey))} style={[styles.halfBtn, { backgroundColor: COLORS.habits[0] }]}>
                      <Text style={styles.halfBtnText}>📋 Copy</Text>
                    </TouchableOpacity>
                  </View>

                  <TextInput 
                    placeholder="Paste key" 
                    placeholderTextColor={theme.subtext} 
                    value={importPrivateKeyInput} 
                    onChangeText={setImportPrivateKeyInput} 
                    style={[styles.importInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.bg }]} 
                  />
                  <TouchableOpacity onPress={importPrivateKey} style={[styles.importBtn, { backgroundColor: COLORS.success }]}>
                    <Text style={styles.importBtnText}>✓ Import & Sync</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>

          {/* Habit Editors */}
          {habitSections.map((sec, i) => (
            <View key={i} style={[styles.settingsCard, { backgroundColor: theme.card, borderColor: theme.border }]}>
              <View style={styles.cardHeader}>
                <Text style={[styles.cardTitle, { color: theme.text }]}>{sec.t}</Text>
                <TouchableOpacity onPress={() => sec.s([...sec.d, ''])}>
                  <Text style={[styles.addIconText, { color: theme.subtext }]}>+</Text>
                </TouchableOpacity>
              </View>
              {sec.d.map((h, idx) => (
                <View key={idx} style={[styles.modernInputRow, { borderTopColor: theme.border }]}>
                  <TextInput 
                    value={h} 
                    onChangeText={(v) => { let c = [...sec.d]; c[idx] = v; sec.s(c); }} 
                    placeholder="Habit..." 
                    placeholderTextColor={theme.subtext} 
                    style={[styles.modernInput, { color: theme.text }]} 
                  />
                  <TouchableOpacity onPress={() => sec.s(sec.d.filter((_, k) => k !== idx))}>
                    <Text style={styles.deleteText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
        <View style={{ alignItems: 'center', paddingVertical: 12 }}>
          <Text style={{ color: theme.subtext, fontSize: 12 }}>Created with ❤️ for the Nostr community. Built in the EU.</Text>
        </View>
      </SafeAreaView>
    );
  };

  const renderTracker = () => {
    const ringWidth = (SVG_CONFIG.outerR - SVG_CONFIG.innerR) / (Math.max(1, dailyHabits.length));
    const anglePerDay = 300 / daysInMonth;

    return (
      <SafeAreaView style={[styles.safeArea, { backgroundColor: theme.bg }]}>
        <ScrollView contentContainerStyle={styles.trackerContainer}>
          
          {/* Top Navigation */}
          <View style={styles.navBar}>
            <TouchableOpacity onPress={() => setIsDarkMode(!isDarkMode)} style={styles.themeToggle}>
              <Text style={styles.navText}>{isDarkMode ? "☀ LIGHT" : "🌙 DARK"}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setView('settings')} style={styles.editButtonContainer}>
              <Text style={styles.navText}>SETTINGS</Text>
            </TouchableOpacity>
          </View>

          {/* Main Card */}
          <View style={[styles.card, { backgroundColor: theme.card, borderColor: theme.border }]}>
            <View style={styles.pageContent}>
              
              <View style={styles.pageHeader}>
                <View>
                  <Text style={[styles.mainTitle, { color: theme.text }]}>Habits</Text>
                  <View style={[styles.titleUnderline, { backgroundColor: COLORS.habits[0] }]} />
                </View>
                <View style={styles.monthSelector}>
                  <TouchableOpacity onPress={() => changeMonth(-1)}>
                    <Text style={styles.arrowText}>←</Text>
                  </TouchableOpacity>
                  <Text style={[styles.monthDisplay, { color: theme.text }]}>{monthLabel}</Text>
                  <TouchableOpacity onPress={() => changeMonth(1)} disabled={isCurrentMonth}>
                    <Text style={[styles.arrowText, isCurrentMonth && { color: theme.border }]}>→</Text>
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.layoutWrapper}>
                
                {/* DAILY HABITS SECTION */}
                <View style={styles.svgColumn}>
                  {(isDesktop && enableCircleView) ? (
                    <View style={styles.svgContainer}>
                      <Svg viewBox={`0 0 ${SVG_CONFIG.size} ${SVG_CONFIG.size}`} style={StyleSheet.absoluteFill}>
                        <Defs>
                          {dailyHabits.map((_, h) => (
                            <Path key={h} id={`textPath-${h}`} d={describeArcClockwise(SVG_CONFIG.cx, SVG_CONFIG.cy, SVG_CONFIG.outerR - h * ringWidth - ringWidth / 2, -60, 0)} />
                          ))}
                        </Defs>
                        
                        {/* Day Numbers */}
                        {Array.from({ length: daysInMonth }).map((_, d) => {
                          const pos = polarToCartesian(SVG_CONFIG.cx, SVG_CONFIG.cy, SVG_CONFIG.outerR + 25, (d + 0.5) * anglePerDay);
                          return (
                            <SvgText key={d} x={pos.x} y={pos.y} fill={theme.subtext} fontSize="12" fontWeight="800" textAnchor="middle">
                              {d + 1}
                            </SvgText>
                          );
                        })}

                        {/* Habit Rings */}
                        {dailyHabits.map((name, h) => (
                          <G key={h}>
                            <SvgText fill={COLORS.habits[h % 10]} fontSize="14" fontWeight="bold">
                              <TextPath href={`#textPath-${h}`} startOffset="95%" textAnchor="end">{name || "Habit..."}</TextPath>
                            </SvgText>
                            {Array.from({ length: daysInMonth }).map((_, d) => {
                              const isFuture = isCurrentMonth && (d + 1) > today.getDate();
                              const isActive = currentMonthData.daily[`${d}-${h}`];
                              return (
                                <Path 
                                  key={d} 
                                  d={describeAnnularSector(SVG_CONFIG.cx, SVG_CONFIG.cy, SVG_CONFIG.outerR - (h + 1) * ringWidth, SVG_CONFIG.outerR - h * ringWidth, d * anglePerDay, (d + 1) * anglePerDay)}
                                  fill={isActive ? COLORS.habits[h % 10] : isFuture ? theme.card : theme.bg}
                                  stroke={theme.card} 
                                  strokeWidth="2" 
                                  onPress={() => !isFuture && updateHistory('daily', `${d}-${h}`, !isActive)} 
                                  opacity={isFuture ? 0.3 : 1} 
                                />
                              );
                            })}
                          </G>
                        ))}
                        <Circle cx={SVG_CONFIG.cx} cy={SVG_CONFIG.cy} r={SVG_CONFIG.innerR - 2} fill={theme.card} />
                      </Svg>
                    </View>
                  ) : (
                    <View style={styles.mobileDailyContainer}>
                      <View style={styles.headingWrapper}>
                        <Text style={styles.smallHeading}>Daily Tracks</Text>
                      </View>
                      <View style={[styles.stickyTableWrapper, { borderColor: theme.border }]}>
                        {/* Left Fixed Column */}
                        <View style={[styles.fixedColumn, { backgroundColor: theme.card, borderColor: theme.border }]}>
                          <View style={[styles.fixedHeaderCell, { backgroundColor: theme.bg, borderColor: theme.border }]}>
                            <Text style={styles.fixedHeaderText}>HABIT</Text>
                          </View>
                          {dailyHabits.map((n, hIdx) => (
                            <View key={hIdx} style={[styles.fixedHabitRow, { borderColor: theme.border, backgroundColor: hIdx % 2 === 0 ? theme.card : theme.bg }]}>
                              <Text numberOfLines={1} style={[styles.mobileHabitLabel, { color: theme.text }]}>{n || "..."}</Text>
                            </View>
                          ))}
                        </View>
                        
                        {/* Scrollable Matrix */}
                        <ScrollView horizontal showsHorizontalScrollIndicator={false} ref={horizontalScrollRef}>
                          <View>
                            <View style={[styles.mobileDayHeaderRow, { backgroundColor: theme.bg }]}>
                              {Array.from({ length: daysInMonth }).map((_, d) => {
                                const isToday = today.getDate() === d + 1 && isCurrentMonth;
                                return (
                                  <View key={d} style={[styles.mobileDayNumBox, { borderColor: theme.border }, isToday && { backgroundColor: COLORS.habits[0] }]}>
                                    <Text style={[styles.mobileDayNumText, isToday && { color: COLORS.white, fontWeight: 'bold' }]}>{d + 1}</Text>
                                  </View>
                                );
                              })}
                            </View>
                            {dailyHabits.map((_, hIdx) => (
                              <View key={hIdx} style={[styles.mobileHabitRow, { borderColor: theme.border, backgroundColor: hIdx % 2 === 0 ? theme.card : theme.bg }]}>
                                {Array.from({ length: daysInMonth }).map((_, dIdx) => (
                                  <TouchableOpacity 
                                    key={dIdx} 
                                    onPress={() => updateHistory('daily', `${dIdx}-${hIdx}`, !currentMonthData.daily[`${dIdx}-${hIdx}`])} 
                                    disabled={isCurrentMonth && (dIdx + 1) > today.getDate()}
                                    style={[
                                      styles.mobileCell, 
                                      { 
                                        borderColor: theme.border, 
                                        backgroundColor: currentMonthData.daily[`${dIdx}-${hIdx}`] 
                                          ? COLORS.habits[hIdx % 10] 
                                          : (today.getDate() === dIdx + 1 && isCurrentMonth) ? 'rgba(59, 130, 246, 0.1)' : 'transparent' 
                                      }, 
                                      isCurrentMonth && (dIdx + 1) > today.getDate() && { opacity: 0.1 }
                                    ]} 
                                  />
                                ))}
                              </View>
                            ))}
                          </View>
                        </ScrollView>
                      </View>
                    </View>
                  )}
                </View>

                {/* BOTTOM GRIDS: WEEKLY & MONTHLY */}
                <View style={styles.bottomGridsColumn}>
                  
                  {/* Weekly Goals */}
                  <View style={styles.gridSection}>
                    <View style={[styles.singleHeaderRow, { borderBottomColor: theme.border }]}>
                      <Text style={styles.smallHeading}>Weekly Goals</Text>
                      <View style={styles.headerWeekNums}>
                        {Array.from({ length: weeksCount }).map((_, i) => (
                          <Text key={i} style={styles.weekLabel}>W{i + 1}</Text>
                        ))}
                      </View>
                    </View>
                    <View style={styles.gridBody}>
                      {weeklyHabits.map((h, hIdx) => (
                        <View key={hIdx} style={[styles.tableRow, { borderBottomColor: theme.border }]}>
                          <TextInput 
                            value={h} 
                            onChangeText={(t) => { let c = [...weeklyHabits]; c[hIdx] = t; setWeeklyHabits(c); }} 
                            style={[styles.tableInput, { color: theme.text }]} 
                            placeholder="Goal..." 
                            placeholderTextColor={theme.subtext} 
                          />
                          <View style={styles.rowCells}>
                            {Array.from({ length: weeksCount }).map((_, w) => (
                              <TouchableOpacity 
                                key={w} 
                                onPress={() => updateHistory('weekly', `${w}-${hIdx}`, !currentMonthData.weekly[`${w}-${hIdx}`])} 
                                style={[
                                  styles.cell, 
                                  { borderColor: theme.border, backgroundColor: currentMonthData.weekly[`${w}-${hIdx}`] ? COLORS.habits[hIdx % 10] : theme.bg }
                                ]} 
                              />
                            ))}
                          </View>
                        </View>
                      ))}
                    </View>
                  </View>

                  {/* Monthly Milestones */}
                  <View style={styles.gridSection}>
                    <View style={[styles.singleHeaderRow, { borderBottomColor: theme.border }]}>
                      <Text style={styles.smallHeading}>Monthly Milestones</Text>
                    </View>
                    <View style={styles.gridBody}>
                      {monthlyHabits.map((h, hIdx) => (
                        <View key={hIdx} style={[styles.tableRow, { borderBottomColor: theme.border }]}>
                          <TextInput 
                            value={h} 
                            onChangeText={(t) => { let c = [...monthlyHabits]; c[hIdx] = t; setMonthlyHabits(c); }} 
                            style={[styles.tableInput, { color: theme.text }]} 
                            placeholder="Milestone..." 
                            placeholderTextColor={theme.subtext} 
                          />
                          <TouchableOpacity 
                            onPress={() => updateHistory('monthly', hIdx, !currentMonthData.monthly[hIdx])} 
                            style={[styles.cell, { width: 44, borderColor: theme.border, backgroundColor: currentMonthData.monthly[hIdx] ? COLORS.habits[hIdx % 10] : theme.bg }]}
                          >
                            <Text style={{ color: COLORS.white, fontWeight: 'bold' }}>
                              {currentMonthData.monthly[hIdx] ? '✓' : ''}
                            </Text>
                          </TouchableOpacity>
                        </View>
                      ))}
                    </View>
                  </View>

                </View>
              </View>
            </View>
          </View>
        </ScrollView>
        <View style={{ alignItems: 'center', paddingVertical: 12 }}>
          <Text style={{ color: theme.subtext, fontSize: 12 }}>Created with ❤️ for the Nostr community. Built in the EU.</Text>
        </View>
      </SafeAreaView>
    );
  };

  // ==========================================
  // MAIN RENDER DELEGATION
  // ==========================================

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: theme.bg }]}>
        <ActivityIndicator color={COLORS.habits[0]} />
      </View>
    );
  }

  return view === 'settings' ? renderSettings() : renderTracker();
}

// ==========================================
// STYLESHEETS
// ==========================================

const styles = StyleSheet.create({
  safeArea: { flex: 1, paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0, backgroundColor: THEMES.dark.bg },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  trackerContainer: { padding: 16, alignItems: 'center', paddingTop: 10 },
  
  // Navigation
  navBar: { width: '100%', maxWidth: 1200, flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 10, gap: 10, marginTop: 5, paddingHorizontal: 10 },
  themeToggle: { padding: 8, borderRadius: 8, backgroundColor: 'rgba(148,163,184,0.1)' },
  editButtonContainer: { padding: 8, borderRadius: 8, backgroundColor: 'rgba(148,163,184,0.1)' },
  navText: { color: COLORS.habits[0], fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  
  // Layouts
  card: { width: '100%', maxWidth: 1200, borderRadius: 24, borderWidth: 1, elevation: 20 },
  pageContent: { padding: 24, paddingTop: 40 },
  pageHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 50, flexWrap: 'wrap' },
  layoutWrapper: { flexDirection: 'column', gap: 60 },
  
  // Typography
  mainTitle: { fontSize: 32, fontWeight: '900', letterSpacing: -1.5 },
  titleUnderline: { width: 40, height: 5, borderRadius: 2, marginTop: 4 },
  smallHeading: { fontSize: 11, fontWeight: '900', color: THEMES.light.subtext, textTransform: 'uppercase', letterSpacing: 2 },
  
  // Calendar Navigation
  monthSelector: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, paddingBottom: 5 },
  monthDisplay: { fontSize: 18, fontWeight: '800', width: 160, textAlign: 'center' },
  arrowText: { fontSize: 22, color: COLORS.habits[0] },
  
  // SVG Circular View
  svgColumn: { width: '100%', alignItems: 'center' },
  svgContainer: { width: '100%', maxWidth: 800, aspectRatio: 1 },
  
  // Mobile Matrix View
  mobileDailyContainer: { width: '100%' },
  headingWrapper: { marginBottom: 20 },
  stickyTableWrapper: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderRadius: 16, overflow: 'hidden' },
  fixedColumn: { width: 140, borderRightWidth: 2, zIndex: 2 },
  fixedHabitRow: { height: 44, justifyContent: 'center', paddingHorizontal: 8, borderBottomWidth: 1 },
  fixedHeaderCell: { height: 32, justifyContent: 'center', paddingHorizontal: 8, borderBottomWidth: 1 },
  fixedHeaderText: { fontSize: 9, fontWeight: '900', color: THEMES.light.subtext },
  mobileHabitLabel: { fontSize: 11, fontWeight: '700' },
  mobileDayHeaderRow: { flexDirection: 'row' },
  mobileDayNumBox: { width: 36, height: 32, justifyContent: 'center', alignItems: 'center', borderRightWidth: 1 },
  mobileDayNumText: { fontSize: 10, color: THEMES.light.subtext },
  mobileHabitRow: { flexDirection: 'row', height: 44, borderBottomWidth: 1 },
  mobileCell: { width: 36, height: '100%', borderRightWidth: 1 },
  
  // Bottom Grids (Weekly/Monthly)
  bottomGridsColumn: { width: '100%', flexDirection: 'row', gap: 40, flexWrap: 'wrap', justifyContent: 'center' },
  gridSection: { flex: 1, minWidth: 350 },
  singleHeaderRow: { flexDirection: 'row', paddingVertical: 12, alignItems: 'center', borderBottomWidth: 1 },
  headerWeekNums: { flexDirection: 'row', marginLeft: 'auto' },
  weekLabel: { width: 32, textAlign: 'center', fontSize: 11, fontWeight: '900', marginLeft: 6, color: COLORS.habits[0] },
  tableRow: { flexDirection: 'row', height: 50, borderBottomWidth: 1, alignItems: 'center', gap: 10 },
  tableInput: { flex: 1, fontSize: 14, fontWeight: '600', minWidth: 100 },
  rowCells: { flexDirection: 'row' },
  cell: { width: 32, height: 32, marginLeft: 6, borderRadius: 10, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  
  // Settings View
  settingsHeaderNav: { flexDirection: 'row', justifyContent: 'space-between', padding: 25, borderBottomWidth: 1, alignItems: 'center' },
  settingsHeaderTitle: { fontSize: 24, fontWeight: '900' },
  closeBtn: { backgroundColor: COLORS.habits[0], paddingHorizontal: 22, paddingVertical: 12, borderRadius: 14 },
  closeBtnText: { color: COLORS.white, fontSize: 14, fontWeight: '900' },
  settingsScroll: { padding: 20 },
  settingsCard: { borderRadius: 18, padding: 18, borderWidth: 1, marginBottom: 25 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 22, alignItems: 'center' },
  cardTitle: { fontSize: 18, fontWeight: '900' },
  addIconText: { fontSize: 28, fontWeight: '400' },
  modernInputRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderTopWidth: 1 },
  modernInput: { flex: 1, fontSize: 16, fontWeight: '700' },
  deleteText: { fontSize: 18, color: COLORS.danger, marginLeft: 15, fontWeight: '400' },
  toggleButton: { width: 44, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginLeft: 12 },
  toggleText: { color: COLORS.white, fontWeight: 'bold', fontSize: 16 },
  
  // Nostr Key Display
  keyLabel: { fontSize: 11, fontWeight: '700', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 },
  keyDisplay: { width: '100%', borderRadius: 8, borderWidth: 1, padding: 12, marginBottom: 12 },
  keyText: { fontSize: 11, fontFamily: 'monospace', lineHeight: 16 },
  copyBtn: { width: '100%', paddingVertical: 10, borderRadius: 8, justifyContent: 'center', alignItems: 'center' },
  copyBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 13 },
  dangerZone: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 12 },
  dangerTitle: { fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 },
  keyButtonsRow: { flexDirection: 'row', width: '100%', gap: 0 },
  halfBtn: { flex: 1, paddingVertical: 8, borderRadius: 6, justifyContent: 'center', alignItems: 'center' },
  halfBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 12 },
  importInput: { width: '100%', borderRadius: 8, borderWidth: 1, padding: 10, marginVertical: 10, fontFamily: 'monospace', fontSize: 11 },
  importBtn: { width: '100%', paddingVertical: 10, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  importBtnText: { color: COLORS.white, fontWeight: 'bold', fontSize: 13 },
});