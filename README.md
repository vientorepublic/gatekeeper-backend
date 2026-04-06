# Gatekeeper API Gateway

NestJS 기반 API Gateway 서버입니다.

## 핵심 설계

- 게이트웨이 프록시 엔드포인트 규칙: `/gateway/{namespace}/{version}/...`
- 게이트웨이 자체 엔드포인트(`/health`, `/auth/...`)와 프록시 엔드포인트를 경로 레벨에서 명시적으로 분리
- 업스트림 포워딩은 `namespace`, `version`, `*path` 라우트 파라미터를 기준으로 수행
- 인증: FlowAuth OAuth2 Authorization Code Grant + 내부 JWT + API Key
- 사용자/API Key 저장: TypeORM + MariaDB
- 캐시가 필요한 경우 Redis 사용 (REDIS_URL 설정 시 Redis 스토어 사용)

## 환경 변수

`.env.example`를 참고하세요.

- `PORT`: 서버 포트 (기본 3000)
- `JWT_HMAC_SECRET`: 내부 JWT 서명 비밀키
- `JWT_EXPIRES_IN_SECONDS`: 내부 JWT 만료(초)
- `DB_HOST`: MariaDB 호스트
- `DB_PORT`: MariaDB 포트
- `DB_USERNAME`: MariaDB 사용자명
- `DB_PASSWORD`: MariaDB 비밀번호
- `DB_NAME`: MariaDB 데이터베이스명
- `DB_CHARSET`: MariaDB 문자셋 (기본 `utf8mb4`)
- `DB_SYNCHRONIZE`: TypeORM 스키마 자동 동기화 여부
- `DB_LOGGING`: SQL 로깅 여부
- `ROUTE_MAP`: 업스트림 매핑 JSON (`/gateway/{namespace}/{version}`에 매핑)
- `REDIS_URL`: Redis 연결 주소 (미설정 시 메모리 캐시)
- `OAUTH2_SERVER`: FlowAuth 서버 URL
- `OAUTH2_CLIENT_ID`: OAuth2 클라이언트 ID
- `OAUTH2_CLIENT_SECRET`: OAuth2 클라이언트 시크릿
- `OAUTH2_REDIRECT_URI`: 인증 콜백 URI
- `OAUTH2_SCOPES`: 요청 스코프 목록 (콤마 구분)
- `OAUTH2_ISSUER`, `OAUTH2_AUDIENCE`: 업스트림 전달용 힌트 값

## JWT_HMAC_SECRET 생성 가이드

운영 환경에서는 예측 가능한 문자열 대신 충분히 긴 랜덤 키를 사용하세요.

OpenSSL 사용:

```bash
openssl rand -base64 48
```

Node.js 사용:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"
```

생성한 값을 `.env`의 `JWT_HMAC_SECRET`에 설정합니다.

예시 `ROUTE_MAP`:

```json
{
  "orders": {
    "v1": "http://localhost:4001",
    "v2": "http://localhost:4003"
  },
  "billing": "http://localhost:4002"
}
```

- 버전 맵을 정의한 경우: `/gateway/{namespace}/{version}/...`에서 `/{namespace}/{version}`가 제거되어 전달됩니다.
- 버전을 생략한 경우(문자열 대상): `/gateway/{namespace}/{version}/...`에서 `/{namespace}`만 제거되어 `/{version}/...` 경로가 업스트림으로 전달됩니다.

## 실행

```bash
npm install
npm run build
npm run start:dev
```

## 요청 예시

- 헬스체크: `GET /health`
- 프록시 요청: `GET /gateway/orders/v1/customers/42`
- OAuth2 인증 시작: `GET /auth/oauth2/authorize`
- OAuth2 콜백 처리: `GET /auth/oauth2/callback?code=...&state=...`
- API Key 조회(인증 필요): `GET /auth/api-keys/:namespace`
- API Key 발급(인증 필요): `POST /auth/api-keys/:namespace`
- API Key 폐기(인증 필요): `DELETE /auth/api-keys/:namespace/:id`

게이트웨이는 `/gateway/orders/v1`를 제거한 `/customers/42` 경로로 `orders:v1` 업스트림에 전달합니다.

## 인증 흐름

1. `GET /auth/oauth2/authorize`로 FlowAuth 인증 URL 발급
2. 사용자 인증 후 콜백에서 `code`, `state` 수신
3. SDK가 Authorization Code를 Access Token으로 교환하고 사용자 정보를 조회
4. 로컬 DB(`users`)에 사용자가 없으면 생성, 있으면 갱신
5. 내부 Gateway JWT를 발급하여 클라이언트에 반환

Gateway 보호 엔드포인트는 아래 인증 중 하나를 허용합니다.

- `Authorization: Bearer <gateway-jwt>`
- `x-api-key: <issued-api-key>`

API 키는 `ROUTE_MAP`에 정의된 namespace 단위로 분리되어 저장/검증됩니다.
