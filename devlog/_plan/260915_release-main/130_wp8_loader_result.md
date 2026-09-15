# 130 — wp8 결과: 로더 경로 계약

## 바뀐 것

| 파일 | 무엇이 |
|---|---|
| `src/host/browse/helper-bundle.js` | `helperLoadPathFor(accountRoot)` 추가. 역슬래시를 **하나씩** 슬래시로 바꾼다(연속을 접으면 UNC 접두가 사라진다). `HELPER_LOAD_RELPATH`는 CLI 전용이라고 주석에 못 박았고 `HELPER_VERSION`은 1.1.0 |
| `src/register.js` | `fillTemplate`을 두 작성기가 공유한다. body를 계정 루프 **안에서** 만들어 한 계정 경로가 다른 계정에 복제되지 않는다 |
| `scripts/install-codemode.mjs` | `fill`/`plannedFiles`/`agentsBody`가 `accountRoot`를 받고 `{{HELPER}}`를 `JSON.stringify(경로)`로 채운다 |
| `templates/` 넷 | 로더 줄이 `fs.readFile({{HELPER}}, 'utf8')`. `cm.js` 머리말은 계정에 의존하지 않는 문장만 |
| `scripts/probe-native-helper.mjs` | PROGRAM이 절대 경로로 로드하고, 상대 경로는 CLI 전용 부가 검사(`1b`)로 남는다 |
| `test/loader-path.test.js` | 12건. 렌더된 줄을 stub `fs`로 **실행해서** 읽으려 한 경로를 본다 |
| `test/{helper-bundle,readme-51x}.test.js` | 절대 경로 계약과 새 플레이스홀더 |

## 따옴표 규칙이 왜 이렇게 됐나

처음에는 템플릿이 `'{{HELPER}}'`처럼 placeholder를 작은따옴표로 감쌌다. 감사가 실측으로
깼다 — `install-paths.test.js`가 이미 설치를 허용하는 `it's mine` 같은 계정 루트에서 그
줄은 `fs.readFile('/Users/al/it's mine/...')`가 되어 파싱조차 되지 않는다. 따옴표를 빼면
이번엔 `/Users/...`가 정규식 리터럴로 읽혀 `Invalid regular expression flags`가 난다.
값이 자기 따옴표를 갖고 오는 형태만 둘 다 피한다. 그래서 템플릿에서 따옴표를 없애고
`JSON.stringify`를 쓴다. 이 규칙은 설치기와 `register.js` 양쪽에 같이 적용된다.

## 어디까지 증명됐나

- 렌더: 공백·아포스트로피·한글·`&`·`$`·Windows·UNC 루트에서 렌더된 줄이 파싱되고
  `helperLoadPathFor(root)`를 읽는다. 두 계정 루트가 서로 다른 경로를 받는다.
- 디스크: 설치 동사가 쓴 SKILL.md와 AGENTS 블록에서도 같다.
- 실행: `scripts/verify-loader.mjs`가 설치된 SKILL.md에서 줄을 뽑아 실제 `aside repl`에서
  돌렸고 mac u/0, Windows MINI u/0, macmini-cf u/1에서 cm 1.1.0을 로드했다.
- **앱 내부 에이전트 REPL은 우리가 자동으로 돌릴 수 없다.** 사용자가 2026-09-15에 절대
  경로로 `cm.run`까지 붙는 것을 확인해 준 것이 그 표면의 증거다.

## 남긴 것

`eval/workloads/*.json` 셋은 상대 경로를 그대로 쓴다. `aside repl`로 도는 캠페인이고,
바꾸면 기록된 480실행과 비교 가능성이 깨진다. 대신 각 워크로드의 `note`에 CLI 전용임을
적었다.
