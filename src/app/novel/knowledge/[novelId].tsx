import { Stack, useLocalSearchParams, router, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  Animated,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { formatKnowledgeSyncReport } from '@/services/novel-knowledge-sync';
import { useTavernStore } from '@/store/tavern-store';
import { ensureNovelDossiers } from '@/utils/novel-dossiers';
import { ensureNovelLoreEntries } from '@/utils/novel-lore';
import { showAppAlert } from '@/utils/app-alert';

type KnowledgePortalProps = {
  code: string;
  eyebrow: string;
  title: string;
  description: string;
  count: number;
  unit: string;
  primary?: boolean;
  wide: boolean;
  delay: number;
  onPress: () => void;
  accessibilityLabel: string;
};

function KnowledgePortal({
  code,
  eyebrow,
  title,
  description,
  count,
  unit,
  primary = false,
  wide,
  delay,
  onPress,
  accessibilityLabel,
}: KnowledgePortalProps) {
  const theme = useTheme();
  const motionEnabled = useTavernStore((state) => state.appearanceSettings.motionEnabled);
  const [reveal] = useState(() => new Animated.Value(motionEnabled ? 0 : 1));
  const [pressScale] = useState(() => new Animated.Value(1));
  const foreground = primary ? theme.background : theme.text;
  const muted = primary ? `${theme.background}B8` : theme.textMuted;
  const surface = primary ? theme.accent : theme.backgroundElement;
  const rule = primary ? `${theme.background}52` : theme.border;

  useEffect(() => {
    reveal.stopAnimation();
    if (!motionEnabled) {
      reveal.setValue(1);
      return;
    }
    reveal.setValue(0);
    Animated.timing(reveal, {
      toValue: 1,
      duration: 560,
      delay,
      useNativeDriver: true,
    }).start();
  }, [delay, motionEnabled, reveal]);

  function animatePress(toValue: number) {
    if (!motionEnabled) {
      pressScale.setValue(1);
      return;
    }
    Animated.spring(pressScale, {
      toValue,
      damping: 18,
      stiffness: 260,
      mass: 0.55,
      useNativeDriver: true,
    }).start();
  }

  return (
    <Animated.View
      style={[
        styles.portalReveal,
        wide && (primary ? styles.portalPrimaryWide : styles.portalSecondaryWide),
        {
          opacity: reveal,
          transform: [{ translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) }],
        },
      ]}>
      <Animated.View style={[styles.portalMotion, { transform: [{ scale: pressScale }] }]}>
        <Pressable
          onPress={onPress}
          onPressIn={() => animatePress(0.985)}
          onPressOut={() => animatePress(1)}
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel}
          style={[styles.portal, { backgroundColor: surface, borderColor: rule }]}>
          <Text pointerEvents="none" style={[styles.portalSerial, { color: foreground }]}>{code}</Text>
          <View pointerEvents="none" style={[styles.portalOrbit, { borderColor: foreground }]} />
          <View style={styles.portalHeader}>
            <View style={[styles.portalSignal, { backgroundColor: foreground }]} />
            <Text style={[styles.portalEyebrow, { color: muted }]}>{eyebrow}</Text>
          </View>
          <View style={styles.portalCopy}>
            <Text style={[styles.portalTitle, { color: foreground }]}>{title}</Text>
            <Text style={[styles.portalDescription, { color: muted }]}>{description}</Text>
          </View>
          <View style={styles.portalMetricRow}>
            <View style={styles.portalMetric}>
              <Text style={[styles.portalCount, { color: foreground }]}>{count}</Text>
              <Text style={[styles.portalLimit, { color: muted }]}>{unit}</Text>
            </View>
            <View style={styles.portalStatus}>
              <View style={[styles.portalStatusDot, { backgroundColor: foreground }]} />
              <Text style={[styles.portalStatusText, { color: muted }]}>INDEX ONLINE</Text>
            </View>
          </View>
          <View style={[styles.portalFooter, { borderTopColor: rule }]}>
            <Text style={[styles.portalEnter, { color: muted }]}>OPEN COLLECTION</Text>
            <View style={[styles.portalArrow, { borderColor: foreground }]}>
              <Text style={[styles.portalArrowText, { color: foreground }]}>↗</Text>
            </View>
          </View>
        </Pressable>
      </Animated.View>
    </Animated.View>
  );
}

