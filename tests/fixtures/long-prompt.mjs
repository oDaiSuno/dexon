export const FOLDED_LINES = 8;
export const FOLD_THRESHOLD_LINES = 12;

const TOPICS = [
  "登录以后页面空白",
  "导出按钮点了没反应",
  "搜索结果对不上",
  "上传到一半停住",
  "夜间模式颜色太浅",
  "快捷键和文档不一致",
  "列表滚动很卡",
  "通知重复出现两条",
  "筛选条件刷新后丢失",
  "附件预览打不开",
  "退出登录没有提示",
  "表格合计算错了",
];

const STAGES = [
  "这周把用户反馈一次性贴上来",
  "麻烦先按严重程度排一遍",
  "再告诉我哪些是同一个毛病",
  "哪些只是说法不同",
  "顺便看一下有没有互相冲突的需求",
  "如果两个建议互斥",
  "就把取舍写清楚",
  "最后给我一份可以直接排期的清单",
  "标出每一条大概要几天",
  "以及需要谁来配合",
  "我不需要客套话",
  "只要结论和依据",
];

export function promptLine(tag, index) {
  return `${tag} ${String(index + 1).padStart(2, "0")} ${TOPICS[index % TOPICS.length]}`;
}

export function promptLines(tag, count) {
  return Array.from({ length: count }, (_value, index) => promptLine(tag, index));
}

export function brokenPrompt(tag, count) {
  return promptLines(tag, count).join("\n");
}

export function flowingPrompt(parts) {
  return `${Array.from({ length: parts }, (_value, index) => STAGES[index % STAGES.length]).join("，")}。`;
}

export const LONG_PROMPT_TAG = "长提问甲";
export const PREVIEW_PROMPT_TAG = "长提问乙";
export const CHANNEL_PROMPT_TAG = "长提问丙";
export const HANDOFF_PROMPT_TAG = "长提问丁";
export const OFFSCREEN_PROMPT_TAG = "长提问戊";
export const CHIP_PROMPT_TAG = "长提问己";
export const READING_PROMPT_TAG = "长提问庚";
export const PICTURE_PROMPT_TAG = "长提问辛";

export const LONG_PROMPT_LINES = 40;
export const LONG_PROMPT = brokenPrompt(LONG_PROMPT_TAG, LONG_PROMPT_LINES);
export const LONG_PROMPT_MARKER = promptLine(LONG_PROMPT_TAG, 0);
export const LONG_PROMPT_LAST_LINE = promptLine(LONG_PROMPT_TAG, LONG_PROMPT_LINES - 1);

export const PREVIEW_PROMPT = promptLines(PREVIEW_PROMPT_TAG, LONG_PROMPT_LINES)
  .map((line, index) => (index === LONG_PROMPT_LINES - 6 ? `${line} 截图 @/tmp/tall-shot.png` : line))
  .join("\n");
export const PREVIEW_PROMPT_MARKER = promptLine(PREVIEW_PROMPT_TAG, 0);

export const CHANNEL_PROMPT = brokenPrompt(CHANNEL_PROMPT_TAG, LONG_PROMPT_LINES);
export const CHANNEL_PROMPT_MARKER = promptLine(CHANNEL_PROMPT_TAG, 0);

export const HANDOFF_PROMPT = brokenPrompt(HANDOFF_PROMPT_TAG, LONG_PROMPT_LINES);
export const HANDOFF_PROMPT_MARKER = promptLine(HANDOFF_PROMPT_TAG, 0);

export const OFFSCREEN_PROMPT = brokenPrompt(OFFSCREEN_PROMPT_TAG, LONG_PROMPT_LINES);
export const OFFSCREEN_PROMPT_MARKER = promptLine(OFFSCREEN_PROMPT_TAG, 0);

export const CHIP_PROMPT_PATH = "src/hidden-chart.ts";
export const CHIP_PROMPT = promptLines(CHIP_PROMPT_TAG, LONG_PROMPT_LINES)
  .map((line, index) => (index === LONG_PROMPT_LINES - 5 ? `${line} 附件 @${CHIP_PROMPT_PATH} 打不开` : line))
  .join("\n");
export const CHIP_PROMPT_MARKER = promptLine(CHIP_PROMPT_TAG, 0);

export const WRAP_PROMPT_PARTS = 34;
export const WRAP_PROMPT = flowingPrompt(WRAP_PROMPT_PARTS);
export const WRAP_PROMPT_MARKER = STAGES[0];

export const IMAGE_PROMPT_LINES = ["大图配两行字", "图片本身不该被折叠"].join("\n");
export const IMAGE_PROMPT_MARKER = "大图配两行字";

export const READING_PROMPT = brokenPrompt(READING_PROMPT_TAG, LONG_PROMPT_LINES);
export const READING_PROMPT_MARKER = promptLine(READING_PROMPT_TAG, 0);

export const PICTURE_PROMPT = brokenPrompt(PICTURE_PROMPT_TAG, LONG_PROMPT_LINES);
export const PICTURE_PROMPT_MARKER = promptLine(PICTURE_PROMPT_TAG, 0);
