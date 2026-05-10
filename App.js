import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  StyleSheet, View, Text, TextInput, TouchableOpacity, ScrollView, 
  useWindowDimensions, SafeAreaView, Platform, StatusBar, ActivityIndicator 
} from 'react-native';
import Svg, { Path, Text as SvgText, TextPath, Defs, G, Circle, Line } from 'react-native-svg';
import AsyncStorage from '@react-native-async-storage/async-storage';

// --- MATH HELPERS ---
const polarToCartesian = (centerX, centerY, radius, angleInDegrees) => {
  // Clock Hour 0 (12 o'clock) is -90 degrees in standard geometry
  const angleInRadians = (angleInDegrees - 90) * (Math.PI / 180.0);
  return { 
    x: centerX + radius * Math.cos(angleInRadians), 
    y: centerY + radius * Math.sin(angleInRadians) 
  };
};

const describeArcClockwise = (x, y, radius, startAngle, endAngle) => {
  const start = polarToCartesian(x, y, radius, startAngle);
  const end = polarToCartesian(x, y, radius, endAngle);
  return ["M", start.x, start.y, "A", radius, radius, 0, 0, 1, end.x, end.y].join(" ");
};

const describeAnnularSector = (x, y, innerR, outerR, startA, endA) => {
  const p1 = polarToCartesian(x, y, outerR, endA);
  const p2 = polarToCartesian(x, y, outerR, startA);
  const p3 = polarToCartesian(x, y, innerR, startA);
  const p4 = polarToCartesian(x, y, innerR, endA);
  const largeArc = endA - startA <= 180 ? "0" : "1";
  return ["M", p1.x, p1.y, "A", outerR, outerR, 0, largeArc, 0, p2.x, p2.y, "L", p3.x, p3.y, "A", innerR, innerR, 0, largeArc, 1, p4.x, p4.y, "Z"].join(" ");
};

const getWeeksInMonth = (date) => {
  const totalDays = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  const firstDay = new Date(date.getFullYear(), date.getMonth(), 1).getDay();
  return Math.ceil((totalDays + firstDay) / 7);
};

const habitColors = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#f97316', '#84cc16', '#6366f1'];

