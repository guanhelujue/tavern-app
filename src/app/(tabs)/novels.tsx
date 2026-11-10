import { router, type Href } from 'expo-router';
import { StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { DesktopNovelShelf } from '@/components/desktop/DesktopNovelShelf';
import { NovelMobileShelf } from '@/components/novel-continue/NovelMobileShelf';
import { useDesktopLayout } from '@/hooks/use-desktop-layout';
import { ThemedView } from '@/components/themed-view';
import { useTavernStore } from '@/store/tavern-store';
import { importChatSessionBundle } from '@/utils/chat-session-io';
import { confirmAppAction, showAppAlert } from '@/utils/app-alert';

export default function NovelsTab() {
  const desktop = useDesktopLayout();
  const novels = useTavernStore((state) => state.novels);
  const importSessionBundle = useTavernStore((state) => state.importSessionBundle);

  function handleCreateNovel() {
    router.push('/novel/create' as Href);
  }

  function openNovel(novelId: string) {
    const novel = novels.find((item) => item.id === novelId);

    if (!novel) {
      return;
    }

    if (novel.isDraft) useTavernStore.getState().updateNovel(novelId, { isDraft: false, createStep: 3 });
    router.push(`/novel/workbench/${novelId}` as Href);
  }

  async function handleImportNovel() {
    try {
      const bundle = await importChatSessionBundle();

      if (bundle.kind !== 'novel') {
        showAppAlert('导入失败', '请选择小说会话备份（JSON）。角色会话请从角色页导入。');
        return;
      }

      const exists = novels.some((item) => item.id === bundle.sessionId);
      if (exists && !await confirmAppAction('恢复为副本', '书架上已有此小说。将恢复为独立副本，保留原书及其定稿历史。', { confirmLabel: '恢复副本' })) return;
      await importSessionBundle(bundle);
      showAppAlert('导入成功', '已恢复到书架；聊天、记忆和备份内的小说内容已保存。原有小说未被覆盖。');
    } catch (error) {
      const message = error instanceof Error ? error.message : '导入失败。';

      if (message !== '已取消导入。') {
        showAppAlert('导入失败', message);
      }
    }
  }

  async function handleDeleteNovel(novelId: string) {
    const state = useTavernStore.getState();
    const novel = state.novels.find((item) => item.id === novelId);
    if (!novel) return;
    if (!await confirmAppAction('删除作品', `确定删除「${novel.name}」吗？章节、对话和记忆也会一并删除，此操作不可撤销。`, { confirmLabel: '确认删除' })) return;
    try {
      useTavernStore.getState().deleteNovel(novelId);
    } catch (error) {
      showAppAlert('删除失败', error instanceof Error ? error.message : '无法删除作品。');
    }
  }

  if (desktop) {
    return <DesktopNovelShelf novels={novels} onOpen={openNovel} onDelete={(id) => void handleDeleteNovel(id)} onCreate={handleCreateNovel} onImport={() => void handleImportNovel()} />;
  }

  return <ThemedView style={styles.page}>
    <SafeAreaView edges={['top', 'left', 'right']} style={styles.page}>
      <NovelMobileShelf novels={novels} onOpen={openNovel} onDelete={(id) => void handleDeleteNovel(id)} onCreate={handleCreateNovel} onImport={() => void handleImportNovel()} />
    </SafeAreaView>
  </ThemedView>;
}

const styles = StyleSheet.create({ page: { flex: 1 } });
