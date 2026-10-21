import { Image } from 'expo-image';
import { ENABLE_QUICK_TRAVEL } from '@/config/build-features';
import { router, Stack, useLocalSearchParams, type Href } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import Markdown from 'react-native-markdown-display';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  ChatSettingsGearButton,
  ChatSettingsMenuModal,
  type ChatSettingsAction,
} from '@/components/ChatSettingsMenu';
import { MemorySettingsModal } from '@/components/MemorySettingsModal';
import { ModelRoutePicker } from '@/components/ModelRoutePicker';
import { ImmersiveTocModal } from '@/components/ImmersiveTocModal';
import { NovelStoryMemoryModal } from '@/components/NovelStoryMemoryModal';
import { PageSettingsModal } from '@/components/PageSettingsModal';
import { ReadingSettingsModal } from '@/components/ReadingSettingsModal';
import { NovelBubbleSuggestedRoutes } from '@/components/NovelBubbleSuggestedRoutes';
import {
  NovelActionMenuModal,
  type NovelActionMenuItem,
} from '@/components/NovelActionMenuModal';
import { NovelSceneInspirationModal } from '@/components/NovelSceneInspirationModal';
import { NovelReasoningDisclosure } from '@/components/NovelReasoningDisclosure';
import { NovelVideoBackground } from '@/components/NovelVideoBackground';
import { QuickTravelWorldsModal } from '@/components/QuickTravelWorldsModal';
import { SaveSlotsModal } from '@/components/SaveSlotsModal';
import { KeyboardSafeModal } from '@/components/ui/KeyboardSafeModal';
import { MAX_NOVEL_SAVE_SLOTS } from '@/constants/novel-slots';
import { TokenUsageHint } from '@/components/TokenUsageHint';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { chooseAppAction, confirmAppAction, showAppAlert } from '@/utils/app-alert';
import { resolveNovelAgentReviewMode } from '@/services/novel-agent-review-policy';
import type { NovelRecoveryItem } from '@/services/novel-recovery';
import {
  CHAT_FONT_SIZE_DEFAULT,
  resolveChatFontFamily,
} from '@/constants/reading';
import { DEFAULT_CONTEXT_LENGTH } from '@/constants/session-config';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { useKeyboardBottomInset } from '@/hooks/use-keyboard-bottom-inset';
import { useNovelMessages } from '@/hooks/use-novel-messages';
import { useTheme } from '@/hooks/use-theme';
import { getActiveProvider, getNovelSlotBookKey, useTavernStore } from '@/store/tavern-store';
import type { Message } from '@/types/tavern';
import { buildChatMarkdownStyles } from '@/utils/chat-markdown-styles';
import { buildImmersiveToc } from '@/utils/immersive-toc';
import {
  exportAssistantTranscript,
  exportChatSessionBundle,
} from '@/utils/chat-session-io';
import {
  clampChatBackgroundOpacity,
  isNovelVideoUri,
  resolveNovelImageUri,
} from '@/utils/novel-images';
import { normalizeNovelConversation } from '@/utils/session-config';
import { stripNovelChapterExpansion } from '@/utils/novel-chapter-expansion';
import { findPreviousUserMessageId } from '@/utils/novel-message-navigation';
import { ensureQuickTravelArchive } from '@/utils/quick-travel';
import {
  extractSuggestedRoutesFromAssistantContent,
  stripAssistantContentForExport,
} from '@/utils/status-bar-html';

const MISSING_NOVEL_SCREEN_OPTIONS = { title: '小说对话', headerShown: true } as const;
const DRAFT_NOVEL_SCREEN_OPTIONS = { title: '草稿', headerShown: true } as const;

