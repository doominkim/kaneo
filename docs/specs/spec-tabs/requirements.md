# spec-tabs — Requirements (Kaneo KAN-19 사본)

정본은 Kaneo KAN-19 본문이다. 이 파일은 spec-tabs 기능이 배포되어 자기 자신을 Kaneo 요구사항 탭으로 옮기기 전까지 spec-check 가 읽는 사본이다. 문장은 KAN-19 와 같아야 한다.

| ID | 요구사항 | 검증 계층 |
|---|---|---|
| REQ-SPEC-TABS-1 | 탭 순서 개요·타임라인·요구사항·설계·태스크·지식·문서 | e2e |
| REQ-SPEC-TABS-2 | requirement set 저장(project, feature, title, body, status, approvedAt, actor) | api |
| REQ-SPEC-TABS-3 | requirement item 행(key, text, layer, status, updatedAt), 키 유일·재사용 없음 | api |
| REQ-SPEC-TABS-4 | 요구사항 승인: approved/approvedAt, decision entry, 사람만 | api, e2e |
| REQ-SPEC-TABS-5 | design doc 저장 + 항목 매핑 | api |
| REQ-SPEC-TABS-6 | 설계 승인 규칙 | api |
| REQ-SPEC-TABS-7 | task ↔ 항목·설계 매핑 | api |
| REQ-SPEC-TABS-8 | stale 조회 시 계산 + 원인 | api |
| REQ-SPEC-TABS-9 | 항목 수정 시 updatedAt + 이전 문장 entry | api |
| REQ-SPEC-TABS-10 | 재승인·확인으로 stale 해제 | api, e2e |
| REQ-SPEC-TABS-11 | 요구사항 탭 표 | e2e |
| REQ-SPEC-TABS-12 | 설계 탭 | e2e |
| REQ-SPEC-TABS-13 | task 카드·상세 배지 | e2e |
| REQ-SPEC-TABS-14 | MCP 도구 6개, put 은 draft, approved 덮으면 draft + entry | api |
| REQ-SPEC-TABS-15 | REST requirement-set, x-api-key | api |
| REQ-SPEC-TABS-16 | 키 형식·중복 400 | api |
| REQ-SPEC-TABS-17 | 문서 이관 시 원본 보존·참조 | api |
