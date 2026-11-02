# 合格線

看得见声调的 JLPT 背词本。

无敌绿宝书背词网页，目前有 N1 和 N5，私人版另有 N1 真题，有两个站点：

- 公开版 https://logitlong.github.io/jlpt-words/ ：打开就能用，进度保存在本机，可导出和恢复。
- 私人版 https://logitlong.github.io/jp-word-book/ ：必须填访问令牌，进度同步到私有仓库，并有神经语音。

词表、词条、牌组音频和例句音频来自公开仓库 [jlpt-words](https://github.com/logitlong/jlpt-words)，第一次使用时加载，并留在设备上。N1 真题的词表是老师的讲义，只放在私有仓库的 `deck/exam-words`。

```bash
npm install
npm run dev
```

快捷键：`空格` 翻面，翻面后再按一次算认识；`D` 不认识；`R` 听发音；`F` 已熟悉；`S` 生词本；`Z` 撤销；`←` `→` 翻词；`Esc` 关闭。

## 部署

推送到 `main` 会更新私人版。公开版用 `zsh scripts/deploy-public.sh` 发布。

手机和 iPad 上建议用分享菜单的“添加到主屏幕”，之后像 App 一样全屏打开，没有网络时也能打开。主屏幕上的 App 和浏览器的数据分开保存。
