/**
 * hono-query.test.ts
 *
 * 테스트 환경: vitest + @testing-library/react
 *
 * 의존성:
 *   pnpm add -D vitest @testing-library/react @testing-library/react-hooks
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

import { createHonoQuery } from './index'

// ---------------------------------------------------------------------------
// 테스트 헬퍼
// ---------------------------------------------------------------------------

/** Hono ClientResponse 를 흉내낸 mock 응답 생성 */
function makeResponse<T>(data: T, ok = true) {
  return {
    ok,
    status: ok ? 200 : 400,
    statusText: ok ? 'OK' : 'Bad Request',
    json: vi.fn().mockResolvedValue(data),
  }
}

/** 테스트용 QueryClient (재시도 없음, 즉시 GC) */
function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Infinity },
      mutations: { retry: false },
    },
  })
}

/** React 훅 테스트용 wrapper 팩토리 */
function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children)
}

// ---------------------------------------------------------------------------
// Mock 클라이언트
// ---------------------------------------------------------------------------

const mockGetUsers  = vi.fn()
const mockPostUser  = vi.fn()
const mockPutUser   = vi.fn()
const mockDeleteUser = vi.fn()
const mockGetMe     = vi.fn()

const mockClient = {
  api: {
    users: {
      $get:    mockGetUsers,
      $post:   mockPostUser,
      $put:    mockPutUser,
      $delete: mockDeleteUser,
    },
    me: {
      $get: mockGetMe,
    },
  },
}

const USERS_DATA  = [{ id: 1, name: 'Alice' }, { id: 2, name: 'Bob' }]
const CREATED_USER = { id: 3, name: 'Charlie' }
const ME_DATA     = { id: 1, name: 'Me', role: 'admin' }

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

