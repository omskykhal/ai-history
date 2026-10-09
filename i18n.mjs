// ai-history — user-facing strings (ko | en). Language = AUTO_HISTORY_LANG env > LANG conf file > 'en'.
// Only the wording changes; file names, markers (<!-- STATUS:BEGIN/END -->) and log symbols are language-neutral.
import fs from 'node:fs';
import path from 'node:path';

export const LANGS = ['en', 'ko'];
export const DEFAULT_LANG = 'en';

const STR = {
  ko: {
    headings: ['하던 일', '한 일', '다음 할 일', '진행도'],
    lines: '(1~5줄)',
    statusHead: { session: '세션', author: '작성', updated: '갱신', anchor: '앵커' },
    lastWorker: (agent, t) => `마지막 작업자: ${agent}${t ? ` · 갱신 ${t}` : ''}`,
    readerStatus: '=== STATUS.md ===',
    readerNoStatus: '(STATUS.md 없음)',
    readerToday: (d) => `=== 오늘 로그 꼬리(${d}, 최대 40줄) ===`,
    readerYday: (d) => `=== 어제 로그 꼬리(${d}, 최대 20줄) ===`,
    readerNone: '(없음)',
    truncated: '…(생략)',
    sessionNoHistory: '[auto-history] 이 폴더의 히스토리 없음(신규). 첫 도구 실행부터 기록 시작.',
    sessionIntro: (anchor) => `[auto-history] 이 폴더(${anchor})의 이전 작업 기록입니다. `,
    sessionInstruction: '첫 답변의 첫 줄을 `[현황]`으로 시작해 하던 일·어디까지 했는지·다음 할 일을 3~8줄로 보고하라. '
      + '`마지막 작업자` 줄이 있으면 `[현황]` 첫 줄에 마지막 작업자와 시각을 포함하라. '
      + '사용자의 첫 메시지에 구체적 지시가 있으면 보고 뒤에 그 지시를 수행하고, 인사나 빈 요청이면 보고 후 대기하라. '
      + '이전에 하던 미완료 작업은 사용자 지시 없이 재개하지 마라.',
    promptInstruction: (dirname, fmt) => '[auto-history] 도구를 1건 이상 사용한 응답은 **맨 끝**에 아래 블록을 그대로 출력하라'
      + `(대화만 한 짧은 턴은 생략 가능). 블록은 훅이 \`${dirname}/STATUS.md\`로 저장한다. `
      + '블록 본문에 추측성 표현을 쓰지 말고 확인된 사실만 적어라. 각 제목 아래 1~5줄, 한국어.\n' + fmt,
    mentionUnrecorded: (name, dir) => `[auto-history] 요청에 언급된 프로젝트 \`${name}\`(\`${dir}\`)에는 아직 기록이 없다. 이 프로젝트 작업은 \`${dir}\` 기준으로 하라. `
      + "첫 줄을 `[현황]`으로 시작해 '이 프로젝트의 기록은 아직 없음(새로 시작)'을 한 줄로 알린 뒤 이번 요청을 수행하라.",
    mentionRecorded: (name, dir) => `[auto-history] 요청에 언급된 프로젝트 \`${name}\`(\`${dir}\`)의 최근 기록이다. `
      + '첫 줄 `[현황]`으로 3~8줄 보고 후 이번 요청을 수행하라. `마지막 작업자` 줄이 있으면 `[현황]` 첫 줄에 마지막 작업자와 시각을 포함하라. '
      + `이 프로젝트 작업은 \`${dir}\` 기준으로 하라. 미완료 작업은 지시 없이 재개하지 마라.`,
    blockReason: (fmt) => `[auto-history] 이번 응답에 상태 블록이 없습니다. 아래 형식의 블록만 출력하고 종료하세요:\n${fmt}`,
    logAnchorSet: (a) => `[anchor] 지정 ${a}`,
    logAnchorChange: (o, n) => `[anchor] 변경 ${o}→${n}`,
    logTurnEndStatus: (rest) => `[Turn-end] STATUS 갱신 | ${rest}`,
    logTurnEndNoMsg: '[Turn-end] (메시지 미확보)',
    logTailAllowed: '[STATUS] 꼬리 텍스트 허용',
    logIncomplete: (m) => `[STATUS] 형식 불완전(누락: ${m})`,
    userUnknownField: '(본문 필드 미확인)',
  },
  en: {
    headings: ['Working on', 'Done', 'Next', 'Progress'],
    lines: '(1-5 lines)',
    statusHead: { session: 'Session', author: 'Author', updated: 'Updated', anchor: 'Anchor' },
    lastWorker: (agent, t) => `Last worker: ${agent}${t ? ` · updated ${t}` : ''}`,
    readerStatus: '=== STATUS.md ===',
    readerNoStatus: '(no STATUS.md)',
    readerToday: (d) => `=== Today's log tail (${d}, last 40 lines) ===`,
    readerYday: (d) => `=== Yesterday's log tail (${d}, last 20 lines) ===`,
    readerNone: '(none)',
    truncated: '…(truncated)',
    sessionNoHistory: '[auto-history] No history in this folder yet (new). Logging starts with the first tool call.',
    sessionIntro: (anchor) => `[auto-history] Previous work record for this folder (${anchor}). `,
    sessionInstruction: 'Start the first line of your first reply with `[Status]` and report in 3-8 lines what was being worked on, how far it got, and what is next. '
      + 'If a `Last worker` line is present, include the last worker and time in the first `[Status]` line. '
      + "If the user's first message contains a concrete instruction, carry it out after the report; if it is a greeting or empty, wait after the report. "
      + 'Do not resume unfinished work without an explicit instruction from the user.',
    promptInstruction: (dirname, fmt) => '[auto-history] Any reply in which you used at least one tool must END with the block below, verbatim '
      + `(a short conversation-only turn may omit it). A hook saves the block to \`${dirname}/STATUS.md\`. `
      + 'Write only verified facts, no speculation. 1-5 lines under each heading.\n' + fmt,
    mentionUnrecorded: (name, dir) => `[auto-history] The project \`${name}\` (\`${dir}\`) mentioned in the request has no history yet. Work on this project relative to \`${dir}\`. `
      + "Start with a `[Status]` line saying 'no history for this project yet (starting fresh)', then carry out the request.",
    mentionRecorded: (name, dir) => `[auto-history] Recent history of the project \`${name}\` (\`${dir}\`) mentioned in the request. `
      + 'Start with `[Status]` and report in 3-8 lines, then carry out the request. If a `Last worker` line is present, include the last worker and time in the first `[Status]` line. '
      + `Work on this project relative to \`${dir}\`. Do not resume unfinished work without an instruction.`,
    blockReason: (fmt) => `[auto-history] This reply has no status block. Output only a block in the format below and stop:\n${fmt}`,
    logAnchorSet: (a) => `[anchor] set ${a}`,
    logAnchorChange: (o, n) => `[anchor] changed ${o}→${n}`,
    logTurnEndStatus: (rest) => `[Turn-end] STATUS updated | ${rest}`,
    logTurnEndNoMsg: '[Turn-end] (message unavailable)',
    logTailAllowed: '[STATUS] trailing text allowed',
    logIncomplete: (m) => `[STATUS] incomplete (missing: ${m})`,
    userUnknownField: '(prompt field not found)',
  },
};

