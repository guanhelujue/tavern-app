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
import { MobileIcon } from '@/components/mobile/MobileUI';

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

  if (Platform.OS !== 'web') {
    return <View style={styles.mobilePage}>
      <View style={styles.mobileBrand}>
        <MobileIcon name={{ ios: 'square.and.pencil', android: 'edit_square', web: 'edit_square' }} size={52} color={theme.primary} />
        <ThemedText style={styles.mobileBrandTitle}>酒馆</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">让故事继续生长</ThemedText>
      </View>
      <View style={[styles.mobileVersionRow, { borderTopColor: theme.border, borderBottomColor: theme.border }]}>
        <ThemedText type="smallBold">当前版本</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{version ? `v${version}` : '未知'} · Build {build}</ThemedText>
      </View>
      <Pressable accessibilityRole="button" accessibilityState={{ disabled: checking || !version, busy: checking }} disabled={checking || !version} onPress={() => void check()} style={({ pressed }) => [styles.mobileCheckButton, { backgroundColor: theme.primary }, pressed && styles.pressed, (checking || !version) && styles.disabled]}>
        {checking ? <><ActivityIndicator color={theme.onPrimary} /><ThemedText type="smallBold" style={{ color: theme.onPrimary }}>正在检查…</ThemedText></> : <><MobileIcon name={{ ios: 'arrow.clockwise', android: 'refresh', web: 'refresh' }} size={20} color={theme.onPrimary} /><ThemedText type="smallBold" style={{ color: theme.onPrimary }}>检查更新</ThemedText></>}
      </Pressable>
      {!version && <ThemedText type="small" themeColor="textSecondary">暂时无法读取当前版本，请先在 GitHub 查看发布信息。</ThemedText>}
      {message ? <ThemedText accessibilityRole="alert" type="small" style={{ color: theme.error }}>{message}</ThemedText> : null}
      {result ? <View style={[styles.mobileResult, { backgroundColor: theme.primaryContainer, borderColor: theme.border }]}>
        <ThemedText type="subtitle">{result.status === 'update-available' ? `发现新版本 ${result.latest.tagName}` : result.status === 'local-newer' ? `本地版本 v${version} 高于 GitHub 版本` : '已是最新正式版本'}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">{result.latest.name}{result.latest.publishedAt ? ` · ${new Date(result.latest.publishedAt).toLocaleDateString()}` : ''}</ThemedText>
        {result.status === 'update-available' ? <>
          <ThemedText type="small" themeColor="textMuted">{result.matchingAsset ? `可下载 ${result.matchingAsset.name}` : '该 Release 没有当前版本对应的 APK，将打开 Release 页面。'}</ThemedText>
          <Pressable accessibilityRole="button" onPress={() => void openUrl(result.matchingAsset?.browserDownloadUrl ?? result.latest.htmlUrl)} style={({ pressed }) => [styles.mobileDownloadButton, { backgroundColor: theme.primary }, pressed && styles.pressed]}><MobileIcon name={{ ios: 'arrow.down.to.line', android: 'download', web: 'download' }} size={20} color={theme.onPrimary} /><ThemedText type="smallBold" style={{ color: theme.onPrimary }}>{result.matchingAsset ? '下载 Android 安装包' : '查看发布页面'}</ThemedText></Pressable>
          <ThemedText type="small" themeColor="textMuted">下载完成后，按系统提示安装更新。</ThemedText>
        </> : null}
        {result.latest.body ? <ThemedText type="small" themeColor="textSecondary">{result.latest.body.slice(0, 800)}</ThemedText> : null}
      </View> : null}
      <View style={[styles.mobileLinks, { borderColor: theme.outlineVariant }]}>
        <Pressable accessibilityRole="link" onPress={() => void openUrl(APP_UPDATE_RELEASES_URL)} style={[styles.mobileLinkRow, { borderBottomColor: theme.border }]}><MobileIcon name={{ ios: 'arrow.up.right.square', android: 'open_in_new', web: 'open_in_new' }} color={theme.primary} /><View style={styles.mobileLinkCopy}><ThemedText type="smallBold">查看发布说明</ThemedText><ThemedText type="small" themeColor="textSecondary">GitHub Releases</ThemedText></View><MobileIcon name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} color={theme.textMuted} /></Pressable>
        <Pressable accessibilityRole="link" onPress={() => void openUrl(APP_UPDATE_REPOSITORY_URL)} style={[styles.mobileLinkRow, { borderBottomColor: theme.outlineVariant }]}><MobileIcon name={{ ios: 'chevron.left.forwardslash.chevron.right', android: 'code', web: 'code' }} color={theme.primary} /><View style={styles.mobileLinkCopy}><ThemedText type="smallBold">GitHub 仓库</ThemedText><ThemedText type="small" themeColor="textSecondary">{APP_UPDATE_REPOSITORY_URL.replace('https://github.com/', '')}</ThemedText></View><MobileIcon name={{ ios: 'chevron.right', android: 'chevron_right', web: 'chevron_right' }} color={theme.textMuted} /></Pressable>
      </View>
    </View>;
  }

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
        <Pressable accessibilityRole="button" onPress={() => void openUrl(result.matchingAsset?.browserDownloadUrl ?? result.latest.htmlUrl)} style={({ pressed }) => [styles.button, { backgroundColor: theme.secondary }, pressed && styles.pressed]}><ThemedText type="smallBold" style={{ color: theme.onSecondary }}>{result.matchingAsset ? '下载 Android 更新' : '查看发布页面'}</ThemedText></Pressable><ThemedText type="small" themeColor="textMuted">下载后打开安装包，按系统提示确认更新。</ThemedText>
      </> : null}
      {result.latest.body ? <ThemedText type="small" themeColor="textSecondary">{result.latest.body.slice(0, 500)}</ThemedText> : null}
    </View> : null}
    <Pressable accessibilityRole="link" onPress={() => void openUrl(APP_UPDATE_REPOSITORY_URL)} style={styles.repoLink}><ThemedText type="small" themeColor="primary">GitHub：{APP_UPDATE_REPOSITORY_URL}</ThemedText></Pressable>
  </AccordionSection>;
}

const styles = StyleSheet.create({ copy: { gap: Spacing.one }, mobilePage: { gap: Spacing.three, paddingTop: Spacing.two }, mobileBrand: { alignItems: 'center', paddingVertical: Spacing.three, gap: 4 }, mobileBrandTitle: { fontSize: 32, lineHeight: 40, fontWeight: '700' }, mobileVersionRow: { minHeight: 56, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, mobileCheckButton: { minHeight: 50, borderRadius: 14, paddingHorizontal: Spacing.three, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, mobileResult: { borderWidth: 1, borderRadius: 16, padding: Spacing.three, gap: Spacing.two }, mobileDownloadButton: { minHeight: 48, borderRadius: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, mobileLinks: { borderTopWidth: StyleSheet.hairlineWidth }, mobileLinkRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 14, borderBottomWidth: StyleSheet.hairlineWidth }, mobileLinkCopy: { flex: 1, gap: 3 }, actions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: Spacing.two }, button: { minHeight: 48, minWidth: 120, borderRadius: 14, paddingHorizontal: Spacing.three, alignItems: 'center', justifyContent: 'center' }, linkButton: { minHeight: 48, paddingHorizontal: Spacing.two, justifyContent: 'center' }, repoLink: { minHeight: 48, justifyContent: 'center' }, result: { borderWidth: 1, borderRadius: 14, padding: Spacing.three, gap: Spacing.two }, pressed: { opacity: 0.75 }, disabled: { opacity: 0.6 } });