export default function App() {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 1024;
  const scrollRef = useRef(null);

  const [view, setView] = useState('tracker');
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [dailyHabits, setDailyHabits] = useState(Array(10).fill(''));
  const [weeklyHabits, setWeeklyHabits] = useState(Array(6).fill(''));
  const [monthlyHabits, setMonthlyHabits] = useState(Array(6).fill(''));
  const [history, setHistory] = useState({});
  const [enableCircleView, setEnableCircleView] = useState(false);

  const theme = isDarkMode ? darkTheme : lightTheme;
  const today = new Date();

  // --- CALENDAR LOGIC ---
  const isCurrentMonth = currentDate.getMonth() === today.getMonth() && currentDate.getFullYear() === today.getFullYear();
  const daysInMonth = useMemo(() => new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0).getDate(), [currentDate]);
  const weeksCount = useMemo(() => getWeeksInMonth(currentDate), [currentDate]);
  const monthLabel = currentDate.toLocaleString('default', { month: 'long', year: 'numeric' });
  const monthKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}`;
  const currentMonthData = history[monthKey] || { daily: {}, weekly: {}, monthly: {} };

  useEffect(() => { loadData(); }, []);
  useEffect(() => { if (!loading) saveData(); }, [dailyHabits, weeklyHabits, monthlyHabits, history, isDarkMode, enableCircleView]);
  useEffect(() => {
    if (!isDesktop && isCurrentMonth && view === 'tracker' && scrollRef.current && !loading) {
      const scrollPos = Math.max(0, (today.getDate() - 1) * 36 - 100);
      setTimeout(() => scrollRef.current?.scrollTo({ x: scrollPos, animated: true }), 100);
    }
  }, [currentDate, view, isCurrentMonth, loading]);

  const loadData = async () => {
    try {
      const hData = await AsyncStorage.getItem('@orbit_v15_habits');
      const histData = await AsyncStorage.getItem('@orbit_v15_history');
      const tData = await AsyncStorage.getItem('@orbit_v15_theme');
      const cData = await AsyncStorage.getItem('@orbit_v15_circle');
      if (hData) {
        const h = JSON.parse(hData);
        setDailyHabits(h.daily || []); setWeeklyHabits(h.weekly || []); setMonthlyHabits(h.monthly || []);
      }
      if (histData) setHistory(JSON.parse(histData));
      if (tData) setIsDarkMode(JSON.parse(tData));
      if (cData) setEnableCircleView(JSON.parse(cData));
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const saveData = async () => {
    try {
      await AsyncStorage.setItem('@orbit_v15_habits', JSON.stringify({ daily: dailyHabits, weekly: weeklyHabits, monthly: monthlyHabits }));
      await AsyncStorage.setItem('@orbit_v15_history', JSON.stringify(history));
      await AsyncStorage.setItem('@orbit_v15_theme', JSON.stringify(isDarkMode));
      await AsyncStorage.setItem('@orbit_v15_circle', JSON.stringify(enableCircleView));
    } catch (e) { console.error(e); }
  };

  const updateHistory = (type, key, value) => {
    setHistory(prev => {
      const monthData = prev[monthKey] || { daily: {}, weekly: {}, monthly: {} };
      return { ...prev, [monthKey]: { ...monthData, [type]: { ...monthData[type], [key]: value } } };
    });
  };

  const changeMonth = (offset) => {
    setCurrentDate(prev => {
      let next = new Date(prev);
      next.setMonth(next.getMonth() + offset);
      return next > today && offset > 0 ? prev : next;
    });
  };

  if (loading) return <View style={[styles.centered, {backgroundColor: theme.bg}]}><ActivityIndicator color={habitColors[0]} /></View>;

  // --- GEOMETRY ---
  const svgSize = 1000, cx = 500, cy = 500, outerR = 450, innerR = 150;
  const ringWidth = (outerR - innerR) / (Math.max(1, dailyHabits.length));
  const anglePerDay = 300 / daysInMonth; 

  if (view === 'settings') {
    return (
      <SafeAreaView style={[styles.safeArea, {backgroundColor: theme.bg}]}>
        <View style={[styles.settingsHeaderNav, {borderBottomColor: theme.border}]}>
          <Text style={[styles.settingsHeaderTitle, {color: theme.text}]}>Manage Tracks</Text>
          <TouchableOpacity onPress={() => setView('tracker')} style={styles.closeBtn}><Text style={styles.closeBtnText}>Done</Text></TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.settingsScroll}>
          <View style={[styles.settingsCard, {backgroundColor: theme.card, borderColor: theme.border}]}>
            <View style={styles.cardHeader}><Text style={[styles.cardTitle, {color: theme.text}]}>Display Options</Text></View>
            <View style={[styles.modernInputRow, {borderTopColor: theme.border}]}>
              <Text style={[styles.modernInput, {color: theme.text}]}>Enable Circle View</Text>
              <TouchableOpacity onPress={() => setEnableCircleView(!enableCircleView)} style={[styles.toggleButton, {backgroundColor: enableCircleView ? habitColors[0] : theme.border}]}>
                <Text style={styles.toggleText}>{enableCircleView ? '✓' : ''}</Text>
              </TouchableOpacity>
            </View>
          </View>
          {[{ t: "Daily Habits", d: dailyHabits, s: setDailyHabits }, { t: "Weekly Goals", d: weeklyHabits, s: setWeeklyHabits }, { t: "Monthly Milestones", d: monthlyHabits, s: setMonthlyHabits }].map((sec, i) => (
            <View key={i} style={[styles.settingsCard, {backgroundColor: theme.card, borderColor: theme.border}]}>
              <View style={styles.cardHeader}><Text style={[styles.cardTitle, {color: theme.text}]}>{sec.t}</Text><TouchableOpacity onPress={() => sec.s([...sec.d, ''])}><Text style={[styles.addIconText, {color: theme.subtext}]}>+</Text></TouchableOpacity></View>
              {sec.d.map((h, idx) => (
                <View key={idx} style={[styles.modernInputRow, {borderTopColor: theme.border}]}>
                  <TextInput value={h} onChangeText={(v) => { let c = [...sec.d]; c[idx] = v; sec.s(c); }} placeholder="Habit..." placeholderTextColor={theme.subtext} style={[styles.modernInput, {color: theme.text}]} />
                  <TouchableOpacity onPress={() => sec.s(sec.d.filter((_, k) => k !== idx))}><Text style={styles.deleteText}>✕</Text></TouchableOpacity>
                </View>
              ))}
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safeArea, {backgroundColor: theme.bg}]}>
      <ScrollView contentContainerStyle={styles.trackerContainer}>
        <View style={styles.navBar}>
           <TouchableOpacity onPress={() => setIsDarkMode(!isDarkMode)} style={styles.themeToggle}><Text style={styles.navText}>{isDarkMode ? "☀ LIGHT" : "🌙 DARK"}</Text></TouchableOpacity>
           <TouchableOpacity onPress={() => setView('settings')} style={styles.editButtonContainer}><Text style={styles.navText}>SETTINGS</Text></TouchableOpacity>
        </View>

        <View style={[styles.card, {backgroundColor: theme.card, borderColor: theme.border}]}>
          <View style={styles.pageContent}>
            <View style={styles.pageHeader}>
              <View><Text style={[styles.mainTitle, {color: theme.text}]}>Habit Tracker</Text><View style={[styles.titleUnderline, {backgroundColor: habitColors[0]}]} /></View>
              <View style={styles.monthSelector}>
                <TouchableOpacity onPress={() => changeMonth(-1)}><Text style={styles.arrowText}>←</Text></TouchableOpacity>
                <Text style={[styles.monthDisplay, {color: theme.text}]}>{monthLabel}</Text>
                <TouchableOpacity onPress={() => changeMonth(1)} disabled={isCurrentMonth}><Text style={[styles.arrowText, isCurrentMonth && { color: theme.border }]}>→</Text></TouchableOpacity>
              </View>
            </View>

            <View style={styles.layoutWrapper}>
              <View style={styles.svgColumn}>
                {isDesktop && enableCircleView ? (
                  <View style={styles.svgContainer}>
                    <Svg viewBox={`0 0 ${svgSize} ${svgSize}`} style={StyleSheet.absoluteFill}>
                      <Defs>
                        {dailyHabits.map((_, h) => (
                          <Path key={`path-${h}`} id={`textPath-${h}`} d={describeArcClockwise(cx, cy, outerR - h * ringWidth - ringWidth/2, -60, 0)} />
                        ))}
                      </Defs>
                      {Array.from({ length: daysInMonth }).map((_, d) => {
                         const pos = polarToCartesian(cx, cy, outerR + 25, (d + 0.5) * anglePerDay);
                         return <SvgText key={d} x={pos.x} y={pos.y} fill={theme.subtext} fontSize="12" fontWeight="800" textAnchor="middle">{d + 1}</SvgText>;
                      })}
                      {dailyHabits.map((name, h) => (
                        <G key={h}>
                          <SvgText fill={habitColors[h % 10]} fontSize="14" fontWeight="bold">
                            <TextPath href={`#textPath-${h}`} startOffset="95%" textAnchor="end">{name || "Habit..."}</TextPath>
                          </SvgText>
                          {Array.from({ length: daysInMonth }).map((_, d) => {
                             const isFuture = isCurrentMonth && (d + 1) > today.getDate();
                             return (
                               <Path 
                                 key={d} d={describeAnnularSector(cx, cy, outerR - (h + 1) * ringWidth, outerR - h * ringWidth, d * anglePerDay, (d + 1) * anglePerDay)}
                                 fill={currentMonthData.daily[`${d}-${h}`] ? habitColors[h % 10] : isFuture ? theme.card : theme.bg} 
                                 stroke={theme.card} strokeWidth="2" onPress={() => !isFuture && updateHistory('daily', `${d}-${h}`, !currentMonthData.daily[`${d}-${h}`])} opacity={isFuture ? 0.3 : 1}
                               />
                             );
                          })}
                        </G>
                      ))}
                      <Circle cx={cx} cy={cy} r={innerR - 2} fill={theme.card} />
                    </Svg>
                  </View>
                ) : (
                  <View style={styles.mobileDailyContainer}>
                    <Text style={styles.smallHeading}>Daily Tracks</Text>
                    <View style={[styles.stickyTableWrapper, {borderColor: theme.border}]}>
                      <View style={[styles.fixedColumn, {backgroundColor: theme.card, borderColor: theme.border}]}>
                        <View style={[styles.fixedHeaderCell, {backgroundColor: theme.bg, borderColor: theme.border}]}><Text style={styles.fixedHeaderText}>HABIT</Text></View>
                        {dailyHabits.map((n, hIdx) => (
                          <View key={hIdx} style={[styles.fixedHabitRow, {borderColor: theme.border}]}><Text numberOfLines={1} style={[styles.mobileHabitLabel, {color: theme.text}]}>{n || "..."}</Text></View>
                        ))}
                      </View>
                      <ScrollView horizontal showsHorizontalScrollIndicator={false} ref={scrollRef}>
                        <View>
                          <View style={[styles.mobileDayHeaderRow, {backgroundColor: theme.bg}]}>
                            {Array.from({ length: daysInMonth }).map((_, d) => {
                              const isToday = today.getDate() === d + 1 && isCurrentMonth;
                              return (
                                <View key={d} style={[styles.mobileDayNumBox, {borderColor: theme.border}, isToday && {backgroundColor: habitColors[0]}]}>
                                  <Text style={[styles.mobileDayNumText, isToday && {color: '#fff', fontWeight: 'bold'}]}>{d + 1}</Text>
                                </View>
                              );
                            })}
                          </View>
                          {dailyHabits.map((_, hIdx) => (
                            <View key={hIdx} style={[styles.mobileHabitRow, {borderColor: theme.border}]}>
                              {Array.from({ length: daysInMonth }).map((_, dIdx) => (
                                <TouchableOpacity key={dIdx} onPress={() => updateHistory('daily', `${dIdx}-${hIdx}`, !currentMonthData.daily[`${dIdx}-${hIdx}`])} disabled={isCurrentMonth && (dIdx+1) > today.getDate()}
                                  style={[styles.mobileCell, { borderColor: theme.border, backgroundColor: currentMonthData.daily[`${dIdx}-${hIdx}`] ? habitColors[hIdx % 10] : 'transparent' }, isCurrentMonth && (dIdx+1) > today.getDate() && { opacity: 0.1 }]} />
                              ))}
                            </View>
                          ))}
                        </View>
                      </ScrollView>
                    </View>
                  </View>
                )}
              </View>

              <View style={styles.bottomGridsColumn}>
                {/* WEEKLY */}
                <View style={styles.gridSection}>
                  <View style={[styles.singleHeaderRow, {borderBottomColor: theme.border}]}>
                    <Text style={styles.smallHeading}>Weekly Goals</Text>
                    <View style={styles.headerWeekNums}>
                       {Array.from({length: weeksCount}).map((_, i) => <Text key={i} style={styles.weekLabel}>W{i+1}</Text>)}
                    </View>
                  </View>
                  <View style={styles.gridBody}>
                    {weeklyHabits.map((h, hIdx) => (
                      <View key={hIdx} style={[styles.tableRow, {borderBottomColor: theme.border}]}>
                        <TextInput value={h} onChangeText={(t) => { let c = [...weeklyHabits]; c[hIdx] = t; setWeeklyHabits(c); }} style={[styles.tableInput, {color: theme.text}]} placeholder="Goal..." placeholderTextColor={theme.subtext} />
                        <View style={styles.rowCells}>
                          {Array.from({length: weeksCount}).map((_, w) => (
                            <TouchableOpacity key={w} onPress={() => updateHistory('weekly', `${w}-${hIdx}`, !currentMonthData.weekly[`${w}-${hIdx}`])} 
                              style={[styles.cell, { borderColor: theme.border, backgroundColor: currentMonthData.weekly[`${w}-${hIdx}`] ? habitColors[hIdx % 10] : theme.bg }]} />
                          ))}
                        </View>
                      </View>
                    ))}
                  </View>
                </View>

                {/* MONTHLY */}
                <View style={styles.gridSection}>
                  <View style={[styles.singleHeaderRow, {borderBottomColor: theme.border}]}>
                    <Text style={styles.smallHeading}>Monthly Milestones</Text>
                    <View style={styles.headerWeekNums}>
                       <Text style={[styles.weekLabel, {opacity: 0}]}>W1</Text>
                    </View>
                  </View>
                  <View style={styles.gridBody}>
                    {monthlyHabits.map((h, hIdx) => (
                      <View key={hIdx} style={[styles.tableRow, {borderBottomColor: theme.border}]}>
                        <TextInput value={h} onChangeText={(t) => { let c = [...monthlyHabits]; c[hIdx] = t; setMonthlyHabits(c); }} style={[styles.tableInput, {color: theme.text}]} placeholder="Milestone..." placeholderTextColor={theme.subtext} />
                        <TouchableOpacity onPress={() => updateHistory('monthly', hIdx, !currentMonthData.monthly[hIdx])} 
                          style={[styles.cell, { width: 44, borderColor: theme.border, backgroundColor: currentMonthData.monthly[hIdx] ? habitColors[hIdx % 10] : theme.bg }]}>
                          <Text style={{color: '#fff', fontWeight: 'bold'}}>{currentMonthData.monthly[hIdx] ? '✓' : ''}</Text>
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
    </SafeAreaView>
  );
}

const lightTheme = { bg: '#f9fafb', card: '#ffffff', text: '#111827', subtext: '#6b7280', border: '#e5e7eb' };
const darkTheme = { bg: '#0b0f1a', card: '#161e2e', text: '#f3f4f6', subtext: '#9ca3af', border: '#2d3748' };

const styles = StyleSheet.create({
  safeArea: { 
    flex: 1, 
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
    backgroundColor: '#0b0f1a',
  },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  trackerContainer: { 
    padding: 16, 
    alignItems: 'center',
    paddingTop: 10, 
  },
  navBar: { 
    width: '100%', 
    maxWidth: 1200, 
    flexDirection: 'row', 
    justifyContent: 'flex-end', 
    marginBottom: 10, 
    gap: 10,
    marginTop: 5, 
    paddingHorizontal: 10,
  },
  themeToggle: { padding: 8, borderRadius: 8, backgroundColor: 'rgba(148,163,184,0.1)' },
  editButtonContainer: { padding: 8, borderRadius: 8, backgroundColor: 'rgba(148,163,184,0.1)' },
  navText: { color: habitColors[0], fontSize: 10, fontWeight: '900', letterSpacing: 1.5 },
  card: { width: '100%', maxWidth: 1200, borderRadius: 24, borderWidth: 1, elevation: 20 },
  pageContent: { padding: 24, paddingTop: 40 },
  pageHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 50, flexWrap: 'wrap' },
  mainTitle: { fontSize: 32, fontWeight: '900', letterSpacing: -1.5 },
  titleUnderline: { width: 40, height: 5, borderRadius: 2, marginTop: 4 },
  monthSelector: { flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, paddingBottom: 5 },
  monthDisplay: { fontSize: 18, fontWeight: '800', width: 160, textAlign: 'center' },
  arrowText: { fontSize: 22, color: habitColors[0] },
  layoutWrapper: { flexDirection: 'column', gap: 60 },
  svgColumn: { width: '100%', alignItems: 'center' },
  svgContainer: { width: '100%', maxWidth: 800, aspectRatio: 1 },
  bottomGridsColumn: { width: '100%', flexDirection: 'row', gap: 40, flexWrap: 'wrap', justifyContent: 'center' },
  gridSection: { flex: 1, minWidth: 350 },
  smallHeading: { fontSize: 11, fontWeight: '900', color: '#64748b', textTransform: 'uppercase', letterSpacing: 2 },
  singleHeaderRow: { flexDirection: 'row', paddingVertical: 12, alignItems: 'center', borderBottomWidth: 1 },
  headerWeekNums: { flexDirection: 'row', marginLeft: 'auto' },
  weekLabel: { width: 32, textAlign: 'center', fontSize: 11, fontWeight: '900', marginLeft: 6, color: habitColors[0] },
  tableRow: { flexDirection: 'row', height: 50, borderBottomWidth: 1, alignItems: 'center', gap: 10 },
  tableInput: { flex: 1, fontSize: 14, fontWeight: '600', minWidth: 100 },
  rowCells: { flexDirection: 'row' },
  cell: { width: 32, height: 32, marginLeft: 6, borderRadius: 10, borderWidth: 2, justifyContent: 'center', alignItems: 'center' },
  mobileDailyContainer: { width: '100%' },
  stickyTableWrapper: { flexDirection: 'row', borderTopWidth: 1, borderBottomWidth: 1, borderRadius: 16, overflow: 'hidden' },
  fixedColumn: { width: 160, borderRightWidth: 2, zIndex: 2 },
  fixedHabitRow: { height: 44, justifyContent: 'center', paddingHorizontal: 8, borderBottomWidth: 1 },
  fixedHeaderCell: { height: 32, justifyContent: 'center', paddingHorizontal: 8, borderBottomWidth: 1 },
  fixedHeaderText: { fontSize: 9, fontWeight: '900', color: '#64748b' },
  mobileHabitLabel: { fontSize: 11, fontWeight: '700' },
  mobileDayHeaderRow: { flexDirection: 'row' },
  mobileDayNumBox: { width: 36, height: 32, justifyContent: 'center', alignItems: 'center', borderRightWidth: 1 },
  mobileDayNumText: { fontSize: 10, color: '#64748b' },
  mobileHabitRow: { flexDirection: 'row', height: 44, borderBottomWidth: 1 },
  mobileCell: { width: 36, height: '100%', borderRightWidth: 1 },
  settingsSafe: { flex: 1 },
  settingsHeaderNav: { flexDirection: 'row', justifyContent: 'space-between', padding: 25, borderBottomWidth: 1, alignItems: 'center' },
  settingsHeaderTitle: { fontSize: 24, fontWeight: '900' },
  closeBtn: { backgroundColor: habitColors[0], paddingHorizontal: 22, paddingVertical: 12, borderRadius: 14 },
  closeBtnText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  settingsScroll: { padding: 20 },
  settingsCard: { borderRadius: 18, padding: 18, borderWidth: 1, marginBottom: 25 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 22, alignItems: 'center' },
  cardTitle: { fontSize: 18, fontWeight: '900' },
  addIconText: { fontSize: 28, fontWeight: '400' },
  modernInputRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, borderTopWidth: 1 },
  modernInput: { flex: 1, fontSize: 16, fontWeight: '700' },
  deleteText: { fontSize: 18, color: '#ef4444', marginLeft: 15, fontWeight: '400' },
  toggleButton: { width: 44, height: 32, borderRadius: 8, justifyContent: 'center', alignItems: 'center', marginLeft: 12 },
  toggleText: { color: '#fff', fontWeight: 'bold', fontSize: 16 },
});