# API와 인증

서버 기본 주소는 `http://localhost:3000`입니다. 실제 요청·응답 필드는 [auth.dto.ts](../src/modules/auth/dto/auth.dto.ts)와 [auth.controller.ts](../src/modules/auth/auth.controller.ts)를 기준으로 합니다.

## OAuth 세션

1. `GET /auth/oauth2/authorize`: `{ authorizeUrl, state }`를 반환합니다.
2. 브라우저에서 authorizeUrl로 이동해 로그인합니다. 등록된 콜백 URI로 code/state가 돌아옵니다.
3. `GET /auth/oauth2/callback?code=...&state=...`: 백엔드가 state/PKCE를 확인하고 FlowAuth 토큰을 교환하며 사용자를 생성·갱신합니다. 내부 JWT인 `accessToken`, FlowAuth `refreshToken`, `oauthAccessTokenExpiresIn`, `tokenType`, `user`를 반환합니다.
4. `POST /auth/oauth2/refresh`: `{ "refreshToken": "<oauth-refresh-token>" }`로 갱신합니다. 응답 형식은 callback과 같습니다.

`POST /auth/oauth2/session`은 이미 보유한 OAuth access token을 `{ "accessToken": "<oauth-access-token>" }`으로 받아 내부 JWT와 사용자를 반환하는 별도 경로입니다. 현재 웹 콘솔의 기본 로그인은 authorize/callback을 사용합니다. 전달한 `scope`로 내부 JWT 권한을 임의 확장할 수 없습니다.

## 관리 API

다음 엔드포인트는 `Authorization: Bearer <gateway-jwt>` 또는 `x-api-key: <issued-api-key>`로 인증합니다. API 키 인증에서는 해당하는 namespace와 소유자 검증이 적용됩니다.

- `GET /auth/namespaces`: 라우트 맵에 설정된 namespace 목록
- `GET /auth/route-map`: namespace별 버전 안내. 업스트림 주소는 응답에 포함하지 않습니다.
- `GET /auth/api-keys/:namespace?page=1&pageSize=20`: 소유한 키 목록. `page >= 1`, `1 <= pageSize <= 100`, 기본값은 1/20입니다.
- `POST /auth/api-keys/:namespace`: `{ "label": "local-client" }`로 발급. label은 선택 사항이며 최대 128자입니다.
- `DELETE /auth/api-keys/:namespace/:id`: UUID v4인 키 ID로 폐기. `{ "revoked": true }` 여부를 확인합니다.

목록은 `items`, `page`, `pageSize`, `total`, `totalPages`, `hasNext`, `hasPrevious`를 반환합니다. 발급 응답의 `apiKey` 원문은 발급 시에만 제공되며 이후 목록에서는 복원할 수 없습니다.

## 업스트림 프록시

보호된 프록시 요청에는 **발급된 API 키를 Bearer로** 전달합니다. 관리용 내부 JWT 또는 `x-api-key` 헤더로 대체하지 않습니다.

```bash
curl http://localhost:3000/api/orders/v1/items -H 'Authorization: Bearer <issued-api-key>' -H 'Accept: application/json'
```

키는 요청 namespace와 일치해야 하고 폐기된 키는 사용할 수 없습니다. 공개 예외와 경로 재작성은 [라우팅 문서](routing.md)를 참고하세요. GET/HEAD 요청에는 본문을 전달하지 않습니다. 게이트웨이에서 인증한 Authorization·API 키·Cookie 헤더는 업스트림으로 전달하지 않습니다.

## 검증과 오류

관리 API의 DTO 입력은 변환·whitelist 검증을 거치며 정의되지 않은 필드를 거부합니다. 프록시는 업스트림의 임의 본문을 관리 DTO로 검증하지 않고 크기·경로·인증 등 프록시 제한을 적용합니다.

- 잘못된 DTO·UUID: `400`
- 누락·잘못된 인증: `401`
- 없는 namespace/version 매핑: `404`
- 요청 본문 제한 초과: `413`
- 요청 빈도 제한: `429`
- 회로 차단 중: `503`
- 업스트림 연결 실패·타임아웃: `500`, 타임아웃은 `errorCode: "UPSTREAM_TIMEOUT"`

게이트웨이 자체 오류는 `application/problem+json` 형식을 사용합니다. 업스트림이 직접 반환한 HTTP 응답과 게이트웨이 전송 실패를 구분하세요. 소유권·namespace별 세부 결과는 service와 통합 테스트를 함께 확인합니다.

## 상태 확인

- `GET /health`: `{ "status": "ok" }`. 별도 인증 없이 제공되는 프로세스 응답입니다.
- `GET /health/metrics`: 프록시·메모리·이벤트 루프 지표. 상세 내용은 [운영 문서](operations.md)를 참고하세요.
