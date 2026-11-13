import { KeyboardAwareTextInput as TextInput } from '@/components/ui/KeyboardAwareScrollView';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type UserGuide = {
  endingPreference: string;
  targetLength: string;
  mustKeep: string;
  mustAvoid: string;
};

export const EMPTY_GUIDE: UserGuide = {
  endingPreference: '',
  targetLength: '',
  mustKeep: '',
  mustAvoid: '',
};

// ─────────────────────────────────────────────────────────────────────────────
// 写作指导输入
// ─────────────────────────────────────────────────────────────────────────────

export function GuideStep({
  guide,
  onChange,
  onNext,
  nextLabel = '推演候选路线 →',
  showNextButton = true,
}: {
  guide: UserGuide;
  onChange: (guide: UserGuide) => void;
  onNext: () => void;
  nextLabel?: string;
  showNextButton?: boolean;
}) {
  const theme = useTheme();

  function update(field: keyof UserGuide, value: string) {
    onChange({ ...guide, [field]: value });
  }

  return (
    <View style={styles.stack}>
      <ThemedText type="subtitle" style={styles.welcome}>
        写作指导
      </ThemedText>
      <ThemedText themeColor="textMuted">
        描述你希望接下来的剧情走向，AI 将据此推演并续写。
      </ThemedText>

      <GuideField
        label="剧情走向"
        placeholder="例：主角发现玉佩的真相，与师父对峙"
        value={guide.endingPreference}
        onChangeText={(value) => update('endingPreference', value)}
        theme={theme}
      />
      <GuideField
        label="预计篇幅"
        placeholder="例：再写 3 章，每章约 2000 字"
        value={guide.targetLength}
        onChangeText={(value) => update('targetLength', value)}
        theme={theme}
      />
      <GuideField
        label="必须保留"
        placeholder="例：主角的玉佩能力、师姐线、魔教伏笔"
        value={guide.mustKeep}
        onChangeText={(value) => update('mustKeep', value)}
        theme={theme}
      />
      <GuideField
        label="禁止发生"
        placeholder="例：主角死亡、强行洗白反派、突然穿越"
        value={guide.mustAvoid}
        onChangeText={(value) => update('mustAvoid', value)}
        theme={theme}
      />

      {showNextButton ? (
        <Pressable
          onPress={onNext}
          style={[styles.primaryButton, { backgroundColor: theme.accent }]}
          accessibilityRole="button">
          <ThemedText type="smallBold" style={styles.primaryButtonText}>
            {nextLabel}
          </ThemedText>
        </Pressable>
      ) : null}
    </View>
  );
}

function GuideField({
  label,
  placeholder,
  value,
  onChangeText,
  theme,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChangeText: (value: string) => void;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={styles.guideField}>
      <ThemedText type="smallBold">{label}</ThemedText>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textMuted}
        multiline
        style={[
          styles.guideInput,
          {
            backgroundColor: theme.surface,
            borderColor: theme.border,
            color: theme.text,
          },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: Spacing.three,
  },
  welcome: {
    fontSize: 22,
    lineHeight: 30,
  },
  primaryButton: {
    borderRadius: 14,
    paddingVertical: Spacing.three,
    alignItems: 'center',
  },
  primaryButtonText: {
    color: '#fff',
    fontSize: 15,
  },
  guideField: {
    gap: Spacing.one,
  },
  guideInput: {
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    padding: Spacing.two,
    minHeight: 56,
    fontSize: 15,
    lineHeight: 22,
    textAlignVertical: 'top',
  },
});
