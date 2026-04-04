# Gatekeeper API Gateway

NestJS 기반 API Gateway 서버입니다.

## 핵심 설계

- 게이트웨이 엔드포인트 규칙: `/{namespace}/{version}/...`
- 앞의 두 세그먼트를 기준으로 업스트림을 찾고, 이후 경로를 원본 REST API 서버로 리버스 프록시
- 인증 토큰: HMAC 서명 JWT (HS256)
- 사용자 식별 계층은 인터페이스 분리로 OAuth2 외부 프로바이더 연동을 고려한 구조
- 캐시가 필요한 경우 Redis 사용 (REDIS_URL 설정 시 Redis 스토어 사용)

## 환경 변수

`.env.example`를 참고하세요.

- `PORT`: 서버 포트 (기본 3000)
- `JWT_HMAC_SECRET`: HS256 검증용 비밀키
- `ROUTE_MAP`: 업스트림 매핑 JSON
- `REDIS_URL`: Redis 연결 주소 (미설정 시 메모리 캐시)
- `OAUTH2_ISSUER`, `OAUTH2_AUDIENCE`: 향후 OAuth2 연동용 예약 설정

예시 `ROUTE_MAP`:

```json
{
  "orders": {
    "v1": "http://localhost:4001",
    "v2": "http://localhost:4003"
  },
  "billing": {
    "v1": "http://localhost:4002"
  }
}
```

## 실행

```bash
npm install
npm run build
npm run start:dev
```

## 요청 예시

- 헬스체크: `GET /health`
- 프록시 요청: `GET /orders/v1/customers/42`

게이트웨이는 `/orders/v1`를 제거한 `/customers/42` 경로로 `orders:v1` 업스트림에 전달합니다.

## 인증 모킹 및 확장 포인트

- 현재는 `JwtAuthGuard`에서 HMAC JWT를 검증
- `IdentityService`가 JWT claims를 내부 사용자 정보로 변환
- 추후 OAuth2 프로바이더 연동 시 `IdentityService` 교체 또는 확장으로 대응 가능
