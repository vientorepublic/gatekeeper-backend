# 환경 설정

[README](../README.md)에서 설치·실행 순서를 확인하세요. [.env.example](../.env.example)을 출발점으로 설정하고 실제 기본값은 [gateway.config.ts](../src/config/gateway.config.ts)를 기준으로 합니다. 예제 값과 미설정 시 기본값은 다를 수 있습니다. 비밀값은 Git에 저장하지 않습니다.

## 서버·데이터베이스

- `PORT`: HTTP 포트, 기본 `3000`
- `JWT_HMAC_SECRET`: 내부 JWT 서명키. 강한 랜덤 값으로 설정합니다. 기본값은 개발용이며 production에서는 시작이 거부됩니다.
- `JWT_EXPIRES_IN_SECONDS`: 내부 JWT 만료 시간(초), 기본 `3600`
- `DB_HOST`, `DB_PORT`: 기본 `127.0.0.1`, `3306`
- `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`: 기본 `gatekeeper`, 빈 비밀번호, `gatekeeper`
- `DB_CHARSET`: 기본 `utf8mb4`
- `DB_SYNCHRONIZE`: 기본 `false`. 운영에서 자동 스키마 동기화를 활성화하지 않습니다.
- `DB_MIGRATIONS_RUN`: 기본 `true`. 시작 시 미적용 migration을 실행합니다.
- `DB_LOGGING`: 기본 `false`

새 migration은 [database.module.ts](../src/database/database.module.ts)의 목록에 등록합니다. 이미 적용된 migration을 수정하지 않습니다.

## 라우팅·프록시

- `ROUTE_MAP`: 업스트림 매핑 JSON 문자열
- `ROUTE_MAP_URL`: 시작 시 라우트 맵 JSON을 가져올 HTTP(S) 주소
- `MAX_PROXY_REQUEST_BODY_BYTES`: 최대 본문 크기(바이트), 기본 `1048576`
- `PROXY_TIMEOUT_MS`: 업스트림 타임아웃(ms), 기본 `15000`
- `PROXY_CIRCUIT_BREAKER_FAILURE_THRESHOLD`: 연속 실패 임계값, 기본 `3`
- `PROXY_CIRCUIT_BREAKER_COOLDOWN_MS`: 회로 차단 후 대기 시간(ms), 기본 `10000`
- `RATE_LIMIT_WINDOW_MS`: 프록시 IP별 요청 집계 구간(ms), 기본 `60000`
- `RATE_LIMIT_MAX_REQUESTS`: 해당 구간의 최대 프록시 요청 수, 기본 `100`

`ROUTE_MAP`이 있으면 `ROUTE_MAP_URL`보다 우선합니다. 둘 다 없거나 JSON/타겟 URL/공개 규칙이 잘못되면 시작이 실패합니다. 원격 맵은 시작 시 한 번 읽으며 fetch 제한은 15초입니다. HTTP 오류·연결 실패는 시작 실패로 처리하고, JSON Content-Type이 아니면 경고 후 파싱을 시도합니다. 형식은 [라우팅 문서](routing.md)를 참고하세요.

프록시 수치 제한에는 양의 유한값을 사용합니다. 위 프록시 IP 제한과 별도로 controller에는 전역 Throttler가 적용됩니다(현재 60초/30회, health 제외). `RATE_LIMIT_*`는 controller 제한을 바꾸지 않습니다.

## 캐시

- `REDIS_URL`: Redis 연결 주소. 비우면 메모리 저장소를 사용합니다.

메모리 모드의 캐시·OAuth state·요청 카운터·회로 상태는 프로세스별로 분리되고 재시작 시 사라집니다. 여러 인스턴스에서 상태를 공유해야 한다면 동일 Redis를 사용합니다.

## OAuth와 브라우저 연결

- `OAUTH2_SERVER`: FlowAuth 서버 URL
- `OAUTH2_CLIENT_ID`, `OAUTH2_CLIENT_SECRET`: 등록된 클라이언트 정보
- `OAUTH2_REDIRECT_URI`: FlowAuth에 등록한 정확한 콜백 URI
- `OAUTH2_SCOPES`: 쉼표로 구분한 scope. 미설정 기본값은 `openid,profile`이며 예제는 email도 포함합니다.
- `OAUTH2_ISSUER`: 업스트림 `x-oauth2-issuer-hint` 헤더 값
- `OAUTH2_AUDIENCE`: 설정 항목은 남아 있지만 현재 프록시는 이 값을 헤더로 전달하지 않습니다. 내부 JWT audience는 `gatekeeper`로 고정되어 있습니다.
- `CORS_ORIGINS`: 브라우저 관리 요청에 허용할 Origin 목록. 쉼표 구분, 기본 `http://localhost:5173`

웹 콘솔과 함께 사용하면 `OAUTH2_REDIRECT_URI`를 프론트엔드의 `/` 주소로 설정합니다. 브라우저가 code/state를 받아 백엔드 callback API에 전달하고 토큰 교환은 백엔드에서 수행합니다. 클라이언트 시크릿을 프론트엔드 `PUBLIC_*` 변수로 옮기지 않습니다.

`/api/` 프록시 CORS는 모든 Origin을 허용합니다. 등록된 Origin에는 credentials를 허용하고, 나머지는 wildcard를 사용합니다. `/auth/...`와 `/health...` 등 나머지 경로의 브라우저 CORS는 목록에 있는 Origin만 허용합니다. CORS 허용이 인증을 생략한다는 의미는 아닙니다.
