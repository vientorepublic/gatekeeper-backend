# Gatekeeper API Gateway

Gatekeeper 백엔드(NestJS) 저장소입니다.

프로젝트 전반 소개와 멀티 리포지토리 구조는 루트 README를 참고하세요.

## 핵심 설계

- 게이트웨이 프록시 엔드포인트 규칙: `/api/{namespace}/{version}/...`
- 게이트웨이 자체 엔드포인트(`/health`, `/auth/...`)와 프록시 엔드포인트를 경로 레벨에서 명시적으로 분리
- 업스트림 포워딩은 `namespace`, `version`, `*path` 라우트 파라미터를 기준으로 수행
- 인증: FlowAuth OAuth2 Authorization Code Grant + 내부 JWT + API Key
- 사용자/API Key 저장: TypeORM + MariaDB
- 캐시가 필요한 경우 Redis 사용 (REDIS_URL 설정 시 Redis 스토어 사용)
- 전역 요청 검증: ValidationPipe(`transform`, `whitelist`, `forbidNonWhitelisted`) 적용

## 환경 변수

`.env.example`를 참고하세요.

- `PORT`: 서버 포트 (기본 3000)
- `JWT_HMAC_SECRET`: 내부 JWT 서명 비밀키
- `JWT_EXPIRES_IN_SECONDS`: 내부 JWT 만료(초)
- `MAX_PROXY_REQUEST_BODY_BYTES`: 프록시 요청 본문 최대 크기(바이트, 기본 `1048576`)
- `PROXY_TIMEOUT_MS`: 업스트림 프록시 타임아웃(밀리초, 기본 `15000`)
- `PROXY_CIRCUIT_BREAKER_FAILURE_THRESHOLD`: 회로 차단기 연속 실패 임계값(기본 `3`)
- `PROXY_CIRCUIT_BREAKER_COOLDOWN_MS`: 회로 차단기 재시도 대기 시간(밀리초, 기본 `10000`)
- `DB_HOST`: MariaDB 호스트
- `DB_PORT`: MariaDB 포트
- `DB_USERNAME`: MariaDB 사용자명
- `DB_PASSWORD`: MariaDB 비밀번호
- `DB_NAME`: MariaDB 데이터베이스명
- `DB_CHARSET`: MariaDB 문자셋 (기본 `utf8mb4`)
- `DB_SYNCHRONIZE`: TypeORM 스키마 자동 동기화 여부 (기본 `false` 권장)
- `DB_MIGRATIONS_RUN`: 서버 시작 시 미적용 마이그레이션 자동 실행 여부 (기본 `true`)
- `DB_LOGGING`: SQL 로깅 여부
- `ROUTE_MAP`: 업스트림 매핑 JSON (`/api/{namespace}/{version}`에 매핑)
- `REDIS_URL`: Redis 연결 주소 (미설정 시 메모리 캐시)
- `CORS_ORIGINS`: 허용할 브라우저 오리진 목록 (콤마 구분)
- `OAUTH2_SERVER`: FlowAuth 서버 URL
- `OAUTH2_CLIENT_ID`: OAuth2 클라이언트 ID
- `OAUTH2_CLIENT_SECRET`: OAuth2 클라이언트 시크릿
- `OAUTH2_REDIRECT_URI`: 인증 콜백 URI
- `OAUTH2_SCOPES`: 요청 스코프 목록 (콤마 구분)
- `OAUTH2_ISSUER`, `OAUTH2_AUDIENCE`: 업스트림 전달용 힌트 값

## 입력 검증 및 에러 응답

- 모든 HTTP 요청은 전역 ValidationPipe로 검증됩니다.
- DTO에 정의되지 않은 필드는 `400 Bad Request`로 거부됩니다.
- 주요 인증/세션 입력(`code`, `state`, `accessToken`, `refreshToken`, `label`)은 공백 제거 후 길이/필수 조건을 검증합니다.
- API Key 폐기 엔드포인트의 `:id`는 UUID v4 형식이어야 하며, 형식이 잘못되면 `400 Bad Request`를 반환합니다.
- 게이트웨이 프록시 본문이 `MAX_PROXY_REQUEST_BODY_BYTES`를 초과하면 `413 Payload Too Large`를 반환합니다.
- 업스트림 호출 실패는 `502 Bad Gateway`가 반환됩니다.
- 업스트림 타임아웃은 `502 Bad Gateway` + `errorCode: "UPSTREAM_TIMEOUT"`으로 반환됩니다.
- 동일 업스트림이 연속 실패 임계값을 넘기면 회로 차단기가 열리고, 냉각 시간 동안 `503 Service Unavailable`을 반환합니다.

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

