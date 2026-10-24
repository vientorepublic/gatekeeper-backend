# Gatekeeper Backend

네임스페이스별 업스트림 라우팅, FlowAuth 로그인, 내부 JWT 세션과 API 키 관리를 제공하는 NestJS API Gateway입니다. MariaDB에 사용자·키 정보를 저장하며 Redis 또는 메모리에서 캐시·프록시 상태를 관리합니다.

## 시작하기

아래 명령은 이 저장소 디렉터리에서 실행합니다. Node.js 24.22.1 이상인 24.x와 npm, 접속 가능한 MariaDB와 생성된 데이터베이스·사용자가 필요합니다. 로그인에는 FlowAuth 클라이언트 등록이 필요합니다.

```bash
npm ci
cp .env.example .env
```

기존 `.env`가 있으면 복사 대신 필요한 항목만 갱신합니다.

## 환경 설정

실행 전에 다음을 설정하세요. 전체 변수와 기본값은 [환경 설정 문서](docs/configuration.md)를 참고하세요.

- `DB_*`: MariaDB 접속 정보
- `JWT_HMAC_SECRET`: `openssl rand -base64 48` 등으로 생성한 비밀키
- `ROUTE_MAP` 또는 `ROUTE_MAP_URL`: 업스트림 라우팅 설정
- `OAUTH2_*`: FlowAuth 서버·클라이언트·콜백 정보
- `REDIS_URL`: 예제는 로컬 Redis를 사용합니다. 메모리 모드로 실행하려면 비웁니다.
- `CORS_ORIGINS`: 프론트엔드 Origin. 로컬 Vite 기본 주소는 `http://localhost:5173`입니다.

웹 콘솔과 함께 사용하려면 백엔드 `OAUTH2_REDIRECT_URI`와 FlowAuth에 등록한 URI를 프론트엔드 주소(예: `http://localhost:5173/`)로 맞춥니다. 예제 파일의 백엔드 콜백 URI는 웹 콘솔 로그인 흐름에 맞게 변경해야 합니다.

```bash
npm run start:dev
```

기본 주소는 `http://localhost:3000`입니다. 다른 터미널에서 `curl http://localhost:3000/health`로 HTTP 응답을 확인합니다. `/health`는 DB·Redis·업스트림을 검사하는 readiness 진단은 아닙니다. 기본 설정은 시작 시 미적용 migration을 실행하므로 대상 DB를 먼저 확인하세요.

## 주요 동작

- `/auth/...`: OAuth authorize/callback/session/refresh, namespace·API 키 관리
- `/api/{namespace}/{version}/...`: 라우트와 API 키를 검증한 뒤 업스트림으로 전달
- `/health`, `/health/metrics`: 프로세스 상태와 프록시 런타임 지표
- 프록시는 본문 크기·시간 제한, IP별 요청 제한, 회로 차단기를 적용합니다.

관리 API는 내부 JWT 또는 `x-api-key`로 인증합니다. 보호된 프록시는 `Authorization: Bearer <issued-api-key>`를 사용합니다. 내부 JWT를 프록시 API 키 대신 사용하지 않습니다. 세부 계약은 [API·인증 문서](docs/api.md)를 참고하세요.

## 코드 구조

```text
src/
  main.ts, app.module.ts       Bootstrap and module wiring
  config/                     Environment and route-map validation/loading
  modules/auth/               OAuth, JWT, users, API keys, DTOs
  modules/gateway/            Route registry, proxy, rate/circuit state
  modules/health/, modules/cron/  Metrics and scheduled collection
  database/, migrations/      MariaDB wiring and schema changes
  cache/, common/             Cache, filters, CORS, validation, shutdown
test/                         HTTP integration tests and proxy benchmark
```

## 검증

```bash
npm run lint
npx tsc --noEmit --incremental false
npm run build
npm test -- --runInBand
npm run test:e2e
```

`lint`는 자동 수정하므로 diff를 확인합니다. Jest 스크립트에는 NestJS 의존성을 위한 VM module 옵션이 포함되어 있습니다. 통합 테스트는 로컬 HTTP 업스트림과 mock 서비스를 사용하며 운영 MariaDB·Redis·FlowAuth 연결 검증을 대신하지 않습니다.

프록시 변경 시 `npm run bench:proxy`도 실행합니다. 조건·출력·성능 판정 기준은 [운영·벤치마크 문서](docs/operations.md)를 따릅니다.

## 빌드와 실행

```bash
npm run build
npm run start:prod
```

Dockerfile은 Node.js 24 기반으로 빌드하고 3000 포트에서 비루트 사용자로 실행합니다. `NODE_ENV=production`에서는 기본 JWT 비밀키 사용 시 시작이 거부됩니다. DB 자동 동기화는 끄고 migration으로 스키마를 관리하세요.

메타 저장소 Compose를 사용한다면 컨테이너 내부 DB/Redis 주소와 호스트 공개 포트를 구분해야 합니다. 배포 설정과 관측 항목은 [운영 문서](docs/operations.md)를 참고하세요.

## 상세 문서

- [환경 설정](docs/configuration.md): 변수, 기본값, DB·OAuth·CORS
- [라우팅 설정](docs/routing.md): 맵 형식, 경로 재작성, 공개 경로 규칙
- [API와 인증](docs/api.md): 엔드포인트, 입력·응답·인증 경계
- [운영과 벤치마크](docs/operations.md): 실행 환경, 지표, 장애 확인, 성능 검증
- [package.json](package.json), [.env.example](.env.example): 실제 스크립트·의존성과 설정 예제

메타 저장소 안에서는 상위 `AGENTS.md`, `docs/development-workflow.md`, `docs/github-release-workflow.md`, `agent_memories/README.md`를 먼저 읽습니다. 단독 clone에는 이 문서들이 포함되지 않습니다. 새 작업은 최신 dev에서 피처를 분기하며 GitHub 작업에는 gh CLI를 사용합니다. 버전·lockfile·병합·릴리즈 규칙은 상위 지침을 따릅니다.
