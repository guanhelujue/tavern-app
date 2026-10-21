import { View, type ViewProps } from 'react-native';

import { ThemeBackdrop } from '@/components/ThemeBackdrop';
import { ThemeColor } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

export type ThemedViewProps = ViewProps & {
  lightColor?: string;
  darkColor?: string;
  type?: ThemeColor;
  decorated?: boolean;
};

export function ThemedView({ style, lightColor, darkColor, type, decorated, children, ...otherProps }: ThemedViewProps) {
  const theme = useTheme();

  return (
    <View style={[{ backgroundColor: theme[type ?? 'background'] }, style]} {...otherProps}>
      {decorated ? <ThemeBackdrop contained /> : null}
      {children}
    </View>
  );
}