- 버전 맵을 정의한 경우: `/api/{namespace}/{version}/...`에서 `/{namespace}/{version}`가 제거되어 전달됩니다.
- 버전을 생략한 경우(문자열 대상): `/api/{namespace}/{version}/...`에서 `/{namespace}`만 제거되어 `/{version}/...` 경로가 업스트림으로 전달됩니다.

## 실행

```bash
npm install
npm run build
npm run start:dev
```

## 테스트

```bash
# unit tests
npm test

# e2e tests
npm run test:e2e

# proxy benchmark (optimized vs legacy)
npm run bench:proxy
```

e2e 테스트는 아래 시나리오를 포함합니다.

- 프록시 경로 재작성(`version map`, `direct namespace target`) 검증
- 인증 실패(헤더 누락/빈 Bearer) 검증
- 미존재 라우트 매핑(404), 업스트림 장애(502), 본문 크기 초과(413) 검증
- 업스트림 타임아웃(502 + `UPSTREAM_TIMEOUT`), 회로 차단기 오픈(503), `/health/metrics` 응답 검증
- Auth 입력 DTO 검증(필수값, 미정의 필드 차단, 길이 제한, UUID 파라미터 검증)

## 운영 관측

- 헬스체크: `GET /health`
- 게이트웨이 런타임 매트릭: `GET /health/metrics`

`/health/metrics`는 아래 정보를 제공합니다.

- `proxy.total`, `proxy.inFlight`, `proxy.latencyMsAvg`
- `proxy.upstream2xx/3xx/4xx/5xx`
- `proxy.gateway4xx/5xx`
- `proxy.timeouts`, `proxy.circuitOpenRejections`, `proxy.payloadTooLarge`
- `runtime.memoryRssBytes`, `runtime.heapUsedBytes`, `runtime.eventLoopLagMsAvg`

예시:

```json
{
  "generatedAt": "2026-04-07T10:10:00.000Z",
  "uptimeSeconds": 123,
  "proxy": {
    "total": 4123,
    "upstream2xx": 3900,
    "upstream3xx": 10,
    "upstream4xx": 120,
    "upstream5xx": 50,
    "gateway4xx": 30,
    "gateway5xx": 13,
    "timeouts": 8,
    "circuitOpenRejections": 2,
    "payloadTooLarge": 4,
    "inFlight": 3,
    "latencyMsAvg": 6.7
  },
  "runtime": {
    "memoryRssBytes": 183025664,
    "heapUsedBytes": 69513216,
    "eventLoopLagMsAvg": 1.2
  }
}
```

## 프록시 벤치마크

`npm run bench:proxy`는 동일 조건에서 아래 두 구현을 비교합니다.

- `optimized`: 현재 스트리밍 기반 프록시 미들웨어
- `legacy`: 이전 버퍼링 기반(요청/응답 전체 메모리 적재) 동작을 벤치마크 내부에서 재현한 미들웨어

출력 항목:

- `rps`(throughput), `p99Ms`(지연), `errors`, `timeouts`, `rssDeltaMB`
- 시나리오별 `throughput gain`, `p99 latency reduction`

벤치마크 제어용 환경변수:

- `BENCH_DURATION_SECONDS` (기본 `10`)
- `BENCH_CONNECTIONS` (기본 `60`)
- `BENCH_PAYLOAD_BYTES` (기본 `262144` = 256KB)
- `BENCH_ASSERT` (`1`로 설정 시 최소 성능 향상 기준 미달이면 실패)
- `BENCH_MIN_THROUGHPUT_GAIN_PERCENT` (`BENCH_ASSERT=1`일 때 사용, 기본 `5`)

권장 실행 예시:

```bash
BENCH_DURATION_SECONDS=20 \
BENCH_CONNECTIONS=100 \
BENCH_PAYLOAD_BYTES=1048576 \
npm run bench:proxy
```

## 요청 예시

- 헬스체크: `GET /health`
- 런타임 매트릭: `GET /health/metrics`
- 프록시 요청: `GET /api/{namespace}/{version}/...`
- OAuth2 인증 시작: `GET /auth/oauth2/authorize`
- OAuth2 콜백 처리: `GET /auth/oauth2/callback?code=...&state=...`
- OAuth2 Access Token으로 세션 생성: `POST /auth/oauth2/session`
- 관리 가능한 namespace 조회: `GET /auth/namespaces`
- API Key 조회(인증 필요): `GET /auth/api-keys/:namespace`
- API Key 발급(인증 필요): `POST /auth/api-keys/:namespace`
- API Key 폐기(인증 필요): `DELETE /auth/api-keys/:namespace/:id`

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
