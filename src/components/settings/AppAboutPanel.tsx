import Constants from 'expo-constants';
import * as Linking from 'expo-linking';
import { useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';

import { AccordionSection } from '@/components/novel-create/AccordionSection';
import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { APP_UPDATE_RELEASES_URL, APP_UPDATE_REPOSITORY_URL } from '@/config/app-update';
import { checkForAppUpdate, getAppBuildVariant, type AppUpdateCheckResult } from '@/services/app-updates';

export function AppAboutPanel() {
  const theme = useTheme();
  const [checking, setChecking] = useState(false);
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<AppUpdateCheckResult | null>(null);
  const checkingRef = useRef(false);
  const version = Constants.expoConfig?.version;
  const build = (Platform.OS === 'ios' ? Constants.expoConfig?.ios?.buildNumber : Constants.expoConfig?.android?.versionCode) ?? '—';
  const variant = getAppBuildVariant();

  async function check() {
    if (checkingRef.current || !version) return;
    checkingRef.current = true;
    setChecking(true); setMessage(''); setResult(null);
    try { setResult(await checkForAppUpdate(version, variant)); }
    catch (error) { setMessage(error instanceof Error ? error.message : '检查更新失败，请稍后重试。'); }
    finally { checkingRef.current = false; setChecking(false); }
  }
  async function openUrl(url: string) { try { await Linking.openURL(url); } catch { setMessage('无法打开链接，请检查浏览器或网络设置。'); } }

  return <AccordionSection title="关于" sectionNumber="05" description="版本信息、GitHub 更新与应用下载" variant="settings">
    <View style={styles.copy}>
      <ThemedText type="subtitle">酒馆</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">当前版本 {version ? `v${version}` : '未知'} · 构建 {build} · {variant === 'full' ? '完整版' : '标准版'}</ThemedText>
      <ThemedText type="small" themeColor="textMuted">更新通过 GitHub 正式 Release 提供。检查版本不会修改本地作品数据。</ThemedText>
    </View>
    <View style={styles.actions}>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: checking || !version, busy: checking }} disabled={checking || !version} onPress={() => void check()} style={({ pressed }) => [styles.button, { backgroundColor: theme.primary }, pressed && styles.pressed, (checking || !version) && styles.disabled]}>
        {checking ? <><ActivityIndicator color={theme.onPrimary} /><ThemedText type="small" style={{ color: theme.onPrimary }}>正在检查…</ThemedText></> : <ThemedText type="smallBold" style={{ color: theme.onPrimary }}>检查更新</ThemedText>}
      </Pressable>
      <Pressable accessibilityRole="link" onPress={() => void openUrl(APP_UPDATE_RELEASES_URL)} style={({ pressed }) => [styles.linkButton, pressed && styles.pressed]}><ThemedText type="smallBold" themeColor="primary">打开 GitHub Releases</ThemedText></Pressable>
    </View>
    {!version && <ThemedText type="small" themeColor="textSecondary">暂时无法读取当前版本，请先在 GitHub 查看发布信息。</ThemedText>}
    {message ? <ThemedText accessibilityRole="alert" type="small" style={{ color: theme.error }}>{message}</ThemedText> : null}
    {result ? <View style={[styles.result, { borderColor: theme.border }]}>
      <ThemedText type="smallBold">{result.status === 'update-available' ? `发现新版本 ${result.latest.tagName}` : result.status === 'local-newer' ? `本地版本 v${version} 高于 GitHub 版本` : '已是最新正式版本'}</ThemedText>
      <ThemedText type="small" themeColor="textSecondary">{result.latest.name}{result.latest.publishedAt ? ` · ${new Date(result.latest.publishedAt).toLocaleDateString()}` : ''}</ThemedText>
      {result.status === 'update-available' ? <>
        <ThemedText type="small" themeColor="textMuted">{result.matchingAsset ? `可下载 ${result.matchingAsset.name}` : '该 Release 没有当前版本对应的 APK，将打开 Release 页面。'}</ThemedText>
        {Platform.OS === 'android' ? <><Pressable accessibilityRole="button" onPress={() => void openUrl(result.matchingAsset?.browserDownloadUrl ?? result.latest.htmlUrl)} style={({ pressed }) => [styles.button, { backgroundColor: theme.secondary }, pressed && styles.pressed]}><ThemedText type="smallBold" style={{ color: theme.onSecondary }}>{result.matchingAsset ? '下载 Android 更新' : '查看发布页面'}</ThemedText></Pressable><ThemedText type="small" themeColor="textMuted">下载后打开安装包，按系统提示确认更新。</ThemedText></> : <ThemedText type="small" themeColor="textMuted">Android 更新请在手机上下载；其他平台可查看 GitHub 发布说明。</ThemedText>}
      </> : null}
      {result.latest.body ? <ThemedText type="small" themeColor="textSecondary">{result.latest.body.slice(0, 500)}</ThemedText> : null}
    </View> : null}
    <Pressable accessibilityRole="link" onPress={() => void openUrl(APP_UPDATE_REPOSITORY_URL)} style={styles.repoLink}><ThemedText type="small" themeColor="primary">GitHub：{APP_UPDATE_REPOSITORY_URL}</ThemedText></Pressable>
  </AccordionSection>;
}

const styles = StyleSheet.create({ copy: { gap: Spacing.one }, actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two }, button: { minHeight: 48, minWidth: 120, borderRadius: 14, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' }, linkButton: { minHeight: 48, paddingHorizontal: Spacing.two, justifyContent: 'center' }, repoLink: { minHeight: 48, justifyContent: 'center' }, result: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: Spacing.two }, pressed: { opacity: 0.75 }, disabled: { opacity: 0.6 } });
