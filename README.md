> WARN: in development, 아직 개발중이니 사용하지 마세요

# honoq

Hono RPC를 [TanStack Query](https://tanstack.com/query)와 함께 사용할 때 [tRPC](https://trpc.io/)와 동일한 개발 경험을 제공하는 유틸리티 라이브러리입니다.

```ts
// tRPC 스타일 그대로
const { data } = rpc.api.users.$get.useQuery({ query: { page: '1' } })
const create   = rpc.api.users.$post.useMutation({ onSuccess: () => invalidate() })
```

## 설치

```bash
# npm
npm install honoq

# pnpm
pnpm add honoq

# bun
bun add honoq
```

**peer dependencies**

```bash
bun add hono @tanstack/react-query react
```

## 빠른 시작

```ts
// lib/rpc.ts
import { hc } from 'hono/client'
import { createHonoQuery } from 'honoq'
import type { AppType } from '@/server'   // Hono 앱 타입

const client = hc<AppType>('/')

export const rpc = createHonoQuery(client)
```

```tsx
// components/UserList.tsx
import { rpc } from '@/lib/rpc'

function UserList() {
  const { data, isLoading } = rpc.api.users.$get.useQuery(undefined)

  if (isLoading) return <p>Loading...</p>
  return <ul>{data?.map(u => <li key={u.id}>{u.name}</li>)}</ul>
}
```

## API

### `createHonoQuery(client, options?)`

Hono RPC 클라이언트를 tRPC 스타일 React Query 클라이언트로 감쌉니다.

```ts
const rpc = createHonoQuery(client, {
  // 모든 요청에 자동으로 병합되는 기본 헤더
  // 정적 객체, 동기/비동기 getter 모두 지원
  headers: () => ({
    authorization: `Bearer ${useAuthStore.getState().token}`,
  }),
})
```

---

### GET 엔드포인트 — `QueryNode`

#### `.useQuery(input, options?)`

```ts
const { data, isLoading, isError } = rpc.api.users.$get.useQuery(
  { query: { page: '1' } },    // Hono RPC input
  {
    headers: { 'x-trace-id': crypto.randomUUID() },  // 호출 레벨 헤더
    staleTime: 1000 * 60 * 5,                        // TanStack Query 옵션
    enabled: isLoggedIn,
  },
)
```

#### `.queryOptions(input, options?)`

라우터 loader나 `ensureQueryData` 등 React 외부에서 사용합니다.

```ts
// TanStack Router beforeLoad
const authGuard = async () => {
  const user = await queryClient.ensureQueryData(
    rpc.api.me.$get.queryOptions(undefined)
  )
}

// prefetch
await queryClient.prefetchQuery(
  rpc.api.users.$get.queryOptions({ query: { page: '1' } })
)
```

#### `.queryKey(input?)`

직접 캐시를 조작할 때 사용합니다.

```ts
queryClient.invalidateQueries({ queryKey: rpc.api.users.$get.queryKey() })
```

#### `.useInvalidate()`

컴포넌트 내에서 캐시 무효화 함수를 반환하는 훅입니다.

```ts
const invalidate = rpc.api.users.$get.useInvalidate()

const create = rpc.api.users.$post.useMutation({
  onSuccess: () => invalidate(),
})
```

---

### POST / PUT / PATCH / DELETE 엔드포인트 — `MutationNode`

#### `.useMutation(options?)`

```ts
const { mutate, isPending } = rpc.api.users.$post.useMutation({
  headers: { 'Idempotency-Key': 'custom-key' },  // 호출 레벨 헤더 (선택)
  onSuccess: (data) => {
    queryClient.invalidateQueries({ queryKey: rpc.api.users.$get.queryKey() })
  },
  onError: (error) => {
    console.error(error.message)
  },
})

mutate({ json: { name: 'Alice' } })
```

---

## 헤더 관리

헤더는 세 레이어로 관리되며 우선순위는 아래와 같습니다.

```
팩토리 헤더 < Idempotency-Key (자동) < 호출 레벨 헤더
```

### 팩토리 레벨 — 모든 요청에 기본 헤더 적용

```ts
// 정적
const rpc = createHonoQuery(client, {
  headers: { 'x-app-id': 'my-app' },
})

// 동적 (매 요청마다 평가)
const rpc = createHonoQuery(client, {
  headers: () => ({
    authorization: `Bearer ${useAuthStore.getState().token}`,
  }),
})

// 비동기 동적
const rpc = createHonoQuery(client, {
  headers: async () => ({
    authorization: `Bearer ${await refreshTokenIfNeeded()}`,
  }),
})
```

### 호출 레벨 — 특정 요청에만 추가 헤더 적용

```ts
// useQuery
rpc.api.users.$get.useQuery(input, {
  headers: { 'x-trace-id': crypto.randomUUID() },
})

// useMutation
rpc.api.users.$post.useMutation({
  headers: { 'x-custom': 'value' },
})

// queryOptions (loader)
rpc.api.users.$get.queryOptions(input, {
  headers: { 'x-ssr': 'true' },
})
```

---

## Idempotency-Key 자동 관리

**mutation 전용** 기능으로, 각 `useMutation` 선언부마다 독립적인 UUID를 자동 발급하고 관리합니다.

```ts
// ComponentA — 자체 idempotency key 보유
const mutationA = rpc.api.orders.$post.useMutation()

// ComponentB — 위와 독립된 key 보유 (같은 엔드포인트라도)
const mutationB = rpc.api.orders.$post.useMutation()
```

| 상황 | 동작 |
|---|---|
| mutation 요청 시 | 현재 key를 `Idempotency-Key` 헤더에 자동 삽입 |
| `onSuccess` 후 | 새 UUID로 자동 갱신 (다음 요청은 새 요청으로 처리) |
| `onError` 후 | key 유지 (재시도 시 서버가 동일 요청으로 처리 가능) |
| 호출 레벨에서 직접 지정 | 자동 생성 key 대신 지정한 값 사용 |

> `$get` 등 query에는 삽입되지 않습니다.

---

## TanStack Router 통합 예시

```ts
// router.ts
import { createHonoQuery } from 'honoq'
import { hc } from 'hono/client'
import { redirect } from '@tanstack/react-router'
import type { AppType } from '@/server'

const client = hc<AppType>('/')
export const rpc = createHonoQuery(client, {
  headers: () => ({ authorization: `Bearer ${getToken()}` }),
})

// 인증 가드
export const authGuard = async () => {
  try {
    await queryClient.ensureQueryData(rpc.api.me.$get.queryOptions(undefined))
  } catch {
    throw redirect({ to: '/login' })
  }
}
```

---

## 세션 인증(쿠키) 환경

쿠키 기반 세션 인증을 사용하는 경우 Hono RPC 클라이언트 생성 시 `credentials: 'include'`를 설정하세요.

```ts
const client = hc<AppType>('/', {
  fetch: (input, init) =>
    fetch(input, { ...init, credentials: 'include' }),
})

export const rpc = createHonoQuery(client)
```

---

## 타입 추론

`createHonoQuery`는 Hono 클라이언트 타입을 완전히 추론합니다. 별도의 타입 선언 없이 자동완성과 타입 체크가 동작합니다.

```ts
// input 타입 자동 추론
rpc.api.users.$get.useQuery({ query: { page: '1' } })

// data 타입 자동 추론
const { data } = rpc.api.users.$get.useQuery(undefined)
//       ^? typeof data === InferredResponseType | undefined
```

---

## 개발

```bash
# 의존성 설치
bun install

# 빌드
bun run build

# 테스트
bun run test

# 테스트 (watch 모드)
bun run test:watch

# 타입 체크
bun run typecheck
```

## 라이선스

MIT