export function getLang(env = process.env, confDir = null) {
  const pick = (v) => { const s = String(v || '').trim().toLowerCase(); return LANGS.includes(s) ? s : null; };
  const fromEnv = pick(env.AUTO_HISTORY_LANG);
  if (fromEnv) return fromEnv;
  if (confDir) {
    try {
      const line = fs.readFileSync(path.join(confDir, 'LANG'), 'utf-8').split(/\r?\n/).map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
      const fromFile = pick(line);
      if (fromFile) return fromFile;
    } catch { /* none */ }
  }
  return DEFAULT_LANG;
}

export function T(lang) { return STR[LANGS.includes(lang) ? lang : DEFAULT_LANG]; }

export function statusFormat(lang) {
  const t = T(lang);
  return ['<!-- STATUS:BEGIN -->', ...t.headings.flatMap((h) => [`## ${h}`, `- ${t.lines}`]), '<!-- STATUS:END -->'].join('\n');
}

// Headings of every language (used to judge "incomplete" leniently: a block is complete if all 4 headings of ANY one language are present).
export const ALL_HEADINGS = LANGS.map((l) => STR[l].headings);
// STATUS header keys of every language (parsed regardless of the active language).
export const AUTHOR_KEYS = LANGS.map((l) => STR[l].statusHead.author);
export const UPDATED_KEYS = LANGS.map((l) => STR[l].statusHead.updated);
// Folder-mention keywords (always accepted in every language): "<name> project|folder" / "project|folder <name>".
export const KW_PROJECT = ['프로젝트', 'project'];
export const KW_FOLDER = ['폴더', 'folder'];
