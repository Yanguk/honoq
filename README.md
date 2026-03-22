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

const create = useMutation(api.users.$post.mutationOptions());
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
  const { data, isLoading } = useQuery(
    api.api.users.$get.queryOptions(),
  );

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

### `createHonoQuery(client, options?)`

Creates a proxy client that wraps a Hono RPC client with TanStack Query integration.

| Option            | Type                                             | Default                                                         | Description                                                                                                                           |
| ----------------- | ------------------------------------------------ | --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `defaultHeaders`  | `HeadersFactory`                                 | `undefined`                                                     | Headers merged into every request. Accepts a static object, a `Headers` instance, an entry tuple array, or a (async) getter function. |
| `autoIdempotency` | `boolean`                                        | `true`                                                          | Automatically adds an `Idempotency-Key` header to mutation requests. The key is refreshed after each successful mutation.             |
| `parseResponse`   | `(res: Response) => unknown \| Promise<unknown>` | Throws `HTTPError` on `!res.ok`, otherwise returns `res.json()` | Customize how responses are parsed and errors are thrown.                                                                             |

### `.queryOptions(input, options?)`

Returns a TanStack Query `queryOptions` object. Pass `undefined` as `input` when the endpoint takes no parameters.

```ts
// With input
useQuery(api.api.users.$get.queryOptions({ query: { page: "1" } }));

// Without input
useQuery(api.api.users.$get.queryOptions());

// With TanStack Query options
useQuery(api.api.users.$get.queryOptions({}, { enabled: false }));

// With per-call hono headers
useQuery(
  api.api.users.$get.queryOptions({}, {
    hono: { headers: { "x-trace-id": crypto.randomUUID() } },
  }),
);
```

### `.mutationOptions(options?)`

Returns a TanStack Query `mutationOptions` object.

```ts
// Basic
useMutation(api.api.users.$post.mutationOptions());

// With TanStack Query callbacks
useMutation(
  api.api.users.$post.mutationOptions({
    onSuccess: () => queryClient.invalidateQueries(...),
    onError: (err) => console.error(err),
  }),
);

// With per-call hono headers
useMutation(
  api.api.users.$post.mutationOptions({
    hono: { headers: { "x-custom": "value" } },
  }),
);
```

### `.queryKey(input?)`

Returns the query key for manual cache operations.

```ts
queryClient.invalidateQueries({ queryKey: api.users.$get.queryKey() });
queryClient.invalidateQueries({
  queryKey: api.users.$get.queryKey({ query: { page: "1" } }),
});
```

## Header Management

Headers are managed in two layers with the following priority (call level overrides factory level):

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

// Auto idempotency key for mutation requests (default: true, disable with false)
const api = createHonoQuery(client, {
  autoIdempotency: false,
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

## Custom Response Parsing

The default behavior is equivalent to:

```ts
import { HTTPError } from "hono-query-rpc";

// default parseResponse
(res) => {
  if (!res.ok) {
    throw new HTTPError(res);
  }
  return res.json();
}
```

You can override this with `parseResponse`:

```ts
import { createHonoQuery } from "hono-query-rpc";

const api = createHonoQuery(client, {
  parseResponse: async (res) => {
    if (!res.ok) {
      const body = await res.json();
      throw new MyAppError(res.status, body.message);
    }
    return res.json();
  },
});
```

### `HTTPError`

The default error class thrown on non-OK responses.

```ts
import { HTTPError } from "hono-query-rpc";

// err.status    — HTTP status code (e.g. 404)
// err.statusText — HTTP status text (e.g. "Not Found")
// err.response  — original Response object
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
