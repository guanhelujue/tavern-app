import { StyleSheet } from 'react-native';

import { ThemedText } from '@/components/themed-text';

type TokenUsageHintProps = {
  promptTokens?: number;
  completionTokens?: number;
  align?: 'left' | 'right';
};

export function TokenUsageHint({
  promptTokens,
  completionTokens,
  align = 'left',
}: TokenUsageHintProps) {
  if (
    typeof promptTokens !== 'number' &&
    typeof completionTokens !== 'number'
  ) {
    return null;
  }

  const inText = typeof promptTokens === 'number' ? String(promptTokens) : '-';
  const outText = typeof completionTokens === 'number' ? String(completionTokens) : '-';

  return (
    <ThemedText
      style={[
        styles.hint,
        align === 'right' ? styles.alignRight : styles.alignLeft,
      ]}>
      {`消耗: ${inText} in / ${outText} out`}
    </ThemedText>
  );
}

const styles = StyleSheet.create({
  hint: {
    fontSize: 10,
    lineHeight: 14,
    color: '#A09E98',
    marginTop: 4,
  },
  alignLeft: {
    alignSelf: 'flex-start',
  },
  alignRight: {
    alignSelf: 'flex-end',
  },
});
