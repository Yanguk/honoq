/**
 * hono-query.ts
 *
 * Hono RPC + TanStack Query 통합 유틸리티
 * tRPC의 React Query 인터페이스와 동일한 DX를 제공합니다.
 *
 * 사용 예시:
 *   import { hc } from 'hono/client'
 *   import type { AppType } from '@/server'
 *   import { createHonoQuery } from '@/lib/hono-query'
 *
 *   const client = hc<AppType>('/')
 *
 *   // 팩토리 레벨 기본 헤더 (동적 getter 지원)
 *   export const rpc = createHonoQuery(client, {
 *     headers: () => ({ authorization: `Bearer ${useAuthStore.getState().token}` }),
 *   })
 *
 *   // 컴포넌트 내부
 *   const { data } = rpc.api.users.$get.useQuery(
 *     { query: { page: '1' } },
 *     { headers: { 'x-custom': 'value' } },   // 호출 레벨 헤더
 *   )
 *   const mutation = rpc.api.users.$post.useMutation()
 *
 *   // 라우터 loader (React 외부)
 *   await queryClient.prefetchQuery(
 *     rpc.api.users.$get.queryOptions({ query: { page: '1' } }, { headers: { ... } })
 *   )
 */

import {
  useQuery,
  useMutation,
  useQueryClient,
  queryOptions as tsQueryOptions,
  type UseQueryOptions,
  type UseMutationOptions,
  type UseQueryResult,
  type UseMutationResult,
  type QueryKey,
} from '@tanstack/react-query'
import { useRef } from 'react'

// ---------------------------------------------------------------------------
// 내부 타입 헬퍼
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyFn = (...args: any[]) => any

type InferOutput<TFn extends AnyFn> =
  Awaited<ReturnType<TFn>> extends { json(): Promise<infer R> } ? R : never

type InferInput<TFn extends AnyFn> =
  Parameters<TFn>[0] extends undefined ? undefined : Parameters<TFn>[0]

type GetKeys      = '$get'
type MutationKeys = '$post' | '$put' | '$patch' | '$delete'

// ---------------------------------------------------------------------------
// 헤더 타입
// ---------------------------------------------------------------------------

/**
 * 정적 헤더 객체 또는 동적으로 반환하는 (async) getter 함수.
 *
 * @example
 * // 정적
 * headers: { 'x-api-key': 'secret' }
 *
 * // 동적 (zustand store, cookie 등)
 * headers: () => ({ authorization: `Bearer ${useAuthStore.getState().token}` })
 *
 * // 비동기 동적
 * headers: async () => ({ authorization: `Bearer ${await getToken()}` })
 */
export type HeadersFactory =
  | HeadersInit
  | (() => HeadersInit | Promise<HeadersInit>)

/** createHonoQuery 팩토리 옵션 */
export interface HonoQueryFactoryOptions {
  /** 모든 요청에 자동으로 병합되는 기본 헤더 */
  headers?: HeadersFactory
}

/** useQuery / queryOptions 호출 레벨 옵션 */
export interface QueryCallOptions<TData>
  extends Omit<UseQueryOptions<TData>, 'queryKey' | 'queryFn'> {
  /** 이 호출에만 적용되는 추가 헤더 (팩토리 헤더에 병합됨) */
  headers?: HeadersInit
}

/** useMutation 호출 레벨 옵션 */
export interface MutationCallOptions<TData, TInput>
  extends Omit<UseMutationOptions<TData, Error, TInput>, 'mutationFn'> {
  /** 이 뮤테이션에만 적용되는 추가 헤더 (팩토리 헤더에 병합됨) */
  headers?: HeadersInit
}

// ---------------------------------------------------------------------------
// 퍼블릭 인터페이스 타입
// ---------------------------------------------------------------------------

export interface QueryNode<TFn extends AnyFn> {
  /**
   * useQuery 훅
   * @example
   * const { data } = rpc.api.users.$get.useQuery(
   *   { query: { page: '1' } },
   *   { headers: { 'x-trace-id': '123' }, staleTime: 30_000 },
   * )
   */
  useQuery(
    input: InferInput<TFn>,
    options?: QueryCallOptions<InferOutput<TFn>>,
  ): UseQueryResult<InferOutput<TFn>>

