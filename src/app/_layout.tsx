import { NotoSansSC_400Regular } from '@expo-google-fonts/noto-sans-sc/400Regular';
import { NotoSerifSC_400Regular } from '@expo-google-fonts/noto-serif-sc/400Regular';
import { Stack, ThemeProvider, type Theme } from 'expo-router';
import { useFonts } from 'expo-font';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';

import { AnimatedSplashOverlay } from '@/components/animated-icon';
import { AppFeedbackHost } from '@/components/AppFeedbackHost';
import { DesktopAppShell } from '@/components/desktop/DesktopAppShell';
import { CHAT_BUNDLED_FONT_NAMES } from '@/constants/reading';
import { Fonts } from '@/constants/theme';
import { useColorScheme } from '@/hooks/use-color-scheme';
import { useTheme } from '@/hooks/use-theme';
import { useTavernStore } from '@/store/tavern-store';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const theme = useTheme();
  const hasHydrated = useTavernStore((state) => state.hasHydrated);
  const motionEnabled = useTavernStore((state) => state.appearanceSettings.motionEnabled);
  const navigationTheme: Theme = {
    dark: colorScheme === 'dark',
    colors: {
      primary: theme.primary,
      background: theme.background,
      card: theme.surfaceElevated,
      text: theme.text,
      border: theme.outlineVariant,
      notification: theme.error,
    },
    fonts: {
      regular: { fontFamily: Fonts.sans, fontWeight: '400' },
      medium: { fontFamily: Fonts.sans, fontWeight: '500' },
      bold: { fontFamily: Fonts.sans, fontWeight: '700' },
      heavy: { fontFamily: Fonts.sans, fontWeight: '800' },
    },
  };
  const [fontsLoaded, fontError] = useFonts({
    [CHAT_BUNDLED_FONT_NAMES.song]: NotoSerifSC_400Regular,
    [CHAT_BUNDLED_FONT_NAMES.kai]: require('../../assets/fonts/LXGWWenKai-Regular.ttf'),
    [CHAT_BUNDLED_FONT_NAMES.deng]: NotoSansSC_400Regular,
  });

  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.background);
  }, [theme.background]);

  if (!fontsLoaded && !fontError) {
    return null;
  }

  return (
    <ThemeProvider value={navigationTheme}>
      <StatusBar style={colorScheme === 'dark' ? 'light' : 'dark'} />
      {hasHydrated ? <AnimatedSplashOverlay enabled={motionEnabled} /> : null}
      <DesktopAppShell>
        <Stack
          screenOptions={{
            headerShown: false,
            headerStyle: { backgroundColor: theme.surfaceElevated },
            headerTintColor: theme.text,
            headerTitleStyle: { fontFamily: Fonts.sans, fontWeight: '700' },
            headerShadowVisible: false,
            contentStyle: { backgroundColor: theme.background },
            animation: motionEnabled ? 'fade_from_bottom' : 'none',
          }}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="novel/create" options={{ headerShown: false }} />
          <Stack.Screen name="novel/interactive/create" options={{ headerShown: false }} />
          <Stack.Screen name="novel/world-outline/[novelId]" options={{ headerShown: true, animation: motionEnabled ? 'slide_from_right' : 'none' }} />
          <Stack.Screen name="novel/world/[novelId]" options={{ headerShown: true, animation: motionEnabled ? 'fade' : 'none' }} />
          <Stack.Screen name="novel/edit/[novelId]" options={{ headerShown: false }} />
          <Stack.Screen name="novel/[novelId]" options={{ headerShown: false }} />
          <Stack.Screen name="worldbook/index" />
          <Stack.Screen name="explore" />
          <Stack.Screen name="debug" options={{ headerShown: true }} />
        </Stack>
      </DesktopAppShell>
      <AppFeedbackHost />
    </ThemeProvider>
  );
}
