# 운영과 벤치마크

## 실행 환경

로컬 설치·실행은 [README](../README.md), 변수는 [환경 설정](configuration.md)을 따릅니다. Dockerfile은 Node.js 24 기반 multistage 빌드이며 비루트 사용자로 `node dist/main`을 실행합니다. HTTP 포트는 기본 3000입니다.

메타 저장소 Compose 사용 시 다음을 구분합니다.

- 호스트에서 실행하는 백엔드의 DB·Redis 접속: 공개 포트 `127.0.0.1:10003`, `127.0.0.1:10004`
- Compose 내부 백엔드의 DB·Redis 접속: 서비스 이름 `database:3306`, `redis:6379`
- 호스트 브라우저에서의 백엔드 주소: `http://localhost:10001`
- 프록시 업스트림 연결에 사용하는 외부 Docker 네트워크: `gateway_shared_network`

Compose는 메타 저장소의 두 앱 `.env`를 읽습니다. 외부 네트워크와 DB 사용자·권한, 컨테이너 내부에서 도달할 수 있는 업스트림 주소를 먼저 준비합니다. `localhost`를 컨테이너 안의 다른 서비스 주소로 사용하지 않습니다. Compose의 예제 DB 인증정보는 운영 비밀값으로 사용하지 않습니다.

DB는 기본적으로 시작 시 migration을 실행합니다. 운영에서는 `DB_SYNCHRONIZE=false`를 유지하고 migration과 복구 순서를 배포 전에 확인합니다. SIGINT/SIGTERM 종료 시 DB·캐시 연결을 정리합니다.

## 상태와 지표

`GET /health`는 프로세스 응답 확인용입니다. 실제 DB·Redis·OAuth·업스트림 연결을 검사하지 않습니다. `GET /health/metrics`는 다음 필드를 제공합니다.

- `generatedAt`: 스냅샷 시각
- `proxy.total`, `proxy.inFlight`, `proxy.latencyMsAvg`
- `proxy.upstream2xx`, `proxy.upstream3xx`, `proxy.upstream4xx`, `proxy.upstream5xx`
- `proxy.gateway4xx`, `proxy.gateway5xx`, `proxy.timeouts`, `proxy.circuitOpenRejections`, `proxy.payloadTooLarge`
- `runtime.memoryRssBytes`, `runtime.heapUsedBytes`, `runtime.eventLoopLagMsAvg`

지표는 프로세스 메모리에 저장됩니다. 여러 인스턴스를 자동 합산한 값이나 영구 통계로 해석하지 않습니다. 현재 항목은 [gateway-metrics.service.ts](../src/modules/health/gateway-metrics.service.ts)를 참고하세요.

## 문제 확인

- 시작 실패: 라우트 맵 유효성, DB 연결·migration 권한, production JWT 기본값 여부
- 로그인 실패: 백엔드 OAuth 설정, 등록된 콜백 URI, 프론트 Origin 허용, OAuth state의 캐시 접근
- 프록시 401/404: API 키와 namespace 일치, 폐기 여부, version 매핑
- 429/503/타임아웃: IP별 요청 수, 업스트림 상태와 회로 차단기·시간 제한

에러·메트릭을 기록할 때 토큰·키 원문·비밀이 포함된 URL/query를 저장하지 않습니다.

## 프록시 벤치마크

```bash
BENCH_DURATION_SECONDS=20 BENCH_CONNECTIONS=100 BENCH_PAYLOAD_BYTES=1048576 npm run bench:proxy
```

현재 스트리밍 구현인 `optimized`와 벤치마크 내부의 버퍼링 구현인 `legacy`를 같은 조건에서 비교합니다. 출력은 처리량 `rps`, 지연 `p99Ms`, `errors`, `timeouts`, `rssDeltaMB`와 상대 개선율입니다.

- `BENCH_DURATION_SECONDS`: 기본 `10`
- `BENCH_CONNECTIONS`: 기본 `60`
- `BENCH_PAYLOAD_BYTES`: 기본 `262144`(256 KiB)
- `BENCH_ASSERT=1`: 처리량 개선 기준을 적용
- `BENCH_MIN_THROUGHPUT_GAIN_PERCENT`: assert 사용 시 최소 개선율, 기본 `5`

Node 버전·시간·연결 수·payload·실행 조건과 결과를 함께 기록합니다. 짧은 smoke나 한 번의 측정으로 운영 성능 향상을 확정하지 않습니다. 벤치마크는 운영 업스트림을 대상으로 하지 않습니다.
