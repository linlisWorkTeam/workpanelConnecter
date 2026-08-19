function item({ id, label, checked, disabled, onPick }) {
  return { id, label, checked: Boolean(checked), disabled: Boolean(disabled), onPick };
}

/** Right-click menu model for pet appearance (no chat-panel UI). */
export function buildAppearanceMenu({ mode, live2dItems, spriteItems, currentModelUrl, currentSkin }) {
  const live2d = mode === 'live2d';
  return [
    item({
      id: 'mode-live2d',
      label: '形象 · Live2D',
      checked: live2d,
    }),
    item({
      id: 'mode-sprite',
      label: '形象 · 状态动图',
      checked: !live2d,
    }),
    { id: 'sep-1', separator: true },
    ...(live2d ? live2dItems : spriteItems).map((row) =>
      item({
        id: row.id,
        label: row.label,
        checked: live2d ? row.modelUrl === currentModelUrl : row.id === currentSkin,
      })
    ),
    { id: 'sep-2', separator: true },
    item({ id: 'upload', label: live2d ? '上传 Live2D 文件夹…' : '上传动图文件夹…' }),
    ...(live2d
      ? []
      : [
          item({ id: 'copy-prompt', label: '复制定制 prompt' }),
          item({ id: 'load-zip', label: '加载压缩包…' }),
        ]),
  ];
}
