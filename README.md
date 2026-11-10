# 酒馆

基于 Expo 57 和 React Native 的小说创作应用。书架仅保留「创建作品」，使用现有的工作台创建流程；已有作品和导入正文均在同一工作台内编辑。

## Android 安装

从 [GitHub Releases](https://github.com/guanhelujue/tavern-app/releases/latest) 下载 `guanhelujue-full.apk`。安装后可在「设置 → 关于」查看版本、检查更新和下载新安装包。

## 开发

```sh
npm ci
npx expo start
```

项目包含本地原生模块，手机运行需要开发构建或 APK。网页开发使用 `npm run web`。

## Windows 打包

安装 JDK 17、Android SDK，并配置相应的 Java 和 Android 环境变量。首次打包或修改 `app.json` 后，先同步原生工程：

```sh
npx expo prebuild --platform android --no-install
npm run build:apk:full
```

完整包输出到 `dist/full/guanhelujue-full.apk`；`npm run build:apk:standard` 输出标准包到 `dist/standard/guanhelujue-standard.apk`。原生工程与构建产物不纳入源码。

发布时同步 `app.json`、`package.json` 和锁文件版本，递增 Android `versionCode`，并沿用原来的签名密钥。Release tag 使用 `vX.Y.Z`，APK 文件名须与上述约定一致，详见 [更新发布约定](docs/APP_UPDATES.md)。

## 验证

```sh
npx tsc --noEmit
npm test
```
