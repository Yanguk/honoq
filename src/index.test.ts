/**
 * hono-query-rpc.test.ts
 *
 * 테스트 환경: bun test + @testing-library/react
 */

import { beforeEach, describe, expect, it, vi } from "bun:test";
import {
	QueryClient,
	QueryClientProvider,
	useMutation,
	useQuery,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import React from "react";

import { createHonoQuery } from "./index";

// ---------------------------------------------------------------------------
// 테스트 헬퍼
// ---------------------------------------------------------------------------

/** Hono ClientResponse 를 흉내낸 mock 응답 생성 */
function makeResponse<T>(data: T, ok = true) {
	return {
		ok,
		status: ok ? 200 : 400,
		statusText: ok ? "OK" : "Bad Request",
		json: vi.fn().mockResolvedValue(data),
	};
}

/** 테스트용 QueryClient (재시도 없음, 즉시 GC) */
function createTestQueryClient() {
	return new QueryClient({
		defaultOptions: {
			queries: { retry: false, gcTime: Infinity },
			mutations: { retry: false },
		},
	});
}

/** React 훅 테스트용 wrapper 팩토리 */
function createWrapper(queryClient: QueryClient) {
	return ({ children }: { children: React.ReactNode }) =>
		React.createElement(QueryClientProvider, { client: queryClient }, children);
}

// ---------------------------------------------------------------------------
// Mock 클라이언트
// ---------------------------------------------------------------------------

const mockGetUsers = vi.fn();
const mockPostUser = vi.fn();
const mockPutUser = vi.fn();
const mockDeleteUser = vi.fn();
const mockGetMe = vi.fn();

const mockClient = {
	api: {
		users: {
			$get: mockGetUsers,
			$post: mockPostUser,
			$put: mockPutUser,
			$delete: mockDeleteUser,
		},
		me: {
			$get: mockGetMe,
		},
	},
};

const USERS_DATA = [
	{ id: 1, name: "Alice" },
	{ id: 2, name: "Bob" },
];
const CREATED_USER = { id: 3, name: "Charlie" };
const ME_DATA = { id: 1, name: "Me", role: "admin" };

// ---------------------------------------------------------------------------
// 테스트
// ---------------------------------------------------------------------------

describe("createHonoQuery", () => {
	let queryClient: QueryClient;

	beforeEach(() => {
		queryClient = createTestQueryClient();
		vi.clearAllMocks();

		mockGetUsers.mockResolvedValue(makeResponse(USERS_DATA));
		mockPostUser.mockResolvedValue(makeResponse(CREATED_USER));
		mockPutUser.mockResolvedValue(makeResponse({ id: 1, name: "Updated" }));
		mockDeleteUser.mockResolvedValue(makeResponse({ success: true }));
		mockGetMe.mockResolvedValue(makeResponse(ME_DATA));
	});

	// ─────────────────────────────────────────────────────────────────────────
	// QueryNode — queryOptions
	// ─────────────────────────────────────────────────────────────────────────

	describe("queryOptions", () => {
		it("올바른 queryKey 를 포함한 옵션 객체를 반환한다", () => {
			const api = createHonoQuery(mockClient);
			const input = { query: { page: "1" } };
			const opts = api.api.users.$get.queryOptions(input);

			expect(opts.queryKey as unknown as unknown[]).toEqual([
				"api",
				"users",
				"$get",
				input,
			]);
		});

		it("input 이 없으면 queryKey 에 path 만 포함된다", () => {
			const api = createHonoQuery(mockClient);
			const opts = api.api.users.$get.queryOptions(undefined);

			expect(opts.queryKey as unknown as unknown[]).toEqual([
				"api",
				"users",
				"$get",
			]);
		});

		it("queryFn 호출 시 데이터를 반환한다", async () => {
			const api = createHonoQuery(mockClient);
			const data = await queryClient.fetchQuery(
				api.api.users.$get.queryOptions(undefined),
			);
			expect(data).toEqual(USERS_DATA);
		});

		it("useQuery 와 함께 데이터를 정상적으로 반환한다", async () => {
			const api = createHonoQuery(mockClient);
			const { result } = renderHook(
				() =>
					useQuery(api.api.users.$get.queryOptions({ query: { page: "1" } })),
				{ wrapper: createWrapper(queryClient) },
			);

			await waitFor(() => expect(result.current.isSuccess).toBe(true));
			expect(result.current.data).toEqual(USERS_DATA);
		});

		it("useQuery 에서 input 이 클라이언트 함수의 첫 번째 인자로 전달된다", async () => {
			const api = createHonoQuery(mockClient);
			const input = { query: { page: "2", limit: "10" } };

			const { result } = renderHook(
				() => useQuery(api.api.users.$get.queryOptions(input)),
				{ wrapper: createWrapper(queryClient) },
			);

			await waitFor(() => expect(result.current.isSuccess).toBe(true));
			expect(mockGetUsers.mock.calls[0]?.[0]).toEqual(input);
		});

		it("useQuery 에서 input 이 없을 때 undefined 로 호출된다", async () => {
			const api = createHonoQuery(mockClient);

			const { result } = renderHook(
				() => useQuery(api.api.me.$get.queryOptions(undefined)),
				{ wrapper: createWrapper(queryClient) },
			);

			await waitFor(() => expect(result.current.isSuccess).toBe(true));
			expect(mockGetMe.mock.calls[0]?.[0]).toBeUndefined();
		});

		it("ok: false 응답이면 에러를 throw 한다", async () => {
			mockGetUsers.mockResolvedValue(makeResponse(null, false));
			const api = createHonoQuery(mockClient);

			const { result } = renderHook(
				() => useQuery(api.api.users.$get.queryOptions(undefined)),
				{ wrapper: createWrapper(queryClient) },
			);

			await waitFor(() => expect(result.current.isError).toBe(true));
			expect((result.current.error as Error).message).toMatch(/HTTP 400/);
		});

		it("tanstack-query 옵션(enabled: false)이 적용된다", async () => {
			const api = createHonoQuery(mockClient);

			renderHook(
				() =>
					useQuery(
						api.api.users.$get.queryOptions(undefined, { enabled: false }),
					),
				{ wrapper: createWrapper(queryClient) },
			);

			await new Promise((r) => setTimeout(r, 50));
			expect(mockGetUsers).not.toHaveBeenCalled();
		});

		it("ensureQueryData 와 함께 동작한다", async () => {
			const api = createHonoQuery(mockClient);
			const data = await queryClient.ensureQueryData(
				api.api.users.$get.queryOptions(undefined),
			);

			expect(data).toEqual(USERS_DATA);
		});

		// ── 헤더 테스트 ──────────────────────────────────────────────────────────

		it("[헤더] 팩토리 헤더가 두 번째 인자 { headers } 로 전달된다", async () => {
			const api = createHonoQuery(mockClient, {
				defaultHeaders: { authorization: "Bearer factory-token" },
			});

			const { result } = renderHook(
				() => useQuery(api.api.users.$get.queryOptions(undefined)),
				{ wrapper: createWrapper(queryClient) },
			);

			await waitFor(() => expect(result.current.isSuccess).toBe(true));
			expect(mockGetUsers.mock.calls[0]![1]?.headers).toEqual({
				authorization: "Bearer factory-token",
			});
		});

		it("[헤더] 동적 getter 팩토리 헤더가 매 요청마다 평가된다", async () => {
			let token = "token-v1";
			const api = createHonoQuery(mockClient, {
				defaultHeaders: () => ({ authorization: `Bearer ${token}` }),
			});

			const { result, rerender } = renderHook(
				() =>
					useQuery(
						api.api.users.$get.queryOptions(undefined, { staleTime: 0 }),
					),
				{ wrapper: createWrapper(queryClient) },
			);

			await waitFor(() => expect(result.current.isSuccess).toBe(true));
			expect(mockGetUsers.mock.calls[0]![1]?.headers).toEqual({
				authorization: "Bearer token-v1",
			});

			token = "token-v2";
			queryClient.invalidateQueries({ queryKey: ["api", "users", "$get"] });
			rerender();

			await waitFor(() => expect(mockGetUsers).toHaveBeenCalledTimes(2));
			expect(mockGetUsers.mock.calls[1]![1]?.headers).toEqual({
				authorization: "Bearer token-v2",
			});
		});

		it("[헤더] 비동기 getter 팩토리 헤더가 resolve 된 값으로 전달된다", async () => {
			const api = createHonoQuery(mockClient, {
				defaultHeaders: async () => {
					await Promise.resolve();
					return { "x-async-header": "async-value" };
				},
			});

			const { result } = renderHook(
				() => useQuery(api.api.users.$get.queryOptions(undefined)),
				{ wrapper: createWrapper(queryClient) },
			);

			await waitFor(() => expect(result.current.isSuccess).toBe(true));
			expect(mockGetUsers.mock.calls[0]![1]?.headers).toEqual({
				"x-async-header": "async-value",
			});
		});

		it("[헤더] 호출 레벨 헤더만 있으면 그것만 전달된다", async () => {
			const api = createHonoQuery(mockClient);

			const { result } = renderHook(
				() =>
					useQuery(
						api.api.users.$get.queryOptions(undefined, {
							hono: { headers: { "x-trace-id": "abc" } },
						}),
					),
				{ wrapper: createWrapper(queryClient) },
			);

			await waitFor(() => expect(result.current.isSuccess).toBe(true));
			expect(mockGetUsers.mock.calls[0]![1]?.headers).toEqual({
				"x-trace-id": "abc",
			});
		});

		it("[헤더] 팩토리 + 호출 레벨 헤더가 병합된다 (호출 레벨이 우선)", async () => {
			const api = createHonoQuery(mockClient, {
				defaultHeaders: {
					authorization: "Bearer factory-token",
					"x-app-id": "my-app",
				},
			});

			const { result } = renderHook(
				() =>
					useQuery(
						api.api.users.$get.queryOptions(undefined, {
							hono: {
								headers: {
									authorization: "Bearer call-token",
									"x-trace-id": "xyz",
								},
							},
						}),
					),
				{ wrapper: createWrapper(queryClient) },
			);

			await waitFor(() => expect(result.current.isSuccess).toBe(true));
			expect(mockGetUsers.mock.calls[0]![1]?.headers).toEqual({
				authorization: "Bearer call-token",
				"x-app-id": "my-app",
				"x-trace-id": "xyz",
			});
		});

		it("[헤더] 헤더가 없으면 requestOptions 의 headers 가 undefined 이다", async () => {
			const api = createHonoQuery(mockClient);

			const { result } = renderHook(
				() => useQuery(api.api.users.$get.queryOptions(undefined)),
				{ wrapper: createWrapper(queryClient) },
			);

			await waitFor(() => expect(result.current.isSuccess).toBe(true));
			expect(mockGetUsers.mock.calls[0]![1]?.headers).toBeUndefined();
		});

		it("[헤더] queryFn 호출 시 헤더가 클라이언트에 전달된다 (fetchQuery)", async () => {
			const api = createHonoQuery(mockClient, {
				defaultHeaders: { authorization: "Bearer token" },
			});

			await queryClient.fetchQuery(
				api.api.users.$get.queryOptions(undefined, {
					hono: { headers: { "x-custom": "val" } },
				}),
			);
			expect(mockGetUsers.mock.calls[0]![1]?.headers).toEqual({
				authorization: "Bearer token",
				"x-custom": "val",
			});
		});
	});

	// ─────────────────────────────────────────────────────────────────────────
	// QueryNode — queryKey
	// ─────────────────────────────────────────────────────────────────────────

	describe("queryKey", () => {
		it("input 없이 호출하면 path 기반 key 를 반환한다", () => {
			const api = createHonoQuery(mockClient);
			expect(api.api.users.$get.queryKey() as unknown as unknown[]).toEqual([
				"api",
				"users",
				"$get",
			]);
			expect(api.api.me.$get.queryKey() as unknown as unknown[]).toEqual([
				"api",
				"me",
				"$get",
			]);
		});

		it("input 을 넘기면 key 끝에 추가된다", () => {
			const api = createHonoQuery(mockClient);
			const input = { query: { page: "1" } };

			expect(
				api.api.users.$get.queryKey(input) as unknown as unknown[],
			).toEqual(["api", "users", "$get", input]);
		});
	});

	// ─────────────────────────────────────────────────────────────────────────
	// MutationNode — mutationOptions
	// ─────────────────────────────────────────────────────────────────────────

	describe("mutationOptions", () => {
		it("mutationFn 을 포함한 옵션 객체를 반환한다", () => {
			const api = createHonoQuery(mockClient);
			const opts = api.api.users.$post.mutationOptions();

			expect(typeof opts.mutationFn).toBe("function");
		});

		it("useMutation 과 함께 데이터를 정상적으로 반환한다", async () => {
			const api = createHonoQuery(mockClient);

			const { result } = renderHook(
				() => useMutation(api.api.users.$post.mutationOptions()),
				{ wrapper: createWrapper(queryClient) },
			);

			await act(() =>
				result.current.mutateAsync({ json: { name: "Charlie" } }),
			);

			await waitFor(() => expect(result.current.isSuccess).toBe(true));
			expect(result.current.data).toEqual(CREATED_USER);
		});

		it("input 이 클라이언트 함수의 첫 번째 인자로 전달된다", async () => {
			const api = createHonoQuery(mockClient);
			const input = { json: { name: "Charlie" } };

			const { result } = renderHook(
				() => useMutation(api.api.users.$post.mutationOptions()),
				{ wrapper: createWrapper(queryClient) },
			);

			await act(() => result.current.mutateAsync(input));
			await waitFor(() => expect(result.current.isSuccess).toBe(true));
			expect(mockPostUser.mock.calls[0]?.[0]).toEqual(input);
		});

		it("$put, $delete 등 다른 HTTP 메서드도 동작한다", async () => {
			const api = createHonoQuery(mockClient);

			const { result: putResult } = renderHook(
				() => useMutation(api.api.users.$put.mutationOptions()),
				{ wrapper: createWrapper(queryClient) },
			);
			await act(() =>
				putResult.current.mutateAsync({ json: { name: "Updated" } }),
			);
			await waitFor(() => expect(putResult.current.isSuccess).toBe(true));

			const { result: delResult } = renderHook(
				() => useMutation(api.api.users.$delete.mutationOptions()),
				{ wrapper: createWrapper(queryClient) },
			);
			await act(() => delResult.current.mutateAsync({ param: { id: "1" } }));
			await waitFor(() => expect(delResult.current.isSuccess).toBe(true));
		});

		it("ok: false 응답이면 에러 상태가 된다", async () => {
			mockPostUser.mockResolvedValue(makeResponse(null, false));
			const api = createHonoQuery(mockClient);

			const { result } = renderHook(
				() => useMutation(api.api.users.$post.mutationOptions()),
				{ wrapper: createWrapper(queryClient) },
			);

			act(() => result.current.mutate({ json: { name: "fail" } }));

			await waitFor(() => expect(result.current.isError).toBe(true));
			expect((result.current.error as Error).message).toMatch(/HTTP 400/);
		});

		it("onSuccess / onError 콜백이 호출된다", async () => {
			const onSuccess = vi.fn();
			const onError = vi.fn();
			const api = createHonoQuery(mockClient);

			const { result } = renderHook(
				() =>
					useMutation(
						api.api.users.$post.mutationOptions({ onSuccess, onError }),
					),
				{ wrapper: createWrapper(queryClient) },
			);

			await act(() =>
				result.current.mutateAsync({ json: { name: "Charlie" } }),
			);
			await waitFor(() => expect(result.current.isSuccess).toBe(true));
			expect(onSuccess).toHaveBeenCalledTimes(1);
			expect(onError).not.toHaveBeenCalled();
		});

		// ── 헤더 테스트 ──────────────────────────────────────────────────────────

		it("[헤더] 팩토리 헤더가 두 번째 인자 { headers } 로 전달된다", async () => {
			const api = createHonoQuery(mockClient, {
				defaultHeaders: { authorization: "Bearer factory-token" },
			});

			const { result } = renderHook(
				() => useMutation(api.api.users.$post.mutationOptions()),
				{ wrapper: createWrapper(queryClient) },
			);

			await act(() => result.current.mutateAsync({ json: { name: "test" } }));
			await waitFor(() => expect(result.current.isSuccess).toBe(true));
			// autoIdempotency 기본값 true — Idempotency-Key 포함
			expect(mockPostUser.mock.calls[0]?.[1]?.headers).toEqual(
				expect.objectContaining({
					authorization: "Bearer factory-token",
					"Idempotency-Key": expect.any(String),
				}),
			);
		});

		it("[헤더] 호출 레벨 헤더만 있으면 그것만 전달된다", async () => {
			const api = createHonoQuery(mockClient);

			const { result } = renderHook(
				() =>
					useMutation(
						api.api.users.$post.mutationOptions({
							hono: {
								headers: { "x-custom": "value" },
							},
						}),
					),
				{ wrapper: createWrapper(queryClient) },
			);

			await act(() => result.current.mutateAsync({ json: { name: "test" } }));
			await waitFor(() => expect(result.current.isSuccess).toBe(true));
			// autoIdempotency 기본값 true — Idempotency-Key 포함
			expect(mockPostUser.mock.calls[0]?.[1]?.headers).toEqual(
				expect.objectContaining({
					"x-custom": "value",
					"Idempotency-Key": expect.any(String),
				}),
			);
		});

		it("[헤더] 팩토리 + 호출 레벨 헤더가 병합된다 (호출 레벨이 우선)", async () => {
			const api = createHonoQuery(mockClient, {
				defaultHeaders: {
					authorization: "Bearer factory-token",
					"x-app-id": "my-app",
				},
			});

			const { result } = renderHook(
				() =>
					useMutation(
						api.api.users.$post.mutationOptions({
							hono: {
								headers: {
									authorization: "Bearer call-token",
									"x-extra": "extra",
								},
							},
						}),
					),
				{ wrapper: createWrapper(queryClient) },
			);

			await act(() => result.current.mutateAsync({ json: { name: "test" } }));
			await waitFor(() => expect(result.current.isSuccess).toBe(true));
			// autoIdempotency 기본값 true — Idempotency-Key 포함
			expect(mockPostUser.mock.calls[0]?.[1]?.headers).toEqual(
				expect.objectContaining({
					authorization: "Bearer call-token",
					"x-app-id": "my-app",
					"x-extra": "extra",
					"Idempotency-Key": expect.any(String),
				}),
			);
		});

		it("[헤더] autoIdempotency: false 이면 Idempotency-Key 가 추가되지 않는다", async () => {
			const api = createHonoQuery(mockClient, { autoIdempotency: false });

			const { result } = renderHook(
				() => useMutation(api.api.users.$post.mutationOptions()),
				{ wrapper: createWrapper(queryClient) },
			);

			await act(() => result.current.mutateAsync({ json: { name: "test" } }));
			await waitFor(() => expect(result.current.isSuccess).toBe(true));
			expect(mockPostUser.mock.calls[0]?.[1]?.headers).toBeUndefined();
		});

		it("[헤더] autoIdempotency 기본값으로 Idempotency-Key 가 자동 추가된다", async () => {
			const api = createHonoQuery(mockClient);

			const { result } = renderHook(
				() => useMutation(api.api.users.$post.mutationOptions()),
				{ wrapper: createWrapper(queryClient) },
			);

			await act(() => result.current.mutateAsync({ json: { name: "test" } }));
			await waitFor(() => expect(result.current.isSuccess).toBe(true));
			expect(mockPostUser.mock.calls[0]?.[1]?.headers).toEqual(
				expect.objectContaining({
					"Idempotency-Key": expect.any(String),
				}),
			);
		});
	});

	// ─────────────────────────────────────────────────────────────────────────
	// parseResponse 커스터마이징
	// ─────────────────────────────────────────────────────────────────────────

	describe("parseResponse", () => {
		it("커스텀 parseResponse 가 ok 응답에 적용된다", async () => {
			const api = createHonoQuery(mockClient, {
				parseResponse: async (res) => {
					const data = await res.json();
					return { wrapped: data };
				},
			});

			const data = await queryClient.fetchQuery(
				api.api.users.$get.queryOptions(undefined),
			);
			expect(data).toEqual({ wrapped: USERS_DATA });
		});

		it("커스텀 parseResponse 가 에러 응답 시 커스텀 에러를 throw 한다", async () => {
			mockGetUsers.mockResolvedValue(makeResponse(null, false));

			class CustomError extends Error {
				constructor(public status: number) {
					super(`Custom ${status}`);
				}
			}

			const api = createHonoQuery(mockClient, {
				parseResponse: (res) => {
					if (!res.ok) throw new CustomError(res.status);
					return res.json();
				},
			});

			const { result } = renderHook(
				() => useQuery(api.api.users.$get.queryOptions(undefined)),
				{ wrapper: createWrapper(queryClient) },
			);

			await waitFor(() => expect(result.current.isError).toBe(true));
			expect(result.current.error).toBeInstanceOf(CustomError);
			expect((result.current.error as CustomError).status).toBe(400);
		});

		it("mutation 에도 커스텀 parseResponse 가 적용된다", async () => {
			const api = createHonoQuery(mockClient, {
				parseResponse: async (res) => {
					const data = await res.json();
					return { ok: true, data };
				},
			});

			const { result } = renderHook(
				() => useMutation(api.api.users.$post.mutationOptions()),
				{ wrapper: createWrapper(queryClient) },
			);

			await act(() =>
				result.current.mutateAsync({ json: { name: "Charlie" } }),
			);
			await waitFor(() => expect(result.current.isSuccess).toBe(true));
			expect(result.current.data).toEqual({ ok: true, data: CREATED_USER });
		});
	});

	// ─────────────────────────────────────────────────────────────────────────
	// 헤더 유틸리티 — resolveHeaders 엣지 케이스
	// ─────────────────────────────────────────────────────────────────────────

	describe("헤더 형식 호환성", () => {
		it("Headers 인스턴스를 팩토리 헤더로 사용할 수 있다", async () => {
			const api = createHonoQuery(mockClient, {
				defaultHeaders: new Headers({
					authorization: "Bearer headers-instance",
				}),
			});

			const { result } = renderHook(
				() => useQuery(api.api.users.$get.queryOptions(undefined)),
				{ wrapper: createWrapper(queryClient) },
			);

			await waitFor(() => expect(result.current.isSuccess).toBe(true));

			expect(mockGetUsers.mock.calls[0]?.[1]?.headers).toEqual({
				authorization: "Bearer headers-instance",
			});
		});

		it("튜플 배열([string, string][]) 형식을 사용할 수 있다", async () => {
			const api = createHonoQuery(mockClient, {
				defaultHeaders: [["x-tuple-header", "tuple-value"]],
			});

			const { result } = renderHook(
				() => useQuery(api.api.users.$get.queryOptions(undefined)),
				{ wrapper: createWrapper(queryClient) },
			);

			await waitFor(() => expect(result.current.isSuccess).toBe(true));
			expect(mockGetUsers.mock.calls[0]?.[1]?.headers).toEqual({
				"x-tuple-header": "tuple-value",
			});
		});
	});
});
