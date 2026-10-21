import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { Spacing } from '@/constants/theme';
import { useTavernStore } from '@/store/tavern-store';
import type { NovelCharacterBiography } from '@/types/tavern';

const BIOGRAPHY_PAGE_SIZE = 12;

type BiographyPalette = {
  paper: string;
  paperDeep: string;
  ink: string;
  muted: string;
  rule: string;
  accent: string;
  fieldFill: string;
};

type Props = {
  entries: NovelCharacterBiography[];
  palette: BiographyPalette;
  generatingId: string | null;
  onGenerate: (request: string, biographyId?: string) => Promise<boolean>;
  onUpdate: (biographyId: string, patch: Partial<Pick<NovelCharacterBiography, 'title' | 'content'>>) => void;
  onDelete: (biographyId: string) => void;
};

function dateLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return 'UNDATED';
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date).replaceAll('/', '.');
}

export function CharacterBiographyPage({
  entries,
  palette,
  generatingId,
  onGenerate,
  onUpdate,
  onDelete,
}: Props) {
  const { width } = useWindowDimensions();
  const motionEnabled = useTavernStore((state) => state.appearanceSettings.motionEnabled);
  const compact = width < 520;
  const [composerOpen, setComposerOpen] = useState(false);
  const [request, setRequest] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(BIOGRAPHY_PAGE_SIZE);
  const [sealMotion] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!motionEnabled) {
      sealMotion.stopAnimation();
      sealMotion.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(sealMotion, { toValue: 1, duration: 1800, useNativeDriver: true }),
        Animated.timing(sealMotion, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ]),
    );
    if (!entries.length && !composerOpen) animation.start();
    return () => animation.stop();
  }, [composerOpen, entries.length, motionEnabled, sealMotion]);

  async function submitNewBiography() {
    if (!request.trim() || generatingId) return;
    const saved = await onGenerate(request.trim());
    if (saved) {
      setRequest('');
      setComposerOpen(false);
      setVisibleCount((current) => Math.max(current, entries.length + 1));
    }
  }

  const count = String(entries.length).padStart(2, '0');
  const visibleEntries = entries.slice(0, visibleCount);
  const hiddenCount = Math.max(0, entries.length - visibleEntries.length);

  return (
    <View style={styles.page}>
      <View pointerEvents="none" style={styles.countWatermark}>
        <Text style={[styles.countWatermarkText, { color: palette.rule }]}>{count}</Text>
      </View>

      <View style={[
        styles.lead,
        compact && styles.leadCompact,
        { borderColor: palette.rule },
      ]}>
        <View style={styles.leadCopy}>
          <Text style={[styles.kicker, { color: palette.accent }]}>BIOGRAPHICAL LEAF · PRIVATE READING</Text>
          <Text style={[styles.title, { color: palette.ink }]}>人物小传</Text>
          <Text style={[styles.description, { color: palette.muted }]}>只供阅读，不进入正文、角色摘要或世界事实。你给出想看的内容，AI 只为这一次落笔。</Text>
        </View>
        {entries.length ? (
          <Pressable
            onPress={() => {
              setComposerOpen(true);
              setActiveId(null);
            }}
            style={({ pressed }) => [
              styles.addCompact,
              compact && styles.addCompactCompact,
              { borderColor: palette.accent, backgroundColor: palette.fieldFill },
              pressed && styles.pressed,
            ]}>
            <Text style={[styles.addCompactMark, { color: palette.accent }]}>＋</Text>
            <Text style={[styles.addCompactText, { color: palette.ink }]}>追加一篇</Text>
          </Pressable>
        ) : null}
      </View>

      {!entries.length && !composerOpen ? (
        <Pressable
          onPress={() => setComposerOpen(true)}
          style={({ pressed }) => [
            styles.emptyStage,
            { borderColor: palette.rule, backgroundColor: palette.fieldFill },
            pressed && styles.pressed,
          ]}>
          <Animated.View
            style={[
              styles.sealOrbit,
              {
                borderColor: palette.accent,
                opacity: sealMotion.interpolate({ inputRange: [0, 1], outputRange: [0.36, 0.8] }),
                transform: [
                  { rotate: sealMotion.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '18deg'] }) },
                  { scale: sealMotion.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.04] }) },
                ],
              },
            ]}
          />
          <View style={[styles.sealCore, { borderColor: palette.accent, backgroundColor: palette.paper }]}>
            <Text style={[styles.sealPlus, { color: palette.accent }]}>＋</Text>
          </View>
          <Text style={[styles.emptyTitle, { color: palette.ink }]}>添加第一篇小传</Text>
          <Text style={[styles.emptyCopy, { color: palette.muted }]}>这里不会出现尚未创作的占位卡。写下一个你想看的瞬间，生成后它才会进入档案。</Text>
          <View style={[styles.emptyRule, { backgroundColor: palette.accent }]} />
        </Pressable>
      ) : null}

      {composerOpen ? (
        <View style={[styles.composer, { borderColor: palette.rule, backgroundColor: palette.fieldFill }]}>
          <View style={styles.composerHeader}>
            <View>
              <Text style={[styles.composerIndex, { color: palette.accent }]}>NEW LEAF / {String(entries.length + 1).padStart(2, '0')}</Text>
              <Text style={[styles.composerTitle, { color: palette.ink }]}>写给作者的便笺</Text>
            </View>
            <Pressable
              disabled={Boolean(generatingId)}
              onPress={() => {
                setComposerOpen(false);
                setRequest('');
              }}>
              <Text style={[styles.textAction, { color: palette.muted }]}>收起</Text>
            </Pressable>
          </View>
          <TextInput
            value={request}
            onChangeText={setRequest}
            multiline
            autoFocus
            textAlignVertical="top"
            placeholder="写下你想看的内容。可以是一段过去、某个私人时刻、一场正文不会展开的相遇，或任何独立情境……"
            placeholderTextColor={palette.muted}
            style={[
              styles.requestInput,
              { color: palette.ink, borderColor: palette.rule, backgroundColor: palette.paper },
            ]}
          />
          <View style={[styles.composerFooter, compact && styles.composerFooterCompact]}>
            <Text style={[styles.composerNote, { color: palette.muted }]}>生成结果只保存在人物小传中，不反向修改人设。</Text>
            <Pressable
              disabled={!request.trim() || Boolean(generatingId)}
              onPress={() => void submitNewBiography()}
              style={({ pressed }) => [
                styles.generateButton,
                compact && styles.generateButtonCompact,
                { backgroundColor: palette.accent },
                (!request.trim() || generatingId) && { opacity: 0.42 },
                pressed && styles.pressed,
              ]}>
              {generatingId === 'new' ? (
                <ActivityIndicator size="small" color={palette.paper} />
              ) : (
                <>
                  <Text style={[styles.generateButtonEyebrow, { color: palette.paperDeep }]}>COMPOSE</Text>
                  <Text style={[styles.generateButtonText, { color: palette.paper }]}>开始创作 →</Text>
                </>
              )}
            </Pressable>
          </View>
        </View>
      ) : null}

      {entries.length ? (
        <View style={styles.indexList}>
          {visibleEntries.map((entry, index) => {
            const active = entry.id === activeId;
            const generating = generatingId === entry.id;
            return (
              <View key={entry.id} style={[styles.manuscript, { borderColor: palette.rule }]}>
                <Pressable
                  onPress={() => setActiveId(active ? null : entry.id)}
                  style={({ pressed }) => [styles.manuscriptHeader, pressed && styles.pressed]}>
                  <View style={[styles.manuscriptNumberBlock, compact && styles.manuscriptNumberBlockCompact]}>
                    <Text style={[styles.manuscriptNumber, { color: palette.accent }]}>{String(index + 1).padStart(2, '0')}</Text>
                    <Text style={[styles.manuscriptDate, { color: palette.muted }]}>{dateLabel(entry.updatedAt)}</Text>
                  </View>
                  <View style={styles.manuscriptCopy}>
                    <Text style={[styles.manuscriptTitle, { color: palette.ink }]} numberOfLines={active ? undefined : 1}>{entry.title}</Text>
                    {!active ? (
                      <Text style={[styles.manuscriptExcerpt, { color: palette.muted }]} numberOfLines={2}>{entry.content}</Text>
                    ) : null}
                  </View>
                  <Text style={[styles.disclosure, { color: palette.accent }]}>{active ? '—' : '↗'}</Text>
                </Pressable>

                {active ? (
                  <View style={[styles.editor, { borderTopColor: palette.rule }]}>
                    <TextInput
                      value={entry.title}
                      onChangeText={(title) => onUpdate(entry.id, { title })}
                      placeholder="小传标题"
                      placeholderTextColor={palette.muted}
                      style={[styles.titleInput, { color: palette.ink, borderBottomColor: palette.rule }]}
                    />
                    <TextInput
                      value={entry.content}
                      onChangeText={(content) => onUpdate(entry.id, { content })}
                      multiline
                      textAlignVertical="top"
                      placeholder="小传正文"
                      placeholderTextColor={palette.muted}
                      style={[styles.contentInput, { color: palette.ink, backgroundColor: palette.paper }]}
                    />
                    {entry.request ? (
                      <Text style={[styles.originalRequest, { color: palette.muted }]}>原始便笺：{entry.request}</Text>
                    ) : null}
                    <View style={styles.editorActions}>
                      <Pressable
                        disabled={Boolean(generatingId) || !entry.request}
                        onPress={() => void onGenerate(entry.request, entry.id)}
                        style={({ pressed }) => [
                          styles.rewriteButton,
                          { borderColor: palette.accent },
                          (generatingId || !entry.request) && { opacity: 0.42 },
                          pressed && styles.pressed,
                        ]}>
                        {generating ? <ActivityIndicator size="small" color={palette.accent} /> : <Text style={[styles.rewriteText, { color: palette.accent }]}>按原便笺重写</Text>}
                      </Pressable>
                      <Pressable
                        disabled={Boolean(generatingId)}
                        onPress={() => onDelete(entry.id)}>
                        <Text style={[styles.deleteText, { color: palette.muted }]}>移出档案</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
          {hiddenCount ? (
            <Pressable
              onPress={() => setVisibleCount((current) => current + BIOGRAPHY_PAGE_SIZE)}
              style={({ pressed }) => [
                styles.loadMore,
                { borderColor: palette.rule, backgroundColor: palette.fieldFill },
                pressed && styles.pressed,
              ]}>
              <Text style={[styles.loadMoreEyebrow, { color: palette.accent }]}>ARCHIVE CONTINUES</Text>
              <Text style={[styles.loadMoreText, { color: palette.ink }]}>继续展开 {Math.min(BIOGRAPHY_PAGE_SIZE, hiddenCount)} 篇</Text>
              <Text style={[styles.loadMoreCount, { color: palette.muted }]}>尚有 {hiddenCount} 篇未展开</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  page: { position: 'relative', gap: Spacing.three, overflow: 'hidden' },
  countWatermark: { position: 'absolute', top: -26, right: -8, opacity: 0.38 },
  countWatermarkText: { fontFamily: 'serif', fontSize: 118, lineHeight: 122, fontWeight: '300' },
  lead: { minHeight: 126, paddingVertical: Spacing.two, paddingRight: 118, borderTopWidth: 1, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: Spacing.three },
  leadCompact: { paddingRight: 0, paddingBottom: 62 },
  leadCopy: { flex: 1, gap: 5 },
  kicker: { fontSize: 8, lineHeight: 12, fontWeight: '900', letterSpacing: 1.5 },
  title: { fontFamily: 'serif', fontSize: 31, lineHeight: 37, fontWeight: '600', letterSpacing: -0.6 },
  description: { maxWidth: 610, fontSize: 12, lineHeight: 19 },
  addCompact: { position: 'absolute', right: 0, bottom: 12, minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, paddingHorizontal: 12 },
  addCompactCompact: { left: 0, right: undefined, bottom: 12, alignSelf: 'flex-start' },
  addCompactMark: { fontSize: 17, lineHeight: 20, fontWeight: '400' },
  addCompactText: { fontSize: 11, fontWeight: '800', letterSpacing: 0.4 },
  emptyStage: { minHeight: 320, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', paddingHorizontal: Spacing.four, paddingVertical: 54, gap: Spacing.two },
  sealOrbit: { position: 'absolute', width: 112, height: 112, borderRadius: 56, borderWidth: 1, borderStyle: 'dashed' },
  sealCore: { width: 76, height: 76, borderRadius: 38, borderWidth: 1, alignItems: 'center', justifyContent: 'center', marginBottom: Spacing.two },
  sealPlus: { fontFamily: 'serif', fontSize: 34, lineHeight: 38, fontWeight: '300' },
  emptyTitle: { fontFamily: 'serif', fontSize: 22, lineHeight: 28, fontWeight: '600' },
  emptyCopy: { maxWidth: 430, textAlign: 'center', fontSize: 12, lineHeight: 19 },
  emptyRule: { width: 42, height: 2, marginTop: 4 },
  composer: { borderWidth: 1, padding: Spacing.three, gap: Spacing.three },
  composerHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: Spacing.two },
  composerIndex: { fontSize: 8, lineHeight: 12, fontWeight: '900', letterSpacing: 1.4 },
  composerTitle: { marginTop: 3, fontFamily: 'serif', fontSize: 20, lineHeight: 26, fontWeight: '600' },
  textAction: { fontSize: 12, fontWeight: '700' },
  requestInput: { minHeight: 148, borderTopWidth: 1, borderBottomWidth: 1, paddingHorizontal: Spacing.two, paddingVertical: Spacing.three, fontFamily: 'serif', fontSize: 15, lineHeight: 25 },
  composerFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.three },
  composerFooterCompact: { flexDirection: 'column', alignItems: 'stretch' },
  composerNote: { flex: 1, fontSize: 10, lineHeight: 15 },
  generateButton: { minWidth: 154, minHeight: 52, paddingHorizontal: Spacing.three, justifyContent: 'center', alignItems: 'flex-start' },
  generateButtonCompact: { width: '100%', alignItems: 'center' },
  generateButtonEyebrow: { fontSize: 7, lineHeight: 10, fontWeight: '900', letterSpacing: 1.2 },
  generateButtonText: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  indexList: { gap: Spacing.two },
  manuscript: { borderTopWidth: 1, borderBottomWidth: 1 },
  manuscriptHeader: { minHeight: 108, flexDirection: 'row', alignItems: 'center', paddingVertical: Spacing.two, gap: Spacing.three },
  manuscriptNumberBlock: { width: 74, alignSelf: 'stretch', justifyContent: 'space-between' },
  manuscriptNumberBlockCompact: { width: 54 },
  manuscriptNumber: { fontFamily: 'serif', fontSize: 30, lineHeight: 34, fontWeight: '400' },
  manuscriptDate: { fontSize: 7, lineHeight: 10, fontWeight: '800', letterSpacing: 0.7 },
  manuscriptCopy: { flex: 1, gap: 8 },
  manuscriptTitle: { fontFamily: 'serif', fontSize: 19, lineHeight: 25, fontWeight: '600' },
  manuscriptExcerpt: { fontSize: 12, lineHeight: 19 },
  disclosure: { width: 24, textAlign: 'right', fontSize: 18, fontWeight: '400' },
  editor: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: Spacing.three, paddingBottom: Spacing.three, gap: Spacing.two },
  titleInput: { borderBottomWidth: 1, paddingVertical: Spacing.two, fontFamily: 'serif', fontSize: 25, lineHeight: 32, fontWeight: '600' },
  contentInput: { minHeight: 300, paddingHorizontal: Spacing.three, paddingVertical: Spacing.three, fontFamily: 'serif', fontSize: 15, lineHeight: 27 },
  originalRequest: { fontSize: 10, lineHeight: 16, fontStyle: 'italic' },
  editorActions: { minHeight: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.two },
  rewriteButton: { minHeight: 38, minWidth: 118, borderWidth: 1, paddingHorizontal: Spacing.two, alignItems: 'center', justifyContent: 'center' },
  rewriteText: { fontSize: 11, fontWeight: '800' },
  deleteText: { fontSize: 11, fontWeight: '700', textDecorationLine: 'underline' },
  loadMore: { minHeight: 76, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 3, padding: Spacing.two },
  loadMoreEyebrow: { fontSize: 7, lineHeight: 10, fontWeight: '900', letterSpacing: 1.2 },
  loadMoreText: { fontFamily: 'serif', fontSize: 15, lineHeight: 20, fontWeight: '600' },
  loadMoreCount: { fontSize: 9, lineHeight: 13 },
  pressed: { opacity: 0.72, transform: [{ scale: 0.985 }] },
});