export default function NovelKnowledgeHubScreen() {
  const theme = useTheme();
  const { width } = useWindowDimensions();
  const wide = width >= 860;
  const params = useLocalSearchParams();
  const novelId = Array.isArray(params.novelId) ? params.novelId[0] : params.novelId;
  const novels = useTavernStore((state) => state.novels);
  const syncNovelKnowledgeBase = useTavernStore((state) => state.syncNovelKnowledgeBase);
  const novel = novels.find((item) => item.id === novelId);

  const [syncing, setSyncing] = useState(false);
  const hasStoryAnalysis = Boolean(novel?.novelStoryAnalysis?.characters?.length);

  const characterCount = useMemo(
    () => (novel ? ensureNovelDossiers(novel).length : 0),
    [novel],
  );
  const loreCount = useMemo(
    () => (novel ? ensureNovelLoreEntries(novel).length : 0),
    [novel],
  );

  function handleSyncFromAnalysis() {
    if (!novelId || syncing) {
      return;
    }
    setSyncing(true);
    try {
      const report = syncNovelKnowledgeBase(novelId);
      showAppAlert('同步完成', formatKnowledgeSyncReport(report));
    } catch (error) {
      showAppAlert('同步失败', error instanceof Error ? error.message : '同步知识库失败。');
    } finally {
      setSyncing(false);
    }
  }

  if (!novelId || !novel) {
    return (
      <ThemedView style={styles.centered}>
        <Stack.Screen options={{ title: '知识库', headerShown: true }} />
        <ThemedText themeColor="textSecondary">未找到小说。</ThemedText>
        <Pressable onPress={() => router.replace('/(tabs)/novels' as Href)}>
          <ThemedText type="linkPrimary">返回书架</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <ThemedView decorated style={styles.container}>
      <Stack.Screen
        options={{
          title: '知识库',
          headerShown: true,
          headerBackTitle: '返回',
          headerStyle: { backgroundColor: theme.background },
          headerTintColor: theme.accent,
          headerTitleStyle: { color: theme.text, fontWeight: '700' },
        }}
      />

      <SafeAreaView style={styles.safeArea} edges={['left', 'right', 'bottom']}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={styles.hero}>
            <View style={styles.heroTopline}>
              <View style={[styles.heroRule, { backgroundColor: theme.accent }]} />
              <Text style={[styles.heroEyebrow, { color: theme.accent }]}>KNOWLEDGE VAULT / {novel.name}</Text>
            </View>
            <Text style={[styles.heroTitle, { color: theme.text }]}>知识索引</Text>
            <Text style={[styles.heroDescription, { color: theme.textMuted }]}>人物与世界各自归档；正文命中名称或别名时，系统才取出对应条目。</Text>
            <View style={styles.heroTelemetry}>
              <Text style={[styles.heroTelemetryValue, { color: theme.text }]}>{String(characterCount + loreCount).padStart(2, '0')}</Text>
              <Text style={[styles.heroTelemetryLabel, { color: theme.textMuted }]}>TOTAL RECORDS</Text>
              <View style={[styles.heroTelemetryDivider, { backgroundColor: theme.border }]} />
              <View style={[styles.liveDot, { backgroundColor: theme.accent }]} />
              <Text style={[styles.heroTelemetryLabel, { color: theme.textMuted }]}>CONTEXT ON DEMAND</Text>
            </View>
          </View>

          {hasStoryAnalysis ? (
            <Pressable
              onPress={handleSyncFromAnalysis}
              disabled={syncing}
              style={({ pressed }) => [
                styles.syncRail,
                { borderColor: theme.border, backgroundColor: theme.backgroundElement },
                pressed && styles.pressed,
                syncing && styles.pressed,
              ]}
              accessibilityRole="button"
              accessibilityLabel="从状态分析生成知识库">
              <View style={[styles.syncIndex, { borderColor: theme.accent }]}>
                <Text style={[styles.syncIndexText, { color: theme.accent }]}>Δ</Text>
              </View>
              <View style={styles.syncCopy}>
                <Text style={[styles.syncEyebrow, { color: theme.accent }]}>UNFILED ANALYSIS</Text>
                <Text style={[styles.syncTitle, { color: theme.text }]}>发现可归档的剧情状态</Text>
                <Text style={[styles.syncDescription, { color: theme.textMuted }]}>补入新角色与世界规则，不覆盖手工内容。</Text>
              </View>
              <Text style={[styles.syncAction, { color: theme.accent }]}>{syncing ? '归档中…' : '审阅归档 →'}</Text>
            </Pressable>
          ) : null}

          <View style={[styles.portalGrid, wide && styles.portalGridWide]}>
            <KnowledgePortal
              code="人"
              eyebrow="PERSONA ARCHIVE"
              title="人物档案"
              description="身份、别名、稳定事实、关系与人物弧。主角常驻，其他角色按提及唤醒。"
              count={characterCount}
              unit="PEOPLE"
              primary
              wide={wide}
              delay={70}
              onPress={() => router.push(`/novel/knowledge/characters/${novelId}` as Href)}
              accessibilityLabel="打开角色设定库"
            />
            <KnowledgePortal
              code="界"
              eyebrow="WORLD ATLAS"
              title="世界设定"
              description="世界、地点、势力与物品。只有命中名称或别名时，相关规则才进入正文上下文。"
              count={loreCount}
              unit="FILES"
              wide={wide}
              delay={170}
              onPress={() => router.push(`/novel/knowledge/lore/${novelId}` as Href)}
              accessibilityLabel="打开设定库"
            />
          </View>
        </ScrollView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  content: {
    padding: Spacing.four,
    gap: Spacing.four,
    paddingBottom: Spacing.six,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  hero: { paddingTop: Spacing.two, paddingBottom: Spacing.two, gap: 7 },
  heroTopline: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  heroRule: { width: 30, height: 3 },
  heroEyebrow: { fontSize: 9, lineHeight: 13, fontWeight: '900', letterSpacing: 1.6 },
  heroTitle: { fontFamily: 'serif', fontSize: 44, lineHeight: 52, fontWeight: '600', letterSpacing: 0.4 },
  heroDescription: { maxWidth: 640, fontSize: 13, lineHeight: 21 },
  heroTelemetry: { marginTop: Spacing.two, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 9 },
  heroTelemetryValue: { fontFamily: 'serif', fontSize: 22, lineHeight: 26, fontWeight: '600' },
  heroTelemetryLabel: { fontSize: 8, lineHeight: 11, fontWeight: '800', letterSpacing: 1.1 },
  heroTelemetryDivider: { width: StyleSheet.hairlineWidth, height: 22, marginHorizontal: 3 },
  liveDot: { width: 6, height: 6, borderRadius: 3 },
  syncRail: { minHeight: 88, borderWidth: 1, borderLeftWidth: 4, padding: Spacing.three, flexDirection: 'row', alignItems: 'center', gap: Spacing.three },
  syncIndex: { width: 38, height: 38, borderWidth: 1, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '45deg' }] },
  syncIndexText: { fontFamily: 'serif', fontSize: 17, transform: [{ rotate: '-45deg' }] },
  syncCopy: { flex: 1, minWidth: 180, gap: 2 },
  syncEyebrow: { fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 1.35 },
  syncTitle: { fontFamily: 'serif', fontSize: 17, lineHeight: 22, fontWeight: '600' },
  syncDescription: { fontSize: 10, lineHeight: 15 },
  syncAction: { fontSize: 11, lineHeight: 16, fontWeight: '800' },
  portalGrid: { gap: Spacing.three },
  portalGridWide: { flexDirection: 'row', alignItems: 'stretch' },
  portalReveal: { width: '100%' },
  portalPrimaryWide: { flex: 1.28, width: 'auto' },
  portalSecondaryWide: { flex: 0.92, width: 'auto' },
  portalMotion: { flex: 1 },
  portal: { minHeight: 330, flex: 1, overflow: 'hidden', borderWidth: 1, padding: Spacing.four, paddingTop: Spacing.three },
  portalSerial: { position: 'absolute', top: -28, right: -5, fontFamily: 'serif', fontSize: 138, lineHeight: 156, fontWeight: '400', opacity: 0.1 },
  portalOrbit: { position: 'absolute', width: 210, height: 210, borderRadius: 105, borderWidth: StyleSheet.hairlineWidth, right: -92, top: -90, opacity: 0.26 },
  portalHeader: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  portalSignal: { width: 22, height: 3 },
  portalEyebrow: { fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 1.45 },
  portalCopy: { marginTop: Spacing.four, maxWidth: 540, gap: Spacing.two },
  portalTitle: { fontFamily: 'serif', fontSize: 34, lineHeight: 41, fontWeight: '600', letterSpacing: 0.2 },
  portalDescription: { maxWidth: 480, fontSize: 12, lineHeight: 20 },
  portalMetricRow: { marginTop: 'auto', flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: Spacing.three },
  portalMetric: { flexDirection: 'row', alignItems: 'baseline', gap: 7 },
  portalCount: { fontFamily: 'serif', fontSize: 42, lineHeight: 48, fontWeight: '500' },
  portalLimit: { fontSize: 8, lineHeight: 12, fontWeight: '800', letterSpacing: 0.8 },
  portalStatus: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingBottom: 7 },
  portalStatusDot: { width: 5, height: 5, borderRadius: 3 },
  portalStatusText: { fontSize: 7, lineHeight: 10, fontWeight: '900', letterSpacing: 1 },
  portalFooter: { marginTop: Spacing.three, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  portalEnter: { fontSize: 8, lineHeight: 11, fontWeight: '900', letterSpacing: 1.2 },
  portalArrow: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  portalArrowText: { fontSize: 14, lineHeight: 18, fontWeight: '900' },
  pressed: { opacity: 0.68 },
});
