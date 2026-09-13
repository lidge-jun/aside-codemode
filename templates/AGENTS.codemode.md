# aside-codemode (CLI)

로컬 검색·다파일 읽기는 `rg` / `find` / `grep` / `Get-ChildItem -Recurse` 를 직접 호출하지 말 것.
한 번만: `{{NODE}} {{CLI}} --code '...'`
(`node` 나 `codemode` 를 PATH에서 찾지 말 것. 항상 위 절대 경로.)

코드는 async 함수 본문. `return` 이 답이다.
게스트: `search.files|content|count`, `read_file({path, offset?, limit?})` (offset은 **줄**),
`write_file({file_path, content})` (create-only), `edit_file({path, edits, appendText?})`,
compound `fs.*`. `apply_patch` 는 게스트 헬퍼일 뿐 AGENTS 동사가 아니다.

화면에 파일 카드가 필요하면 Aside 네이티브 `read_file` / `write_file` / `edit_file`.
CLI 호출은 bash 카드다.

프로젝트 상대경로: `{{CWD_HINT}}` 또는 그 디렉터리에서 실행.