export default function NovelPlayScreen() {
  const params = useLocalSearchParams();
  const novelId = Array.isArray(params.novelId) ? params.novelId[0] : params.novelId;
  const theme = useTheme();
  const novels = useTavernStore((state) => state.novels);
  const providers = useTavernStore((state) => state.providers);
  const novelConversation = useTavernStore((state) =>
    novelId ? state.novelConversations[novelId] : undefined,
  );
  const novelConversationMeta = useTavernStore((state) => state.novelConversationMeta);
  const exportSettings = useTavernStore((state) => state.exportSettings);
  const novelSlotBooks = useTavernStore((state) => state.novelSlotBooks);
  const novelConversationRevisions = useTavernStore((state) => state.novelConversationRevisions);
  const ensureNovelConversation = useTavernStore((state) => state.ensureNovelConversation);
  const novelRecoveryItems = useTavernStore((state) => state.novelRecoveryItems);
  const resolveNovelRecovery = useTavernStore((state) => state.resolveNovelRecovery);
  const hydrateNovelConversation = useTavernStore((state) => state.hydrateNovelConversation);
  const hydrateNovelChapterContent = useTavernStore((state) => state.hydrateNovelChapterContent);
  const syncActiveNovelSlot = useTavernStore((state) => state.syncActiveNovelSlot);
  const createNovelSaveSlot = useTavernStore((state) => state.createNovelSaveSlot);
  const switchNovelSaveSlot = useTavernStore((state) => state.switchNovelSaveSlot);
  const renameNovelSaveSlot = useTavernStore((state) => state.renameNovelSaveSlot);
  const deleteNovelSaveSlot = useTavernStore((state) => state.deleteNovelSaveSlot);
  const rollbackNovelSaveSlot = useTavernStore((state) => state.rollbackNovelSaveSlot);
  const clearNovelRegressionEcho = useTavernStore((state) => state.clearNovelRegressionEcho);
  const cancelNovelMessage = useTavernStore((state) => state.cancelNovelMessage);
  const sendNovelMessage = useTavernStore((state) => state.sendNovelMessage);
  const regenerateNovelMessage = useTavernStore((state) => state.regenerateNovelMessage);
  const editNovelMessage = useTavernStore((state) => state.editNovelMessage);
  const deleteNovelMessage = useTavernStore((state) => state.deleteNovelMessage);
  const resubmitNovelUserMessage = useTavernStore((state) => state.resubmitNovelUserMessage);
  const setActiveProvider = useTavernStore((state) => state.setActiveProvider);
  const setProviderSelectedModel = useTavernStore((state) => state.setProviderSelectedModel);
  const updateNovel = useTavernStore((state) => state.updateNovel);
  const deleteNovel = useTavernStore((state) => state.deleteNovel);
  const updateNovelStoryMemories = useTavernStore((state) => state.updateNovelStoryMemories);
  const updateNovelInjectionToggles = useTavernStore((state) => state.updateNovelInjectionToggles);
  const updateNovelMemorySystemToggle = useTavernStore((state) => state.updateNovelMemorySystemToggle);
  const mergeNovelShortTermMemories = useTavernStore((state) => state.mergeNovelShortTermMemories);
  const updateNovelAppearance = useTavernStore((state) => state.updateNovelAppearance);
  const updateSessionContextLength = useTavernStore((state) => state.updateSessionContextLength);
  const updateSessionCustomConfig = useTavernStore((state) => state.updateSessionCustomConfig);
  const appearanceSettings = useTavernStore((state) => state.appearanceSettings);
  const updateAppearanceSettings = useTavernStore((state) => state.updateAppearanceSettings);
  const switchQuickTravelWorld = useTavernStore((state) => state.switchQuickTravelWorld);
  const addQuickTravelWorld = useTavernStore((state) => state.addQuickTravelWorld);
  const deleteQuickTravelWorld = useTavernStore((state) => state.deleteQuickTravelWorld);
  const settleQuickTravelWorld = useTavernStore((state) => state.settleQuickTravelWorld);
  const chatFontFamily = appearanceSettings.chatFontFamily ?? 'song';
  const chatFontSize = appearanceSettings.chatFontSize ?? CHAT_FONT_SIZE_DEFAULT;
  const chatFontFamilyName = resolveChatFontFamily(chatFontFamily);

  const novel = novels.find((item) => item.id === novelId);
  const activeWorldId = novel?.quickTravel?.activeWorldId;
  const {
    messages,
    loadEarlier,
    loadLater,
    hasEarlier,
    hasLater,
    isLoading,
    isLoadingEarlier,
    removeMessage,
  } = useNovelMessages(novelId, {
    fallbackMessages: novelConversation,
    worldId: activeWorldId,
    revision: novelId ? novelConversationRevisions[novelId] ?? 0 : 0,
  });
  const sessionMeta = novelId
    ? normalizeNovelConversation(
        novelConversationMeta[novelId] ?? {
          id: `${novelId}-conversation`,
          novelId,
          title: novel?.name ?? '未命名小说',
          memory: '',
          longTermMemory: '',
          midTermMemories: [],
          shortTermMemories: [],
          lastMessageAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          suggestedRoutes: [],
          isSuggestingRoutes: false,
          contextLength: DEFAULT_CONTEXT_LENGTH,
          mainPrompt: '',
          prefix: '',
          suffix: '',
          worldbookEntries: [],
          backgroundEnabled: true,
          bubbleOpacity: 1,
        },
      )
    : null;

  const [draft, setDraft] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [regeneratingMessageId, setRegeneratingMessageId] = useState<string | null>(null);
  const [isMemorySettingsOpen, setIsMemorySettingsOpen] = useState(false);
  const [isStoryMemoryOpen, setIsStoryMemoryOpen] = useState(false);
  const [isMergingMemories, setIsMergingMemories] = useState(false);
  const [isPageSettingsOpen, setIsPageSettingsOpen] = useState(false);
  const [isReadingSettingsOpen, setIsReadingSettingsOpen] = useState(false);
  const [isWritingModelPickerOpen, setIsWritingModelPickerOpen] = useState(false);
  const [pendingModelRetryMessageId, setPendingModelRetryMessageId] = useState<string | null>(null);
  const [isSettingsMenuOpen, setIsSettingsMenuOpen] = useState(false);
  const [activeActionMenu, setActiveActionMenu] = useState<
    'creation' | 'reading' | 'archive' | null
  >(null);
  const [isSceneInspirationOpen, setIsSceneInspirationOpen] = useState(false);
  const [isSaveSlotsOpen, setIsSaveSlotsOpen] = useState(false);
  const [resolvingRecoveryId, setResolvingRecoveryId] = useState<string | null>(null);
  const [isWorldsOpen, setIsWorldsOpen] = useState(false);
  const [immersiveReading, setImmersiveReading] = useState(false);
  const [isImmersiveTocOpen, setIsImmersiveTocOpen] = useState(false);
  const [isSwitchingWorld, setIsSwitchingWorld] = useState(false);
  const editSavePending = useRef(false);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [stickToBottom, setStickToBottom] = useState(true);
  const messageListScopeKey = `${novelId ?? ''}\u0000${activeWorldId ?? ''}`;
  const [listReadiness, setListReadiness] = useState({ scopeKey: '', ready: false });
  const [navigationUserMessageId, setNavigationUserMessageId] = useState<string | null>(null);
  const pendingNavigationRef = useRef(false);
  const hasInitialListAnchorRef = useRef(false);
  const hasUserDraggedListRef = useRef(false);
  const listRevealTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const listRef = useRef<FlatList<Message>>(null);
  const insets = useSafeAreaInsets();
  const keyboardBottomInset = useKeyboardBottomInset();

  const displayMessages = useMemo(
    () =>
      immersiveReading
        ? messages.filter((message) => message.role === 'assistant')
        : messages,
    [immersiveReading, messages],
  );
  const isInitialListReady = listReadiness.scopeKey === messageListScopeKey
    ? listReadiness.ready
    : !isLoading && displayMessages.length === 0;
  const userMessageIds = useMemo(
    () => displayMessages.filter((message) => message.role === 'user').map((message) => message.id),
    [displayMessages],
  );
  const nextNavigationUserMessageId = findPreviousUserMessageId(
    displayMessages,
    navigationUserMessageId,
  );
  const navigationDisabled =
    !userMessageIds.length ||
    isLoading ||
    isLoadingEarlier ||
    Boolean(navigationUserMessageId && !nextNavigationUserMessageId && !hasEarlier);
  const canLoadEarlier = hasEarlier && isInitialListReady && !isLoadingEarlier;
  const immersiveToc = useMemo(() => buildImmersiveToc(messages), [messages]);

  const hasStreamingMessage = messages.some((message) => message.status === 'streaming');
  const currentRecoveryItems = novelRecoveryItems.filter((item) => item.novelId === novelId);
  async function handleRecovery(item: NovelRecoveryItem, action: 'save_partial' | 'abandon') {
    if (resolvingRecoveryId) return;
    setResolvingRecoveryId(item.id);
    try {
      await resolveNovelRecovery(item, action);
    } catch (error) {
      showAppAlert('恢复失败', error instanceof Error ? error.message : '无法处理未完成生成。');
    } finally {
      setResolvingRecoveryId(null);
    }
  }
  const activeWritingProvider = getActiveProvider(providers);
  const backgroundEnabled = sessionMeta?.backgroundEnabled ?? true;
  const chatBackgroundUri = resolveNovelImageUri(novel?.chatBackgroundUri);
  const chatBackgroundIsVideo = isNovelVideoUri(chatBackgroundUri);
  const backgroundOpacity = clampChatBackgroundOpacity(novel?.chatBackgroundOpacity ?? 0.35);
  const bubbleOpacity = sessionMeta?.bubbleOpacity ?? 1;
  const keyboardOffset = Platform.OS === 'ios' ? insets.top + 56 : 0;
  const showChatBackground = Boolean(chatBackgroundUri && backgroundEnabled);
  const slotBook = novelId
    ? novelSlotBooks[getNovelSlotBookKey(novel)]
    : undefined;
  const saveSlots = slotBook?.slots ?? [];
  const activeSlotId = slotBook?.activeSlotId ?? null;
  const canRollback = Boolean(slotBook?.previousSnapshot);
  const collaborationEnabled = novel?.agentMode === 'direct';
  const reviewMode = resolveNovelAgentReviewMode(novel?.agentReviewMode);
  const actionMenuConfig: {
    eyebrow: string;
    title: string;
    description: string;
    items: NovelActionMenuItem[];
  } | null = activeActionMenu === 'creation'
    ? {
        eyebrow: 'WRITING ENGINE / MODE',
        title: '创作模式',
        description: '选择这一轮之后使用的生成协作方式。',
        items: [
          {
            id: 'creation-narrator',
            label: '单人叙事',
            detail: '由 Narrator 直接完成正文，调用链最短。',
            selected: !collaborationEnabled,
          },
          {
            id: 'creation-fast',
            label: '协作 · 快速审稿',
            detail: '启用角色协作，减少一次 Editor 深度检查。',
            selected: collaborationEnabled && reviewMode === 'fast',
          },
          {
            id: 'creation-deep',
            label: '协作 · 深度审稿',
            detail: '保留完整协作、同步审稿与必要修订。',
            selected: collaborationEnabled && reviewMode === 'deep',
          },
        ],
      }
    : activeActionMenu === 'reading'
      ? {
          eyebrow: 'READING DESK / DISPLAY',
          title: '阅读工具',
          description: '调整当前对话页面，或进入专注阅读模式。',
          items: [
            { id: 'reading-page', label: '页面设置', detail: '背景、透明度与消息气泡显示。' },
            { id: 'reading-type', label: '阅读设置', detail: '字体、字号与阅读排版。' },
            { id: 'reading-immersive', label: '沉浸阅读', detail: '隐藏输入工具，专注阅读正文。' },
          ],
        }
      : activeActionMenu === 'archive'
        ? {
            eyebrow: 'NOVEL ARCHIVE / OPERATIONS',
            title: '小说档案',
            description: '导出与删除只作用于当前小说。',
            items: [
              { id: 'archive-export', label: '导出正文', detail: '按系统设置中的格式导出当前正文。' },
              { id: 'archive-backup', label: '完整备份', detail: '保存设定、角色、卷纲、会话与记忆。' },
              { id: 'archive-delete', label: '删除小说', detail: '删除当前小说、对话与记忆。', destructive: true },
            ],
          }
        : null;
  const agentStageLabel =
    sessionMeta?.agentStage === 'memory-context'
      ? 'Memory 正在整理本回合上下文…'
      : sessionMeta?.agentStage === 'direct'
      ? 'Direct 正在规划本回合…'
      : sessionMeta?.agentStage === 'collaboration'
        ? 'Direct 与 Character 正在并行协作…'
      : sessionMeta?.agentStage === 'character'
      ? 'Character 正在整理角色执行简报…'
        : sessionMeta?.agentStage === 'narrator'
          ? 'Narrator 正在生成正文…'
          : sessionMeta?.agentStage === 'editor'
            ? 'Editor 正在检查正文连续性…'
            : sessionMeta?.agentStage === 'repair'
              ? 'Narrator 正在根据 Editor 意见修订…'
              : sessionMeta?.agentStage === 'memory'
                ? 'Memory 正在归档本回合…'
                : sessionMeta?.lastDirectAgentError
                  ? `Direct 规划失败，已回退到 Narrator：${sessionMeta.lastDirectAgentError}`
                  : sessionMeta?.lastCharacterAgentError
                    ? `Character 简报失败，已跳过角色协作：${sessionMeta.lastCharacterAgentError}`
                    : sessionMeta?.lastEditorAgentError
                      ? `Editor 审查失败，已保留 Narrator 原文：${sessionMeta.lastEditorAgentError}`
                      : '';

  useEffect(() => {
    if (novelId) {
      ensureNovelConversation(novelId);
      void hydrateNovelConversation(novelId);
    }
  }, [ensureNovelConversation, hydrateNovelConversation, novelId, activeWorldId]);

  useEffect(() => {
    hasInitialListAnchorRef.current = false;
    hasUserDraggedListRef.current = false;
    if (listRevealTimerRef.current) {
      clearTimeout(listRevealTimerRef.current);
      listRevealTimerRef.current = null;
    }
    return () => {
      if (listRevealTimerRef.current) {
        clearTimeout(listRevealTimerRef.current);
        listRevealTimerRef.current = null;
      }
    };
  }, [messageListScopeKey]);

  function explainSlotFailure(reason: string) {
    switch (reason) {
      case 'full':
        return `最多 ${MAX_NOVEL_SAVE_SLOTS} 个记忆点。`;
      case 'streaming':
        return '生成进行中，请稍后再操作记忆点。';
      case 'last_slot':
        return '至少保留一个记忆点。';
      case 'no_rollback':
        return '没有可撤销的上次读取。';
      case 'not_found':
        return '找不到该记忆点。';
      case 'unavailable':
        return '当前记忆点暂不可用，请稍后重试。';
      default:
        return '操作失败。';
    }
  }

  const scrollToMessageIndex = useCallback((index: number) => {
    if (index < 0) return;
    setStickToBottom(false);
    requestAnimationFrame(() => {
      listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.12 });
    });
  }, [setStickToBottom]);

  async function jumpToPreviousUserMessage() {
    if (navigationDisabled || !nextNavigationUserMessageId) {
      if (!navigationDisabled && hasEarlier && !isLoadingEarlier) {
        pendingNavigationRef.current = true;
        await loadEarlier();
      }
      return;
    }

    const index = displayMessages.findIndex((message) => message.id === nextNavigationUserMessageId);
    if (index < 0) return;
    setNavigationUserMessageId(nextNavigationUserMessageId);
    scrollToMessageIndex(index);
  }

  useEffect(() => {
    if (!pendingNavigationRef.current || isLoadingEarlier) return;
    const targetId = findPreviousUserMessageId(displayMessages, navigationUserMessageId);
    if (!targetId) {
      if (!hasEarlier) pendingNavigationRef.current = false;
      return;
    }
    const index = displayMessages.findIndex((message) => message.id === targetId);
    if (index < 0) return;
    pendingNavigationRef.current = false;
    requestAnimationFrame(() => {
      setNavigationUserMessageId(targetId);
      scrollToMessageIndex(index);
    });
  }, [displayMessages, hasEarlier, isLoadingEarlier, navigationUserMessageId, scrollToMessageIndex]);

  function handleListScroll(event: NativeSyntheticEvent<NativeScrollEvent>) {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distanceFromBottom = contentSize.height - layoutMeasurement.height - contentOffset.y;
    setStickToBottom(distanceFromBottom < 120);
  }

  function handleListScrollBeginDrag() {
    hasUserDraggedListRef.current = true;
  }

  function handleMessageListContentSizeChange() {
    if (!displayMessages.length) return;

    if (!hasInitialListAnchorRef.current) {
      listRef.current?.scrollToEnd({ animated: false });
      if (listRevealTimerRef.current) clearTimeout(listRevealTimerRef.current);
      listRevealTimerRef.current = setTimeout(() => {
        requestAnimationFrame(() => {
          listRef.current?.scrollToEnd({ animated: false });
          hasInitialListAnchorRef.current = true;
          setListReadiness({ scopeKey: messageListScopeKey, ready: true });
        });
      }, 48);
      return;
    }

    if (stickToBottom) {
      requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: false }));
    }
  }

  function handleLoadEarlier() {
    if (!canLoadEarlier || !hasUserDraggedListRef.current) return;
    void loadEarlier();
  }

  async function handleActionMenuSelect(action: string) {
    if (!novelId || !novel) {
      return;
    }

    switch (action) {
      case 'creation-narrator':
        updateNovel(novelId, { agentMode: 'narrator' });
        break;
      case 'creation-fast':
        updateNovel(novelId, { agentMode: 'direct', agentReviewMode: 'fast' });
        break;
      case 'creation-deep':
        updateNovel(novelId, { agentMode: 'direct', agentReviewMode: 'deep' });
        break;
      case 'reading-page':
        setIsPageSettingsOpen(true);
        break;
      case 'reading-type':
        setIsReadingSettingsOpen(true);
        break;
      case 'reading-immersive':
        setImmersiveReading(true);
        break;
      case 'archive-export':
        await handleExportTranscript();
        break;
      case 'archive-backup':
        await handleExportSession();
        break;
      case 'archive-delete':
        await handleDeleteNovel();
        break;
      default:
        break;
    }
  }

  async function handleExportTranscript() {
    if (!novelId || !novel) {
      return;
    }

    try {
      // Canonical final chapters take precedence over the bounded chat window.
      let exportMessages = novelConversation ?? [];
      if ((novel.chapters ?? []).some((chapter) => chapter.status === 'final')) {
        const finalChapterIds = (novel.chapters ?? [])
          .filter((chapter) => chapter.status === 'final')
          .map((chapter) => chapter.id);
        await Promise.all(finalChapterIds.map((chapterId) => hydrateNovelChapterContent(chapterId)));
        const latestNovel = useTavernStore.getState().novels.find((item) => item.id === novelId);
        const finalChapters = (latestNovel?.chapters ?? [])
          .filter((chapter) => chapter.status === 'final')
          .sort((a, b) => a.index - b.index);
        exportMessages = finalChapters.map((chapter, index) => ({
          id: `export-${novelId}-${index}`,
          characterId: novelId,
          role: 'assistant' as const,
          content: `第${chapter.index}章 ${chapter.title}\n\n${chapter.content}`,
          status: 'complete' as const,
          createdAt: chapter.createdAt,
          updatedAt: chapter.updatedAt,
        }));
      }

      const result = await exportAssistantTranscript({
        title: novel.name,
        messages: exportMessages,
        directoryUri: exportSettings.directoryUri,
        format: exportSettings.format,
        includeTimestamp: exportSettings.includeTimestamp,
      });

      if (result.mode === 'directory') {
        const action = await chooseAppAction('导出成功', `正文已保存为 ${result.fileName}`, [
          { id: 'share', label: '分享到阅读软件' },
        ]);
        if (action === 'share') {
          try {
            await exportAssistantTranscript({
              title: novel.name,
              messages: exportMessages,
              forceShare: true,
              format: exportSettings.format,
              includeTimestamp: exportSettings.includeTimestamp,
            });
          } catch (error) {
            showAppAlert('分享失败', error instanceof Error ? error.message : '分享失败。');
          }
        }
      } else if (result.mode === 'download') {
        showAppAlert('导出成功', `已开始下载 ${result.fileName}`);
      }
    } catch (error) {
      showAppAlert('导出失败', error instanceof Error ? error.message : '导出失败。');
    }
  }

  async function handleExportSession() {
    if (!novelId || !novel || !sessionMeta) {
      return;
    }

    try {
      const bundle = await useTavernStore.getState().buildNovelBackup(novelId);
      const result = await exportChatSessionBundle(bundle, exportSettings.directoryUri);
      showAppAlert('导出完整备份成功', `已保存 ${result.fileName}`);
    } catch (error) {
      showAppAlert('导出备份失败', error instanceof Error ? error.message : '导出完整备份失败。');
    }
  }

  async function handleDeleteNovel() {
    if (!novelId || !novel) {
      return;
    }

    const confirmed = await confirmAppAction(
      '删除小说',
      `确定删除「${novel.name}」吗？对话与记忆也会一并清除。`,
      { confirmLabel: '确认删除' },
    );
    if (!confirmed) {
      return;
    }

    try {
      deleteNovel(novelId);
      router.replace('/(tabs)/novels' as Href);
    } catch (error) { showAppAlert('删除失败', error instanceof Error ? error.message : '无法删除小说。'); }
  }

  async function handleSettingsAction(action: ChatSettingsAction) {
    if (!novelId || !novel || !sessionMeta) {
      return;
    }

    switch (action) {
      case 'saveSlots':
        syncActiveNovelSlot(novelId);
        setIsSaveSlotsOpen(true);
        break;
      case 'memory':
        setIsMemorySettingsOpen(true);
        break;
      case 'storyMemory':
        setIsStoryMemoryOpen(true);
        break;
      case 'characterDossiers':
        router.push(`/novel/knowledge/${novelId}` as Href);
        break;
      case 'outline': {
        const activeWorld = novel?.quickTravel?.worlds.find((world) => world.id === activeWorldId);
        const query = novel?.quickTravel?.config.enabled && activeWorld && !activeWorld.isMainWorld
          ? `?worldId=${activeWorld.id}`
          : '';
        router.push(`/novel/world-outline/${novelId}${query}` as Href);
        break;
      }
      case 'editNovel':
        router.push(`/novel/edit/${novelId}` as Href);
        break;
      case 'archiveActions':
        setActiveActionMenu('archive');
        break;
      default:
        break;
    }
  }

  async function submitNovelMessage(messageContent: string) {
    if (!novelId || isSending || regeneratingMessageId || hasStreamingMessage) return;

    setDraft('');
    setNavigationUserMessageId(null);
    pendingNavigationRef.current = false;
    setIsSending(true);
    setStickToBottom(true);
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));

    try {
      await sendNovelMessage(novelId, messageContent);
    } catch (error) {
      const message = error instanceof Error ? error.message : '请求模型失败。';
      showAppAlert('发送失败', message);
    } finally {
      setIsSending(false);
      requestAnimationFrame(() => {
        if (stickToBottom) {
          listRef.current?.scrollToEnd({ animated: true });
        }
      });
    }
  }

  async function handleSend() {
    if (
      !novelId ||
      isSending ||
      regeneratingMessageId ||
      hasStreamingMessage ||
      !draft.trim()
    ) {
      return;
    }

    await submitNovelMessage(draft.trim());
  }

  async function handleRegenerate(messageId: string) {
    if (!novelId || isSending || regeneratingMessageId) {
      return;
    }

    // Clear any stuck "streaming" bubbles left by crashes / cutoffs before regenerating.
    ensureNovelConversation(novelId);

    if (messages.some((message) => message.status === 'streaming')) {
      showAppAlert('请稍候', '仍有回复在生成中，请等待完成后再重新生成。');
      return;
    }

    setRegeneratingMessageId(messageId);
    setNavigationUserMessageId(null);
    pendingNavigationRef.current = false;
    setStickToBottom(true);

    try {
      await regenerateNovelMessage(novelId, messageId);
    } finally {
      setRegeneratingMessageId(null);
    }
  }

  const latestUserMessageId = [...messages]
    .reverse()
    .find((message) => message.role === 'user')?.id;
  const latestAssistantMessageId =
    latestUserMessageId != null
      ? (() => {
          const userIndex = messages.findIndex((message) => message.id === latestUserMessageId);
          const next = messages[userIndex + 1];
          return next?.role === 'assistant' ? next.id : undefined;
        })()
      : undefined;

  function canEditMessage(message: Message) {
    if (message.status === 'streaming') {
      return false;
    }

    // Only the latest user turn (and its immediate AI reply for text-only fix) are editable.
    if (message.role === 'user') {
      return message.id === latestUserMessageId;
    }

    return message.id === latestAssistantMessageId;
  }

  function openEditMessage(message: Message) {
    if (!canEditMessage(message)) {
      if (message.role === 'user') {
        showAppAlert('无法编辑', '只能修改最新一轮你的消息，以免后面的对话被清空。');
      }

      return;
    }

    setEditingMessage(message);
    setEditDraft(
      message.role === 'user'
        ? stripNovelChapterExpansion(message.content)
        : message.content,
    );
  }

  function handleDeleteMessage(message: Message) {
    if (!novelId || message.status === 'streaming' || isSending || regeneratingMessageId) return;

    void (async () => {
      const confirmed = await confirmAppAction(
        '删除消息',
        '删除后，这条消息不会再作为下一次生成的近期对话发送。确定删除吗？',
        { confirmLabel: '删除' },
      );
      if (!confirmed) return;

      try {
        await deleteNovelMessage(novelId, message.id);
        removeMessage(message.id);
      } catch (error) {
        showAppAlert('删除失败', error instanceof Error ? error.message : '无法删除这条消息。');
      }
    })();
  }

  async function saveEditedMessage() {
    if (editSavePending.current || !novelId || !editingMessage || isSending || regeneratingMessageId || hasStreamingMessage) {
      return;
    }

    const nextContent = editDraft.trim();

    if (!nextContent) {
      showAppAlert('无法保存', '消息内容不能为空。');
      return;
    }

    const messageId = editingMessage.id;
    const wasUser = editingMessage.role === 'user';

    if (!wasUser) {
      editSavePending.current = true;
      try {
        await editNovelMessage(novelId, messageId, nextContent);
        setEditingMessage(null);
        setEditDraft('');
      } catch (error) {
        showAppAlert('修改失败', error instanceof Error ? error.message : '无法保存修改。');
      } finally { editSavePending.current = false; }
      return;
    }

    setEditingMessage(null);
    setEditDraft('');
    // Latest user turn only: replace the immediate AI reply and regenerate.
    setIsSending(true);
    setNavigationUserMessageId(null);
    pendingNavigationRef.current = false;
    setStickToBottom(true);
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));

    try {
      await resubmitNovelUserMessage(novelId, messageId, nextContent);
    } catch (error) {
      const message = error instanceof Error ? error.message : '重新生成失败。';
      showAppAlert('修改失败', message);
    } finally {
      setIsSending(false);
    }
  }

  const novelName = novel?.name ?? '小说对话';
  const screenOptions = {
      headerShown: true,
      title: novelName,
      headerBackTitle: '返回',
      headerStyle: { backgroundColor: theme.background },
      headerTransparent: false,
      headerTintColor: theme.accent,
      headerTitleStyle: { color: theme.text, fontWeight: '700' as const },
      headerShadowVisible: false,
      contentStyle: {
        backgroundColor: showChatBackground ? 'transparent' : theme.background,
      },
      headerRight: immersiveReading
        ? () => (
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <Pressable
                onPress={() => setIsImmersiveTocOpen(true)}
                hitSlop={10}
                style={{ paddingHorizontal: Spacing.two }}>
                <ThemedText type="code" themeColor="accent">
                  目录
                </ThemedText>
              </Pressable>
              <Pressable
                onPress={() => setImmersiveReading(false)}
                hitSlop={10}
                style={{ paddingHorizontal: Spacing.two }}>
                <ThemedText type="code" themeColor="accent">
                  退出
                </ThemedText>
              </Pressable>
            </View>
          )
        : () => <ChatSettingsGearButton onPress={() => setIsSettingsMenuOpen(true)} />,
    };

  if (!novel) {
    return (
      <ThemedView style={styles.centered}>
        <Stack.Screen options={MISSING_NOVEL_SCREEN_OPTIONS} />
        <ThemedText type="subtitle">小说不存在</ThemedText>
        <Pressable onPress={() => router.replace('/(tabs)/novels' as Href)}>
          <ThemedText type="linkPrimary">返回小说列表</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  if (novel.isDraft) {
    return (
      <ThemedView style={styles.centered}>
        <Stack.Screen options={DRAFT_NOVEL_SCREEN_OPTIONS} />
        <ThemedText type="subtitle">这是未完成的草稿</ThemedText>
        <ThemedText themeColor="textSecondary">请先完善设定并创建小说，再开始对话。</ThemedText>
        <Pressable
          onPress={() => router.replace((novel.creationMode === 'workbench'
            ? `/novel/create?draftId=${novel.id}`
            : `/novel/create?draftId=${novel.id}`) as Href)}
          style={{ marginTop: Spacing.three }}>
          <ThemedText type="linkPrimary">继续编辑草稿</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  return (
    <ThemedView
      decorated={!showChatBackground}
      style={[
        styles.container,
        showChatBackground && styles.transparentLayer,
      ]}>
      <Stack.Screen options={screenOptions} />

      {showChatBackground && chatBackgroundUri ? (
        <View style={styles.backgroundLayer} pointerEvents="none">
          {chatBackgroundIsVideo ? (
            <NovelVideoBackground uri={chatBackgroundUri} />
          ) : (
            <Image
              source={{ uri: chatBackgroundUri }}
              style={styles.backgroundImage}
              contentFit="cover"
              cachePolicy="memory-disk"
              recyclingKey={chatBackgroundUri}
            />
          )}
          {/* Dim with a solid scrim — applying opacity on Image is unreliable on Android. */}
          <View
            style={[
              styles.backgroundScrim,
              {
                backgroundColor: theme.background,
                opacity: Math.max(0, Math.min(1, 1 - backgroundOpacity)),
              },
            ]}
          />
        </View>
      ) : null}

      {isSettingsMenuOpen ? (
        <ChatSettingsMenuModal
          visible={isSettingsMenuOpen}
          onClose={() => setIsSettingsMenuOpen(false)}
          onSelect={handleSettingsAction}
        />
      ) : null}

      {activeActionMenu && actionMenuConfig ? (
        <NovelActionMenuModal
          visible
          eyebrow={actionMenuConfig.eyebrow}
          title={actionMenuConfig.title}
          description={actionMenuConfig.description}
          items={actionMenuConfig.items}
          onClose={() => setActiveActionMenu(null)}
          onSelect={(action) => { void handleActionMenuSelect(action); }}
        />
      ) : null}

      {isSceneInspirationOpen ? (
        <NovelSceneInspirationModal
          visible={isSceneInspirationOpen}
          novel={novel}
          onClose={() => setIsSceneInspirationOpen(false)}
          onUse={(instruction) => {
            setDraft((current) => current.trim()
              ? `${current.trim()}\n\n${instruction}`
              : instruction);
            setIsSceneInspirationOpen(false);
          }}
        />
      ) : null}

      {isMemorySettingsOpen ? (
        <MemorySettingsModal
          visible={isMemorySettingsOpen}
          value={sessionMeta?.contextLength ?? DEFAULT_CONTEXT_LENGTH}
          onClose={() => setIsMemorySettingsOpen(false)}
          onSave={(contextLength) => updateSessionContextLength('novel', novel.id, contextLength)}
          variant="window"
        />
      ) : null}

      {isSaveSlotsOpen ? (
        <SaveSlotsModal
        visible={isSaveSlotsOpen}
        slots={saveSlots}
        activeSlotId={activeSlotId}
        canRollback={canRollback}
        hasRegressionEcho={Boolean(sessionMeta?.regressionEcho?.trim())}
        liveMessageCount={messages.length}
        onClose={() => setIsSaveSlotsOpen(false)}
        onCreate={async (name) => {
          if (!novelId) {
            return;
          }

          const result = await createNovelSaveSlot(novelId, name || undefined);
          if (!result.ok) {
            throw new Error(explainSlotFailure(result.reason));
          }
          showAppAlert('已保存', '已冻结当前进度为记忆点，可继续往下玩。');
        }}
        onSwitch={async (slotId, options) => {
          if (!novelId) {
            return;
          }

          const result = await switchNovelSaveSlot(novelId, slotId, options);
          if (!result.ok) {
            throw new Error(explainSlotFailure(result.reason));
          }
        }}
        onRename={async (slotId, name) => {
          if (!novelId) {
            return;
          }

          const result = await renameNovelSaveSlot(novelId, slotId, name);
          if (!result.ok) {
            throw new Error(explainSlotFailure(result.reason));
          }
        }}
        onDelete={async (slotId) => {
          if (!novelId) {
            return;
          }

          const result = await deleteNovelSaveSlot(novelId, slotId);
          if (!result.ok) {
            throw new Error(explainSlotFailure(result.reason));
          }
        }}
        onRollback={async () => {
          if (!novelId) {
            return;
          }

          const result = await rollbackNovelSaveSlot(novelId);
          if (!result.ok) {
            throw new Error(explainSlotFailure(result.reason));
          }
        }}
        onClearEcho={() => {
          if (!novelId) {
            return;
          }

          clearNovelRegressionEcho(novelId);
        }}
      />
      ) : null}

      {isStoryMemoryOpen ? (
        <NovelStoryMemoryModal
          visible={isStoryMemoryOpen}
          longTermMemory={sessionMeta?.longTermMemory ?? ''}
          midTermMemories={sessionMeta?.midTermMemories ?? []}
          shortTermMemories={sessionMeta?.shortTermMemories ?? []}
          injectionToggles={sessionMeta?.injectionToggles}
          memorySystemEnabled={sessionMeta?.memorySystemEnabled !== false}
          isMerging={isMergingMemories}
          lastMemoryError={sessionMeta?.lastMemoryError}
          onClose={() => setIsStoryMemoryOpen(false)}
          onSave={(next) => updateNovelStoryMemories(novel.id, next)}
          onInjectionTogglesChange={(toggles) => {
            if (novelId) {
              updateNovelInjectionToggles(novelId, toggles);
            }
          }}
          onMemorySystemToggle={(enabled) => {
            if (novelId) {
              updateNovelMemorySystemToggle(novelId, enabled);
            }
          }}
          onMergeNow={async () => {
            setIsMergingMemories(true);

            try {
              await mergeNovelShortTermMemories(novel.id);
            } catch (error) {
              showAppAlert(
                '合并失败',
                error instanceof Error ? error.message : '无法合并短期记忆。',
              );
            } finally {
              setIsMergingMemories(false);
            }
          }}
        />
      ) : null}

      {isPageSettingsOpen ? (
        <PageSettingsModal
          visible={isPageSettingsOpen}
          backgroundEnabled={backgroundEnabled}
          backgroundUri={novel?.chatBackgroundUri}
          backgroundOpacity={backgroundOpacity}
          bubbleOpacity={bubbleOpacity}
          showBackgroundControls={Boolean(novel?.chatBackgroundUri)}
          onClose={() => setIsPageSettingsOpen(false)}
          onSave={(next) => {
            updateSessionCustomConfig('novel', novel.id, {
              backgroundEnabled: next.backgroundEnabled,
              bubbleOpacity: next.bubbleOpacity,
            });
            updateNovelAppearance(novel.id, {
              chatBackgroundUri: next.backgroundUri,
              chatBackgroundOpacity: next.backgroundOpacity,
            });
          }}
        />
      ) : null}

      {isReadingSettingsOpen ? (
        <ReadingSettingsModal
          visible={isReadingSettingsOpen}
          fontFamily={chatFontFamily}
          fontSize={chatFontSize}
          onClose={() => setIsReadingSettingsOpen(false)}
          onSave={(next) => {
            updateAppearanceSettings({
              chatFontFamily: next.fontFamily,
              chatFontSize: next.fontSize,
            });
          }}
        />
      ) : null}

      {isWritingModelPickerOpen ? (
        <ModelRoutePicker
          visible={isWritingModelPickerOpen}
          title="选择写作模型"
          providers={providers}
          selectedModelId={activeWritingProvider?.selectedModel}
          selectedProviderId={activeWritingProvider?.id}
          onClose={() => {
            setIsWritingModelPickerOpen(false);
            setPendingModelRetryMessageId(null);
          }}
          onSelect={(modelId, providerId) => {
            setActiveProvider(providerId);
            setProviderSelectedModel(providerId, modelId);
            setIsWritingModelPickerOpen(false);
            const retryMessageId = pendingModelRetryMessageId;
            setPendingModelRetryMessageId(null);
            if (retryMessageId) {
              void handleRegenerate(retryMessageId);
            }
          }}
        />
      ) : null}

      {ENABLE_QUICK_TRAVEL && novel?.quickTravel?.config.enabled ? (
        <QuickTravelWorldsModal
          visible={isWorldsOpen}
          busy={isSwitchingWorld}
          worlds={ensureQuickTravelArchive(novel).worlds}
          activeWorldId={ensureQuickTravelArchive(novel).activeWorldId}
          onClose={() => setIsWorldsOpen(false)}
          onSelect={async (worldId) => {
            if (!novelId || isSwitchingWorld) return;
            setIsSwitchingWorld(true);
            try {
              if (await switchQuickTravelWorld(novelId, worldId)) setIsWorldsOpen(false);
              else showAppAlert('切换失败', '目标世界不存在。');
            } catch (error) {
              showAppAlert('切换失败', error instanceof Error ? error.message : '无法读取世界会话。');
            } finally { setIsSwitchingWorld(false); }
          }}
          onAdd={async (name) => {
            if (!novelId || isSwitchingWorld) return;
            setIsSwitchingWorld(true);
            try {
              const worldId = await addQuickTravelWorld(novelId, { name });
              if (worldId) {
                setIsWorldsOpen(false);
                router.push(`/novel/world/${novelId}?worldId=${worldId}` as Href);
              }
            } catch (error) {
              showAppAlert('添加失败', error instanceof Error ? error.message : '无法添加世界。');
            } finally { setIsSwitchingWorld(false); }
          }}
          onEdit={(worldId) => {
            setIsWorldsOpen(false);
            if (novelId) router.push(`/novel/world/${novelId}?worldId=${worldId}` as Href);
          }}
          onEditOutline={(worldId) => {
            setIsWorldsOpen(false);
            if (novelId) router.push(`/novel/world-outline/${novelId}?worldId=${worldId}` as Href);
          }}
          onDelete={async (worldId) => {
            if (!novelId) return;
            const confirmed = await confirmAppAction('删除小世界', '删除后该世界的设定与角色池将被移除，确认继续？', { confirmLabel: '删除' });
            if (confirmed && !deleteQuickTravelWorld(novelId, worldId)) showAppAlert('无法删除', '请先切换到其他世界，并等待生成或保存完成；主世界不能删除。');
          }}
          onSettle={() => {
            if (novelId && settleQuickTravelWorld(novelId, {
              result: 'success',
              summary: '当前世界已完成。',
              rewards: [],
              penalties: [],
              carriedForward: [],
            })) {
              setIsWorldsOpen(false);
            }
          }}
        />
      ) : null}


      <SafeAreaView
        style={[styles.safeArea, showChatBackground && styles.transparentLayer]}
        edges={
          keyboardBottomInset > 0 ? ['left', 'right'] : ['left', 'right', 'bottom']
        }>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          keyboardVerticalOffset={keyboardOffset}
          style={[
            styles.flex,
            showChatBackground && styles.transparentLayer,
          ]}>
          {sessionMeta?.lastMemoryError ? (
            <Pressable
              onPress={() => setIsStoryMemoryOpen(true)}
              style={({ pressed }) => [
                styles.memoryErrorBanner,
                {
                  borderColor: theme.accent,
                  backgroundColor: pressed ? theme.backgroundElement : `${theme.surface}f2`,
                },
              ]}>
              <ThemedText type="small" themeColor="accent" numberOfLines={1}>
                记忆写入失败：{sessionMeta.lastMemoryError}
              </ThemedText>
            </Pressable>
          ) : null}

          {collaborationEnabled && agentStageLabel ? (
            <View
              style={[
                styles.agentStageBanner,
                { borderColor: theme.accent, backgroundColor: `${theme.surface}f2` },
              ]}>
              <ThemedText type="small" themeColor="accent" numberOfLines={2}>
                {agentStageLabel}
              </ThemedText>
            </View>
          ) : null}

          {currentRecoveryItems.length > 0 ? (
            <View style={[styles.agentStageBanner, { borderColor: theme.accent, backgroundColor: `${theme.surface}f2` }]}>
              <ThemedText type="small" themeColor="accent">发现未完成的生成，请选择如何处理：</ThemedText>
              {currentRecoveryItems.map((item: NovelRecoveryItem) => {
                const canSave = Boolean(item.content.trim()) && item.content.trim() !== '正在生成回复...';
                return (
                  <View key={item.id} style={styles.messageActions}>
                    <ThemedText type="small" numberOfLines={1}>{canSave ? '保存片段' : '空片段不可保存'}</ThemedText>
                    {canSave ? <Pressable disabled={resolvingRecoveryId !== null} onPress={() => void handleRecovery(item, 'save_partial')} style={styles.actionChip}>
                      <ThemedText type="code" themeColor="accent">保存片段</ThemedText>
                    </Pressable> : null}
                    <Pressable disabled={resolvingRecoveryId !== null} onPress={() => void handleRecovery(item, 'abandon')} style={styles.actionChip}>
                      <ThemedText type="code" themeColor="accent">放弃生成</ThemedText>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          ) : null}

          <FlatList
            ref={listRef}
            data={displayMessages}
            keyExtractor={(item) => item.id}
            style={[
              styles.flex,
              showChatBackground && styles.transparentLayer,
              !isInitialListReady && styles.messageListPreparing,
            ]}
            contentContainerStyle={styles.messageList}
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            windowSize={7}
            maintainVisibleContentPosition={{ minIndexForVisible: 1 }}
            onScroll={handleListScroll}
            onScrollBeginDrag={handleListScrollBeginDrag}
            onStartReached={canLoadEarlier ? handleLoadEarlier : undefined}
            onStartReachedThreshold={0.2}
            onEndReached={hasLater ? () => void loadLater() : undefined}
            onEndReachedThreshold={0.2}
            scrollEventThrottle={16}
            onContentSizeChange={handleMessageListContentSizeChange}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            onScrollToIndexFailed={(info) => {
              const offset = Math.max(0, info.averageItemLength * Math.max(0, info.index - 1));
              listRef.current?.scrollToOffset({ offset, animated: true });
              requestAnimationFrame(() => {
                listRef.current?.scrollToIndex({
                  index: info.index,
                  animated: true,
                  viewPosition: 0.12,
                });
              });
            }}
            renderItem={({ item }) => {
              const isUser = item.role === 'user';
              const isError = item.status === 'error';
              const isStreaming = item.status === 'streaming';
              const showRegenerate =
                !immersiveReading && !isUser && item.id === latestAssistantMessageId;
              const canRegenerate =
                !isSending && !regeneratingMessageId && !hasStreamingMessage;
              const canEdit = !immersiveReading && canEditMessage(item);
              const isRegenerating = regeneratingMessageId === item.id;
              const markdownStyles = buildChatMarkdownStyles({
                color: isError ? theme.error : theme.text,
                secondaryColor: theme.textSecondary,
                fontSize: chatFontSize,
                fontFamily: chatFontFamily,
              });
              const userTextStyle = {
                color: isError ? theme.error : theme.text,
                fontSize: chatFontSize,
                lineHeight: Math.round(chatFontSize * 1.55),
                fontFamily: chatFontFamilyName,
              };

              return (
                <View style={[styles.messageRow, isUser ? styles.userRow : styles.assistantRow]}>
                  <View>
                    <View
                      style={[
                        styles.bubble,
                        immersiveReading && styles.immersiveBubble,
                        {
                          opacity: bubbleOpacity,
                          overflow: 'visible',
                          backgroundColor: isUser
                            ? theme.backgroundSelected
                            : isError
                              ? theme.errorContainer
                              : immersiveReading
                                ? 'transparent'
                                : `${theme.surface}ee`,
                          borderColor: immersiveReading
                            ? 'transparent'
                            : isError
                              ? theme.error
                              : theme.border,
                        },
                      ]}>
                      {isUser ? (
                        <ThemedText style={userTextStyle} selectable={true}>
                          {stripNovelChapterExpansion(item.content) ||
                            (isStreaming ? '正在生成回复...' : '')}
                        </ThemedText>
                      ) : (
                        <View style={styles.assistantBubbleBody}>
                          <NovelReasoningDisclosure
                            content={item.reasoningContent}
                            isStreaming={isStreaming}
                          />
                          <Markdown
                            style={markdownStyles}
                            rules={{
                              textgroup: (node, children, parent, markdownRuleStyles) => (
                                <Text key={node.key} selectable style={markdownRuleStyles.textgroup}>
                                  {children}
                                </Text>
                              ),
                              text: (
                                node,
                                children,
                                parent,
                                markdownRuleStyles,
                                inheritedStyles = {},
                              ) => (
                                <Text
                                  key={node.key}
                                  selectable
                                  style={[inheritedStyles, markdownRuleStyles.text]}>
                                  {node.content}
                                </Text>
                              ),
                            }}>
                            {isStreaming
                              ? item.content || '正在生成回复...'
                              : stripAssistantContentForExport(item.content) || item.content || ''}
                          </Markdown>
                          {!isStreaming && item.content.trim() && novel?.autoSuggestRoutes ? (
                            <NovelBubbleSuggestedRoutes
                              content={item.content}
                              routes={
                                item.id === latestAssistantMessageId &&
                                item.status === 'complete' &&
                                extractSuggestedRoutesFromAssistantContent(item.content).length === 0
                                  ? sessionMeta?.suggestedRoutes
                                  : undefined
                              }
                              isSuggesting={
                                item.id === latestAssistantMessageId &&
                                item.status === 'complete' &&
                                Boolean(sessionMeta?.isSuggestingRoutes)
                              }
                              disabled={
                                isSending ||
                                Boolean(regeneratingMessageId) ||
                                hasStreamingMessage
                              }
                              onSelect={(route) => setDraft(route)}
                            />
                          ) : null}
                        </View>
                      )}
                    </View>
                  </View>
                  {!immersiveReading &&
                  !isUser &&
                  (item.status === 'complete' || item.status === 'error' || item.status === 'cancelled') ? (
                    <TokenUsageHint
                      promptTokens={item.promptTokens}
                      completionTokens={item.completionTokens}
                      align="left"
                    />
                  ) : null}
                  {!immersiveReading ? (
                    <View style={[styles.messageActions, isUser && styles.messageActionsUser]}>
                      <Pressable
                        onPress={() => {
                          void (async () => {
                            await Clipboard.setStringAsync(
                              isUser ? stripNovelChapterExpansion(item.content) : item.content,
                            );
                            showAppAlert('已复制', '消息内容已复制到剪贴板。');
                          })();
                        }}
                        style={({ pressed }) => [
                          styles.actionChip,
                          { borderColor: theme.border },
                          pressed && styles.pressed,
                        ]}>
                        <ThemedText type="code" themeColor="textSecondary">
                          复制
                        </ThemedText>
                      </Pressable>
                      {canEdit ? (
                        <Pressable
                          onPress={() => openEditMessage(item)}
                          style={({ pressed }) => [
                            styles.actionChip,
                            { borderColor: theme.border },
                            pressed && styles.pressed,
                          ]}>
                          <ThemedText type="code" themeColor="accent">
                            编辑
                          </ThemedText>
                        </Pressable>
                      ) : null}
                      <Pressable
                        disabled={item.status === 'streaming' || isSending || Boolean(regeneratingMessageId)}
                        onPress={() => handleDeleteMessage(item)}
                        style={({ pressed }) => [
                          styles.actionChip,
                          {
                            borderColor: theme.border,
                            opacity:
                              item.status === 'streaming' || isSending || Boolean(regeneratingMessageId)
                                ? 0.45
                                : 1,
                          },
                          pressed && styles.pressed,
                        ]}>
                        <ThemedText type="code" themeColor="accent">
                          删除
                        </ThemedText>
                      </Pressable>
                      {showRegenerate ? (
                        <Pressable
                          disabled={!canRegenerate}
                          onPress={() => {
                            if (isError) {
                              setPendingModelRetryMessageId(item.id);
                              setIsWritingModelPickerOpen(true);
                            } else {
                              void handleRegenerate(item.id);
                            }
                          }}
                          style={({ pressed }) => [
                            styles.actionChip,
                            { borderColor: theme.border, opacity: canRegenerate ? 1 : 0.45 },
                            pressed && styles.pressed,
                          ]}>
                          <ThemedText type="code" themeColor="accent">
                            {isRegenerating ? '生成中' : isError ? '换个模型试试' : '重新生成'}
                          </ThemedText>
                        </Pressable>
                      ) : null}
                    </View>
                  ) : null}
                </View>
              );
            }}
            ListEmptyComponent={
              <ThemedText type="small" themeColor="textMuted" style={styles.emptyHint}>
                {immersiveReading
                  ? '还没有可阅读的 AI 正文。'
                  : '还没有内容。直接输入开始这段故事吧。'}
              </ThemedText>
            }
          />

          {userMessageIds.length > 0 || !stickToBottom ? (
            <View style={styles.jumpControls}>
              {userMessageIds.length > 0 ? (
                <Pressable
                  disabled={navigationDisabled}
                  onPress={() => void jumpToPreviousUserMessage()}
                  accessibilityRole="button"
                  accessibilityLabel="定位到上一个用户提问"
                  style={({ pressed }) => [
                    styles.jumpButton,
                    {
                      backgroundColor: theme.surface,
                      borderColor: theme.accent,
                      opacity: navigationDisabled ? 0.45 : 1,
                    },
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText type="code" themeColor="accent">
                    {isLoadingEarlier ? '加载更早…' : navigationUserMessageId ? '上一个提问' : '最近提问'}
                  </ThemedText>
                </Pressable>
              ) : null}
              {!stickToBottom ? (
                <Pressable
                  onPress={() => {
                    setStickToBottom(true);
                    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));
                  }}
                  style={[styles.jumpButton, { backgroundColor: theme.accent }]}> 
                  <ThemedText type="code" style={styles.jumpBottomText}>
                    回到底部
                  </ThemedText>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {isImmersiveTocOpen ? (
            <ImmersiveTocModal
              visible={isImmersiveTocOpen}
              entries={immersiveToc}
              onClose={() => setIsImmersiveTocOpen(false)}
              onSelect={(messageId) => {
                const index = displayMessages.findIndex((message) => message.id === messageId);
                if (index < 0) {
                  return;
                }
                setStickToBottom(false);
                try {
                  listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0 });
                } catch {
                  listRef.current?.scrollToEnd({ animated: true });
                }
              }}
            />
          ) : null}

          {immersiveReading ? (
            <View
              style={[
                styles.composerDock,
                {
                  borderTopColor: theme.border,
                  backgroundColor: `${theme.background}ee`,
                  paddingVertical: Spacing.two,
                },
              ]}>
              <View style={styles.immersiveDockRow}>
                <Pressable
                  onPress={() => setIsImmersiveTocOpen(true)}
                  style={({ pressed }) => [
                    styles.immersiveExit,
                    styles.immersiveDockButton,
                    { borderColor: theme.border, backgroundColor: theme.surface },
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText type="smallBold" themeColor="accent">
                    目录
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setIsImmersiveTocOpen(false);
                    setImmersiveReading(false);
                  }}
                  style={({ pressed }) => [
                    styles.immersiveExit,
                    styles.immersiveDockButton,
                    { borderColor: theme.border, backgroundColor: theme.surface },
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText type="smallBold" themeColor="accent">
                    退出沉浸阅读
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          ) : (
            <View
              style={[
                styles.composerDock,
                { borderTopColor: theme.border, backgroundColor: `${theme.background}ee` },
              ]}>
              <View style={styles.composerTools}>
                <Pressable
                  onPress={() => setIsSceneInspirationOpen(true)}
                  disabled={hasStreamingMessage || isSending || Boolean(regeneratingMessageId)}
                  style={({ pressed }) => [
                    styles.composerToolChip,
                    { borderColor: theme.accent, backgroundColor: theme.accentMuted },
                    (hasStreamingMessage || isSending || regeneratingMessageId) && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="打开灵感对话">
                  <ThemedText type="smallBold" themeColor="accent" style={styles.composerToolLabel}>
                    ✨ 灵感对话
                  </ThemedText>
                </Pressable>
                {ENABLE_QUICK_TRAVEL && novel?.quickTravel?.config.enabled ? (
                  <>
                    <Pressable
                      onPress={() => setIsWorldsOpen(true)}
                      style={({ pressed }) => [
                        styles.composerToolChip,
                        { borderColor: theme.border, backgroundColor: theme.surface },
                        pressed && styles.pressed,
                      ]}>
                      <ThemedText type="smallBold" themeColor="accent" style={styles.composerToolLabel}>
                        快穿世界
                      </ThemedText>
                    </Pressable>
                  </>
                ) : null}
                <Pressable
                  onPress={() => setActiveActionMenu('creation')}
                  disabled={hasStreamingMessage || isSending || Boolean(regeneratingMessageId)}
                  style={({ pressed }) => [
                    styles.composerToolChip,
                    {
                      borderColor: collaborationEnabled ? theme.accent : theme.border,
                      backgroundColor: collaborationEnabled ? theme.accentMuted : theme.surface,
                    },
                    (hasStreamingMessage || isSending || regeneratingMessageId) && styles.disabled,
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="选择创作模式">
                  <ThemedText type="smallBold" themeColor="accent" style={styles.composerToolLabel}>
                    {collaborationEnabled
                      ? `创作 · ${reviewMode === 'deep' ? '协作深度' : '协作快速'}`
                      : '创作 · 单人叙事'}
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => setActiveActionMenu('reading')}
                  style={({ pressed }) => [
                    styles.composerToolChip,
                    { borderColor: theme.border, backgroundColor: theme.surface },
                    pressed && styles.pressed,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel="打开阅读工具">
                  <ThemedText type="smallBold" themeColor="accent" style={styles.composerToolLabel}>
                    阅读工具 · 3
                  </ThemedText>
                </Pressable>
              </View>
              <View style={styles.composer}>
                <TextInput
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="写下你的行动或对白…"
                  placeholderTextColor={theme.textMuted}
                  multiline
                  editable={
                    !isSending &&
                    !regeneratingMessageId &&
                    !hasStreamingMessage
                  }
                  style={[
                    styles.input,
                    {
                      backgroundColor: theme.surface,
                      borderColor: theme.border,
                      color: theme.text,
                    },
                  ]}
                />
                <Pressable
                  onPress={() => {
                    const generating =
                      isSending || Boolean(regeneratingMessageId) || hasStreamingMessage;
                    if (generating && novelId) {
                      cancelNovelMessage(novelId);
                      return;
                    }
                    void handleSend();
                  }}
                  disabled={
                    !(
                      isSending ||
                      Boolean(regeneratingMessageId) ||
                      hasStreamingMessage ||
                      draft.trim()
                    )
                  }
                  style={({ pressed }) => [
                    styles.sendButton,
                    {
                      backgroundColor: theme.accent,
                      opacity: !(
                        isSending ||
                        regeneratingMessageId ||
                        hasStreamingMessage ||
                        draft.trim()
                      )
                        ? 0.45
                        : pressed
                          ? 0.8
                          : 1,
                    },
                  ]}>
                  <ThemedText type="smallBold" style={styles.sendText}>
                    {isSending || regeneratingMessageId || hasStreamingMessage
                      ? '取消'
                      : '发送'}
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>

      {editingMessage ? (
        <KeyboardSafeModal
          visible={Boolean(editingMessage)}
          onRequestClose={() => setEditingMessage(null)}>
          <View style={styles.editOverlay}>
            <Pressable style={styles.editBackdrop} onPress={() => setEditingMessage(null)} />
            <View
              style={[
                styles.editCard,
                { backgroundColor: theme.surface, borderColor: theme.border },
              ]}>
              <ThemedText type="smallBold">
                编辑{editingMessage?.role === 'user' ? '你的' : 'AI'}消息
              </ThemedText>
              {editingMessage?.role === 'user' ? (
                <ThemedText type="small" themeColor="textSecondary">
                  仅替换本轮 AI 回复并重新生成，不会动到更早的对话。
                </ThemedText>
              ) : null}
              <TextInput
                value={editDraft}
                onChangeText={setEditDraft}
                multiline
                autoFocus
                placeholderTextColor={theme.textMuted}
                style={[
                  styles.editInput,
                  {
                    backgroundColor: theme.background,
                    borderColor: theme.border,
                    color: theme.text,
                  },
                ]}
              />
              <View style={styles.editActions}>
                <Pressable onPress={() => setEditingMessage(null)} style={styles.editCancel}>
                  <ThemedText type="smallBold" themeColor="accent">
                    取消
                  </ThemedText>
                </Pressable>
                <Pressable
                  onPress={() => {
                    void saveEditedMessage();
                  }}
                  style={({ pressed }) => [
                    styles.editSave,
                    { backgroundColor: theme.accent },
                    pressed && styles.pressed,
                  ]}>
                  <ThemedText type="smallBold" style={styles.sendText}>
                    {editingMessage?.role === 'user' ? '保存并重生成' : '保存'}
                  </ThemedText>
                </Pressable>
              </View>
            </View>
          </View>
        </KeyboardSafeModal>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  backgroundLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 0,
  },
  backgroundImage: {
    ...StyleSheet.absoluteFill,
  },
  backgroundScrim: {
    ...StyleSheet.absoluteFill,
  },
  safeArea: {
    flex: 1,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
    zIndex: 1,
  },
  transparentLayer: {
    backgroundColor: 'transparent',
  },
  flex: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing.three,
    padding: Spacing.four,
  },
  messageList: {
    flexGrow: 1,
    padding: Spacing.three,
    gap: Spacing.three,
  },
  messageListPreparing: {
    opacity: 0,
  },
  messageRow: {
    width: '100%',
  },
  userRow: {
    alignItems: 'flex-end',
  },
  assistantRow: {
    alignItems: 'flex-start',
    gap: Spacing.one,
  },
  bubble: {
    maxWidth: '88%',
    borderWidth: 1,
    borderRadius: 18,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    overflow: 'visible',
  },
  assistantBubbleBody: {
    width: '100%',
    overflow: 'visible',
  },
  messageActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.one,
    marginTop: 2,
  },
  messageActionsUser: {
    justifyContent: 'flex-end',
  },
  actionChip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.two,
    paddingVertical: 4,
  },
  jumpControls: {
    position: 'absolute',
    right: Spacing.three,
    bottom: 132,
    alignItems: 'flex-end',
    gap: Spacing.two,
    zIndex: 4,
  },
  jumpButton: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: Spacing.three,
    paddingVertical: 8,
  },
  jumpBottomText: {
    color: '#120c09',
    fontWeight: '700',
  },
  pressed: {
    opacity: 0.72,
  },
  emptyHint: {
    marginTop: Spacing.four,
    textAlign: 'center',
  },
  memoryErrorBanner: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.one,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  agentStageBanner: {
    marginHorizontal: Spacing.three,
    marginBottom: Spacing.one,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
  },
  composerDock: {
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: Spacing.three,
    paddingTop: Spacing.two,
    paddingBottom: Platform.OS === 'android' ? Spacing.two : Spacing.three,
    gap: Spacing.two,
  },
  composerTools: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'stretch',
    gap: Spacing.two,
  },
  composerToolChip: {
    flex: 1,
    minWidth: 96,
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 22,
    paddingHorizontal: Spacing.two,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composerToolLabel: {
    fontSize: 14,
    textAlign: 'center',
  },
  immersiveExit: {
    borderWidth: 1,
    borderRadius: 14,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  immersiveDockRow: {
    flexDirection: 'row',
    gap: Spacing.two,
    paddingHorizontal: Spacing.three,
  },
  immersiveDockButton: {
    flex: 1,
  },
  immersiveBubble: {
    borderWidth: 0,
    paddingHorizontal: Spacing.one,
  },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: Spacing.two,
  },
  editOverlay: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: Spacing.three,
  },
  editBackdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(23, 18, 15, 0.35)',
  },
  editCard: {
    borderWidth: 1,
    borderRadius: 18,
    padding: Spacing.four,
    gap: Spacing.three,
  },
  disabled: {
    opacity: 0.45,
  },
  editInput: {
    minHeight: 160,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    fontSize: 16,
    lineHeight: 24,
    textAlignVertical: 'top',
  },
  editActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: Spacing.three,
  },
  editCancel: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.two,
  },
  editSave: {
    borderRadius: 16,
    minHeight: 40,
    paddingHorizontal: Spacing.four,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderWidth: 1,
    borderRadius: 16,
    paddingHorizontal: Spacing.three,
    paddingVertical: Spacing.two,
    textAlignVertical: 'top',
    fontSize: 16,
  },
  sendButton: {
    minHeight: 44,
    borderRadius: 16,
    paddingHorizontal: Spacing.three,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendText: {
    color: '#120c09',
  },
});
