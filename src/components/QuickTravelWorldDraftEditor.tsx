import { Pressable, View } from 'react-native';

import { AccordionSection } from '@/components/novel-create/AccordionSection';
import { NovelFormField } from '@/components/novel-create/NovelFormField';
import { ThemedText } from '@/components/themed-text';
import type { NovelOutline } from '@/types/tavern';
import { createEmptyWorldOutline } from '@/utils/quick-travel';

export type QuickWorldDraftEditorItem = {
  id: string;
  name: string;
  generationBrief?: string;
  worldEra: string;
  worldRules: string;
  mission: string;
  entryScene: string;
  originalPlot: { premise: string; knownToProtagonist: string; beats: any[]; originalEnding: string };
  outline?: NovelOutline;
};

type Props = {
  worlds: QuickWorldDraftEditorItem[];
  generatingWorldId: string | null;
  onAdd: () => void;
  onDelete?: (id: string) => void;
  onChange: (id: string, updates: Partial<QuickWorldDraftEditorItem>) => void;
  onGenerate?: (world: QuickWorldDraftEditorItem) => void;
};

export function QuickTravelWorldDraftEditor({ worlds, generatingWorldId, onAdd, onDelete, onChange, onGenerate }: Props) {
  function updateWorldOutline(
    world: QuickWorldDraftEditorItem,
    update: (outline: NovelOutline) => NovelOutline,
  ) {
    onChange(world.id, { outline: update(world.outline ?? createEmptyWorldOutline()) });
  }

  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <ThemedText type="smallBold">小世界剧情（可添加多个）</ThemedText>
        <Pressable onPress={onAdd}><ThemedText type="code" themeColor="accent">＋添加小世界</ThemedText></Pressable>
      </View>
      {worlds.map((world, index) => (
        <AccordionSection key={world.id} title={`小世界 ${index + 1}${world.name ? `：${world.name}` : ''}`} defaultOpen={index === 0}>
          {onDelete && worlds.length > 1 ? <Pressable onPress={() => onDelete(world.id)}><ThemedText type="code" themeColor="textMuted">删除这个小世界</ThemedText></Pressable> : null}
          <NovelFormField label="世界名称" value={world.name} onChangeText={(value) => onChange(world.id, { name: value })} />
          <NovelFormField label="你想写什么（交给 AI 补全）" value={world.generationBrief ?? ''} multiline minHeight={150} placeholder="例如：想写一个娱乐圈替身文，主角穿成即将被全网黑的女配，必须保留真假千金和直播翻盘线……" onChangeText={(value) => onChange(world.id, { generationBrief: value })} />
          <NovelFormField label="世界时代与设定" value={world.worldEra} multiline minHeight={100} onChangeText={(value) => onChange(world.id, { worldEra: value })} />
          <NovelFormField label="本世界规则" value={world.worldRules} multiline minHeight={100} onChangeText={(value) => onChange(world.id, { worldRules: value })} />
          <NovelFormField label="世界任务" value={world.mission} multiline minHeight={90} onChangeText={(value) => onChange(world.id, { mission: value })} />
          <NovelFormField label="进入场景" value={world.entryScene} multiline minHeight={90} onChangeText={(value) => onChange(world.id, { entryScene: value })} />
          <NovelFormField label="原定剧情" value={world.originalPlot.premise} multiline minHeight={160} onChangeText={(value) => onChange(world.id, { originalPlot: { ...world.originalPlot, premise: value } })} />
          <NovelFormField label="主角已知剧情" value={world.originalPlot.knownToProtagonist} multiline minHeight={120} onChangeText={(value) => onChange(world.id, { originalPlot: { ...world.originalPlot, knownToProtagonist: value } })} />
          <NovelFormField label="原定结局" value={world.originalPlot.originalEnding} multiline minHeight={100} onChangeText={(value) => onChange(world.id, { originalPlot: { ...world.originalPlot, originalEnding: value } })} />
          <AccordionSection title="⚙️ 小世界专属大纲" defaultOpen={false}>
            <ThemedText type="small" themeColor="textMuted">
              只约束当前小世界；离开或切换到其他世界时，不会污染全书主线和其他世界的大纲。
            </ThemedText>
            <NovelFormField
              label="本世界主线"
              value={world.outline?.summary ?? ''}
              placeholder="这个小世界要完成的冲突、人物变化与任务推进"
              multiline
              minHeight={110}
              onChangeText={(summary) => updateWorldOutline(world, (outline) => ({ ...outline, summary, updatedAt: new Date().toISOString() }))}
            />
            <NovelFormField
              label="本世界篇章名"
              value={world.outline?.volumes[0]?.title ?? '本世界篇章'}
              onChangeText={(title) => updateWorldOutline(world, (outline) => ({
                ...outline,
                volumes: outline.volumes.map((volume, index) => index === 0 ? { ...volume, title } : volume),
                updatedAt: new Date().toISOString(),
              }))}
            />
            <NovelFormField
              label="本世界第一章目标"
              value={world.outline?.volumes[0]?.chapters[0]?.goal ?? ''}
              placeholder="进入世界后，本章发生什么冲突、做出什么选择、留下什么钩子"
              multiline
              minHeight={100}
              onChangeText={(goal) => updateWorldOutline(world, (outline) => ({
                ...outline,
                volumes: outline.volumes.map((volume, volumeIndex) => volumeIndex === 0 ? {
                  ...volume,
                  chapters: volume.chapters.map((chapter, chapterIndex) => chapterIndex === 0 ? { ...chapter, goal } : chapter),
                } : volume),
                updatedAt: new Date().toISOString(),
              }))}
            />
          </AccordionSection>
          {onGenerate ? <Pressable onPress={() => onGenerate(world)} disabled={generatingWorldId !== null} style={{ padding: 14, alignItems: 'center' }}>
            <ThemedText type="smallBold" themeColor="accent">
              {generatingWorldId === world.id ? '正在生成本世界剧情…' : '单独生成这个小世界的剧情'}
            </ThemedText>
          </Pressable> : null}
        </AccordionSection>
      ))}
    </View>
  );
}
