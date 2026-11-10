import { Tabs } from 'expo-router';
import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Platform, StyleSheet, Text, View, type ColorValue } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Fonts } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { useDesktopLayout } from '@/hooks/use-desktop-layout';

type TabIconProps = {
  color: ColorValue;
  focused: boolean;
  label: string;
  name: SymbolViewProps['name'];
};

function TabIcon({ color, focused, label, name }: TabIconProps) {
  return (
    <View style={styles.iconFrame}>
      <SymbolView
        name={name}
        size={20}
        weight={focused ? 'bold' : 'regular'}
        tintColor={color}
        fallback={
          <Text style={[styles.fallback, { color }]}>{label}</Text>
        }
      />
      <View
        style={[
          styles.activeSignal,
          { backgroundColor: color, opacity: focused ? 1 : 0 },
        ]}
      />
    </View>
  );
}

export default function TabsLayout() {
  const theme = useTheme();
  const desktop = useDesktopLayout();
  const insets = useSafeAreaInsets();
  const dockBottom = Math.max(insets.bottom, Platform.OS === 'web' ? 12 : 8);

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: theme.accent,
        tabBarInactiveTintColor: theme.textMuted,
        tabBarStyle: desktop ? { display: 'none' } : {
          backgroundColor: theme.surfaceElevated,
          borderColor: theme.outlineVariant,
          borderWidth: StyleSheet.hairlineWidth,
          borderTopWidth: StyleSheet.hairlineWidth,
          borderRadius: 22,
          marginHorizontal: 14,
          marginBottom: dockBottom,
          height: Platform.select({ ios: 72, android: 68, web: 70 }),
          paddingTop: 6,
          paddingBottom: 7,
          shadowColor: theme.shadow,
          shadowOpacity: 0.16,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: 8 },
          elevation: 14,
        },
        tabBarItemStyle: {
          marginHorizontal: 3,
          borderRadius: 16,
        },
        tabBarActiveBackgroundColor: theme.primaryContainer,
        tabBarHideOnKeyboard: true,
        tabBarLabelStyle: {
          fontFamily: Fonts.sans,
          fontSize: 12,
          fontWeight: '700',
          marginTop: 1,
        },
      }}>
      <Tabs.Screen
        name="novels"
        options={{
          title: '小说',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              color={color}
              focused={focused}
              label="N"
              name={{ ios: 'books.vertical.fill', android: 'menu_book', web: 'menu_book' }}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="novel-settings"
        options={{
          title: '小说配置',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              color={color}
              focused={focused}
              label="C"
              name={{ ios: 'slider.horizontal.3', android: 'tune', web: 'tune' }}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="debug"
        options={{
          title: '调试',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              color={color}
              focused={focused}
              label="T"
              name={{ ios: 'terminal.fill', android: 'terminal', web: 'terminal' }}
            />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: '系统设置',
          tabBarIcon: ({ color, focused }) => (
            <TabIcon
              color={color}
              focused={focused}
              label="S"
              name={{ ios: 'gearshape.fill', android: 'settings', web: 'settings' }}
            />
          ),
        }}
      />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  iconFrame: {
    minWidth: 28,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 3,
  },
  activeSignal: {
    width: 16,
    height: 2,
    borderRadius: 1,
  },
  fallback: {
    fontFamily: Fonts.mono,
    fontSize: 16,
    fontWeight: '800',
  },
});