  /**
   * queryOptions 팩토리 — prefetch / ensureQueryData 등과 함께 사용
   * @example
   * // 라우터 loader
   * await queryClient.prefetchQuery(
   *   rpc.api.users.$get.queryOptions({ query: { page: '1' } })
   * )
   */
  queryOptions(
    input: InferInput<TFn>,
    options?: QueryCallOptions<InferOutput<TFn>>,
  ): ReturnType<typeof tsQueryOptions<InferOutput<TFn>>>

  /**
   * queryKey 반환 — 수동 invalidate 등에 사용
   * @example
   * queryClient.invalidateQueries({ queryKey: rpc.api.users.$get.queryKey() })
   */
  queryKey(input?: InferInput<TFn>): QueryKey

  /**
   * useInvalidate 훅 — 캐시 무효화 함수 반환
   * @example
   * const invalidate = rpc.api.users.$get.useInvalidate()
   * await invalidate()
   */
  useInvalidate(): (input?: InferInput<TFn>) => Promise<void>
}

export interface MutationNode<TFn extends AnyFn> {
  /**
   * useMutation 훅
   * @example
   * const { mutate } = rpc.api.users.$post.useMutation({
   *   headers: { 'Idempotency-Key': uuid() },
   *   onSuccess: () => invalidate(),
   * })
   * mutate({ json: { name: 'foo' } })
   */
  useMutation(
    options?: MutationCallOptions<InferOutput<TFn>, InferInput<TFn>>,
  ): UseMutationResult<InferOutput<TFn>, Error, InferInput<TFn>>
}

export type HonoQueryClient<T> = {
  [K in keyof T]: K extends GetKeys
    ? T[K] extends AnyFn
      ? QueryNode<T[K]>
      : never
    : K extends MutationKeys
    ? T[K] extends AnyFn
      ? MutationNode<T[K]>
      : never
    : HonoQueryClient<T[K]>
}

// ---------------------------------------------------------------------------
// 헤더 유틸리티
// ---------------------------------------------------------------------------

function headersToObject(h?: HeadersInit): Record<string, string> {
  if (!h) return {}
  if (h instanceof Headers) return Object.fromEntries(h.entries())
  if (Array.isArray(h)) return Object.fromEntries(h)
  return h as Record<string, string>
}

/**
 * 팩토리 기본 헤더 + idempotency key + 호출 레벨 헤더를 병합하여 반환합니다.
 * 우선순위: 팩토리 < idempotency key < 호출 레벨
 */
async function resolveHeaders(
  factory?: HeadersFactory,
  perCall?: HeadersInit,
  idempotencyKey?: string,
): Promise<Record<string, string> | undefined> {
  const base   = typeof factory === 'function' ? await factory() : factory
  const merged = {
    ...headersToObject(base),
    ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    ...headersToObject(perCall),
  }
  return Object.keys(merged).length > 0 ? merged : undefined
}

// ---------------------------------------------------------------------------
// 내부 구현
// ---------------------------------------------------------------------------

const TERMINAL_KEYS = new Set([
  'useQuery',
  'queryOptions',
  'queryKey',
  'useInvalidate',
  'useMutation',
])

async function callAndParse(
  fn: AnyFn,
  input: unknown,
  headers?: Record<string, string>,
): Promise<unknown> {
  // Hono RPC 두 번째 인자: ClientRequestOptions = { headers?, init? }
  const res = await fn(input, headers ? { headers } : undefined)
  if (!res.ok) {
    throw new Error(`[hono-query] HTTP ${res.status}: ${res.statusText}`)
  }
  return res.json()
}

function buildQueryKey(path: string[], input: unknown): QueryKey {
  return input !== undefined ? [...path, input] : path
}

function makeQueryNode(
  getClientFn: () => AnyFn,
  path: string[],
  factoryHeaders?: HeadersFactory,
): QueryNode<AnyFn> {
  return {
    useQuery(input, options) {
      const { headers: perCallHeaders, ...queryOptions } = options ?? {}
      return useQuery({
        queryKey: buildQueryKey(path, input),
        queryFn: async () => {
          const h = await resolveHeaders(factoryHeaders, perCallHeaders)
          return callAndParse(getClientFn(), input, h)
        },
        ...queryOptions,
      } as UseQueryOptions)
    },

    queryOptions(input, options) {
      const { headers: perCallHeaders, ...restOptions } = options ?? {}
      return tsQueryOptions({
        queryKey: buildQueryKey(path, input),
        queryFn: async () => {
          const h = await resolveHeaders(factoryHeaders, perCallHeaders)
          return callAndParse(getClientFn(), input, h)
        },
        ...restOptions,
      } as UseQueryOptions)
    },

    queryKey(input) {
      return buildQueryKey(path, input)
    },

    useInvalidate() {
      const queryClient = useQueryClient()
      return async (input) => {
        await queryClient.invalidateQueries({ queryKey: buildQueryKey(path, input) })
      }
    },
  }
}

