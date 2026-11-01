# 背单词

无敌绿宝书 N1 背词网页，有两个站点：

- 公开版 https://weilong-lab.github.io/n1-word-book/ ：打开就能用，进度保存在本机，可导出和恢复。
- 私人版 https://weilong-lab.github.io/jp-word-book/ ：必须填访问令牌，进度同步到私有仓库，并有神经语音。

词表、词条、牌组音频和例句音频来自公开仓库 [n1-word-book](https://github.com/weilong-lab/n1-word-book)，第一次使用时加载，并留在设备上。

```bash
npm install
npm run dev
```

快捷键：`空格` 翻面，翻面后再按一次算认识；`D` 不认识；`R` 听发音；`F` 已熟悉；`S` 生词本；`Z` 撤销；`←` `→` 翻词；`Esc` 关闭。

## 部署

推送到 `main` 会更新私人版。公开版用 `zsh scripts/deploy-public.sh` 发布。

手机和 iPad 上建议用分享菜单的“添加到主屏幕”，之后像 App 一样全屏打开，没有网络时也能打开。主屏幕上的 App 和浏览器的数据分开保存。
