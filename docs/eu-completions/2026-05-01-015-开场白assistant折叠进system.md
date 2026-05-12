# 2026-05-01-015 开场白 assistant 折叠进 system

## 问题
- 故事书长开场在 UI 可见，但模型对用户首句「极简/乱剧情」；用户怀疑 EU 未把开场白当上下文。

## 根因
- `toBackendSafeMessages` 为兼容「对话不能以 assistant 开头」会 **丢弃所有前置 assistant 轮次**。
- EU 将 `first_mes` 存为会话首条 **assistant**，首条用户发送后请求体里只剩 **system + 当前 user**，开场白被删掉，等价于「没有前文」。

## 改动
- `public/eu-demo.html`
  - `toBackendSafeMessages`：将连续 leading assistant 合并为一条 **system**（标注为开场剧情、须承接），再拼接后续 user/assistant。
  - `getStorybookGreeting`：取消「>1200 字整段丢弃」；超过 6000 字时截断保留前缀。

## 自测
1. 新开故事书会话，确认首条 user 发送后，网络请求 `messages` 中含折叠后的开场 system + 用户句。
2. 模型应能呼应开场里的情境（如初春、教室等），而非仅对单句做极简回复。