function makeMutationNode(
  getClientFn: () => AnyFn,
  factoryHeaders: HeadersFactory | undefined,
): MutationNode<AnyFn> {
  return {
    useMutation(options) {
      // 각 useMutation 선언부마다 독립적인 key 보유
      const keyRef = useRef<string>(crypto.randomUUID())
      const { headers: perCallHeaders, onSuccess, ...mutationOptions } = options ?? {}

      return useMutation({
        mutationFn: async (input) => {
          const h = await resolveHeaders(factoryHeaders, perCallHeaders, keyRef.current)
          return callAndParse(getClientFn(), input, h)
        },
        onSuccess: (data, variables, context, mutation) => {
          keyRef.current = crypto.randomUUID()
          onSuccess?.(data, variables, context, mutation)
        },
        ...mutationOptions,
      } as UseMutationOptions)
    },
  }
}

function createProxy(
  getNode: () => unknown,
  path: string[],
  factoryHeaders: HeadersFactory | undefined,
): unknown {
  return new Proxy(
    {},
    {
      get(_, key: string) {
        if (TERMINAL_KEYS.has(key)) {
          const httpMethodKey = path[path.length - 1]

          // getNode() 는 이미 $get / $post 함수 자체이므로 재인덱싱 불필요
          const getClientFn = getNode as () => AnyFn

          if (httpMethodKey === '$get') {
            const node = makeQueryNode(getClientFn, path, factoryHeaders)
            return node[key as keyof QueryNode<AnyFn>]
          } else {
            const node = makeMutationNode(getClientFn, factoryHeaders)
            return node[key as keyof MutationNode<AnyFn>]
          }
        }

        const nextPath    = [...path, key]
        const getNextNode = () => (getNode() as Record<string, unknown>)[key]
        return createProxy(getNextNode, nextPath, factoryHeaders)
      },
    },
  )
}

// ---------------------------------------------------------------------------
// 퍼블릭 API
// ---------------------------------------------------------------------------

/**
 * Hono RPC 클라이언트를 tRPC 스타일의 React Query 클라이언트로 감쌉니다.
 *
 * @param client  hc<AppType>(baseUrl) 로 생성한 Hono RPC 클라이언트
 * @param options 팩토리 공통 옵션 (기본 헤더 등)
 *
 * @example
 * // lib/rpc.ts
 * import { hc } from 'hono/client'
 * import { createHonoQuery } from '@/lib/hono-query'
 * import { useAuthStore } from '@/store/auth'
 * import type { AppType } from '@/server'
 *
 * const client = hc<AppType>('/')
 *
 * // 팩토리 레벨 기본 헤더 — 모든 요청에 자동 첨부
 * export const rpc = createHonoQuery(client, {
 *   headers: () => ({
 *     authorization: `Bearer ${useAuthStore.getState().token}`,
 *   }),
 * })
 *
 * // ── 컴포넌트 ──────────────────────────────────────────────────────────────
 *
 * // GET: 팩토리 헤더만 사용
 * const { data } = rpc.api.users.$get.useQuery({ query: { page: '1' } })
 *
 * // GET: 호출 레벨 헤더 추가 (팩토리 헤더에 병합)
 * const { data } = rpc.api.users.$get.useQuery(
 *   { query: { page: '1' } },
 *   { headers: { 'x-trace-id': crypto.randomUUID() }, staleTime: 30_000 },
 * )
 *
 * // POST: Idempotency-Key 는 자동 삽입되며 onSuccess 후 자동 갱신됨
 * const create = rpc.api.users.$post.useMutation({
 *   onSuccess: () => invalidate(),
 * })
 * create.mutate({ json: { name: 'foo' } })
 *
 * // ── 라우터 loader (TanStack Router beforeLoad) ────────────────────────────
 *
 * const authGuard = async () => {
 *   await queryClient.ensureQueryData(
 *     rpc.api.me.$get.queryOptions(undefined, {
 *       headers: { 'x-ssr': 'true' },
 *     })
 *   )
 * }
 */
export function createHonoQuery<T extends object>(
  client: T,
  options?: HonoQueryFactoryOptions,
): HonoQueryClient<T> {
  return createProxy(() => client, [], options?.headers) as HonoQueryClient<T>
}
