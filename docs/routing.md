# 라우팅 설정

요청 형식은 `/api/{namespace}/{version}/...`입니다. 아래 JSON을 `ROUTE_MAP`으로 설정하거나 `ROUTE_MAP_URL` 응답으로 제공합니다. 타겟은 HTTP(S) URL이어야 합니다. 로딩·우선순위는 [환경 설정](configuration.md)을 참고하세요.

## 권장 형식: 명시적인 versions

```json
{
  "orders": {
    "versions": {
      "v1": "http://orders-v1.internal",
      "v2": "http://orders-v2.internal"
    }
  }
}
```

`/api/orders/v1/items`는 `http://orders-v1.internal/items`로 전달됩니다. namespace와 version 접두사를 모두 제거합니다.

## 기존 형식과 경로 차이

문자열 타겟은 임의 version을 받고 version 접두사를 유지합니다.

```json
{
  "billing": "http://billing.internal"
}
```

`/api/billing/v1/invoices`는 `http://billing.internal/v1/invoices`로 전달됩니다.

기존 플랫 버전 맵도 지원하며 경로 처리는 명시적인 versions 형식과 같습니다.

```json
{
  "orders": {
    "v1": "http://orders-v1.internal",
    "v2": "http://orders-v2.internal"
  }
}
```

## 공개 경로

보호된 프록시는 namespace에 속한 API 키가 필요합니다. 명시적인 versions 형식에서 `public` 또는 `publicPaths`로 인증 예외를 지정합니다.

```json
{
  "catalog": {
    "versions": { "v1": "http://catalog.internal" },
    "publicPaths": [
      "/health",
      { "path": "/users/register", "methods": ["POST"] },
      { "path": "/docs/*" }
    ]
  }
}
```

- 문자열 경로와 `path`만 있는 객체는 모든 HTTP 메서드에 적용됩니다.
- `methods`를 지정하면 비어 있지 않은 문자열 배열이어야 합니다. 빈 배열·혼합 타입은 시작 오류입니다. 메서드의 대소문자는 구분하지 않습니다.
- `path`는 namespace/version을 제거한 뒤의 경로입니다. `/health`는 `/api/catalog/v1/health`에 대응합니다.
- `/docs/*`는 `/docs`, `/docs/`, 그 아래 경로에 모두 대응합니다.
- `public: true`는 해당 namespace의 모든 경로·메서드에서 API 키 검증을 생략하며 `publicPaths`보다 우선합니다. 의도한 공개 범위인지 먼저 확인합니다.
- 공개 경로에도 프록시 IP 요청 제한·본문 크기·타임아웃 제한이 적용됩니다.

경로의 dot traversal·잘못된 percent escape·backslash 등은 공개 규칙 일치 검사 전에 거부됩니다. 매칭 구현은 [gateway-route.utils.ts](../src/common/utils/gateway-route.utils.ts), 설정 검증은 [route-map.config.ts](../src/config/route-map.config.ts)를 기준으로 합니다.
