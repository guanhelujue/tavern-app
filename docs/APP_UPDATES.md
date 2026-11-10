# 应用更新发布约定

手机端「设置 → 关于」会查询 `guanhelujue/tavern-app` 的 GitHub 正式 Release。当前仓库尚未公开 Release 时，界面会明确提示，不会把网络失败误报成“已是最新”。

发布新版本时：

1. 先同步 `app.json` 的 `expo.version`，并递增 Android `versionCode`。
2. 创建与版本一致的 tag，例如 `v1.1.0`，并发布正式 Release（不能是 draft 或 prerelease）。
3. 上传与构建变体对应的附件：`guanhelujue-full.apk` 或 `guanhelujue-standard.apk`。
4. APK 必须继续使用相同的 applicationId、签名密钥和兼容的安装渠道；更新服务只会选择当前变体的精确附件。

下载按钮会打开 GitHub/APK 下载地址。Android 系统仍会要求用户确认安装，应用不会申请额外安装权限或静默替换自身。
