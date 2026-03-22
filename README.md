![Status: WIP](https://img.shields.io/badge/status-WIP-yellow)

> **WARN:** This library is still under development. Please wait for minor version 1 before using it in production.
> **경고:** 아직 개발 중입니다. 프로덕션 사용 전 마이너 버전 1을 기다려주세요.

# hono-query-rpc

A utility library that brings [tRPC](https://trpc.io/)-like developer experience when using Hono RPC with [TanStack Query](https://tanstack.com/query).

Uses TanStack Query's `queryOptions` / `mutationOptions` pattern as-is.

```ts
const { data } = useQuery(
  api.users.$get.queryOptions({ query: { page: "1" } }),
);

const create = useMutation(
  api.users.$post.mutationOptions({ onSuccess: () => invalidate() }),
);
```

## Installation

```bash
# npm
npm install hono-query-rpc

# pnpm
pnpm add hono-query-rpc

# bun
bun add hono-query-rpc
```

**Peer dependencies**

```bash
bun add hono @tanstack/react-query react
```

## Quick Start

```ts
// lib/api.ts
import { hc } from "hono/client";
import { createHonoQuery } from "hono-query-rpc";
import type { AppType } from "@/server";

const client = hc<AppType>("/");

export const api = createHonoQuery(client);
```

```tsx
// components/UserList.tsx
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

function UserList() {
  const { data, isLoading } = useQuery(api.api.users.$get.queryOptions());

  if (isLoading) {
    return <p>Loading...</p>;
  }

  return (
    <ul>
      {data?.map((u) => (
        <li key={u.id}>{u.name}</li>
      ))}
    </ul>
  );
}
```

## API

### `.queryKey(input?)`

Returns the query key for manual cache operations.

```ts
queryClient.invalidateQueries({ queryKey: api.users.$get.queryKey() });
```

## Header Management

Headers are managed in two layers with the following priority:

### Factory level — applied to all requests

```ts
// Static
const api = createHonoQuery(client, {
  defaultHeaders: { "x-app-id": "my-app" },
});

// Dynamic (evaluated on every request)
const api = createHonoQuery(client, {
  defaultHeaders: () => ({
    authorization: `Bearer ${useAuthStore.getState().token}`,
  }),
});

// Async dynamic
const api = createHonoQuery(client, {
  defaultHeaders: async () => ({
    authorization: `Bearer ${await refreshTokenIfNeeded()}`,
  }),
});

// Auto idempotency key for mutation requests
const api = createHonoQuery(client, {
  autoIdempotency: true,
});
```

### Call level — applied to a specific request only

```ts
// queryOptions
useQuery(
  api.users.$get.queryOptions(input, {
    hono: { headers: { "x-trace-id": crypto.randomUUID() } },
  }),
);

// mutationOptions
useMutation(
  api.users.$post.mutationOptions({
    hono: { headers: { "x-custom": "value" } },
  }),
);
```

---

## Development

**Prerequisites**

- [Nix](https://nixos.org/download/) — reproducible dev environment
- [direnv](https://direnv.net/) — automatically activates the dev environment

```bash
# Install dependencies
bun install

# Build
bun run build

# Test
bun test

# Test (watch mode)
bun test --watch

# Type check
bun run typecheck
```

## License

MIT