describe('createHonoQuery', () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = createTestQueryClient()
    vi.clearAllMocks()

    mockGetUsers.mockResolvedValue(makeResponse(USERS_DATA))
    mockPostUser.mockResolvedValue(makeResponse(CREATED_USER))
    mockPutUser.mockResolvedValue(makeResponse({ id: 1, name: 'Updated' }))
    mockDeleteUser.mockResolvedValue(makeResponse({ success: true }))
    mockGetMe.mockResolvedValue(makeResponse(ME_DATA))
  })

  // ─────────────────────────────────────────────────────────────────────────
  // QueryNode — useQuery
  // ─────────────────────────────────────────────────────────────────────────

  describe('useQuery', () => {
    it('데이터를 정상적으로 반환한다', async () => {
      const rpc = createHonoQuery(mockClient)
      const { result } = renderHook(
        () => rpc.api.users.$get.useQuery({ query: { page: '1' } }),
        { wrapper: createWrapper(queryClient) },
      )

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toEqual(USERS_DATA)
    })

    it('input 이 클라이언트 함수의 첫 번째 인자로 전달된다', async () => {
      const rpc   = createHonoQuery(mockClient)
      const input = { query: { page: '2', limit: '10' } }

      renderHook(() => rpc.api.users.$get.useQuery(input), {
        wrapper: createWrapper(queryClient),
      })

      await waitFor(() => expect(mockGetUsers).toHaveBeenCalledOnce())
      expect(mockGetUsers.mock.calls[0]![0]).toEqual(input)
    })

    it('input 이 없을 때 undefined 로 호출된다', async () => {
      const rpc = createHonoQuery(mockClient)

      renderHook(() => rpc.api.me.$get.useQuery(undefined), {
        wrapper: createWrapper(queryClient),
      })

      await waitFor(() => expect(mockGetMe).toHaveBeenCalledOnce())
      expect(mockGetMe.mock.calls[0]![0]).toBeUndefined()
    })

    it('ok: false 응답이면 에러를 throw 한다', async () => {
      mockGetUsers.mockResolvedValue(makeResponse(null, false))
      const rpc = createHonoQuery(mockClient)

      const { result } = renderHook(
        () => rpc.api.users.$get.useQuery(undefined),
        { wrapper: createWrapper(queryClient) },
      )

      await waitFor(() => expect(result.current.isError).toBe(true))
      expect((result.current.error as Error).message).toMatch(/HTTP 400/)
    })

    it('tanstack-query 옵션(enabled: false)이 적용된다', async () => {
      const rpc = createHonoQuery(mockClient)

      renderHook(
        () => rpc.api.users.$get.useQuery(undefined, { enabled: false }),
        { wrapper: createWrapper(queryClient) },
      )

      // enabled: false → 요청하지 않음
      await new Promise((r) => setTimeout(r, 50))
      expect(mockGetUsers).not.toHaveBeenCalled()
    })

    // ── 헤더 테스트 ──────────────────────────────────────────────────────────

    it('[헤더] 팩토리 헤더가 두 번째 인자 { headers } 로 전달된다', async () => {
      const rpc = createHonoQuery(mockClient, {
        headers: { authorization: 'Bearer factory-token' },
      })

      renderHook(() => rpc.api.users.$get.useQuery(undefined), {
        wrapper: createWrapper(queryClient),
      })

      await waitFor(() => expect(mockGetUsers).toHaveBeenCalledOnce())
      expect(mockGetUsers.mock.calls[0]![1]).toEqual({
        headers: { authorization: 'Bearer factory-token' },
      })
    })

    it('[헤더] 동적 getter 팩토리 헤더가 매 요청마다 평가된다', async () => {
      let token = 'token-v1'
      const rpc = createHonoQuery(mockClient, {
        headers: () => ({ authorization: `Bearer ${token}` }),
      })

      const { rerender } = renderHook(
        () => rpc.api.users.$get.useQuery(undefined, { staleTime: 0 }),
        { wrapper: createWrapper(queryClient) },
      )

      await waitFor(() => expect(mockGetUsers).toHaveBeenCalledTimes(1))
      expect(mockGetUsers.mock.calls[0]![1]).toEqual({
        headers: { authorization: 'Bearer token-v1' },
      })

      // 토큰 변경 후 캐시 무효화 → 재요청
      token = 'token-v2'
      queryClient.invalidateQueries({ queryKey: ['api', 'users', '$get'] })
      rerender()

      await waitFor(() => expect(mockGetUsers).toHaveBeenCalledTimes(2))
      expect(mockGetUsers.mock.calls[1]![1]).toEqual({
        headers: { authorization: 'Bearer token-v2' },
      })
    })

    it('[헤더] 비동기 getter 팩토리 헤더가 resolve 된 값으로 전달된다', async () => {
      const rpc = createHonoQuery(mockClient, {
        headers: async () => {
          await Promise.resolve()
          return { 'x-async-header': 'async-value' }
        },
      })

      renderHook(() => rpc.api.users.$get.useQuery(undefined), {
        wrapper: createWrapper(queryClient),
      })

      await waitFor(() => expect(mockGetUsers).toHaveBeenCalledOnce())
      expect(mockGetUsers.mock.calls[0]![1]).toEqual({
        headers: { 'x-async-header': 'async-value' },
      })
    })

    it('[헤더] 호출 레벨 헤더만 있으면 그것만 전달된다', async () => {
      const rpc = createHonoQuery(mockClient)  // 팩토리 헤더 없음

      renderHook(
        () =>
          rpc.api.users.$get.useQuery(undefined, {
            headers: { 'x-trace-id': 'abc' },
          }),
        { wrapper: createWrapper(queryClient) },
      )

      await waitFor(() => expect(mockGetUsers).toHaveBeenCalledOnce())
      expect(mockGetUsers.mock.calls[0]![1]).toEqual({
        headers: { 'x-trace-id': 'abc' },
      })
    })

    it('[헤더] 팩토리 + 호출 레벨 헤더가 병합된다 (호출 레벨이 우선)', async () => {
      const rpc = createHonoQuery(mockClient, {
        headers: {
          authorization: 'Bearer factory-token',
          'x-app-id': 'my-app',
        },
      })

      renderHook(
        () =>
          rpc.api.users.$get.useQuery(undefined, {
            headers: {
              authorization: 'Bearer call-token',  // 덮어씀
              'x-trace-id': 'xyz',                 // 추가
            },
          }),
        { wrapper: createWrapper(queryClient) },
      )

      await waitFor(() => expect(mockGetUsers).toHaveBeenCalledOnce())
      expect(mockGetUsers.mock.calls[0]![1]).toEqual({
        headers: {
          authorization: 'Bearer call-token',   // 호출 레벨이 우선
          'x-app-id': 'my-app',                 // 팩토리에서 유지
          'x-trace-id': 'xyz',                  // 호출 레벨 추가
        },
      })
    })

    it('[헤더] 헤더가 없으면 두 번째 인자가 undefined 로 전달된다', async () => {
      const rpc = createHonoQuery(mockClient)  // 팩토리 헤더 없음

      renderHook(() => rpc.api.users.$get.useQuery(undefined), {
        wrapper: createWrapper(queryClient),
      })

      await waitFor(() => expect(mockGetUsers).toHaveBeenCalledOnce())
      expect(mockGetUsers.mock.calls[0]![1]).toBeUndefined()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // QueryNode — queryOptions
  // ─────────────────────────────────────────────────────────────────────────

  describe('queryOptions', () => {
    it('올바른 queryKey 를 포함한 옵션 객체를 반환한다', () => {
      const rpc   = createHonoQuery(mockClient)
      const input = { query: { page: '1' } }
      const opts  = rpc.api.users.$get.queryOptions(input)

      expect(opts.queryKey).toEqual(['api', 'users', '$get', input])
    })

    it('input 이 없으면 queryKey 에 path 만 포함된다', () => {
      const rpc  = createHonoQuery(mockClient)
      const opts = rpc.api.users.$get.queryOptions(undefined)

      expect(opts.queryKey).toEqual(['api', 'users', '$get'])
    })

    it('queryFn 호출 시 데이터를 반환한다', async () => {
      const rpc  = createHonoQuery(mockClient)
      const data = await queryClient.fetchQuery(rpc.api.users.$get.queryOptions(undefined))
      expect(data).toEqual(USERS_DATA)
    })

    it('[헤더] queryFn 호출 시 헤더가 클라이언트에 전달된다', async () => {
      const rpc = createHonoQuery(mockClient, {
        headers: { authorization: 'Bearer token' },
      })

      await queryClient.fetchQuery(
        rpc.api.users.$get.queryOptions(undefined, { headers: { 'x-custom': 'val' } }),
      )
      expect(mockGetUsers.mock.calls[0]![1]).toEqual({
        headers: { authorization: 'Bearer token', 'x-custom': 'val' },
      })
    })

    it('ensureQueryData 와 함께 동작한다', async () => {
      const rpc  = createHonoQuery(mockClient)
      const data = await queryClient.ensureQueryData(
        rpc.api.users.$get.queryOptions(undefined),
      )

      expect(data).toEqual(USERS_DATA)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // QueryNode — queryKey
  // ─────────────────────────────────────────────────────────────────────────

  describe('queryKey', () => {
    it('input 없이 호출하면 path 기반 key 를 반환한다', () => {
      const rpc = createHonoQuery(mockClient)
      expect(rpc.api.users.$get.queryKey()).toEqual(['api', 'users', '$get'])
      expect(rpc.api.me.$get.queryKey()).toEqual(['api', 'me', '$get'])
    })

    it('input 을 넘기면 key 끝에 추가된다', () => {
      const rpc   = createHonoQuery(mockClient)
      const input = { query: { page: '1' } }

      expect(rpc.api.users.$get.queryKey(input)).toEqual([
        'api', 'users', '$get', input,
      ])
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // QueryNode — useInvalidate
  // ─────────────────────────────────────────────────────────────────────────

  describe('useInvalidate', () => {
    it('해당 queryKey 의 캐시를 무효화한다', async () => {
      const rpc = createHonoQuery(mockClient)

      // 먼저 캐시에 데이터 채우기
      await queryClient.prefetchQuery(rpc.api.users.$get.queryOptions(undefined))
      expect(queryClient.getQueryData(['api', 'users', '$get'])).toEqual(USERS_DATA)

      const { result } = renderHook(() => rpc.api.users.$get.useInvalidate(), {
        wrapper: createWrapper(queryClient),
      })

      await act(() => result.current())

      // 무효화 후 stale 상태가 됨 (데이터는 남아있으나 isStale)
      const state = queryClient.getQueryState(['api', 'users', '$get'])
      expect(state?.isInvalidated).toBe(true)
    })

    it('input 을 넘기면 해당 input 포함 key 만 무효화된다', async () => {
      const rpc    = createHonoQuery(mockClient)
      const input1 = { query: { page: '1' } }
      const input2 = { query: { page: '2' } }

      await queryClient.prefetchQuery(rpc.api.users.$get.queryOptions(input1))
      await queryClient.prefetchQuery(rpc.api.users.$get.queryOptions(input2))

      const { result } = renderHook(() => rpc.api.users.$get.useInvalidate(), {
        wrapper: createWrapper(queryClient),
      })

      // input1 만 무효화
      await act(() => result.current(input1))

      expect(
        queryClient.getQueryState(['api', 'users', '$get', input1])?.isInvalidated,
      ).toBe(true)
      expect(
        queryClient.getQueryState(['api', 'users', '$get', input2])?.isInvalidated,
      ).toBe(false)
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // MutationNode — useMutation
  // ─────────────────────────────────────────────────────────────────────────

  describe('useMutation', () => {
    it('mutate 호출 시 데이터를 반환한다', async () => {
      const rpc = createHonoQuery(mockClient)

      const { result } = renderHook(() => rpc.api.users.$post.useMutation(), {
        wrapper: createWrapper(queryClient),
      })

      await act(() => result.current.mutateAsync({ json: { name: 'Charlie' } }))

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toEqual(CREATED_USER)
    })

    it('input 이 클라이언트 함수의 첫 번째 인자로 전달된다', async () => {
      const rpc   = createHonoQuery(mockClient)
      const input = { json: { name: 'Charlie' } }

      const { result } = renderHook(() => rpc.api.users.$post.useMutation(), {
        wrapper: createWrapper(queryClient),
      })

      await act(() => result.current.mutateAsync(input))
      expect(mockPostUser.mock.calls[0]![0]).toEqual(input)
    })

    it('$put, $delete 등 다른 HTTP 메서드도 동작한다', async () => {
      const rpc = createHonoQuery(mockClient)

      const { result: putResult } = renderHook(
        () => rpc.api.users.$put.useMutation(),
        { wrapper: createWrapper(queryClient) },
      )
      await act(() => putResult.current.mutateAsync({ json: { name: 'Updated' } }))
      await waitFor(() => expect(putResult.current.isSuccess).toBe(true))

      const { result: delResult } = renderHook(
        () => rpc.api.users.$delete.useMutation(),
        { wrapper: createWrapper(queryClient) },
      )
      await act(() => delResult.current.mutateAsync({ param: { id: '1' } }))
      await waitFor(() => expect(delResult.current.isSuccess).toBe(true))
    })

    it('ok: false 응답이면 에러 상태가 된다', async () => {
      mockPostUser.mockResolvedValue(makeResponse(null, false))
      const rpc = createHonoQuery(mockClient)

      const { result } = renderHook(() => rpc.api.users.$post.useMutation(), {
        wrapper: createWrapper(queryClient),
      })

      await act(() => result.current.mutate({ json: { name: 'fail' } }))
      await waitFor(() => expect(result.current.isError).toBe(true))
      expect((result.current.error as Error).message).toMatch(/HTTP 400/)
    })

    it('onSuccess / onError 콜백이 호출된다', async () => {
      const onSuccess = vi.fn()
      const onError   = vi.fn()
      const rpc       = createHonoQuery(mockClient)

      const { result } = renderHook(
        () => rpc.api.users.$post.useMutation({ onSuccess, onError }),
        { wrapper: createWrapper(queryClient) },
      )

      await act(() => result.current.mutateAsync({ json: { name: 'Charlie' } }))
      expect(onSuccess).toHaveBeenCalledOnce()
      expect(onError).not.toHaveBeenCalled()
    })

    // ── 헤더 테스트 ──────────────────────────────────────────────────────────

    it('[헤더] 팩토리 헤더가 두 번째 인자 { headers } 로 전달된다', async () => {
      const rpc = createHonoQuery(mockClient, {
        headers: { authorization: 'Bearer factory-token' },
      })

      const { result } = renderHook(() => rpc.api.users.$post.useMutation(), {
        wrapper: createWrapper(queryClient),
      })

      await act(() => result.current.mutateAsync({ json: { name: 'test' } }))
      expect(mockPostUser.mock.calls[0]![1]).toEqual({
        headers: {
          authorization: 'Bearer factory-token',
          'Idempotency-Key': expect.any(String),
        },
      })
    })

    it('[헤더] 호출 레벨 헤더만 있으면 그것만 전달된다', async () => {
      const rpc = createHonoQuery(mockClient)

      const { result } = renderHook(
        () =>
          rpc.api.users.$post.useMutation({
            headers: { 'Idempotency-Key': 'idem-123' },
          }),
        { wrapper: createWrapper(queryClient) },
      )

      await act(() => result.current.mutateAsync({ json: { name: 'test' } }))
      expect(mockPostUser.mock.calls[0]![1]).toEqual({
        headers: { 'Idempotency-Key': 'idem-123' },
      })
    })

    it('[헤더] 팩토리 + 호출 레벨 헤더가 병합된다 (호출 레벨이 우선)', async () => {
      const rpc = createHonoQuery(mockClient, {
        headers: {
          authorization: 'Bearer factory-token',
          'x-app-id': 'my-app',
        },
      })

      const { result } = renderHook(
        () =>
          rpc.api.users.$post.useMutation({
            headers: {
              authorization: 'Bearer call-token',
              'Idempotency-Key': 'idem-456',
            },
          }),
        { wrapper: createWrapper(queryClient) },
      )

      await act(() => result.current.mutateAsync({ json: { name: 'test' } }))
      expect(mockPostUser.mock.calls[0]![1]).toEqual({
        headers: {
          authorization: 'Bearer call-token',
          'x-app-id': 'my-app',
          'Idempotency-Key': 'idem-456',
        },
      })
    })

    it('[헤더] 팩토리/호출 레벨 헤더 없어도 Idempotency-Key 는 항상 포함된다', async () => {
      const rpc = createHonoQuery(mockClient)

      const { result } = renderHook(() => rpc.api.users.$post.useMutation(), {
        wrapper: createWrapper(queryClient),
      })

      await act(() => result.current.mutateAsync({ json: { name: 'test' } }))
      expect(mockPostUser.mock.calls[0]![1]).toEqual({
        headers: { 'Idempotency-Key': expect.any(String) },
      })
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // Idempotency-Key 자동 관리
  // ─────────────────────────────────────────────────────────────────────────

  describe('Idempotency-Key 자동 관리', () => {
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

    it('mutation 호출 시 UUID 형식의 Idempotency-Key 가 자동 삽입된다', async () => {
      const rpc = createHonoQuery(mockClient)
      const { result } = renderHook(() => rpc.api.users.$post.useMutation(), {
        wrapper: createWrapper(queryClient),
      })

      await act(() => result.current.mutateAsync({ json: { name: 'test' } }))

      const sentKey = mockPostUser.mock.calls[0]![1]?.headers?.['Idempotency-Key']
      expect(sentKey).toMatch(UUID_RE)
    })

    it('같은 훅 인스턴스에서 onSuccess 후 key 가 갱신된다', async () => {
      const rpc = createHonoQuery(mockClient)
      const { result } = renderHook(() => rpc.api.users.$post.useMutation(), {
        wrapper: createWrapper(queryClient),
      })

      await act(() => result.current.mutateAsync({ json: { name: 'first' } }))
      const key1 = mockPostUser.mock.calls[0]![1]?.headers?.['Idempotency-Key']

      vi.clearAllMocks()

      // 같은 인스턴스로 2차 호출 — onSuccess 로 key 갱신되어 있어야 함
      await act(() => result.current.mutateAsync({ json: { name: 'second' } }))
      const key2 = mockPostUser.mock.calls[0]![1]?.headers?.['Idempotency-Key']

      expect(key1).toMatch(UUID_RE)
      expect(key2).toMatch(UUID_RE)
      expect(key1).not.toBe(key2)
    })

    it('onError 시에는 key 가 갱신되지 않는다 (재시도에 같은 key 사용)', async () => {
      mockPostUser
        .mockResolvedValueOnce(makeResponse(null, false))  // 1차 실패
        .mockResolvedValueOnce(makeResponse(CREATED_USER)) // 2차 성공

      const rpc = createHonoQuery(mockClient)
      const { result } = renderHook(() => rpc.api.users.$post.useMutation(), {
        wrapper: createWrapper(queryClient),
      })

      await act(() => result.current.mutate({ json: { name: 'fail' } }))
      await waitFor(() => expect(result.current.isError).toBe(true))
      const key1 = mockPostUser.mock.calls[0]![1]?.headers?.['Idempotency-Key']

      vi.clearAllMocks()

      // 재시도 — 실패 후이므로 key 동일해야 함
      await act(() => result.current.mutateAsync({ json: { name: 'retry' } }))
      const key2 = mockPostUser.mock.calls[0]![1]?.headers?.['Idempotency-Key']

      expect(key1).toBe(key2)
    })

    it('다른 useMutation 선언부는 각자 독립적인 key 를 가진다', async () => {
      const rpc = createHonoQuery(mockClient)

      // 동일 엔드포인트라도 선언부가 다르면 key 가 독립적
      const { result: hook1 } = renderHook(() => rpc.api.users.$post.useMutation(), {
        wrapper: createWrapper(queryClient),
      })
      const { result: hook2 } = renderHook(() => rpc.api.users.$post.useMutation(), {
        wrapper: createWrapper(queryClient),
      })

      await act(() => hook1.current.mutateAsync({ json: { name: 'a' } }))
      const key1 = mockPostUser.mock.calls[0]![1]?.headers?.['Idempotency-Key']

      vi.clearAllMocks()

      await act(() => hook2.current.mutateAsync({ json: { name: 'b' } }))
      const key2 = mockPostUser.mock.calls[0]![1]?.headers?.['Idempotency-Key']

      expect(key1).toMatch(UUID_RE)
      expect(key2).toMatch(UUID_RE)
      expect(key1).not.toBe(key2)
    })

    it('호출 레벨에서 Idempotency-Key 를 명시하면 자동 생성 key 를 덮어쓴다', async () => {
      const rpc = createHonoQuery(mockClient)
      const { result } = renderHook(
        () => rpc.api.users.$post.useMutation({ headers: { 'Idempotency-Key': 'my-custom-key' } }),
        { wrapper: createWrapper(queryClient) },
      )

      await act(() => result.current.mutateAsync({ json: { name: 'test' } }))

      expect(mockPostUser.mock.calls[0]![1]?.headers?.['Idempotency-Key']).toBe('my-custom-key')
    })

    it('useQuery ($get) 에는 Idempotency-Key 가 포함되지 않는다', async () => {
      const rpc = createHonoQuery(mockClient)

      renderHook(() => rpc.api.users.$get.useQuery(undefined), {
        wrapper: createWrapper(queryClient),
      })

      await waitFor(() => expect(mockGetUsers).toHaveBeenCalledOnce())
      expect(mockGetUsers.mock.calls[0]![1]?.headers?.['Idempotency-Key']).toBeUndefined()
    })
  })

  // ─────────────────────────────────────────────────────────────────────────
  // 헤더 유틸리티 — resolveHeaders 엣지 케이스
  // ─────────────────────────────────────────────────────────────────────────

  describe('헤더 형식 호환성', () => {
    it('Headers 인스턴스를 팩토리 헤더로 사용할 수 있다', async () => {
      const rpc = createHonoQuery(mockClient, {
        headers: new Headers({ authorization: 'Bearer headers-instance' }),
      })

      renderHook(() => rpc.api.users.$get.useQuery(undefined), {
        wrapper: createWrapper(queryClient),
      })

      await waitFor(() => expect(mockGetUsers).toHaveBeenCalledOnce())
      expect(mockGetUsers.mock.calls[0]![1]).toEqual({
        headers: { authorization: 'Bearer headers-instance' },
      })
    })

    it('튜플 배열([string, string][]) 형식을 사용할 수 있다', async () => {
      const rpc = createHonoQuery(mockClient, {
        headers: [['x-tuple-header', 'tuple-value']],
      })

      renderHook(() => rpc.api.users.$get.useQuery(undefined), {
        wrapper: createWrapper(queryClient),
      })

      await waitFor(() => expect(mockGetUsers).toHaveBeenCalledOnce())
      expect(mockGetUsers.mock.calls[0]![1]).toEqual({
        headers: { 'x-tuple-header': 'tuple-value' },
      })
    })
  })
})
